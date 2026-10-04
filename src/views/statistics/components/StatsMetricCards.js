import { TooltipHelper } from '../../../utils/TooltipHelper.js';

/**
 * StatsMetricCards — Sleek 3-Metric Summary Strip.
 *
 * Provides a high-clarity aggregate summary answering 3 concrete user questions:
 * 1. Completed scheduled check-ins.
 * 2. Calendar days with at least one completion.
 * 3. Longest run of consecutive days with a completion.
 */
export class StatsMetricCards {
  constructor(context) {
    this.context = context;
    this.plugin = context.plugin;
  }

  render(container, metrics) {
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const isAr = this.context.isAr ? this.context.isAr() : (this.plugin.settings?.language === "ar");

    const strip = container.createDiv({ cls: "dh-stats-summary-strip" });

    // Metric 1: Total Completed Check-ins
    const totalCompleted = metrics.totalCompleted ?? 0;
    const totalScheduled = metrics.totalScheduled ?? 0;
    const scheduledUnit = totalScheduled > 0
      ? (t("stats_scheduled_of_total", { total: totalScheduled }) || (isAr ? `من ${totalScheduled}` : `of ${totalScheduled}`))
      : "—";

    this._renderMetricItem(strip, {
      id: "completed",
      label: t("stats_metric_total_completed") || (isAr ? "مرات الإنجاز" : "Completed check-ins"),
      value: `${totalCompleted}`,
      unit: scheduledUnit,
      tooltip: `${totalCompleted} / ${totalScheduled}`,
    });

    // Metric 2: Active Days Attendance
    const activeDays = metrics.activeDaysCount ?? 0;
    const measuredDays = metrics.measuredDaysCount ?? 0;
    const activeSub = t("stats_active_days_period", { total: measuredDays })
      || (isAr ? `من ${measuredDays} يومًا في الفترة` : `of ${measuredDays} calendar days`);

    this._renderMetricItem(strip, {
      id: "active-days",
      label: t("stats_metric_active_days") || (isAr ? "أيام بها إنجاز" : "Days with a completion"),
      value: `${activeDays}`,
      unit: activeSub,
      tooltip: t("stats_active_days_tooltip", { active: activeDays, total: measuredDays })
        || (isAr ? `سجلت نشاطاً في ${activeDays} من أصل ${measuredDays} أيام` : `Active on ${activeDays} of ${measuredDays} days`),
    });

    // Metric 3: Longest Streak in Period
    const streak = metrics.periodStreak ?? 0;
    const streakUnit = this._formatStreakUnit(streak, isAr);

    this._renderMetricItem(strip, {
      id: "streak",
      label: t("stats_metric_period_streak") || (isAr ? "أطول سلسلة في الفترة" : "Longest run in period"),
      value: `${streak}`,
      unit: streakUnit,
      tooltip: t("stats_metric_streak_tooltip", { count: streak })
        || (isAr ? `أطول سلسلة أيام متتالية: ${streak}` : `Longest consecutive active streak: ${streak}`),
    });

    return strip;
  }

  _formatStreakUnit(streak, isAr) {
    if (!isAr) return streak === 1 ? "day streak" : "days in a row";
    if (streak === 0) return "لا يوجد تتابع";
    if (streak === 1) return "يوم متواصل";
    if (streak === 2) return "يومان متتاليان";
    if (streak >= 3 && streak <= 10) return "أيام متتالية";
    return "يوماً متتالياً";
  }

  _renderMetricItem(container, { id, label, value, unit, tooltip }) {
    const item = container.createDiv({ cls: `dh-summary-item dh-summary-item-${id}` });
    if (tooltip) {
      TooltipHelper.set(item, tooltip);
    }

    const valEl = item.createDiv({ cls: "dh-summary-value" });
    valEl.createEl("bdi", { cls: "dh-summary-value-text", text: value });

    item.createDiv({ cls: "dh-summary-label", text: label });
    if (unit) {
      item.createDiv({ cls: "dh-summary-unit", text: unit });
    }

    return item;
  }
}
