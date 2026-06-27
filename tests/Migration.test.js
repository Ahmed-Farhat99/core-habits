import { describe, it, expect, beforeEach, vi } from "vitest";
import { MigrationManager } from "../src/services/MigrationManager.js";
import { HabitNoteManager } from "../src/services/HabitNoteManager.js";
import { TFile } from "obsidian";

describe("MigrationManager Tests", () => {
  let mockApp;
  let mockPlugin;
  let migrationManager;
  let habitNoteManager;

  beforeEach(() => {
    mockApp = {
      vault: {
        adapter: { getBasePath: () => "/vault" },
        getMarkdownFiles: vi.fn(),
        read: vi.fn(),
        process: vi.fn(),
        cachedRead: vi.fn(),
        getAbstractFileByPath: vi.fn()
      },
      metadataCache: {
        getFileCache: vi.fn()
      }
    };

    mockPlugin = {
      settings: {
        habitNotesFolder: "Core Habits",
        language: "en"
      },
      habitCommentRepository: {
        upsertCommentForHabitDate: vi.fn().mockResolvedValue("2026-05-18")
      }
    };

    habitNoteManager = new HabitNoteManager(mockApp, mockPlugin);
    mockPlugin.habitNoteManager = habitNoteManager;
    migrationManager = new MigrationManager(mockApp, mockPlugin);
    
    vi.clearAllMocks();
  });

  it("should detect and migrate habit files with schema version < 1", async () => {
    // Setup files
    const mockFile = new TFile("Core Habits/Active/Coding.md");
    mockFile.stat = { ctime: 1718976000000 };
    mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
    mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
    
    // Frontmatter without schema_version (version 0)
    mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: {
        habit_id: "coding-1",
        habit_type: "build",
        archived: "false"
      }
    });

    const fileContent = `---
habit_id: coding-1
habit_type: build
archived: false
---
\`\`\`core-habits
\`\`\`

> **Free Space for Notes:**
> Note here

---
Some custom notes by the user.
## 📓 سجل التدوينات والصوتيات
**2026-05-18:** Spent 2 hours coding.
`;

    mockApp.vault.read.mockResolvedValue(fileContent);
    mockApp.vault.cachedRead.mockResolvedValue(fileContent);
    
    let processedContent = "";
    mockApp.vault.process.mockImplementation(async (file, callback) => {
      processedContent = callback(fileContent);
      return file;
    });

    await migrationManager.runMigrations();

    // 1. Verifies repository is called to upsert comment to Daily Note
    expect(mockPlugin.habitCommentRepository.upsertCommentForHabitDate).toHaveBeenCalledTimes(1);
    expect(mockPlugin.habitCommentRepository.upsertCommentForHabitDate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "coding-1", name: "Coding" }),
      expect.any(Object),
      "Spent 2 hours coding."
    );

    // 2. Verifies the file gets updated to version 1 and log section is removed
    expect(processedContent).toContain("schema_version: 1");
    expect(processedContent).toContain("Some custom notes by the user.");
    expect(processedContent).not.toContain("## 📓 سجل التدوينات والصوتيات");
    expect(processedContent).not.toContain("Spent 2 hours coding.");
  });

  it("should abort migration and throw error if comment migration fails", async () => {
    const mockFile = new TFile("Core Habits/Active/Coding.md");
    mockFile.stat = { ctime: 1718976000000 };
    mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
    mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
    
    mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: {
        habit_id: "coding-1",
        habit_type: "build"
      }
    });

    const fileContent = `---
habit_id: coding-1
habit_type: build
---
\`\`\`core-habits
\`\`\`
## 📓 سجل التدوينات والصوتيات
**2026-05-18:** Spent 2 hours coding.
`;

    mockApp.vault.read.mockResolvedValue(fileContent);
    mockApp.vault.cachedRead.mockResolvedValue(fileContent);

    // Mock inject failure
    mockPlugin.habitCommentRepository.upsertCommentForHabitDate.mockRejectedValue(new Error("Vault write failed"));

    const processMock = vi.fn();
    mockApp.vault.process = processMock;

    // Run migration
    await migrationManager.runMigrations();

    // Verify processMock was NEVER called because we aborted
    expect(processMock).not.toHaveBeenCalled();
  });

  it("should migrate collapsedGroups semantic logic in settings", async () => {
    mockPlugin.settings.collapsedGroups = ["parent1:expanded"];
    mockPlugin.settings.collapsedGroupsSemanticMigrated = false;
    mockPlugin.saveSettings = vi.fn().mockResolvedValue(true);

    // Mock active habits
    mockPlugin.habitManager = {
      getActiveHabits: () => [
        { id: "parent1", parentId: null },
        { id: "child1", parentId: "parent1" },
        { id: "parent2", parentId: null },
        { id: "child2", parentId: "parent2" }
      ],
      getEffectiveParentId: (id) => {
        if (id === "child1") return "parent1";
        if (id === "child2") return "parent2";
        return null;
      }
    };

    mockApp.vault.getMarkdownFiles.mockReturnValue([]);

    await migrationManager.runMigrations();

    // Verify expanded group ("parent1") is NOT in the new list,
    // and collapsed group ("parent2") IS in the list.
    expect(mockPlugin.settings.collapsedGroups).toEqual(["parent2"]);
    expect(mockPlugin.settings.collapsedGroupsSemanticMigrated).toBe(true);
    expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(1);
  });
});
