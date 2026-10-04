import { describe, it, expect, vi } from "vitest";
import { WeeklyGridView } from "../src/views/WeeklyGridView.js";
import moment from "moment";

describe("WeeklyGridView lifecycle", () => {
  it("keeps short date controls understandable and usable in Arabic", async () => {
    const view = Object.create(WeeklyGridView.prototype);
    view.plugin = {
      settings: { language: "ar", showHijriDate: true },
      translationManager: { t: key => ({
        grid_gregorian_short: "م", grid_hijri_short: "هـ",
        grid_gregorian_date: "ميلادي", grid_hijri_date: "هجري",
        direction: "rtl"
      })[key] || key }
    };
    view.currentWeekStart = moment("2026-09-05");
    view.currentViewMode = "grid";
    view.currentDateMode = "gregorian";
    view.updateDateDisplay = vi.fn();
    const container = document.createElement("div");
    await view.renderWeekHeader(container);

    const [gregorian, hijri] = container.querySelectorAll(".dh-mode-btn-mini");
    expect(gregorian.textContent).toBe("م");
    expect(gregorian.getAttribute("aria-label")).toBe("ميلادي");
    expect(hijri.textContent).toBe("هـ");
    expect(hijri.getAttribute("aria-label")).toBe("هجري");
    hijri.click();
    expect(hijri.getAttribute("aria-pressed")).toBe("true");
    expect(gregorian.getAttribute("aria-pressed")).toBe("false");
    expect(view.currentDateMode).toBe("hijri");
  });

  it("persists individual and bulk collapse through the same settings path", async () => {
    const view = Object.create(WeeklyGridView.prototype);
    view.plugin = {
      settings: { collapsedGroups: [] },
      saveSettings: vi.fn().mockResolvedValue(undefined)
    };
    await view.toggleGroupCollapse("parent-1", true);
    expect(view.plugin.settings.collapsedGroups).toEqual(["parent-1"]);
    await view.toggleAllGroupsCollapse(["parent-1", "parent-2"], true);
    expect(view.plugin.settings.collapsedGroups).toEqual(["parent-1", "parent-2"]);
    await view.toggleGroupCollapse("parent-1", false);
    expect(view.plugin.settings.collapsedGroups).toEqual(["parent-2"]);
    expect(view.plugin.saveSettings).toHaveBeenCalledTimes(3);
    expect(view.plugin.saveSettings).toHaveBeenCalledWith({ silent: true });
  });

  it("does not commit an asynchronous render after close", async () => {
    let finishLoad;
    const loading = new Promise((resolve) => { finishLoad = resolve; });
    const container = document.createElement("div");
    const view = Object.create(WeeklyGridView.prototype);
    view.plugin = { isFullyLoaded: true, _isUnloading: false, translationManager: { t: (key) => key } };
    view.contentEl = container;
    view.getWeeklyContentContainer = () => container;
    view.loadWeekData = () => loading;
    view.currentViewMode = "grid";
    view.currentWeekStart = moment("2026-09-21");
    view.renderToken = 0;
    view._isClosed = false;
    view._diaryController = { destroy: vi.fn() };
    view._statisticsController = { destroy: vi.fn() };
    view.activeFilePaths = new Set();
    view.milestoneHit = new Map();

    const rendering = view.renderWeeklyGrid();
    await view.onClose();
    finishLoad();
    await rendering;

    expect(container.childElementCount).toBe(0);
    expect(view._isRendering).toBe(false);
  });

  it("keeps only the newest week's loaded files and statistics", async () => {
    let releaseOldRead;
    const oldRead = new Promise(resolve => { releaseOldRead = resolve; });
    const view = Object.create(WeeklyGridView.prototype);
    view.currentWeekStart = moment("2026-09-07");
    view._weekLoadGeneration = 0;
    view._isClosed = false;
    view.plugin = {
      _isUnloading: false,
      settings: { dailyNotesSource: "manual", dateFormat: "YYYY-MM-DD", dailyNotesFolder: "Daily" },
      habitManager: { getActiveHabits: () => [] },
      diaryService: { parseDailyReflectionEntries: () => [] },
      statsService: { calculateWeeklyStats: vi.fn(async (_habits, start) => ({ week: start.format("YYYY-MM-DD") })) },
    };
    view.app = {
      vault: {
        getAbstractFileByPath: path => ({ path }),
        cachedRead: file => file.path.includes("2026-09-07") ? oldRead : Promise.resolve(file.path),
      },
    };

    const first = view.loadWeekData(view.currentWeekStart.clone());
    view.currentWeekStart = moment("2026-09-14");
    const second = view.loadWeekData(view.currentWeekStart.clone());
    expect(await second).toBe(true);
    releaseOldRead("old content");
    expect(await first).toBe(false);
    expect(view.dailyStats.week).toBe("2026-09-14");
    expect(view.weekContentCache.has("2026-09-14")).toBe(true);
    expect(view.weekContentCache.has("2026-09-07")).toBe(false);
    expect([...view.activeFilePaths].some(path => path.includes("2026-09-07"))).toBe(false);
  });

  it("serializes repeated toggles of the same habit and day", async () => {
    let finishSave;
    const saving = new Promise(resolve => { finishSave = resolve; });
    const toggleHabitForDate = vi.fn(() => saving);
    const view = Object.create(WeeklyGridView.prototype);
    view._pendingToggles = new Set();
    view.plugin = { habitManager: { toggleHabitForDate } };
    view.loadWeekData = vi.fn().mockResolvedValue(true);
    const habit = { id: "habit-1" };
    const day = moment("2026-09-14");

    const first = view.toggleHabitCompletion(habit, day, "completed");
    expect(await view.toggleHabitCompletion(habit, day, "completed")).toBeNull();
    finishSave(true);
    expect(await first).toBe(true);
    expect(toggleHabitForDate).toHaveBeenCalledTimes(1);
    expect(view._pendingToggles.size).toBe(0);
  });

  it("rebuilds the grid when toggling creates a missing daily note", async () => {
    const view = Object.create(WeeklyGridView.prototype);
    view._pendingToggles = new Set();
    view._isClosed = false;
    view.currentViewMode = "grid";
    view.weekContentCache = new Map([["2026-09-14", null]]);
    view.plugin = { habitManager: { toggleHabitForDate: vi.fn().mockResolvedValue(true) } };
    view.loadWeekData = vi.fn().mockResolvedValue(true);
    view.renderWeeklyGrid = vi.fn().mockResolvedValue(undefined);

    expect(await view.toggleHabitCompletion({ id: "habit-1" }, moment("2026-09-14"), "completed")).toBe(true);
    expect(view.renderWeeklyGrid).toHaveBeenCalledOnce();
  });

  it("preserves the viewed week on ordinary refresh", async () => {
    const view = Object.create(WeeklyGridView.prototype);
    view.plugin = { settings: { weekStartDay: 1 } };
    view.currentWeekStart = moment("2026-08-03");
    view._renderedWeekStartDay = 1;
    view.renderWeeklyGrid = vi.fn().mockResolvedValue(undefined);

    await view.refresh();
    expect(view.currentWeekStart.format("YYYY-MM-DD")).toBe("2026-08-03");
  });

  it("does not mount the old week when navigation happens during loading", async () => {
    let releaseFirstLoad;
    const firstLoad = new Promise(resolve => { releaseFirstLoad = resolve; });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const view = Object.create(WeeklyGridView.prototype);
    view.plugin = {
      isFullyLoaded: true,
      _isUnloading: false,
      settings: { language: "en" },
      translationManager: { t: key => key === "direction" ? "ltr" : key },
      habitManager: { getActiveHabits: () => [] },
    };
    view.contentEl = container;
    view.getWeeklyContentContainer = () => container;
    view.loadWeekData = vi.fn()
      .mockImplementationOnce(() => firstLoad)
      .mockResolvedValue(true);
    view.renderWeekHeader = async element => { element.createDiv({ text: view.currentWeekStart.format("YYYY-MM-DD") }); };
    view.gridRenderer = { renderGridTable: vi.fn(async () => {}) };
    view.currentViewMode = "grid";
    view.currentWeekStart = moment("2026-09-07");
    view.renderToken = 0;
    view._isClosed = false;
    view._streakQueue = [];

    const oldRender = view.renderWeeklyGrid();
    view.currentWeekStart = moment("2026-09-14");
    await view.renderWeeklyGrid();
    releaseFirstLoad(true);
    await oldRender;
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(container.textContent).toContain("2026-09-14");
    expect(container.textContent).not.toContain("2026-09-07");
    expect(view.gridRenderer.renderGridTable).toHaveBeenCalledOnce();
  });

  it("defers streak calculations until a row is visible", () => {
    let notifyVisibility;
    class Observer {
      constructor(callback) { notifyVisibility = callback; }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", Observer);
    try {
      const view = Object.create(WeeklyGridView.prototype);
      view._isClosed = false;
      view.renderToken = 1;
      view._streakQueue = [];
      view.processStreakQueue = vi.fn();
      const row = document.createElement("div");
      const habit = { id: "habit-1" };

      view.queueStreakCalculation(habit, row);
      expect(view.processStreakQueue).not.toHaveBeenCalled();
      notifyVisibility([{ target: row, isIntersecting: true }]);
      expect(view._streakQueue).toEqual([{ habit, row }]);
      expect(view.processStreakQueue).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders a streak badge without treating the language getter as a function", async () => {
    const view = Object.create(WeeklyGridView.prototype);
    view.plugin = { settings: { language: "ar" }, translationManager: { t: key => key } };
    view._isClosed = false;
    view.renderToken = 1;
    view._streakQueue = [];
    view.streakCalculator = { calculate: vi.fn(async () => ({ currentStreak: 3 })) };
    const row = document.createElement("div");
    row.innerHTML = '<span class="dh-streak-badge-slot"></span>';
    view._streakQueue.push({ habit: { id: "habit-1", name: "Read" }, row });

    await view.processStreakQueue();

    expect(row.querySelector(".dh-streak-badge")?.textContent).toBe("🔥3");
  });

  it("refreshes an open diary when a Daily Note is created, removed, or renamed away", async () => {
    const listeners = new Map();
    const view = Object.create(WeeklyGridView.prototype);
    view.contentEl = document.createElement("div");
    view.plugin = {
      _isUnloading: false,
      settings: { dailyNotesSource: "manual", dailyNotesFolder: "Daily", dateFormat: "YYYY-MM-DD" },
    };
    view.app = {
      vault: { on: vi.fn((event, callback) => { listeners.set(event, callback); return {}; }) },
      workspace: { on: vi.fn(() => ({})) },
    };
    view.registerEvent = vi.fn();
    view.renderWeeklyGrid = vi.fn().mockResolvedValue(undefined);
    view.debouncedRefresh = vi.fn();
    view.currentViewMode = "diary";

    await view.onOpen();
    listeners.get("create")({ path: "Archive/2026-09-27.md" });
    expect(view.debouncedRefresh).not.toHaveBeenCalled();
    listeners.get("create")({ path: "Daily/2026-09-27.md" });
    listeners.get("delete")({ path: "Daily/2026-09-27.md" });
    listeners.get("rename")({ path: "Archive/renamed.md" }, "Daily/2026-09-27.md");
    expect(view.debouncedRefresh).toHaveBeenCalledTimes(3);

    view.currentViewMode = "grid";
    listeners.get("create")({ path: "Daily/2026-09-28.md" });
    expect(view.debouncedRefresh).toHaveBeenCalledTimes(3);
  });
});
