import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HabitManager } from "../src/services/HabitManager.js";
import { HabitScanner } from "../src/services/HabitScanner.js";
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
      updateFileProps: vi.fn(),
      loadFile: vi.fn(),
      resolveHabitFile: vi.fn(),
      updateOrder: vi.fn(),
      loadAll: vi.fn().mockResolvedValue([])
    };

    mockPlugin = {
      settings: {
        language: "en",
        habitOrder: []
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
    mockRepository.loadAll.mockResolvedValue([existingHabit]);

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
      { path: "2026-06-20.md", content: "- [ ] [[Old Habit Name]] [habit:: habit-rename-test]\n- [habit-id:: habit-rename-test] [habit-note:: Old Habit Name] Great job today\nPlain [[Old Habit Name]] must remain" },
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
    expect(mockFiles[0].content).toContain("[habit-note:: New Habit Name] Great job today");
    expect(mockFiles[0].content).toContain("Plain [[Old Habit Name]] must remain");
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

  it("should persist habitOrder and reposition habit when restoring an archived habit", async () => {
    mockPlugin.settings.habitOrder = ["habit-1", "habit-2"];
    const persistSpy = vi.spyOn(habitManager, "persistHabitOrder");

    const archivedHabit = {
      schemaVersion: 3,
      id: "habit-archived-order",
      name: "Meditation",
      parentId: null,
      schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] },
      createdAt: Date.now() - 10000,
      archived: true
    };
    habitManager.habitsMap.set(archivedHabit.id, archivedHabit);

    await habitManager.restoreHabit(archivedHabit.id);

    expect(persistSpy).toHaveBeenCalled();
    expect(mockPlugin.settings.habitOrder).toContain("habit-archived-order");
    expect(mockPlugin.settings.habitOrder[mockPlugin.settings.habitOrder.length - 1]).toBe("habit-archived-order");
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

  it("adds only missing habit lines while preserving user tasks and existing habit states", async () => {
    mockPlugin.settings = { autoWriteHabits: true, marker: "[habit:: true]", dailyParentHeading: "## Habits", habitHeading: "### My Habits" };
    habitManager.habitsMap.set("one", { id: "one", name: "Read", linkText: "[[Read]]", schedule: { days: [1] }, order: 0 });
    habitManager.habitsMap.set("two", { id: "two", name: "Walk", linkText: "[[Walk]]", schedule: { days: [1] }, order: 1 });
    const file = { path: "daily.md", basename: "daily" };
    file.content = "## Habits\n### My Habits\n- [ ] Pay bills\n- [x] [[Read]] [habit:: one]\nMy own paragraph\n## Later\nKeep this too\n";
    mockPlugin.app = { vault: { process: vi.fn(async (_file, fn) => { file.content = fn(file.content); }) } };
    mockPlugin.habitScanner = new HabitScanner();
    vi.mocked(getNoteByDate).mockResolvedValue(file);
    await habitManager.ensureHabitsInNote({ day: () => 1 });
    const once = file.content;
    expect(once).toContain("- [ ] Pay bills\n- [x] [[Read]] [habit:: one]\nMy own paragraph");
    expect(once).toContain("- [ ] [[Walk]] [habit:: two]");
    expect(once).toContain("## Later\nKeep this too\n");
    await habitManager.ensureHabitsInNote({ day: () => 1 });
    expect(file.content).toBe(once);
  });

  it("keeps the prior habit value when a rename write fails", async () => {
    const original = { id: "one", name: "Read", linkText: "[[Read]]", nameHistory: [], schedule: { days: [1] }, createdAt: Date.now(), archived: false, order: 0 };
    habitManager.habitsMap.set("one", original);
    mockRepository.loadAll.mockResolvedValue([original]);
    mockRepository.update.mockRejectedValue(new Error("write failed"));
    await expect(habitManager.updateHabit("one", { name: "Books" })).rejects.toThrow("write failed");
    expect(habitManager.getHabitById("one")).toBe(original);
    expect(original.nameHistory).toEqual([]);
  });

  it("updates habitOrder in settings with zero markdown writes, and rolls back if saveSettings fails", async () => {
    const first = { id: "one", name: "Read", order: 0 };
    const second = { id: "two", name: "Walk", order: 1 };
    habitManager.habitsMap.set(first.id, first);
    habitManager.habitsMap.set(second.id, second);
    mockPlugin.settings.habitOrder = ["one", "two"];
    mockPlugin.saveSettings = vi.fn().mockResolvedValue();

    // Successful reorder: no markdown writes, updates habitOrder
    await habitManager.updateHabitsOrder(["two", "one"]);
    expect(mockRepository.updateOrder).not.toHaveBeenCalled();
    expect(mockPlugin.settings.habitOrder).toEqual(["two", "one"]);
    expect(habitManager.getHabitById("one").order).toBe(1);
    expect(habitManager.getHabitById("two").order).toBe(0);

    // Rollback test when saveSettings fails
    mockPlugin.saveSettings = vi.fn().mockRejectedValueOnce(new Error("disk full"));
    await expect(habitManager.updateHabitsOrder(["one", "two"])).rejects.toThrow("disk full");
    expect(mockPlugin.settings.habitOrder).toEqual(["two", "one"]);
    expect(habitManager.getHabitById("one").order).toBe(1);
    expect(habitManager.getHabitById("two").order).toBe(0);
  });

  it("reports a failed daily-note toggle instead of announcing a saved state", async () => {
    const habit = { id: "one", name: "Read", linkText: "[[Read]]" };
    mockPlugin.settings.marker = "[habit:: true]";
    mockPlugin.app = { vault: { process: vi.fn().mockRejectedValue(new Error("disk full")) } };
    await expect(habitManager.toggleHabitInNote({ path: "today.md" }, habit)).rejects.toThrow("disk full");
  });

  it("owns daily checklist creation, lookup, and toggle as one view-facing use case", async () => {
    const date = { day: () => 1 };
    const habit = { id: "one", name: "Read" };
    const file = { path: "Daily/2026-09-27.md" };
    mockPlugin.app = {};
    const ensure = vi.spyOn(habitManager, "ensureHabitsInNote").mockResolvedValue();
    const toggle = vi.spyOn(habitManager, "toggleHabitInNote").mockResolvedValue();
    vi.mocked(getNoteByDate).mockResolvedValueOnce(file);

    await expect(habitManager.toggleHabitForDate(date, habit, "completed")).resolves.toBe(true);
    expect(ensure).toHaveBeenCalledWith(date, habit, true);
    expect(getNoteByDate).toHaveBeenCalledWith(mockPlugin.app, date, true, mockPlugin.settings);
    expect(toggle).toHaveBeenCalledWith(file, habit, "completed");
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
      getActiveFolder: () => "Core Habits/Active",
      getArchiveFolder: () => "Core Habits/Archive",
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
    expect(mockRepository.updateFileProps).toHaveBeenCalledWith(
      mockFile, expect.objectContaining({ archived: true })
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
      getActiveFolder: () => "Core Habits/Active",
      getArchiveFolder: () => "Core Habits/Archive",
      _habitToProps: vi.fn().mockReturnValue({ name: "New Name" }),
      updateHabitNoteProps: vi.fn().mockResolvedValue(null)
    };

    mockPlugin.app = {
      metadataCache: { getFileCache: () => ({ frontmatter: { habit_id: "habit-rename" } }) },
      workspace: {
        getLeavesOfType: () => []
      }
    };

    await habitManager.handleVaultRename(mockFile, "Core Habits/Active/Old Name.md");

    const updated = habitManager.getHabitById("habit-rename");
    expect(updated.name).toBe("New Name");
    expect(updated.linkText).toBe("[[New Name]]");
    expect(updated.nameHistory).toContain("[[Old Name]]");
    expect(mockRepository.updateFileProps).toHaveBeenCalledWith(
      mockFile, expect.objectContaining({ name: "New Name" })
    );
  });

  it("should successfully sync rename using oldPath fallback when metadataCache is unindexed", async () => {
    const habit = {
      schemaVersion: 1,
      id: "habit-cache-lag",
      name: "Old Gym",
      linkText: "[[Old Gym]]",
      createdAt: Date.now(),
      order: 0,
      archived: false,
      nameHistory: []
    };
    habitManager.habitsMap.set(habit.id, habit);

    const mockFile = {
      path: "Core Habits/Active/New Gym.md",
      basename: "New Gym"
    };

    mockPlugin.habitNoteManager = {
      detectManualMove: vi.fn().mockReturnValue(null),
      getActiveFolder: () => "Core Habits/Active",
      getArchiveFolder: () => "Core Habits/Archive",
      getHabitIdByPath: vi.fn((path) => path === "Core Habits/Active/Old Gym.md" ? "habit-cache-lag" : null),
      readHabitNoteProps: vi.fn().mockResolvedValue(null),
      indexHabitFile: vi.fn()
    };

    // metadataCache returns null/empty because it hasn't indexed the renamed file yet
    mockPlugin.app = {
      metadataCache: { getFileCache: () => null },
      workspace: { getLeavesOfType: () => [] }
    };

    await habitManager.handleVaultRename(mockFile, "Core Habits/Active/Old Gym.md");

    const updated = habitManager.getHabitById("habit-cache-lag");
    expect(updated.name).toBe("New Gym");
    expect(updated.linkText).toBe("[[New Gym]]");
    expect(updated.nameHistory).toContain("[[Old Gym]]");
    expect(mockPlugin.habitNoteManager.indexHabitFile).toHaveBeenCalledWith("habit-cache-lag", "Core Habits/Active/New Gym.md");
    expect(mockRepository.updateFileProps).toHaveBeenCalledWith(
      mockFile, expect.objectContaining({ name: "New Gym" })
    );
  });

  it("should successfully sync rename using readHabitNoteProps disk fallback when metadataCache is null", async () => {
    const habit = {
      schemaVersion: 1,
      id: "habit-disk-read",
      name: "Old Read",
      linkText: "[[Old Read]]",
      createdAt: Date.now(),
      order: 0,
      archived: false,
      nameHistory: []
    };
    habitManager.habitsMap.set(habit.id, habit);

    const mockFile = {
      path: "Core Habits/Active/New Read.md",
      basename: "New Read"
    };

    mockPlugin.habitNoteManager = {
      detectManualMove: vi.fn().mockReturnValue(null),
      getActiveFolder: () => "Core Habits/Active",
      getArchiveFolder: () => "Core Habits/Archive",
      getHabitIdByPath: vi.fn().mockReturnValue(null),
      readHabitNoteProps: vi.fn().mockResolvedValue({ habit_id: "habit-disk-read" }),
      indexHabitFile: vi.fn()
    };

    mockPlugin.app = {
      metadataCache: { getFileCache: () => null },
      workspace: { getLeavesOfType: () => [] }
    };

    await habitManager.handleVaultRename(mockFile, "Core Habits/Active/Old Read.md");

    const updated = habitManager.getHabitById("habit-disk-read");
    expect(updated.name).toBe("New Read");
    expect(updated.linkText).toBe("[[New Read]]");
    expect(updated.nameHistory).toContain("[[Old Read]]");
    expect(mockPlugin.habitNoteManager.readHabitNoteProps).toHaveBeenCalledWith("Core Habits/Active/New Read.md");
    expect(mockRepository.updateFileProps).toHaveBeenCalledWith(
      mockFile, expect.objectContaining({ name: "New Read" })
    );
  });

  it("ignores a rename outside the habit folders even if the basename matches", async () => {
    const habit = { id: "one", name: "Read", linkText: "[[Read]]", nameHistory: [] };
    habitManager.habitsMap.set(habit.id, habit);
    mockPlugin.habitNoteManager = {
      getActiveFolder: () => "Core Habits/Active",
      getArchiveFolder: () => "Core Habits/Archive"
    };
    const file = { path: "Personal/Books.md", basename: "Books" };
    await habitManager.handleVaultRename(file, "Personal/Read.md");
    expect(habitManager.getHabitById("one")).toBe(habit);
    expect(mockRepository.updateFileProps).not.toHaveBeenCalled();
  });

  it("removes an externally deleted habit from memory without writing a secondary index", async () => {
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
      getHabitFilePath: (name) => `Core Habits/Active/${name}.md`,
      getActiveFolder: () => "Core Habits/Active",
      getArchiveFolder: () => "Core Habits/Archive"
    };

    // Simulate file deletion
    const mockDeletedFile = {
      path: "Core Habits/Active/Meditation.md",
      basename: "Meditation"
    };

    await habitManager.removeFile(mockDeletedFile);

    // Verify it is removed from memory map
    expect(habitManager.getHabitById("habit-to-soft-delete")).toBeNull();

    expect(mockPlugin.settings.deletedHabits).toEqual([]);
    expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
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
      color: "blue",
      notes: "Private user text",
      atomicDescription: { cue: "After breakfast" }
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
      color: "green",
      notes: null,
      atomicDescription: {}
    };

    const restored = await habitManager.addHabit(inputData);

    // Assert that it restored the same habit ID instead of creating a new one
    expect(restored.id).toBe("habit-soft-deleted");
    expect(restored.deleted).toBe(false);
    expect(restored.archived).toBe(false);
    expect(restored.color).toBe("green");
    expect(restored.schedule.days).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(restored.notes).toBe("Private user text");
    expect(restored.atomicDescription).toEqual({ cue: "After breakfast" });

    // Verify it moved file back to Active/
    expect(mockRepository.restore).toHaveBeenCalledWith(expect.objectContaining({ id: softDeletedHabit.id, deleted: false }));
    // Legacy settings data is preserved, but the note frontmatter owns the live state.
    expect(mockPlugin.settings.deletedHabits).toContain("Meditation");
    expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
  });

  it("should restore all archived habits to active state with restoreAllArchivedHabits", async () => {
    const habit1 = {
      schemaVersion: 1,
      id: "arch-1",
      name: "Old Habit 1",
      archived: true,
      deleted: false,
      order: 0
    };
    const habit2 = {
      schemaVersion: 1,
      id: "arch-2",
      name: "Old Habit 2",
      archived: true,
      deleted: false,
      order: 1
    };
    habitManager.habitsMap.set(habit1.id, habit1);
    habitManager.habitsMap.set(habit2.id, habit2);

    const result = await habitManager.restoreAllArchivedHabits();
    expect(result.restoredCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(habitManager.getArchivedHabits()).toHaveLength(0);
    expect(habitManager.getActiveHabits()).toHaveLength(2);
  });

  it("removes archived habits from the list while retaining recoverable records", async () => {
    const habit1 = {
      schemaVersion: 1,
      id: "arch-1",
      name: "Old Habit 1",
      archived: true,
      deleted: false,
      order: 0
    };
    const habit2 = {
      schemaVersion: 1,
      id: "arch-2",
      name: "Old Habit 2",
      archived: true,
      deleted: false,
      order: 1
    };
    habitManager.habitsMap.set(habit1.id, habit1);
    habitManager.habitsMap.set(habit2.id, habit2);

    mockPlugin.habitNoteManager = {
      _resolveHabitFile: () => null,
      getHabitFilePath: (name) => `Core Habits/Archive/${name}.md`,
      _habitToProps: vi.fn().mockReturnValue({}),
      updateHabitNoteProps: vi.fn().mockResolvedValue(null)
    };
    mockPlugin.saveSettings = vi.fn().mockResolvedValue(null);

    const deletedCount = await habitManager.removeArchivedHabits();
    expect(deletedCount).toBe(2);
    expect(habitManager.getArchivedHabits()).toHaveLength(0);
    expect(habitManager.getRemovedHabits()).toHaveLength(2);
    expect(mockRepository.delete).not.toHaveBeenCalled();
  });

  it("rejects restoring an archive when the active limit has been reached", async () => {
    for (let index = 0; index < 50; index++) {
      habitManager.habitsMap.set(`active-${index}`, { id: `active-${index}`, name: `Habit ${index}`, archived: false });
    }
    habitManager.habitsMap.set("archived", { id: "archived", name: "Archived", archived: true });
    await expect(habitManager.restoreHabit("archived")).rejects.toThrow();
    expect(mockRepository.restore).not.toHaveBeenCalled();
  });

  it("restores a removed habit without creating a second ID or losing its note", async () => {
    const removed = { id: "removed", name: "Read", linkText: "[[Read]]", archived: true, deleted: true, order: 2 };
    habitManager.habitsMap.set(removed.id, removed);
    mockPlugin.settings.deletedHabits = ["Read", "[[Read]]"];
    mockPlugin.saveSettings = vi.fn().mockResolvedValue(null);
    const restored = await habitManager.restoreRemovedHabit(removed.id);
    expect(restored.id).toBe(removed.id);
    expect(mockRepository.restore).toHaveBeenCalledWith(restored);
    expect(mockRepository.create).not.toHaveBeenCalled();
    expect(habitManager.getActiveHabits()).toContainEqual(restored);
    expect(mockPlugin.settings.deletedHabits).toEqual(["Read", "[[Read]]"]);
    expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
  });

  it("loads removed habits from note metadata after restart", async () => {
    const removed = { id: "removed", name: "Read", archived: true, deleted: true, schemaVersion: 1 };
    mockRepository.loadAll.mockResolvedValue([removed]);
    await habitManager.initialize();
    expect(habitManager.getRemovedHabits()).toEqual([removed]);
    expect(habitManager.getArchivedHabits()).toEqual([]);
  });

  it("leaves the prior habit state intact when the archive write fails", async () => {
    const habit = { id: "active", name: "Read", linkText: "[[Read]]", archived: false, deleted: false };
    habitManager.habitsMap.set(habit.id, habit);
    mockRepository.loadAll.mockResolvedValue([habit]);
    mockRepository.archive.mockRejectedValue(new Error("disk full"));
    await expect(habitManager.removeHabit(habit.id)).rejects.toThrow("disk full");
    expect(habitManager.getHabitById(habit.id)).toEqual(habit);
    expect(mockPlugin.saveSettings).toBeUndefined();
  });

  it("should calculate and freeze longest streak when archiving a habit", async () => {
    const activeHabit = {
      schemaVersion: 1,
      id: "habit-streak-test",
      name: "Daily Meditation",
      schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] },
      createdAt: Date.now() - 100000,
      order: 0,
      archived: false,
      savedLongestStreak: 0
    };
    habitManager.habitsMap.set(activeHabit.id, activeHabit);

    mockPlugin.streakCalculator = {
      calculate: vi.fn().mockResolvedValue({ longestStreak: 19, currentStreak: 5 })
    };

    const archived = await habitManager.archiveHabit("habit-streak-test");
    expect(archived.archived).toBe(true);
    expect(archived.savedLongestStreak).toBe(19);
    expect(mockPlugin.streakCalculator.calculate).toHaveBeenCalledWith(activeHabit);
    expect(mockRepository.archive).toHaveBeenCalledWith(expect.objectContaining({
      id: "habit-streak-test",
      savedLongestStreak: 19
    }));
  });

  describe("t() translation delegation", () => {
    it("should delegate to plugin.translationManager if present", () => {
      mockPlugin.translationManager = {
        t: vi.fn().mockReturnValue("Translated Text")
      };
      const text = habitManager.t("some_key", { param: "val" });
      expect(text).toBe("Translated Text");
      expect(mockPlugin.translationManager.t).toHaveBeenCalledWith("some_key", { param: "val" });
    });

    it("should fallback to TranslationManager instance if plugin.translationManager is not present", () => {
      delete mockPlugin.translationManager;
      mockPlugin.settings.language = "en";
      const text = habitManager.t("schedule_days_count", { count: 5 });
      expect(text).toContain("5 Days");
    });
  });

  describe("syncFile concurrency and auto-move lifecycle", () => {
    let mockFile;
    let mockHabit;

    beforeEach(() => {
      vi.useFakeTimers();

      mockFile = {
        path: "Habits/Active/Reading.md",
        basename: "Reading"
      };

      mockHabit = {
        id: "habit-reading",
        name: "Reading",
        archived: true
      };

      mockPlugin.habitNoteManager = {
        getActiveFolder: vi.fn().mockReturnValue("Habits/Active"),
        getArchiveFolder: vi.fn().mockReturnValue("Habits/Archive"),
        readHabitNoteProps: vi.fn().mockResolvedValue({ archived: true }),
        propsToHabit: vi.fn().mockReturnValue(mockHabit),
        getHabitFilePath: vi.fn().mockImplementation((name, archived) => 
          archived ? `Habits/Archive/${name}.md` : `Habits/Active/${name}.md`
        ),
        _resolveHabitFile: vi.fn().mockReturnValue(mockFile),
        ensureFolders: vi.fn().mockResolvedValue(true)
      };

      mockPlugin.app = {
        vault: {
          cachedRead: vi.fn().mockResolvedValue("content"),
          getAbstractFileByPath: vi.fn().mockReturnValue(mockFile),
          rename: vi.fn().mockResolvedValue(true)
        },
        metadataCache: { getFileCache: () => ({ frontmatter: { habit_id: "habit-reading" } }) },
        fileManager: {
          renameFile: vi.fn().mockResolvedValue(true)
        }
      };

      mockPlugin.runWithLock = vi.fn().mockImplementation(cb => cb());
      mockPlugin.saveSettings = vi.fn().mockResolvedValue(null);
      mockRepository.loadFile.mockImplementation(() => Promise.resolve(mockPlugin.habitNoteManager.propsToHabit()));
      mockRepository.resolveHabitFile.mockImplementation(() => mockPlugin.habitNoteManager._resolveHabitFile());
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should debounce multiple rapid syncFile events for the same habit to a single rename", async () => {
      // Trigger syncFile 3 times rapidly
      await habitManager.syncFile(mockFile);
      await habitManager.syncFile(mockFile);
      await habitManager.syncFile(mockFile);

      expect(habitManager._pendingMoveTimeouts.size).toBe(1);
      expect(mockPlugin.app.vault.rename).not.toHaveBeenCalled();

      // Fast-forward timers by 500ms
      await vi.advanceTimersByTimeAsync(500);

      expect(mockPlugin.app.vault.rename).toHaveBeenCalledTimes(1);
      expect(mockPlugin.app.vault.rename).toHaveBeenCalledWith(
        mockFile,
        "Habits/Archive/Reading.md"
      );
      expect(habitManager._pendingMoveTimeouts.size).toBe(0);
    });

    it("should cancel pending move if habit state is reverted before timeout executes", async () => {
      // 1. Initial sync says archived: true (in Active/ -> needs move)
      await habitManager.syncFile(mockFile);
      expect(habitManager._pendingMoveTimeouts.has("habit-reading")).toBe(true);

      // 2. User quickly reverts to archived: false
      const unarchivedHabit = { ...mockHabit, archived: false };
      mockPlugin.habitNoteManager.propsToHabit.mockReturnValue(unarchivedHabit);
      mockPlugin.habitNoteManager.readHabitNoteProps.mockResolvedValue({ archived: false });

      await habitManager.syncFile(mockFile);

      // Pending move should be cancelled immediately
      expect(habitManager._pendingMoveTimeouts.has("habit-reading")).toBe(false);

      await vi.advanceTimersByTimeAsync(600);
      expect(mockPlugin.app.vault.rename).not.toHaveBeenCalled();
    });

    it("should cancel pending move timeout if file is deleted before timeout executes", async () => {
      await habitManager.syncFile(mockFile);
      expect(habitManager._pendingMoveTimeouts.has("habit-reading")).toBe(true);

      // File gets deleted
      await habitManager.removeFile(mockFile);
      expect(habitManager._pendingMoveTimeouts.has("habit-reading")).toBe(false);

      await vi.advanceTimersByTimeAsync(600);
      expect(mockPlugin.app.vault.rename).not.toHaveBeenCalled();
    });

    it("should cancel all pending timeouts on destroy()", async () => {
      await habitManager.syncFile(mockFile);
      expect(habitManager._pendingMoveTimeouts.size).toBe(1);

      habitManager.destroy();
      expect(habitManager._pendingMoveTimeouts.size).toBe(0);

      await vi.advanceTimersByTimeAsync(600);
      expect(mockPlugin.app.vault.rename).not.toHaveBeenCalled();
    });

    it("should not rename if currentFile path already matches destination path", async () => {
      // Mock file already at destination
      mockFile.path = "Habits/Archive/Reading.md";
      mockPlugin.habitNoteManager._resolveHabitFile.mockReturnValue(mockFile);

      await habitManager.syncFile(mockFile);
      await vi.advanceTimersByTimeAsync(500);

      expect(mockPlugin.app.vault.rename).not.toHaveBeenCalled();
    });
  });

  describe("Decoupled Workspace Events", () => {
    it("should trigger core-habits:cache-invalidated on workspace when invalidateCaches is called", () => {
      const mockTrigger = vi.fn();
      mockPlugin.app = {
        workspace: {
          trigger: mockTrigger
        }
      };

      habitManager.invalidateCaches();

      expect(mockTrigger).toHaveBeenCalledWith("core-habits:cache-invalidated");
    });
  });

  describe("Habit Scheduling Logic (Delegated to HabitEntity)", () => {
    it("should return true for days included in habit schedule", () => {
      const dailyHabit = { schedule: { days: [0, 1, 2, 3, 4, 5, 6] } };
      const mwfHabit = { schedule: { days: [1, 3, 5] } };

      expect(habitManager.isHabitScheduledForDay(dailyHabit, 0)).toBe(true);
      expect(habitManager.isHabitScheduledForDay(dailyHabit, 5)).toBe(true);

      expect(habitManager.isHabitScheduledForDay(mwfHabit, 1)).toBe(true);
      expect(habitManager.isHabitScheduledForDay(mwfHabit, 2)).toBe(false);
      expect(habitManager.isHabitScheduledForDay(mwfHabit, 5)).toBe(true);
      expect(habitManager.isHabitScheduledForDay(mwfHabit, 6)).toBe(false);
    });

    it("should return false when schedule or days is missing or malformed", () => {
      expect(habitManager.isHabitScheduledForDay({}, 1)).toBe(false);
      expect(habitManager.isHabitScheduledForDay({ schedule: {} }, 1)).toBe(false);
      expect(habitManager.isHabitScheduledForDay(null, 1)).toBe(false);
    });
  });

  describe("Single Authority Habit Resolution (findHabitByNameOrAlias)", () => {
    it("should resolve habit by exact name, linkText, and historical alias", () => {
      const habit = {
        id: "habit-1",
        name: "قراءة القرآن",
        linkText: "[[قراءة القرآن]]",
        nameHistory: ["[[تلاوة]]", "ورد يومي"],
        archived: false
      };
      habitManager.habitsMap.set(habit.id, habit);

      // Exact name
      expect(habitManager.findHabitByNameOrAlias("قراءة القرآن")).toBe(habit);

      // Link text format
      expect(habitManager.findHabitByNameOrAlias("[[قراءة القرآن]]")).toBe(habit);

      // Arabic folding (أ / ا / إ / آ)
      expect(habitManager.findHabitByNameOrAlias("قراءه القران")).toBe(habit);

      // Historical alias
      expect(habitManager.findHabitByNameOrAlias("تلاوة")).toBe(habit);
      expect(habitManager.findHabitByNameOrAlias("ورد يومي")).toBe(habit);

      // Non-existent
      expect(habitManager.findHabitByNameOrAlias("عادة غير موجودة")).toBeNull();
      expect(habitManager.findHabitByNameOrAlias("")).toBeNull();
      expect(habitManager.findHabitByNameOrAlias(null)).toBeNull();
    });
  });

  describe("ensureHabitsInNote safe scanning on empty notes", () => {
    it("should safely populate habits in an empty daily note without throwing Habit section could not be scanned safely", async () => {
      mockPlugin.settings = {
        autoWriteHabits: true,
        marker: "[habit:: true]",
        dailyParentHeading: "## Habits",
        habitHeading: "### Track Habits"
      };
      mockPlugin.habitScanner = new HabitScanner();
      const habit = {
        id: "h-empty",
        name: "Morning Walk",
        linkText: "[[Morning Walk]]",
        schedule: { days: [1] },
        order: 0,
        archived: false
      };
      habitManager.habitsMap.set(habit.id, habit);

      const emptyFile = { path: "empty-daily.md", basename: "empty-daily" };
      let savedContent = "";
      mockPlugin.app = {
        vault: {
          process: vi.fn(async (_file, fn) => {
            savedContent = fn("");
            return _file;
          })
        }
      };
      vi.mocked(getNoteByDate).mockResolvedValue(emptyFile);

      await expect(habitManager.ensureHabitsInNote({ day: () => 1 })).resolves.not.toThrow();
      expect(savedContent).toContain("## Habits");
      expect(savedContent).toContain("### Track Habits");
      expect(savedContent).toContain("- [ ] [[Morning Walk]] [habit:: h-empty]");
    });

    it("should skip rescanning daily note if no habits were missing", async () => {
      mockPlugin.settings = {
        autoWriteHabits: true,
        marker: "[habit:: true]",
        dailyParentHeading: "## Habits",
        habitHeading: "### Track Habits"
      };
      mockPlugin.habitScanner = new HabitScanner();
      mockPlugin.statsService = { rescanFile: vi.fn() };
      const habit = {
        id: "h-present",
        name: "Morning Walk",
        linkText: "[[Morning Walk]]",
        schedule: { days: [1] },
        order: 0,
        archived: false
      };
      habitManager.habitsMap.set(habit.id, habit);

      const existingContent = "## Habits\n### Track Habits\n- [ ] [[Morning Walk]] [habit:: h-present]\n";
      const file = { path: "daily.md", basename: "daily" };
      mockPlugin.app = {
        vault: {
          process: vi.fn(async (_file, fn) => {
            fn(existingContent);
            return _file;
          })
        }
      };
      vi.mocked(getNoteByDate).mockResolvedValue(file);

      await habitManager.ensureHabitsInNote({ day: () => 1 });
      expect(mockPlugin.statsService.rescanFile).not.toHaveBeenCalled();
    });
  });

  describe("Lifecycle destroy and external _order.md sync", () => {
    it("should clear timers and maps on destroy()", () => {
      const timer1 = setTimeout(() => {}, 10000);
      const timer2 = setTimeout(() => {}, 10000);
      habitManager._pendingMoveTimeouts = new Map([["h-1", timer1]]);
      habitManager._checkpointTimers = new Map([["h-1", timer2]]);
      habitManager.habitsMap.set("h-1", { id: "h-1", name: "Habit 1" });

      habitManager.destroy();

      expect(habitManager._pendingMoveTimeouts.size).toBe(0);
      expect(habitManager._checkpointTimers.size).toBe(0);
      expect(habitManager.habitsMap.size).toBe(0);
    });

    it("should reconcile habit order when syncFile is called with _order.md", async () => {
      const orderFile = { path: "Core Habits/_order.md" };
      habitManager.isInitialized = true;
      habitManager.vaultOrderStore = {
        getOrderFilePath: () => "Core Habits/_order.md",
        readOrder: vi.fn().mockResolvedValue({ habitOrder: ["h-2", "h-1"], orderVersion: 1 })
      };
      habitManager.reconcileHabitOrder = vi.fn().mockResolvedValue();
      habitManager.invalidateCaches = vi.fn();

      await habitManager.syncFile(orderFile);

      expect(habitManager.reconcileHabitOrder).toHaveBeenCalledOnce();
      expect(habitManager.invalidateCaches).toHaveBeenCalledOnce();
    });

    it("should ignore syncFile for _order.md when HabitManager is not initialized", async () => {
      const orderFile = { path: "Core Habits/_order.md" };
      habitManager.isInitialized = false;
      habitManager.vaultOrderStore = {
        getOrderFilePath: () => "Core Habits/_order.md",
        readOrder: vi.fn().mockResolvedValue({ habitOrder: ["h-2", "h-1"], orderVersion: 1 })
      };
      habitManager.reconcileHabitOrder = vi.fn().mockResolvedValue();
      habitManager.invalidateCaches = vi.fn();

      await habitManager.syncFile(orderFile);

      expect(habitManager.reconcileHabitOrder).not.toHaveBeenCalled();
      expect(habitManager.invalidateCaches).not.toHaveBeenCalled();
    });
  });
});



