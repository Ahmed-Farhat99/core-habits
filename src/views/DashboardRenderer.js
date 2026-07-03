import { DAY_KEYS } from '../constants.js';
import { Utils } from '../utils/Utils.js';
import { StatusView } from './StatusView.js';

export class DashboardRenderer {
  constructor(context) {
    this.context = context;
    this.app = context.app;
    this.plugin = context.plugin;
  }

  async syncLifetimeAchievements(containerEl) {
    if (typeof this.plugin.settings.lifetimeCompleted === "number") return;

    containerEl.empty();
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const loader = StatusView.renderLoading(containerEl, t("stats_calculating_lifetime"));

    try {
      await this.plugin.statsService.syncLifetimeAchievements((progress, total) => {
        loader.updateText(t("stats_calculating_lifetime_progress", { progress, total }));
      });
    } catch (e) {
      Utils.debugLog(this.plugin, "Failed to sync lifetime stats", e);
    }

    loader.element.remove();
    containerEl.empty();
    await this.render(containerEl);
  }

  async analyzeLastFourWeeks() {
    const now = Date.now();
    const cache = this.context.getLastFourWeeksCache();
    if (cache && (now - cache.timestamp < 120000)) {
      return cache.data;
    }

    const stats = await this.plugin.statsService.analyzeLastFourWeeks(this.context.getWeekStart());
    const result = { ...stats, isAr: this.context.isAr() };
    this.context.setLastFourWeeksCache({ timestamp: now, data: result });
    return result;
  }

