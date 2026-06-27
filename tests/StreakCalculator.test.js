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
});
