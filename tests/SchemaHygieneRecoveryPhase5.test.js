import { describe, it, expect, beforeEach, vi } from "vitest";
import { MigrationManager } from "../src/services/MigrationManager.js";
import { HabitNoteManager } from "../src/services/HabitNoteManager.js";
import { HabitManager } from "../src/services/HabitManager.js";
import { StatusView } from "../src/views/StatusView.js";
import { TFile } from "obsidian";
import { TRANSLATIONS } from "../src/constants.js";

describe("Phase 5: Schema Hygiene & Recovery UX Tests", () => {
  let mockApp;
  let mockPlugin;
  let migrationManager;
  let habitNoteManager;
  let habitManager;
  let filesMap;
  let frontmatterMap;
  let backupFilesCreated;

  beforeEach(() => {
    filesMap = new Map();
    frontmatterMap = new Map();
    backupFilesCreated = [];

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
      workspace: {
        getLeavesOfType: vi.fn(() => []),
      }
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
      saveSettings: vi.fn().mockResolvedValue(true),
    };

    habitNoteManager = new HabitNoteManager(mockApp, mockPlugin);
    mockPlugin.habitNoteManager = habitNoteManager;
    habitManager = new HabitManager(mockPlugin);
    mockPlugin.habitManager = habitManager;
    migrationManager = new MigrationManager(mockApp, mockPlugin);
    mockPlugin.migrationManager = migrationManager;
  });

  describe("1. Schema Hygiene & Confirmed Legacy Fields Cleanup", () => {
    it("cleans only confirmed obsolete legacy fields and preserves user custom properties", async () => {
      const v1Content = `---
schema_version: 1
habit_id: habit-legacy-cleanup
habit_type: build
name: Legacy Clean
color: "#3b82f6"
order: 4
current_level: 3
days: "[1, 3, 5]"
goal: "Old Level 1 goal"
level_1_goal: "Goal 1"
level_1_condition: "Cond 1"
level_1_achieved: true
level_2_goal: "Goal 2"
level_5_goal: "Goal 5"
level_5_achieved: false
archived: false
created_at: 1695000000000
custom_user_tag: "keep_this_tag"
my_priority: 99
---
\`\`\`core-habits
\`\`\`

> **Free Space for Notes:**
> (Write your deep motivations or thoughts about this habit here...)
`;
      const file = new TFile("Core Habits/Active/Legacy Clean.md");
      file.content = v1Content;
      filesMap.set(file.path, file);
      frontmatterMap.set(file.path, HabitNoteManager.parseFrontmatterFromContent(v1Content));

      const didMigrate = await migrationManager.runSchemaV3Migration();
      expect(didMigrate).toBe(true);

      const fm = frontmatterMap.get(file.path);

      // Verified Schema v3
      expect(fm.schema_version).toBe(3);
      expect(fm.habit_id).toBe("habit-legacy-cleanup");

      // Confirmed legacy fields MUST be deleted
      expect(fm.order).toBeUndefined();
      expect(fm.current_level).toBeUndefined();
      expect(fm.days).toBeUndefined();
      expect(fm.goal).toBeUndefined();
      expect(fm.level_1_goal).toBeUndefined();
      expect(fm.level_1_condition).toBeUndefined();
      expect(fm.level_1_achieved).toBeUndefined();
      expect(fm.level_2_goal).toBeUndefined();
      expect(fm.level_5_goal).toBeUndefined();
      expect(fm.level_5_achieved).toBeUndefined();

      // Custom user properties MUST be preserved
      expect(fm.custom_user_tag).toBe("keep_this_tag");
      expect(fm.my_priority).toBe(99);

      // Order preserved in settings
      expect(mockPlugin.settings.habitOrder).toContain("habit-legacy-cleanup");
    });
  });

  describe("2. Domain Fields Preservation vs Empty Optional Fields Pruning", () => {
    it("retains populated domain fields with real values (saved_longest_streak, archived_at, parent_id, name_history)", async () => {
      const v2Content = `---
schema_version: 2
habit_id: habit-populated-domain
habit_type: build
name: Domain Retention
color: "green"
schedule: daily
archived: true
deleted: true
archived_at: "2024-05-10"
restored_at: "2024-05-15"
parent_id: "parent-habit-xyz"
name_history:
  - "[[Old Name 1]]"
  - "[[Old Name 2]]"
saved_longest_streak: 21
identity: "Daily writer"
cue: "Morning coffee"
friction: "Open laptop"
reward: "Breakfast"
notes: "Personal important note"
custom_field: "user-val"
---
\`\`\`core-habits
\`\`\`
`;
      const file = new TFile("Core Habits/Active/Domain Retention.md");
      file.content = v2Content;
      filesMap.set(file.path, file);
      frontmatterMap.set(file.path, HabitNoteManager.parseFrontmatterFromContent(v2Content));

      await migrationManager.runSchemaV3Migration();
      const fm = frontmatterMap.get(file.path);

      expect(fm.schema_version).toBe(3);
      // Retained populated domain fields
      expect(fm.saved_longest_streak).toBe(21);
      expect(fm.archived_at).toBe("2024-05-10");
      expect(fm.restored_at).toBe("2024-05-15");
      expect(fm.parent_id).toBe("parent-habit-xyz");
      expect(fm.name_history).toEqual(["[[Old Name 1]]", "[[Old Name 2]]"]);
      expect(fm.deleted).toBe(true);
      expect(fm.identity).toBe("Daily writer");
      expect(fm.cue).toBe("Morning coffee");
      expect(fm.friction).toBe("Open laptop");
      expect(fm.reward).toBe("Breakfast");
      expect(fm.notes).toBe("Personal important note");
      expect(fm.custom_field).toBe("user-val");
    });

    it("prunes empty optional fields so old and new v3 notes follow the exact same sparse contract", async () => {
      const v3DirtyContent = `---
schema_version: 3
habit_id: habit-sparse-test
habit_type: build
name: Sparse Clean
color: "teal"
schedule: daily
archived: false
deleted: false
archived_at: ""
restored_at: ""
parent_id: ""
name_history: []
saved_longest_streak: 0
identity: ""
cue: ""
friction: ""
reward: ""
notes: ""
---
\`\`\`core-habits
\`\`\`
`;
      const file = new TFile("Core Habits/Active/Sparse Clean.md");
      file.content = v3DirtyContent;
      filesMap.set(file.path, file);
      frontmatterMap.set(file.path, HabitNoteManager.parseFrontmatterFromContent(v3DirtyContent));

      // File has schema_version: 3, but contains dirty empty optional fields
      expect(MigrationManager.hasSchemaHygieneDefects(frontmatterMap.get(file.path))).toBe(true);

      const didMigrate = await migrationManager.runSchemaV3Migration();
      expect(didMigrate).toBe(true);

      const cleanFm = frontmatterMap.get(file.path);
      expect(cleanFm.schema_version).toBe(3);
      expect(cleanFm.habit_id).toBe("habit-sparse-test");

      // All empty optional fields MUST be deleted under sparse contract
      expect(cleanFm.archived_at).toBeUndefined();
      expect(cleanFm.restored_at).toBeUndefined();
      expect(cleanFm.parent_id).toBeUndefined();
      expect(cleanFm.name_history).toBeUndefined();
      expect(cleanFm.saved_longest_streak).toBeUndefined();
      expect(cleanFm.identity).toBeUndefined();
      expect(cleanFm.cue).toBeUndefined();
      expect(cleanFm.friction).toBeUndefined();
      expect(cleanFm.reward).toBeUndefined();
      expect(cleanFm.notes).toBeUndefined();
      expect(cleanFm.deleted).toBeUndefined();

      // Subsequent check should find 0 defects and make 0 changes (idempotent)
      expect(MigrationManager.hasSchemaHygieneDefects(cleanFm)).toBe(false);
      const rerun = await migrationManager.runSchemaV3Migration();
      expect(rerun).toBe(false);
    });
  });

  describe("3. Notes Fallback Without Losing Body Content", () => {
    it("migrates user body notes into frontmatter when legacy frontmatter had boilerplate notes: ''", async () => {
      const v1WithBodyNotes = `---
schema_version: 1
habit_id: habit-notes-body
habit_type: build
name: Arabic Notes Habit
color: "purple"
schedule: daily
archived: false
notes: ""
---
\`\`\`core-habits
\`\`\`

> **مساحة حرة للتدوين:**
> هذه ملاحظة خاصة ومهمة جداً بالعادة كتبها المستخدم
> سطر ثانٍ من الملاحظات اليومية

---
## ملاحظات شخصية أخرى
لا يجب أن تتأثر
`;
      const file = new TFile("Core Habits/Active/Arabic Notes Habit.md");
      file.content = v1WithBodyNotes;
      filesMap.set(file.path, file);
      frontmatterMap.set(file.path, HabitNoteManager.parseFrontmatterFromContent(v1WithBodyNotes));

      // Read before migration: verify fromFrontmatterProps extracts body notes despite notes: ""
      const entityBefore = habitNoteManager.propsToHabit(file, frontmatterMap.get(file.path), file.content);
      expect(entityBefore.notes).toBe("هذه ملاحظة خاصة ومهمة جداً بالعادة كتبها المستخدم\nسطر ثانٍ من الملاحظات اليومية");

      // Migrate to v3
      await migrationManager.runSchemaV3Migration();

      // Frontmatter now has the migrated notes
      const migratedFm = frontmatterMap.get(file.path);
      expect(migratedFm.schema_version).toBe(3);
      expect(migratedFm.notes).toBe("هذه ملاحظة خاصة ومهمة جداً بالعادة كتبها المستخدم\nسطر ثانٍ من الملاحظات اليومية");

      // File body content was NOT lost or modified
      expect(file.content).toContain("> **مساحة حرة للتدوين:**");
      expect(file.content).toContain("## ملاحظات شخصية أخرى\nلا يجب أن تتأثر");
    });

    it("does not treat placeholder notes as real notes and deletes empty notes property", async () => {
      const v1WithPlaceholder = `---
schema_version: 1
habit_id: habit-placeholder
habit_type: build
name: Placeholder Habit
color: "teal"
schedule: daily
notes: ""
---
\`\`\`core-habits
\`\`\`

> **Free Space for Notes:**
> (Write your deep motivations or thoughts about this habit here...)
`;
      const file = new TFile("Core Habits/Active/Placeholder Habit.md");
      file.content = v1WithPlaceholder;
      filesMap.set(file.path, file);
      frontmatterMap.set(file.path, HabitNoteManager.parseFrontmatterFromContent(v1WithPlaceholder));

      await migrationManager.runSchemaV3Migration();
      const fm = frontmatterMap.get(file.path);

      expect(fm.schema_version).toBe(3);
      // Empty / placeholder notes must be deleted under sparse contract
      expect(fm.notes).toBeUndefined();
    });

    it("does not resurrect old body notes when frontmatter notes is explicitly cleared in Schema v3", () => {
      const file = new TFile("Core Habits/Active/Gym.md");
      const v3ClearedProps = {
        schema_version: 3,
        habit_id: "habit-gym",
        habit_type: "build",
        notes: "" // explicitly cleared in frontmatter
      };
      const body = "> [!note] Notes\n> Old callout note\n";
      const habit = habitNoteManager.propsToHabit(file, v3ClearedProps, body);
      expect(habit.notes).toBe("");
    });
  });

  describe("4. Startup Failure & Mobile Recovery UX", () => {
    it("renders an actionable recovery UI with Retry, Copy Error Report, and Backup notice", async () => {
      const container = document.createElement("div");
      let retryCalled = false;
      const onRetry = vi.fn(async () => {
        retryCalled = true;
      });

      const sampleError = new Error("Database locked during mobile indexing");
      sampleError.stack = "Error: Database locked\n    at init (main.js:123:45)";

      // Mock navigator.clipboard
      let clipboardText = "";
      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn(async (text) => {
            clipboardText = text;
          })
        }
      });

      StatusView.renderStartupFailure(container, {
        error: sampleError,
        onRetry,
        t: (k) => TRANSLATIONS.en[k] || k,
        isAr: false,
        backupFolder: "Core Habits/.backups"
      });

      // Verify DOM structure
      expect(container.querySelector(".dh-startup-failure-state")).not.toBeNull();
      expect(container.querySelector(".error-icon").textContent).toBe("🛡️");
      expect(container.querySelector(".error-text").textContent).toBe("Core Habits could not initialize safely");

      // Verify Backup Notice is shown
      const backupNotice = container.querySelector(".dh-recovery-backup-notice");
      expect(backupNotice).not.toBeNull();
      expect(backupNotice.textContent).toContain("Core Habits/.backups");

      // Verify Retry Button works
      const retryBtn = container.querySelector(".dh-recovery-retry-btn");
      expect(retryBtn).not.toBeNull();
      expect(retryBtn.textContent).toBe("Retry Loading");

      await retryBtn.onclick(new MouseEvent("click"));
      expect(onRetry).toHaveBeenCalled();
      expect(retryCalled).toBe(true);

      // Verify Copy Report Button copies diagnostics
      const copyBtn = container.querySelector(".dh-recovery-copy-btn");
      expect(copyBtn).not.toBeNull();

      await copyBtn.onclick(new MouseEvent("click"));
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
      expect(clipboardText).toContain("[Core Habits Startup Error Report]");
      expect(clipboardText).toContain("Database locked during mobile indexing");
      expect(clipboardText).toContain("main.js:123:45");

      // Verify Expandable details
      const details = container.querySelector(".dh-recovery-details");
      expect(details).not.toBeNull();
      expect(details.querySelector("summary").textContent).toBe("Error details & recovery report");
      expect(details.querySelector(".dh-recovery-stack").textContent).toContain("Database locked");
    });

    it("renders Arabic RTL recovery UI properly", () => {
      const container = document.createElement("div");
      const sampleError = new Error("فشل التهيئة");

      StatusView.renderStartupFailure(container, {
        error: sampleError,
        onRetry: vi.fn(),
        t: (k) => TRANSLATIONS.ar[k] || k,
        isAr: true,
        backupFolder: "Core Habits/.backups"
      });

      const wrapper = container.querySelector(".dh-startup-failure-state");
      expect(wrapper.getAttribute("dir")).toBe("rtl");
      expect(container.querySelector(".error-text").textContent).toBe("تعذر تهيئة Core Habits بأمان");
      expect(container.querySelector(".dh-recovery-retry-btn").textContent).toBe("إعادة المحاولة");
      expect(container.querySelector(".dh-recovery-copy-btn").textContent).toBe("نسخ تقرير الخطأ");
    });
  });

  describe("5. Final Backward-Compatibility Audit across Schema 0, 1, 2, and 3", () => {
    it("handles Schema 0 (unversioned legacy note without schema_version)", () => {
      const s0Props = {
        habit_id: "s0-habit",
        habit_type: "build",
        color: "red",
        days: "0, 1, 2",
        order: "3",
        current_level: "2",
        goal: "Walk 1000 steps"
      };
      const file = new TFile("Core Habits/Active/S0 Habit.md");
      const entity = habitNoteManager.propsToHabit(file, s0Props);

      expect(entity.schemaVersion).toBe(1); // Defaults to 1 for unversioned notes
      expect(entity.id).toBe("s0-habit");
      expect(entity.schedule.days).toEqual([0, 1, 2]);
      expect(entity.currentLevel).toBe(2);
      expect(entity.levelData[0].goal).toBe("Walk 1000 steps");
    });

    it("handles Schema 1 (explicit v1 with days array and order)", () => {
      const s1Props = {
        schema_version: 1,
        habit_id: "s1-habit",
        habit_type: "break",
        color: "orange",
        days: "[2, 4]",
        order: 7,
        current_level: 1,
        level_1_goal: "Reduce coffee",
        level_1_condition: "Max 1 cup",
        level_1_achieved: true,
        archived: "false"
      };
      const file = new TFile("Core Habits/Active/S1 Habit.md");
      const entity = habitNoteManager.propsToHabit(file, s1Props);

      expect(entity.schemaVersion).toBe(1);
      expect(entity.id).toBe("s1-habit");
      expect(entity.habitType).toBe("break");
      expect(entity.schedule.days).toEqual([2, 4]);
      expect(entity.order).toBe(7);
      expect(entity.levelData[0].goal).toBe("Reduce coffee");
      expect(entity.levelData[0].achieved).toBe(true);
    });

    it("handles Schema 2 (v2 with schedule string, name_history string, and legacy logs)", () => {
      const s2Props = {
        schema_version: 2,
        habit_id: "s2-habit",
        habit_type: "build",
        color: "teal",
        schedule: "0,2,4,6",
        order: 2,
        current_level: 4,
        saved_longest_streak: 25,
        name_history: "[[Old Name A]]|||[[Old Name B]]",
        archived: "true",
        archived_at: "2024-03-01",
        deleted: "false"
      };
      const file = new TFile("Core Habits/Archive/S2 Habit.md");
      const entity = habitNoteManager.propsToHabit(file, s2Props);

      expect(entity.schemaVersion).toBe(2);
      expect(entity.schedule.days).toEqual([0, 2, 4, 6]);
      expect(entity.savedLongestStreak).toBe(25);
      expect(entity.nameHistory).toEqual(["[[Old Name A]]", "[[Old Name B]]"]);
      expect(entity.archived).toBe(true);
      expect(entity.deleted).toBe(false);
    });

    it("handles Schema 3 (modern sparse contract without order or current_level in frontmatter)", () => {
      const s3Props = {
        schema_version: 3,
        habit_id: "s3-habit",
        habit_type: "build",
        color: "blue",
        schedule: "daily",
        archived: false,
        created_at: "2024-06-01",
        saved_longest_streak: 15
      };
      const file = new TFile("Core Habits/Active/S3 Habit.md");
      const entity = habitNoteManager.propsToHabit(file, s3Props);

      expect(entity.schemaVersion).toBe(3);
      expect(entity.currentLevel).toBe(3); // Derived dynamically from streak (7-20 -> level 3)
      expect(entity.order).toBe(0); // Order lives in settings
      expect(entity.archived).toBe(false);
      expect(entity.savedLongestStreak).toBe(15);
      expect(entity.notes).toBe("");
    });
  });
});
