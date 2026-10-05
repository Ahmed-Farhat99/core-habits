import { describe, it, expect, beforeEach, vi } from "vitest";
import { HabitNoteManager } from "../src/services/HabitNoteManager.js";
import { HabitRepository } from "../src/repositories/HabitRepository.js";
import { HabitManager } from "../src/services/HabitManager.js";
import { TFile } from "obsidian";
import { TRANSLATIONS } from "../src/constants.js";

describe("Phase 3: Repository Fault Isolation Tests", () => {
  let mockApp;
  let mockPlugin;
  let habitNoteManager;
  let habitRepository;
  let habitManager;
  let filesMap;
  let cacheStore;

  const createNoteContent = (id, name, type = "build", extra = "") => `---
schema_version: 3
habit_id: ${id}
habit_type: ${type}
color: "#4a90e2"
schedule: daily
archived: false
created_at: 1700000000000
deleted: false
${extra}
---
# ${name}
`;

  const makeTFile = (path, content) => {
    const file = new TFile(path);
    file.content = content;
    file.stat = { ctime: 1700000000000, mtime: 1700000000000 };
    return file;
  };

  beforeEach(() => {
    filesMap = new Map();
    cacheStore = new Map();

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
        rename: vi.fn(async (file, newPath) => {
          filesMap.delete(file.path);
          file.path = newPath;
          file.name = newPath.split("/").pop();
          file.basename = file.name.replace(/\.md$/i, "");
          filesMap.set(newPath, file);
        }),
        delete: vi.fn(async (file) => {
          filesMap.delete(file.path);
        }),
        create: vi.fn(async (path, content = "") => {
          const file = makeTFile(path, content);
          filesMap.set(path, file);
          return file;
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
        getFileCache: vi.fn((file) => cacheStore.get(file.path) || null),
      },
    };

    mockPlugin = {
      app: mockApp,
      settings: {
        habitNotesFolder: "Core Habits",
        language: "en",
        habitOrder: [],
        habitOrderVersion: 1,
      },
      saveSettings: vi.fn(async () => {}),
      translationManager: {
        t: (k, p = {}) => {
          let str = TRANSLATIONS.en[k] || TRANSLATIONS.ar[k] || k;
          Object.keys(p).forEach((param) => {
            str = str.replace(`{${param}}`, p[param]);
          });
          return str;
        },
      },
    };

    habitNoteManager = new HabitNoteManager(mockApp, mockPlugin);
    mockPlugin.habitNoteManager = habitNoteManager;

    habitRepository = new HabitRepository(mockApp, mockPlugin);
    mockPlugin.habitRepository = habitRepository;

    habitManager = new HabitManager(mockPlugin);
    mockPlugin.habitManager = habitManager;
  });

  describe("Duplicate habit_id Isolation", () => {
    it("should not throw or crash when duplicate habit_ids are encountered in Active folder", async () => {
      const file1 = makeTFile("Core Habits/Active/Reading.md", createNoteContent("habit-dup-1", "Reading"));
      const file2 = makeTFile("Core Habits/Active/ReadingCopy.md", createNoteContent("habit-dup-1", "ReadingCopy"));
      const healthy = makeTFile("Core Habits/Active/Coding.md", createNoteContent("habit-healthy-1", "Coding"));

      filesMap.set(file1.path, file1);
      filesMap.set(file2.path, file2);
      filesMap.set(healthy.path, healthy);

      const loaded = await habitRepository.loadAll();

      // Only the healthy habit should be returned
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe("habit-healthy-1");

      // Conflicts are tracked and exposed
      expect(habitRepository.getConflicts()).toHaveLength(1);
      const conflict = habitRepository.getConflict("habit-dup-1");
      expect(conflict).toBeDefined();
      expect(conflict.habitId).toBe("habit-dup-1");
      expect(conflict.type).toBe("duplicate_id");
      expect(conflict.paths).toEqual(
        expect.arrayContaining(["Core Habits/Active/Reading.md", "Core Habits/Active/ReadingCopy.md"])
      );

      // Conflicted habit is quarantined and unindexed
      expect(habitRepository.isQuarantined("habit-dup-1")).toBe(true);
      expect(habitNoteManager.getFilePathByHabitId("habit-dup-1")).toBeFalsy();
      expect(habitNoteManager.getFilePathByHabitId("habit-healthy-1")).toBe("Core Habits/Active/Coding.md");

      // Verify NO destructive actions: files on disk remain untouched
      expect(mockApp.vault.delete).not.toHaveBeenCalled();
      expect(mockApp.vault.rename).not.toHaveBeenCalled();
      expect(filesMap.has("Core Habits/Active/Reading.md")).toBe(true);
      expect(filesMap.has("Core Habits/Active/ReadingCopy.md")).toBe(true);
    });

    it("should classify and quarantine Active vs Archive duplicate notes", async () => {
      const activeFile = makeTFile("Core Habits/Active/Meditation.md", createNoteContent("habit-meditate", "Meditation"));
      const archiveFile = makeTFile("Core Habits/Archive/Meditation.md", createNoteContent("habit-meditate", "Meditation", "build", "archived: true"));
      const exerciseFile = makeTFile("Core Habits/Active/Exercise.md", createNoteContent("habit-exercise", "Exercise"));

      filesMap.set(activeFile.path, activeFile);
      filesMap.set(archiveFile.path, archiveFile);
      filesMap.set(exerciseFile.path, exerciseFile);

      const loaded = await habitRepository.loadAll();

      // Only Exercise is loaded
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe("habit-exercise");

      // Conflict classified as active_archive_duplicate
      const conflict = habitRepository.getConflict("habit-meditate");
      expect(conflict).toBeDefined();
      expect(conflict.type).toBe("active_archive_duplicate");
      expect(conflict.paths).toContain("Core Habits/Active/Meditation.md");
      expect(conflict.paths).toContain("Core Habits/Archive/Meditation.md");
      expect(conflict.details).toContain("Active and Archive");

      // Neither active nor archive version was deleted
      expect(mockApp.vault.delete).not.toHaveBeenCalled();
      expect(filesMap.get(activeFile.path)).toBeDefined();
      expect(filesMap.get(archiveFile.path)).toBeDefined();
    });

    it("should classify and quarantine Cloud sync conflict copies (.sync-conflict- and (1).md)", async () => {
      const originalFile = makeTFile("Core Habits/Active/Journaling.md", createNoteContent("habit-journal", "Journaling"));
      const syncConflictFile = makeTFile(
        "Core Habits/Active/Journaling.sync-conflict-20231010-123456-ABCDEFG.md",
        createNoteContent("habit-journal", "Journaling")
      );
      const copy1File = makeTFile("Core Habits/Active/Journaling (1).md", createNoteContent("habit-journal", "Journaling"));

      filesMap.set(originalFile.path, originalFile);
      filesMap.set(syncConflictFile.path, syncConflictFile);
      filesMap.set(copy1File.path, copy1File);

      const loaded = await habitRepository.loadAll();

      expect(loaded).toHaveLength(0);

      const conflict = habitRepository.getConflict("habit-journal");
      expect(conflict).toBeDefined();
      expect(conflict.type).toBe("sync_conflict");
      expect(conflict.paths).toHaveLength(3);
      expect(conflict.details).toContain("Cloud sync conflict");

      // All 3 files remain intact on disk
      expect(filesMap.size).toBe(3);
      expect(mockApp.vault.delete).not.toHaveBeenCalled();
    });
  });

  describe("Malformed Habit Notes & Missing habit_id", () => {
    it("should skip notes with missing habit_id without throwing and record them as malformed", async () => {
      const missingIdContent = `---
schema_version: 3
habit_type: build
color: "#4a90e2"
schedule: daily
---
# Missing ID Habit
`;
      const malformedFile = makeTFile("Core Habits/Active/NoId.md", missingIdContent);
      const healthyFile = makeTFile("Core Habits/Active/Healthy.md", createNoteContent("habit-healthy", "Healthy"));

      filesMap.set(malformedFile.path, malformedFile);
      filesMap.set(healthyFile.path, healthyFile);

      const loaded = await habitRepository.loadAll();

      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe("habit-healthy");

      const malformed = habitRepository.getMalformedNotes();
      expect(malformed).toHaveLength(1);
      expect(malformed[0].path).toBe("Core Habits/Active/NoId.md");
      expect(malformed[0].reason).toBe("missing_habit_id");

      // File is not touched on disk
      expect(filesMap.get(malformedFile.path)).toBeDefined();
    });

    it("should skip notes without YAML frontmatter gracefully", async () => {
      const nonYamlContent = "# Just a regular markdown note without frontmatter\nSome content";
      const regularNote = makeTFile("Core Habits/Active/Notes.md", nonYamlContent);
      const healthyFile = makeTFile("Core Habits/Active/Healthy.md", createNoteContent("habit-ok", "Healthy"));

      filesMap.set(regularNote.path, regularNote);
      filesMap.set(healthyFile.path, healthyFile);

      const loaded = await habitRepository.loadAll();

      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe("habit-ok");

      const malformed = habitRepository.getMalformedNotes();
      expect(malformed).toHaveLength(1);
      expect(malformed[0].path).toBe("Core Habits/Active/Notes.md");
      expect(malformed[0].reason).toBe("missing_frontmatter");
    });
  });

  describe("HabitManager Safe Initialization & Order Preservation", () => {
    it("should initialize HabitManager with healthy habits and expose conflicts and malformed notes", async () => {
      const file1 = makeTFile("Core Habits/Active/Reading.md", createNoteContent("dup-id", "Reading"));
      const file2 = makeTFile("Core Habits/Active/Reading (1).md", createNoteContent("dup-id", "Reading"));
      const file3 = makeTFile("Core Habits/Active/Coding.md", createNoteContent("healthy-coding", "Coding"));
      const file4 = makeTFile("Core Habits/Active/NoId.md", "Plain content without frontmatter");

      filesMap.set(file1.path, file1);
      filesMap.set(file2.path, file2);
      filesMap.set(file3.path, file3);
      filesMap.set(file4.path, file4);

      // Must not throw or reject
      await expect(habitManager.initialize()).resolves.toBeUndefined();
      expect(habitManager.isInitialized).toBe(true);

      // Healthy habit is present in habitsMap
      expect(habitManager.habitsMap.size).toBe(1);
      expect(habitManager.getHabitById("healthy-coding")).toBeDefined();
      expect(habitManager.getHabitById("dup-id")).toBeFalsy();

      // Conflicts and malformed accessible via HabitManager
      expect(habitManager.getConflicts()).toHaveLength(1);
      expect(habitManager.isHabitQuarantined("dup-id")).toBe(true);
      expect(habitManager.isHabitQuarantined("healthy-coding")).toBe(false);
      expect(habitManager.getMalformedNotes()).toHaveLength(1);
    });

    it("should NOT destructively prune quarantined habit IDs from order reconciliation", async () => {
      // Simulate order containing healthy habit and a quarantined habit
      mockPlugin.settings.habitOrder = ["healthy-coding", "quarantined-habit"];
      mockPlugin.settings.habitOrderVersion = 1;

      const healthy = makeTFile("Core Habits/Active/Coding.md", createNoteContent("healthy-coding", "Coding"));
      const dup1 = makeTFile("Core Habits/Active/Walk.md", createNoteContent("quarantined-habit", "Walk"));
      const dup2 = makeTFile("Core Habits/Active/WalkCopy.md", createNoteContent("quarantined-habit", "WalkCopy"));

      filesMap.set(healthy.path, healthy);
      filesMap.set(dup1.path, dup1);
      filesMap.set(dup2.path, dup2);

      await habitManager.initialize();

      // The quarantined habit must NOT have been stripped from the reconciled order
      expect(mockPlugin.settings.habitOrder).toContain("healthy-coding");
      expect(mockPlugin.settings.habitOrder).toContain("quarantined-habit");
    });
  });

  describe("Runtime Duplicate Protection (syncFile)", () => {
    it("should quarantine habit when a duplicate note arrives at runtime instead of corrupting state", async () => {
      const original = makeTFile("Core Habits/Active/Gym.md", createNoteContent("habit-gym", "Gym"));
      filesMap.set(original.path, original);

      await habitManager.initialize();
      expect(habitManager.getHabitById("habit-gym")).toBeDefined();
      expect(habitNoteManager.getFilePathByHabitId("habit-gym")).toBe("Core Habits/Active/Gym.md");

      // Now a cloud sync duplicate arrives at runtime
      const syncCopy = makeTFile(
        "Core Habits/Active/Gym.sync-conflict-20231010-090909.md",
        createNoteContent("habit-gym", "Gym")
      );
      filesMap.set(syncCopy.path, syncCopy);

      // Trigger syncFile on the new copy
      await habitManager.syncFile(syncCopy);

      // In-memory state should be protected: quarantined and deleted from active habitsMap
      expect(habitManager.getHabitById("habit-gym")).toBeFalsy();
      expect(habitNoteManager.getFilePathByHabitId("habit-gym")).toBeFalsy();
      expect(habitRepository.isQuarantined("habit-gym")).toBe(true);

      // Neither file is deleted
      expect(filesMap.get(original.path)).toBeDefined();
      expect(filesMap.get(syncCopy.path)).toBeDefined();
    });
  });
});
