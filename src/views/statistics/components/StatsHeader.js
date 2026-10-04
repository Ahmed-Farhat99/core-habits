import { setIcon, Menu } from 'obsidian';
import { TooltipHelper } from '../../../utils/TooltipHelper.js';
import { PERIOD_TYPES } from '../../../domain/stats/StatsPeriod.js';
import { CustomRangeModal } from '../../../modals/CustomRangeModal.js';
import { DateUtils, showAnchoredMenu } from '../../../utils/helpers.js';

export class StatsHeader {
  /**
   * @param {Object} context
   * @param {Function} onPeriodChange - (newPeriod) => void
   * @param {Function} onRefresh - () => void
   */
  constructor(context, onPeriodChange, onRefresh) {
    this.context = context;
    this.plugin = context.plugin;
    this.app = context.app;
    this.onPeriodChange = onPeriodChange;
    this.onRefresh = onRefresh;
  }

  render(container, currentPeriod) {
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const isAr = this.context.isAr ? this.context.isAr() : (this.plugin.settings?.language === "ar");
    const dir = isAr ? "rtl" : "ltr";

    const headerEl = container.createDiv({ cls: "dh-stats-minimal-header" });

    // Single unified row
    const row = headerEl.createDiv({ cls: "dh-stats-header-row" });

    // Nav Cluster (Prev, Selector, Next)
    const navCluster = row.createDiv({ cls: "dh-stats-nav-cluster" });

    const canStep = currentPeriod.supportsStepping();
    const prevIcon = dir === "rtl" ? "chevron-right" : "chevron-left";
    const nextIcon = dir === "rtl" ? "chevron-left" : "chevron-right";

    // Previous Arrow (Only for calendar periods: week, month, year)
    if (canStep) {
      const prevBtn = navCluster.createEl("button", {
        cls: "dh-nav-arrow-btn",
        attr: { type: "button" }
      });
      TooltipHelper.set(prevBtn, this._getStepTooltip(currentPeriod, -1, isAr, t));
      setIcon(prevBtn, prevIcon);
      prevBtn.onclick = () => {
        this.onPeriodChange(currentPeriod.shift(-1));
      };
    }

    // Title Block: Period Selector Dropdown Button + Dates Subtitle
    const titleBlock = navCluster.createDiv({ cls: "dh-stats-title-block" });

    // Center Period Selector Dropdown Button
    const periodBtn = titleBlock.createEl("button", {
      cls: "dh-btn dh-stats-period-select-btn",
      attr: { type: "button" }
    });
    TooltipHelper.set(periodBtn, t("period_menu_title"));
    periodBtn.createSpan({
      cls: "period-btn-label",
      text: currentPeriod.getPeriodName(isAr),
    });
    const chevronIcon = periodBtn.createSpan({ cls: "period-btn-chevron" });
    setIcon(chevronIcon, "chevron-down");

    periodBtn.onclick = () => {
      const menu = new Menu();

      const options = [
        { id: PERIOD_TYPES.LAST_7_DAYS, label: t("stats_preset_last_7_days") || (isAr ? "آخر 7 أيام" : "Last 7 Days") },
        { id: PERIOD_TYPES.LAST_28_DAYS, label: t("stats_preset_last_28_days") || (isAr ? "آخر 28 يوماً (4 أسابيع)" : "Last 28 Days (4 Weeks)") },
        { id: PERIOD_TYPES.LAST_12_WEEKS, label: t("stats_preset_last_12_weeks") || (isAr ? "آخر 12 أسبوعاً (84 يوماً)" : "Last 12 Weeks (84 Days)") },
        { id: PERIOD_TYPES.THIS_YEAR, label: t("stats_preset_this_year") || (isAr ? "هذا العام" : "This Year") },
      ];

      options.forEach(opt => {
        menu.addItem(item => {
          item.setTitle(opt.label)
            .setChecked(currentPeriod.type === opt.id)
            .onClick(() => {
              this.onPeriodChange(new currentPeriod.constructor(opt.id, {
                weekStartDay: this.plugin.settings?.weekStartDay,
              }));
            });
        });
      });

      menu.addSeparator();

      menu.addItem(item => {
        item.setTitle(t("stats_preset_custom") || (isAr ? "فترة مخصصة..." : "Custom Range..."))
          .setIcon("sliders")
          .setChecked(currentPeriod.type === PERIOD_TYPES.CUSTOM)
          .onClick(() => {
            new CustomRangeModal(
              this.app,
              this.plugin,
              currentPeriod.startDate,
              currentPeriod.endDate,
              (startDate, endDate) => {
                this.onPeriodChange(new currentPeriod.constructor(PERIOD_TYPES.CUSTOM, {
                  customStartDate: startDate,
                  customEndDate: endDate,
                  weekStartDay: this.plugin.settings?.weekStartDay,
                }));
              }
            ).open();
          });
      });

      showAnchoredMenu(menu, periodBtn, dir === "rtl");
    };

    // Subtitle Row: Gregorian Date Range + Hijri Date
    const datesRow = titleBlock.createDiv({ cls: "dh-stats-header-dates-row" });
    const gregText = currentPeriod.getDateRangeString(isAr);
    datesRow.createEl("bdi", { cls: "dh-stats-greg-text", text: gregText });

    const showHijri = this.plugin.settings?.showHijriDate !== false;
    if (showHijri) {
      const nominalEnd = currentPeriod.nominalEndDate || currentPeriod.endDate;
      const hijriText = this._formatHijriRange(currentPeriod.startDate, nominalEnd, isAr);
      if (hijriText) {
        datesRow.createEl("bdi", { cls: "dh-stats-hijri-text", text: hijriText });
      }
    }

    // Next Arrow (Only for calendar periods when viewing historical data: offset < 0)
    if (canStep && currentPeriod.offset < 0) {
      const nextBtn = navCluster.createEl("button", {
        cls: "dh-nav-arrow-btn",
        attr: { type: "button" }
      });
      TooltipHelper.set(nextBtn, this._getStepTooltip(currentPeriod, 1, isAr, t));
      setIcon(nextBtn, nextIcon);
      nextBtn.onclick = () => {
        this.onPeriodChange(currentPeriod.shift(1));
      };
    }

    // Actions Group (Today Jump + Refresh)
    const actionsGroup = row.createDiv({ cls: "dh-stats-header-actions" });

    // "Today" button if viewing historical offset
    if (currentPeriod.offset !== 0) {
      const todayBtn = actionsGroup.createEl("button", {
        cls: "dh-btn mod-pill-sm",
        text: t("stats_btn_today"),
        attr: { type: "button" }
      });
      todayBtn.onclick = () => {
        this.onPeriodChange(currentPeriod.resetToCurrent());
      };
    }

    // Refresh Button
    const refreshBtn = actionsGroup.createEl("button", {
      cls: "dh-icon-btn",
      attr: { type: "button" }
    });
    TooltipHelper.set(refreshBtn, t("stats_btn_refresh"));
    setIcon(refreshBtn, "refresh-cw");
    refreshBtn.onclick = () => {
      this.onRefresh();
    };

    return headerEl;
  }

