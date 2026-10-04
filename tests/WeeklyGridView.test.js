import { describe, it, expect, beforeEach, vi } from "vitest";
import moment from "moment";
import { GridRenderer } from "../src/views/GridRenderer.js";

describe("Weekly Grid Product & UX Audit Tests", () => {
  let mockPlugin;
  let mockContext;
  let renderer;
  let dailyStatsMock;
  let weekDayInfos;
  let weekStart;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T12:00:00Z"));
    weekStart = moment("2026-09-05"); // Saturday
    weekDayInfos = [];
    for (let i = 0; i < 7; i++) {
      const d = weekStart.clone().add(i, "days");
      weekDayInfos.push({
        dayDate: d,
        isToday: i === 1, // Sunday is today
        dayOfWeek: d.day()
      });
    }

    dailyStatsMock = {
      "2026-09-05": { completed: 3, total: 10 },
      "2026-09-06": { completed: 2, total: 10 },
      "2026-09-07": { completed: 0, total: 10 },
      "2026-09-08": { completed: 0, total: 10 },
      "2026-09-09": { completed: 0, total: 10 },
      "2026-09-10": { completed: 0, total: 10 },
      "2026-09-11": { completed: 0, total: 10 },
    };

    mockPlugin = {
      settings: {
        language: "ar",
        showCount: true,
        showHijriDate: true,
        collapsedGroups: [],
      },
      translationManager: {
        t: vi.fn((k, p = {}) => {
          const dict = {
            grid_completion_rate: "إنجاز الأسبوع",
            grid_completion_rate_to_date: "إنجاز هذا الأسبوع حتى اليوم",
            grid_completion_count: `${p.done} من ${p.total} فرصة مكتملة`,
            grid_day_progress_short: `${p.done} من ${p.total}`,
            grid_completion_behind: `تفصلك ${p.points} نقطة مئوية عن الأسبوع السابق`,
            grid_completion_level: "على وتيرة الأسبوع السابق",
            grid_completion_ahead: `متقدم بـ ${p.points} نقطة مئوية، استمر!`,
            grid_previous_same_days: `نفس أيام الأسبوع السابق: ${p.lastRate}%`,
            grid_previous_full_week: `الأسبوع السابق: ${p.lastRate}%`,
            grid_collapse_groups: "طي المجموعات",
            grid_expand_groups: "فرد المجموعات",
            grid_expand_children: "عرض العادات الفرعية",
            grid_collapse_children: "إخفاء العادات الفرعية",
            today: "اليوم",
            completed: "مكتمل",
            date_format_short: "D MMMM",
            sun: "الأحد",
            mon: "الإثنين",
            tue: "الثلاثاء",
            wed: "الأربعاء",
            thu: "الخميس",
            sat: "السبت",
            sun_short: "أحد",
            mon_short: "إثنين",
            tue_short: "ثلاثاء",
            wed_short: "أربعاء",
            thu_short: "خميس",
            fri_short: "جمعة",
            sat_short: "سبت",
          };
          return dict[k] || k;
        })
      },
      habitManager: {
        isParent: vi.fn((id) => id === "parent-1"),
        getEffectiveParentId: vi.fn((id) => id === "child-1" ? "parent-1" : null),
        isHabitScheduledForDay: vi.fn(() => true),
        getActiveHabits: vi.fn(() => [
          { id: "parent-1", name: "Parent Habit" },
          { id: "child-1", name: "Child Habit", parentId: "parent-1" }
        ]),
      },
      statsService: {
        calculateLastWeekRate: vi.fn(async () => 7),
        getHabitStatus: vi.fn(async () => "completed"),
      },
      habitScanner: { scan: vi.fn(() => []) },
      saveSettings: vi.fn(async () => {}),
    };

    mockContext = {
      app: {},
      plugin: mockPlugin,
      isAr: () => true,
      getDailyStats: () => dailyStatsMock,
      getWeekDayInfos: () => weekDayInfos,
      getWeekStart: () => weekStart,
      getLastWeekRatesCache: vi.fn(() => new Map()),
      getFocusedDayIndex: vi.fn(() => 1),
      setFocusedDayIndex: vi.fn(),
      getWeeklyContentContainer: vi.fn(() => document.querySelector(".weekly-grid-container")),
      getRefreshTimer: vi.fn(() => null),
      queueStreakCalculation: vi.fn(),
      openEditHabitModal: vi.fn(),
      openHabitPage: vi.fn(),
      toggleHabitCompletion: vi.fn(async () => true),
      checkMilestone: vi.fn(),
      goToCurrentWeek: vi.fn(async () => {}),
      toggleGroupCollapse: vi.fn((id, collapsed) => {
        const groups = new Set(mockPlugin.settings.collapsedGroups);
        if (collapsed) groups.add(id);
        else groups.delete(id);
        mockPlugin.settings.collapsedGroups = [...groups];
      }),
      toggleAllGroupsCollapse: vi.fn(async (ids, collapsed) => {
        const groups = new Set(mockPlugin.settings.collapsedGroups);
        ids.forEach(id => collapsed ? groups.add(id) : groups.delete(id));
        mockPlugin.settings.collapsedGroups = [...groups];
        await mockPlugin.saveSettings({ silent: true });
      }),
      getHabitNotesHeading: () => "Notes",
      extractSectionLines: content => content.split("\n"),
      isClosed: () => false,
    };

    renderer = new GridRenderer(mockContext);
    document.body.innerHTML = "";
  });

  it("1. should construct 3-tier unified progress layout with Arabic balanced phrasing and in-place updates", async () => {
    const container = document.createElement("div");
    container.className = "weekly-grid-container";
    document.body.appendChild(container);
    const progContainer = container.createDiv({ cls: "weekly-header-progress-container" });

    await renderer.updateUnifiedProgressBar(container);

    const headerRow = progContainer.querySelector(".unified-progress-header");
    expect(headerRow).not.toBeNull();
    const titleCol = headerRow.querySelector(".progress-title-col");
    expect(titleCol).not.toBeNull();
    const label = titleCol.querySelector(".progress-label");
    expect(label.textContent).toBe("إنجاز هذا الأسبوع حتى اليوم");
    const percentText = headerRow.querySelector(".unified-percent-text");
    expect(percentText.textContent).toBe("25%");
    const countBadge = headerRow.querySelector(".weekly-count-badge");
    expect(countBadge.textContent).toBe("(5/20)");
    expect(countBadge.getAttribute("dir")).toBe("ltr");

    const barFill = progContainer.querySelector(".weekly-progress-fill");
    expect(barFill).not.toBeNull();
    const caption = headerRow.querySelector(".weekly-barrier-caption");
    expect(caption).not.toBeNull();
    expect(caption.textContent).toContain("متقدم بـ 18 نقطة مئوية، استمر!");
    expect(caption.textContent).toContain("نفس أيام الأسبوع السابق: 7%");
    expect(mockPlugin.statsService.calculateLastWeekRate).toHaveBeenCalledWith(weekStart, 2);

    // In-place reactive update
    dailyStatsMock["2026-09-06"].completed = 3;
    await renderer.updateUnifiedProgressBar(container);

    expect(percentText.textContent).toBe("30%");
    expect(countBadge.textContent).toBe("(6/20)");
    expect(barFill.style.width).toBe("30%");
  });

  it("compares the same weekdays and shows a helpful gap or a matched pace", async () => {
    const container = document.createElement("div");
    container.className = "weekly-grid-container";
    document.body.appendChild(container);
    container.createDiv({ cls: "weekly-header-progress-container" });

    mockPlugin.statsService.calculateLastWeekRate.mockResolvedValue(40);
    await renderer.updateUnifiedProgressBar(container);
    let caption = container.querySelector(".weekly-barrier-caption");
    expect(caption.classList.contains("state-behind")).toBe(true);
    expect(caption.textContent).toContain("تفصلك 15 نقطة");
    expect(caption.textContent).toContain("نفس أيام الأسبوع السابق: 40%");
    expect(mockPlugin.statsService.calculateLastWeekRate).toHaveBeenCalledWith(weekStart, 2);

    mockContext.getLastWeekRatesCache.mockReturnValue(null);
    mockPlugin.statsService.calculateLastWeekRate.mockResolvedValue(25);
    await renderer.updateUnifiedProgressBar(container);
    caption = container.querySelector(".weekly-barrier-caption");
    expect(caption.classList.contains("state-level")).toBe(true);
    expect(caption.textContent).toContain("على وتيرة الأسبوع السابق");
    expect(caption.textContent).not.toContain("نقطة");
  });

  it("compares a past week with all seven days and omits comparison without prior data", async () => {
    weekStart = moment("2026-08-22");
    dailyStatsMock = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [
      weekStart.clone().add(i, "days").format("YYYY-MM-DD"),
      { completed: 2, total: 10 }
    ]));
    const container = document.createElement("div");
    container.className = "weekly-grid-container";
    document.body.appendChild(container);
    container.createDiv({ cls: "weekly-header-progress-container" });

    mockPlugin.statsService.calculateLastWeekRate.mockResolvedValue(15);
    await renderer.updateUnifiedProgressBar(container);
    expect(container.querySelector(".progress-label").textContent).toBe("إنجاز الأسبوع");
    expect(container.querySelector(".weekly-barrier-caption").textContent).toContain("الأسبوع السابق: 15%");
    expect(mockPlugin.statsService.calculateLastWeekRate).toHaveBeenCalledWith(weekStart, 7);

    mockContext.getLastWeekRatesCache.mockReturnValue(null);
    mockPlugin.statsService.calculateLastWeekRate.mockResolvedValue(null);
    await renderer.updateUnifiedProgressBar(container);
    expect(container.querySelector(".weekly-barrier-caption").style.display).toBe("none");
  });

  it("2. should render compact 7-day strip with standard Arabic names and single date source in focused day bar", async () => {
    const container = document.createElement("div");
    container.className = "weekly-grid-container";
    document.body.appendChild(container);

    await renderer.renderCompactList(container, moment("2026-09-06"), [
      { id: "parent-1", name: "Parent Habit" },
      { id: "child-1", name: "Child Habit", parentId: "parent-1" }
    ], new Map());

    // Duplicate header row should not exist
    expect(container.querySelector(".dh-compact-header-row")).toBeNull();

    // 7-day week strip
    const weekStrip = container.querySelector(".dh-compact-week-strip");
    expect(weekStrip).not.toBeNull();
    const dayPills = weekStrip.querySelectorAll(".dh-strip-day");
    expect(dayPills.length).toBe(7);

    // Standard Arabic day abbreviations
    const sundayName = dayPills[1].querySelector(".dh-strip-day-name");
    expect(sundayName.textContent).toBe("أحد");

    // Focused day bar with primary Gregorian and secondary Hijri dates
    const focusedDayBar = container.querySelector(".dh-compact-focused-day-bar");
    expect(focusedDayBar).not.toBeNull();
    const dateText = focusedDayBar.querySelector(".dh-focused-day-date");
    expect(dateText.textContent).toContain("الأحد");
    const hijriText = focusedDayBar.querySelector(".dh-focused-day-hijri");
    expect(hijriText).not.toBeNull();
    const statusText = focusedDayBar.querySelector(".dh-focused-day-status");
    expect(statusText.textContent).toBe("2 من 10");
    expect(statusText.getAttribute("dir")).toBe("rtl");

    const childRow = container.querySelector('.dh-compact-row[data-habit-id="child-1"]');
    expect(childRow.children[0].classList.contains("dh-compact-name-section")).toBe(true);
    expect(childRow.children[1].classList.contains("dh-compact-meta-section")).toBe(true);
    expect(childRow.children[2].classList.contains("dh-compact-action-section")).toBe(true);
    expect(childRow.querySelector(".dh-child-indent")).not.toBeNull();
    expect(childRow.querySelector(".habit-open-page-icon").tagName).toBe("BUTTON");
    expect(childRow.children[2].querySelector(".dh-streak-badge-slot")).not.toBeNull();
    expect(childRow.children[2].querySelector(".habit-open-page-icon")).not.toBeNull();
    expect(childRow.children[1].children).toHaveLength(0);

    // Inline bulk button exists with icon
    const bulkBtn = focusedDayBar.querySelector(".dh-compact-bulk-btn");
    expect(bulkBtn).not.toBeNull();
    expect(bulkBtn.querySelector(".dh-bulk-icon")).not.toBeNull();
  });

  it("3. should reactively update compact week strip percentages and day status without page refresh", async () => {
    const container = document.createElement("div");
    container.className = "weekly-grid-container";
    document.body.appendChild(container);

    await renderer.renderCompactList(container, moment("2026-09-06"), [
      { id: "parent-1", name: "Parent Habit" },
      { id: "child-1", name: "Child Habit", parentId: "parent-1" }
    ], new Map());

    const sundayPillPct = container.querySelectorAll(".dh-strip-day-percentage")[1];
    expect(sundayPillPct.textContent).toBe("20%");

    // Simulate completion increase
    dailyStatsMock["2026-09-06"].completed = 5;
    renderer.updateCompactWeekStrip(container);

    expect(sundayPillPct.textContent).toBe("50%");
    const statusText = container.querySelector(".dh-focused-day-status");
    expect(statusText.textContent).toBe("5 من 10");
  });

  it("4. should instantly toggle bulk collapse in DOM in 0ms without re-rendering or flashing", async () => {
    const container = document.createElement("div");
    container.className = "weekly-grid-container";
    document.body.appendChild(container);

    await renderer.renderCompactList(container, moment("2026-09-06"), [
      { id: "parent-1", name: "Parent Habit" },
      { id: "child-1", name: "Child Habit", parentId: "parent-1" }
    ], new Map());

    const childRow = container.querySelector('.habit-row-child[data-group-id="parent-1"]');
    expect(childRow).not.toBeNull();
    expect(childRow.hidden).toBe(false);

    const bulkBtn = container.querySelector(".dh-compact-bulk-btn");
    bulkBtn.click();

    expect(childRow.hidden).toBe(true);
    expect(bulkBtn.getAttribute("aria-label")).toBe("فرد المجموعات");
    expect(mockPlugin.saveSettings).toHaveBeenCalledWith({ silent: true });

    await vi.waitFor(() => expect(bulkBtn.disabled).toBe(false));
    container.querySelector('[data-collapse-id="parent-1"]').click();
    expect(childRow.hidden).toBe(false);
    expect(bulkBtn.getAttribute("aria-label")).toBe("طي المجموعات");

    await vi.waitFor(() => expect(container.querySelector('[data-collapse-id="parent-1"]').disabled).toBe(false));
    bulkBtn.click();
    expect(childRow.hidden).toBe(true);
    await vi.waitFor(() => expect(bulkBtn.disabled).toBe(false));
    bulkBtn.click();
    expect(childRow.hidden).toBe(false);
    expect(bulkBtn.getAttribute("aria-label")).toBe("طي المجموعات");
  });

  it("returns to the real current week from the compact day control", async () => {
    mockContext.getFocusedDayIndex.mockReturnValue(0);
    const container = document.createElement("div");
    container.className = "weekly-grid-container";
    document.body.appendChild(container);
    await renderer.renderCompactList(container, moment("2026-09-06"), [
      { id: "parent-1", name: "Parent Habit" }
    ], new Map());

    container.querySelector(".dh-compact-today-btn-pill").click();
    expect(mockContext.goToCurrentWeek).toHaveBeenCalledOnce();
  });

  it("places a child comment marker on the child row", async () => {
    mockPlugin.settings.enableHabitContext = true;
    const container = document.createElement("div");
    container.className = "weekly-grid-container";
    document.body.appendChild(container);
    const habits = [
      { id: "parent-1", name: "Parent Habit" },
      { id: "child-1", name: "Child Habit", parentId: "parent-1" }
    ];
    await renderer.renderCompactList(container, moment("2026-09-06"), habits,
      new Map([["2026-09-06", "- [habit-id:: child-1] note"]]));

    expect(container.querySelector('[data-habit-id="child-1"] .dh-has-comment-dot')).not.toBeNull();
    expect(container.querySelector('[data-habit-id="parent-1"] .dh-has-comment-dot')).toBeNull();
  });

  it("allows a scheduled habit to create a missing daily note from the focused day", async () => {
    mockPlugin.statsService.getHabitStatus.mockResolvedValue("ignored");
    const container = document.createElement("div");
    container.className = "weekly-grid-container";
    document.body.appendChild(container);
    await renderer.renderCompactList(container, moment("2026-09-06"), [
      { id: "parent-1", name: "Parent Habit" }
    ], new Map([["2026-09-06", null]]));

    const button = container.querySelector('[data-habit-id="parent-1"] .dh-compact-status-btn');
    expect(button).not.toBeNull();
    expect(button.getAttribute("data-status")).toBe("uncompleted");
  });

  it("keeps bulk action text in sync with an individual group toggle", async () => {
    const container = document.createElement("div");
    container.className = "weekly-grid-container";
    document.body.appendChild(container);
    await renderer.renderCompactList(container, moment("2026-09-06"), [
      { id: "parent-1", name: "Parent Habit" },
      { id: "child-1", name: "Child Habit", parentId: "parent-1" }
    ], new Map());

    container.querySelector('[data-collapse-id="parent-1"]').click();
    expect(container.querySelector(".dh-compact-bulk-btn").getAttribute("aria-label")).toBe("فرد المجموعات");
    expect(container.querySelector('[data-collapse-id="parent-1"]').getAttribute("aria-expanded")).toBe("false");
  });

  it("scans each preloaded daily note once for a large grid", () => {
    const preloaded = new Map([
      ["2026-09-05", "first note"],
      ["2026-09-06", "second note"],
      ["2026-09-07", null]
    ]);
    const parsed = renderer.prepareWeekStatusContent(preloaded);
    expect(mockPlugin.habitScanner.scan).toHaveBeenCalledTimes(2);
    expect(parsed.get("2026-09-07")).toEqual({ hasNote: false, scanned: [] });
  });

  it("matches desktop comment markers by habit ID when names repeat", () => {
    const tbody = document.createElement("div");
    for (const id of ["parent-1", "child-1"]) {
      const row = tbody.createDiv({ cls: "habit-row", attr: { "data-habit-id": id } });
      row.createDiv({ cls: "day-cell", attr: { "data-day-index": "1" } });
    }
    renderer.populateCommentDots(tbody, [
      { id: "parent-1", name: "Same name" },
      { id: "child-1", name: "Same name" }
    ], weekStart, new Map([["2026-09-06", "- [habit-id:: child-1] note"]]));

    expect(tbody.querySelector('[data-habit-id="child-1"] .dh-has-comment-dot')).not.toBeNull();
    expect(tbody.querySelector('[data-habit-id="parent-1"] .dh-has-comment-dot')).toBeNull();
  });
});
