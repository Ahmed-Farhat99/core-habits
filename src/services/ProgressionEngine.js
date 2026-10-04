/**
 * ProgressionEngine.js
 * Automatic habit milestone and progression calculation engine.
 * 
 * BEHAVIORAL MODEL (Active Momentum):
 * - Earned milestones are permanently honored ("highest achieved milestone").
 * - Progress toward the NEXT milestone requires active currentStreak momentum.
 * - If the user breaks their streak (currentStreak = 0), the countdown to the 
 *   next milestone shows the full requirement, not a stale historical value.
 * - Terminology is unified: "المحطات" (Milestones), not "مستوى/مرحلة".
 */

import { getDaysUnit } from '../utils/helpers.js';

export const MILESTONES = [
  { level: 1, key: "seed", targetDays: 3, nameAr: "البذرة", nameEn: "Seed", shortNameAr: "البذرة", shortNameEn: "Seed", descAr: "كسر حاجز البداية وتثبيت الفعل", descEn: "Overcoming inertia and initiating action" },
  { level: 2, key: "stability", targetDays: 7, nameAr: "التثبيت", nameEn: "Stability", shortNameAr: "التثبيت", shortNameEn: "Stability", descAr: "تأكيد الموعد لتصبح جزءاً من الروتين", descEn: "Anchoring into a steady routine" },
  { level: 3, key: "habituation", targetDays: 21, nameAr: "التمكن", nameEn: "Habituation", shortNameAr: "التمكن", shortNameEn: "Habituation", descAr: "بناء المسار العصبي التلقائي للعادة", descEn: "Forging automatic neural habit loops" },
  { level: 4, key: "firmness", targetDays: 90, nameAr: "الرسوخ", nameEn: "Firmness", shortNameAr: "الرسوخ", shortNameEn: "Firmness", descAr: "الثبات عبر التقلبات والفصول المختلفة", descEn: "Deep-rooted consistency across seasons" },
  { level: 5, key: "lifestyle", targetDays: 180, nameAr: "السجية", nameEn: "Second Nature", shortNameAr: "السجية", shortNameEn: "Identity", descAr: "التحول إلى هوية أصيلة ونمط حياة دائم", descEn: "Second nature lifestyle and authentic identity" }
];

export class ProgressionEngine {
  /**
   * Calculates the automatic level of a habit based on streak, completions, and legacy data.
   * @param {Object} habit 
   * @param {Object|null} stats - { currentStreak, longestStreak, consistencyCompleted }
   * @param {Array|null} levelData - Legacy level array [{ achieved: boolean }]
   * @returns {number} Level from 1 to 5
   */
  static calculateLevel(habit, stats = null, levelData = null) {
    const rawLevelData = levelData || habit?.levelData;
    
    // 1. Calculate peak streak (for earned badge determination)
    const streak = Math.max(
      stats?.longestStreak || 0,
      stats?.currentStreak || 0,
      habit?.savedLongestStreak || 0
    );

    // 2. Automatic Level determination based on user-defined milestone thresholds
    let autoLevel = 1;
    if (streak >= 90) {
      autoLevel = 5;
    } else if (streak >= 21) {
      autoLevel = 4;
    } else if (streak >= 7) {
      autoLevel = 3;
    } else if (streak >= 3) {
      autoLevel = 2;
    }

    // 3. Respect legacy manual achievement if higher (never downgrade user's earned badge)
    let legacyLevel = 1;
    if (Array.isArray(rawLevelData)) {
      let maxAchievedIdx = -1;
      for (let i = 0; i < 5; i++) {
        if (rawLevelData[i]?.achieved) maxAchievedIdx = i;
      }
      if (maxAchievedIdx !== -1) {
        legacyLevel = Math.min(maxAchievedIdx + 2, 5);
      }
    }

    // Also check habit.currentLevel if already saved (never downgrade an earned badge)
    const savedLevel = habit?.currentLevel || 1;

    return Math.max(autoLevel, legacyLevel, savedLevel);
  }

