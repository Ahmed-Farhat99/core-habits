const moment = window.moment;
import { getNoteByDate } from '../utils/helpers.js';

export class StreakCalculator {
  static #cache = new Map();

  constructor(plugin, contentCache = null) {
    this.plugin = plugin;
    this.contentCache = contentCache;
  }

  async calculate(habit) {
    const todayStr = moment().locale("en").format("YYYY-MM-DD");
    const cached = StreakCalculator.#cache.get(habit.id);
    if (cached && cached.computedAtDate === todayStr && (Date.now() - cached.computedAt < 10 * 60 * 1000)) {
      return cached.value;
    }

    let currentStreak = 0;
    let longestStreak = habit.savedLongestStreak || 0;
    let firstCompletionDate = null;
    let consistencyCompleted = 0;
    let consistencyScheduled = 0;
    let totalGapDays = 0;
    let gapCount = 0;
    let currentGapLength = 0;
    let ongoingGapLength = 0;
    let hasSeenFirstRightCompletion = false;
    let currentStreakBroken = false;
    let tempStreak = 0;

    const today = moment();
    const daysToLookBack = 365;
    const CONSISTENCY_WINDOW = 30;
    let fileReads = 0;

    for (let i = 0; i <= daysToLookBack && fileReads < daysToLookBack; i++) {
      const date = today.clone().subtract(i, "days");
      const dayOfWeek = date.day();

      if (!this.plugin.habitManager.isHabitScheduledForDay(habit, dayOfWeek)) {
        continue;
      }

      const isAfterArchive = habit.archived && habit.archivedDate && date.clone().startOf("day").isAfter(moment(habit.archivedDate).startOf("day"));
      if (isAfterArchive) {
        continue;
      }

      // Check if date falls in an archived period (between archivedDate and restoredDate)
      if (habit.archivedDate && habit.restoredDate) {
        const archMoment = moment(habit.archivedDate).startOf("day");
        const restMoment = moment(habit.restoredDate).startOf("day");
        const dateMoment = date.clone().startOf("day");
        if (dateMoment.isSameOrAfter(archMoment) && dateMoment.isSameOrBefore(restMoment)) {
          continue;
        }
      }

      const dateKey = date.clone().locale("en").format("YYYY-MM-DD");
      let content = null;
      let parsedHabits = null;

      if (this.contentCache && this.contentCache.has(dateKey)) {
        const cached = this.contentCache.get(dateKey);
        if (typeof cached === 'string') {
          content = cached;
        } else {
          content = cached.content;
          parsedHabits = cached.parsedHabits;
        }
      } else {
        const dailyNote = await getNoteByDate(this.plugin.app, date, false, this.plugin.settings);
        if (dailyNote) {
          fileReads++;
          if (i === 0) {
            content = await this.plugin.app.vault.read(dailyNote);
          } else {
            content = await this.plugin.app.vault.cachedRead(dailyNote);
          }
        }
      }

      if (content !== null && !parsedHabits) {
        parsedHabits = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
        if (this.contentCache) {
          this.contentCache.set(dateKey, { content, parsedHabits });
        }
      }

      const status = await this.plugin.statsService.getHabitStatus(habit, date, parsedHabits || content);

      if (status === "ignored") {
        if (hasSeenFirstRightCompletion) {
          currentGapLength++;
        } else {
          ongoingGapLength++;
        }
        continue;
      }

      if (status === "skipped") {
        continue;
      }

      if (status === "completed") {
        tempStreak++;
        
        if (!firstCompletionDate || date.isBefore(firstCompletionDate, 'day')) {
          firstCompletionDate = date.clone();
        }

        hasSeenFirstRightCompletion = true;
        if (currentGapLength > 0) {
          totalGapDays += currentGapLength;
          gapCount++;
          currentGapLength = 0;
        }

        if (!currentStreakBroken) {
          currentStreak = tempStreak;
        }
        longestStreak = Math.max(longestStreak, tempStreak);

        if (i < CONSISTENCY_WINDOW) {
          consistencyScheduled++;
          consistencyCompleted++;
        }
      } else {
        // status === "uncompleted"
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
        }
      }
    }

    const consistencyScore = consistencyScheduled > 0
      ? Math.round((consistencyCompleted / consistencyScheduled) * 100) : null;

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
      recoveryScore, 
      ongoingGapLength
    };

    StreakCalculator.#cache.set(habit.id, {
      value: result,
      computedAt: Date.now(),
      computedAtDate: todayStr
    });
    return result;
  }

  static invalidate(habitId) {
    StreakCalculator.#cache.delete(habitId);
  }

  static invalidateAll() {
    StreakCalculator.#cache.clear();
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
