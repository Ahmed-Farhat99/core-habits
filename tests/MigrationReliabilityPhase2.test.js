import { describe, it, expect, beforeEach, vi } from "vitest";
import { MigrationManager } from "../src/services/MigrationManager.js";
import { HabitNoteManager } from "../src/services/HabitNoteManager.js";
import { HabitRepository } from "../src/repositories/HabitRepository.js";
import { HabitManager } from "../src/services/HabitManager.js";
import { TFile } from "obsidian";
import { TRANSLATIONS } from "../src/constants.js";

describe("Phase 2: Migration Reliability & Per-File Safety Tests", () => {
  let mockApp;
  let mockPlugin;
  let migrationManager;
  let habitNoteManager;
  let habitRepository;
  let habitManager;
  let filesMap;
  let frontmatterMap;
  let backupFilesCreated;

  const productionLikeV1Content = `---
schema_version: 1
habit_id: habit-running-101
habit_type: build
name: Running
color: "#3b82f6"
order: 1
current_level: 2
saved_longest_streak: 7
days:
  - mon
  - wed
  - fri
archived: false
created_at: 1695000000000
notes: "Run in the park every morning"
identity: "I am a runner"
cue: "Shoes near the door"
friction: "Cold mornings"
reward: "Hot shower"
custom_field: "user-preserved-val"
---
\`\`\`core-habits
\`\`\`

> **Free Space for Notes:**
> Run in the park every morning

---
My custom notes here:
- Aim for 5k minimum.
- Stretch after running.

## 📓 سجل التدوينات والصوتيات
Remember to stay hydrated before starting!
- Always check shoes!
**2023-11-20:** Completed 5km in 28 minutes. Felt great!
**2024-03-15:** Voice reflection after hill sprint ![[Voice Memo 2024-03-15.m4a]]
**2024-05-18:** Long run 10k:
Paced well throughout.
Cardio felt effortless today.
![[Audio 20240518.webm]]

## 🎯 Future Milestones
User section that must never be altered or lost.
`;

  beforeEach(() => {
    filesMap = new Map();
    frontmatterMap = new Map();
    backupFilesCreated = [];

    const makeFile = (path, content, fm = null) => {
      const file = new TFile(path);
      file.content = content;
      file.stat = { ctime: 1695000000000, mtime: 1695000000000 };
      filesMap.set(path, file);
      if (fm) {
        frontmatterMap.set(path, { ...fm });
      } else {
        const parsedFm = HabitNoteManager.parseFrontmatterFromContent(content) || {};
        frontmatterMap.set(path, parsedFm);
      }
      return file;
    };

    makeFile("Core Habits/Active/Running.md", productionLikeV1Content);

    mockApp = {
      vault: {
        adapter: {
          getBasePath: () => "C:/Vault",
        },
        getAbstractFileByPath: vi.fn((path) => filesMap.get(path) || null),
        getMarkdownFiles: vi.fn(() => Array.from(filesMap.values()).filter((f) => f.path.endsWith(".md"))),
        read: vi.fn(async (file) => file.content || ""),
        cachedRead: vi.fn(async (file) => file.content || ""),
        modify: vi.fn(async (file, content) => {
          file.content = content;
        }),
        process: vi.fn(async (file, fn) => {
          file.content = fn(file.content || "");
          return file.content;
        }),
        create: vi.fn(async (path, content) => {
          const file = new TFile(path);
          file.content = content;
          filesMap.set(path, file);
          if (path.includes(".backups")) {
            backupFilesCreated.push({ path, content });
          }
          return file;
        }),
        createFolder: vi.fn(async (folder) => {
          filesMap.set(folder, { path: folder });
          return filesMap.get(folder);
        }),
        rename: vi.fn(async (file, newPath) => {
          filesMap.delete(file.path);
          file.path = newPath;
          filesMap.set(newPath, file);
        }),
      },
      fileManager: {
        processFrontMatter: vi.fn(async (file, callback) => {
          let fm = frontmatterMap.get(file.path);
          if (!fm) {
            fm = HabitNoteManager.parseFrontmatterFromContent(file.content) || {};
          }
          callback(fm);
          frontmatterMap.set(file.path, fm);
        }),
      },
      metadataCache: {
        getFileCache: vi.fn((file) => {
          const fm = frontmatterMap.get(file.path);
          return fm ? { frontmatter: fm } : null;
        }),
      },
    };

    mockPlugin = {
      app: mockApp,
      settings: {
        habitNotesFolder: "Core Habits",
        language: "en",
        habitOrder: [],
        collapsedGroups: [],
        collapsedGroupsSemanticMigrated: true,
        v3Migrated: true,
      },
      translationManager: {
        t: (k, p = {}) => {
          let str = TRANSLATIONS.en[k] || TRANSLATIONS.ar[k] || k;
          Object.keys(p).forEach((param) => {
            str = str.replace(`{${param}}`, p[param]);
          });
          return str;
        },
      },
      habitCommentRepository: {
        upsertCommentForHabitDate: vi.fn().mockResolvedValue(true),
      },
    };

    habitNoteManager = new HabitNoteManager(mockApp, mockPlugin);
    mockPlugin.habitNoteManager = habitNoteManager;
    habitRepository = new HabitRepository(mockApp, mockPlugin);
    mockPlugin.habitRepository = habitRepository;
    habitManager = new HabitManager(mockPlugin);
    mockPlugin.habitManager = habitManager;
    migrationManager = new MigrationManager(mockApp, mockPlugin);
    mockPlugin.migrationManager = migrationManager;
  });

  describe("Production-like File Migration (Legacy logs, Audio embeds, Freeform lines)", () => {
    it("should migrate dated entries with audio embeds, preserve freeform lines, and create pre-migration backup", async () => {
      const file = filesMap.get("Core Habits/Active/Running.md");

      // Execute migration to v2
      const didMigrate = await migrationManager.runMigrations();
      expect(didMigrate).toBe(true);

      // 1. Verify backup was created BEFORE any modification
      expect(backupFilesCreated.length).toBeGreaterThanOrEqual(1);
      const backup = backupFilesCreated.find((b) => b.path.includes("Running.md.bak"));
      expect(backup).toBeDefined();
      expect(backup.content).toBe(productionLikeV1Content);

      // 2. Verify all 3 dated entries were migrated to Daily Notes
      expect(mockPlugin.habitCommentRepository.upsertCommentForHabitDate).toHaveBeenCalledTimes(3);

      // Check first log entry (2023 old date)
      expect(mockPlugin.habitCommentRepository.upsertCommentForHabitDate).toHaveBeenCalledWith(
        expect.objectContaining({ id: "habit-running-101", name: "Running" }),
        expect.objectContaining({ format: expect.any(Function) }),
        "Completed 5km in 28 minutes. Felt great!"
      );

      // Check second log entry (audio embed)
      expect(mockPlugin.habitCommentRepository.upsertCommentForHabitDate).toHaveBeenCalledWith(
        expect.objectContaining({ id: "habit-running-101" }),
        expect.any(Object),
        "Voice reflection after hill sprint ![[Voice Memo 2024-03-15.m4a]]"
      );

      // Check third log entry (multiline notes + audio embed)
      expect(mockPlugin.habitCommentRepository.upsertCommentForHabitDate).toHaveBeenCalledWith(
        expect.objectContaining({ id: "habit-running-101" }),
        expect.any(Object),
        "Long run 10k:\nPaced well throughout.\nCardio felt effortless today.\n![[Audio 20240518.webm]]"
      );

      // 3. Verify that freeform lines were PRESERVED in the habit note body
      expect(file.content).toContain("Remember to stay hydrated before starting!");
      expect(file.content).toContain("- Always check shoes!");

      // 4. Verify user custom section was NOT lost
      expect(file.content).toContain("## 🎯 Future Milestones");
      expect(file.content).toContain("User section that must never be altered or lost.");

      // 5. Verify frontmatter upgraded to schema_version 2 and preserved custom_field
      const updatedFm = frontmatterMap.get("Core Habits/Active/Running.md");
      expect(updatedFm.schema_version).toBe(2);
      expect(updatedFm.custom_field).toBe("user-preserved-val");

      // 6. Now run Schema v3 migration
      const didMigrateV3 = await migrationManager.runSchemaV3Migration();
      expect(didMigrateV3).toBe(true);

      const v3Fm = frontmatterMap.get("Core Habits/Active/Running.md");
      expect(v3Fm.schema_version).toBe(3);
      expect(v3Fm.order).toBeUndefined();
      expect(v3Fm.current_level).toBeUndefined();
      expect(v3Fm.days).toBeUndefined();
      expect(v3Fm.saved_longest_streak).toBe(7);
      expect(v3Fm.custom_field).toBe("user-preserved-val");
    });
  });

  describe("Idempotence & Rerun Safety", () => {
    it("should be strictly idempotent: second run makes 0 writes and creates 0 backups", async () => {
      // First run: v0/v1 -> v2
      await migrationManager.runMigrations();
      // First run: v2 -> v3
      await migrationManager.runSchemaV3Migration();

      const backupsCountAfterFirst = backupFilesCreated.length;
      const upsertCallsAfterFirst = mockPlugin.habitCommentRepository.upsertCommentForHabitDate.mock.calls.length;
      const processCallsAfterFirst = mockApp.vault.process.mock.calls.length;

      // Second run: should be completely no-op
      const v2Rerun = await migrationManager.runMigrations();
      const v3Rerun = await migrationManager.runSchemaV3Migration();

      expect(v2Rerun).toBe(false);
      expect(v3Rerun).toBe(false);

      // Zero new backups, zero new comment writes, zero vault modifications
      expect(backupFilesCreated.length).toBe(backupsCountAfterFirst);
      expect(mockPlugin.habitCommentRepository.upsertCommentForHabitDate).toHaveBeenCalledTimes(upsertCallsAfterFirst);
      expect(mockApp.vault.process).toHaveBeenCalledTimes(processCallsAfterFirst);
    });
  });

  describe("Per-File Isolation: Incomprehensible File Does Not Block Others", () => {
    it("should upgrade healthy files even when one legacy file fails or is corrupted", async () => {
      // Setup 3 files:
      // File 1: Healthy v1 note
      const file1Content = `---
schema_version: 1
habit_id: habit-reading
name: Reading
color: "#10b981"
order: 1
---
\`\`\`core-habits
\`\`\`
## 📓 سجل التدوينات والصوتيات
**2024-01-10:** Read chapter 1
`;
      const f1 = new TFile("Core Habits/Active/Reading.md");
      f1.content = file1Content;
      filesMap.set(f1.path, f1);
      frontmatterMap.set(f1.path, { schema_version: 1, habit_id: "habit-reading", name: "Reading", color: "#10b981", order: 1 });

      // File 2: Incomprehensible legacy file with only unknown text and no dates (must not be deleted or corrupted)
      const file2Content = `---
schema_version: 1
habit_id: habit-corrupted
name: Corrupted
order: 2
---
\`\`\`core-habits
\`\`\`
## 📓 سجل التدوينات والصوتيات
Random unparseable gibberish with no date anywhere
`;
      const f2 = new TFile("Core Habits/Active/Corrupted.md");
      f2.content = file2Content;
      filesMap.set(f2.path, f2);
      frontmatterMap.set(f2.path, { schema_version: 1, habit_id: "habit-corrupted", name: "Corrupted", order: 2 });

      // File 3: Another healthy v1 note
      const file3Content = `---
schema_version: 1
habit_id: habit-meditation
name: Meditation
color: "#8b5cf6"
order: 3
---
\`\`\`core-habits
\`\`\`
## 📓 سجل التدوينات والصوتيات
**2024-02-15:** 15 min mindfulness
`;
      const f3 = new TFile("Core Habits/Active/Meditation.md");
      f3.content = file3Content;
      filesMap.set(f3.path, f3);
      frontmatterMap.set(f3.path, { schema_version: 1, habit_id: "habit-meditation", name: "Meditation", color: "#8b5cf6", order: 3 });

      // Run migrations in non-throwing per-file mode (as used during startup)
      const v2Result = await migrationManager.runMigrations({ throwOnFailure: false });

      // Migration succeeded for at least some files
      expect(v2Result).toBe(true);

      // Verify that failures list caught the corrupt file without aborting the loop
      expect(migrationManager.lastMigrationFailures.length).toBe(1);
      expect(migrationManager.lastMigrationFailures[0].message).toContain("Unrecognized line in legacy habit log");

      // Verify File 1 (Reading) was upgraded to v2
      expect(frontmatterMap.get("Core Habits/Active/Reading.md").schema_version).toBe(2);

      // Verify File 2 (Corrupted) remained UNTOUCHED to prevent data loss
      expect(frontmatterMap.get("Core Habits/Active/Corrupted.md").schema_version).toBe(1);
      expect(f2.content).toBe(file2Content);

      // Verify File 3 (Meditation) was upgraded to v2
      expect(frontmatterMap.get("Core Habits/Active/Meditation.md").schema_version).toBe(2);

      // Run Schema v3 migration in non-throwing per-file mode
      await migrationManager.runSchemaV3Migration({ throwOnFailure: false });

      // Healthy files reached Schema v3!
      expect(frontmatterMap.get("Core Habits/Active/Reading.md").schema_version).toBe(3);
      expect(frontmatterMap.get("Core Habits/Active/Meditation.md").schema_version).toBe(3);
    });
  });

  describe("Separation of 'Cannot Migrate File' from 'Plugin Cannot Start'", () => {
    it("should allow HabitManager to load and initialize valid habits even if one file failed migration", async () => {
      // 1 valid habit file
      const goodFile = new TFile("Core Habits/Active/Reading.md");
      goodFile.content = `---
schema_version: 3
habit_id: habit-good
name: Reading
color: "#10b981"
---
\`\`\`core-habits
\`\`\`
`;
      filesMap.set(goodFile.path, goodFile);
      frontmatterMap.set(goodFile.path, { schema_version: 3, habit_id: "habit-good", name: "Reading", color: "#10b981" });

      // 1 corrupt file with unparseable log that threw during migration
      const badFile = new TFile("Core Habits/Active/BadHabit.md");
      badFile.content = `---
schema_version: 1
habit_id: habit-bad
name: BadHabit
---
\`\`\`core-habits
\`\`\`
## 📓 سجل التدوينات والصوتيات
Unrecognized log line with no dates
`;
      filesMap.set(badFile.path, badFile);
      frontmatterMap.set(badFile.path, { schema_version: 1, habit_id: "habit-bad", name: "BadHabit" });

      // Simulate startup sequence
      await migrationManager.runMigrations({ throwOnFailure: false });
      await migrationManager.runSchemaV3Migration({ throwOnFailure: false });

      // Verify that HabitManager initializes without crashing
      await expect(habitManager.initialize()).resolves.not.toThrow();

      // Healthy habit is accessible in memory
      expect(habitManager.getHabits().length).toBeGreaterThanOrEqual(1);
      const reading = habitManager.getHabitById("habit-good");
      expect(reading).toBeDefined();
      expect(reading.name).toBe("Reading");

      // Verify that migration failure is accessible for gentle warning rather than fatal crash
      expect(migrationManager.lastMigrationFailures.length).toBe(1);
    });
  });
});
