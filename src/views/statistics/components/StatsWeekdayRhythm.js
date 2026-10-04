/**
 * StatsWeekdayRhythm — Heatmap of performance by day of week.
 *
 * Shows full Arabic day names without ugly truncations (e.g. "الـ...").
 * Automatically adapts on narrow sidebars/mobile to wrap into comfortable rows.
 * Highlights peak and low days. Hidden when period is a single week or insufficient sample (< 14 days).
 */
import { DAY_KEYS } from '../../../constants.js';
import { TooltipHelper } from '../../../utils/TooltipHelper.js';
import { PERIOD_TYPES } from '../../../domain/stats/StatsPeriod.js';

export class StatsWeekdayRhythm {
  constructor(context) {
    this.context = context;
    this.plugin = context.plugin;
  }

  render(container, metrics, period = null) {
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const isAr = this.context.isAr ? this.context.isAr() : (this.plugin.settings?.language === "ar");
    const rhythm = metrics.weekdayRhythm || [];

    // Hide for 7-day period or insufficient sample (< 14 days) to prevent redundant duplicate 7-day views
    if (period?.type === PERIOD_TYPES.LAST_7_DAYS || metrics.measuredDaysCount < 14 || rhythm.length === 0) {
      return null;
    }

    // Check if any day has scheduled data
    const hasData = rhythm.some(w => w.scheduled > 0);
    if (!hasData) {
      return null;
    }

    const section = container.createDiv({ cls: "dh-stats-rhythm-section" });

    // Adaptive header based on period
    const header = section.createDiv({ cls: "dh-rhythm-header" });
    const isYear = period?.type === PERIOD_TYPES.THIS_YEAR;
    const titleText = isYear
      ? (t("stats_rhythm_year_title") || (isAr ? "نمط أيام الأسبوع عبر العام" : "Weekday Rhythm (Across the Year)"))
      : (t("stats_rhythm_title") || (isAr ? "توزيع الإنجاز حسب أيام الأسبوع" : "Performance by Weekday"));
    header.createDiv({ cls: "dh-rhythm-title", text: titleText });

    // High-signal highlight pill: Peak day vs Low day
    const peakDay = rhythm.find(w => w.isPeak);
    const lowDay = rhythm.find(w => w.isLow);

    if (peakDay || lowDay) {
      const pillRow = header.createDiv({ cls: "dh-rhythm-pill-row" });

      if (peakDay) {
        const peakName = t(DAY_KEYS[peakDay.dayIndex]) || "";
        const peakPill = pillRow.createSpan({ cls: "dh-rhythm-pill is-peak" });
        peakPill.createSpan({ text: `🌟 ${t("stats_peak_day") || (isAr ? "أقوى يوم" : "Peak")}: ${peakName}` });
        peakPill.createSpan({ cls: "dh-pill-rate", text: `${peakDay.rate}%` });
      }

      if (lowDay && lowDay.dayIndex !== peakDay?.dayIndex) {
        const lowName = t(DAY_KEYS[lowDay.dayIndex]) || "";
        const lowPill = pillRow.createSpan({ cls: "dh-rhythm-pill is-low" });
        lowPill.createSpan({ text: `⚠️ ${t("stats_low_day") || (isAr ? "يحتاج تركيزاً" : "Needs focus")}: ${lowName}` });
        lowPill.createSpan({ cls: "dh-pill-rate", text: `${lowDay.rate}%` });
      }
    } else {
      header.createDiv({ cls: "dh-rhythm-desc", text: t("stats_rhythm_desc") });
    }

    // Heatmap grid (auto-responsive, wraps nicely in narrow sidebar)
    const grid = section.createDiv({ cls: "dh-rhythm-grid" });

    rhythm.forEach(dayStat => {
      // Use FULL Arabic day name, never truncate into "الـ..."
      const dayName = t(DAY_KEYS[dayStat.dayIndex]) || "";
      const hasScheduled = dayStat.scheduled > 0;

      const cell = grid.createDiv({
        cls: `dh-rhythm-cell ${this._getCellClass(dayStat)}`,
      });

      cell.createDiv({ cls: "dh-rhythm-day-name", text: dayName });

      if (hasScheduled) {
        cell.createDiv({ cls: "dh-rhythm-rate", text: `${dayStat.rate}%` });
      } else {
        cell.createDiv({ cls: "dh-rhythm-rate is-empty", text: "—" });
      }

      TooltipHelper.set(cell, hasScheduled
        ? `${dayName}: ${dayStat.completed}/${dayStat.scheduled} (${dayStat.rate}%)`
        : `${dayName}: —`);
    });

    return section;
  }

  _getCellClass(dayStat) {
    if (dayStat.scheduled === 0) return "is-empty";
    if (dayStat.isPeak) return "is-peak";
    if (dayStat.isLow) return "is-low-day";

    const rate = dayStat.rate;
    if (rate >= 80) return "is-high";
    if (rate >= 50) return "is-mid";
    if (rate >= 20) return "is-fair";
    return "is-weak";
  }
}
