const moment = window.moment || globalThis.moment;
import { findHabitEntry, DateUtils } from '../../utils/helpers.js';
import { HabitEntity } from '../HabitEntity.js';

export class HabitAggregator {
  constructor(options = {}) {
    this.dayCache = options.dayCache || new Map();
    this.cacheGeneration = 0;
  }

  /**
   * Clears or invalidates a single dateKey or all cached days.
   * @param {string} [dateKey] - If omitted, clears all cache.
   */
  invalidateCache(dateKey = null) {
    this.cacheGeneration++;
    if (dateKey) {
      this.dayCache.delete(dateKey);
    } else {
      this.dayCache.clear();
    }
  }

  /**
   * Helper to check if habit was scheduled and applicable on given date.
   * Pure logic, no side-effects.
   */
  isHabitApplicableOnDate(habit, date, habitManager = null) {
    const dayOfWeek = date.day();

    // 1. Scheduled for this day of week?
    const isScheduled = (habitManager && typeof habitManager.isHabitScheduledForDay === "function")
      ? habitManager.isHabitScheduledForDay(habit, dayOfWeek)
      : HabitEntity.isScheduledForDay(habit, dayOfWeek);

    if (!isScheduled) {
      return false;
    }

    // 2. Check if date falls in an archived period (between archivedDate and restoredDate)
    if (habit.archivedDate && habit.restoredDate) {
      const archMoment = moment(habit.archivedDate).startOf("day");
      const restMoment = moment(habit.restoredDate).startOf("day");
      const dateMoment = date.clone().startOf("day");
      if (dateMoment.isSameOrAfter(archMoment) && dateMoment.isSameOrBefore(restMoment)) {
        return false;
      }
    } else if (habit.restoredDate && date.isBefore(moment(habit.restoredDate), "day")) {
      return false;
    }

    // 3. Check if after archivedDate
    if (habit.archived && habit.archivedDate) {
      if (date.clone().startOf("day").isAfter(moment(habit.archivedDate).startOf("day"))) {
        return false;
      }
    }

    return true;
  }

  /**
   * Evaluates habit status on a given date from scanned entries.
   * Returns: "completed" | "skipped" | "uncompleted" | "ignored"
   */
  resolveHabitStatus(habit, date, scannedEntries, hasNote, settings, habitManager = null) {
    if (!this.isHabitApplicableOnDate(habit, date, habitManager)) {
      return "ignored";
    }

    // Daily note missing handling
    if (!hasNote) {
      if (settings?.streakBreakOnMissing) {
        return "uncompleted";
      }
      return "ignored";
    }

    // Scan failure / unreadable note handling
    if (scannedEntries === null) {
      return "unknown";
    }

    // Entry matching
    const entry = scannedEntries ? findHabitEntry(scannedEntries, habit.linkText, habit.nameHistory, habit.id) : null;

    if (!entry) {
      if (habit.createdAt && date.clone().startOf("day").isBefore(moment(habit.createdAt).startOf("day"))) {
        return "ignored";
      }
      return "uncompleted";
    }

    if (entry.skipped) {
      return "skipped";
    }
    if (entry.completed) {
      return "completed";
    }
    return "uncompleted";
  }

