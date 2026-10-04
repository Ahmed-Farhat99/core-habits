import { StatsPeriod, PERIOD_TYPES } from '../../domain/stats/StatsPeriod.js';
import { StatsHeader } from './components/StatsHeader.js';
import { StatsScoreRing } from './components/StatsScoreRing.js';
import { StatsMetricCards } from './components/StatsMetricCards.js';
import { StatsTrendChart } from './components/StatsTrendChart.js';
import { StatsWeekdayRhythm } from './components/StatsWeekdayRhythm.js';
import { StatsHabitsList } from './components/StatsHabitsList.js';
import { StatusView } from '../StatusView.js';
import { Utils } from '../../utils/Utils.js';

export class StatisticsViewController {
  constructor(context) {
    this.plugin = context.plugin;

    const weekStartDay = typeof this.plugin.settings?.weekStartDay === "number"
      ? this.plugin.settings.weekStartDay
      : 6;

    this.currentPeriod = new StatsPeriod(PERIOD_TYPES.LAST_28_DAYS, { weekStartDay });

    this.headerComponent = new StatsHeader(
      context,
      (p) => this.setPeriod(p),
      () => this.refresh()
    );
    this.scoreRingComponent = new StatsScoreRing(context);
    this.metricCardsComponent = new StatsMetricCards(context);
    this.trendChartComponent = new StatsTrendChart(context);
    this.weekdayRhythmComponent = new StatsWeekdayRhythm(context);
    this.habitsListComponent = new StatsHabitsList(context);

    this.lastContainer = null;
    this._isRendering = false;
    this._pendingRender = false;
    this._destroyed = false;
  }

  async setPeriod(newPeriod) {
    this.currentPeriod = newPeriod;
    if (this.lastContainer) {
      await this.render(this.lastContainer);
    }
  }

  async refresh() {
    if (this.plugin.statsService && typeof this.plugin.statsService.invalidateCache === "function") {
      this.plugin.statsService.invalidateCache();
    }
    if (this.lastContainer) {
      await this.render(this.lastContainer);
    }
  }

  async render(container) {
    if (!container || this._destroyed) return;
    this.lastContainer = container;

    if (this._isRendering) {
      this._pendingRender = true;
      return;
    }
    this._isRendering = true;
    const period = this.currentPeriod;

    try {
      container.empty();
      container.addClass("dh-statistics-view-container");
      const t = (k, p) => this.plugin.translationManager.t(k, p);

      const loader = StatusView.renderLoading(container, t("stats_calculating") || "جاري الحساب...");

      let statsData;
      try {
        statsData = await this.plugin.statsService.getPeriodStatistics(period);
      } catch (e) {
        if (this._destroyed || container !== this.lastContainer || period !== this.currentPeriod) return;
        Utils.debugLog(this.plugin, "Failed to load period statistics", e);
        loader.element.remove();
        StatusView.renderEmptyState(container, {
          icon: "⚠️",
          title: t("stats_error_loading") || "تعذر تحميل الإحصائيات",
          description: e.message || "",
        });
        return;
      }

      if (this._destroyed || container !== this.lastContainer || period !== this.currentPeriod) return;
      loader.element.remove();

      if (!statsData || !statsData.metrics || (statsData.metrics.allHabits && statsData.metrics.allHabits.length === 0)) {
        StatusView.renderEmptyState(container, {
          icon: "🌱",
          title: t("empty_state_title"),
          description: t("empty_state_desc"),
        });
        return;
      }

      const { metrics } = statsData;

      this.headerComponent.render(container, period);
      this.scoreRingComponent.render(container, metrics);
      this.metricCardsComponent.render(container, metrics);
      this.trendChartComponent.render(container, metrics);
      this.weekdayRhythmComponent.render(container, metrics, period);
      this.habitsListComponent.render(container, metrics);
    } finally {
      this._isRendering = false;
      if (this._pendingRender && !this._destroyed && this.lastContainer) {
        this._pendingRender = false;
        await this.render(this.lastContainer);
      }
    }
  }

  /**
   * Cleanup lifecycle method to release DOM references
   */
  destroy() {
    this._destroyed = true;
    this.lastContainer = null;
    this._pendingRender = false;
  }
}
