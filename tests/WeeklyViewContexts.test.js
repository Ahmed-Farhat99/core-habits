import { describe, it, expect, vi } from "vitest";
import { createWeeklyViewContexts } from "../src/views/WeeklyViewContexts.js";

describe("weekly view contexts", () => {
  it("reads changing grid state and persists a diary mode change through the owner", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const renderWeeklyGrid = vi.fn().mockResolvedValue(undefined);
    const view = {
      app: {},
      plugin: { settings: {}, saveSettings, diaryService: {} },
      dailyStats: { today: 1 },
      diaryViewMode: "grouped",
      renderWeeklyGrid,
    };
    const { grid, diary, statistics } = createWeeklyViewContexts(view);

    expect(grid.getDailyStats()).toEqual({ today: 1 });
    view.dailyStats = { today: 2 };
    expect(grid.getDailyStats()).toEqual({ today: 2 });

    await diary.setDiaryViewMode("timeline");
    expect(view.plugin.settings.diaryViewMode).toBe("timeline");
    expect(saveSettings).toHaveBeenCalledWith({ silent: true });
    expect(renderWeeklyGrid).toHaveBeenCalledOnce();
    expect(statistics.plugin).toBe(view.plugin);
  });
});
