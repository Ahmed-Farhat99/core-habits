import { describe, it, expect, vi } from "vitest";
import { HabitNoteManager } from "../src/services/HabitNoteManager.js";

function setup({ existing = true, saveError = null } = {}) {
  const folder = existing ? { path: "Core Habits" } : null;
  const files = new Map(existing ? [["Core Habits", folder]] : []);
  const app = {
    vault: {
      getAbstractFileByPath: (path) => files.get(path) || null,
      createFolder: vi.fn(async (path) => files.set(path, { path }))
    },
    fileManager: {
      renameFile: vi.fn(async (entry, path) => {
        files.delete(entry.path);
        entry.path = path;
        files.set(path, entry);
      })
    }
  };
  const plugin = {
    settings: { habitNotesFolder: "Core Habits" },
    saveSettings: saveError ? vi.fn().mockRejectedValue(saveError) : vi.fn().mockResolvedValue(undefined)
  };
  return { manager: new HabitNoteManager(app, plugin), plugin, app, files };
}

describe("habit folder relocation", () => {
  it("moves the folder before committing the new setting", async () => {
    const { manager, plugin, app, files } = setup();
    await manager.moveRootFolder("Habits");
    expect(files.has("Habits")).toBe(true);
    expect(plugin.settings.habitNotesFolder).toBe("Habits");
    expect(app.fileManager.renameFile).toHaveBeenCalledTimes(1);
  });

  it("uses the plugin's internal file-operation lock for folder moves", async () => {
    const { manager, plugin } = setup();
    plugin.runWithLock = vi.fn(async (operation) => operation());
    await manager.moveRootFolder("Habits");
    expect(plugin.runWithLock).toHaveBeenCalledTimes(1);
  });

  it("restores the original folder and setting if saving fails", async () => {
    const { manager, plugin, files } = setup({ saveError: new Error("disk full") });
    await expect(manager.moveRootFolder("Habits")).rejects.toThrow("disk full");
    expect(files.has("Core Habits")).toBe(true);
    expect(files.has("Habits")).toBe(false);
    expect(plugin.settings.habitNotesFolder).toBe("Core Habits");
  });

  it("rejects traversal and an existing destination before touching files", async () => {
    const { manager, app, files } = setup();
    files.set("Habits", { path: "Habits" });
    await expect(manager.moveRootFolder("../outside")).rejects.toThrow();
    await expect(manager.moveRootFolder("Habits")).rejects.toThrow();
    expect(app.fileManager.renameFile).not.toHaveBeenCalled();
  });

  it("initializes new folders under the selected root if no old folder exists", async () => {
    const { manager, plugin, files } = setup({ existing: false });
    await manager.moveRootFolder("Habits");
    expect(files.has("Habits/Active")).toBe(true);
    expect(files.has("Habits/Archive")).toBe(true);
    expect(plugin.settings.habitNotesFolder).toBe("Habits");
  });
});
