import { TooltipHelper } from '../../../utils/TooltipHelper.js';

/**
 * StatsTrendChart — Horizontal Milestone Flow Cards (شرائح الزخم الأفقية).
 *
 * Modern, mobile-first replacement for cramped vertical column charts.
 * Presents each milestone (week, day, or month) as an informative horizontal card with:
 * - Milestone title & "(الحالي)" badge for active period
 * - Explicit date bounds (<bdi>D MMM – D MMM</bdi>)
 * - Direct percentage + completion fraction (e.g. "24 من 28 عادة")
 * - Sleek, full-width progress track
 */
export class StatsTrendChart {
  constructor(context) {
    this.context = context;
    this.plugin = context.plugin;
  }

  render(container, metrics) {
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const buckets = (metrics.trajectoryBuckets || []).filter(bucket => !bucket.isFuture);

    if (buckets.length === 0) {
      return null;
    }

    const isAr = this.context.isAr ? this.context.isAr() : (this.plugin.settings?.language === "ar");
    const section = container.createDiv({ cls: "dh-stats-trend-section" });

    // Section header
    const headerRow = section.createDiv({ cls: "dh-trend-header" });
    headerRow.createSpan({ cls: "dh-trend-title", text: t("stats_trend_title") });

    let subKey = "stats_trend_sub_daily";
    if (metrics.trajectoryGrain === "weekly") {
      subKey = "stats_trend_sub_weekly";
    } else if (metrics.trajectoryGrain === "monthly") {
      subKey = "stats_trend_sub_monthly";
    }
    headerRow.createSpan({ cls: "dh-trend-subtitle", text: t(subKey) });

    // Horizontal Flow Cards Container
    const flowContainer = section.createDiv({ cls: "dh-trend-flow-container" });

    buckets.forEach((bucket) => {
      this._renderMilestoneCard(flowContainer, bucket, isAr, t);
    });

    return section;
  }

  _renderMilestoneCard(container, bucket, isAr, t) {
    const cardCls = [
      "dh-trend-flow-card",
      bucket.isToday ? "is-today" : "",
      bucket.isFuture ? "is-future" : "",
      !bucket.isFuture && bucket.scheduled > 0 ? this._getRateColorClass(bucket.rate) : "is-empty",
    ].filter(Boolean).join(" ");

    const card = container.createDiv({ cls: cardCls });

    const titleText = this._getTitle(bucket, isAr, t);
    const dateRangeText = this._getDateRange(bucket, isAr);

    // Tooltip for rich hover info
    const tooltipText = bucket.scheduled > 0
      ? `${titleText} (${dateRangeText}): ${bucket.completed}/${bucket.scheduled} (${bucket.rate}%)`
      : `${titleText} (${dateRangeText}): ${t("stats_no_counted_checkins")}`;
    TooltipHelper.set(card, tooltipText);

    // Top Row: Info (Left) + Metrics (Right)
    const headerRow = card.createDiv({ cls: "dh-flow-card-header" });

    // Info Column
    const infoCol = headerRow.createDiv({ cls: "dh-flow-card-info" });
    const titleLine = infoCol.createDiv({ cls: "dh-flow-title-line" });
    titleLine.createSpan({ cls: "dh-flow-title", text: titleText });

    if (bucket.isToday) {
      const activeBadgeText = t("stats_active_period_badge") || (isAr ? "الحالي" : "Active");
      titleLine.createSpan({ cls: "dh-flow-active-badge", text: activeBadgeText });
    }

    infoCol.createEl("bdi", { cls: "dh-flow-dates", text: dateRangeText });

    // Stats Column
    const statsCol = headerRow.createDiv({ cls: "dh-flow-card-stats" });

    if (bucket.isFuture || bucket.scheduled === 0) {
      statsCol.createSpan({ cls: "dh-flow-rate is-empty", text: "—" });
      if (!bucket.isFuture) statsCol.createSpan({ cls: "dh-flow-count is-empty", text: t("stats_no_counted_checkins") });
    } else {
      statsCol.createSpan({
        cls: `dh-flow-rate ${this._getRateColorClass(bucket.rate)}`,
        text: `${bucket.rate}%`,
      });

      if (bucket.scheduled > 0) {
        const countText = t("stats_habits_count_fraction", {
          completed: bucket.completed,
          total: bucket.scheduled,
        }) || (isAr ? `${bucket.completed} من ${bucket.scheduled} فرصة محتسبة` : `${bucket.completed} of ${bucket.scheduled} counted check-ins`);

        statsCol.createSpan({ cls: "dh-flow-count", text: countText });
      } else {
        statsCol.createSpan({ cls: "dh-flow-count is-empty", text: "—" });
      }
    }

    // Bottom Row: Sleek Progress Bar Track & Fill
    const barWrap = card.createDiv({ cls: "dh-flow-bar-wrap" });
    const barTrack = barWrap.createDiv({ cls: "dh-flow-bar-track" });

    if (!bucket.isFuture && (bucket.rate > 0 || bucket.scheduled > 0)) {
      const fillPercent = Math.min(100, Math.max(0, bucket.rate));
      const barFill = barTrack.createDiv({
        cls: `dh-flow-bar-fill ${this._getRateColorClass(bucket.rate)}`,
      });
      barFill.style.width = `${fillPercent}%`;
    }
  }

  _getTitle(bucket, isAr, t) {
    if (bucket.weekIndex) {
      return t("stats_week_label", { n: bucket.weekIndex }) || (isAr ? `الأسبوع ${bucket.weekIndex}` : `Week ${bucket.weekIndex}`);
    }

    if (bucket.dayKey) {
      return t(bucket.dayKey) || bucket.label;
    }

    if (typeof bucket.monthIndex === "number") {
      if (isAr) {
        const arMonths = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
        return arMonths[bucket.monthIndex] || bucket.label;
      }
      const enMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      return enMonths[bucket.monthIndex] || bucket.label;
    }

    return bucket.label || "";
  }

  _getDateRange(bucket, isAr) {
    const locale = isAr ? "ar" : "en";
    if (bucket.startDate && bucket.endDate) {
      const s = bucket.startDate.clone().locale(locale).format("D MMM");
      const e = bucket.endDate.clone().locale(locale).format("D MMM");
      return `${s} – ${e}`;
    }

    if (bucket.date && typeof bucket.date.format === "function") {
      return bucket.date.clone().locale(locale).format("D MMMM");
    }

    return bucket.label || "";
  }

  _getRateColorClass(rate) {
    if (rate >= 75) return "is-high";
    if (rate >= 40) return "is-mid";
    return "is-low";
  }
}
