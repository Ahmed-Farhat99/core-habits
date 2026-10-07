import { describe, it, expect, beforeEach, vi } from "vitest";
import { TFile } from "obsidian";
import { HabitManager } from "../src/services/HabitManager.js";
import { HabitNoteManager } from "../src/services/HabitNoteManager.js";
import { Utils } from "../src/utils/Utils.js";
import { HabitEntity } from "../src/domain/HabitEntity.js";
import { StreakCalculator } from "../src/services/StreakCalculator.js";
import { ProgressionEngine } from "../src/services/ProgressionEngine.js";
import { MigrationManager } from "../src/services/MigrationManager.js";

describe("Phase 1: HabitOrder and Scoped Index Tests", () => {
  let mockApp;
  let mockPlugin;
  let mockRepository;
  let habitNoteManager;
  let habitManager;
  let activeFolderObj;
  let archiveFolderObj;

  beforeEach(() => {
    activeFolderObj = {
      path: "Core Habits/Active",
      children: []
    };
    archiveFolderObj = {
      path: "Core Habits/Archive",
      children: []
    };

    const vaultFilesMap = new Map();
    mockApp = {
      vault: {
        getAbstractFileByPath: vi.fn((path) => {
          if (path === "Core Habits/Active") return activeFolderObj;
          if (path === "Core Habits/Archive") return archiveFolderObj;
          if (vaultFilesMap.has(path)) return vaultFilesMap.get(path);
          const foundInActive = activeFolderObj.children.find((c) => c.path === path);
          if (foundInActive) return foundInActive;
          const foundInArchive = archiveFolderObj.children.find((c) => c.path === path);
          if (foundInArchive) return foundInArchive;
          return null;
        }),
        getMarkdownFiles: vi.fn(() => {
          throw new Error("Full vault getMarkdownFiles should NOT be called!");
        }),
        create: vi.fn(async (path, content) => {
          const file = new TFile(path);
          file.content = content;
          file._cache = { frontmatter: {} };
          vaultFilesMap.set(path, file);
          return file;
        }),
        createFolder: vi.fn().mockResolvedValue({}),
        read: vi.fn(async (file) => (typeof file === "string" ? "" : file?.content || "")),
        rename: vi.fn()
      },
      fileManager: {
        processFrontMatter: vi.fn(async (file, callback) => {
          if (!file._cache) file._cache = { frontmatter: {} };
          if (!file._cache.frontmatter) file._cache.frontmatter = {};
          callback(file._cache.frontmatter);
        })
      },
      metadataCache: {
        getFileCache: vi.fn((file) => file?._cache || null)
      }
    };

    mockPlugin = {
      app: mockApp,
      settings: {
        habitNotesFolder: "Core Habits",
        habitOrder: []
      },
      saveSettings: vi.fn().mockResolvedValue()
    };

    habitNoteManager = new HabitNoteManager(mockApp, mockPlugin);
    mockPlugin.habitNoteManager = habitNoteManager;

    mockRepository = {
      loadAll: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ path: "Core Habits/Active/New.md" }),
      update: vi.fn().mockResolvedValue(),
      updateFileProps: vi.fn().mockResolvedValue(),
      updateOrder: vi.fn().mockImplementation(() => {
        throw new Error("Markdown updateOrder should NEVER be called on reorder!");
      }),
      resolveHabitFile: vi.fn((habit) => habitNoteManager.resolveHabitFile(habit)),
      archive: vi.fn().mockResolvedValue(),
      restore: vi.fn().mockResolvedValue()
    };
    mockPlugin.habitRepository = mockRepository;

    habitManager = new HabitManager(mockPlugin);
  });

  it("handles 0 habits cleanly without error or unneeded settings writes", async () => {
    mockRepository.loadAll.mockResolvedValue([]);
    await habitManager.initialize();

    expect(habitManager.getHabits()).toEqual([]);
    expect(mockPlugin.settings.habitOrder).toEqual([]);
    expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
  });

  it("handles 1 habit: indexes file and records habitOrder", async () => {
    const singleHabit = { id: "h-1", name: "Gym", order: 0 };
    mockRepository.loadAll.mockResolvedValue([singleHabit]);

    await habitManager.initialize();

    expect(habitManager.getHabits()).toHaveLength(1);
    expect(mockPlugin.settings.habitOrder).toEqual(["h-1"]);
    expect(mockPlugin.saveSettings).toHaveBeenCalledWith({ silent: true });
    expect(habitManager.getHabitById("h-1").order).toBe(0);
  });

  it("migrates legacy files lacking habitOrder using frontmatter order as fallback", async () => {
    const legacyHabits = [
      { id: "h-3", name: "Read", order: 2 },
      { id: "h-1", name: "Pray", order: 0 },
      { id: "h-2", name: "Walk", order: 1 }
    ];
    mockRepository.loadAll.mockResolvedValue(legacyHabits);
    mockPlugin.settings.habitOrder = []; // empty on first run

    await habitManager.initialize();

    // Established from frontmatter order ascending
    expect(mockPlugin.settings.habitOrder).toEqual(["h-1", "h-2", "h-3"]);
    expect(mockPlugin.saveSettings).toHaveBeenCalled();

    const ordered = habitManager.getHabits();
    expect(ordered.map((h) => h.id)).toEqual(["h-1", "h-2", "h-3"]);
  });

  it("reorders habits via Drag & Drop with ZERO markdown disk writes", async () => {
    const habits = [
      { id: "h-1", name: "A", order: 0 },
      { id: "h-2", name: "B", order: 1 },
      { id: "h-3", name: "C", order: 2 }
    ];
    mockRepository.loadAll.mockResolvedValue(habits);
    mockPlugin.settings.habitOrder = ["h-1", "h-2", "h-3"];
    await habitManager.initialize();

    // User drags "C" to the top: ["h-3", "h-1", "h-2"]
    await habitManager.updateHabitsOrder(["h-3", "h-1", "h-2"]);

    // Markdown updateOrder must NOT be called
    expect(mockRepository.updateOrder).not.toHaveBeenCalled();
    // settings.habitOrder updated and saved
    expect(mockPlugin.settings.habitOrder).toEqual(["h-3", "h-1", "h-2"]);
    expect(mockPlugin.saveSettings).toHaveBeenCalled();

    // In-memory order immediately reflects new order
    expect(habitManager.getHabitById("h-3").order).toBe(0);
    expect(habitManager.getHabitById("h-1").order).toBe(1);
    expect(habitManager.getHabitById("h-2").order).toBe(2);
    expect(habitManager.getHabits().map((h) => h.id)).toEqual(["h-3", "h-1", "h-2"]);
  });

  it("stress test: handles 500 habits with folder scoping and zero markdown writes on reorder", async () => {
    const manyHabits = [];
    for (let i = 0; i < 500; i++) {
      const id = `habit-${i}`;
      const file = {
        path: `Core Habits/Active/Habit-${i}.md`,
        basename: `Habit-${i}`,
        _cache: { frontmatter: { habit_id: id } }
      };
      activeFolderObj.children.push(file);
      manyHabits.push({ id, name: `Habit-${i}`, order: i });
    }

    mockRepository.loadAll.mockResolvedValue(manyHabits);
    await habitManager.initialize();

    expect(habitManager.getHabits()).toHaveLength(500);

    // Verify scoped folder traversal doesn't touch full vault
    const scopedFiles = Utils.getHabitNoteFiles(mockApp.vault, habitNoteManager);
    expect(scopedFiles).toHaveLength(500);
    expect(mockApp.vault.getMarkdownFiles).not.toHaveBeenCalled();

    // Reverse the order of all 500 habits
    const reversedIds = [...mockPlugin.settings.habitOrder].reverse();
    await habitManager.updateHabitsOrder(reversedIds);

    // Zero disk writes to markdown files
    expect(mockRepository.updateOrder).not.toHaveBeenCalled();
    expect(mockPlugin.settings.habitOrder[0]).toBe("habit-499");
    expect(habitManager.getHabits()[0].id).toBe("habit-499");
  });

  it("handles new habit creation: appends to habitOrder and indexes immediately", async () => {
    mockRepository.loadAll.mockResolvedValue([
      { id: "h-1", name: "Habit 1", order: 0 }
    ]);
    await habitManager.initialize();

    const createdHabit = await habitManager.addHabit({
      name: "Habit 2",
      schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] }
    });

    expect(mockPlugin.settings.habitOrder).toContain(createdHabit.id);
    expect(habitManager.getHabitById(createdHabit.id).order).toBe(1);
    expect(mockPlugin.saveSettings).toHaveBeenCalled();
  });

  it("handles habit deletion: prunes from habitOrder and unindexes", async () => {
    const file = {
      path: "Core Habits/Active/DeleteMe.md",
      basename: "DeleteMe",
      _cache: { frontmatter: { habit_id: "del-1" } }
    };
    activeFolderObj.children.push(file);

    mockRepository.loadAll.mockResolvedValue([
      { id: "del-1", name: "DeleteMe", order: 0 },
      { id: "keep-1", name: "KeepMe", order: 1 }
    ]);
    mockPlugin.settings.habitOrder = ["del-1", "keep-1"];
    await habitManager.initialize();

    habitNoteManager.indexHabitFile("del-1", file.path);
    expect(habitNoteManager.getFilePathByHabitId("del-1")).toBe(file.path);

    await habitManager.removeFile(file);

    expect(habitManager.getHabitById("del-1")).toBeNull();
    expect(mockPlugin.settings.habitOrder).toEqual(["keep-1"]);
    expect(habitNoteManager.getFilePathByHabitId("del-1")).toBeNull();
  });

  it("handles habit rename: preserves habitOrder and updates index", async () => {
    const file = {
      path: "Core Habits/Active/OldName.md",
      basename: "OldName",
      _cache: { frontmatter: { habit_id: "ren-1" } }
    };
    activeFolderObj.children.push(file);

    mockRepository.loadAll.mockResolvedValue([
      { id: "ren-1", name: "OldName", linkText: "[[OldName]]", order: 0 }
    ]);
    mockPlugin.settings.habitOrder = ["ren-1"];
    await habitManager.initialize();

    // Trigger rename event
    file.path = "Core Habits/Active/NewName.md";
    file.basename = "NewName";
    await habitManager.handleVaultRename(file, "Core Habits/Active/OldName.md");

    // Index points to new path
    expect(habitNoteManager.getFilePathByHabitId("ren-1")).toBe("Core Habits/Active/NewName.md");
    // habitOrder is preserved by habit_id
    expect(mockPlugin.settings.habitOrder).toEqual(["ren-1"]);
  });

  it("handles plugin reload: rebuilds index and maintains exact ordering", async () => {
    mockRepository.loadAll.mockResolvedValue([
      { id: "h-2", name: "Two", order: 0 },
      { id: "h-1", name: "One", order: 1 }
    ]);
    mockPlugin.settings.habitOrder = ["h-2", "h-1"];
    await habitManager.initialize();

    expect(habitManager.getHabits().map((h) => h.id)).toEqual(["h-2", "h-1"]);

    // Simulate reload
    habitManager.destroy();
    habitNoteManager.invalidateIndex();

    const newHabitManager = new HabitManager(mockPlugin);
    await newHabitManager.initialize();

    expect(newHabitManager.getHabits().map((h) => h.id)).toEqual(["h-2", "h-1"]);
  });

  describe("Phase 2: Derived current_level and Zero Hidden Writes", () => {
    it("derives current_level dynamically from saved_longest_streak when frontmatter current_level is outdated", () => {
      const entity = HabitEntity.fromFrontmatterProps(
        { basename: "Habit A" },
        {
          schema_version: 2,
          habit_id: "h-derived",
          current_level: 1, // Stale level in frontmatter
          saved_longest_streak: 25 // Corresponds to Milestone 4 (21-89 days)
        }
      );

      // ProgressionEngine is the canonical single source of truth for progression
      expect(ProgressionEngine.calculateLevel(entity)).toBe(4);
    });

    it("ensures StreakCalculator causes ZERO background disk writes when peakStreak does not exceed saved record", async () => {
      const mockSync = vi.fn();
      mockPlugin.habitManager = {
        isHabitScheduledForDay: vi.fn().mockReturnValue(true),
        getHabitById: vi.fn(),
        syncMilestoneCheckpoint: mockSync
      };
      mockPlugin.statsService = {
        getHabitStatus: vi.fn().mockResolvedValue("completed")
      };
      mockPlugin.habitScanner = {
        scan: vi.fn().mockReturnValue([{ id: "h-zero-write", completed: true, skipped: false }])
      };
      mockPlugin.translationManager = { t: (k) => k };

      const habit = {
        id: "h-zero-write",
        name: "Zero Write Habit",
        savedLongestStreak: 400, // Higher than any streak in mock notes
        currentLevel: 5
      };

      const calculator = new StreakCalculator(mockPlugin);
      const result = await calculator.calculate(habit);

      // Streak calculated is 365, which is <= 400
      expect(result.currentStreak).toBe(365);
      // Zero checkpoint writes triggered!
      expect(mockSync).not.toHaveBeenCalled();
    });
  });

  describe("Phase 3: Schema v3 Migration (Chunked, Resumable, Idempotent)", () => {
    it("is completely idempotent: does nothing and writes 0 files if all notes are at schema v3", async () => {
      const file1 = new TFile("Core Habits/Active/Habit1.md");
      file1.basename = "Habit1";
      file1._cache = { frontmatter: { habit_id: "h-1", schema_version: 3 } };
      activeFolderObj.children.push(file1);

      mockApp.vault.create = vi.fn();
      mockApp.fileManager.processFrontMatter = vi.fn();

      const migrationManager = new MigrationManager(mockApp, mockPlugin);
      const didMigrate = await migrationManager.runSchemaV3Migration();

      expect(didMigrate).toBe(false);
      expect(mockApp.vault.create).not.toHaveBeenCalled();
      expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
    });

    it("is resumable: only processes notes with schema_version < 3", async () => {
      const v3File = new TFile("Core Habits/Active/Done.md");
      v3File.basename = "Done";
      v3File._cache = { frontmatter: { habit_id: "h-done", schema_version: 3 } };

      const v2File = new TFile("Core Habits/Active/Pending.md");
      v2File.basename = "Pending";
      v2File._cache = {
        frontmatter: {
          habit_id: "h-pending",
          schema_version: 2,
          order: 2,
          current_level: 3,
          saved_longest_streak: 0,
          custom_tag: "favorite"
        }
      };

      activeFolderObj.children.push(v3File, v2File);

      mockApp.vault.read = vi.fn().mockResolvedValue("---\nhabit_id: h-pending\n---");
      mockApp.vault.create = vi.fn().mockResolvedValue({});
      mockApp.vault.createFolder = vi.fn().mockResolvedValue({});

      const migrationManager = new MigrationManager(mockApp, mockPlugin);
      const didMigrate = await migrationManager.runSchemaV3Migration();

      expect(didMigrate).toBe(true);
      // Only Pending was processed
      expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
      expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledWith(v2File, expect.any(Function));

      // Check upgraded frontmatter:
      const fm = v2File._cache.frontmatter;
      expect(fm.schema_version).toBe(3);
      expect(fm.order).toBeUndefined();
      expect(fm.current_level).toBeUndefined();
      expect(fm.saved_longest_streak).toBe(7); // Level 3 milestone preserved!
      expect(fm.custom_tag).toBe("favorite"); // User custom frontmatter preserved!
      expect(mockPlugin.settings.habitOrder).toContain("h-pending");
    });

    it("runs in chunks with micro-yielding to keep Obsidian UI responsive", async () => {
      const files = [];
      for (let i = 0; i < 5; i++) {
        const f = new TFile(`Core Habits/Active/Habit${i}.md`);
        f.basename = `Habit${i}`;
        f._cache = {
          frontmatter: {
            habit_id: `h-${i}`,
            schema_version: 2,
            order: i
          }
        };
        files.push(f);
      }
      activeFolderObj.children.push(...files);

      mockApp.vault.read = vi.fn().mockResolvedValue("---\nhabit_id: test\n---");
      mockApp.vault.create = vi.fn().mockResolvedValue({});
      mockApp.vault.createFolder = vi.fn().mockResolvedValue({});

      const migrationManager = new MigrationManager(mockApp, mockPlugin);
      // Run with chunkSize = 2 so yielding happens between chunks
      const didMigrate = await migrationManager.runSchemaV3Migration({ chunkSize: 2 });

      expect(didMigrate).toBe(true);
      expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledTimes(5);
      files.forEach((f) => {
        expect(f._cache.frontmatter.schema_version).toBe(3);
        expect(f._cache.frontmatter.order).toBeUndefined();
      });
    });
  });

  describe("Gate C: VaultOrderStore and Disaster Recovery Tests", () => {
    it("PROVES DISASTER RECOVERY: delete plugin folder completely + reinstall + Vault notes only = exact same habit order restored without touching individual habit markdown files", async () => {
      // 1. Setup 3 habits in Vault
      const habits = [
        { id: "h-alpha", name: "Alpha", order: 0, createdAt: 1000 },
        { id: "h-beta", name: "Beta", order: 1, createdAt: 2000 },
        { id: "h-gamma", name: "Gamma", order: 2, createdAt: 3000 }
      ];
      mockRepository.loadAll.mockResolvedValue(habits);
      await habitManager.initialize();

      // 2. User sets a custom reorder: Gamma, Alpha, Beta
      const customOrder = ["h-gamma", "h-alpha", "h-beta"];
      await habitManager.persistHabitOrder(customOrder);

      // Verify VaultOrderStore wrote to _order.md
      const orderFile = mockApp.vault.getAbstractFileByPath("Core Habits/_order.md");
      expect(orderFile).toBeDefined();
      const readOrder = await habitManager.vaultOrderStore.readOrder();
      expect(readOrder.habitOrder).toEqual(customOrder);
      expect(readOrder.orderVersion).toBe(2);

      // 3. SIMULATE TOTAL DISASTER:
      // User deletes .obsidian/plugins/core-habits/ entirely (including data.json)
      // and reinstalls the plugin fresh!
      mockPlugin.settings = {
        habitNotesFolder: "Core Habits",
        habitOrder: [],
        habitOrderVersion: 0
      };

      // Create a fresh plugin instance with zero cached state in data.json
      const reinstalledHabitManager = new HabitManager(mockPlugin);

      // Spy on habit note modification to prove zero writes to habit notes
      const habitNoteProcessSpy = vi.fn();
      mockApp.fileManager.processFrontMatter.mockImplementation(async (file, cb) => {
        if (file.path === "Core Habits/_order.md") {
          cb(file._cache.frontmatter);
        } else {
          habitNoteProcessSpy(file.path);
        }
      });

      // 4. Initialize fresh plugin from Vault
      await reinstalledHabitManager.initialize();

      // 5. VERIFY RECOVERY:
      // Exact same custom order is 100% restored from _order.md!
      expect(reinstalledHabitManager.getHabits().map((h) => h.id)).toEqual(customOrder);
      expect(mockPlugin.settings.habitOrder).toEqual(customOrder);
      expect(mockPlugin.settings.habitOrderVersion).toBe(2);

      // PROVE ZERO WRITES to individual habit notes:
      expect(habitNoteProcessSpy).not.toHaveBeenCalled();
    });

    it("falls back to deterministic sort (created_at -> name -> habit_id) when both data.json and _order.md are missing", async () => {
      const habits = [
        { id: "h-z", name: "Zebra", createdAt: 5000 },
        { id: "h-a", name: "Apple", createdAt: 2000 },
        { id: "h-m", name: "Mango", createdAt: 2000 } // same time as Apple, so name wins (Apple before Mango)
      ];
      mockRepository.loadAll.mockResolvedValue(habits);

      // Brand new clean settings (no data.json cache, no _order.md)
      mockPlugin.settings = {
        habitNotesFolder: "Core Habits",
        habitOrder: [],
        habitOrderVersion: 0
      };

      const freshHabitManager = new HabitManager(mockPlugin);
      await freshHabitManager.initialize();

      // Deterministic order: Apple (2000) -> Mango (2000) -> Zebra (5000)
      expect(freshHabitManager.getHabits().map((h) => h.id)).toEqual(["h-a", "h-m", "h-z"]);
      // Automatically created _order.md in Vault:
      const orderFile = mockApp.vault.getAbstractFileByPath("Core Habits/_order.md");
      expect(orderFile).toBeDefined();
      const readOrder = await freshHabitManager.vaultOrderStore.readOrder();
      expect(readOrder.habitOrder).toEqual(["h-a", "h-m", "h-z"]);
    });

    it("ensures Vault order strictly WINS over stale data.json cache", async () => {
      const habits = [
        { id: "h-1", name: "Habit 1", createdAt: 1000 },
        { id: "h-2", name: "Habit 2", createdAt: 2000 }
      ];
      mockRepository.loadAll.mockResolvedValue(habits);

      // Write order to Vault (_order.md) as [h-2, h-1] with version 5
      await habitManager.vaultOrderStore.writeOrder(["h-2", "h-1"], 4); // results in version 5

      // Stale data.json cache on another device has [h-1, h-2] with version 2
      mockPlugin.settings = {
        habitNotesFolder: "Core Habits",
        habitOrder: ["h-1", "h-2"],
        habitOrderVersion: 2
      };

      const syncingHabitManager = new HabitManager(mockPlugin);
      await syncingHabitManager.initialize();

      // Vault strictly wins!
      expect(syncingHabitManager.getHabits().map((h) => h.id)).toEqual(["h-2", "h-1"]);
      expect(mockPlugin.settings.habitOrder).toEqual(["h-2", "h-1"]);
      expect(mockPlugin.settings.habitOrderVersion).toBe(5);
    });

    it("appends new unlisted habit notes deterministically to existing order", async () => {
      const habits = [
        { id: "h-1", name: "Habit 1", createdAt: 1000 },
        { id: "h-2", name: "Habit 2", createdAt: 2000 },
        { id: "h-new", name: "New Habit", createdAt: 3000 }
      ];
      mockRepository.loadAll.mockResolvedValue(habits);

      // Vault only knows h-2 and h-1
      await habitManager.vaultOrderStore.writeOrder(["h-2", "h-1"], 1);

      const manager = new HabitManager(mockPlugin);
      await manager.initialize();

      // h-new is deterministically appended to the end
      expect(manager.getHabits().map((h) => h.id)).toEqual(["h-2", "h-1", "h-new"]);
    });

    it("prunes deleted habit notes from order automatically", async () => {
      // Only Habit 1 remains in loaded habits (Habit 2 was deleted from disk)
      const habits = [
        { id: "h-1", name: "Habit 1", createdAt: 1000 }
      ];
      mockRepository.loadAll.mockResolvedValue(habits);

      // Vault had both
      await habitManager.vaultOrderStore.writeOrder(["h-2", "h-1"], 1);

      const manager = new HabitManager(mockPlugin);
      await manager.initialize();

      // h-2 is pruned!
      expect(manager.getHabits().map((h) => h.id)).toEqual(["h-1"]);
      const readOrder = await manager.vaultOrderStore.readOrder();
      expect(readOrder.habitOrder).toEqual(["h-1"]);
    });

    it("correctly parses _order.md with UTF-8 BOM, flow array style, and block array style", () => {
      const store = habitManager.vaultOrderStore;

      // 1. Block array with BOM
      const yamlBOM = '\uFEFF---\nschema_version: 3\norder_version: 5\nhabit_order:\n  - "h-1"\n  - "h-2"\nupdated_at: "2026-10-06T10:00:00.000Z"\n---\n';
      const parsedBOM = store._parseFrontmatterFromContent(yamlBOM);
      expect(parsedBOM).toEqual({
        schema_version: 3,
        order_version: 5,
        habit_order: ["h-1", "h-2"],
        updated_at: "2026-10-06T10:00:00.000Z"
      });

      // 2. Flow array style
      const yamlFlow = '---\nschema_version: 3\norder_version: 12\nhabit_order: ["h-alpha", "h-beta"]\nupdated_at: "2026-10-06T10:00:00.000Z"\n---\n';
      const parsedFlow = store._parseFrontmatterFromContent(yamlFlow);
      expect(parsedFlow).toEqual({
        schema_version: 3,
        order_version: 12,
        habit_order: ["h-alpha", "h-beta"],
        updated_at: "2026-10-06T10:00:00.000Z"
      });

      // 3. Native parseYaml integration
      const originalParseYaml = window.parseYaml;
      try {
        window.parseYaml = vi.fn().mockReturnValue({
          schema_version: 3,
          order_version: 22,
          habit_order: ["habit-1", "habit-2"],
          updated_at: "2026-10-06T07:37:45.862Z"
        });
        const parsedNative = store._parseFrontmatterFromContent(yamlFlow);
        expect(window.parseYaml).toHaveBeenCalled();
        expect(parsedNative.order_version).toBe(22);
        expect(parsedNative.habit_order).toEqual(["habit-1", "habit-2"]);
      } finally {
        window.parseYaml = originalParseYaml;
      }
    });
  });

  describe("Phase 3: Hierarchical Block Reordering", () => {
    it("moves parent with all its children as a complete contiguous block without separating them", async () => {
      const mockSettings = { habitOrder: ["parent-1", "child-1a", "child-1b", "standalone-2"], habitOrderVersion: 1 };
      const plugin = {
        settings: mockSettings,
        saveSettings: vi.fn().mockResolvedValue(),
        translationManager: { t: (k) => k }
      };

      const manager = new HabitManager(plugin, {});
      manager.isInitialized = true;
      manager.vaultOrderStore = {
        getOrderFilePath: () => "_order.md",
        writeOrder: vi.fn().mockImplementation((order, ver) => Promise.resolve({ orderVersion: ver + 1 }))
      };

      const p1 = { id: "parent-1", name: "Prayers", parentId: null, order: 0, archived: false, deleted: false };
      const c1a = { id: "child-1a", name: "Fajr", parentId: "parent-1", order: 1, archived: false, deleted: false };
      const c1b = { id: "child-1b", name: "Dhuhr", parentId: "parent-1", order: 2, archived: false, deleted: false };
      const s2 = { id: "standalone-2", name: "Reading", parentId: null, order: 3, archived: false, deleted: false };

      manager.habitsMap.set(p1.id, p1);
      manager.habitsMap.set(c1a.id, c1a);
      manager.habitsMap.set(c1b.id, c1b);
      manager.habitsMap.set(s2.id, s2);

      // Move parent-1 DOWN past standalone-2
      await manager.moveHabitDown("parent-1");

      // Verify that parent-1 and both children moved AFTER standalone-2 as a block
      expect(plugin.settings.habitOrder).toEqual(["standalone-2", "parent-1", "child-1a", "child-1b"]);
      expect(manager.getHabitById("standalone-2").order).toBe(0);
      expect(manager.getHabitById("parent-1").order).toBe(1);
      expect(manager.getHabitById("child-1a").order).toBe(2);
      expect(manager.getHabitById("child-1b").order).toBe(3);

      // Verify children internal order Fajr -> Dhuhr remained intact
      const active = manager.getActiveHabits();
      const prayersChildren = active.filter(h => h.parentId === "parent-1");
      expect(prayersChildren.map(h => h.id)).toEqual(["child-1a", "child-1b"]);

      // Move parent-1 UP past standalone-2
      await manager.moveHabitUp("parent-1");
      expect(plugin.settings.habitOrder).toEqual(["parent-1", "child-1a", "child-1b", "standalone-2"]);
    });

    it("reorders children strictly within their parent block without moving parents or other habits", async () => {
      const mockSettings = { habitOrder: ["parent-1", "child-1a", "child-1b", "parent-2", "child-2a"], habitOrderVersion: 1 };
      const plugin = {
        settings: mockSettings,
        saveSettings: vi.fn().mockResolvedValue(),
        translationManager: { t: (k) => k }
      };

      const manager = new HabitManager(plugin, {});
      manager.isInitialized = true;
      manager.vaultOrderStore = {
        getOrderFilePath: () => "_order.md",
        writeOrder: vi.fn().mockImplementation((order, ver) => Promise.resolve({ orderVersion: ver + 1 }))
      };

      const p1 = { id: "parent-1", name: "Prayers", parentId: null, order: 0, archived: false, deleted: false };
      const c1a = { id: "child-1a", name: "Fajr", parentId: "parent-1", order: 1, archived: false, deleted: false };
      const c1b = { id: "child-1b", name: "Dhuhr", parentId: "parent-1", order: 2, archived: false, deleted: false };
      const p2 = { id: "parent-2", name: "Work", parentId: null, order: 3, archived: false, deleted: false };
      const c2a = { id: "child-2a", name: "Deep Work", parentId: "parent-2", order: 4, archived: false, deleted: false };

      manager.habitsMap.set(p1.id, p1);
      manager.habitsMap.set(c1a.id, c1a);
      manager.habitsMap.set(c1b.id, c1b);
      manager.habitsMap.set(p2.id, p2);
      manager.habitsMap.set(c2a.id, c2a);

      // Move child-1a DOWN past child-1b
      await manager.moveHabitDown("child-1a");

      expect(plugin.settings.habitOrder).toEqual(["parent-1", "child-1b", "child-1a", "parent-2", "child-2a"]);
      expect(manager.getHabitById("child-1b").order).toBe(1);
      expect(manager.getHabitById("child-1a").order).toBe(2);
      expect(manager.getHabitById("parent-2").order).toBe(3);
      expect(manager.getHabitById("child-2a").order).toBe(4);
    });

    it("keeps archived children within parent block when moving parent", async () => {
      const mockSettings = { habitOrder: ["p-1", "c-active", "c-archived", "p-2"], habitOrderVersion: 1 };
      const plugin = {
        settings: mockSettings,
        saveSettings: vi.fn().mockResolvedValue(),
        translationManager: { t: (k) => k }
      };

      const manager = new HabitManager(plugin, {});
      manager.isInitialized = true;
      manager.vaultOrderStore = {
        getOrderFilePath: () => "_order.md",
        writeOrder: vi.fn().mockImplementation((order, ver) => Promise.resolve({ orderVersion: ver + 1 }))
      };

      const p1 = { id: "p-1", name: "P1", parentId: null, order: 0, archived: false, deleted: false };
      const cActive = { id: "c-active", name: "Active Child", parentId: "p-1", order: 1, archived: false, deleted: false };
      const cArchived = { id: "c-archived", name: "Archived Child", parentId: "p-1", order: 2, archived: true, deleted: false };
      const p2 = { id: "p-2", name: "P2", parentId: null, order: 3, archived: false, deleted: false };

      manager.habitsMap.set(p1.id, p1);
      manager.habitsMap.set(cActive.id, cActive);
      manager.habitsMap.set(cArchived.id, cArchived);
      manager.habitsMap.set(p2.id, p2);

      // Move p-1 DOWN past p-2
      await manager.moveHabitDown("p-1");

      // Archived child c-archived must move along with p-1 and c-active
      expect(plugin.settings.habitOrder).toEqual(["p-2", "p-1", "c-active", "c-archived"]);
    });
  });

  describe("Phase 4: Safe Restore & Version-Aware Reconciliation", () => {
    it("preserves habit position when archived and then restored", async () => {
      const mockSettings = { habitOrder: ["h-1", "h-2", "h-3"], habitOrderVersion: 1 };
      const mockRepo = {
        archive: vi.fn().mockResolvedValue(),
        restore: vi.fn().mockResolvedValue(),
        loadAll: vi.fn().mockResolvedValue([])
      };

      const plugin = {
        settings: mockSettings,
        habitRepository: mockRepo,
        saveSettings: vi.fn().mockResolvedValue(),
        translationManager: { t: (k) => k },
        streakCalculator: { calculate: vi.fn().mockResolvedValue({ longestStreak: 5 }) }
      };

      const manager = new HabitManager(plugin);
      manager.isInitialized = true;
      manager.vaultOrderStore = {
        getOrderFilePath: () => "_order.md",
        writeOrder: vi.fn().mockImplementation((order, ver) => Promise.resolve({ orderVersion: ver + 1 }))
      };

      const h1 = { id: "h-1", name: "Read", order: 0, archived: false, deleted: false };
      const h2 = { id: "h-2", name: "Meditate", order: 1, archived: false, deleted: false };
      const h3 = { id: "h-3", name: "Exercise", order: 2, archived: false, deleted: false };

      manager.habitsMap.set(h1.id, h1);
      manager.habitsMap.set(h2.id, h2);
      manager.habitsMap.set(h3.id, h3);

      // Archive h-2 (middle habit)
      await manager.archiveHabit("h-2");
      expect(plugin.settings.habitOrder).toEqual(["h-1", "h-2", "h-3"]);

      // Restore h-2
      await manager.restoreHabit("h-2");

      // Verify that h-2 is STILL in position 1 between h-1 and h-3!
      expect(plugin.settings.habitOrder).toEqual(["h-1", "h-2", "h-3"]);
      expect(manager.getHabitById("h-1").order).toBe(0);
      expect(manager.getHabitById("h-2").order).toBe(1);
      expect(manager.getHabitById("h-3").order).toBe(2);
    });

    it("adding a new child habit places it in parent block without reordering existing habits", async () => {
      const mockSettings = { habitOrder: ["p-1", "c-1a", "p-2"], habitOrderVersion: 1 };
      const mockRepo = {
        create: vi.fn().mockResolvedValue(),
        loadAll: vi.fn().mockResolvedValue([])
      };

      const plugin = {
        settings: mockSettings,
        habitRepository: mockRepo,
        saveSettings: vi.fn().mockResolvedValue(),
        translationManager: { t: (k) => k }
      };

      const manager = new HabitManager(plugin);
      manager.isInitialized = true;
      manager.vaultOrderStore = {
        getOrderFilePath: () => "_order.md",
        writeOrder: vi.fn().mockImplementation((order, ver) => Promise.resolve({ orderVersion: ver + 1 }))
      };

      const p1 = { id: "p-1", name: "Prayers", order: 0, archived: false, deleted: false };
      const c1a = { id: "c-1a", name: "Fajr", parentId: "p-1", order: 1, archived: false, deleted: false };
      const p2 = { id: "p-2", name: "Work", order: 2, archived: false, deleted: false };

      manager.habitsMap.set(p1.id, p1);
      manager.habitsMap.set(c1a.id, c1a);
      manager.habitsMap.set(p2.id, p2);

      // Add new child under p-1
      await manager.addHabit({
        id: "c-1b",
        name: "Dhuhr",
        parentId: "p-1",
        schemaVersion: 3,
        schedule: { type: "all-days" },
        color: "teal"
      });

      // c-1b should be placed right after c-1a, before p-2!
      expect(plugin.settings.habitOrder).toEqual(["p-1", "c-1a", "c-1b", "p-2"]);
      expect(manager.getHabitById("p-1").order).toBe(0);
      expect(manager.getHabitById("c-1a").order).toBe(1);
      expect(manager.getHabitById("c-1b").order).toBe(2);
      expect(manager.getHabitById("p-2").order).toBe(3);
    });
  });
});
