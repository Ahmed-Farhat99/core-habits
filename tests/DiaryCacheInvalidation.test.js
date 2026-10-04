import { describe, expect, it, vi } from "vitest";
import DailyHabitsPlugin from "../src/main.js";

describe("Diary cache invalidation", () => {
  it("tracks Daily Notes while the diary view is closed and clears old keys on rename or deletion", () => {
    const listeners = new Map();
    const plugin = Object.create(DailyHabitsPlugin.prototype);
    plugin._isUnloading = false;
    plugin.settings = { dailyNotesSource: "manual", dailyNotesFolder: "Daily", dateFormat: "YYYY-MM-DD" };
    plugin.app = { vault: { on: vi.fn((event, callback) => { listeners.set(event, callback); return {}; }) } };
    plugin.registerEvent = vi.fn();
    plugin.diaryService = { invalidateFile: vi.fn(), clearCache: vi.fn() };

    plugin.registerDiaryCacheInvalidation();
    const dailyNote = { path: "Daily/2026-09-27.md", extension: "md" };
    listeners.get("modify")({ path: "Archive/2026-09-27.md", extension: "md" });
    listeners.get("create")(dailyNote);
    listeners.get("modify")(dailyNote);
    expect(plugin.diaryService.invalidateFile).toHaveBeenCalledTimes(2);
    expect(plugin.diaryService.invalidateFile).toHaveBeenCalledWith(dailyNote.path);

    listeners.get("rename")(dailyNote);
    listeners.get("delete")(dailyNote);
    expect(plugin.diaryService.clearCache).toHaveBeenCalledTimes(2);
    expect(plugin.registerEvent).toHaveBeenCalledTimes(4);
  });
});
