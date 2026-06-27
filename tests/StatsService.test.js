import { describe, it, expect, beforeEach, vi } from "vitest";
import { StatsService } from "../src/services/StatsService.js";
import { getNoteByDate } from "../src/utils/helpers.js";

vi.mock("../src/utils/helpers.js", async () => {
  const actual = await vi.importActual("../src/utils/helpers.js");
  return {
    ...actual,
    getNoteByDate: vi.fn()
  };
});

describe("StatsService Tests", () => {
  let mockPlugin;
  let statsService;

  beforeEach(() => {
    mockPlugin = {
      settings: {
        marker: "[habit:: true]",
        streakBreakOnMissing: false // default
      },
      habitManager: {
        isHabitScheduledForDay: () => true, // always scheduled
        getHabitsForTimeRange: () => []
      },
      habitScanner: {
        scan: (content) => {
          if (content.includes("completed")) {
            return [{ completed: true, skipped: false, text: "Habit Name", habitId: "habit-1" }];
          }
          if (content.includes("skipped")) {
            return [{ completed: false, skipped: true, text: "Habit Name", habitId: "habit-1" }];
          }
          return [{ completed: false, skipped: false, text: "Habit Name", habitId: "habit-1" }];
        }
      },
      app: {
        vault: {
          cachedRead: async (file) => file.content,
          read: async (file) => file.content
        }
      }
    };

    statsService = new StatsService(mockPlugin);
    vi.clearAllMocks();
  });

  describe("getHabitStatus", () => {
    it("should return ignored if not scheduled for day", async () => {
      mockPlugin.habitManager.isHabitScheduledForDay = () => false;
      const habit = { id: "habit-1", name: "Habit Name" };
      const date = window.moment("2026-06-21");
      const status = await statsService.getHabitStatus(habit, date);
      expect(status).toBe("ignored");
    });

    it("should return ignored if date is before restoredDate", async () => {
      const habit = { id: "habit-1", name: "Habit Name", restoredDate: Date.parse("2026-06-22") };
      const date = window.moment("2026-06-21");
      const status = await statsService.getHabitStatus(habit, date);
      expect(status).toBe("ignored");
    });

    it("should return ignored if date is after archivedDate", async () => {
      const habit = { id: "habit-1", name: "Habit Name", archived: true, archivedDate: Date.parse("2026-06-20") };
      const date = window.moment("2026-06-21");
      const status = await statsService.getHabitStatus(habit, date);
      expect(status).toBe("ignored");
    });

    it("should return ignored on missing daily note if streakBreakOnMissing = false", async () => {
      mockPlugin.settings.streakBreakOnMissing = false;
      vi.mocked(getNoteByDate).mockResolvedValue(null);
      const habit = { id: "habit-1", name: "Habit Name" };
      const date = window.moment("2026-06-21");
      const status = await statsService.getHabitStatus(habit, date);
      expect(status).toBe("ignored");
    });

    it("should return uncompleted on missing daily note if streakBreakOnMissing = true", async () => {
      mockPlugin.settings.streakBreakOnMissing = true;
      vi.mocked(getNoteByDate).mockResolvedValue(null);
      const habit = { id: "habit-1", name: "Habit Name" };
      const date = window.moment("2026-06-21");
      const status = await statsService.getHabitStatus(habit, date);
      expect(status).toBe("uncompleted");
    });

    it("should parse preloaded content correctly", async () => {
      const habit = { id: "habit-1", name: "Habit Name", linkText: "[[Habit Name]]" };
      const date = window.moment("2026-06-21");
      const status = await statsService.getHabitStatus(habit, date, "completed");
      expect(status).toBe("completed");
    });

    it("should return skipped if scanned entry is skipped", async () => {
      const habit = { id: "habit-1", name: "Habit Name", linkText: "[[Habit Name]]" };
      const date = window.moment("2026-06-21");
      const status = await statsService.getHabitStatus(habit, date, "skipped");
      expect(status).toBe("skipped");
    });
  });

  describe("calculateWeeklyStats", () => {
    it("should return correct total and completed counts for the week", async () => {
      const habits = [{ id: "habit-1", name: "Habit Name", linkText: "[[Habit Name]]" }];
      const currentWeekStart = window.moment("2026-06-15"); // Mon
      const preloadedWeekContent = new Map([
        ["2026-06-15", "completed"],
        ["2026-06-16", "skipped"],
        ["2026-06-17", "pending"]
      ]);

      const weeklyStats = await statsService.calculateWeeklyStats(habits, currentWeekStart, preloadedWeekContent);

      expect(weeklyStats["2026-06-15"]).toEqual({ total: 1, completed: 1 });
      expect(weeklyStats["2026-06-16"]).toEqual({ total: 0, completed: 0 }); // skipped doesn't count in total
      expect(weeklyStats["2026-06-17"]).toEqual({ total: 1, completed: 0 });
    });
  });
});
