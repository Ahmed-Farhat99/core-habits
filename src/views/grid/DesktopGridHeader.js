import { DAY_KEYS } from '../../constants.js';
import { Utils } from '../../utils/Utils.js';
import { DateUtils } from '../../utils/helpers.js';
import { TooltipHelper } from '../../utils/TooltipHelper.js';
import { GridInteractionHelper } from './GridInteractionHelper.js';

export class DesktopGridHeader {
  /**
   * @param {object} context - WeeklyGridView context
   */
  constructor(context) {
    this.context = context;
    this.plugin = context.plugin;
  }

  get isAr() {
    return this.context.isAr();
  }

  /**
   * Renders the desktop grid table header (thead) including corner bulk-actions,
   * date columns (Gregorian & Hijri), and placeholder cells for daily completion statistics.
   * @param {HTMLElement} table
   * @param {Array} habits
   * @returns {Promise<HTMLElement>} thead element
   */
  async renderDayHeaders(table, habits = []) {
    const thead = table.createDiv({ cls: "habits-thead", attr: { role: "rowgroup" } });

    // Row 1: Day Names & Dates
    const headerRow = thead.createDiv({ cls: "header-row-date dh-grid-row", attr: { role: "row" } });
    headerRow.createDiv({ cls: "habit-index-header dh-grid-cell", text: "#", attr: { role: "columnheader" } });
    const cornerCell = headerRow.createDiv({ cls: "corner-cell dh-grid-cell", attr: { role: "columnheader" } });

    const hasParentHabits = habits.some(h => this.plugin.habitManager.isParent(h.id));
    if (hasParentHabits) {
      const parentHabits = habits.filter(h => this.plugin.habitManager.isParent(h.id));
      const parentIds = parentHabits.map(h => h.id);

      GridInteractionHelper.createBulkCollapseButton(cornerCell, table, parentIds, {
        settings: this.plugin.settings,
        t: this.plugin.translationManager.t.bind(this.plugin.translationManager),
        onToggle: (ids, collapsed) => this.context.toggleAllGroupsCollapse(ids, collapsed)
      });
    }

    // Row 2: Daily Stats
    const statsRow = thead.createDiv({ cls: "header-row-stats dh-grid-row", attr: { role: "row" } });
    statsRow.createDiv({ cls: "habit-index-header dh-grid-cell", attr: { role: "gridcell" } });
    statsRow.createDiv({ cls: "corner-cell stats-corner dh-grid-cell", attr: { role: "gridcell" } });

    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const weekDayInfos = this.context.getWeekDayInfos();

    for (let i = 0; i < 7; i++) {
      const { dayDate, isToday, dayOfWeek } = weekDayInfos[i];
      const name = t(DAY_KEYS[dayOfWeek]);
      const displayDate = dayDate.clone().locale(this.plugin.settings.language || "ar");

      const dayHeaderCell = headerRow.createDiv({
        cls: `day-header dh-grid-cell ${isToday ? "today" : ""} clickable`,
        attr: {
          "data-day-index": String(i),
          role: "columnheader",
          tabindex: "0"
        }
      });
      TooltipHelper.set(dayHeaderCell, TooltipHelper.formatDayHeader(name, displayDate.format(t("date_format_short")), t, this.isAr));

      dayHeaderCell.createDiv({ text: name, cls: "day-name" });

      dayHeaderCell.createDiv({
        text: displayDate.format(t("date_format_short")),
        cls: "day-date",
      });

      if (this.plugin.settings.showHijriDate) {
        try {
          const hijriDate = DateUtils.getHijriDate(dayDate, this.isAr);
          const hijriParts = hijriDate.replace(/\s+هـ$/, "").split(" ");
          const hijriShort = hijriParts.length >= 2 ? `${hijriParts[0]} ${hijriParts[1]}` : hijriDate;
          dayHeaderCell.createDiv({ text: hijriShort, cls: "day-date-hijri" });
        } catch (e) {
          Utils.debugLog(this.plugin, "Error displaying Hijri date:", e);
        }
      }

      dayHeaderCell.onclick = () => {
        this.context.openDailyNote(dayDate);
      };
      dayHeaderCell.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.context.openDailyNote(dayDate);
        }
      };

