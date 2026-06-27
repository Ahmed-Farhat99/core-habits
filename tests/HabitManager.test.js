import { describe, it, expect, beforeEach, vi } from "vitest";
import { HabitManager } from "../src/services/HabitManager.js";
import { getNoteByDate } from "../src/utils/helpers.js";

vi.mock("../src/utils/helpers.js", async () => {
  const actual = await vi.importActual("../src/utils/helpers.js");
  return {
    ...actual,
    getNoteByDate: vi.fn()
  };
});

describe("HabitManager CRUD Transactional Tests", () => {
  let mockPlugin;
  let mockRepository;
  let habitManager;

  beforeEach(() => {
    mockRepository = {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      archive: vi.fn(),
      restore: vi.fn(),
      loadAll: vi.fn().mockResolvedValue([])
    };

    mockPlugin = {
      settings: {
        language: "en"
      },
      habitRepository: mockRepository
    };

    habitManager = new HabitManager(mockPlugin);
  });

  it("should successfully add habit when disk write succeeds", async () => {
    mockRepository.create.mockResolvedValue({ path: "some-path" });

    const habitData = {
      name: "Exercise Daily",
      schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] }
    };

    const newHabit = await habitManager.addHabit(habitData);
    
    expect(newHabit.name).toBe("Exercise Daily");
    expect(mockRepository.create).toHaveBeenCalledWith(newHabit);
    expect(habitManager.getHabitById(newHabit.id)).toEqual(newHabit);
  });

  it("should not update memory map when disk write fails during addHabit", async () => {
    mockRepository.create.mockRejectedValue(new Error("Disk full"));

    const habitData = {
      name: "Exercise Daily",
      schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] }
    };

    await expect(habitManager.addHabit(habitData)).rejects.toThrow("Disk full");
    expect(habitManager.getHabits()).toHaveLength(0); // Memory map is empty!
  });

  it("should rollback/not apply memory update when disk write fails during updateHabit", async () => {
    // 1. Setup existing habit in memory
    const existingHabit = {
      schemaVersion: 1,
      id: "habit-1",
      name: "Read Book",
      schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] },
      createdAt: Date.now(),
      order: 0,
      archived: false
    };
    habitManager.habitsMap.set(existingHabit.id, existingHabit);

    // 2. Mock disk failure
    mockRepository.update.mockRejectedValue(new Error("Permission denied"));

    // 3. Try to update
    const updateData = { name: "Read 50 Books" };
    await expect(habitManager.updateHabit("habit-1", updateData)).rejects.toThrow("Permission denied");

    // 4. Verify memory still contains the OLD data
    const habitInMemory = habitManager.getHabitById("habit-1");
    expect(habitInMemory.name).toBe("Read Book"); // Rolled back / not changed!
  });

  it("should prevent duplicate habit names across both active and archived folders", async () => {
    // Setup an archived habit in memory
    const archivedHabit = {
      schemaVersion: 1,
      id: "habit-archived",
      name: "Exercise Daily",
      schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] },
      createdAt: Date.now() - 1000,
      order: 0,
      archived: true
    };
    habitManager.habitsMap.set(archivedHabit.id, archivedHabit);

    // Setup an active habit in memory
    const activeHabit = {
      schemaVersion: 1,
      id: "habit-active",
      name: "Drink Water",
      schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] },
      createdAt: Date.now() - 500,
      order: 1,
      archived: false
    };
    habitManager.habitsMap.set(activeHabit.id, activeHabit);

    // 1. Try to add a habit with same name as the archived one
    const newHabitData1 = { name: "Exercise Daily" };
    await expect(habitManager.addHabit(newHabitData1)).rejects.toThrow();

    // 2. Try to add a habit with same name as the active one
    const newHabitData2 = { name: "Drink Water" };
    await expect(habitManager.addHabit(newHabitData2)).rejects.toThrow();

    // 3. Try to update the active habit to have the same name as the archived one
    await expect(habitManager.updateHabit("habit-active", { name: "Exercise Daily" })).rejects.toThrow();
  });

  it("should successfully prepare and execute batch rename of habit references", async () => {
    // Setup habit in memory with name history
    const habit = {
      schemaVersion: 1,
      id: "habit-rename-test",
      name: "Old Habit Name",
      linkText: "[[Old Habit Name]]",
      nameHistory: ["[[Older Name]]"],
      createdAt: Date.now(),
      order: 0,
      archived: false
    };
    habitManager.habitsMap.set(habit.id, habit);

    // Mock Vault and file list
    const mockFiles = [
      { path: "2026-06-20.md", content: "- [ ] [[Old Habit Name]] [habit:: habit-rename-test]\n- [habit-note:: Old Habit Name] Great job today" },
      { path: "2026-06-21.md", content: "- [x] [[Older Name]] [habit:: habit-rename-test]" },
      { path: "random-note.md", content: "No references here" }
    ];

    mockPlugin.app = {
      vault: {
        getMarkdownFiles: () => mockFiles,
        cachedRead: async (file) => file.content,
        process: async (file, callback) => {
          file.content = callback(file.content);
          return file;
        }
      }
    };

    // 1. Prepare batch rename
    const prep = await habitManager.prepareBatchRename(habit.id, "Old Habit Name");
    expect(prep.needsConfirmation).toBe(true);
    expect(prep.fileCount).toBe(2);
    expect(prep.uniqueOldNames).toContain("[[Old Habit Name]]");
    expect(prep.uniqueOldNames).toContain("[[Older Name]]");

    // 2. Execute batch rename
    const result = await habitManager.executeBatchRename(
      "New Habit Name", prep.uniqueOldNames, prep.filesToUpdate, null, () => false
    );

    expect(result.updated).toBe(2);
    expect(mockFiles[0].content).toContain("- [ ] [[New Habit Name]] [habit:: habit-rename-test]");
    expect(mockFiles[0].content).toContain("- [habit-note:: New Habit Name] Great job today");
    expect(mockFiles[1].content).toContain("- [x] [[New Habit Name]] [habit:: habit-rename-test]");
  });

  it("should fail to restore a habit if another active habit already has the same name", async () => {
    // 1. Setup an active habit with name "Exercise"
    const activeHabit = {
      schemaVersion: 1,
      id: "habit-active-1",
      name: "Exercise",
      linkText: "[[Exercise]]",
      createdAt: Date.now(),
      order: 0,
      archived: false
    };
    habitManager.habitsMap.set(activeHabit.id, activeHabit);

    // 2. Setup an archived habit with name "Exercise"
    const archivedHabit = {
      schemaVersion: 1,
      id: "habit-archived-1",
      name: "Exercise",
      linkText: "[[Exercise]]",
      createdAt: Date.now() - 1000,
      order: 1,
      archived: true
    };
    habitManager.habitsMap.set(archivedHabit.id, archivedHabit);

    // 3. Try to restore and expect rejection
    await expect(habitManager.restoreHabit(archivedHabit.id)).rejects.toThrow();
  });

  it("should preserve archivedDate when restoring a habit", async () => {
    const archivedDate = Date.now() - 5000;
    const archivedHabit = {
      schemaVersion: 1,
      id: "habit-archived-2",
      name: "Exercise Daily 2",
      schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] },
      createdAt: Date.now() - 10000,
      order: 1,
      archived: true,
      archivedDate
    };
    habitManager.habitsMap.set(archivedHabit.id, archivedHabit);

    const restored = await habitManager.restoreHabit(archivedHabit.id);
    expect(restored.archived).toBe(false);
    expect(restored.archivedDate).toBe(archivedDate);
    expect(restored.restoredDate).toBeDefined();
  });

  it("should bypass autoWriteHabits check in ensureHabitsInNote if forceWrite is true", async () => {
    mockPlugin.settings.autoWriteHabits = false; // Disable auto-write
    mockPlugin.settings.marker = "[habit:: true]";
    mockPlugin.settings.dailyParentHeading = "Habits";
    mockPlugin.settings.habitHeading = "My Habits";

    const habit = {
      schemaVersion: 1,
      id: "habit-test",
      name: "Read Book",
      linkText: "[[Read Book]]",
      schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] },
      order: 0,
      archived: false
    };
    habitManager.habitsMap.set(habit.id, habit);

    let processedData = "";
    const mockFile = { path: "daily-note.md", basename: "daily-note" };
    
    mockPlugin.app = {
      vault: {
        process: async (file, callback) => {
          processedData = callback("# Habits\n## My Habits\n");
          return file;
        }
      }
    };

    mockPlugin.habitScanner = {
      scan: () => []
    };

    vi.mocked(getNoteByDate).mockResolvedValue(mockFile);

    const targetDate = window.moment();
    
    // 1. Without forceWrite (should return early and do nothing)
    await habitManager.ensureHabitsInNote(targetDate, null, false);
    expect(processedData).toBe("");

    // 2. With forceWrite (should run and add the habit)
    await habitManager.ensureHabitsInNote(targetDate, null, true);
    expect(processedData).toContain("- [ ] [[Read Book]] [habit:: habit-test]");
  });

  it("should handle manual move rename event by updating archive state and props", async () => {
    const habit = {
      schemaVersion: 1,
      id: "habit-active",
      name: "Exercise Daily",
      linkText: "[[Exercise Daily]]",
      createdAt: Date.now(),
      order: 0,
      archived: false
    };
    habitManager.habitsMap.set(habit.id, habit);

    const mockFile = {
      path: "Core Habits/Archive/Exercise Daily.md",
      basename: "Exercise Daily"
    };

    mockPlugin.habitNoteManager = {
      detectManualMove: vi.fn().mockReturnValue("archived"),
      _habitToProps: vi.fn().mockReturnValue({ habit_id: "habit-active", archived: true }),
      updateHabitNoteProps: vi.fn().mockResolvedValue(null)
    };

    mockPlugin.app = {
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue({ frontmatter: { habit_id: "habit-active" } })
      },
      workspace: {
        getLeavesOfType: () => []
      }
    };

    await habitManager.handleVaultRename(mockFile, "Core Habits/Active/Exercise Daily.md");

    const updated = habitManager.getHabitById("habit-active");
    expect(updated.archived).toBe(true);
    expect(updated.archivedDate).not.toBeNull();
    expect(mockPlugin.habitNoteManager.updateHabitNoteProps).toHaveBeenCalledWith(
      "Core Habits/Archive/Exercise Daily.md", expect.objectContaining({ archived: true })
    );
  });

  it("should handle physical file rename event by updating name, linkText and history", async () => {
    const habit = {
      schemaVersion: 1,
      id: "habit-rename",
      name: "Old Name",
      linkText: "[[Old Name]]",
      createdAt: Date.now(),
      order: 0,
      archived: false,
      nameHistory: []
    };
    habitManager.habitsMap.set(habit.id, habit);

    const mockFile = {
      path: "Core Habits/Active/New Name.md",
      basename: "New Name"
    };

    mockPlugin.habitNoteManager = {
      detectManualMove: vi.fn().mockReturnValue(null),
      _habitToProps: vi.fn().mockReturnValue({ name: "New Name" }),
      updateHabitNoteProps: vi.fn().mockResolvedValue(null)
    };

    mockPlugin.app = {
      workspace: {
        getLeavesOfType: () => []
      }
    };

    await habitManager.handleVaultRename(mockFile, "Core Habits/Active/Old Name.md");

    const updated = habitManager.getHabitById("habit-rename");
    expect(updated.name).toBe("New Name");
    expect(updated.linkText).toBe("[[New Name]]");
    expect(updated.nameHistory).toContain("[[Old Name]]");
    expect(mockPlugin.habitNoteManager.updateHabitNoteProps).toHaveBeenCalledWith(
      "Core Habits/Active/New Name.md", expect.objectContaining({ name: "New Name" })
    );
  });

  it("should handle soft-delete of a habit by marking it deleted/archived and updating deletedHabits list in settings on file deletion", async () => {
    // Setup habit in memory
    const habit = {
      schemaVersion: 1,
      id: "habit-to-soft-delete",
      name: "Meditation",
      linkText: "[[Meditation]]",
      createdAt: Date.now(),
      order: 0,
      archived: false,
      deleted: false
    };
    habitManager.habitsMap.set(habit.id, habit);

    mockPlugin.settings.deletedHabits = [];
    mockPlugin.saveSettings = vi.fn().mockResolvedValue(null);
    mockPlugin.habitNoteManager = {
      getHabitFilePath: (name) => `Core Habits/Active/${name}.md`
    };

    // Simulate file deletion
    const mockDeletedFile = {
      path: "Core Habits/Active/Meditation.md",
      basename: "Meditation"
    };

    await habitManager.removeFile(mockDeletedFile);

    // Verify it is removed from memory map
    expect(habitManager.getHabitById("habit-to-soft-delete")).toBeNull();

    // Verify it's added to deletedHabits list in settings
    expect(mockPlugin.settings.deletedHabits).toContain("Meditation");
    expect(mockPlugin.settings.deletedHabits).toContain("[[Meditation]]");
    expect(mockPlugin.saveSettings).toHaveBeenCalled();
  });

  it("should restore a soft-deleted habit when calling addHabit with the same name", async () => {
    // Setup a soft-deleted habit in memory
    const softDeletedHabit = {
      schemaVersion: 1,
      id: "habit-soft-deleted",
      name: "Meditation",
      linkText: "[[Meditation]]",
      createdAt: Date.now() - 5000,
      order: 0,
      archived: true,
      deleted: true,
      schedule: { type: "weekly", days: [1, 2] },
      color: "blue"
    };
    habitManager.habitsMap.set(softDeletedHabit.id, softDeletedHabit);

    mockPlugin.settings.deletedHabits = ["Meditation", "[[Meditation]]"];
    mockPlugin.saveSettings = vi.fn().mockResolvedValue(null);
    mockPlugin.habitNoteManager = {
      _resolveHabitFile: () => ({ path: "Core Habits/Archive/Meditation.md" }),
      getHabitFilePath: (name, archived) => archived ? `Core Habits/Archive/${name}.md` : `Core Habits/Active/${name}.md`,
      _habitToProps: vi.fn().mockReturnValue({}),
      updateHabitNoteProps: vi.fn().mockResolvedValue(null)
    };

    mockPlugin.app = {
      fileManager: {
        renameFile: vi.fn().mockResolvedValue(null)
      }
    };

    // Attempt to add habit with the same name
    const inputData = {
      name: "Meditation",
      archived: false,
      schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] },
      color: "green"
    };

    const restored = await habitManager.addHabit(inputData);

    // Assert that it restored the same habit ID instead of creating a new one
    expect(restored.id).toBe("habit-soft-deleted");
    expect(restored.deleted).toBe(false);
    expect(restored.archived).toBe(false);
    expect(restored.color).toBe("green");
    expect(restored.schedule.days).toEqual([0, 1, 2, 3, 4, 5, 6]);

    // Verify it moved file back to Active/
    expect(mockPlugin.app.fileManager.renameFile).toHaveBeenCalled();
    // Verify it cleaned deletedHabits list in settings
    expect(mockPlugin.settings.deletedHabits).not.toContain("Meditation");
    expect(mockPlugin.saveSettings).toHaveBeenCalled();
  });
});
