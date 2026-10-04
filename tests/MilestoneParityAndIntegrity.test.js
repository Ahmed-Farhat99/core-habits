import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProgressionEngine } from "../src/services/ProgressionEngine.js";
import { StreakCalculator } from "../src/services/StreakCalculator.js";
import { HabitEntity } from "../src/domain/HabitEntity.js";
import { HabitsPanel } from "../src/views/settings/HabitsPanel.js";
import { HabitManager } from "../src/services/HabitManager.js";

describe("Milestone Parity, Persistence Integrity & High-Water Preservation", () => {
  beforeEach(() => {
    StreakCalculator.invalidateAll();
    vi.clearAllMocks();
  });

  describe("1. Parity between Derived Engine, Cached Stats & Entity", () => {
    it("ensures HabitEntity derives Milestone 3 when current_level is missing and savedLongestStreak is 11", () => {
      const entity = HabitEntity.fromFrontmatterProps(
        { basename: "سلوك - نافع - بعد الإستيقاظ" },
        {
          schema_version: 2,
          habit_id: "habit-test-1",
          saved_longest_streak: 11
        }
      );

      expect(entity.savedLongestStreak).toBe(11);
      // Milestone 3 threshold is >= 7 days
      expect(entity.currentLevel).toBe(3);
      expect(ProgressionEngine.calculateLevel(entity)).toBe(3);
    });

    it("ensures ProgressionEngine calculates level 3 when savedLongestStreak is 11 even if habit.currentLevel was 1", () => {
      const habit = new HabitEntity({
        id: "habit-test-1",
        name: "سلوك - نافع - بعد الإستيقاظ",
        currentLevel: 1,
        savedLongestStreak: 11
      });

      // ProgressionEngine is the canonical derived calculator:
      expect(ProgressionEngine.calculateLevel(habit)).toBe(3);
    });

    it("ensures HabitsPanel renders milestone 3 when cached stats indicate longest streak 11", () => {
      const habit = new HabitEntity({
        id: "habit-test-parity",
        name: "سلوك - نافع - بعد الإستيقاظ",
        currentLevel: 1,
        savedLongestStreak: 0
      });

      const mockPlugin = {
        app: { vault: { cachedRead: vi.fn(), read: vi.fn() } },
        settings: { language: "ar", collapsedGroups: [] },
        translationManager: { t: (k) => k },
        habitManager: {
          getActiveHabits: vi.fn(() => [habit]),
          getEffectiveParentId: vi.fn(() => null),
          isParent: vi.fn(() => false)
        },
        streakCalculator: null
      };

      // Before cache: if stats=null and savedLongest=0, level is 1
      expect(ProgressionEngine.calculateLevel(habit, null)).toBe(1);

      // Now set streak in habit high-water mark (as done when stats are loaded)
      habit.savedLongestStreak = 11;
      habit.currentLevel = 3;
      expect(ProgressionEngine.calculateLevel(habit)).toBe(3);

      const panel = new HabitsPanel(mockPlugin, { refreshUI: vi.fn() });
      const container = document.createElement("div");
      panel.renderHabitsList(container, "");

      const levelBadge = container.querySelector(".dh-level-badge");
      expect(levelBadge).not.toBeNull();
      expect(levelBadge.textContent.trim()).toBe("3");
      expect(levelBadge.classList.contains("level-3")).toBe(true);
    });
  });

  describe("2. High-Water Mark In-Memory Synchronization in StreakCalculator", () => {
    it("updates habit.savedLongestStreak and habit.currentLevel when StreakCalculator discovers a higher streak", async () => {
      const habit = {
        id: "habit-high-water",
        name: "Morning Habit",
        savedLongestStreak: 0,
        currentLevel: 1
      };

      const mockSync = vi.fn();
      const mockFile = { path: "Daily/2026-10-01.md", basename: "2026-10-01" };
      const mockPlugin = {
        app: {
          vault: {
            getAbstractFileByPath: vi.fn().mockReturnValue(mockFile),
            read: vi.fn().mockResolvedValue("- [x] [[Morning Habit]] [habit:: habit-high-water]"),
            cachedRead: vi.fn().mockResolvedValue("- [x] [[Morning Habit]] [habit:: habit-high-water]")
          }
        },
        translationManager: { t: (k) => k },
        settings: { marker: "[habit:: habit-high-water]" },
        habitScanner: {
          scan: vi.fn().mockReturnValue([{ id: "habit-high-water", completed: true, skipped: false }])
        },
        statsService: {
          getHabitStatus: vi.fn().mockResolvedValue("completed")
        },
        habitManager: {
          isHabitScheduledForDay: vi.fn().mockReturnValue(true),
          getHabitById: vi.fn().mockReturnValue(habit),
          syncMilestoneCheckpoint: mockSync
        }
      };

      const calculator = new StreakCalculator(mockPlugin);
      const result = await calculator.calculate(habit);

      expect(result.longestStreak).toBeGreaterThan(0);
      expect(habit.savedLongestStreak).toBe(result.longestStreak);
      expect(habit.currentLevel).toBe(ProgressionEngine.calculateLevel(habit, result));
      expect(mockSync).toHaveBeenCalledWith(habit.id, habit.savedLongestStreak, habit.currentLevel);

      // Verify getCachedStats static helper
      const cached = StreakCalculator.getCachedStats(habit.id);
      expect(cached).not.toBeNull();
      expect(cached.longestStreak).toBe(result.longestStreak);
    });
  });

  describe("3. High-Water Mark Preservation (Never Downgrade)", () => {
    it("never downgrades earned milestone when current streak drops to zero", () => {
      const habit = {
        id: "habit-streak-drop",
        name: "Consistent Habit",
        savedLongestStreak: 11,
        currentLevel: 3
      };

      // Current streak resets to 0 (user missed days)
      const freshStats = { currentStreak: 0, longestStreak: 0 };
      const level = ProgressionEngine.calculateLevel(habit, freshStats);

      // Must remain at milestone 3 (التمكن)
      expect(level).toBe(3);
    });

    it("never downgrades below legacy manual level achievements", () => {
      const habit = {
        id: "habit-legacy",
        levelData: [
          { achieved: true },
          { achieved: true },
          { achieved: false },
          { achieved: false },
          { achieved: false }
        ],
        savedLongestStreak: 0
      };

      const level = ProgressionEngine.calculateLevel(habit, { currentStreak: 0 });
      // Level 1 achieved -> milestone 2, Level 2 achieved -> milestone 3
      expect(level).toBe(3);
    });
  });

  describe("4. Save Integrity in HabitManager", () => {
    it("persists savedLongestStreak and currentLevel during updateHabit", async () => {
      const currentHabit = {
        id: "habit-save-integrity",
        name: "Running",
        currentLevel: 1,
        savedLongestStreak: 0,
        createdAt: Date.now(),
        schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] },
        archived: false,
        order: 0
      };

      const mockRepository = {
        update: vi.fn().mockResolvedValue(undefined),
        resolveHabitFile: vi.fn().mockReturnValue({ path: "Core Habits/Active/Running.md" })
      };

      const mockPlugin = {
        app: {},
        settings: { language: "ar" },
        translationManager: { t: (k) => k },
        habitRepository: mockRepository,
        habitNoteManager: {
          updateHabitNoteProps: vi.fn().mockResolvedValue(undefined)
        }
      };

      const manager = new HabitManager(mockPlugin);
      manager.habitsMap.set(currentHabit.id, currentHabit);

      // Update with new peak streak 11 and currentLevel 3 (from HabitEditorComponent)
      const updated = await manager.updateHabit(currentHabit.id, {
        name: "Running",
        currentLevel: 3,
        savedLongestStreak: 11
      });

      expect(updated.savedLongestStreak).toBe(11);
      expect(updated.currentLevel).toBe(3);
      expect(mockRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "habit-save-integrity",
          savedLongestStreak: 11,
          currentLevel: 3
        })
      );
    });

    it("debounces and updates frontmatter via syncMilestoneCheckpoint", async () => {
      vi.useFakeTimers();

      const habit = {
        id: "habit-checkpoint",
        name: "Reading",
        currentLevel: 1,
        savedLongestStreak: 0
      };

      const mockUpdateProps = vi.fn().mockResolvedValue(undefined);
      const mockRepository = {
        resolveHabitFile: vi.fn().mockReturnValue({ path: "Core Habits/Active/Reading.md" })
      };
      const mockPlugin = {
        app: {},
        habitRepository: mockRepository,
        habitNoteManager: { updateHabitNoteProps: mockUpdateProps }
      };

      const manager = new HabitManager(mockPlugin);
      manager.habitsMap.set(habit.id, habit);

      await manager.syncMilestoneCheckpoint(habit.id, 11, 3);

      // Immediately updated in memory
      expect(habit.savedLongestStreak).toBe(11);
      expect(habit.currentLevel).toBe(3);

      // Disk write is debounced
      expect(mockUpdateProps).not.toHaveBeenCalled();

      // Fast forward debounce timer
      await vi.advanceTimersByTimeAsync(1100);

      expect(mockUpdateProps).toHaveBeenCalledWith(
        "Core Habits/Active/Reading.md",
        { saved_longest_streak: 11, current_level: 3 },
        { full: false }
      );

      vi.useRealTimers();
    });
  });
});