  async render(container) {
    container.empty();
    container.addClass("decision-dashboard-container");
    const t = (k, p) => this.plugin.translationManager.t(k, p);

    // --- Loading State using unified StatusView component ---
    const loader = StatusView.renderLoading(container, t("stats_calculating"));

    let statsData;
    try {
      statsData = await this.analyzeLastFourWeeks();
    } catch (e) {
      Utils.debugLog(this.plugin, "Failed to load stats", e);
      loader.element.remove();
      StatusView.renderEmptyState(container, {
        icon: "⚠️",
        title: t("stats_error_loading"),
        description: e.message || ""
      });
      return;
    }

    loader.element.remove();

    if (!statsData || !statsData.weeksData || statsData.weeksData.length === 0) {
      StatusView.renderEmptyState(container, {
        icon: "🌱",
        title: this.plugin.translationManager.t("empty_state_title"),
        description: this.plugin.translationManager.t("empty_state_desc")
      });
      return;
    }

    const { weeksData, dayStats, bestHabit, worstHabit } = statsData;

    // --- Section 1: Consolidated Global Pulse / Overview Card ---
    const cardsRow = container.createDiv({ cls: "dh-pulse-cards-row" });

    const overviewCard = cardsRow.createDiv({ cls: "dh-card dh-pulse-card unified-overview-card" });
    overviewCard.createDiv({ cls: "pulse-title", text: t("stats_lifetime_achievements") });
    
    const hasLifetime = typeof this.plugin.settings.lifetimeCompleted === "number";
    overviewCard.createDiv({ 
      cls: "pulse-value", 
      text: hasLifetime ? this.plugin.settings.lifetimeCompleted.toString() : "0" 
    });

    const subtitleContainer = overviewCard.createDiv({ cls: "pulse-subtitle-wrapper" });
    subtitleContainer.createSpan({ text: t("stats_lifetime_subtitle") });
    subtitleContainer.createSpan({ text: " " });
    const refreshBtn = subtitleContainer.createEl("button", {
      cls: "dh-btn dh-calc-btn-mini",
      text: "🔄",
      title: t("refresh_title") || "Refresh"
    });
    refreshBtn.onclick = async (e) => {
      e.stopPropagation();
      await this.plugin.statsService.initLifetimeIndex();
    };

    // Compact Identity Mix sub-row inside the main overview card
    const activeHabits = this.plugin.habitManager.getActiveHabits();
    const builds = activeHabits.filter(h => h.habitType === "build").length;
    const breaks = activeHabits.filter(h => h.habitType === "break").length;

    const identityRow = overviewCard.createDiv({ cls: "dh-identity-mix-row-compact" });
    identityRow.createSpan({ text: `${t("stats_identity_mix")}: ` });
    
    const buildSpan = identityRow.createSpan({ cls: "id-stat-compact build-stat" });
    buildSpan.createSpan({ cls: "id-dot green-dot" });
    buildSpan.createSpan({ text: t("stats_identity_build", { count: builds }) });

    identityRow.createSpan({ cls: "divider-dot", text: " • " });

    const breakSpan = identityRow.createSpan({ cls: "id-stat-compact break-stat" });
    breakSpan.createSpan({ cls: "id-dot red-dot" });
    breakSpan.createSpan({ text: t("stats_identity_break", { count: breaks }) });

    // --- Section 2: Weekly Trends Table ---
    const trendsSection = container.createDiv({ cls: "dh-dashboard-section" });
    trendsSection.createEl("h3", { text: t("stats_weekly_trends_title") });
    trendsSection.createEl("p", {
      cls: "dh-section-desc",
      text: t("stats_weekly_trends_desc")
    });

    const tableTrends = trendsSection.createEl("table", { cls: "dh-dashboard-table" });
    const theadTrends = tableTrends.createEl("thead");
    const trThTrends = theadTrends.createEl("tr");
    trThTrends.createEl("th", { text: t("stats_table_header_week") });
    trThTrends.createEl("th", { text: t("stats_table_header_rate") });
    trThTrends.createEl("th", { text: t("stats_table_header_trend") });

    const tbodyTrends = tableTrends.createEl("tbody");

    // We show from Week 0 to Week -3
    for (let i = 0; i < weeksData.length; i++) {
      const tr = tbodyTrends.createEl("tr");
      let weekName;
      if (i === 0) weekName = t("stats_week_current");
      else if (i === 1) weekName = t("stats_week_last");
      else weekName = t("stats_week_index", { index: i });

      tr.createEl("td", { text: weekName });
      tr.createEl("td", { text: `${weeksData[i].rate}%` });

      // Trend cell (compared to prior week if exists)
      const trendCell = tr.createEl("td", { cls: "dh-trend-cell" });
      if (i < weeksData.length - 1) {
        const diff = weeksData[i].rate - weeksData[i + 1].rate;
        if (diff > 0) {
          trendCell.textContent = t("stats_trend_up", { diff });
          trendCell.classList.add("is-positive");
        } else if (diff < 0) {
          const absDiff = Math.abs(diff);
          trendCell.textContent = t("stats_trend_down", { diff: absDiff });
          trendCell.classList.add("is-negative");
        } else {
          trendCell.textContent = t("stats_trend_stable");
        }
      } else {
        trendCell.textContent = "—";
      }
    }

    // --- Best & Worst Habits Highlighter ---
    if (bestHabit && worstHabit && bestHabit.name !== worstHabit.name) {
      const habitsFocus = container.createDiv({ cls: "dh-habit-focus-box" });

      const bestEl = habitsFocus.createDiv({ cls: "dh-card focus-item best-focus clickable-card" });
      bestEl.createDiv({ cls: "focus-icon", text: "🎯" });
      const bText = bestEl.createDiv({ cls: "focus-text" });
      bText.createDiv({ cls: "focus-label", text: t("stats_focus_best_label") });
      bText.createDiv({ cls: "focus-name", text: `${bestHabit.name} (${bestHabit.pct}%)` });

      bestEl.onclick = () => {
        const h = this.plugin.habitManager.getHabitById(bestHabit.id);
        if (h) {
          this.context.openEditHabitModal(h);
        }
      };

      const worstEl = habitsFocus.createDiv({ cls: "dh-card focus-item worst-focus clickable-card" });
      worstEl.createDiv({ cls: "focus-icon", text: "⚠️" });
      const wText = worstEl.createDiv({ cls: "focus-text" });
      wText.createDiv({ cls: "focus-label", text: t("stats_focus_worst_label") });
      wText.createDiv({ cls: "focus-name", text: `${worstHabit.name} (${worstHabit.pct}%)` });

      worstEl.onclick = () => {
        const h = this.plugin.habitManager.getHabitById(worstHabit.id);
        if (h) {
          this.context.openEditHabitModal(h);
        }
      };
    }

    // --- Section 3: Day-by-Day Analysis ---
    const daySection = container.createDiv({ cls: "dh-dashboard-section" });
    daySection.createEl("h3", { text: t("stats_daily_patterns_title") });
    daySection.createEl("p", {
      cls: "dh-section-desc",
      text: t("stats_daily_patterns_desc")
    });

    // Reorder days based on language settings
    const wsd = this.plugin.settings.weekStartDay;
    const dayOrder = Array.from({ length: 7 }, (_, i) => (wsd + i) % 7);

    // Find min/max for highlighting
    let maxPct = -1;
    let minPct = 101;
    let validDaysCount = 0;

    const computedDays = {};
    for (const d of dayOrder) {
      const stats = dayStats[d];
      if (!stats || stats.total === 0) {
        computedDays[d] = NaN;
      } else {
        const pct = Math.round((stats.completed / stats.total) * 100);
        computedDays[d] = pct;
        validDaysCount++;
        if (pct > maxPct) maxPct = pct;
        if (pct < minPct) minPct = pct;
      }
    }

    if (maxPct === minPct) {
      minPct = -1;
      maxPct = -1;
    }

    // Fully responsive Day-by-Day card grid layout (Flexbox/Grid wraps automatically on mobile/sidebar)
    const daysGrid = daySection.createDiv({ cls: "dh-days-patterns-grid" });

    for (const d of dayOrder) {
      const dayCard = daysGrid.createDiv({ cls: "dh-day-pattern-card" });
      dayCard.createDiv({ cls: "day-pattern-name", text: this.plugin.translationManager.t(DAY_KEYS[d]) });

      const v = computedDays[d];
      const valDiv = dayCard.createDiv({ cls: "day-pattern-val" });

      if (isNaN(v)) {
        valDiv.textContent = "—";
      } else {
        valDiv.textContent = `${v}%`;
        if (v === maxPct) {
          dayCard.addClass("day-golden");
          dayCard.createDiv({ cls: "day-pattern-badge golden", text: "✅" });
        } else if (v === minPct) {
          dayCard.addClass("day-weakest");
          dayCard.createDiv({ cls: "day-pattern-badge weakest", text: "🔴" });
        }
      }
    }

    if (validDaysCount > 0 && maxPct !== -1) {
      const diagnosis = daySection.createDiv({ cls: "day-diagnosis-text" });
      diagnosis.textContent = t("stats_daily_patterns_guideline");
    }
  }
}
