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
    let frontmatterStore = new Map();
    mockApp = {
      vault: {
        adapter: { getBasePath: () => "/vault" },
        getMarkdownFiles: vi.fn(),
        read: vi.fn(),
        process: vi.fn(),
        cachedRead: vi.fn(),
        getAbstractFileByPath: vi.fn(),
        create: vi.fn().mockResolvedValue({}),
        createFolder: vi.fn().mockResolvedValue({})
      },
      fileManager: {
        processFrontMatter: vi.fn(async (file, callback) => {
          const fm = frontmatterStore.get(file.path) || {};
          callback(fm);
          frontmatterStore.set(file.path, fm);
        })
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
## Later section
User content stays here.
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

    // 2. Verifies processFrontMatter is called to update properties and log section is removed
    expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalled();
    expect(processedContent).toContain("Some custom notes by the user.");
    expect(processedContent).not.toContain("## 📓 سجل التدوينات والصوتيات");
    expect(processedContent).not.toContain("Spent 2 hours coding.");
    expect(processedContent).toContain("## Later section\nUser content stays here.");
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
    await expect(migrationManager.runMigrations()).rejects.toThrow("One or more habit migrations failed");

    // Verify processMock was NEVER called because we aborted
    expect(processMock).not.toHaveBeenCalled();
  });

  it("preserves an unrecognized legacy log instead of deleting user text", async () => {
    const file = new TFile("Core Habits/Active/Coding.md");
    file.stat = { ctime: 1718976000000 };
    mockApp.vault.getMarkdownFiles.mockReturnValue([file]);
    mockApp.vault.getAbstractFileByPath.mockReturnValue(file);
    mockApp.metadataCache.getFileCache.mockReturnValue({ frontmatter: { habit_id: "coding-1", schema_version: 0 } });
    const content = "---\nhabit_id: coding-1\n---\n## 📓 سجل التدوينات والصوتيات\nMy private note\n## Next section\nKeep this";
    mockApp.vault.read.mockResolvedValue(content);
    mockApp.vault.cachedRead.mockResolvedValue(content);
    await expect(migrationManager.runMigrations()).rejects.toThrow("One or more habit migrations failed");
    expect(mockApp.vault.process).not.toHaveBeenCalled();
    expect(mockPlugin.habitCommentRepository.upsertCommentForHabitDate).not.toHaveBeenCalled();
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

  it("should create pre-migration backup in .backups folder before migrating files", async () => {
    const mockFile = new TFile("Core Habits/Active/Reading.md");
    mockFile.stat = { ctime: 1718976000000 };
    mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
    mockApp.vault.getAbstractFileByPath.mockImplementation((p) => p.endsWith("Reading.md") ? mockFile : null);

    mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: {
        habit_id: "reading-1",
        schema_version: 0
      }
    });

    const fileContent = `---
habit_id: reading-1
---
Some habit content
`;
    mockApp.vault.read.mockResolvedValue(fileContent);
    mockApp.vault.cachedRead.mockResolvedValue(fileContent);

    await migrationManager.runMigrations();

    // Verify folder creation for .backups and timestamped backup
    expect(mockApp.vault.createFolder).toHaveBeenCalledWith("Core Habits/.backups");
    expect(mockApp.vault.createFolder).toHaveBeenCalledWith(expect.stringMatching(/^Core Habits\/\.backups\/backup-/));

    // Verify backup copy was created with .bak extension
    expect(mockApp.vault.create).toHaveBeenCalledWith(
      expect.stringMatching(/^Core Habits\/\.backups\/backup-.*\/Active__Reading\.md\.bak$/),
      fileContent
    );
  });

  it("should abort migration and not modify files if backup creation fails", async () => {
    const mockFile = new TFile("Core Habits/Active/Reading.md");
    mockFile.stat = { ctime: 1718976000000 };
    mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
    mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

    mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: {
        habit_id: "reading-1",
        schema_version: 0
      }
    });

    mockApp.vault.read.mockResolvedValue("---\nhabit_id: reading-1\n---");
    mockApp.vault.create.mockRejectedValue(new Error("Disk full: cannot write backup"));

    const processMock = vi.fn();
    mockApp.vault.process = processMock;

    await expect(migrationManager.runMigrations()).rejects.toThrow("Pre-migration backup failed");

    // Verify file modification was never attempted because backup failed
    expect(processMock).not.toHaveBeenCalled();
  });

  it("should safely use processFrontMatter when app.fileManager is available", async () => {
    const mockFile = new TFile("Core Habits/Active/Reading.md");
    mockFile.stat = { ctime: 1718976000000 };
    mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
    mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

    mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: {
        habit_id: "reading-1",
        schema_version: 0,
        custom_user_tag: "important"
      }
    });

    const fileContent = `---
habit_id: reading-1
custom_user_tag: important
---
\`\`\`core-habits
\`\`\`
Custom notes
`;
    mockApp.vault.read.mockResolvedValue(fileContent);
    mockApp.vault.cachedRead.mockResolvedValue(fileContent);

    let frontmatterResult = {};
    mockApp.fileManager = {
      processFrontMatter: vi.fn(async (file, callback) => {
        callback(frontmatterResult);
      })
    };

    mockApp.vault.process.mockImplementation(async (file, callback) => {
      callback(fileContent);
      return file;
    });

    await migrationManager.runMigrations();

    // Verify processFrontMatter was used to set schema_version
    expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalled();
    expect(frontmatterResult.schema_version).toBe(2);
    expect(frontmatterResult.habit_id).toBe("reading-1");
  });

  it("should retain unknown and legacy frontmatter during v2 migration", async () => {
    const mockFile = new TFile("Core Habits/Active/OldHabit.md");
    mockFile.stat = { ctime: 1718976000000 };
    mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
    mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

    const initialFrontmatter = {
      schema_version: "1",
      habit_id: "old-1",
      habit_type: "build",
      goal: "old goal",
      days: "[0, 1, 2, 3, 4, 5, 6]",
      schedule: "daily",
      level_1_condition: "7 days",
      level_1_achieved: "false",
      identity: "",
      cue: "",
      friction: "",
      reward: ""
    };

    mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: initialFrontmatter
    });

    const fileContent = `---\n---\n\`\`\`core-habits\n\`\`\`\n`;
    mockApp.vault.read.mockResolvedValue(fileContent);
    mockApp.vault.cachedRead.mockResolvedValue(fileContent);

    let frontmatterResult = { ...initialFrontmatter };
    mockApp.fileManager = {
      processFrontMatter: vi.fn(async (file, callback) => {
        callback(frontmatterResult);
      })
    };

    mockApp.vault.process.mockImplementation(async (file, callback) => {
      callback(fileContent);
      return file;
    });

    await migrationManager.runMigrations();

    expect(frontmatterResult.schema_version).toBe(2);
    expect(frontmatterResult.goal).toBe("old goal");
    expect(frontmatterResult.days).toBe("[0, 1, 2, 3, 4, 5, 6]");
    expect(frontmatterResult.level_1_condition).toBe("7 days");
    expect(frontmatterResult.level_1_achieved).toBe("false");
    expect(frontmatterResult.identity).toBeUndefined();
    expect(frontmatterResult.cue).toBeUndefined();
    expect(frontmatterResult.friction).toBeUndefined();
    expect(frontmatterResult.reward).toBeUndefined();
  });

  describe("migrateV3Data", () => {
    it("should skip if v3Migrated is already true", async () => {
      mockPlugin.settings.v3Migrated = true;
      const result = await migrationManager.migrateV3Data();
      expect(result).toBe(false);
    });

    it("should migrate habits array from settings into notes, clean collapsedGroups, and set v3Migrated", async () => {
      mockPlugin.settings.v3Migrated = false;
      mockPlugin.settings.habits = [
        { id: "h1", name: "Morning Run", archived: false },
        { id: "h2", name: "Read", archived: true }
      ];
      mockPlugin.settings.collapsedGroups = ["h1:expanded", "old-orphan:settings_expanded"];
      mockPlugin.saveSettings = vi.fn().mockResolvedValue(true);
      mockPlugin.habitNoteManager.createHabitNote = vi.fn().mockResolvedValue({});
      mockPlugin.habitNoteManager._findFileByHabitId = vi.fn().mockReturnValue(null);
      mockPlugin.habitNoteManager.getHabitFilePath = vi.fn((name, arch) => `Core Habits/${arch ? "Archive" : "Active"}/${name}.md`);
      mockPlugin.habitManager = {
        getHabits: () => [{ id: "h1", name: "Morning Run" }]
      };

      const result = await migrationManager.migrateV3Data();

      expect(result).toBe(true);
      expect(mockPlugin.habitNoteManager.createHabitNote).toHaveBeenCalledTimes(2);
      expect(mockPlugin.settings.habitsBackup).toEqual([
        { id: "h1", name: "Morning Run", archived: false },
        { id: "h2", name: "Read", archived: true }
      ]);
      expect(mockPlugin.settings.habits).toEqual([]);
      expect(mockPlugin.settings.collapsedGroups).toEqual(["h1:expanded"]);
      expect(mockPlugin.settings.v3Migrated).toBe(true);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
    });

    it("keeps legacy settings when a file path belongs to a different habit", async () => {
      const legacy = [{ id: "legacy-id", name: "Reading", archived: false }];
      mockPlugin.settings.habits = legacy;
      mockPlugin.settings.v3Migrated = false;
      mockPlugin.habitNoteManager._findFileByHabitId = vi.fn().mockReturnValue(null);
      const occupied = new TFile("Core Habits/Active/Reading.md");
      mockApp.vault.getAbstractFileByPath.mockReturnValue(occupied);
      mockApp.metadataCache.getFileCache.mockReturnValue({ frontmatter: { habit_id: "other-id" } });
      mockPlugin.saveSettings = vi.fn();
      await expect(migrationManager.migrateV3Data()).rejects.toThrow("Migration path collision");
      expect(mockPlugin.settings.habits).toBe(legacy);
      expect(mockPlugin.settings.v3Migrated).toBe(false);
      expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
    });
  });

  describe("upgradeLegacyHeadings", () => {
    it("should return false if dailyParentHeading is already defined in savedData", () => {
      const settings = { habitHeading: "## Habits" };
      const savedData = { dailyParentHeading: "## My Journal" };
      const modified = MigrationManager.upgradeLegacyHeadings(settings, savedData);
      expect(modified).toBe(false);
      expect(settings.habitHeading).toBe("## Habits");
    });

    it("should upgrade H2 headings to H3 if dailyParentHeading is undefined in savedData", () => {
      const settings = {
        habitHeading: "## 🔄 تتبع العادات",
        reflectionHeading: "## 📝 تدوينات اليوم",
        habitLogHeading: "## 💬 ملاحظات العادات"
      };
      const savedData = {};
      const modified = MigrationManager.upgradeLegacyHeadings(settings, savedData);
      expect(modified).toBe(true);
      expect(settings.habitHeading).toBe("### 🔄 تتبع العادات");
      expect(settings.reflectionHeading).toBe("### 📝 تدوينات اليوم");
      expect(settings.habitLogHeading).toBe("### 💬 ملاحظات العادات");
    });
  });
});