  /**
   * Core aggregation algorithm.
   * Strictly READ-ONLY.
   * 
   * @param {Object} params
   * @param {Array} params.habits - Active habits list
   * @param {moment.Moment} params.startDate
   * @param {moment.Moment} params.endDate
   * @param {Function} params.noteContentProvider - async (dateKey, dateMoment) => { hasNote: boolean, scanned: Array }
   * @param {Object} params.settings
   * @param {Object} [params.habitManager]
   * @param {moment.Moment} [params.todayAnchor]
   */
  async aggregate(params) {
    const {
      habits = [],
      startDate,
      endDate,
      noteContentProvider,
      settings = {},
      habitManager = null,
      todayAnchor = moment().startOf("day"),
    } = params;

    const dailyStats = new Map(); // dateKey -> { date, dateKey, totalScheduled, completed, skipped, rate }
    const habitStats = new Map(); // habitId -> { id, name, habitType, scheduledCount, completedCount, skippedCount, rate }
    const weekdayStats = Array.from({ length: 7 }, (_, i) => ({
      dayIndex: i,
      scheduled: 0,
      completed: 0,
      rate: 0,
      daysCount: 0,
    }));

    // Initialize habit statistics containers
    for (const habit of habits) {
      habitStats.set(habit.id, {
        id: habit.id,
        name: (habit.name || habit.linkText || "عادات").replace(/\[\[|\]\]/g, ""),
        habitType: habit.habitType || "build",
        scheduledCount: 0,
        completedCount: 0,
        skippedCount: 0,
        unknownCount: 0,
        rate: 0,
        dailyHistory: [], // array of { dateKey, status }
      });
    }

    // Iterate day by day from startDate to endDate
    const currentDay = startDate.clone().startOf("day");
    const endLimit = endDate.clone().startOf("day");

    let totalScheduledSum = 0;
    let totalCompletedSum = 0;
    let totalSkippedSum = 0;
    let activeDaysCount = 0;
    let perfectDaysCount = 0;
    let lowDaysCount = 0; // days with rate < 50%
    let degradedDaysCount = 0;

    while (currentDay.isSameOrBefore(endLimit)) {
      // NEVER count future days in calculations
      if (currentDay.isAfter(todayAnchor)) {
        break;
      }

      const dateKey = DateUtils.formatDateKey(currentDay);
      const dayOfWeek = currentDay.day();

      // Retrieve content from in-memory cache or async provider
      let dayData = this.dayCache.get(dateKey);
      if (!dayData && typeof noteContentProvider === "function") {
        const cacheGeneration = this.cacheGeneration;
        dayData = await noteContentProvider(dateKey, currentDay);
        if (dayData && cacheGeneration === this.cacheGeneration) {
          this.dayCache.set(dateKey, dayData);
        }
      }

      const hasNote = dayData ? !!dayData.hasNote : false;
      const scanned = dayData ? (dayData.scanned ?? null) : null;

      let dayScheduled = 0;
      let dayCompleted = 0;
      let daySkipped = 0;
      let dayUnknown = 0;

      for (const habit of habits) {
        const status = this.resolveHabitStatus(habit, currentDay, scanned, hasNote, settings, habitManager);

        const hStat = habitStats.get(habit.id);
        if (hStat) {
          hStat.dailyHistory.push({ dateKey, status });
        }

        if (status === "ignored") {
          continue;
        }

        if (status === "unknown") {
          dayUnknown++;
          if (hStat) hStat.unknownCount = (hStat.unknownCount || 0) + 1;
          continue;
        }

        if (status === "skipped") {
          daySkipped++;
          if (hStat) hStat.skippedCount++;
          continue;
        }

        // Both completed and uncompleted count toward scheduled instances
        dayScheduled++;
        if (hStat) hStat.scheduledCount++;

        if (status === "completed") {
          dayCompleted++;
          if (hStat) hStat.completedCount++;
        }
      }

      const dayRate = dayScheduled > 0 ? Math.round((dayCompleted / dayScheduled) * 100) : 0;
      const isDayDegraded = dayUnknown > 0 || (hasNote && scanned === null) || Boolean(dayData?.isDegraded);
      if (isDayDegraded) degradedDaysCount++;

      dailyStats.set(dateKey, {
        date: currentDay.clone(),
        dateKey,
        dayOfWeek,
        scheduled: dayScheduled,
        total: dayScheduled,
        completed: dayCompleted,
        skipped: daySkipped,
        unknown: dayUnknown,
        dayUnknown: dayUnknown > 0,
        rate: dayRate,
        hasNote,
        isDegraded: isDayDegraded,
      });

      if (dayCompleted > 0) {
        activeDaysCount++;
      }

      if (dayScheduled > 0) {
        totalScheduledSum += dayScheduled;
        totalCompletedSum += dayCompleted;
        totalSkippedSum += daySkipped;

        weekdayStats[dayOfWeek].scheduled += dayScheduled;
        weekdayStats[dayOfWeek].completed += dayCompleted;
        weekdayStats[dayOfWeek].daysCount += 1;

        if (dayRate === 100) perfectDaysCount++;
        if (dayRate < 50) lowDaysCount++;
      }

      currentDay.add(1, "days");
    }

    // Finalize habit rates
    for (const hStat of habitStats.values()) {
      if (hStat.scheduledCount > 0) {
        hStat.rate = Math.round((hStat.completedCount / hStat.scheduledCount) * 100);
      } else {
        hStat.rate = null; // not scheduled in this period
      }
    }

    // Finalize weekday rates
    for (const wStat of weekdayStats) {
      if (wStat.scheduled > 0) {
        wStat.rate = Math.round((wStat.completed / wStat.scheduled) * 100);
      } else {
        wStat.rate = 0;
      }
    }

    const overallConsistencyRate = totalScheduledSum > 0
      ? Math.round((totalCompletedSum / totalScheduledSum) * 100)
      : 0;

    return {
      startDate: startDate.clone(),
      endDate: endDate.clone(),
      dailyStats,
      habitStats,
      weekdayStats,
      isDegraded: degradedDaysCount > 0,
      degradedDaysCount,
      summary: {
        totalScheduled: totalScheduledSum,
        totalCompleted: totalCompletedSum,
        totalSkipped: totalSkippedSum,
        consistencyRate: overallConsistencyRate,
        activeDaysCount,
        perfectDaysCount,
        lowDaysCount,
        degradedDaysCount,
        isDegraded: degradedDaysCount > 0,
      },
    };
  }
}
