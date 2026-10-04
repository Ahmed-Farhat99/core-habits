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
          cachedRead: async (file) => file.content || "",
          read: async (file) => file.content || ""
        },
        workspace: {
          getLeavesOfType: vi.fn().mockReturnValue([])
        }
      },
      saveSettings: vi.fn().mockResolvedValue(true)
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

    it("does not count a missing note as an empty existing note", async () => {
      const habits = [{ id: "habit-1", name: "Habit Name", linkText: "[[Habit Name]]" }];
      const weekStart = window.moment("2026-06-15");
      const stats = await statsService.calculateWeeklyStats(habits, weekStart,
        new Map([["2026-06-15", null]]));
      expect(stats["2026-06-15"]).toEqual({ total: 0, completed: 0 });
      expect(vi.mocked(getNoteByDate).mock.calls.some(([, date]) => date.format("YYYY-MM-DD") === "2026-06-15")).toBe(false);
    });
  });

  it("compares the same number of weekdays for an incomplete week", async () => {
    mockPlugin.habitManager.getHabitsForTimeRange = () => [
      { id: "habit-1", name: "Habit Name", linkText: "[[Habit Name]]" }
    ];
    vi.mocked(getNoteByDate).mockImplementation(async (_app, date) => ({
      content: date.day() === 1 || date.day() === 2 ? "completed" : "pending"
    }));

    const currentWeekStart = window.moment("2026-06-22");
    expect(await statsService.calculateLastWeekRate(currentWeekStart, 2)).toBe(100);
    expect(await statsService.calculateLastWeekRate(currentWeekStart, 7)).toBe(29);
    expect(await statsService.calculateLastWeekRate(currentWeekStart, 0)).toBeNull();
  });

  describe("getPeriodStatistics", () => {
    it("should calculate comprehensive period statistics and be strictly read-only", async () => {
      mockPlugin.habitManager.getHabitsForTimeRange = () => [
        { id: "h1", name: "Fajr", linkText: "[[Fajr]]", habitType: "build" },
      ];
      mockPlugin.saveSettings = vi.fn();
      mockPlugin.translationManager = { t: (k) => k };

      // Mock daily notes for June 1-3
      vi.mocked(getNoteByDate).mockImplementation(async () => {
        return { content: "completed [habit:: h1]" };
      });

      const { StatsPeriod, PERIOD_TYPES } = await import("../src/domain/stats/StatsPeriod.js");
      const period = new StatsPeriod(PERIOD_TYPES.LAST_7_DAYS, {
        anchorDate: window.moment("2026-06-17"),
        weekStartDay: 1, // Monday
      });

      const stats = await statsService.getPeriodStatistics(period);

      expect(stats).toBeDefined();
      expect(stats.metrics).toBeDefined();
      expect(stats.insights).toBeDefined();
      expect(stats.metrics.consistencyRate).toBeGreaterThanOrEqual(0);

      // Verify STRICTLY READ-ONLY (No vault modifications, no saveSettings)
      expect(mockPlugin.saveSettings).not.toHaveBeenCalled();

      // Second call should return cached object without re-fetching
      const cachedStats = await statsService.getPeriodStatistics(period);
      expect(cachedStats).toBe(stats);

      // Cache invalidation should clear cache
      statsService.invalidateCache();
      const freshStats = await statsService.getPeriodStatistics(period);
      expect(freshStats).not.toBe(cachedStats); // fresh object
    });
  });

  describe("Lifetime Indexing and Scan Optimization", () => {
    it("should rebuild the lifetime index at startup even when a total was persisted", async () => {
      mockPlugin.settings.lifetimeCompleted = 250;
      mockPlugin.app.vault.getMarkdownFiles = vi.fn().mockReturnValue([]);
      const stats = new StatsService(mockPlugin);

      const result = await stats.initLifetimeIndex(false);

      expect(result).toBe(0);
      expect(mockPlugin.app.vault.getMarkdownFiles).toHaveBeenCalled();
      expect(stats.isLifetimeIndexFullyLoaded).toBe(true);
    });

    it("should scan files when force=true even if lifetimeCompleted is present", async () => {
      mockPlugin.settings.lifetimeCompleted = 250;
      mockPlugin.app.vault.getMarkdownFiles = vi.fn().mockReturnValue([
        { path: "2026-09-09.md", basename: "2026-09-09", content: "- [x] Reading" }
      ]);
      const stats = new StatsService(mockPlugin);

      const result = await stats.initLifetimeIndex(true);

      expect(mockPlugin.app.vault.getMarkdownFiles).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should derive the total from the complete in-memory index after a file changes", async () => {
      mockPlugin.settings.lifetimeCompleted = 100;
      mockPlugin.app.vault.read = vi.fn().mockResolvedValue("- [x] Reading");
      mockPlugin.habitScanner.scan = vi.fn().mockReturnValue([{ name: "Reading", completed: true }]);
      const stats = new StatsService(mockPlugin);
      const testFile = { path: "2026-09-09.md", basename: "2026-09-09" };
      stats.isLifetimeIndexFullyLoaded = true;
      stats.dailyCompletions.set("2026-09-08", 99);

      // Initial scan of note with 1 habit
      await stats.rescanFile(testFile);

      // Subsequent scan of note with 2 habits completed -> delta is +1
      mockPlugin.app.vault.read.mockResolvedValue("- [x] Reading\n- [x] Exercise");
      mockPlugin.habitScanner.scan.mockReturnValue([
        { name: "Reading", completed: true },
        { name: "Exercise", completed: true }
      ]);
      await stats.rescanFile(testFile);

      // 100 + (2 - 1) = 101
      expect(mockPlugin.settings.lifetimeCompleted).toBe(101);
    });

    it("should filter files strictly matching the daily note format and ignore non-matching files", async () => {
      mockPlugin.settings.lifetimeCompleted = null;
      mockPlugin.app.vault.getMarkdownFiles = vi.fn().mockReturnValue([
        { path: "2026-09-09.md", basename: "2026-09-09" },
        { path: "Projects.md", basename: "Projects" },
        { path: "2026-99-99.md", basename: "2026-99-99" }
      ]);
      mockPlugin.app.vault.cachedRead = vi.fn().mockResolvedValue("- [x] Reading");
      mockPlugin.habitScanner.scan = vi.fn().mockReturnValue([{ name: "Reading", completed: true }]);

      const stats = new StatsService(mockPlugin);
      const result = await stats.initLifetimeIndex(true);

      // Only "2026-09-09.md" matches YYYY-MM-DD
      expect(result).toBe(1);
      expect(stats.dailyCompletions.has("2026-09-09")).toBe(true);
      expect(stats.dailyCompletions.has("Projects")).toBe(false);
      expect(stats.dailyCompletions.has("2026-99-99")).toBe(false);
    });

    it("ignores a date-named note outside the configured Daily folder", async () => {
      mockPlugin.settings.dailyNotesSource = "manual";
      mockPlugin.settings.dailyNotesFolder = "Daily";
      mockPlugin.app.vault.getMarkdownFiles = vi.fn().mockReturnValue([
        { path: "Daily/2026-09-09.md", basename: "2026-09-09", content: "- [x] completed" },
        { path: "Archive/2026-09-09.md", basename: "2026-09-09", content: "- [x] Reading" },
        { path: "DailyOther/2026-09-10.md", basename: "2026-09-10", content: "- [x] Reading" }
      ]);
      const stats = new StatsService(mockPlugin);
      expect(await stats.initLifetimeIndex()).toBe(1);
      await stats.rescanFile({ path: "Archive/2026-09-09.md", basename: "2026-09-09", content: "- [x] Reading" });
      await stats.handleFileDelete({ path: "Archive/2026-09-09.md", basename: "2026-09-09" });
      expect(mockPlugin.settings.lifetimeCompleted).toBe(1);
      expect(stats.dailyCompletions.size).toBe(1);
    });

    it("preserves the previous complete index when rebuilding fails", async () => {
      const file = { path: "2026-09-09.md", content: "- [x] completed" };
      mockPlugin.app.vault.getMarkdownFiles = vi.fn().mockReturnValue([file]);
      const stats = new StatsService(mockPlugin);
      expect(await stats.initLifetimeIndex()).toBe(1);
      mockPlugin.app.vault.cachedRead = vi.fn().mockRejectedValue(new Error("disk read failed"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await stats.initLifetimeIndex(true)).toBeNull();
      expect(stats.dailyCompletions.get("2026-09-09")).toBe(1);
      expect(mockPlugin.settings.lifetimeCompleted).toBe(1);
      errorSpy.mockRestore();
    });

    it("removes a Daily entry when it is renamed outside the configured folder", async () => {
      mockPlugin.settings.dailyNotesSource = "manual";
      mockPlugin.settings.dailyNotesFolder = "Daily";
      mockPlugin.app.vault.getMarkdownFiles = vi.fn().mockReturnValue([
        { path: "Daily/2026-09-09.md", content: "- [x] completed" }
      ]);
      const stats = new StatsService(mockPlugin);
      expect(await stats.initLifetimeIndex()).toBe(1);
      await stats.handleFileRename(
        { path: "Archive/2026-09-09.md", content: "- [x] completed" },
        "Daily/2026-09-09.md"
      );
      expect(mockPlugin.settings.lifetimeCompleted).toBe(0);
      expect(stats.dailyCompletions.size).toBe(0);
    });

    it("should delegate syncLifetimeAchievements to initLifetimeIndex and support onProgress callback", async () => {
      mockPlugin.settings.lifetimeCompleted = null;
      mockPlugin.app.vault.getMarkdownFiles = vi.fn().mockReturnValue([
        { path: "2026-09-08.md", basename: "2026-09-08" },
        { path: "2026-09-09.md", basename: "2026-09-09" }
      ]);
      mockPlugin.app.vault.cachedRead = vi.fn().mockResolvedValue("- [x] Habit");
      mockPlugin.habitScanner.scan = vi.fn().mockReturnValue([
        { name: "Habit 1", completed: true },
        { name: "Habit 2", completed: true }
      ]);

      const onProgress = vi.fn();
      const stats = new StatsService(mockPlugin);
      const total = await stats.syncLifetimeAchievements(onProgress);

      expect(total).toBe(4);
      expect(onProgress).toHaveBeenCalledWith(2, 2);
      expect(stats.dailyCompletions.size).toBe(2);
      expect(mockPlugin.settings.lifetimeCompleted).toBe(4);
    });

    it("should trigger core-habits:stats-updated after persisting the lifetime count", async () => {
      const mockTrigger = vi.fn();
      mockPlugin.app.workspace.trigger = mockTrigger;

      const stats = new StatsService(mockPlugin);
      stats.dailyCompletions.set("2026-09-01", 5);
      await stats.recalculateLifetimeCount();

      expect(mockPlugin.settings.lifetimeCompleted).toBe(5);
      expect(mockTrigger).toHaveBeenCalledWith("core-habits:stats-updated");
    });
  });
});
