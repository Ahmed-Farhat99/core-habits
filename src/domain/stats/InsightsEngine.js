import { DAY_KEYS } from '../../constants.js';

export class InsightsEngine {
  /**
   * Generates grounded, deterministic behavioral insights.
   * 
   * @param {Object} metrics - Computed metrics from MetricsCalculator.compute()
   * @param {Object} [options]
   * @param {boolean} [options.isAr=true]
   * @param {Function} [options.t] - Translation function
   */
  static generate(metrics, options = {}) {
    const isAr = options.isAr !== false;
    const t = options.t || ((k) => k);

    const translate = (key, params = {}) => {
      if (typeof options.t === "function") {
        const res = options.t(key, params);
        if (typeof res === "string" && res !== key) return res;
      }
      return null;
    };

    if (!metrics || !metrics.hasSufficientData) {
      return {
        primaryInsight: translate("insights_insufficient_data")
          || (isAr
            ? "البيانات المسجلة في هذه الفترة غير كافية بعد لتقديم تحليلات دقيقة."
            : "Not enough data recorded in this period to generate reliable insights."),
        secondaryInsights: [],
        recommendations: [],
      };
    }

    const {
      consistencyRate,
      delta,
      activeDaysCount,
      totalCompleted,
      weekdayRhythm = [],
      anchorHabits = [],
      needsAttentionHabits = [],
      bounceBackRate,
    } = metrics;

    // 1. Primary Hero Summary
    let primaryInsight;
    if (delta !== null) {
      if (delta >= 5) {
        primaryInsight = translate("insights_improving", { delta })
          || (isAr
            ? `معدل الإنجاز أعلى بـ ${delta} نقطة مئوية مقارنة بالفترة السابقة.`
            : `Completion rate is up ${delta} percentage points from the prior period.`);
      } else if (delta <= -5) {
        const absDelta = Math.abs(delta);
        primaryInsight = translate("insights_declining", { delta: absDelta })
          || (isAr
            ? `معدل الإنجاز أقل بـ ${absDelta} نقطة مئوية مقارنة بالفترة السابقة.`
            : `Completion rate is down ${absDelta} percentage points from the prior period.`);
      } else {
        primaryInsight = translate("insights_stable", { rate: consistencyRate })
          || (isAr
            ? `أداؤك مستقر ومقارب للفترة السابقة بنسبة إنجاز ${consistencyRate}%.`
            : `Your consistency is stable and comparable to the prior period at ${consistencyRate}%.`);
      }
    } else {
      primaryInsight = translate("insights_summary", { completed: totalCompleted, activeDays: activeDaysCount, rate: consistencyRate })
        || (isAr
          ? `حققت ${totalCompleted} إنجازاً عبر ${activeDaysCount} يوماً نشطاً بمعدل التزام عام ${consistencyRate}%.`
          : `Completed ${totalCompleted} check-ins across ${activeDaysCount} active days with a ${consistencyRate}% consistency rate.`);
    }

    const secondaryInsights = [];
    const recommendations = [];

    // 2. Anchor Habit Highlight
    if (anchorHabits.length > 0) {
      const top = anchorHabits[0];
      secondaryInsights.push({
        type: "anchor",
        icon: "shield-check",
        text: isAr
          ? `عادة «${top.name}» هي ركيزتك الأكثر ثباتاً في هذه الفترة بنسبة ${top.rate}%.`
          : `"${top.name}" is your strongest anchor habit this period with a ${top.rate}% completion rate.`,
      });
    }

    // 3. Needs Attention Diagnosis
    if (needsAttentionHabits.length > 0) {
      const lowest = needsAttentionHabits[0];
      secondaryInsights.push({
        type: "attention",
        icon: "alert-circle",
        text: isAr
          ? `عادة «${lowest.name}» تواجه تحدياً ملحوظاً بنسبة التزام ${lowest.rate}%.`
          : `"${lowest.name}" is struggling with a ${lowest.rate}% completion rate.`,
      });

      recommendations.push({
        habitId: lowest.id,
        habitName: lowest.name,
        tip: isAr
          ? `جرّب تقليل متطلبات «${lowest.name}» مؤقتاً أو ربطها بعادة صباحية ثابتة.`
          : `Consider scaling back requirements for "${lowest.name}" or stacking it onto an established routine.`,
      });
    }

    // 4. Weekday Rhythm Insight
    const peakDay = weekdayRhythm.find(w => w.isPeak);
    const lowDay = weekdayRhythm.find(w => w.isLow);

    if (peakDay && lowDay && peakDay.dayIndex !== lowDay.dayIndex) {
      const peakName = t(DAY_KEYS[peakDay.dayIndex]) || "";
      const lowName = t(DAY_KEYS[lowDay.dayIndex]) || "";

      secondaryInsights.push({
        type: "rhythm",
        icon: "calendar",
        text: isAr
          ? `يوم ${peakName} هو الأعلى إنتاجية بنسبة ${peakDay.rate}%، بينما يسجل يوم ${lowName} أدنى وتيرة (${lowDay.rate}%).`
          : `${peakName} is your peak day (${peakDay.rate}%), while ${lowName} records your lowest consistency (${lowDay.rate}%).`,
      });
    }

    // 5. Resilience / Bounce-Back
    if (bounceBackRate !== null && bounceBackRate >= 60) {
      secondaryInsights.push({
        type: "resilience",
        icon: "refresh-cw",
        text: isAr
          ? `مرونة التعافي ممتازة: تعود للإنجاز في اليوم التالي لتعثرك بنسبة ${bounceBackRate}%.`
          : `Strong rebound discipline: you recover from stumble days on the very next day ${bounceBackRate}% of the time.`,
      });
    }

    return {
      primaryInsight,
      secondaryInsights,
      recommendations,
    };
  }
}
