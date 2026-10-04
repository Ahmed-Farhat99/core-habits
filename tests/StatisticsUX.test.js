import { afterEach, describe, expect, it, vi } from "vitest";
import moment from "moment";
import ar from "../src/locales/ar.js";
import en from "../src/locales/en.js";
import { StatsScoreRing } from "../src/views/statistics/components/StatsScoreRing.js";
import { StatsMetricCards } from "../src/views/statistics/components/StatsMetricCards.js";
import { StatsTrendChart } from "../src/views/statistics/components/StatsTrendChart.js";
import { StatsHabitsList } from "../src/views/statistics/components/StatsHabitsList.js";
import { StatisticsViewController } from "../src/views/statistics/StatisticsViewController.js";
import { StatsPeriod, PERIOD_TYPES } from "../src/domain/stats/StatsPeriod.js";
import { StatsHeader } from "../src/views/statistics/components/StatsHeader.js";
import { Menu } from "obsidian";

function context(language = "ar") {
  const messages = language === "ar" ? ar : en;
  return {
    isAr: () => language === "ar",
    plugin: {
      settings: { language, lifetimeCompleted: 120 },
      translationManager: {
        t: (key, params = {}) => (messages[key] || "").replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? "")),
      },
    },
  };
}

describe("statistics presentation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("orders period choices from shortest to longest", () => {
    let titles;
    vi.spyOn(Menu.prototype, "showAtPosition").mockImplementation(function() {
      titles = this.items.map(item => item.title);
      return this;
    });
    const ctx = context("ar");
    ctx.plugin.settings.showHijriDate = false;
    const container = document.createElement("div");
    new StatsHeader(ctx, vi.fn(), vi.fn()).render(container, new StatsPeriod(PERIOD_TYPES.LAST_28_DAYS));

    container.querySelector(".dh-stats-period-select-btn").click();

    expect(titles.slice(0, 4)).toEqual([
      ar.stats_preset_last_7_days,
      ar.stats_preset_last_28_days,
      ar.stats_preset_last_12_weeks,
      ar.stats_preset_this_year,
    ]);
  });

  it("explains period comparisons as percentage points without repeating an insight", () => {
    vi.stubGlobal("requestAnimationFrame", callback => callback());
    const container = document.createElement("div");
    new StatsScoreRing(context()).render(container, {
      consistencyRate: 11,
      totalScheduled: 608,
      delta: -3,
      deltaType: "negative",
    });

    expect(container.querySelector(".dh-score-value").textContent).toBe("11%");
    expect(container.querySelector(".dh-score-delta").textContent).toContain("3 نقطة مئوية");
    expect(container.querySelector(".dh-score-delta").textContent).toContain("14%");
    expect(container.querySelector(".dh-score-insight")).toBeNull();
  });

  it("shows no percentage when no scheduled check-ins were counted", () => {
    vi.stubGlobal("requestAnimationFrame", callback => callback());
    const container = document.createElement("div");
    new StatsScoreRing(context("en")).render(container, {
      consistencyRate: 0,
      totalScheduled: 0,
      delta: null,
    });

    expect(container.querySelector(".dh-score-value").textContent).toBe("—");
    expect(container.textContent).toContain("No counted check-ins");
  });

  it("labels check-ins and calendar days without calling days attendance", () => {
    const container = document.createElement("div");
    new StatsMetricCards(context()).render(container, {
      totalCompleted: 67,
      totalScheduled: 608,
      activeDaysCount: 17,
      measuredDaysCount: 28,
      periodStreak: 4,
    });

    expect(container.querySelector(".dh-summary-item-completed").textContent).toContain("608 فرصة محتسبة");
    const active = container.querySelector(".dh-summary-item-active-days").textContent;
    expect(active).toContain("17");
    expect(active).toContain("28 يومًا في الفترة");
    expect(active).not.toContain("حضور");
  });

  it("counts scheduled check-ins in trend rows and omits future buckets", () => {
    const container = document.createElement("div");
    new StatsTrendChart(context("en")).render(container, {
      trajectoryGrain: "weekly",
      trajectoryBuckets: [
        { weekIndex: 1, startDate: moment("2026-09-01"), endDate: moment("2026-09-07"), completed: 6, scheduled: 152, rate: 4 },
        { weekIndex: 2, startDate: moment("2026-09-08"), endDate: moment("2026-09-14"), completed: 0, scheduled: 0, rate: 0, isFuture: true },
      ],
    });

    expect(container.querySelectorAll(".dh-trend-flow-card")).toHaveLength(1);
    expect(container.querySelector(".dh-flow-count").textContent).toBe("6 of 152 counted check-ins");
  });

  it("does not present a week with no counted check-ins as zero percent", () => {
    const container = document.createElement("div");
    new StatsTrendChart(context("en")).render(container, {
      trajectoryGrain: "weekly",
      trajectoryBuckets: [
        { weekIndex: 1, startDate: moment("2026-09-01"), endDate: moment("2026-09-07"), completed: 0, scheduled: 0, rate: 0 },
      ],
    });

    expect(container.querySelector(".dh-flow-rate").textContent).toBe("—");
    expect(container.querySelector(".dh-flow-count").textContent).toBe("No counted check-ins");
  });

  it("keeps per-habit detail collapsed while showing the lifetime total", () => {
    const container = document.createElement("div");
    const component = new StatsHabitsList(context("en"));
    component.render(container, {
      allHabits: [{ id: "habit-1", name: "Read", habitType: "build", rate: 50, completedCount: 2, scheduledCount: 4 }],
      consistencyRate: 50,
    });

    const header = container.querySelector(".dh-habits-collapsible-header");
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".dh-habits-collapsible-body").style.display).toBe("none");
    expect(container.querySelector(".dh-stats-lifetime-footer").textContent).toContain("120");
    header.click();
    expect(header.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders the latest selected period after an earlier calculation finishes", async () => {
    let resolveFirst;
    const data = { metrics: { allHabits: [{}] } };
    const ctx = context("en");
    ctx.plugin.statsService = {
      getPeriodStatistics: vi.fn()
        .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
        .mockResolvedValue(data),
    };
    const controller = new StatisticsViewController(ctx);
    controller.headerComponent.render = vi.fn();
    controller.scoreRingComponent.render = vi.fn();
    controller.metricCardsComponent.render = vi.fn();
    controller.trendChartComponent.render = vi.fn();
    controller.weekdayRhythmComponent.render = vi.fn();
    controller.habitsListComponent.render = vi.fn();
    const container = document.createElement("div");

    const firstRender = controller.render(container);
    const nextPeriod = new StatsPeriod(PERIOD_TYPES.LAST_7_DAYS);
    await controller.setPeriod(nextPeriod);
    resolveFirst(data);
    await firstRender;

    expect(ctx.plugin.statsService.getPeriodStatistics).toHaveBeenCalledTimes(2);
    expect(controller.headerComponent.render).toHaveBeenCalledTimes(1);
    expect(controller.headerComponent.render).toHaveBeenCalledWith(container, nextPeriod);
  });

  it("does not paint statistics after the controller is destroyed", async () => {
    let resolveLoad;
    const ctx = context("en");
    ctx.plugin.statsService = {
      getPeriodStatistics: () => new Promise(resolve => { resolveLoad = resolve; }),
    };
    const controller = new StatisticsViewController(ctx);
    controller.headerComponent.render = vi.fn();
    const container = document.createElement("div");

    const rendering = controller.render(container);
    controller.destroy();
    resolveLoad({ metrics: { allHabits: [{}] } });
    await rendering;

    expect(controller.headerComponent.render).not.toHaveBeenCalled();
  });
});
