import { describe, expect, it, vi } from "vitest";
import DailyHabitsPlugin from "../src/main.js";

describe("plugin unload", () => {
  it("releases plugin resources without detaching the user's open view", async () => {
    const plugin = Object.create(DailyHabitsPlugin.prototype);
    const detachLeavesOfType = vi.fn();
    plugin.app = { workspace: { detachLeavesOfType } };
    plugin.habitManager = { destroy: vi.fn() };
    plugin.audioEngine = { close: vi.fn().mockResolvedValue(undefined) };
    plugin.statsService = { destroy: vi.fn() };
    plugin._openTimeouts = new Map();

    await plugin.onunload();

    expect(plugin.habitManager.destroy).toHaveBeenCalledOnce();
    expect(plugin.audioEngine.close).toHaveBeenCalledOnce();
    expect(plugin.statsService.destroy).toHaveBeenCalledOnce();
    expect(detachLeavesOfType).not.toHaveBeenCalled();
  });
});
