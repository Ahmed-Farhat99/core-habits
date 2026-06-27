import { StreakCalculator } from '../services/StreakCalculator.js';

export class StreakStatsComponent {
  constructor(plugin, existingHabit) {
    this.plugin = plugin;
    this.existingHabit = existingHabit;
  }

  render(container) {
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const getDaysUnit = (count) => {
      const lang = this.plugin.settings.language || "ar";
      if (lang === "ar") {
        if (count === 1) return t("stats_days_one");
        if (count === 2) return t("stats_days_two");
        if (count >= 3 && count <= 10) return t("stats_days_few");
        return t("stats_days_many");
      } else {
        return count === 1 ? t("stats_days_one") : t("stats_days_other");
      }
    };

    const statsContainer = container.createDiv({ cls: "dh-card streak-stats-compact" });
    const badgesRow = statsContainer.createDiv({ cls: "streak-badges-row" });
    const detailsContainer = statsContainer.createDiv({ cls: "streak-details-container" });

    const line1 = badgesRow.createDiv({ cls: "streak-compact-line" });
    line1.textContent = t("stats_calculating");

    this.plugin._sharedStreakCache = this.plugin._sharedStreakCache || new Map();
    const calculator = new StreakCalculator(this.plugin, this.plugin._sharedStreakCache);
    calculator.calculate(this.existingHabit).then(({ currentStreak, longestStreak, firstCompletionDate, consistencyScore, consistencyCompleted, consistencyScheduled, recoveryScore, ongoingGapLength }) => {
      badgesRow.empty();

      const longestText = longestStreak > 0 ? `${longestStreak} ${getDaysUnit(longestStreak)}` : t("stats_none");
      const currentText = currentStreak > 0 ? `${currentStreak} ${getDaysUnit(currentStreak)}` : t("stats_none");

      const longestBadge = badgesRow.createDiv({ cls: "streak-badge streak-badge-longest" });
      longestBadge.createSpan({ cls: "streak-badge-icon", text: "🏆" });
      longestBadge.createSpan({ cls: "streak-badge-label", text: t("stats_longest_label") });
      longestBadge.createSpan({ cls: "streak-badge-value", text: longestText });

      const currentBadge = badgesRow.createDiv({ cls: "streak-badge streak-badge-current" });
      currentBadge.createSpan({ cls: "streak-badge-icon", text: "🔥" });
      currentBadge.createSpan({ cls: "streak-badge-label", text: t("stats_current_label") });
      currentBadge.createSpan({ cls: "streak-badge-value", text: currentText });

      if (firstCompletionDate) {
        const line2 = detailsContainer.createDiv({ cls: "streak-detail-item" });
        line2.createSpan({ cls: "streak-detail-icon", text: "📅" });
        const lang = this.plugin.settings.language || "ar";
        const dateFormatStr = lang === "ar" ? "D MMMM YYYY" : "D MMM YYYY";
        const dateStr = firstCompletionDate.clone().locale(lang).format(dateFormatStr);
        const daysSince = window.moment().diff(firstCompletionDate, "days");
        const daysUnit = getDaysUnit(daysSince);
        line2.createSpan({ cls: "streak-detail-label", text: t("stats_first_completion") });
        line2.createSpan({ cls: "streak-detail-value", text: `${dateStr}` });
        line2.createSpan({ cls: "streak-detail-sub", text: t("stats_days_ago", { count: daysSince, unit: daysUnit }) });
      }

      if (consistencyScore !== null) {
        const line3 = detailsContainer.createDiv({ cls: "streak-detail-item" });
        line3.createSpan({ cls: "streak-detail-icon", text: "📈" });
        line3.createSpan({ cls: "streak-detail-label", text: t("stats_consistency") });
        line3.createSpan({ cls: "streak-detail-value", text: `${consistencyCompleted}/${consistencyScheduled}` });

        const pctCls = consistencyScore >= 80 ? "excellent" : consistencyScore >= 60 ? "good" : consistencyScore >= 40 ? "fair" : "low";
        line3.createSpan({ cls: `streak-detail-pct ${pctCls}`, text: `${consistencyScore}%` });
        line3.createSpan({ cls: "streak-detail-sub", text: t("stats_last_30_days") });
      }

      if (recoveryScore !== null) {
        const rRate = Math.round(recoveryScore * 10) / 10;
        const rateRounded = Math.round(recoveryScore);
        const line4 = detailsContainer.createDiv({ cls: "streak-detail-item dh-recovery-row" });
        line4.title = t("stats_recovery_tooltip");
        line4.createSpan({ cls: "streak-detail-icon", text: "⏱️" });
        line4.createSpan({ cls: "streak-detail-label", text: t("stats_recovery_speed") });

        let rateText = t("stats_recovery_avg", { days: rRate });
        let decisionMsg;
        let rateCls;

        if (ongoingGapLength > rateRounded + 0.5 && ongoingGapLength >= 2) {
          rateCls = "low";
          decisionMsg = t("stats_recovery_behind", { days: rRate });
        } else if (rateRounded <= 1.5) {
          rateCls = "excellent";
          decisionMsg = t("stats_recovery_resilience");
        } else if (rateRounded <= 2.5) {
          rateCls = "good";
          decisionMsg = t("stats_recovery_good");
        } else {
          rateCls = "low";
          decisionMsg = t("stats_recovery_simplify");
        }

        line4.createSpan({ cls: `streak-detail-pct ${rateCls}`, text: rateText });
        line4.createSpan({ cls: "streak-detail-sub dh-recovery-sub", text: `(${decisionMsg})` });
      } else if (ongoingGapLength > 1) {
        // Fallback when no past gaps exist but they are failing now
        const line5 = detailsContainer.createDiv({ cls: "streak-detail-item dh-recovery-row" });
        line5.createSpan({ cls: "streak-detail-icon", text: "⚠️" });
        line5.createSpan({ cls: "streak-detail-label", text: t("stats_leak_alert") });
        line5.createSpan({ cls: `streak-detail-pct low`, text: t("stats_leak_days", { count: ongoingGapLength }) });
        line5.createSpan({ cls: "streak-detail-sub dh-recovery-sub", text: t("stats_leak_simplify") });
      }
    }).catch((e) => {
      console.error("[Core Habits] Error loading stats:", e);
      badgesRow.empty();
      const lineErr = badgesRow.createDiv({ cls: "streak-compact-line" });
      lineErr.textContent = t("stats_error_loading");
    });
  }
}
