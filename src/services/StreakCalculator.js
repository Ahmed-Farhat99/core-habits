const moment = window.moment;
import { getNoteByDate } from '../utils/helpers.js';
import { HabitEntity } from '../domain/HabitEntity.js';
import { ProgressionEngine } from './ProgressionEngine.js';

export class StreakCalculator {
  static #cache = new Map();
  static #dailyNotesCache = new Map();
  static #inFlight = new Map();
  static #generation = 0;

  constructor(plugin, contentCache = null) {
    this.plugin = plugin;
    this.contentCache = contentCache;
  }

  async calculate(habit) {
    const generation = StreakCalculator.#generation;
    const todayStr = moment().locale("en").format("YYYY-MM-DD");
    const cached = StreakCalculator.#cache.get(habit.id);
    if (cached && cached.computedAtDate === todayStr && (Date.now() - cached.computedAt < 10 * 60 * 1000)) {
      return cached.value;
    }

    if (StreakCalculator.#inFlight.has(habit.id)) {
      return StreakCalculator.#inFlight.get(habit.id);
    }

    const calcPromise = (async () => {
      let currentStreak = 0;
      let longestStreak = habit.savedLongestStreak || 0;
      let firstCompletionDate = null;
      let consistencyCompleted = 0;
      let consistencyScheduled = 0;
      let prevConsistencyCompleted = 0;
      let prevConsistencyScheduled = 0;
      let totalGapDays = 0;
      let gapCount = 0;
      let currentGapLength = 0;
      let ongoingGapLength = 0;
      let hasSeenFirstRightCompletion = false;
      let currentStreakBroken = false;
      let tempStreak = 0;

      const today = moment();
      const daysToLookBack = 365;
      const CONSISTENCY_WINDOW = 28;
      const PREV_CONSISTENCY_WINDOW = 56;
      const HISTORY_WINDOW = 28;
      const dailyHistoryMap = new Map();

      for (let i = 0; i < daysToLookBack; i++) {
        const date = today.clone().subtract(i, "days");
        const dayOfWeek = date.day();
        const dateKey = date.clone().locale("en").format("YYYY-MM-DD");

        const isScheduled = (this.plugin?.habitManager && typeof this.plugin.habitManager.isHabitScheduledForDay === "function")
          ? this.plugin.habitManager.isHabitScheduledForDay(habit, dayOfWeek)
          : HabitEntity.isScheduledForDay(habit, dayOfWeek);

        if (!isScheduled) {
          if (i < HISTORY_WINDOW) dailyHistoryMap.set(i, { date: dateKey, status: "unscheduled", dayOfWeek });
          continue;
        }

        const isAfterArchive = habit.archived && habit.archivedDate && date.clone().startOf("day").isAfter(moment(habit.archivedDate).startOf("day"));
        if (isAfterArchive) {
          if (i < HISTORY_WINDOW) dailyHistoryMap.set(i, { date: dateKey, status: "unscheduled", dayOfWeek });
          continue;
        }

        // Check if date falls in an archived period (between archivedDate and restoredDate)
        if (habit.archivedDate && habit.restoredDate) {
          const archMoment = moment(habit.archivedDate).startOf("day");
          const restMoment = moment(habit.restoredDate).startOf("day");
          const dateMoment = date.clone().startOf("day");
          if (dateMoment.isSameOrAfter(archMoment) && dateMoment.isSameOrBefore(restMoment)) {
            if (i < HISTORY_WINDOW) dailyHistoryMap.set(i, { date: dateKey, status: "unscheduled", dayOfWeek });
            continue;
          }
        }
        let content = null;
        let parsedHabits = null;

        if (this.contentCache && this.contentCache.has(dateKey)) {
          const cachedEntry = this.contentCache.get(dateKey);
          if (typeof cachedEntry === 'string') {
            content = cachedEntry;
          } else {
            content = cachedEntry.content;
            parsedHabits = cachedEntry.parsedHabits;
          }
        } else if (StreakCalculator.#dailyNotesCache.has(dateKey)) {
          const cachedEntry = StreakCalculator.#dailyNotesCache.get(dateKey);
          content = cachedEntry.content;
          parsedHabits = cachedEntry.parsedHabits;
        } else {
          const dailyNote = await getNoteByDate(this.plugin.app, date, false, this.plugin.settings);
          if (dailyNote) {
            if (i === 0) {
              content = await this.plugin.app.vault.read(dailyNote);
            } else {
              content = await this.plugin.app.vault.cachedRead(dailyNote);
            }
          }
        }

        if (content !== null && !parsedHabits) {
          parsedHabits = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
        }

        if (this.contentCache) {
          this.contentCache.set(dateKey, { content, parsedHabits });
        }
        if (generation === StreakCalculator.#generation) {
          StreakCalculator.#dailyNotesCache.set(dateKey, { content, parsedHabits });
        }

        const status = await this.plugin.statsService.getHabitStatus(habit, date, parsedHabits || content);

        if (status === "ignored") {
          if (i < HISTORY_WINDOW) dailyHistoryMap.set(i, { date: dateKey, status: "unscheduled", dayOfWeek });
          if (hasSeenFirstRightCompletion) {
            currentGapLength++;
          } else {
            ongoingGapLength++;
          }
          continue;
        }

        if (status === "skipped") {
          if (i < HISTORY_WINDOW) dailyHistoryMap.set(i, { date: dateKey, status: "skipped", dayOfWeek });
          continue;
        }

        if (status === "completed") {
          if (i < HISTORY_WINDOW) dailyHistoryMap.set(i, { date: dateKey, status: "completed", dayOfWeek });
          tempStreak++;
          
          if (!firstCompletionDate || date.isBefore(firstCompletionDate, 'day')) {
            firstCompletionDate = date.clone();
          }

          hasSeenFirstRightCompletion = true;
          if (currentGapLength > 0) {
            if (i < CONSISTENCY_WINDOW) {
              totalGapDays += currentGapLength;
              gapCount++;
            }
            currentGapLength = 0;
          }

          if (!currentStreakBroken) {
            currentStreak = tempStreak;
          }
          longestStreak = Math.max(longestStreak, tempStreak);

          if (i < CONSISTENCY_WINDOW) {
            consistencyScheduled++;
            consistencyCompleted++;
          } else if (i < PREV_CONSISTENCY_WINDOW) {
            prevConsistencyScheduled++;
            prevConsistencyCompleted++;
          }
        } else {
          // status === "uncompleted"
          if (i < HISTORY_WINDOW) dailyHistoryMap.set(i, { date: dateKey, status: "missed", dayOfWeek });
          if (i === 0) {
            if (i < CONSISTENCY_WINDOW) consistencyScheduled++;
            continue;
          }

          if (!currentStreakBroken) {
            currentStreakBroken = true;
          }
          tempStreak = 0;

          if (hasSeenFirstRightCompletion) {
            currentGapLength++;
          } else {
            ongoingGapLength++;
          }

          if (i < CONSISTENCY_WINDOW) {
            consistencyScheduled++;
          } else if (i < PREV_CONSISTENCY_WINDOW) {
            prevConsistencyScheduled++;
          }
        }
      }

      const dailyHistory = [];
      for (let i = HISTORY_WINDOW - 1; i >= 0; i--) {
        const item = dailyHistoryMap.get(i);
        if (item) {
          dailyHistory.push({
            date: item.date,
            status: item.status,
            dayOfWeek: item.dayOfWeek
          });
        } else {
          const d = today.clone().subtract(i, "days");
          dailyHistory.push({
            date: d.clone().locale("en").format("YYYY-MM-DD"),
            status: "unscheduled",
            dayOfWeek: d.day()
          });
        }
      }

      const consistencyScore = consistencyScheduled > 0
        ? Math.round((consistencyCompleted / consistencyScheduled) * 100) : null;

      const previousConsistencyScore = prevConsistencyScheduled > 0
        ? Math.round((prevConsistencyCompleted / prevConsistencyScheduled) * 100) : null;

      let trendDelta = null;
      let trendDirection = null;

      if (consistencyScore !== null && previousConsistencyScore !== null) {
        trendDelta = consistencyScore - previousConsistencyScore;
        if (trendDelta >= 5) {
          trendDirection = "up";
        } else if (trendDelta <= -5) {
          trendDirection = "down";
        } else {
          trendDirection = "stable";
        }
      }

      const consistencyLabel = this.getConsistencyLabel(consistencyScore);
      const recoveryScore = gapCount > 0 ? (totalGapDays / gapCount) : null;

      const result = { 
        currentStreak, 
        longestStreak, 
        firstCompletionDate, 
        consistencyScore, 
        consistencyLabel, 
        consistencyCompleted, 
        consistencyScheduled, 
        previousConsistencyScore,
        prevConsistencyCompleted,
        prevConsistencyScheduled,
        trendDelta,
        trendDirection,
        recoveryScore, 
        ongoingGapLength,
        dailyHistory
      };

      if (generation === StreakCalculator.#generation) {
        StreakCalculator.#cache.set(habit.id, {
          value: result,
          computedAt: Date.now(),
          computedAtDate: todayStr
        });
      }

      // High-Water Mark synchronization:
      // If peak streak exceeds existing saved value, update in-memory habit
      // and trigger safe milestone checkpoint synchronization.
      const peakStreak = Math.max(habit?.savedLongestStreak || 0, result.longestStreak || 0, result.currentStreak || 0);
      const calculatedLevel = ProgressionEngine.calculateLevel(habit, result);
      const isStreakHigher = peakStreak > (habit?.savedLongestStreak || 0);

      if (habit) {
        if (isStreakHigher) {
          habit.savedLongestStreak = peakStreak;
        }
        if (calculatedLevel > (habit.currentLevel || 1)) {
          habit.currentLevel = calculatedLevel;
        }
      }

      if (this.plugin?.habitManager) {
        const mgrHabit = this.plugin.habitManager.getHabitById?.(habit?.id);
        if (mgrHabit && mgrHabit !== habit) {
          if (isStreakHigher) {
            mgrHabit.savedLongestStreak = peakStreak;
          }
          if (calculatedLevel > (mgrHabit.currentLevel || 1)) {
            mgrHabit.currentLevel = calculatedLevel;
          }
        }
        if (isStreakHigher && habit?.id && typeof this.plugin.habitManager.syncMilestoneCheckpoint === "function") {
          this.plugin.habitManager.syncMilestoneCheckpoint(habit.id, peakStreak, calculatedLevel);
        }
      }

      return result;
    })();

    StreakCalculator.#inFlight.set(habit.id, calcPromise);
    try {
      return await calcPromise;
    } finally {
      if (StreakCalculator.#inFlight.get(habit.id) === calcPromise) {
        StreakCalculator.#inFlight.delete(habit.id);
      }
    }
  }

  static getCachedStats(habitId) {
    if (!habitId) return null;
    const entry = StreakCalculator.#cache.get(habitId);
    return entry?.value || null;
  }

  static invalidate(habitId) {
    StreakCalculator.#generation++;
    StreakCalculator.#cache.delete(habitId);
    StreakCalculator.#inFlight.delete(habitId);
  }

  static invalidateDailyNote(dateKey) {
    StreakCalculator.#generation++;
    StreakCalculator.#dailyNotesCache.delete(dateKey);
    StreakCalculator.#cache.clear();
    StreakCalculator.#inFlight.clear();
  }

  static invalidateAll() {
    StreakCalculator.#generation++;
    StreakCalculator.#cache.clear();
    StreakCalculator.#dailyNotesCache.clear();
    StreakCalculator.#inFlight.clear();
  }

  getConsistencyLabel(score) {
    const t = (k) => this.plugin.translationManager.t(k);
    if (score === null) return null;
    if (score >= 85) return t("consistency_excellent");
    if (score >= 65) return t("consistency_good");
    if (score >= 40) return t("consistency_fair");
    return t("consistency_low");
  }
}