      statsRow.createDiv({
        cls: `day-stat-cell dh-grid-cell ${isToday ? "today" : ""}`,
        attr: { "data-day-index": String(i), role: "gridcell" }
      });
    }
    return thead;
  }

  /**
   * Updates percentage badges in the header daily stats row.
   * @param {HTMLElement} thead
   */
  async updateHeaderPercentages(thead) {
    if (!thead) return;
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const today = window.moment();
    const statCells = thead.querySelectorAll(".day-stat-cell");
    const dayCount = 7;
    const dailyStats = this.context.getDailyStats();
    if (!statCells || statCells.length !== dayCount || !dailyStats) return;

    for (let index = 0; index < dayCount; index++) {
      const cell = statCells[index];
      if (!cell) continue;
      cell.empty();

      const dayDate = this.context.getWeekStart().clone().add(index, "days");
      const dateKey = DateUtils.formatDateKey(dayDate);
      const stats = dailyStats[dateKey];

      if (stats && !dayDate.isAfter(today, "day") && stats.total > 0) {
        const percent = Math.min(100, Math.round((stats.completed / stats.total) * 100));
        let colorClass = "percent-low";
        if (percent === 100) colorClass = "percent-complete";
        else if (percent >= 80) colorClass = "percent-high";
        else if (percent >= 50) colorClass = "percent-medium";

        const badge = cell.createDiv({ cls: `day-stat-badge ${colorClass}` });
        badge.textContent = percent === 100 ? "✓" : `${percent}%`;
        TooltipHelper.set(badge, TooltipHelper.formatDailyCompletionRate(stats.completed, stats.total, t, this.isAr));
      }
    }
  }

  /**
   * Calculates completion rate for the previous week (cached).
   * @returns {Promise<number>}
   */
  async calculateLastWeekRateAsync(dayCount = 7) {
    const prevWeekStartStr = `${DateUtils.formatDateKey(this.context.getWeekStart().clone().subtract(7, "days"))}:${dayCount}`;
    const lastWeekRatesCache = this.context.getLastWeekRatesCache();
    if (lastWeekRatesCache && lastWeekRatesCache.has(prevWeekStartStr)) {
      return lastWeekRatesCache.get(prevWeekStartStr);
    }

    const rate = await this.plugin.statsService.calculateLastWeekRate(this.context.getWeekStart(), dayCount);

    if (lastWeekRatesCache) {
      lastWeekRatesCache.set(prevWeekStartStr, rate);
    }

    return rate;
  }

  /**
   * Updates or builds the unified progress banner above the grid.
   * @param {HTMLElement} container
   */
  async updateUnifiedProgressBar(container) {
    const today = window.moment();
    const root = container.closest(".weekly-grid-container") || container;
    const progressContainer = root.querySelector(
      ".weekly-header-progress-container",
    );
    if (!progressContainer) return;

    if (!this.plugin.settings.showCount) {
      progressContainer.empty();
      return;
    }

    let weekTotal = 0;
    let weekCompleted = 0;
    const dailyStats = this.context.getDailyStats();

    for (const dateKey in dailyStats || {}) {
      const stats = dailyStats[dateKey];
      const dayMoment = window.moment(dateKey, "YYYY-MM-DD", true);
      if (!dayMoment.isAfter(today, "day")) {
        weekTotal += stats.total;
        weekCompleted += stats.completed;
      }
    }

    const weekPercentage =
      weekTotal > 0 ? Math.round((weekCompleted / weekTotal) * 100) : 0;

    progressContainer.style.setProperty(
      "--total-count",
      weekTotal > 0 ? weekTotal : 10,
    );

    let internalWrapper = progressContainer.querySelector(".unified-progress-wrapper");
    let percentText, countBadge, barFill, captionEl;

    if (!internalWrapper) {
      progressContainer.empty();
      internalWrapper = progressContainer.createDiv({
        cls: "unified-progress-wrapper",
      });

      const headerRow = internalWrapper.createDiv({ cls: "unified-progress-header" });
      
      const titleCol = headerRow.createDiv({ cls: "progress-title-col" });
      const label = titleCol.createDiv({ cls: "progress-label" });
      label.textContent = this.plugin.translationManager.t("grid_completion_rate");

      captionEl = headerRow.createDiv({ cls: "weekly-barrier-caption" });

      const numbersGroup = headerRow.createDiv({ cls: "progress-numbers-group" });
      percentText = numbersGroup.createSpan({ cls: "unified-percent-text" });
      countBadge = numbersGroup.createSpan({ cls: "weekly-count-badge" });
      countBadge.setAttribute("dir", "ltr");

      const barContainer = internalWrapper.createDiv({
        cls: "weekly-progress-bar unified-bar",
      });
      barFill = barContainer.createDiv({ cls: "weekly-progress-fill" });
    } else {
      percentText = internalWrapper.querySelector(".unified-percent-text");
      countBadge = internalWrapper.querySelector(".weekly-count-badge");
      barFill = internalWrapper.querySelector(".weekly-progress-fill");
      captionEl = internalWrapper.querySelector(".weekly-barrier-caption");
      if (!captionEl) {
        const headerRow = internalWrapper.querySelector(".unified-progress-header");
        captionEl = (headerRow || internalWrapper).createDiv({ cls: "weekly-barrier-caption" });
      }
    }

    if (percentText) percentText.textContent = weekTotal > 0 ? `${weekPercentage}%` : "—";
    if (countBadge) {
      countBadge.textContent = weekTotal > 0 ? `(${weekCompleted}/${weekTotal})` : "";
      TooltipHelper.set(countBadge, weekTotal > 0
        ? this.plugin.translationManager.t("grid_completion_count", { done: weekCompleted, total: weekTotal })
        : null);
    }
    const weekStart = this.context.getWeekStart();
    const isCurrentWeek = !today.isBefore(weekStart, "day") &&
      !today.isAfter(weekStart.clone().add(6, "days"), "day");
    const progressLabel = internalWrapper.querySelector(".progress-label");
    if (progressLabel) progressLabel.textContent = this.plugin.translationManager.t(
      weekTotal > 0
        ? (isCurrentWeek ? "grid_completion_rate_to_date" : "grid_completion_rate")
        : "grid_no_counted_habits"
    );

    if (barFill) {
      barFill.style.width = `${weekPercentage}%`;
      barFill.className = "weekly-progress-fill";
      if (weekPercentage >= 90) barFill.addClass("progress-excellent");
      else if (weekPercentage >= 70) barFill.addClass("progress-good");
      else if (weekPercentage >= 50) barFill.addClass("progress-medium");
      else barFill.addClass("progress-low");
    }

    const elapsedDays = Math.max(0, Math.min(7, today.diff(weekStart, "days") + 1));
    const token = this.context.getRenderToken?.();
    const lastWeekRate = weekTotal > 0 && elapsedDays > 0
      ? await this.calculateLastWeekRateAsync(elapsedDays)
      : null;
    if (this.context.isClosed?.() || (token !== undefined && token !== this.context.getRenderToken?.())) return;
    if (captionEl) {
      captionEl.className = "weekly-barrier-caption";
      captionEl.empty();
      if (lastWeekRate === null) {
        captionEl.style.display = "none";
      } else {
        captionEl.style.display = "";
        const difference = weekPercentage - lastWeekRate;
        const state = difference > 0 ? "ahead" : difference < 0 ? "behind" : "level";
        captionEl.addClass(`state-${state}`);
        const comparisonKey = state === "ahead" ? "grid_completion_ahead"
          : state === "behind" ? "grid_completion_behind" : "grid_completion_level";
        captionEl.createSpan({
          cls: "weekly-comparison-status",
          text: this.plugin.translationManager.t(comparisonKey, { points: Math.abs(difference) })
        });
        captionEl.createSpan({
          cls: "weekly-comparison-baseline",
          text: this.plugin.translationManager.t(
            isCurrentWeek ? "grid_previous_same_days" : "grid_previous_full_week",
            { lastRate: lastWeekRate }
          )
        });
      }
    }
  }
}
