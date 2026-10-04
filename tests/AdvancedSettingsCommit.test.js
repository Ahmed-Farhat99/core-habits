import { describe, it, expect, vi } from "vitest";
import { DailyNotesPanel } from "../src/views/settings/DailyNotesPanel.js";

function setup(saveSettings = vi.fn().mockResolvedValue(undefined)) {
  const plugin = {
    app: {},
    settings: { habitHeading: "## Habits", habitHeadingHistory: [] },
    saveSettings,
    refreshWeeklyViews: vi.fn(),
    translationManager: { t: (key) => key }
  };
  const panel = new DailyNotesPanel(plugin, {});
  const inputEl = document.createElement("input");
  const text = { inputEl, setValue: vi.fn((value) => { inputEl.value = value; }) };
  panel.bindCommittedText(text, { key: "habitHeading", historyKey: "habitHeadingHistory" });
  return { plugin, inputEl, text };
}

describe("advanced settings text commits", () => {
  it("does not save partial headings as the user types", async () => {
    const { plugin, inputEl } = setup();
    inputEl.value = "## Better Habits";
    inputEl.dispatchEvent(new Event("input"));
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    inputEl.dispatchEvent(new Event("blur"));
    await vi.waitFor(() => expect(plugin.saveSettings).toHaveBeenCalledTimes(1));
    expect(plugin.settings.habitHeading).toBe("## Better Habits");
    expect(plugin.settings.habitHeadingHistory).toEqual(["## Habits"]);
  });

  it("restores the prior value and heading history after a failed save", async () => {
    const { plugin, inputEl, text } = setup(vi.fn().mockRejectedValue(new Error("disk full")));
    inputEl.value = "## Changed";
    inputEl.dispatchEvent(new Event("blur"));
    await vi.waitFor(() => expect(text.setValue).toHaveBeenCalledWith("## Habits"));
    expect(plugin.settings.habitHeading).toBe("## Habits");
    expect(plugin.settings.habitHeadingHistory).toEqual([]);
  });
});
