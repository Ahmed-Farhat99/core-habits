import { describe, it, expect, beforeEach } from "vitest";
import { HabitNoteManager } from "../src/services/HabitNoteManager.js";
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
    
    // Check what is currently mapped
    expect(props.schema_version).toBe(1);
    expect(props.habit_id).toBe(canonicalHabit.id);
    expect(props.habit_type).toBe(canonicalHabit.habitType);
    expect(props.color).toBe(canonicalHabit.color);
    expect(props.schedule).toBe("1,3,5");
    expect(props.days).toBe("[1, 3, 5]");
    expect(props.current_level).toBe(canonicalHabit.currentLevel);
    expect(props.archived).toBe("true"); // Note it is serialized as string "true" / "false"
    expect(props.parent_id).toBe(canonicalHabit.parentId);
    expect(props.order).toBe(canonicalHabit.order);
    expect(props.name_history).toBe("[[Read Books]]|||[[Daily Reading]]");
    
    // Check levelData mapping
    expect(props.level_1_goal).toBe(canonicalHabit.levelData[0].goal);
    expect(props.level_1_achieved).toBe("true");
    
    // Verifies correct mapping of previously missing fields (P0-2)
    expect(props.archived_at).toBe("2024-06-21");
    expect(props.restored_at).toBe("");
    expect(props.saved_longest_streak).toBe(12);

    // Check deleted flag serialization
    expect(props.deleted).toBe("false");

    // Check serialization when deleted is true
    const deletedHabit = { ...canonicalHabit, deleted: true };
    const deletedProps = habitNoteManager._habitToProps(deletedHabit);
    expect(deletedProps.deleted).toBe("true");
  });

  it("characterizes the deserialization mapping (propsToHabit)", () => {
    const props = habitNoteManager._habitToProps(canonicalHabit);
    const mockFile = new TFile("Core Habits/Archive/Reading Books.md");
    
    const deserialized = habitNoteManager.propsToHabit(mockFile, props);
    
    expect(deserialized.schemaVersion).toBe(1);
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

  it("verifies buildFrontmatter preserves all fields", () => {
    // buildFrontmatter converts a habit object into a YAML string.
    const frontmatterString = habitNoteManager.buildFrontmatter(canonicalHabit);
    
    expect(frontmatterString).toContain(`habit_id: ${canonicalHabit.id}`);
    expect(frontmatterString).toContain(`schema_version: 1`);
    expect(frontmatterString).toContain(`order: ${canonicalHabit.order}`);
    expect(frontmatterString).toContain(`archived_at: "2024-06-21"`);
    expect(frontmatterString).toContain(`saved_longest_streak: 12`);
    expect(frontmatterString).toContain(`deleted: false`);

    const deletedHabit = { ...canonicalHabit, deleted: true };
    const deletedFrontmatter = habitNoteManager.buildFrontmatter(deletedHabit);
    expect(deletedFrontmatter).toContain(`deleted: true`);
  });

  it("uses localized habit note template text for new French habit files", () => {
    mockPlugin.settings.language = "fr";

    const template = habitNoteManager.buildHabitTemplate({
      ...canonicalHabit,
      notes: "",
    });

    expect(template).toContain("> **Espace libre pour les notes :**");
    expect(template).toContain("## 📓 Notes et audios");
    expect(template).not.toContain("## 📓 سجل التدوينات والصوتيات");
  });

  it("localizes generated template text in existing habit notes", async () => {
    mockPlugin.settings.language = "fr";
    const mockFile = new TFile("Core Habits/Active/Reading Books.md");
    let processedContent = "";

    mockApp.vault.getMarkdownFiles = () => [mockFile];
    mockApp.vault.process = async (file, callback) => {
      processedContent = callback(`---
habit_id: habit-1234567890
---
\`\`\`core-habits
\`\`\`

> **مساحة حرة للتدوين:**
> Existing user note

---

## 📓 سجل التدوينات والصوتيات

<!-- تُضاف التدوينات والملاحظات الصوتية تلقائياً أدناه بواسطة الإضافة -->
**2026-05-18:** Done reading.
`);
      return file;
    };

    const updatedCount = await habitNoteManager.localizeHabitNoteTemplates("fr");

    expect(updatedCount).toBe(1);
    expect(processedContent).toContain("> **Espace libre pour les notes :**");
    expect(processedContent).toContain("> Existing user note");
    expect(processedContent).toContain("## 📓 Notes et audios");
    expect(processedContent).toContain("**2026-05-18:** Done reading.");
    expect(processedContent).not.toContain("## 📓 سجل التدوينات والصوتيات");
  });

  it("preserves manual user content and log section on updateHabitNote", async () => {
    const habit = {
      ...canonicalHabit,
      name: "Reading Books",
      notes: "My official notes content"
    };

    let processedContent = "";
    
    // Setup mock file
    const mockFile = new TFile("Core Habits/Active/Reading Books.md");
    mockApp.vault.getAbstractFileByPath = (path) => {
      if (path === "Core Habits/Active/Reading Books.md") return mockFile;
      return null;
    };
    
    // The original file content containing official notes, horizontal rule, custom manual content, and log section
    const originalFileContent = `---
habit_id: habit-1234567890
---
\`\`\`core-habits
\`\`\`

> **Free Space for Notes:**
> My old notes content

---
My custom text that is written outside any template.
This should be preserved.
## 📓 سجل التدوينات والصوتيات
**2026-05-18:** Done reading.
`;

    mockApp.vault.process = async (file, callback) => {
      processedContent = callback(originalFileContent);
      return file;
    };

    await habitNoteManager.updateHabitNote(habit);

    // Verifies that:
    // 1. The new notes ("My official notes content") are written to the notes block
    expect(processedContent).toContain("> My official notes content");
    
    // 2. The custom user text is fully preserved!
    expect(processedContent).toContain("My custom text that is written outside any template.");
    expect(processedContent).toContain("This should be preserved.");
    
    // 3. The log section is preserved!
    expect(processedContent).toContain("## 📓 سجل التدوينات والصوتيات");
    expect(processedContent).toContain("**2026-05-18:** Done reading.");
  });

  it("preserves manual content even if notesMarker is completely missing during updateHabitNote", async () => {
    const habit = {
      ...canonicalHabit,
      name: "Reading Books",
      notes: "My fresh notes"
    };

    let processedContent = "";
    const mockFile = new TFile("Core Habits/Active/Reading Books.md");
    mockApp.vault.getAbstractFileByPath = () => mockFile;

    const originalFileContent = `---
habit_id: habit-1234567890
---
\`\`\`core-habits
\`\`\`

My custom content without notes marker.
## 📓 سجل التدوينات والصوتيات
**2026-05-18:** Done reading.
`;

    mockApp.vault.process = async (file, callback) => {
      processedContent = callback(originalFileContent);
      return file;
    };

    await habitNoteManager.updateHabitNote(habit);

    // Verify notes block is appended safely
    expect(processedContent).toContain("> My fresh notes");
    // Verify custom content is not wiped out
    expect(processedContent).toContain("My custom content without notes marker.");
    // Verify log section is preserved
    expect(processedContent).toContain("## 📓 سجل التدوينات والصوتيات");
  });

  it("throws an error if vault.process throws an error in updateHabitNote", async () => {
    const habit = {
      ...canonicalHabit,
      name: "Reading Books"
    };

    const mockFile = new TFile("Core Habits/Active/Reading Books.md");
    mockApp.vault.getAbstractFileByPath = () => mockFile;

    mockApp.vault.process = async () => {
      throw new Error("Disk write failed");
    };

    await expect(habitNoteManager.updateHabitNote(habit)).rejects.toThrow("Disk write failed");
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
