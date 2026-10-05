import { describe, it, expect, beforeEach, vi } from "vitest";
import { StatsService } from "../src/services/StatsService.js";
import { HabitScanner } from "../src/services/HabitScanner.js";
import { HabitAggregator } from "../src/domain/stats/HabitAggregator.js";
import { MetricsCalculator } from "../src/domain/stats/MetricsCalculator.js";
import { StreakCalculator } from "../src/services/StreakCalculator.js";

describe("Phase 4: Stats & Index Resilience Tests", () => {
  let mockPlugin;
  let habitScanner;
  let aggregator;

  beforeEach(() => {
    habitScanner = new HabitScanner();
    aggregator = new HabitAggregator();

    mockPlugin = {
      settings: {
        marker: "[habit:: true]",
        streakBreakOnMissing: false,
        lifetimeCompleted: 0,
        weekStartDay: 6,
        language: "en",
      },
      habitScanner,
      habitManager: {
        isHabitScheduledForDay: () => true,
        getHabitsForTimeRange: () => [
          { id: "habit-1", name: "Reading", isScheduledForDay: () => true },
          { id: "habit-2", name: "Workout", isScheduledForDay: () => true },
        ],
        getHabitById: (id) => ({
          id,
          name: id === "habit-1" ? "Reading" : "Workout",
          isScheduledForDay: () => true,
        }),
      },
      vaultSourceStore: null,
      app: {
        vault: {
          cachedRead: vi.fn(),
          read: vi.fn(),
          getMarkdownFiles: vi.fn(),
        },
        workspace: {
          trigger: vi.fn(),
          getLeavesOfType: vi.fn().mockReturnValue([]),
        },
      },
      saveSettings: vi.fn().mockResolvedValue(true),
    };
  });

  describe("1. HabitScanner Resilience (>1MB, malformed lines, long lines)", () => {
    it("returns null for notes > 1MB to prevent regex catastrophic backtracking/OOM", () => {
      const oversizedNote = "a".repeat(1_000_001);
      const result = habitScanner.scan(oversizedNote, "[habit:: true]");
      expect(result).toBeNull();
    });

    it("parses notes up to 1MB successfully without crashing", () => {
      const normalChunk = "- [x] Read book [habit:: true]\n";
      const repeated = normalChunk.repeat(5000); // ~150KB
      const result = habitScanner.scan(repeated, "[habit:: true]");
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(5000);
      expect(result[0].completed).toBe(true);
    });

    it("safely handles malformed habit lines, broken dataview syntax, and Unicode without throwing", () => {
      const malformedContent = [
        "- [x] Normal habit [habit:: true]",
        "- [ ] Broken dataview [habit:: ",
        "- [x] Unclosed bracket [habit:: habit-1",
        "- [x] Malformed inline [habit:: :::: ]",
        "- [ ] Arabic habit with diacritics - [habit:: habit-2] حِفْظُ القُرْآنِ الكريم 🌟",
        "- [x] Habit with empty id [habit:: ]",
        "- [x] " + "X".repeat(3000), // Line exceeding 2000 chars should be safely skipped
        "- [ ] Unpaired brackets [[broken link [habit:: true]",
        "- [-] Skipped habit with weird chars ~!@#$%^&*() [habit:: true]",
      ].join("\n");

      const result = habitScanner.scan(malformedContent, "[habit:: true]");
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      // Verify healthy lines parsed accurately despite malformed neighbors
      const normal = result.find(h => h.text.includes("Normal habit"));
      expect(normal).toBeDefined();
      expect(normal.completed).toBe(true);

      const arabic = result.find(h => h.habitId === "habit-2");
      expect(arabic).toBeDefined();
      expect(arabic.completed).toBe(false);

      const skipped = result.find(h => h.text.includes("Skipped habit"));
      expect(skipped).toBeDefined();
      expect(skipped.skipped).toBe(true);
    });
  });

  describe("2. Lifetime Indexing Resilience & Fault Isolation", () => {
    it("does NOT drop startup or fail indexing when a single daily note is unreadable", async () => {
      const healthyFile1 = { path: "2026-09-01.md", basename: "2026-09-01" };
      const failedFile = { path: "2026-09-02.md", basename: "2026-09-02" };
      const healthyFile2 = { path: "2026-09-03.md", basename: "2026-09-03" };

      mockPlugin.app.vault.getMarkdownFiles = vi.fn().mockReturnValue([healthyFile1, failedFile, healthyFile2]);

      mockPlugin.app.vault.cachedRead = vi.fn().mockImplementation(async (file) => {
        if (file.path === "2026-09-02.md") {
          throw new Error("EACCES: permission denied, read lock");
        }
        return "- [x] Reading [habit:: true]\n- [x] Workout [habit:: true]";
      });

      const stats = new StatsService(mockPlugin);
      const total = await stats.initLifetimeIndex(true);

      // Startup succeeds and returns valid count from healthy files
      expect(total).toBe(4); // 2 on 2026-09-01 + 2 on 2026-09-03
      expect(stats.isLifetimeIndexFullyLoaded).toBe(true);

      // Failed file is isolated into degraded state
      expect(stats.isDegraded).toBe(true);
      expect(stats.degradedDates.has("2026-09-02")).toBe(true);

      // Scan failure is NOT converted to 0 completions
      expect(stats.dailyCompletions.has("2026-09-02")).toBe(false);
      expect(stats.dailyCompletions.get("2026-09-01")).toBe(2);
      expect(stats.dailyCompletions.get("2026-09-03")).toBe(2);
    });

    it("handles 1 failed file out of hundreds of healthy daily notes cleanly", async () => {
      const TOTAL_FILES = 150;
      const files = [];
      const baseMoment = window.moment("2025-01-01");
      for (let i = 0; i < TOTAL_FILES; i++) {
        const dStr = baseMoment.clone().add(i, "days").format("YYYY-MM-DD");
        files.push({
          path: `${dStr}.md`,
          basename: dStr,
          content: "- [x] Habit [habit:: true]",
        });
      }

      // Make note 42 unreadable
      const FAILED_INDEX = 42;
      const failedPath = files[FAILED_INDEX].path;

      mockPlugin.app.vault.getMarkdownFiles = vi.fn().mockReturnValue(files);
      mockPlugin.app.vault.cachedRead = vi.fn().mockImplementation(async (file) => {
        if (file.path === failedPath) {
          throw new Error("File corrupted on disk");
        }
        return file.content;
      });

      const stats = new StatsService(mockPlugin);
      const total = await stats.initLifetimeIndex(true);

      // 149 healthy files indexed successfully
      expect(total).toBe(149);
      expect(stats.dailyCompletions.size).toBe(149);
      expect(stats.isDegraded).toBe(true);
      expect(stats.getDegradedDates().length).toBe(1);
      expect(stats.getDegradedDates()[0].path).toBe(failedPath);
    });

    it("preserves last known valid index when a file scan fails subsequently", async () => {
      const file = { path: "2026-09-01.md", basename: "2026-09-01" };
      mockPlugin.app.vault.getMarkdownFiles = vi.fn().mockReturnValue([file]);

      // 1. Initial successful scan
      mockPlugin.app.vault.cachedRead = vi.fn().mockResolvedValue("- [x] Reading [habit:: true]\n- [x] Workout [habit:: true]");
      const stats = new StatsService(mockPlugin);
      const initialTotal = await stats.initLifetimeIndex(true);
      expect(initialTotal).toBe(2);
      expect(stats.dailyCompletions.get("2026-09-01")).toBe(2);
      expect(stats.isDegraded).toBe(false);

      // 2. Subsequent scan failure (e.g. file locked or corrupted)
      mockPlugin.app.vault.cachedRead = vi.fn().mockRejectedValue(new Error("File busy"));
      const newTotal = await stats.initLifetimeIndex(true);

      // Should retain previous valid index (2) and flag degraded state
      expect(newTotal).toBe(2);
      expect(stats.dailyCompletions.get("2026-09-01")).toBe(2);
      expect(stats.isDegraded).toBe(true);
      const degradedInfo = stats.degradedDates.get("2026-09-01");
      expect(degradedInfo.retainedPrevious).toBe(true);
      expect(degradedInfo.previousValue).toBe(2);
    });

    it("rescanFile handles unreadable note safely and preserves previous count", async () => {
      const file = { path: "2026-09-05.md", basename: "2026-09-05" };
      mockPlugin.app.vault.getMarkdownFiles = vi.fn().mockReturnValue([file]);
      mockPlugin.app.vault.cachedRead = vi.fn().mockResolvedValue("- [x] Reading [habit:: true]");
      mockPlugin.app.vault.read = vi.fn().mockResolvedValue("- [x] Reading [habit:: true]");

      const stats = new StatsService(mockPlugin);
      await stats.initLifetimeIndex(true);
      expect(stats.dailyCompletions.get("2026-09-05")).toBe(1);

      // Edit causes read failure
      mockPlugin.app.vault.read = vi.fn().mockRejectedValue(new Error("Disk error"));
      await stats.rescanFile(file);

      // Does not wipe out index with 0
      expect(stats.dailyCompletions.get("2026-09-05")).toBe(1);
      expect(stats.isDegraded).toBe(true);
    });
  });

  describe("3. Aggregation & Streak Resilience with Degraded/Unknown State", () => {
    it("HabitAggregator returns status 'unknown' and flags degraded when noteContentProvider fails", async () => {
      const habits = [{ id: "habit-1", name: "Daily Habit", isScheduledForDay: () => true }];
      const startDate = window.moment("2026-09-01");
      const endDate = window.moment("2026-09-03");

      const noteContentProvider = async (dateKey) => {
        if (dateKey === "2026-09-02") {
          // Unreadable daily note
          return { hasNote: true, scanned: null, isDegraded: true };
        }
        return {
          hasNote: true,
          scanned: [{ habitId: "habit-1", completed: true, skipped: false }],
        };
      };

      const result = await aggregator.aggregate({
        habits,
        startDate,
        endDate,
        noteContentProvider,
        settings: mockPlugin.settings,
        habitManager: mockPlugin.habitManager,
      });

      expect(result.isDegraded).toBe(true);
      expect(result.degradedDaysCount).toBe(1);

      // Unknown status should NOT count as uncompleted or failed scheduled habit
      const day2 = result.dailyStats.get("2026-09-02");
      expect(day2.dayUnknown).toBe(true);
      expect(day2.completed).toBe(0);
      expect(day2.total).toBe(0); // Not counted as failed total

      // Days 1 and 3 are counted normally
      expect(result.dailyStats.get("2026-09-01").completed).toBe(1);
      expect(result.dailyStats.get("2026-09-03").completed).toBe(1);
    });

    it("MetricsCalculator propagates isDegraded and degradedDaysCount", () => {
      const currentAgg = {
        summary: {
          totalScheduled: 10,
          totalCompleted: 9,
          totalSkipped: 0,
          consistencyRate: 90,
          activeDaysCount: 3,
          perfectDaysCount: 2,
          lowDaysCount: 0,
        },
        weekdayStats: [],
        dailyStats: new Map(),
        isDegraded: true,
        degradedDaysCount: 1,
      };

      const metrics = MetricsCalculator.compute(currentAgg, null, 6);
      expect(metrics.isDegraded).toBe(true);
      expect(metrics.degradedDaysCount).toBe(1);
    });

    it("StreakCalculator does NOT break current streak when a note has unknown status", async () => {
      StreakCalculator.invalidateAll();
      const habit = { id: "habit-1", name: "Read", isScheduledForDay: () => true };
      const streakCalc = new StreakCalculator(mockPlugin);

      // Mock statsService.getHabitStatus
      // Day 0: today (completed)
      // Day 1: yesterday (unknown due to unreadable file)
      // Day 2: day before (completed)
      mockPlugin.statsService = {
        getHabitStatus: vi.fn().mockImplementation(async (h, date) => {
          const dKey = date.format("YYYY-MM-DD");
          const today = window.moment().format("YYYY-MM-DD");
          const yesterday = window.moment().subtract(1, "day").format("YYYY-MM-DD");
          const dayBefore = window.moment().subtract(2, "days").format("YYYY-MM-DD");

          if (dKey === today) return "completed";
          if (dKey === yesterday) return "unknown";
          if (dKey === dayBefore) return "completed";
          return "uncompleted";
        }),
      };

      const result = await streakCalc.calculate(habit);

      // The streak should NOT be broken by the unknown day
      expect(result.currentStreak).toBe(2);
      expect(result.longestStreak).toBeGreaterThanOrEqual(2);

      // Verify the history shows 'unknown' instead of 'missed'
      const yesterdayHistory = result.dailyHistory.find(
        (h) => h.date === window.moment().subtract(1, "day").format("YYYY-MM-DD")
      );
      if (yesterdayHistory) {
        expect(yesterdayHistory.status).toBe("unknown");
      }
    });
  });
});
