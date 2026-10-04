import { describe, it, expect, beforeEach, vi } from "vitest";
import { HabitNoteManager } from "../src/services/HabitNoteManager.js";
import { HabitEntity } from "../src/domain/HabitEntity.js";
import { HABIT_SCHEMA_VERSION } from "../src/domain/HabitDataContract.js";
import { canonicalHabit } from "./fixtures/habitFixtures.js";
import { TFile } from "obsidian";
import { Utils } from "../src/utils/Utils.js";

describe("Habit Serialization Characterization Tests", () => {
  let mockApp;
  let mockPlugin;
  let habitNoteManager;

  beforeEach(() => {
    mockApp = {
      vault: {
        adapter: {
          getBasePath: () => "/vault"
        }
      }
    };
    mockPlugin = {
      settings: {
        habitNotesFolder: "Core Habits",
        language: "en"
      }
    };
    habitNoteManager = new HabitNoteManager(mockApp, mockPlugin);
  });

  it("characterizes the current serialization mapping (_habitToProps)", () => {
    const props = habitNoteManager._habitToProps(canonicalHabit);
    
    // Check what is currently mapped in Sparse v2
    expect(props.schema_version).toBe(2);
    expect(props.habit_id).toBe(canonicalHabit.id);
    expect(props.habit_type).toBe(canonicalHabit.habitType);
    expect(props.color).toBe(canonicalHabit.color);
    expect(props.schedule).toBe("1,3,5");
    expect(props.days).toBeUndefined(); // Sparse v2 omits redundant days string
    expect(props.current_level).toBe(canonicalHabit.currentLevel);
    expect(props.archived).toBe("true"); // Note it is serialized as string "true" / "false"
    expect(props.parent_id).toBe(canonicalHabit.parentId);
    expect(props.order).toBe(canonicalHabit.order);
    expect(props.name_history).toEqual(["[[Read Books]]", "[[Daily Reading]]"]);
    
    // Check levelData mapping (sparse: only goal is serialized if present)
    expect(props.level_1_goal).toBe(canonicalHabit.levelData[0].goal);
    expect(props.level_1_achieved).toBeUndefined();
    
    // Verifies correct mapping of archived fields (P0-2)
    expect(props.archived_at).toBe("2024-06-21");
    expect(props.restored_at).toBeUndefined(); // Sparse: omitted when null
    expect(props.saved_longest_streak).toBe(12);

    const restoredProps = habitNoteManager._habitToProps({ ...canonicalHabit, archived: false });
    expect(restoredProps.archived_at).toBe("2024-06-21");

    // Explicit false clears a previously soft-deleted file.
    expect(props.deleted).toBe("false");

    // Check serialization when deleted is true
    const deletedHabit = { ...canonicalHabit, deleted: true, nameHistory: [] };
    const deletedProps = habitNoteManager._habitToProps(deletedHabit);
    expect(deletedProps.deleted).toBe("true");
    expect(deletedProps.name_history).toBeUndefined(); // Sparse: omitted when empty
  });

  it("deserializes legacy ||| delimited name_history string with full backward compatibility", () => {
    const legacyProps = {
      ...habitNoteManager._habitToProps(canonicalHabit),
      name_history: "[[Old Habit 1]]|||[[Old Habit 2]]"
    };
    const mockFile = new TFile("Core Habits/Archive/Reading Books.md");
    const habit = habitNoteManager.propsToHabit(mockFile, legacyProps);
    expect(habit.nameHistory).toEqual(["[[Old Habit 1]]", "[[Old Habit 2]]"]);
  });

  it("characterizes the deserialization mapping (propsToHabit)", () => {
    const props = habitNoteManager._habitToProps(canonicalHabit);
    const mockFile = new TFile("Core Habits/Archive/Reading Books.md");
    
    const deserialized = habitNoteManager.propsToHabit(mockFile, props);
    
    expect(deserialized.schemaVersion).toBe(2);
    expect(deserialized.id).toBe(canonicalHabit.id);
    expect(deserialized.name).toBe(canonicalHabit.name);
    expect(deserialized.habitType).toBe(canonicalHabit.habitType);
    expect(deserialized.color).toBe(canonicalHabit.color);
    expect(deserialized.schedule.type).toBe("weekly");
    expect(deserialized.schedule.days).toEqual([1, 3, 5]);
    expect(deserialized.currentLevel).toBe(canonicalHabit.currentLevel);
    expect(deserialized.archived).toBe(true);
    expect(deserialized.parentId).toBe(canonicalHabit.parentId);
    expect(deserialized.order).toBe(canonicalHabit.order);
    expect(deserialized.nameHistory).toEqual(canonicalHabit.nameHistory);
    
    // Verifies correct restoration of previously missing fields (P0-2)
    expect(deserialized.archivedDate).toBe(window.moment("2024-06-21").valueOf());
    expect(deserialized.restoredDate).toBeNull();
    expect(deserialized.savedLongestStreak).toBe(12);

    // Check deleted flag deserialization
    expect(deserialized.deleted).toBe(false);

    // Check deserialization when deleted is true
    const deletedProps = { ...props, deleted: "true" };
    const deserializedDeleted = habitNoteManager.propsToHabit(mockFile, deletedProps);
    expect(deserializedDeleted.deleted).toBe(true);
  });

  it("defaults new HabitEntity instances to Schema v3", () => {
    const habit = new HabitEntity({ name: "Exercise" });
    expect(habit.schemaVersion).toBe(3);
    expect(HABIT_SCHEMA_VERSION).toBe(3);
  });

  it("serializes Schema v3 habits omitting order, current_level, and level goals from frontmatter", () => {
    const v3Habit = {
      ...canonicalHabit,
      schemaVersion: 3,
      currentLevel: 4,
      order: 10
    };
    const props = habitNoteManager._habitToProps(v3Habit);
    expect(props.schema_version).toBe(3);
    expect(props.order).toBeUndefined();
    expect(props.current_level).toBeUndefined();
    expect(props.level_1_goal).toBeUndefined();
    expect(props.habit_id).toBe(canonicalHabit.id);
  });

  it("deserializes Schema v3 notes deriving currentLevel dynamically without requiring frontmatter current_level or order", () => {
    const v3Props = {
      schema_version: 3,
      habit_id: "habit-v3-test",
      habit_type: "build",
      color: "blue",
      schedule: "daily",
      archived: "false",
      saved_longest_streak: 25 // Should derive level 4 (21-89 days)
    };
    const mockFile = new TFile("Core Habits/Active/Reading.md");
    mockFile.basename = "Reading";
    const deserialized = habitNoteManager.propsToHabit(mockFile, v3Props);

    expect(deserialized.schemaVersion).toBe(3);
    expect(deserialized.currentLevel).toBe(4);
    expect(deserialized.order).toBe(0);
    expect(deserialized.savedLongestStreak).toBe(25);
  });

  it("does not resurrect old body notes after frontmatter notes are cleared", () => {
    const file = new TFile("Core Habits/Active/Reading Books.md");
    const props = { ...habitNoteManager._habitToProps({ ...canonicalHabit, notes: "" }), archived: "false" };
    const body = "> [!note] Notes\n> Old body notes\n";
    const habit = habitNoteManager.propsToHabit(file, props, body);
    expect(habit.notes).toBe("");
  });

  it("extracts notes from markdown body when frontmatter lacks notes property", () => {
    const file = new TFile("Core Habits/Active/Reading Books.md");
    const props = { schema_version: 3, habit_id: "habit-123", habit_type: "build" };
    const bodyAr = "Intro\n> **مساحة حرة للتدوين:**\n> ملاحظة خاصة بالعادة\n---\n";
    const habitAr = habitNoteManager.propsToHabit(file, props, bodyAr);
    expect(habitAr.notes).toBe("ملاحظة خاصة بالعادة");

    const bodyEn = "Intro\n> **Free Space for Notes:**\n> English habit notes\n---\n";
    const habitEn = habitNoteManager.propsToHabit(file, props, bodyEn);
    expect(habitEn.notes).toBe("English habit notes");
  });

  it("ignores placeholder text in markdown body when extracting notes", () => {
    const file = new TFile("Core Habits/Active/Reading Books.md");
    const props = { schema_version: 3, habit_id: "habit-123", habit_type: "build" };
    const bodyWithPlaceholder = "Intro\n> **مساحة حرة للتدوين:**\n> اكتب هنا أي ملاحظات أو أفكار حول هذه العادة...\n---\n";
    const habit = habitNoteManager.propsToHabit(file, props, bodyWithPlaceholder);
    expect(habit.notes).toBe("");
  });

  it("uses processFrontMatter to update properties atomically and normalizes name_history to an array", async () => {
    const mockFile = new TFile("Core Habits/Active/Reading Books.md");
    mockApp.vault.getAbstractFileByPath = () => mockFile;
    let frontmatterResult = {};
    mockApp.fileManager = {
      processFrontMatter: vi.fn(async (file, cb) => {
        cb(frontmatterResult);
      })
    };

    await habitNoteManager.updateHabitNoteProps("Core Habits/Active/Reading Books.md", {
      name_history: "[[Old 1]]|||[[Old 2]]",
      current_level: "3",
      archived: "true"
    });

    expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledWith(mockFile, expect.any(Function));
    expect(frontmatterResult.name_history).toEqual(["[[Old 1]]", "[[Old 2]]"]);
    expect(frontmatterResult.current_level).toBe(3);
    expect(frontmatterResult.archived).toBe(true);
  });

  it("uses processFrontMatter when creating habit notes if fileManager is available", async () => {
    const createdFile = new TFile("Core Habits/Archive/Reading Books.md");
    mockApp.vault.createFolder = vi.fn().mockResolvedValue({});
    let created = false;
    mockApp.vault.create = vi.fn(async () => {
      created = true;
      return createdFile;
    });
    let frontmatterResult = {};
    mockApp.fileManager = {
      processFrontMatter: vi.fn(async (file, cb) => {
        cb(frontmatterResult);
      })
    };
    mockApp.vault.getAbstractFileByPath = (p) => {
      if (created && p === "Core Habits/Archive/Reading Books.md") return createdFile;
      return null;
    };

    const file = await habitNoteManager.createHabitNote(canonicalHabit);
    expect(file).toBe(createdFile);
    expect(mockApp.vault.create).toHaveBeenCalledWith(
      "Core Habits/Archive/Reading Books.md",
      expect.stringContaining("---\n---\n\n```core-habits")
    );
    expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalled();
    expect(frontmatterResult.habit_id).toBe(canonicalHabit.id);
  });

  it("preserves the complete note body while patching frontmatter", async () => {
    const habit = { ...canonicalHabit, archived: false, notes: "My official notes content" };
    const file = new TFile("Core Habits/Active/Reading Books.md");
    const original = "---\nhabit_id: habit-1234567890\n---\nMy private text\n## 📓 سجل التدوينات والصوتيات\n**2026-05-18:** Done reading.\n";
    file.content = original;
    mockApp.vault.getAbstractFileByPath = (path) => path === file.path ? file : null;
    mockApp.metadataCache = { getFileCache: () => ({ frontmatter: { habit_id: habit.id } }) };
    const frontmatter = { habit_id: habit.id };
    mockApp.fileManager = { processFrontMatter: vi.fn(async (_file, cb) => cb(frontmatter)) };
    mockApp.vault.process = vi.fn();

    await habitNoteManager.updateHabitNote(habit);

    expect(file.content).toBe(original);
    expect(mockApp.vault.process).not.toHaveBeenCalled();
    expect(frontmatter.notes).toBe("My official notes content");
  });

  it("preserves manual content when the note has no template marker", async () => {
    const habit = { ...canonicalHabit, archived: false, notes: "Fresh notes" };
    const file = new TFile("Core Habits/Active/Reading Books.md");
    file.content = "Personal content without a marker";
    mockApp.vault.getAbstractFileByPath = () => file;
    mockApp.metadataCache = { getFileCache: () => ({ frontmatter: { habit_id: habit.id } }) };
    const frontmatter = { habit_id: habit.id };
    mockApp.fileManager = { processFrontMatter: vi.fn(async (_file, cb) => cb(frontmatter)) };

    await habitNoteManager.updateHabitNote(habit);

    expect(file.content).toBe("Personal content without a marker");
    expect(frontmatter.notes).toBe("Fresh notes");
  });

  it("propagates a frontmatter write failure without rewriting the body", async () => {
    const habit = { ...canonicalHabit, archived: false };
    const file = new TFile("Core Habits/Active/Reading Books.md");
    file.content = "Personal content";
    mockApp.vault.getAbstractFileByPath = () => file;
    mockApp.metadataCache = { getFileCache: () => ({ frontmatter: { habit_id: habit.id } }) };
    mockApp.fileManager = { processFrontMatter: vi.fn().mockRejectedValue(new Error("Disk write failed")) };

    await expect(habitNoteManager.updateHabitNote(habit)).rejects.toThrow("Disk write failed");
    expect(file.content).toBe("Personal content");
  });

  describe("Path Safety and Collision Validation Tests", () => {
    it("should detect path traversal attempts", () => {
      expect(Utils.isPathTraversal("Habits/../../Secret.md")).toBe(true);
      expect(Utils.isPathTraversal("Habits/../Secret.md")).toBe(false);
      expect(Utils.isPathTraversal("../Secret.md")).toBe(true);
      expect(Utils.isPathTraversal("Habits/Sub/../File.md")).toBe(false);
      expect(Utils.isPathTraversal("Habits/Sub/Sub2/../../File.md")).toBe(false);
    });

    it("should verify if a path is inside a folder", () => {
      expect(Utils.isPathInsideFolder("Core Habits/Active/Habit.md", "Core Habits/Active")).toBe(true);
      expect(Utils.isPathInsideFolder("Core Habits/Archive/Habit.md", "Core Habits/Archive")).toBe(true);
      expect(Utils.isPathInsideFolder("Core Habits/Habit.md", "Core Habits/Active")).toBe(false);
      expect(Utils.isPathInsideFolder("Outside/Habit.md", "Core Habits/Active")).toBe(false);
    });

    it("should raise an error on validatePathSafety if path traversal escapes root", () => {
      expect(() => habitNoteManager.validatePathSafety("Core Habits/../Outside.md")).toThrow();
    });

    it("should raise an error on validatePathSafety if file is outside Active/Archive folders", () => {
      expect(() => habitNoteManager.validatePathSafety("Outside/Habit.md")).toThrow();
      expect(() => habitNoteManager.validatePathSafety("Core Habits/Habit.md")).toThrow();
    });

    it("should throw error in updateHabitNote if renamed file path collides with an existing file", async () => {
      const habit = {
        ...canonicalHabit,
        name: "Colliding Name"
      };

      const mockFile = new TFile("Core Habits/Active/Original Name.md");
      mockApp.vault.getAbstractFileByPath = (path) => {
        if (path === "Core Habits/Active/Original Name.md") return mockFile;
        if (path === "Core Habits/Active/Colliding Name.md") return new TFile("Core Habits/Active/Colliding Name.md");
        return null;
      };

      await expect(habitNoteManager.updateHabitNote(habit)).rejects.toThrow();
    });
  });
});
