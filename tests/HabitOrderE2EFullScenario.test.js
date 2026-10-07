import { describe, it, expect, vi, beforeEach } from "vitest";
import { TFile } from "obsidian";
import { HabitManager } from "../src/services/HabitManager.js";
import { VaultOrderStore } from "../src/services/VaultOrderStore.js";
import { HabitNoteManager } from "../src/services/HabitNoteManager.js";
import { HabitRepository } from "../src/repositories/HabitRepository.js";
import { buildHierarchyLabels } from "../src/utils/helpers.js";

class MockTFile extends TFile {
  constructor(path, content = "") {
    super(path);
    this.path = path;
    this.name = path.split("/").pop();
    this.basename = this.name.replace(/\.[^/.]+$/, "");
    this.content = content;
    this._cache = { frontmatter: {} };
  }
}

describe("Phase 5: Full E2E Scenario Lifecycle Test", () => {
  let mockApp;
  let vaultFilesMap;
  let activeFolderObj;
  let archiveFolderObj;
  let savedSettings;

  const createPluginEnvironment = () => {
    const plugin = {
      app: mockApp,
      settings: JSON.parse(JSON.stringify(savedSettings)),
      saveSettings: vi.fn(async function () {
        savedSettings = JSON.parse(JSON.stringify(this.settings));
      }),
      translationManager: { t: (k) => k },
      runWithLock: vi.fn((cb) => cb()),
      refreshWeeklyViews: vi.fn(),
      streakCalculator: {
        calculate: vi.fn().mockResolvedValue({ longestStreak: 10, currentStreak: 5 })
      }
    };

    const habitNoteManager = new HabitNoteManager(mockApp, plugin);
    plugin.habitNoteManager = habitNoteManager;

    const habitRepo = new HabitRepository(mockApp, plugin);
    plugin.habitRepository = habitRepo;

    const vaultOrderStore = new VaultOrderStore(mockApp, plugin);
    plugin.vaultOrderStore = vaultOrderStore;

    const manager = new HabitManager(plugin);
    plugin.habitManager = manager;

    return { plugin, manager, vaultOrderStore };
  };

  beforeEach(() => {
    vaultFilesMap = new Map();
    activeFolderObj = { path: "Core Habits/Active", children: [] };
    archiveFolderObj = { path: "Core Habits/Archive", children: [] };
    savedSettings = {
      habitNotesFolder: "Core Habits",
      habitOrder: [],
      habitOrderVersion: 0,
      language: "en"
    };

    mockApp = {
      vault: {
        getAbstractFileByPath: vi.fn((path) => {
          if (path === "Core Habits/Active") return activeFolderObj;
          if (path === "Core Habits/Archive") return archiveFolderObj;
          if (vaultFilesMap.has(path)) return vaultFilesMap.get(path);
          return null;
        }),
        getMarkdownFiles: vi.fn(() => {
          throw new Error("Full vault getMarkdownFiles should NOT be called!");
        }),
        create: vi.fn(async (path, content) => {
          const file = new MockTFile(path, content);
          vaultFilesMap.set(path, file);
          if (path.startsWith("Core Habits/Active/")) activeFolderObj.children.push(file);
          if (path.startsWith("Core Habits/Archive/")) archiveFolderObj.children.push(file);
          return file;
        }),
        read: vi.fn(async (file) => {
          if (typeof file === "string") return vaultFilesMap.get(file)?.content || "";
          return file?.content || "";
        }),
        createFolder: vi.fn().mockResolvedValue({}),
        modify: vi.fn(async (file, content) => {
          file.content = content;
        }),
        rename: vi.fn(async (file, newPath) => {
          vaultFilesMap.delete(file.path);
          if (file.path.startsWith("Core Habits/Active/")) {
            activeFolderObj.children = activeFolderObj.children.filter((f) => f.path !== file.path);
          }
          if (file.path.startsWith("Core Habits/Archive/")) {
            archiveFolderObj.children = archiveFolderObj.children.filter((f) => f.path !== file.path);
          }

          file.path = newPath;
          file.name = newPath.split("/").pop();
          file.basename = file.name.replace(/\.[^/.]+$/, "");
          vaultFilesMap.set(newPath, file);

          if (newPath.startsWith("Core Habits/Active/")) activeFolderObj.children.push(file);
          if (newPath.startsWith("Core Habits/Archive/")) archiveFolderObj.children.push(file);
        }),
        delete: vi.fn(async (file) => {
          vaultFilesMap.delete(file.path);
          activeFolderObj.children = activeFolderObj.children.filter((f) => f.path !== file.path);
          archiveFolderObj.children = archiveFolderObj.children.filter((f) => f.path !== file.path);
        })
      },
      fileManager: {
        processFrontMatter: vi.fn(async (file, cb) => {
          if (!file._cache) file._cache = { frontmatter: {} };
          if (!file._cache.frontmatter) file._cache.frontmatter = {};
          cb(file._cache.frontmatter);
        })
      },
      metadataCache: {
        getFileCache: vi.fn((file) => file?._cache || null)
      }
    };
  });

  it("successfully passes the complete 10-step lifecycle without order drift", async () => {
    // -------------------------------------------------------------
    // STEP 1: Setup manual non-alphabetic order
    // -------------------------------------------------------------
    let { plugin, manager, vaultOrderStore } = createPluginEnvironment();

    // Helper to register notes in our mock vault
    const addNote = (name, frontmatter) => {
      const path = `Core Habits/Active/${name}.md`;
      const yaml = Object.entries(frontmatter)
        .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
        .join("\n");
      const content = `---\n${yaml}\n---\n# ${name}\n`;
      const file = new MockTFile(path, content);
      file._cache = { frontmatter };
      vaultFilesMap.set(path, file);
      activeFolderObj.children.push(file);
      return file;
    };

    addNote("Prayers", { habit_id: "parent-prayers", schema_version: 3, habit_type: "build", color: "teal", schedule: "daily", archived: false });
    addNote("Fajr", { habit_id: "child-fajr", parent_id: "parent-prayers", schema_version: 3, habit_type: "build", color: "teal", schedule: "daily", archived: false });
    addNote("Dhuhr", { habit_id: "child-dhuhr", parent_id: "parent-prayers", schema_version: 3, habit_type: "build", color: "teal", schedule: "daily", archived: false });
    addNote("Asr", { habit_id: "child-asr", parent_id: "parent-prayers", schema_version: 3, habit_type: "build", color: "teal", schedule: "daily", archived: false });
    addNote("Maghrib", { habit_id: "child-maghrib", parent_id: "parent-prayers", schema_version: 3, habit_type: "build", color: "teal", schedule: "daily", archived: false });
    addNote("Isha", { habit_id: "child-isha", parent_id: "parent-prayers", schema_version: 3, habit_type: "build", color: "teal", schedule: "daily", archived: false });

    addNote("Health", { habit_id: "parent-health", schema_version: 3, habit_type: "build", color: "green", schedule: "daily", archived: false });
    addNote("Walk", { habit_id: "child-walk", parent_id: "parent-health", schema_version: 3, habit_type: "build", color: "green", schedule: "daily", archived: false });
    addNote("Water", { habit_id: "child-water", parent_id: "parent-health", schema_version: 3, habit_type: "build", color: "green", schedule: "daily", archived: false });

    addNote("Reading", { habit_id: "standalone-reading", schema_version: 3, habit_type: "build", color: "blue", schedule: "daily", archived: false });

    // Custom non-alphabetic order (notice Fajr, Dhuhr, Asr, Maghrib, Isha is chronological Islamic order, NOT alphabetical)
    const initialNonAlphaOrder = [
      "parent-prayers",
      "child-fajr",
      "child-dhuhr",
      "child-asr",
      "child-maghrib",
      "child-isha",
      "parent-health",
      "child-walk",
      "child-water",
      "standalone-reading"
    ];

    // Persist this initial non-alphabetic manual order to _order.md
    await vaultOrderStore.writeOrder(initialNonAlphaOrder, 1);
    plugin.settings.habitOrder = [...initialNonAlphaOrder];
    plugin.settings.habitOrderVersion = 1;
    await plugin.saveSettings();

    // Initialize HabitManager
    await manager.initialize();

    // Verify initial active habits order
    expect(manager.getActiveHabits().map((h) => h.id)).toEqual(initialNonAlphaOrder);

    // -------------------------------------------------------------
    // STEP 2: Simulate Obsidian Restart / Reopen
    // -------------------------------------------------------------
    const env2 = createPluginEnvironment();
    plugin = env2.plugin;
    manager = env2.manager;

    await manager.initialize();

    // Verify order is preserved after restart
    expect(manager.getActiveHabits().map((h) => h.id)).toEqual(initialNonAlphaOrder);
    expect(plugin.settings.habitOrder).toEqual(initialNonAlphaOrder);

    // -------------------------------------------------------------
    // STEP 3: Add New Habit (standalone)
    // -------------------------------------------------------------
    await manager.addHabit({
      id: "standalone-journal",
      name: "Journaling",
      schemaVersion: 3,
      habitType: "build",
      color: "purple",
      schedule: { type: "all-days" }
    });

    const expectedAfterAdd = [...initialNonAlphaOrder, "standalone-journal"];
    expect(plugin.settings.habitOrder).toEqual(expectedAfterAdd);
    expect(manager.getActiveHabits().map((h) => h.id)).toEqual(expectedAfterAdd);

    // -------------------------------------------------------------
    // STEP 4: Archive habit ("child-asr")
    // -------------------------------------------------------------
    await manager.archiveHabit("child-asr");

    // In settings.habitOrder, child-asr remains in its original slot
    expect(plugin.settings.habitOrder).toContain("child-asr");
    expect(plugin.settings.habitOrder.indexOf("child-asr")).toBe(3);

    // -------------------------------------------------------------
    // STEP 5: Restore same habit ("child-asr")
    // -------------------------------------------------------------
    await manager.restoreHabit("child-asr");

    // After restore, child-asr MUST be in its original position between child-dhuhr and child-maghrib!
    expect(plugin.settings.habitOrder).toEqual(expectedAfterAdd);
    expect(manager.getActiveHabits().map((h) => h.id)).toEqual(expectedAfterAdd);

    // -------------------------------------------------------------
    // STEP 6: Rename habit ("child-fajr" -> "Fajr Prayer")
    // -------------------------------------------------------------
    await manager.updateHabit("child-fajr", { name: "Fajr Prayer" });

    // Order must NOT change on rename
    expect(plugin.settings.habitOrder).toEqual(expectedAfterAdd);
    expect(manager.getActiveHabits().map((h) => h.id)).toEqual(expectedAfterAdd);

    // -------------------------------------------------------------
    // STEP 7: Reorder Parent ("parent-health" moves UP past "parent-prayers")
    // -------------------------------------------------------------
    await manager.moveHabitUp("parent-health");

    // Health block: [parent-health, child-walk, child-water]
    // Prayers block: [parent-prayers, child-fajr, child-dhuhr, child-asr, child-maghrib, child-isha]
    // Standalone: [standalone-reading, standalone-journal]
    const expectedAfterParentMove = [
      "parent-health",
      "child-walk",
      "child-water",
      "parent-prayers",
      "child-fajr",
      "child-dhuhr",
      "child-asr",
      "child-maghrib",
      "child-isha",
      "standalone-reading",
      "standalone-journal"
    ];

    expect(plugin.settings.habitOrder).toEqual(expectedAfterParentMove);
    expect(manager.getActiveHabits().map((h) => h.id)).toEqual(expectedAfterParentMove);

    // -------------------------------------------------------------
    // STEP 8: Reorder Child ("child-water" moves UP past "child-walk")
    // -------------------------------------------------------------
    await manager.moveHabitUp("child-water");

    const expectedAfterChildMove = [
      "parent-health",
      "child-water",
      "child-walk",
      "parent-prayers",
      "child-fajr",
      "child-dhuhr",
      "child-asr",
      "child-maghrib",
      "child-isha",
      "standalone-reading",
      "standalone-journal"
    ];

    expect(plugin.settings.habitOrder).toEqual(expectedAfterChildMove);
    expect(manager.getActiveHabits().map((h) => h.id)).toEqual(expectedAfterChildMove);

    // -------------------------------------------------------------
    // STEP 9: Simulate Second Restart / Reopen
    // -------------------------------------------------------------
    const env3 = createPluginEnvironment();
    const finalManager = env3.manager;
    const finalPlugin = env3.plugin;
    const finalOrderStore = env3.vaultOrderStore;

    await finalManager.initialize();

    // -------------------------------------------------------------
    // STEP 10: Verify All Views and Stores are in 100% Agreement
    // -------------------------------------------------------------
    // 1. Settings (active habits)
    const settingsActiveOrder = finalManager.getActiveHabits().map((h) => h.id);
    expect(settingsActiveOrder).toEqual(expectedAfterChildMove);

    // 2. Weekly Grid & Compact Grid (buildHierarchyLabels)
    const { sorted: gridSortedHabits, labels: gridLabels } = buildHierarchyLabels(finalManager.getActiveHabits());
    const gridOrder = gridSortedHabits.map((h) => h.id);
    expect(gridOrder).toEqual(expectedAfterChildMove);

    // Verify grid hierarchy labels match the block structure
    expect(gridLabels).toEqual([
      "1",    // Health
      "1.1",  // Water
      "1.2",  // Walk
      "2",    // Prayers
      "2.1",  // Fajr Prayer
      "2.2",  // Dhuhr
      "2.3",  // Asr
      "2.4",  // Maghrib
      "2.5",  // Isha
      "3",    // Reading
      "4"     // Journaling
    ]);

    // 3. _order.md (Vault SSOT)
    const vaultOrder = await finalOrderStore.readOrder();
    expect(vaultOrder.habitOrder).toEqual(expectedAfterChildMove);

    // 4. data.json cache
    expect(finalPlugin.settings.habitOrder).toEqual(expectedAfterChildMove);

    // Complete agreement!
    expect(settingsActiveOrder).toEqual(gridOrder);
    expect(gridOrder).toEqual(vaultOrder.habitOrder);
    expect(vaultOrder.habitOrder).toEqual(finalPlugin.settings.habitOrder);
  });
});
