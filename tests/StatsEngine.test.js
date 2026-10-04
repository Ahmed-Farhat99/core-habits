import { describe, it, expect, beforeEach, vi } from "vitest";
import moment from "moment";
import { StatsPeriod, PERIOD_TYPES } from "../src/domain/stats/StatsPeriod.js";
import { HabitAggregator } from "../src/domain/stats/HabitAggregator.js";
import { MetricsCalculator } from "../src/domain/stats/MetricsCalculator.js";
import { InsightsEngine } from "../src/domain/stats/InsightsEngine.js";

describe("Statistics Engine Domain Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T12:00:00Z"));
    window.moment = moment;
  });

  describe("StatsPeriod", () => {
    it("should correctly calculate bounds for LAST_28_DAYS and cap at today", () => {
      const anchor = moment("2026-09-06");
      const period = new StatsPeriod(PERIOD_TYPES.LAST_28_DAYS, { anchorDate: anchor });

      expect(period.startDate.format("YYYY-MM-DD")).toBe("2026-08-10");
      expect(period.endDate.format("YYYY-MM-DD")).toBe("2026-09-06");
      expect(period.nominalEndDate.format("YYYY-MM-DD")).toBe("2026-09-06");
      expect(period.endDate.diff(period.startDate, "days") + 1).toBe(28);
    });

    it("should calculate fair comparison slice for LAST_28_DAYS (exact 28 preceding days)", () => {
      const anchor = moment("2026-09-06");
      const period = new StatsPeriod(PERIOD_TYPES.LAST_28_DAYS, { anchorDate: anchor });
      const comp = period.getComparisonPeriod();

      expect(comp.endDate.format("YYYY-MM-DD")).toBe("2026-08-09");
      expect(comp.startDate.format("YYYY-MM-DD")).toBe("2026-07-13");
      const elapsedDays = period.endDate.diff(period.startDate, "days") + 1;
      const compDays = comp.endDate.diff(comp.startDate, "days") + 1;
      expect(compDays).toBe(28);
      expect(compDays).toBe(elapsedDays);
    });

    it("should shift periods correctly with offset", () => {
      const anchor = moment("2026-09-06");
      const period = new StatsPeriod(PERIOD_TYPES.LAST_28_DAYS, { anchorDate: anchor });
      const prevPeriod = period.shift(-1);

      expect(prevPeriod.startDate.format("YYYY-MM-DD")).toBe("2026-07-13");
      expect(prevPeriod.endDate.format("YYYY-MM-DD")).toBe("2026-08-09");
    });

    it("should generate natural Arabic labels", () => {
      const anchor = moment("2026-09-06");
      const period = new StatsPeriod(PERIOD_TYPES.LAST_28_DAYS, { anchorDate: anchor });
      const label = period.getDisplayLabel(true);
      expect(label).toContain("آخر 28 يوماً");
    });
  });

  describe("HabitAggregator", () => {
    it("does not restore stale daily content after invalidation during a read", async () => {
      const aggregator = new HabitAggregator();
      let finishRead;
      const noteContentProvider = () => new Promise((resolve) => { finishRead = resolve; });
      const calculating = aggregator.aggregate({
        habits: [],
        startDate: moment("2026-09-01"),
        endDate: moment("2026-09-01"),
        todayAnchor: moment("2026-09-06"),
        noteContentProvider,
      });
      aggregator.invalidateCache("2026-09-01");
      finishRead({ hasNote: true, scanned: [] });
      await calculating;
      expect(aggregator.dayCache.has("2026-09-01")).toBe(false);
    });

    it("should accurately aggregate daily and habit counts with skipped and missing notes", async () => {
      const aggregator = new HabitAggregator();
      const habits = [
        { id: "h1", name: "Fajr", linkText: "[[Fajr]]", habitType: "build" },
        { id: "h2", name: "Reading", linkText: "[[Reading]]", habitType: "build" },
      ];

      const habitManager = {
        isHabitScheduledForDay: () => true,
      };

      const startDate = moment("2026-09-01");
      const endDate = moment("2026-09-03");

      // Mock daily notes provider:
      // Sep 1: h1 completed, h2 uncompleted
      // Sep 2: h1 completed, h2 skipped
      // Sep 3: no note
      const provider = async (dateKey) => {
        if (dateKey === "2026-09-01") {
          return {
            hasNote: true,
            scanned: [
              { habitId: "h1", completed: true, skipped: false },
              { habitId: "h2", completed: false, skipped: false },
            ],
          };
        }
        if (dateKey === "2026-09-02") {
          return {
            hasNote: true,
            scanned: [
              { habitId: "h1", completed: true, skipped: false },
              { habitId: "h2", completed: false, skipped: true },
            ],
          };
        }
        return { hasNote: false, scanned: [] };
      };

      const result = await aggregator.aggregate({
        habits,
        startDate,
        endDate,
        noteContentProvider: provider,
        settings: { streakBreakOnMissing: false },
        habitManager,
        todayAnchor: moment("2026-09-05"),
      });

      // Sep 1: h1 completed, h2 uncompleted -> scheduled: 2, completed: 1 (50%)
      const day1 = result.dailyStats.get("2026-09-01");
      expect(day1.scheduled).toBe(2);
      expect(day1.completed).toBe(1);
      expect(day1.rate).toBe(50);

      // Sep 2: h1 completed, h2 skipped -> scheduled: 1, completed: 1, skipped: 1 (100%)
      const day2 = result.dailyStats.get("2026-09-02");
      expect(day2.scheduled).toBe(1);
      expect(day2.completed).toBe(1);
      expect(day2.skipped).toBe(1);
      expect(day2.rate).toBe(100);

      // Sep 3: no note & streakBreakOnMissing = false -> scheduled: 0
      const day3 = result.dailyStats.get("2026-09-03");
      expect(day3.scheduled).toBe(0);

      // Summary: total scheduled: 3, completed: 2 -> rate: 67%
      expect(result.summary.totalScheduled).toBe(3);
      expect(result.summary.totalCompleted).toBe(2);
      expect(result.summary.consistencyRate).toBe(67);
    });

    it("should never count future dates beyond todayAnchor", async () => {
      const aggregator = new HabitAggregator();
      const habits = [{ id: "h1", name: "Pray" }];
      const startDate = moment("2026-09-01");
      const endDate = moment("2026-09-10");
      const todayAnchor = moment("2026-09-03");

      const result = await aggregator.aggregate({
        habits,
        startDate,
        endDate,
        noteContentProvider: async () => ({ hasNote: true, scanned: [{ habitId: "h1", completed: true }] }),
        settings: {},
        habitManager: { isHabitScheduledForDay: () => true },
        todayAnchor,
      });

      expect(result.dailyStats.has("2026-09-03")).toBe(true);
      expect(result.dailyStats.has("2026-09-04")).toBe(false);
    });

    it("should handle daily vs weekly habit schedules accurately", async () => {
      const aggregator = new HabitAggregator();
      // h1 is daily (all 7 days), h2 is weekly (only Friday = day 5)
      const habits = [
        { id: "h1", name: "Daily Habit" },
        { id: "h2", name: "Weekly Habit" },
      ];

      const habitManager = {
        isHabitScheduledForDay: (habit, dayOfWeek) => {
          if (habit.id === "h1") return true;
          return dayOfWeek === 5; // only Friday
        },
      };

      // 7 days: Sep 1 (Tuesday = 2) to Sep 7 (Monday = 1)
      // Friday is Sep 4 (day 5)
      const startDate = moment("2026-09-01");
      const endDate = moment("2026-09-07");

      const provider = async (dateKey) => ({
        hasNote: true,
        scanned: [
          { habitId: "h1", completed: true },
          { habitId: "h2", completed: dateKey === "2026-09-04" },
        ],
      });

      const result = await aggregator.aggregate({
        habits,
        startDate,
        endDate,
        noteContentProvider: provider,
        settings: {},
        habitManager,
        todayAnchor: moment("2026-09-10"),
      });

      const h1Stat = result.habitStats.get("h1");
      const h2Stat = result.habitStats.get("h2");

      expect(h1Stat.scheduledCount).toBe(7);
      expect(h1Stat.completedCount).toBe(7);
      expect(h1Stat.rate).toBe(100);

      expect(h2Stat.scheduledCount).toBe(1);
      expect(h2Stat.completedCount).toBe(1);
      expect(h2Stat.rate).toBe(100);

      // Total scheduled should be 7 + 1 = 8
      expect(result.summary.totalScheduled).toBe(8);
      expect(result.summary.totalCompleted).toBe(8);
    });

    it("should correctly aggregate without requiring habitManager (pure domain execution via HabitEntity)", async () => {
      const aggregator = new HabitAggregator();
      // h1 is daily (all 7 days), h2 is weekly (only Friday = day 5)
      const habits = [
        { id: "h1", name: "Daily Habit", schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] } },
        { id: "h2", name: "Weekly Habit", schedule: { type: "weekly", days: [5] } },
      ];

      // 7 days: Sep 1 (Tuesday = 2) to Sep 7 (Monday = 1)
      // Friday is Sep 4 (day 5)
      const startDate = moment("2026-09-01");
      const endDate = moment("2026-09-07");

      const provider = async (dateKey) => ({
        hasNote: true,
        scanned: [
          { habitId: "h1", completed: true },
          { habitId: "h2", completed: dateKey === "2026-09-04" },
        ],
      });

      // NOTICE: habitManager is completely omitted!
      const result = await aggregator.aggregate({
        habits,
        startDate,
        endDate,
        noteContentProvider: provider,
        settings: {},
        todayAnchor: moment("2026-09-10"),
      });

      const h1Stat = result.habitStats.get("h1");
      const h2Stat = result.habitStats.get("h2");

      expect(h1Stat.scheduledCount).toBe(7);
      expect(h1Stat.completedCount).toBe(7);
      expect(h1Stat.rate).toBe(100);

      expect(h2Stat.scheduledCount).toBe(1);
      expect(h2Stat.completedCount).toBe(1);
      expect(h2Stat.rate).toBe(100);

      expect(result.summary.totalScheduled).toBe(8);
      expect(result.summary.totalCompleted).toBe(8);
    });

    it("should ignore days before createdAt for newly created habits", async () => {
      const aggregator = new HabitAggregator();
      // h1 created on Sep 03
      const habits = [
        { id: "h1", name: "New Habit", createdAt: "2026-09-03" },
      ];

      const startDate = moment("2026-09-01");
      const endDate = moment("2026-09-04");

      const provider = async () => ({
        hasNote: true,
        scanned: [], // no entry
      });

      const result = await aggregator.aggregate({
        habits,
        startDate,
        endDate,
        noteContentProvider: provider,
        settings: {},
        habitManager: { isHabitScheduledForDay: () => true },
        todayAnchor: moment("2026-09-10"),
      });

      const h1Stat = result.habitStats.get("h1");
      // Days 1 and 2 are before createdAt, so only days 3 and 4 count
      expect(h1Stat.scheduledCount).toBe(2);
      expect(h1Stat.completedCount).toBe(0);
    });

    it("should ignore days in archived range", async () => {
      const aggregator = new HabitAggregator();
      // Archived on Sep 02, restored on Sep 04
      const habits = [
        { id: "h1", name: "Archived Habit", archivedDate: "2026-09-02", restoredDate: "2026-09-04" },
      ];

      const startDate = moment("2026-09-01");
      const endDate = moment("2026-09-05");

      const provider = async () => ({
        hasNote: true,
        scanned: [{ habitId: "h1", completed: true }],
      });

      const result = await aggregator.aggregate({
        habits,
        startDate,
        endDate,
        noteContentProvider: provider,
        settings: {},
        habitManager: { isHabitScheduledForDay: () => true },
        todayAnchor: moment("2026-09-10"),
      });

      const h1Stat = result.habitStats.get("h1");
      // Sep 01 is active. Sep 02, 03, 04 are archived. Sep 05 is active.
      // Total scheduled should be 2 days (Sep 1 and Sep 5)
      expect(h1Stat.scheduledCount).toBe(2);
      expect(h1Stat.completedCount).toBe(2);
    });
  });

  describe("MetricsCalculator", () => {
    it("should compute fair delta and identify anchor habits with sufficient sample", () => {
      const currentAgg = {
        summary: { totalScheduled: 20, totalCompleted: 16, consistencyRate: 80, activeDaysCount: 10 },
        weekdayStats: [
          { dayIndex: 0, scheduled: 10, completed: 8, rate: 80, daysCount: 2 },
          { dayIndex: 1, scheduled: 10, completed: 6, rate: 60, daysCount: 2 },
          { dayIndex: 6, scheduled: 10, completed: 5, rate: 50, daysCount: 2 },
        ],
        habitStats: new Map([
          ["h1", { id: "h1", name: "Gym", scheduledCount: 10, completedCount: 9, rate: 90 }],
          ["h2", { id: "h2", name: "Read", scheduledCount: 10, completedCount: 3, rate: 30 }],
          ["h3", { id: "h3", name: "Rare", scheduledCount: 1, completedCount: 1, rate: 100 }], // small sample, should not be anchor
        ]),
        dailyStats: new Map(),
      };

      const prevAgg = {
        summary: { totalScheduled: 20, totalCompleted: 14, consistencyRate: 70 },
      };

      const metrics = MetricsCalculator.compute(currentAgg, prevAgg, 6);

      expect(metrics.hasSufficientData).toBe(true);
      expect(metrics.consistencyRate).toBe(80);
      expect(metrics.delta).toBe(10);
      expect(metrics.deltaType).toBe("positive");
      expect(metrics.dailyAverage).toBe(1.6);
      expect(metrics.measuredDaysCount).toBe(0);
      expect(metrics.peakDay).toBeDefined();
      expect(metrics.peakDay.rate).toBe(80);
      expect(metrics.lowDay).toBeDefined();
      expect(metrics.lowDay.rate).toBe(50);

      // h1 should be anchor, h3 should be excluded due to small sample (< 3)
      expect(metrics.anchorHabits.map(h => h.id)).toEqual(["h1"]);
      expect(metrics.needsAttentionHabits.map(h => h.id)).toEqual(["h2"]);
    });

    it("should handle zero-data gracefully without dividing by zero", () => {
      const emptyAgg = { summary: { totalScheduled: 0, totalCompleted: 0, consistencyRate: 0 } };
      const metrics = MetricsCalculator.compute(emptyAgg, null);

      expect(metrics.hasSufficientData).toBe(false);
      expect(metrics.consistencyRate).toBe(0);
      expect(metrics.delta).toBeNull();
    });

    it("withholds a period comparison when the current sample is too small", () => {
      const current = { summary: { totalScheduled: 2, totalCompleted: 0, consistencyRate: 0 } };
      const previous = { summary: { totalScheduled: 20, totalCompleted: 16, consistencyRate: 80 } };
      const metrics = MetricsCalculator.compute(current, previous);

      expect(metrics.hasSufficientData).toBe(false);
      expect(metrics.delta).toBeNull();
    });

    it("should compute period-aware trajectory buckets for LAST_7_DAYS (7 daily buckets)", () => {
      const weekPeriod = new StatsPeriod(PERIOD_TYPES.LAST_7_DAYS, {
        anchorDate: moment("2026-09-06"), // Sunday
      });

      const currentAgg = {
        summary: { totalScheduled: 10, totalCompleted: 8, consistencyRate: 80, activeDaysCount: 2 },
        weekdayStats: [],
        habitStats: new Map(),
        dailyStats: new Map([
          ["2026-09-05", { date: moment("2026-09-05"), scheduled: 5, completed: 4, rate: 80 }],
          ["2026-09-06", { date: moment("2026-09-06"), scheduled: 5, completed: 4, rate: 80 }],
        ]),
      };

      const metrics = MetricsCalculator.compute(currentAgg, null, 6, weekPeriod);

      expect(metrics.trajectoryBuckets.length).toBe(7);
      expect(metrics.trajectoryBuckets[0].dayKey).toBe("mon"); // Aug 31 is Monday
      expect(metrics.trajectoryBuckets[6].dayKey).toBe("sun"); // Sep 06 is Sunday
      expect(metrics.trajectoryBuckets[5].rate).toBe(80); // Sep 05
      expect(metrics.trajectoryBuckets[6].rate).toBe(80); // Sep 06
    });

    it("should compute period-aware trajectory buckets for THIS_YEAR (12 monthly buckets)", () => {
      const yearPeriod = new StatsPeriod(PERIOD_TYPES.THIS_YEAR, {
        anchorDate: moment("2026-09-06"),
      });

      const currentAgg = {
        summary: { totalScheduled: 100, totalCompleted: 80, consistencyRate: 80, activeDaysCount: 50 },
        weekdayStats: [],
        habitStats: new Map(),
        dailyStats: new Map([
          ["2026-01-15", { date: moment("2026-01-15"), scheduled: 20, completed: 18, rate: 90 }],
        ]),
      };

      const metrics = MetricsCalculator.compute(currentAgg, null, 6, yearPeriod);

      expect(metrics.trajectoryBuckets.length).toBe(12);
      expect(metrics.trajectoryBuckets[0].monthIndex).toBe(0);
      expect(metrics.trajectoryBuckets[0].completed).toBe(18);
      expect(metrics.trajectoryBuckets[11].monthIndex).toBe(11);
    });

    it("should correctly identify topHabit and lowestHabit for quick-look cards", () => {
      const currentAgg = {
        summary: { totalScheduled: 20, totalCompleted: 15, consistencyRate: 75, activeDaysCount: 5 },
        weekdayStats: [],
        habitStats: new Map([
          ["h1", { id: "h1", name: "Quran", scheduledCount: 5, completedCount: 5, rate: 100 }],
          ["h2", { id: "h2", name: "Walk", scheduledCount: 5, completedCount: 1, rate: 20 }],
        ]),
        dailyStats: new Map(),
      };

      const metrics = MetricsCalculator.compute(currentAgg, null, 6);

      expect(metrics.topHabit).toBeDefined();
      expect(metrics.topHabit.name).toBe("Quran");
      expect(metrics.lowestHabit).toBeDefined();
      expect(metrics.lowestHabit.name).toBe("Walk");
    });

    it("should accurately compute periodStreak and trajectoryGrain for long multi-month periods", () => {
      const longPeriod = new StatsPeriod(PERIOD_TYPES.CUSTOM, {
        customStartDate: moment("2026-06-01"),
        customEndDate: moment("2026-09-06"),
      });

      const currentAgg = {
        summary: { totalScheduled: 90, totalCompleted: 45, consistencyRate: 50, activeDaysCount: 15 },
        weekdayStats: [],
        habitStats: new Map(),
        dailyStats: new Map([
          // Streak of 3 days
          ["2026-09-01", { date: moment("2026-09-01"), scheduled: 5, completed: 4, rate: 80 }],
          ["2026-09-02", { date: moment("2026-09-02"), scheduled: 5, completed: 3, rate: 60 }],
          ["2026-09-03", { date: moment("2026-09-03"), scheduled: 5, completed: 5, rate: 100 }],
          // Gap
          ["2026-09-04", { date: moment("2026-09-04"), scheduled: 5, completed: 0, rate: 0 }],
          // Streak of 2 days
          ["2026-09-05", { date: moment("2026-09-05"), scheduled: 5, completed: 4, rate: 80 }],
          ["2026-09-06", { date: moment("2026-09-06"), scheduled: 5, completed: 2, rate: 40 }],
          // Earlier month
          ["2026-07-15", { date: moment("2026-07-15"), scheduled: 5, completed: 5, rate: 100 }],
        ]),
      };

      const metrics = MetricsCalculator.compute(currentAgg, null, 6, longPeriod);

      expect(metrics.periodStreak).toBe(3);
      expect(metrics.trajectoryGrain).toBe("monthly");
      // June 1 to Sep 6 spans 4 calendar months (June, July, August, September)
      expect(metrics.trajectoryBuckets.length).toBe(4);
      // Verify no slash date ranges in labels
      for (const b of metrics.trajectoryBuckets) {
        expect(b.label).not.toContain("/");
        expect(typeof b.monthIndex).toBe("number");
      }
    });

    it("should compute weekly trajectory buckets for LAST_28_DAYS with exactly 4 complete weeks", () => {
      const monthPeriod = new StatsPeriod(PERIOD_TYPES.LAST_28_DAYS, {
        anchorDate: moment("2026-09-06"),
      });

      const currentAgg = {
        summary: { totalScheduled: 30, totalCompleted: 20, consistencyRate: 67, activeDaysCount: 6 },
        weekdayStats: [],
        habitStats: new Map(),
        dailyStats: new Map([
          ["2026-09-02", { date: moment("2026-09-02"), scheduled: 5, completed: 4, rate: 80 }],
        ]),
      };

      const metrics = MetricsCalculator.compute(currentAgg, null, 6, monthPeriod);

      expect(metrics.trajectoryGrain).toBe("weekly");
      expect(metrics.trajectoryBuckets.length).toBe(4); // Exactly 4 weeks, NO 5th week!
      expect(metrics.trajectoryBuckets[0].weekIndex).toBe(1);
      expect(metrics.trajectoryBuckets[3].weekIndex).toBe(4);
      expect(metrics.trajectoryBuckets[3].completed).toBe(4); // Sep 02 is in Week 4
    });

    it("should compute 12 weekly trajectory buckets for LAST_12_WEEKS (84 days)", () => {
      const twelveWeeksPeriod = new StatsPeriod(PERIOD_TYPES.LAST_12_WEEKS, {
        anchorDate: moment("2026-09-06"),
      });

      const currentAgg = {
        summary: { totalScheduled: 60, totalCompleted: 40, consistencyRate: 67, activeDaysCount: 12 },
        weekdayStats: [],
        habitStats: new Map(),
        dailyStats: new Map(),
      };

      const metrics = MetricsCalculator.compute(currentAgg, null, 6, twelveWeeksPeriod);

      expect(metrics.trajectoryGrain).toBe("weekly");
      expect(metrics.trajectoryBuckets.length).toBe(12); // Exactly 12 weeks
      expect(metrics.trajectoryBuckets[0].weekIndex).toBe(1);
      expect(metrics.trajectoryBuckets[11].weekIndex).toBe(12);
    });
  });

  describe("InsightsEngine", () => {
    it("should generate grounded, deterministic insights for positive trends", () => {
      const metrics = {
        hasSufficientData: true,
        consistencyRate: 85,
        delta: 12,
        deltaType: "positive",
        totalCompleted: 34,
        activeDaysCount: 14,
        anchorHabits: [{ id: "h1", name: "صلاة الفجر", rate: 95 }],
        needsAttentionHabits: [{ id: "h2", name: "القراءة", rate: 30 }],
        weekdayRhythm: [
          { dayIndex: 0, rate: 90, isPeak: true },
          { dayIndex: 5, rate: 45, isLow: true },
        ],
        bounceBackRate: 75,
      };

      const insights = InsightsEngine.generate(metrics, {
        isAr: true,
        t: (k) => k,
      });

      expect(insights.primaryInsight).toContain("12 نقطة مئوية");
      expect(insights.secondaryInsights.some(s => s.type === "anchor")).toBe(true);
      expect(insights.secondaryInsights.some(s => s.type === "attention")).toBe(true);
      expect(insights.secondaryInsights.some(s => s.type === "resilience")).toBe(true);
      expect(insights.recommendations.length).toBeGreaterThan(0);
    });

    it("should return not enough data when sample size is insufficient", () => {
      const metrics = { hasSufficientData: false };
      const insights = InsightsEngine.generate(metrics, { isAr: true });

      expect(insights.primaryInsight).toContain("غير كافية");
    });
  });
});
