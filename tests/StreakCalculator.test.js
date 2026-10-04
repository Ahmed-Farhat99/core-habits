import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { StreakCalculator } from "../src/services/StreakCalculator.js";
import { StatsService } from "../src/services/StatsService.js";
import { getNoteByDate } from "../src/utils/helpers.js";

vi.mock("../src/utils/helpers.js", async () => {
  const actual = await vi.importActual("../src/utils/helpers.js");
  return {
    ...actual,
    getNoteByDate: vi.fn()
  };
});

describe("StreakCalculator Tests", () => {
  let mockPlugin;
  let calculator;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T12:00:00Z"));

    mockPlugin = {
      settings: {
        marker: "[habit:: true]",
        streakBreakOnMissing: false // default
      },
      habitManager: {
        isHabitScheduledForDay: () => true // always scheduled
      },
      habitScanner: {
        scan: (content) => {
          if (content.includes("completed")) {
            return [{ completed: true, skipped: false, text: "Habit Name", habitId: "habit-1" }];
          }
          return [{ completed: false, skipped: false, text: "Habit Name", habitId: "habit-1" }];
        }
      },
      translationManager: {
        t: (k) => k
      },
      app: {
        vault: {
          cachedRead: async (file) => file.content,
          read: async (file) => file.content
        }
      }
    };

    mockPlugin.statsService = new StatsService(mockPlugin);
    calculator = new StreakCalculator(mockPlugin);
    StreakCalculator.invalidateAll();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should ignore missing notes by default (streakBreakOnMissing = false)", async () => {
    const habit = {
      id: "habit-1",
      name: "Habit Name",
      linkText: "[[Habit Name]]",
      savedLongestStreak: 0,
      archived: false
    };

    // Day 0: completed, Day 1: missing note, Day 2: completed
    const day0File = { path: "2026-06-21.md", content: "completed" };
    const day2File = { path: "2026-06-19.md", content: "completed" };

    vi.mocked(getNoteByDate).mockImplementation(async (app, date) => {
      const dateStr = date.locale("en").format("YYYY-MM-DD");
      if (dateStr === "2026-06-21") return day0File;
      if (dateStr === "2026-06-19") return day2File;
      return null; // Missing note for 2026-06-20
    });

    const stats = await calculator.calculate(habit);
    // Since missing note is ignored, Day 0 and Day 2 completions form a continuous streak of 2!
    expect(stats.currentStreak).toBe(2);
    expect(stats.longestStreak).toBe(2);
  });

  it("should break the streak on missing notes if streakBreakOnMissing = true", async () => {
    mockPlugin.settings.streakBreakOnMissing = true;

    const habit = {
      id: "habit-1",
      name: "Habit Name",
      linkText: "[[Habit Name]]",
      savedLongestStreak: 0,
      archived: false
    };

    // Day 0: completed, Day 1: missing note, Day 2: completed
    const day0File = { path: "2026-06-21.md", content: "completed" };
    const day2File = { path: "2026-06-19.md", content: "completed" };

    vi.mocked(getNoteByDate).mockImplementation(async (app, date) => {
      const dateStr = date.locale("en").format("YYYY-MM-DD");
      if (dateStr === "2026-06-21") return day0File;
      if (dateStr === "2026-06-19") return day2File;
      return null;
    });

    const stats = await calculator.calculate(habit);
    // Since missing note breaks the streak, the streak is broken at Day 1, so current streak is 1 (only Day 0)
    expect(stats.currentStreak).toBe(1);
    expect(stats.longestStreak).toBe(1);
  });

  it("should skip archived periods in streak calculations", async () => {
    const today = window.moment();
    const archivedDate = today.clone().subtract(4, "days").valueOf();
    const restoredDate = today.clone().subtract(2, "days").valueOf();

    const habit = {
      id: "habit-1",
      name: "Habit Name",
      linkText: "[[Habit Name]]",
      savedLongestStreak: 0,
      archived: false,
      archivedDate,
      restoredDate
    };

    const day0File = { path: "day0.md", content: "completed" };
    const day1File = { path: "day1.md", content: "completed" };
    const day3File = { path: "day3.md", content: "" };
    const day5File = { path: "day5.md", content: "completed" };
    const day6File = { path: "day6.md", content: "completed" };

    vi.mocked(getNoteByDate).mockImplementation(async (app, date) => {
      const dateStr = date.locale("en").format("YYYY-MM-DD");
      const d0 = today.clone().format("YYYY-MM-DD");
      const d1 = today.clone().subtract(1, "days").format("YYYY-MM-DD");
      const d3 = today.clone().subtract(3, "days").format("YYYY-MM-DD");
      const d5 = today.clone().subtract(5, "days").format("YYYY-MM-DD");
      const d6 = today.clone().subtract(6, "days").format("YYYY-MM-DD");

      if (dateStr === d0) return day0File;
      if (dateStr === d1) return day1File;
      if (dateStr === d3) return day3File;
      if (dateStr === d5) return day5File;
      if (dateStr === d6) return day6File;
      return null;
    });

    const stats = await calculator.calculate(habit);
    // Since Days 2, 3, and 4 are within the archived range, they are skipped.
    // Days 0, 1, 5, 6 completions form a continuous streak of 4!
    expect(stats.currentStreak).toBe(4);
    expect(stats.longestStreak).toBe(4);
  });

  describe("StreakCalculator Caching & Deduplication", () => {
    it("should deduplicate concurrent in-flight calculations for the same habit", async () => {
      const habit = { id: "habit-1", name: "Habit Name", savedLongestStreak: 5 };
      const calc1 = new StreakCalculator(mockPlugin);
      const calc2 = new StreakCalculator(mockPlugin);

      const promise1 = calc1.calculate(habit);
      const promise2 = calc2.calculate(habit);

      const [res1, res2] = await Promise.all([promise1, promise2]);

      expect(res1).toEqual(res2);
      expect(res1.currentStreak).toBeDefined();
    });

    it("should cache daily note content and avoid duplicate vault reads across multiple habits", async () => {
      const dailyNoteFile = { path: "2026-06-21.md", content: "completed" };
      vi.mocked(getNoteByDate).mockResolvedValue(dailyNoteFile);
      const readSpy = vi.spyOn(mockPlugin.app.vault, "read");
      const cachedReadSpy = vi.spyOn(mockPlugin.app.vault, "cachedRead");

      const habitA = { id: "habit-a", name: "Reading" };
      const habitB = { id: "habit-b", name: "Workout" };

      const calc = new StreakCalculator(mockPlugin);
      await calc.calculate(habitA);
      const readCallsAfterHabitA = readSpy.mock.calls.length + cachedReadSpy.mock.calls.length;

      // Calculate for habit B
      await calc.calculate(habitB);
      const readCallsAfterHabitB = readSpy.mock.calls.length + cachedReadSpy.mock.calls.length;

      // All dates should have been served from static #dailyNotesCache, so no extra disk reads
      expect(readCallsAfterHabitB).toBe(readCallsAfterHabitA);
    });

    it("should purge cached daily note when invalidateDailyNote is called", async () => {
      const dailyNoteFile = { path: "2026-06-21.md", content: "completed" };
      vi.mocked(getNoteByDate).mockResolvedValue(dailyNoteFile);
      const readSpy = vi.spyOn(mockPlugin.app.vault, "read");
      const cachedReadSpy = vi.spyOn(mockPlugin.app.vault, "cachedRead");

      const habit = { id: "habit-1", name: "Habit Name" };
      const calc = new StreakCalculator(mockPlugin);
      await calc.calculate(habit);

      const initialReads = readSpy.mock.calls.length + cachedReadSpy.mock.calls.length;

      StreakCalculator.invalidateDailyNote("2026-06-21");
      await calc.calculate(habit);

      const afterInvalidateReads = readSpy.mock.calls.length + cachedReadSpy.mock.calls.length;
      expect(afterInvalidateReads).toBeGreaterThan(initialReads);
    });
  });

  describe("Trend & Previous Consistency Calculation", () => {
    it("should calculate 'up' trend when consistency increases by >= 5%", async () => {
      const today = window.moment();
      const habit = {
        id: "habit-1",
        name: "Habit Name",
        linkText: "[[Habit Name]]",
        savedLongestStreak: 0,
        archived: false,
        createdAt: today.clone().subtract(90, "days").valueOf()
      };

      // Days 0-27: 22 completed out of 28 = ~79% (rounds to 79)
      // Days 28-55: 14 completed out of 28 = 50%
      // Delta = +29% -> "up"
      vi.mocked(getNoteByDate).mockImplementation(async (app, date) => {
        const diffDays = today.diff(date, "days");
        if (diffDays >= 0 && diffDays < 28) {
          return { content: diffDays < 22 ? "completed" : "" };
        }
        if (diffDays >= 28 && diffDays < 56) {
          return { content: (diffDays - 28) < 14 ? "completed" : "" };
        }
        return null;
      });

      const stats = await calculator.calculate(habit);
      expect(stats.consistencyScore).toBe(79);
      expect(stats.previousConsistencyScore).toBe(50);
      expect(stats.trendDelta).toBe(29);
      expect(stats.trendDirection).toBe("up");
    });

    it("should calculate 'down' trend when consistency decreases by >= 5%", async () => {
      const today = window.moment();
      const habit = {
        id: "habit-1",
        name: "Habit Name",
        linkText: "[[Habit Name]]",
        savedLongestStreak: 0,
        archived: false,
        createdAt: today.clone().subtract(90, "days").valueOf()
      };

      // Days 0-27: 14 completed out of 28 = 50%
      // Days 28-55: 22 completed out of 28 = ~79%
      // Delta = -29% -> "down"
      vi.mocked(getNoteByDate).mockImplementation(async (app, date) => {
        const diffDays = today.diff(date, "days");
        if (diffDays >= 0 && diffDays < 28) {
          return { content: diffDays < 14 ? "completed" : "" };
        }
        if (diffDays >= 28 && diffDays < 56) {
          return { content: (diffDays - 28) < 22 ? "completed" : "" };
        }
        return null;
      });

      const stats = await calculator.calculate(habit);
      expect(stats.consistencyScore).toBe(50);
      expect(stats.previousConsistencyScore).toBe(79);
      expect(stats.trendDelta).toBe(-29);
      expect(stats.trendDirection).toBe("down");
    });

    it("should calculate 'stable' trend when change is within ±5%", async () => {
      const today = window.moment();
      const habit = {
        id: "habit-1",
        name: "Habit Name",
        linkText: "[[Habit Name]]",
        savedLongestStreak: 0,
        archived: false,
        createdAt: today.clone().subtract(90, "days").valueOf()
      };

      // Days 0-27: 20 completed out of 28 = ~71%
      // Days 28-55: 20 completed out of 28 = ~71%
      // Delta = 0% -> "stable"
      vi.mocked(getNoteByDate).mockImplementation(async (app, date) => {
        const diffDays = today.diff(date, "days");
        if (diffDays >= 0 && diffDays < 56) {
          const modDay = diffDays % 28;
          return { content: modDay < 20 ? "completed" : "" };
        }
        return null;
      });

      const stats = await calculator.calculate(habit);
      expect(stats.consistencyScore).toBe(71);
      expect(stats.previousConsistencyScore).toBe(71);
      expect(stats.trendDelta).toBe(0);
      expect(stats.trendDirection).toBe("stable");
    });

    it("should correctly handle threshold boundaries (+5% is up, -5% is down, +4%/-4% is stable)", async () => {
      const today = window.moment();
      const habit = {
        id: "habit-1",
        name: "Habit Name",
        linkText: "[[Habit Name]]",
        savedLongestStreak: 0,
        archived: false,
        createdAt: today.clone().subtract(90, "days").valueOf()
      };

      // Test +5% boundary: 20 scheduled days each (each day = 5%)
      // Current: 11 / 20 = 55%
      // Previous: 10 / 20 = 50%
      // Delta = +5% -> "up"
      vi.mocked(getNoteByDate).mockImplementation(async (app, date) => {
        const diffDays = today.diff(date, "days");
        if (diffDays >= 0 && diffDays < 20) {
          return { content: diffDays < 11 ? "completed" : "" };
        }
        if (diffDays >= 30 && diffDays < 50) {
          return { content: (diffDays - 30) < 10 ? "completed" : "" };
        }
        return null; // Missing notes ignored
      });

      let stats = await calculator.calculate(habit);
      expect(stats.trendDelta).toBe(5);
      expect(stats.trendDirection).toBe("up");

      // Test -5% boundary:
      // Current: 9 / 20 = 45%
      // Previous: 10 / 20 = 50%
      // Delta = -5% -> "down"
      StreakCalculator.invalidateAll();
      vi.mocked(getNoteByDate).mockImplementation(async (app, date) => {
        const diffDays = today.diff(date, "days");
        if (diffDays >= 0 && diffDays < 20) {
          return { content: diffDays < 9 ? "completed" : "" };
        }
        if (diffDays >= 30 && diffDays < 50) {
          return { content: (diffDays - 30) < 10 ? "completed" : "" };
        }
        return null;
      });

      stats = await calculator.calculate(habit);
      expect(stats.trendDelta).toBe(-5);
      expect(stats.trendDirection).toBe("down");

      // Test +4% boundary: 25 scheduled days each (each day = 4%)
      // Current: 13 / 25 = 52%
      // Previous: 12 / 25 = 48%
      // Delta = +4% -> "stable"
      StreakCalculator.invalidateAll();
      vi.mocked(getNoteByDate).mockImplementation(async (app, date) => {
        const diffDays = today.diff(date, "days");
        if (diffDays >= 0 && diffDays < 25) {
          return { content: diffDays < 13 ? "completed" : "" };
        }
        if (diffDays >= 30 && diffDays < 55) {
          return { content: (diffDays - 30) < 12 ? "completed" : "" };
        }
        return null;
      });

      stats = await calculator.calculate(habit);
      expect(stats.trendDelta).toBe(4);
      expect(stats.trendDirection).toBe("stable");

      // Test -4% boundary:
      // Current: 11 / 25 = 44%
      // Previous: 12 / 25 = 48%
      // Delta = -4% -> "stable"
      StreakCalculator.invalidateAll();
      vi.mocked(getNoteByDate).mockImplementation(async (app, date) => {
        const diffDays = today.diff(date, "days");
        if (diffDays >= 0 && diffDays < 25) {
          return { content: diffDays < 11 ? "completed" : "" };
        }
        if (diffDays >= 30 && diffDays < 55) {
          return { content: (diffDays - 30) < 12 ? "completed" : "" };
        }
        return null;
      });

      stats = await calculator.calculate(habit);
      expect(stats.trendDelta).toBe(-4);
      expect(stats.trendDirection).toBe("stable");
    });

    it("should safely return null trend fields for a new habit (< 30 days old)", async () => {
      const today = window.moment();
      const habit = {
        id: "habit-1",
        name: "Habit Name",
        linkText: "[[Habit Name]]",
        savedLongestStreak: 0,
        archived: false,
        createdAt: today.clone().subtract(15, "days").valueOf()
      };

      // Only days 0-14 have notes/entries; older days are before createdAt and return null note
      vi.mocked(getNoteByDate).mockImplementation(async (app, date) => {
        const diffDays = today.diff(date, "days");
        if (diffDays >= 0 && diffDays < 15) {
          return { content: "completed" };
        }
        // Older than 15 days: no note exists
        return null;
      });

      const stats = await calculator.calculate(habit);
      expect(stats.consistencyScore).toBe(100);
      expect(stats.previousConsistencyScore).toBeNull();
      expect(stats.trendDelta).toBeNull();
      expect(stats.trendDirection).toBeNull();
    });

    it("should preserve trend fields in cache", async () => {
      const today = window.moment();
      const habit = {
        id: "habit-1",
        name: "Habit Name",
        linkText: "[[Habit Name]]",
        savedLongestStreak: 0,
        archived: false,
        createdAt: today.clone().subtract(90, "days").valueOf()
      };

      vi.mocked(getNoteByDate).mockImplementation(async (app, date) => {
        const diffDays = today.diff(date, "days");
        if (diffDays >= 0 && diffDays < 60) {
          return { content: "completed" };
        }
        return null;
      });

      const firstResult = await calculator.calculate(habit);
      expect(firstResult.trendDirection).toBe("stable");
      expect(firstResult.trendDelta).toBe(0);

      // Reset mock to ensure second call hits cache
      vi.mocked(getNoteByDate).mockClear();

      const secondResult = await calculator.calculate(habit);
      expect(secondResult).toBe(firstResult);
      expect(secondResult.previousConsistencyScore).toBe(100);
      expect(secondResult.trendDelta).toBe(0);
      expect(secondResult.trendDirection).toBe("stable");
      expect(vi.mocked(getNoteByDate)).not.toHaveBeenCalled();
    });

    it("should include dailyHistory array with 28 days in chronological order", async () => {
      const today = window.moment();
      const habit = {
        id: "habit-1",
        name: "Habit Name",
        linkText: "[[Habit Name]]",
        savedLongestStreak: 0,
        archived: false,
        createdAt: today.clone().subtract(60, "days").valueOf()
      };

      vi.mocked(getNoteByDate).mockImplementation(async (app, date) => {
        const diffDays = today.diff(date, "days");
        if (diffDays === 0) return { content: "completed" }; // today completed
        if (diffDays === 1) return { content: "unfulfilled" }; // yesterday missed
        if (diffDays < 10) return { content: "completed" };
        return null;
      });

      const stats = await calculator.calculate(habit);
      expect(Array.isArray(stats.dailyHistory)).toBe(true);
      expect(stats.dailyHistory.length).toBe(28);

      // Chronological: index 0 is 27 days ago, index 27 is today
      const todayEntry = stats.dailyHistory[27];
      expect(todayEntry.date).toBe(today.clone().locale("en").format("YYYY-MM-DD"));
      expect(todayEntry.status).toBe("completed");

      const yesterdayEntry = stats.dailyHistory[26];
      expect(yesterdayEntry.date).toBe(today.clone().subtract(1, "days").locale("en").format("YYYY-MM-DD"));
      expect(yesterdayEntry.status).toBe("missed");
    });
  });
});