  _getStepTooltip(period, delta, isAr, t) {
    if (period.type === PERIOD_TYPES.LAST_7_DAYS) {
      return delta < 0
        ? (t("stats_prev_week") || (isAr ? "الأسبوع السابق" : "Previous week"))
        : (t("stats_next_week") || (isAr ? "الأسبوع التالي" : "Next week"));
    }
    if (period.type === PERIOD_TYPES.LAST_28_DAYS) {
      return delta < 0
        ? (t("stats_prev_cycle") || (isAr ? "الدورة السابقة (4 أسابيع)" : "Previous Cycle (4 Weeks)"))
        : (t("stats_next_cycle") || (isAr ? "الدورة التالية (4 أسابيع)" : "Next Cycle (4 Weeks)"));
    }
    if (period.type === PERIOD_TYPES.LAST_12_WEEKS) {
      return delta < 0
        ? (t("stats_prev_quarter") || (isAr ? "الفترة السابقة (12 أسبوعاً)" : "Previous 12 Weeks"))
        : (t("stats_next_quarter") || (isAr ? "الفترة التالية (12 أسبوعاً)" : "Next 12 Weeks"));
    }
    if (period.type === PERIOD_TYPES.THIS_YEAR) {
      return delta < 0
        ? (t("stats_prev_year") || (isAr ? "العام السابق" : "Previous year"))
        : (t("stats_next_year") || (isAr ? "العام التالي" : "Next year"));
    }
    return delta < 0 ? (t("previous") || "Previous") : (t("next") || "Next");
  }

  _formatHijriRange(startDate, endDate, isAr) {
    try {
      const hStart = DateUtils.getHijriDate(startDate, isAr);
      const hEnd = DateUtils.getHijriDate(endDate, isAr);
      if (!hStart || !hEnd || hStart === "-" || hEnd === "-") return null;

      const cleanStart = hStart.replace(/[,،]?\s*\d{4}\s*(?:هـ|AH)?$/i, "").trim();
      const cleanEnd = hEnd.replace(/[,،]?\s*\d{4}\s*(?:هـ|AH)?$/i, "").trim();
      const yearMatch = hEnd.match(/\d{4}\s*(?:هـ|AH)?$/i);
      const yearStr = yearMatch ? yearMatch[0] : "";

      if (cleanStart === cleanEnd) {
        return `${cleanEnd} ${yearStr}`.trim();
      }

      // Check if both dates share the same month e.g. "23 ربيع الأول" and "29 ربيع الأول"
      const startParts = cleanStart.split(" ");
      const endParts = cleanEnd.split(" ");
      if (startParts.length > 1 && endParts.length > 1) {
        const startDay = startParts[0];
        const startMonth = startParts.slice(1).join(" ");
        const endMonth = endParts.slice(1).join(" ");
        if (startMonth === endMonth) {
          return `${startDay} – ${cleanEnd} ${yearStr}`.trim();
        }
      }

      return `${cleanStart} – ${cleanEnd} ${yearStr}`.trim();
    } catch {
      return null;
    }
  }
}
