import { describe, it, expect, beforeEach, vi } from "vitest";
import { HabitNoteManager } from "../src/services/HabitNoteManager.js";
import { HabitRepository } from "../src/repositories/HabitRepository.js";
import { MigrationManager } from "../src/services/MigrationManager.js";
import { TFile } from "obsidian";
import { TRANSLATIONS } from "../src/constants.js";

describe("Cold Start & MetadataCache Safety Tests (Phase 1)", () => {
  let mockApp;
  let mockPlugin;
  let habitNoteManager;
  let habitRepository;
  let filesMap;
  let cacheStore;

  const legacyV1Content = `---
schema_version: 1
habit_id: habit-reading-123
habit_type: build
name: Reading
color: "#4a90e2"
order: 2
current_level: 3
days:
  - mon
  - wed
  - fri
archived: false
created_at: 1700000000000
saved_longest_streak: 14
notes: "Read 20 pages a day"
identity: "I am a reader"
cue: "After morning coffee"
friction: "Keep book on desk"
reward: "Enjoy tea"
---
\`\`\`core-habits
\`\`\`

> **Free Space for Notes:**
> Keep up the momentum!
`;

  const v3Content = `---
schema_version: 3
habit_id: habit-coding-456
habit_type: build
color: "#10b981"
schedule:
  type: daily
archived: false
created_at: 1705000000000
deleted: false
notes: "Daily coding practice"
---
\`\`\`core-habits
\`\`\`
`;

  beforeEach(() => {
    filesMap = new Map();
    cacheStore = new Map();

    const makeTFile = (path, content) => {
      const file = new TFile(path);
      file.content = content;
      file.stat = { ctime: 1700000000000, mtime: 1700000000000 };
      return file;
    };

    const readingFile = makeTFile("Core Habits/Active/Reading.md", legacyV1Content);
    const codingFile = makeTFile("Core Habits/Active/Coding.md", v3Content);

    filesMap.set(readingFile.path, readingFile);
    filesMap.set(codingFile.path, codingFile);

    mockApp = {
      vault: {
        adapter: {
          getBasePath: () => "C:/Vault",
        },
        getAbstractFileByPath: vi.fn((path) => filesMap.get(path) || null),
        getMarkdownFiles: vi.fn(() => Array.from(filesMap.values()).filter(f => f.path.endsWith(".md"))),
        read: vi.fn(async (file) => file.content || ""),
        cachedRead: vi.fn(async (file) => file.content || ""),
        modify: vi.fn(async (file, content) => {
          file.content = content;
        }),
        process: vi.fn(async (file, fn) => {
          file.content = fn(file.content || "");
          return file.content;
        }),
        rename: vi.fn(async (file, newPath) => {
          filesMap.delete(file.path);
          file.path = newPath;
          file.name = newPath.split("/").pop();
          file.basename = file.name.replace(/\.md$/i, "");
          filesMap.set(newPath, file);
        }),
        createFolder: vi.fn(async (path) => ({ path })),
      },
      fileManager: {
        processFrontMatter: vi.fn(async (file, fn) => {
          let fm = cacheStore.get(file.path)?.frontmatter;
          if (!fm) {
            fm = HabitNoteManager.parseFrontmatterFromContent(file.content) || {};
          }
          fn(fm);
          cacheStore.set(file.path, { frontmatter: fm });
        }),
      },
      metadataCache: {
        // Cold start initial state: cache returns null or undefined
        getFileCache: vi.fn((file) => cacheStore.get(file.path) || null),
      },
    };

    mockPlugin = {
      settings: {
        habitNotesFolder: "Core Habits",
        language: "en",
        collapsedGroups: [],
        collapsedGroupsSemanticMigrated: true,
      },
      translationManager: {
        t: (k, p = {}) => {
          let str = TRANSLATIONS.en[k] || TRANSLATIONS.ar[k] || k;
          Object.keys(p).forEach(param => { str = str.replace(`{${param}}`, p[param]); });
          return str;
        },
      },
    };

    habitNoteManager = new HabitNoteManager(mockApp, mockPlugin);
    mockPlugin.habitNoteManager = habitNoteManager;
    habitRepository = new HabitRepository(mockApp, mockPlugin);
    mockPlugin.habitRepository = habitRepository;
  });

  describe("Cold Start Frontmatter Reading", () => {
    it("should parse frontmatter directly from file when metadataCache is null on cold start", async () => {
      // metadataCache returns null for both files
      mockApp.metadataCache.getFileCache.mockReturnValue(null);

      const props = await habitNoteManager.readHabitNoteProps("Core Habits/Active/Reading.md");

      expect(props).not.toBeNull();
      expect(props.habit_id).toBe("habit-reading-123");
      expect(props.schema_version).toBe(1);
      expect(props.order).toBe(2);
      expect(props.current_level).toBe(3);
      expect(props.saved_longest_streak).toBe(14);
      expect(props.archived).toBe(false);
      expect(props.days).toEqual(["mon", "wed", "fri"]);
      expect(props.identity).toBe("I am a reader");

      // Verify that cachedRead was called because metadataCache had no entry
      expect(mockApp.vault.cachedRead).toHaveBeenCalled();
    });

    it("should parse frontmatter when metadataCache object exists but getFileCache returns empty/undefined frontmatter", async () => {
      mockApp.metadataCache.getFileCache.mockReturnValue({});

      const props = await habitNoteManager.readHabitNoteProps("Core Habits/Active/Coding.md");

      expect(props).not.toBeNull();
      expect(props.habit_id).toBe("habit-coding-456");
      expect(props.schema_version).toBe(3);
      expect(props.color).toBe("#10b981");
      expect(mockApp.vault.cachedRead).toHaveBeenCalled();
    });

    it("should seamlessly transition from cold start to warm cache once metadataCache becomes ready", async () => {
      // Step 1: Cold start (metadataCache is not indexed yet)
      mockApp.metadataCache.getFileCache.mockReturnValue(null);

      const coldProps = await habitNoteManager.readHabitNoteProps("Core Habits/Active/Reading.md");
      expect(coldProps.habit_id).toBe("habit-reading-123");
      expect(mockApp.vault.cachedRead).toHaveBeenCalledTimes(1);

      // Step 2: Obsidian background indexing completes, populating metadataCache
      cacheStore.set("Core Habits/Active/Reading.md", {
        frontmatter: {
          schema_version: 1,
          habit_id: "habit-reading-123",
          habit_type: "build",
          color: "#4a90e2",
          cached_fast: true,
        },
      });
      mockApp.metadataCache.getFileCache.mockImplementation((file) => cacheStore.get(file.path) || null);

      // Reset spy call count
      mockApp.vault.cachedRead.mockClear();

      // Step 3: Subsequent read uses warm cache without disk reads
      const warmProps = await habitNoteManager.readHabitNoteProps("Core Habits/Active/Reading.md");
      expect(warmProps.cached_fast).toBe(true);
      expect(warmProps.habit_id).toBe("habit-reading-123");
      expect(mockApp.vault.cachedRead).not.toHaveBeenCalled();
    });

    it("should handle resilient parsing of diverse frontmatter types without external YAML library", () => {
      const sample = `---
str_val: "simple string"
single_str: 'single quoted'
num_val: 42
float_val: 3.14
bool_true: true
bool_false: false
null_val: null
empty_val:
inline_list: [apple, "banana", 100, true]
multiline_list:
  - first
  - "second item"
  - 300
comment_val: valid_val # this is a comment
---
Content starts here
`;
      const parsed = HabitNoteManager.parseFrontmatterFromContent(sample);
      expect(parsed).toEqual({
        str_val: "simple string",
        single_str: "single quoted",
        num_val: 42,
        float_val: 3.14,
        bool_true: true,
        bool_false: false,
        null_val: null,
        empty_val: "",
        inline_list: ["apple", "banana", 100, true],
        multiline_list: ["first", "second item", 300],
        comment_val: "valid_val",
      });
    });

    it("should return null for malformed or missing frontmatter without throwing", () => {
      expect(HabitNoteManager.parseFrontmatterFromContent("")).toBeNull();
      expect(HabitNoteManager.parseFrontmatterFromContent(null)).toBeNull();
      expect(HabitNoteManager.parseFrontmatterFromContent("No frontmatter here")).toBeNull();
      expect(HabitNoteManager.parseFrontmatterFromContent("---\nUnclosed frontmatter")).toBeNull();
    });
  });

  describe("HabitRepository Cold Start", () => {
    it("should load all habits successfully even when metadataCache is completely unindexed (null)", async () => {
      // Simulate cold start where getFileCache returns null for all files
      mockApp.metadataCache.getFileCache.mockReturnValue(null);

      const habits = await habitRepository.loadAll();

      expect(habits).toHaveLength(2);
      const reading = habits.find((h) => h.id === "habit-reading-123");
      const coding = habits.find((h) => h.id === "habit-coding-456");

      expect(reading).toBeDefined();
      expect(reading.name).toBe("Reading");
      expect(reading.color).toBe("#4a90e2");

      expect(coding).toBeDefined();
      expect(coding.name).toBe("Coding");
      expect(coding.color).toBe("#10b981");

      // Verify that habit paths were indexed into habitNoteManager
      expect(habitNoteManager.getFilePathByHabitId("habit-reading-123")).toBe("Core Habits/Active/Reading.md");
      expect(habitNoteManager.getFilePathByHabitId("habit-coding-456")).toBe("Core Habits/Active/Coding.md");
    });
  });

  describe("Migration Collision Protection on Cold Start", () => {
    it("should not throw migration collision error when metadataCache is unindexed during migrateV3Data", async () => {
      // Setup legacy habits in settings
      mockPlugin.settings.habits = [
        {
          id: "habit-reading-123",
          name: "Reading",
          color: "#4a90e2",
          order: 2,
        },
      ];

      const migrationManager = new MigrationManager(mockApp, mockPlugin);

      // MetadataCache is cold/null
      mockApp.metadataCache.getFileCache.mockReturnValue(null);

      // During migrateV3Data, the file exists on disk.
      // Previously, getFileCache was null, so existingId was undefined, causing "Migration path collision".
      // Now it must read habit_id via readHabitNoteProps fallback safely.
      await expect(migrationManager.migrateV3Data()).resolves.not.toThrow();
    });
  });

  describe("File Resolution during Cold Start", () => {
    it("should resolve habit file by indexed path even when metadataCache is unindexed", () => {
      habitNoteManager.indexHabitFile("habit-reading-123", "Core Habits/Active/Reading.md");
      mockApp.metadataCache.getFileCache.mockReturnValue(null);

      const resolved = habitNoteManager.resolveHabitFile({
        id: "habit-reading-123",
        name: "Reading",
        archived: false,
      });

      expect(resolved).not.toBeNull();
      expect(resolved.path).toBe("Core Habits/Active/Reading.md");
    });

    it("should find file by habitId when metadataCache is unindexed", () => {
      habitNoteManager.indexHabitFile("habit-coding-456", "Core Habits/Active/Coding.md");
      mockApp.metadataCache.getFileCache.mockReturnValue(null);

      const resolved = habitNoteManager._findFileByHabitId("habit-coding-456");
      expect(resolved).not.toBeNull();
      expect(resolved.path).toBe("Core Habits/Active/Coding.md");
    });
  });

  describe("Completely Missing metadataCache (metadataCache = null)", () => {
    it("should handle null metadataCache safely without throwing TypeError", async () => {
      // Set metadataCache property to null on app
      mockApp.metadataCache = null;

      const props = await habitNoteManager.readHabitNoteProps("Core Habits/Active/Reading.md");
      expect(props).not.toBeNull();
      expect(props.habit_id).toBe("habit-reading-123");
      expect(props.schema_version).toBe(1);
    });
  });

  describe("UTF-8 and Arabic Frontmatter Parsing Fallback", () => {
    it("should parse Arabic names, quotes, and notes accurately via fallback parser", () => {
      const arabicContent = `---
schema_version: 1
habit_id: habit-quran-789
name: "قراءة ورد القرآن"
notes: 'قراءة جزء يوميًا بعد صلاة الفجر'
cue: "بعد صلاة الفجر مباشرة"
friction: "وضع المصحف في مكان الصلاة"
reward: "شعور بالسكينة والبركة"
days:
  - sat
  - sun
  - mon
---
\`\`\`core-habits
\`\`\`
`;
      const parsed = HabitNoteManager.parseFrontmatterFromContent(arabicContent);
      expect(parsed).toEqual({
        schema_version: 1,
        habit_id: "habit-quran-789",
        name: "قراءة ورد القرآن",
        notes: "قراءة جزء يوميًا بعد صلاة الفجر",
        cue: "بعد صلاة الفجر مباشرة",
        friction: "وضع المصحف في مكان الصلاة",
        reward: "شعور بالسكينة والبركة",
        days: ["sat", "sun", "mon"],
      });
    });
  });
});

