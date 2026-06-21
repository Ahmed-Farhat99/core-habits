import { StreakCalculator } from '../services/StreakCalculator.js';

export class StreakStatsComponent {
  constructor(plugin, existingHabit) {
    this.plugin = plugin;
    this.existingHabit = existingHabit;
  }

  render(container) {
    const isAr = this.plugin.settings.language === "ar";
    const statsContainer = container.createDiv({ cls: "streak-stats-compact" });
    const badgesRow = statsContainer.createDiv({ cls: "streak-badges-row" });
    const detailsContainer = statsContainer.createDiv({ cls: "streak-details-container" });

    const line1 = badgesRow.createDiv({ cls: "streak-compact-line" });
    line1.textContent = isAr ? "جاري الحساب..." : "Calculating...";

    this.plugin._sharedStreakCache = this.plugin._sharedStreakCache || new Map();
    const calculator = new StreakCalculator(this.plugin, this.plugin._sharedStreakCache);
    calculator.calculate(this.existingHabit).then(({ currentStreak, longestStreak, firstCompletionDate, consistencyScore, consistencyCompleted, consistencyScheduled, recoveryScore, ongoingGapLength }) => {
      badgesRow.empty();

      const streakWordAr = (n) => n === 1 ? "يوم" : n === 2 ? "يومين" : n <= 10 ? "أيام" : "يوماً";
      const longestText = longestStreak > 0 ? `${longestStreak} ${isAr ? streakWordAr(longestStreak) : "days"}` : (isAr ? "لا يوجد" : "None");
      const currentText = currentStreak > 0 ? `${currentStreak} ${isAr ? streakWordAr(currentStreak) : "days"}` : (isAr ? "لا يوجد" : "None");

      const longestBadge = badgesRow.createDiv({ cls: "streak-badge streak-badge-longest" });
      longestBadge.createSpan({ cls: "streak-badge-icon", text: "🏆" });
      longestBadge.createSpan({ cls: "streak-badge-label", text: isAr ? "أطول سلسلة:" : "Longest:" });
      longestBadge.createSpan({ cls: "streak-badge-value", text: longestText });

      const currentBadge = badgesRow.createDiv({ cls: "streak-badge streak-badge-current" });
      currentBadge.createSpan({ cls: "streak-badge-icon", text: "🔥" });
      currentBadge.createSpan({ cls: "streak-badge-label", text: isAr ? "السلسلة الحالية:" : "Current:" });
      currentBadge.createSpan({ cls: "streak-badge-value", text: currentText });

      if (firstCompletionDate) {
        const line2 = detailsContainer.createDiv({ cls: "streak-detail-item" });
        line2.createSpan({ cls: "streak-detail-icon", text: "📅" });
        const dateStr = firstCompletionDate.locale(isAr ? "ar" : "en").format(isAr ? "D MMMM YYYY" : "D MMM YYYY");
        const daysSince = window.moment().diff(firstCompletionDate, "days");
        const dWord = isAr ? streakWordAr(daysSince) : (daysSince === 1 ? "day" : "days");
        line2.createSpan({ cls: "streak-detail-label", text: isAr ? "أول إنجاز" : "First completion" });
        line2.createSpan({ cls: "streak-detail-value", text: `${dateStr}` });
        line2.createSpan({ cls: "streak-detail-sub", text: `(${isAr ? "مضى " : ""}${daysSince} ${dWord})` });
      }

      if (consistencyScore !== null) {
        const line3 = detailsContainer.createDiv({ cls: "streak-detail-item" });
        line3.createSpan({ cls: "streak-detail-icon", text: "📈" });
        line3.createSpan({ cls: "streak-detail-label", text: isAr ? "الالتزام" : "Consistency" });
        line3.createSpan({ cls: "streak-detail-value", text: `${consistencyCompleted}/${consistencyScheduled}` });

        const pctCls = consistencyScore >= 80 ? "excellent" : consistencyScore >= 60 ? "good" : consistencyScore >= 40 ? "fair" : "low";
        line3.createSpan({ cls: `streak-detail-pct ${pctCls}`, text: `${consistencyScore}%` });
        line3.createSpan({ cls: "streak-detail-sub", text: isAr ? "(آخر 30 يوماً)" : "(30 days)" });
      }

      if (recoveryScore !== null) {
        const rRate = Math.round(recoveryScore * 10) / 10;
        const rateRounded = Math.round(recoveryScore);
        const line4 = detailsContainer.createDiv({ cls: "streak-detail-item dh-recovery-row" });
        line4.title = isAr ? "كلما قل هذا الرقم، كلما كنت أسرع في العودة بعد الانقطاع" : "Lower number means faster recovery after missing a habit";
        line4.createSpan({ cls: "streak-detail-icon", text: "⏱️" });
        line4.createSpan({ cls: "streak-detail-label", text: isAr ? "سرعة التعافي" : "Recovery Speed" });

        let rateText = isAr ? `تعود للعادة خلال ${rRate} يوم في المتوسط` : `Returns in ${rRate} days on avg`;
        let decisionMsg;
        let rateCls;

        if (ongoingGapLength > rateRounded + 0.5 && ongoingGapLength >= 2) {
          rateCls = "low";
          decisionMsg = isAr ? `متأخر عن المعتاد (${rRate}يوم).. بسّط وعد اليوم!` : `Behind average (${rRate}d). Simplify & recover!`;
        } else if (rateRounded <= 1.5) {
          rateCls = "excellent";
          decisionMsg = isAr ? "مرونة عالية - بطل التعافي!" : "High resilience champ!";
        } else if (rateRounded <= 2.5) {
          rateCls = "good";
          decisionMsg = isAr ? "تعافي جيد غالباً" : "Good recovery speed";
        } else {
          rateCls = "low";
          decisionMsg = isAr ? "قرار: بسّط العادة فور السقوط" : "Decision: Simplify post-fail";
        }

        line4.createSpan({ cls: `streak-detail-pct ${rateCls}`, text: rateText });
        line4.createSpan({ cls: "streak-detail-sub dh-recovery-sub", text: `(${decisionMsg})` });
      } else if (ongoingGapLength > 1) {
        // Fallback when no past gaps exist but they are failing now
        const line5 = detailsContainer.createDiv({ cls: "streak-detail-item dh-recovery-row" });
        line5.createSpan({ cls: "streak-detail-icon", text: "⚠️" });
        line5.createSpan({ cls: "streak-detail-label", text: isAr ? "تنبيه تسريب" : "Leak Alert" });
        line5.createSpan({ cls: `streak-detail-pct low`, text: isAr ? `${ongoingGapLength} أيام` : `${ongoingGapLength} days` });
        line5.createSpan({ cls: "streak-detail-sub dh-recovery-sub", text: isAr ? "(بسّط العادة لإيقاف النزيف!)" : "(Simplify habit to stop the leak!)" });
      }
    }).catch((e) => {
      console.error("[Core Habits] Error loading stats:", e);
      badgesRow.empty();
      const lineErr = badgesRow.createDiv({ cls: "streak-compact-line" });
      lineErr.textContent = isAr ? "خطأ في جلب الإحصائيات" : "Error loading stats";
    });
  }
}