  /**
   * Generates rich progress information for UI display.
   * 
   * BEHAVIORAL MODEL (Active Momentum towards Current Milestone):
   * - Earned milestone badges are permanently kept.
   * - Completing the current milestone requires achieving its target consecutive days.
   * - Progress and remaining days are calculated directly from active streak vs milestone target,
   *   ensuring active streaks are always faithfully reflected (e.g. 4 of 21 days = 19%, not 0%).
   * 
   * @param {Object} habit 
   * @param {Object|null} stats 
   * @param {Function} [t] - Translation function
   * @returns {Object} Progress details
   */
  static getProgressDetails(habit, stats = null, t = null) {
    const currentLevel = this.calculateLevel(habit, stats);
    
    // For earned badge: use peak streak
    const peakStreak = Math.max(
      stats?.currentStreak || 0,
      stats?.longestStreak || 0,
      habit?.savedLongestStreak || 0
    );
    
    // For active progression countdown: use CURRENT streak only
    const activeStreak = stats?.currentStreak || 0;

    const isAr = !t || (t("direction") === "rtl");
    const rawCurrentMilestone = MILESTONES[currentLevel - 1] || MILESTONES[0];
    const currentMilestone = {
      ...rawCurrentMilestone,
      name: isAr ? rawCurrentMilestone.nameAr : rawCurrentMilestone.nameEn,
      desc: isAr ? rawCurrentMilestone.descAr : rawCurrentMilestone.descEn
    };
    const isMaxLevel = currentLevel >= 5 && peakStreak >= MILESTONES[4].targetDays;

    let nextMilestone = null;
    let daysToNext;
    let progressPercent;
    let statusText;

    if (!isMaxLevel) {
      const nextTarget = rawCurrentMilestone.targetDays;
      daysToNext = Math.max(0, nextTarget - activeStreak);
      progressPercent = Math.min(100, Math.max(0, Math.round((activeStreak / nextTarget) * 100)));

      if (currentLevel < 5) {
        const rawNext = MILESTONES[currentLevel];
        nextMilestone = {
          ...rawNext,
          name: isAr ? rawNext.nameAr : rawNext.nameEn,
          desc: isAr ? rawNext.descAr : rawNext.descEn
        };
        const currentName = currentMilestone.name;
        const nextName = nextMilestone.name;

        if (activeStreak === 0 && peakStreak > 0) {
          statusText = isAr
            ? `استأنف السلسلة لإتمام المحطة ${currentLevel} (${currentName}) — تحتاج ${nextTarget} ${getDaysUnit(nextTarget, "ar")} متتالية`
            : `Resume your streak to complete Milestone ${currentLevel} (${currentName}) — requires ${nextTarget} consecutive ${getDaysUnit(nextTarget, "en")}`;
        } else {
          statusText = isAr
            ? `أنجزت ${activeStreak} من ${nextTarget} ${getDaysUnit(nextTarget, "ar")} (${progressPercent}%) — بقي ${daysToNext} ${getDaysUnit(daysToNext, "ar")} للارتقاء إلى ${nextName}`
            : `${activeStreak} of ${nextTarget} ${getDaysUnit(nextTarget, "en")} (${progressPercent}%) — ${daysToNext} ${getDaysUnit(daysToNext, "en")} remaining to reach ${nextName}`;
        }
      } else {
        // currentLevel === 5, peakStreak < 180
        const rawNext = MILESTONES[4];
        nextMilestone = {
          ...rawNext,
          name: isAr ? rawNext.nameAr : rawNext.nameEn,
          desc: isAr ? rawNext.descAr : rawNext.descEn
        };
        const currentName = currentMilestone.name;

        if (activeStreak === 0 && peakStreak > 0) {
          statusText = isAr
            ? `استأنف السلسلة لإتمام المحطة 5 (${currentName}) — تحتاج ${nextTarget} ${getDaysUnit(nextTarget, "ar")} متتالية`
            : `Resume your streak to complete Milestone 5 (${currentName}) — requires ${nextTarget} consecutive ${getDaysUnit(nextTarget, "en")}`;
        } else {
          statusText = isAr
            ? `أنجزت ${activeStreak} من ${nextTarget} ${getDaysUnit(nextTarget, "ar")} (${progressPercent}%) — بقي ${daysToNext} ${getDaysUnit(daysToNext, "ar")} لبلوغ السجية التامة`
            : `${activeStreak} of ${nextTarget} ${getDaysUnit(nextTarget, "en")} (${progressPercent}%) — ${daysToNext} ${getDaysUnit(daysToNext, "en")} remaining to complete Identity`;
        }
      }
    } else {
      daysToNext = 0;
      progressPercent = 100;
      statusText = isAr
        ? "ما شاء الله! بلغت العادة مرحلة السجية ونمط الحياة المستقر"
        : "Milestone achieved! This habit is now second nature";
    }

    return {
      currentLevel,
      currentMilestone,
      nextMilestone,
      streak: peakStreak,
      activeStreak,
      daysToNext,
      progressPercent,
      isMaxLevel,
      statusText,
      milestones: MILESTONES.map(m => {
        const isAchieved = currentLevel > m.level || (currentLevel === 5 && m.level === 5 && peakStreak >= m.targetDays);
        const isCurrent = currentLevel === m.level;
        return {
          ...m,
          name: isAr ? m.nameAr : m.nameEn,
          shortName: isAr ? m.shortNameAr : m.shortNameEn,
          desc: isAr ? m.descAr : m.descEn,
          isAchieved,
          isCurrent,
          statusBadge: isAchieved 
            ? (isAr ? "مكتملة ✓" : "Achieved ✓") 
            : (isCurrent ? (isAr ? "المحطة الحالية" : "Current Milestone") : (isAr ? "محطة قادمة" : "Upcoming"))
        };
      })
    };
  }
}
