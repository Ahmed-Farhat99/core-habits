import { describe, expect, it, vi, beforeEach } from "vitest";
import DailyHabitsPlugin from "../src/main.js";
import { TFile } from "obsidian";


describe("Phase B: Events, Sync, and Lifecycle Safety", () => {
  let plugin;

  beforeEach(() => {
    plugin = Object.create(DailyHabitsPlugin.prototype);
    plugin._isUnloading = false;
    plugin._globalLockCount = 0;
    plugin._lockedPaths = new Map();
    plugin.settings = {
      autoWriteHabits: true,
      habitNotesFolder: "Core Habits",
    };
  });

  describe("Path-scoped internal-operation lock", () => {
    it("reports unlocked when no operations are active", () => {
      expect(plugin.isFilePathLocked("Core Habits/Active/Exercise.md")).toBe(false);
      expect(plugin.isFilePathLocked("Daily Notes/2026-10-04.md")).toBe(false);
      expect(plugin.isInternalFileOperation).toBe(false);
      expect(plugin.lockCount).toBe(0);
    });

    it("locks only the targeted file during runWithLock", async () => {
      const targetPath = "Core Habits/Active/Exercise.md";
      const otherPath = "Daily Notes/2026-10-04.md";

      let ran = false;
      const op = plugin.runWithLock(async () => {
        ran = true;
        expect(plugin.isFilePathLocked(targetPath)).toBe(true);
        expect(plugin.isFilePathLocked(otherPath)).toBe(false);
        expect(plugin.isInternalFileOperation).toBe(true);
        return "result-ok";
      }, targetPath);

      const result = await op;
      expect(ran).toBe(true);
      expect(result).toBe("result-ok");

      // Debounce window (150ms) has elapsed once runWithLock resolves
      expect(plugin.isFilePathLocked(targetPath)).toBe(false);
      expect(plugin.isInternalFileOperation).toBe(false);
      expect(plugin.lockCount).toBe(0);
    });

    it("locks subpaths when a folder is locked", async () => {
      const folderPath = "Core Habits";
      const insideFile = "Core Habits/Active/Exercise.md";
      const outsideFile = "Core Habits Other/Exercise.md";
      const dailyNote = "Daily Notes/2026-10-04.md";

      await plugin.runWithLock(async () => {
        expect(plugin.isFilePathLocked(folderPath)).toBe(true);
        expect(plugin.isFilePathLocked(insideFile)).toBe(true);
        expect(plugin.isFilePathLocked(outsideFile)).toBe(false);
        expect(plugin.isFilePathLocked(dailyNote)).toBe(false);
      }, folderPath);

      expect(plugin.isFilePathLocked(insideFile)).toBe(false);
    });

    it("falls back to global lock if no target paths are provided", async () => {
      await plugin.runWithLock(async () => {
        expect(plugin.isInternalFileOperation).toBe(true);
        expect(plugin.isFilePathLocked("Any/File/A.md")).toBe(true);
        expect(plugin.isFilePathLocked("Any/File/B.md")).toBe(true);
      });

      expect(plugin.isInternalFileOperation).toBe(false);
      expect(plugin.isFilePathLocked("Any/File/A.md")).toBe(false);
    });

    it("supports multi-path locking for operations touching multiple files", async () => {
      const fileA = "Core Habits/Active/Exercise.md";
      const fileB = "Core Habits/Archive/Exercise.md";
      const orderFile = "Core Habits/_order.md";
      const dailyNote = "Daily Notes/2026-10-04.md";

      await plugin.runWithLock(async () => {
        expect(plugin.isFilePathLocked(fileA)).toBe(true);
        expect(plugin.isFilePathLocked(fileB)).toBe(true);
        expect(plugin.isFilePathLocked(orderFile)).toBe(true);
        expect(plugin.isFilePathLocked(dailyNote)).toBe(false);
      }, [fileA, fileB, orderFile]);

      expect(plugin.isFilePathLocked(fileA)).toBe(false);
      expect(plugin.isFilePathLocked(fileB)).toBe(false);
      expect(plugin.isFilePathLocked(orderFile)).toBe(false);
    });

    it("safely unlocks even if the operation throws an error", async () => {
      const file = "Core Habits/Active/Failed.md";
      await expect(
        plugin.runWithLock(async () => {
          throw new Error("Disk error");
        }, file)
      ).rejects.toThrow("Disk error");

      expect(plugin.isFilePathLocked(file)).toBe(false);
      expect(plugin.lockCount).toBe(0);
    });
  });

  describe("Obsidian Sync & Git External Change Safety", () => {
    it("does not drop external sync events while an internal operation runs on a different file", async () => {
      const internalDailyNote = "Daily Notes/2026-10-04.md";
      const syncedHabitPath = "Core Habits/Active/Reading.md";

      const syncedFile = new TFile();
      syncedFile.path = syncedHabitPath;
      syncedFile.extension = "md";

      const syncFileMock = vi.fn().mockResolvedValue(undefined);
      plugin.habitManager = { syncFile: syncFileMock };
      plugin.statsService = { rescanFile: vi.fn().mockResolvedValue(undefined) };

      // Simulate an internal write on internalDailyNote with a slight pause
      let externalEventFired = false;
      await plugin.runWithLock(async () => {
        // While internal operation is executing, Obsidian Sync fires metadataCache.on('changed') for Reading.md
        expect(plugin.isFilePathLocked(internalDailyNote)).toBe(true);
        expect(plugin.isFilePathLocked(syncedFile.path)).toBe(false);

        // This simulates the metadataCache listener callback from main.js:
        if (!plugin._isUnloading && !plugin.isFilePathLocked(syncedFile.path)) {
          await plugin.habitManager.syncFile(syncedFile);
          externalEventFired = true;
        }
      }, internalDailyNote);

      expect(externalEventFired).toBe(true);
      expect(syncFileMock).toHaveBeenCalledWith(syncedFile);
      expect(syncFileMock).toHaveBeenCalledTimes(1);
    });

    it("drops self-generated events on the specifically locked file", async () => {
      const internalHabitPath = "Core Habits/Active/Meditation.md";
      const internalFile = new TFile();
      internalFile.path = internalHabitPath;
      internalFile.extension = "md";

      const syncFileMock = vi.fn().mockResolvedValue(undefined);
      plugin.habitManager = { syncFile: syncFileMock };

      await plugin.runWithLock(async () => {
        // Simulating metadataCache event fired for the file being edited internally:
        if (!plugin._isUnloading && !plugin.isFilePathLocked(internalFile.path)) {
          await plugin.habitManager.syncFile(internalFile);
        }
      }, internalHabitPath);

      // The self-generated event on the locked file was correctly suppressed!
      expect(syncFileMock).not.toHaveBeenCalled();
    });
  });

  describe("Vault create event handling", () => {
    it("handles new habit files created via vault.on('create')", async () => {
      const newHabitFile = new TFile();
      newHabitFile.path = "Core Habits/Active/NewHabit.md";
      newHabitFile.extension = "md";

      const syncFileMock = vi.fn().mockResolvedValue(undefined);
      const rescanFileMock = vi.fn().mockResolvedValue(undefined);
      plugin.habitManager = { syncFile: syncFileMock };
      plugin.statsService = { rescanFile: rescanFileMock };

      // Simulate the vault.on('create') event handler from main.js
      const handleCreate = async (file) => {
        if (plugin._isUnloading || plugin.isFilePathLocked(file?.path)) return;
        if (!(file instanceof TFile) || !file.path.endsWith('.md')) return;
        if (plugin.habitManager) await plugin.habitManager.syncFile(file);
        if (plugin._isUnloading) return;
        if (plugin.statsService) await plugin.statsService.rescanFile(file);
      };

      await handleCreate(newHabitFile);

      expect(syncFileMock).toHaveBeenCalledWith(newHabitFile);
      expect(rescanFileMock).toHaveBeenCalledWith(newHabitFile);
    });

    it("skips vault.on('create') if the file is internally locked", async () => {
      const internalCreatedFile = new TFile();
      internalCreatedFile.path = "Core Habits/Active/CreatedByPlugin.md";
      internalCreatedFile.extension = "md";

      const syncFileMock = vi.fn();
      plugin.habitManager = { syncFile: syncFileMock };

      const handleCreate = async (file) => {
        if (plugin._isUnloading || plugin.isFilePathLocked(file?.path)) return;
        if (!(file instanceof TFile) || !file.path.endsWith('.md')) return;
        if (plugin.habitManager) await plugin.habitManager.syncFile(file);
      };

      await plugin.runWithLock(async () => {
        await handleCreate(internalCreatedFile);
      }, internalCreatedFile.path);

      expect(syncFileMock).not.toHaveBeenCalled();
    });
  });

  describe("Vault rename and delete event handling", () => {
    it("skips rename event if the target file or oldPath is locked", async () => {
      const file = new TFile();
      file.path = "Core Habits/Archive/Running.md";
      const oldPath = "Core Habits/Active/Running.md";

      const handleRenameMock = vi.fn().mockResolvedValue(undefined);
      plugin.handleVaultRename = handleRenameMock;
      plugin.statsService = { handleFileRename: vi.fn() };

      const handleRename = (f, op) => {
        if (plugin._isUnloading) return;
        if (plugin.isFilePathLocked(f?.path) || plugin.isFilePathLocked(op)) return;
        if (!(f instanceof TFile) || !f.path.endsWith('.md')) return;
        plugin.statsService.handleFileRename(f, op);
        plugin.handleVaultRename(f, op);
      };

      // 1. Locked oldPath -> should skip
      await plugin.runWithLock(async () => {
        handleRename(file, oldPath);
      }, oldPath);
      expect(handleRenameMock).not.toHaveBeenCalled();

      // 2. Locked newPath -> should skip
      await plugin.runWithLock(async () => {
        handleRename(file, oldPath);
      }, file.path);
      expect(handleRenameMock).not.toHaveBeenCalled();

      // 3. Neither locked (external rename) -> should process
      handleRename(file, oldPath);
      expect(handleRenameMock).toHaveBeenCalledWith(file, oldPath);
    });

    it("skips delete event if the file is locked, but processes external deletions", async () => {
      const file = new TFile();
      file.path = "Core Habits/Active/Temporary.md";

      const removeFileMock = vi.fn().mockResolvedValue(undefined);
      plugin.habitManager = { removeFile: removeFileMock };
      plugin.statsService = { handleFileDelete: vi.fn() };

      const handleDelete = async (f) => {
        if (plugin._isUnloading || plugin.isFilePathLocked(f?.path)) return;
        if (plugin.habitManager) await plugin.habitManager.removeFile(f);
        if (plugin._isUnloading) return;
        if (plugin.statsService) await plugin.statsService.handleFileDelete(f);
      };

      // Internal locked deletion
      await plugin.runWithLock(async () => {
        await handleDelete(file);
      }, file.path);
      expect(removeFileMock).not.toHaveBeenCalled();

      // External deletion
      await handleDelete(file);
      expect(removeFileMock).toHaveBeenCalledWith(file);
    });
  });

  describe("Caller target path scoping verification", () => {
    it("HabitManager passes specific habit and order paths to runWithLock", async () => {
      plugin.saveData = vi.fn().mockResolvedValue(undefined);
      plugin.app = { vault: { getAbstractFileByPath: vi.fn(), process: vi.fn() } };

      const { HabitManager } = await import("../src/services/HabitManager.js");
      const hm = new HabitManager(plugin);
      hm.vaultOrderStore = {
        getOrderFilePath: () => "Core Habits/_order.md",
        writeOrder: vi.fn().mockResolvedValue({})
      };

      let capturedPaths = null;
      plugin.runWithLock = vi.fn(async (cb, paths) => {
        capturedPaths = paths;
        return await cb();
      });

      plugin.habitNoteManager = {
        getHabitFilePath: vi.fn((name, archived) => `Core Habits/${archived ? "Archive" : "Active"}/${name}.md`),
        getOrderFilePath: vi.fn(() => "Core Habits/_order.md")
      };
      plugin.habitRepository = {
        create: vi.fn().mockResolvedValue({ path: "Core Habits/Active/Reading.md" })
      };

      await hm.addHabit({ name: "Reading" });

      expect(plugin.runWithLock).toHaveBeenCalled();
      expect(capturedPaths).toEqual(["Core Habits/Active/Reading.md", "Core Habits/_order.md"]);
    });

    it("HabitCommentRepository passes daily note target path to runWithLock", async () => {
      const { HabitCommentRepository } = await import("../src/repositories/HabitCommentRepository.js");
      const app = {
        vault: {
          getAbstractFileByPath: vi.fn(() => ({ path: "2026-10-04.md", basename: "2026-10-04" })),
          process: vi.fn(async (file, fn) => fn("## Notes\n"))
        }
      };
      const repo = new HabitCommentRepository(app, plugin);

      let capturedPaths = null;
      plugin.runWithLock = vi.fn(async (cb, paths) => {
        capturedPaths = paths;
        return await cb();
      });

      const targetMoment = window.moment("2026-10-04");
      await repo.upsertCommentForHabitDate({ id: "habit-1", name: "Gym" }, targetMoment, "Great workout");

      expect(plugin.runWithLock).toHaveBeenCalled();
      expect(capturedPaths).toBe("2026-10-04.md");
    });
  });

  describe("Lifecycle and unload cleanup", () => {
    it("clears locks, timers, and cleans up all services on unload", async () => {
      plugin._lockedPaths = new Map([["some/path.md", 1]]);
      plugin._globalLockCount = 2;
      plugin._cooldownTimer = setTimeout(() => {}, 10000);
      plugin._missedDaysTimer = setTimeout(() => {}, 10000);
      plugin._openTimeouts = new Map([["pathA", setTimeout(() => {}, 5000)]]);

      const habitManager = {
        flushMilestoneCheckpoints: vi.fn().mockResolvedValue(undefined),
        destroy: vi.fn(),
      };
      const audioEngine = { close: vi.fn().mockResolvedValue(undefined) };
      const statsService = { destroy: vi.fn() };
      const diaryService = { clearCache: vi.fn() };

      plugin.habitManager = habitManager;
      plugin.audioEngine = audioEngine;
      plugin.statsService = statsService;
      plugin.diaryService = diaryService;

      await plugin.onunload();

      expect(plugin._isUnloading).toBe(true);
      expect(plugin._lockedPaths).toBeNull();
      expect(plugin._globalLockCount).toBe(0);
      expect(plugin._cooldownTimer).toBeNull();
      expect(plugin._missedDaysTimer).toBeNull();
      expect(plugin._openTimeouts).toBeNull();

      expect(habitManager.flushMilestoneCheckpoints).toHaveBeenCalledOnce();
      expect(habitManager.destroy).toHaveBeenCalledOnce();
      expect(audioEngine.close).toHaveBeenCalledOnce();
      expect(statsService.destroy).toHaveBeenCalledOnce();
      expect(diaryService.clearCache).toHaveBeenCalledOnce();
    });
  });
});

