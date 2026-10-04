const moment = window.moment || globalThis.moment;
import { PERIOD_TYPES } from './StatsPeriod.js';
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export class MetricsCalculator {
  /**
   * Computes comprehensive, mathematically sound metrics from period aggregations.
   * 
   * @param {Object} currentAggregation - Result from HabitAggregator.aggregate()
   * @param {Object} [previousAggregation] - Result from HabitAggregator.aggregate() for equivalent prior period
   * @param {number} [weekStartDay=6] - Default Saturday (6)
   * @param {Object} [period=null] - StatsPeriod instance for period-aware buckets
   */
  static compute(currentAggregation, previousAggregation = null, weekStartDay = 6, period = null) {
    const currSummary = currentAggregation?.summary || {
      totalScheduled: 0,
      totalCompleted: 0,
      totalSkipped: 0,
      consistencyRate: 0,
      activeDaysCount: 0,
      perfectDaysCount: 0,
      lowDaysCount: 0,
    };

    const hasSufficientData = currSummary.totalScheduled >= 5;

    // 1. Fair Period-over-Period Delta
    let delta = null;
    let deltaType = "neutral";
    if (hasSufficientData && previousAggregation && previousAggregation.summary.totalScheduled >= 5) {
      const prevRate = previousAggregation.summary.consistencyRate;
      delta = currSummary.consistencyRate - prevRate;
      if (delta > 0) deltaType = "positive";
      else if (delta < 0) deltaType = "negative";
    }

    // 2. Weekday Rhythm Analysis
    const rawWeekdays = currentAggregation?.weekdayStats || [];
    const orderedWeekdays = [];
    let maxRate = -1;
    let minRate = 101;
    let validWeekdayCount = 0;

    for (let i = 0; i < 7; i++) {
      const dayIdx = (weekStartDay + i) % 7;
      const stat = rawWeekdays[dayIdx] || { dayIndex: dayIdx, scheduled: 0, completed: 0, rate: 0, daysCount: 0 };
      orderedWeekdays.push({ ...stat });

      if (stat.scheduled > 0) {
        validWeekdayCount++;
        if (stat.rate > maxRate) maxRate = stat.rate;
        if (stat.rate < minRate) minRate = stat.rate;
      }
    }

    // Tag peak and lowest day only if meaningful variance exists (difference >= 10%)
    const hasMeaningfulVariance = (maxRate - minRate) >= 10 && validWeekdayCount >= 3;
    for (const w of orderedWeekdays) {
      w.isPeak = hasMeaningfulVariance && w.scheduled > 0 && w.rate === maxRate;
      w.isLow = hasMeaningfulVariance && w.scheduled > 0 && w.rate === minRate;
    }

    // 3. Habit Diagnostics (Anchor vs Needs Attention)
    const habitList = Array.from(currentAggregation?.habitStats?.values() || []);
    const measuredDaysCount = currentAggregation?.dailyStats?.size || 0;
    
    // Minimum threshold of scheduled occurrences (at least 3) to prevent small sample distortion
    const minSample = Math.max(3, Math.min(5, Math.floor((currSummary.activeDaysCount || 0) * 0.1)));

    const qualifiedHabits = habitList.filter(h => (h.scheduledCount || 0) >= minSample && h.rate !== null);
    
    // Sort descending for anchors, ascending for needs attention
    const anchorHabits = qualifiedHabits
      .filter(h => h.rate >= 75)
      .sort((a, b) => b.rate - a.rate || b.scheduledCount - a.scheduledCount);

    const needsAttentionHabits = qualifiedHabits
      .filter(h => h.rate < 50)
      .sort((a, b) => a.rate - b.rate || b.scheduledCount - a.scheduledCount);

    // Guaranteed top and lowest habits for high-signal metric cards
    const allScheduledHabits = habitList.filter(h => (h.scheduledCount || 0) > 0 && h.rate !== null);
    const topHabit = anchorHabits[0] || (allScheduledHabits.length > 0 ? [...allScheduledHabits].sort((a, b) => b.rate - a.rate)[0] : null);
    const lowestHabit = needsAttentionHabits[0] || (allScheduledHabits.length > 0 ? [...allScheduledHabits].sort((a, b) => a.rate - b.rate)[0] : null);

    // 4. Daily Average
    const dailyAverage = currSummary.activeDaysCount > 0
      ? parseFloat((currSummary.totalCompleted / currSummary.activeDaysCount).toFixed(1))
      : 0;

    const peakDay = hasMeaningfulVariance ? orderedWeekdays.find(w => w.isPeak) : null;
    const lowDay = hasMeaningfulVariance ? orderedWeekdays.find(w => w.isLow) : null;

    // 5. Daily Series
    const sortedDailyStats = Array.from(currentAggregation?.dailyStats?.values() || [])
      .filter(d => d.scheduled > 0)
      .sort((a, b) => a.date.valueOf() - b.date.valueOf());

    const dailySeries = sortedDailyStats.map(d => ({
      dateKey: d.dateKey,
      date: d.date,
      rate: d.rate,
      completed: d.completed,
      scheduled: d.scheduled,
      dayOfWeek: d.dayOfWeek,
    }));

    // 6. Calculate Longest Streak in Period (consecutive active days with completed > 0)
    let periodStreak = 0;
    let currentStreak = 0;
    const today = moment ? moment().startOf("day") : null;

    if (period && period.startDate && period.endDate) {
      const pStart = period.startDate.clone().startOf("day");
      const pEnd = (period.nominalEndDate || period.endDate).clone().startOf("day");
      const effectiveEnd = today && today.isBefore(pEnd) ? today : pEnd;

      let iter = pStart.clone();
      while (iter.isSameOrBefore(effectiveEnd, "day")) {
        const dKey = iter.format("YYYY-MM-DD");
        const dayStat = currentAggregation?.dailyStats?.get(dKey);
        if (dayStat && dayStat.completed > 0) {
          currentStreak++;
          if (currentStreak > periodStreak) {
            periodStreak = currentStreak;
          }
        } else {
          currentStreak = 0;
        }
        iter.add(1, "day");
      }
    } else {
      for (const d of sortedDailyStats) {
        if (d.completed > 0) {
          currentStreak++;
          if (currentStreak > periodStreak) periodStreak = currentStreak;
        } else {
          currentStreak = 0;
        }
      }
    }

    // 7. Period-Aware Trajectory Buckets (Natural Grains)
    const trajectoryBuckets = [];
    const periodType = period?.type;
    let trajectoryGrain;

    const totalPeriodDays = period && period.startDate && period.endDate
      ? Math.abs(period.endDate.diff(period.startDate, "days")) + 1
      : sortedDailyStats.length;

    const nominalDays = period && period.nominalEndDate && period.startDate
      ? Math.abs(period.nominalEndDate.diff(period.startDate, "days")) + 1
      : totalPeriodDays;

    if (periodType === PERIOD_TYPES.LAST_7_DAYS || nominalDays <= 7) {
      trajectoryGrain = "daily";
      const startDay = (period ? period.startDate : (sortedDailyStats[0]?.date || moment())).clone().startOf("day");
      const count = nominalDays > 0 ? Math.min(nominalDays, 7) : 7;

      for (let i = 0; i < count; i++) {
        const dayDate = startDay.clone().add(i, "days");
        const dateKey = dayDate.format("YYYY-MM-DD");
        const stat = currentAggregation?.dailyStats?.get(dateKey);
        const isFuture = today ? dayDate.isAfter(today, "day") : false;
        const isToday = today ? dayDate.isSame(today, "day") : false;

        trajectoryBuckets.push({
          date: dayDate,
          label: dayDate.format("D MMM"),
          shortLabel: dayDate.format("D"),
          dayIndex: dayDate.day(),
          dayKey: DAY_KEYS[dayDate.day()],
          rate: stat && stat.scheduled > 0 ? stat.rate : 0,
          completed: stat ? stat.completed : 0,
          scheduled: stat ? stat.scheduled : 0,
          isFuture,
          isToday,
        });
      }
    } else if (periodType === PERIOD_TYPES.LAST_28_DAYS || (nominalDays >= 25 && nominalDays <= 35)) {
      trajectoryGrain = "weekly";
      const cycleStart = (period ? period.startDate : (sortedDailyStats[0]?.date || moment())).clone().startOf("day");

      // Exactly 4 complete 7-day weeks (28 days total)
      for (let w = 0; w < 4; w++) {
        const wStartDate = cycleStart.clone().add(w * 7, "days");
        const wEndDate = wStartDate.clone().add(6, "days");
        const isFuture = today ? wStartDate.isAfter(today, "day") : false;
        const isToday = today ? today.isSameOrAfter(wStartDate, "day") && today.isSameOrBefore(wEndDate, "day") : false;

        let wCompleted = 0;
        let wScheduled = 0;

        if (currentAggregation?.dailyStats) {
          for (const d of currentAggregation.dailyStats.values()) {
            if (d.date.isSameOrAfter(wStartDate, "day") && d.date.isSameOrBefore(wEndDate, "day")) {
              wCompleted += d.completed;
              wScheduled += d.scheduled;
            }
          }
        }

        const wRate = wScheduled > 0 ? Math.round((wCompleted / wScheduled) * 100) : 0;

        trajectoryBuckets.push({
          weekIndex: w + 1,
          startDate: wStartDate,
          endDate: wEndDate,
          label: `${wStartDate.format("D MMM")} – ${wEndDate.format("D MMM")}`,
          shortLabel: `W${w + 1}`,
          rate: wRate,
          completed: wCompleted,
          scheduled: wScheduled,
          isFuture,
          isToday,
        });
      }
    } else if (periodType === PERIOD_TYPES.LAST_12_WEEKS || (nominalDays > 35 && nominalDays <= 90)) {
      trajectoryGrain = "weekly";
      const cycleStart = (period ? period.startDate : (sortedDailyStats[0]?.date || moment())).clone().startOf("day");

      // 12 weeks (84 days total)
      for (let w = 0; w < 12; w++) {
        const wStartDate = cycleStart.clone().add(w * 7, "days");
        const wEndDate = wStartDate.clone().add(6, "days");
        const isFuture = today ? wStartDate.isAfter(today, "day") : false;
        const isToday = today ? today.isSameOrAfter(wStartDate, "day") && today.isSameOrBefore(wEndDate, "day") : false;

        let wCompleted = 0;
        let wScheduled = 0;

        if (currentAggregation?.dailyStats) {
          for (const d of currentAggregation.dailyStats.values()) {
            if (d.date.isSameOrAfter(wStartDate, "day") && d.date.isSameOrBefore(wEndDate, "day")) {
              wCompleted += d.completed;
              wScheduled += d.scheduled;
            }
          }
        }

        const wRate = wScheduled > 0 ? Math.round((wCompleted / wScheduled) * 100) : 0;

        trajectoryBuckets.push({
          weekIndex: w + 1,
          startDate: wStartDate,
          endDate: wEndDate,
          label: `${wStartDate.format("D MMM")} – ${wEndDate.format("D MMM")}`,
          shortLabel: `W${w + 1}`,
          rate: wRate,
          completed: wCompleted,
          scheduled: wScheduled,
          isFuture,
          isToday,
        });
      }
    } else if (periodType === PERIOD_TYPES.THIS_YEAR || nominalDays > 120) {
      trajectoryGrain = "monthly";
      const yearStart = (period ? period.startDate : moment()).clone().startOf("year");
      const currentMonth = today ? today.month() : -1;
      const currentYear = today ? today.year() : -1;
      const isCurrentYear = yearStart.year() === currentYear;

      for (let m = 0; m < 12; m++) {
        const monthDate = yearStart.clone().month(m).startOf("month");
        const isFutureMonth = isCurrentYear && m > currentMonth;
        const isCurrentMonth = isCurrentYear && m === currentMonth;

        let mCompleted = 0;
        let mScheduled = 0;

        if (currentAggregation?.dailyStats) {
          for (const d of currentAggregation.dailyStats.values()) {
            if (d.date.year() === yearStart.year() && d.date.month() === m) {
              mCompleted += d.completed;
              mScheduled += d.scheduled;
            }
          }
        }

        const mRate = mScheduled > 0 ? Math.round((mCompleted / mScheduled) * 100) : 0;

        trajectoryBuckets.push({
          date: monthDate,
          monthIndex: m,
          label: monthDate.format("MMMM YYYY"),
          shortLabel: monthDate.format("MMM"),
          rate: mRate,
          completed: mCompleted,
          scheduled: mScheduled,
          isFuture: isFutureMonth,
          isToday: isCurrentMonth,
        });
      }
    } else {
      // Natural Calendar Months for intermediate periods
      trajectoryGrain = "monthly";
      const pStart = (period ? period.startDate : (sortedDailyStats[0]?.date || moment())).clone().startOf("day");
      const pEnd = (period ? period.endDate : (sortedDailyStats[sortedDailyStats.length - 1]?.date || moment())).clone().startOf("day");

      let currentCursor = pStart.clone().startOf("month");
      while (currentCursor.isSameOrBefore(pEnd, "month")) {
        const m = currentCursor.month();
        const y = currentCursor.year();
        const monthStart = currentCursor.clone().startOf("month");
        const monthEnd = currentCursor.clone().endOf("month");

        const effectiveStart = pStart.isAfter(monthStart) ? pStart : monthStart;
        const effectiveEnd = pEnd.isBefore(monthEnd) ? pEnd : monthEnd;

        const isFutureMonth = today ? monthStart.isAfter(today, "month") : false;
        const isCurrentMonth = today ? (today.month() === m && today.year() === y) : false;

        let mCompleted = 0;
        let mScheduled = 0;

        if (currentAggregation?.dailyStats) {
          for (const d of currentAggregation.dailyStats.values()) {
            if (d.date.isSameOrAfter(effectiveStart, "day") && d.date.isSameOrBefore(effectiveEnd, "day")) {
              mCompleted += d.completed;
              mScheduled += d.scheduled;
            }
          }
        }

        const mRate = mScheduled > 0 ? Math.round((mCompleted / mScheduled) * 100) : 0;

        trajectoryBuckets.push({
          date: monthStart,
          monthIndex: m,
          year: y,
          label: monthStart.format("MMMM YYYY"),
          shortLabel: monthStart.format("MMM"),
          rate: mRate,
          completed: mCompleted,
          scheduled: mScheduled,
          isFuture: isFutureMonth,
          isToday: isCurrentMonth,
        });

        currentCursor.add(1, "month");
      }
    }

    return {
      hasSufficientData,
      consistencyRate: currSummary.consistencyRate,
      completionRate: currSummary.consistencyRate,
      totalCompleted: currSummary.totalCompleted,
      totalScheduled: currSummary.totalScheduled,
      trajectoryBuckets,
      trajectoryGrain,
      periodStreak,
      totalSkipped: currSummary.totalSkipped,
      activeDaysCount: currSummary.activeDaysCount,
      measuredDaysCount,
      dailyAverage,
      perfectDaysCount: currSummary.perfectDaysCount,
      lowDaysCount: currSummary.lowDaysCount,
      delta,
      deltaType,
      peakDay,
      lowDay,
      weekdayRhythm: orderedWeekdays,
      anchorHabits,
      needsAttentionHabits,
      topHabit,
      lowestHabit,
      dailySeries,
      allHabits: habitList.sort((a, b) => (b.scheduledCount || 0) - (a.scheduledCount || 0)),
    };
  }
}
