/**
 * HabitOverviewPanel.js
 * Vital Pulse visual experience for individual habits.
 * Renders:
 * 1. Score Bar: Horizontal consistency bar with trend indicator and consistency badge.
 * 2. Streak Hero & Metric Badges: Big prominent streak badge + longest streak & recovery pills.
 * 3. Mini History Strip: 28 colored squares (4 rows x 7 columns) reflecting last 28 days with RTL support.
 */
import { setIcon } from 'obsidian';
import { getDaysUnit, DateUtils } from '../../utils/helpers.js';
import { getFormHabitColorHex, applyHabitColor } from '../../utils/HabitColor.js';
import { TooltipHelper } from '../../utils/TooltipHelper.js';

export class HabitOverviewPanel {
  /**
   * @param {HTMLElement} containerEl
   * @param {Object} options
   * @param {Object} [options.plugin]
   * @param {Object} options.habit
   * @param {Object} options.formState
   * @param {Object|null} [options.stats]
   * @param {Function} options.t
   */
  constructor(containerEl, { plugin = null, habit, formState, stats = null, t }) {
    this.containerEl = containerEl;
    this.plugin = plugin;
    this.habit = habit;
    this.formState = formState;
    this.stats = stats;
    this.t = t || ((k) => k);

    this.rootEl = null;
    this.render();
  }

  updateStats(newStats) {
    this.stats = newStats;
    this.render();
  }

  render() {
    this.containerEl.empty();
    this.rootEl = this.containerEl.createDiv({ cls: "dh-pulse-panel-wrap" });

    const isAr = !this.t || (this.t("direction") === "rtl");
    const habitColorHex = getFormHabitColorHex(this.formState, this.habit, this.plugin?.habitManager);
    applyHabitColor(this.rootEl, habitColorHex);

    // 1. Score Bar with Trend Indicator (Synchronized to 28-Day Consistency)
    this.renderScoreBar(this.rootEl, isAr);

    // 2. Symmetrical 3-Card Metrics Section (Current Streak, Best, Recovery Pace)
    this.renderMetricsSection(this.rootEl, isAr);

    // 3. Mini History Calendar Matrix (4 Weeks Aligned with Weekday Headers)
    this.renderMiniHistory(this.rootEl, isAr);
  }

  updateColor() {
    if (this.rootEl) applyHabitColor(this.rootEl, getFormHabitColorHex(this.formState, this.habit, this.plugin?.habitManager));
  }

  // =========================================================================
  // 1. Score Bar (Symmetrical 3-Row Metric Card)
  // =========================================================================
  renderScoreBar(parent, isAr) {
    const card = parent.createDiv({ cls: "dh-pulse-score-card" });

    const hasCons = this.stats && this.stats.consistencyScore !== null && this.stats.consistencyScore !== undefined;

    // 1. Top Row: Clear Section Title (Right) <---> Days Count "10 of 28 days" (Left)
    const header = card.createDiv({ cls: "dh-pulse-score-header" });

    const titleRow = header.createDiv({ cls: "dh-pulse-score-title-row" });
    titleRow.createSpan({
      cls: "dh-pulse-score-title",
      text: this.t("pulse_consistency_title") || (isAr ? "معدل الإنجاز (آخر 28 يوماً)" : "Completion Rate (Last 28 Days)")
    });

    const meta = header.createDiv({ cls: "dh-pulse-score-meta" });
    if (hasCons) {
      const daysUnit = getDaysUnit(this.stats.consistencyScheduled, isAr ? "ar" : "en");
      meta.createSpan({
        text: `${this.stats.consistencyCompleted} ${isAr ? "من أصل" : "of"} ${this.stats.consistencyScheduled} ${daysUnit}`
      });
    } else {
      meta.createSpan({
        text: this.stats
          ? (isAr ? "لا توجد أيام مجدولة بعد" : "No scheduled days yet")
          : (this.t("stats_calculating") || (isAr ? "جاري الحساب..." : "Calculating..."))
      });
    }

    // 2. Middle Row: Progress Bar Track
    const track = card.createDiv({
      cls: "dh-pulse-score-track",
      attr: {
        role: "progressbar",
        "aria-valuenow": hasCons ? String(this.stats.consistencyScore) : "0",
        "aria-valuemin": "0",
        "aria-valuemax": "100"
      }
    });
    const bar = track.createDiv({ cls: "dh-pulse-score-bar" });
    const scorePercent = hasCons ? Math.max(4, Math.min(this.stats.consistencyScore, 100)) : 0;
    bar.style.width = `${scorePercent}%`;

    // 3. Bottom Row: Big Percentage + Badge (Right) <---> Clean Trend Indicator (Left)
    const bottomRow = card.createDiv({ cls: "dh-pulse-score-bottom" });

    const valueCol = bottomRow.createDiv({ cls: "dh-pulse-score-value-col" });
    if (hasCons) {
      valueCol.createSpan({
        cls: "dh-pulse-score-value",
        text: `${this.stats.consistencyScore}%`
      });

      const labelText = this.stats.consistencyLabel || (this.stats.consistencyScore >= 65 ? (isAr ? "جيد" : "Good") : (isAr ? "مقبول" : "Fair"));
      valueCol.createSpan({
        cls: `dh-pulse-consistency-badge score-${Math.floor(this.stats.consistencyScore / 25)}`,
        text: labelText
      });
    } else {
      valueCol.createSpan({
        cls: "dh-pulse-score-value is-pending",
        text: "—"
      });
    }

    // Clean Trend Indicator (no more "= +4%")
    if (this.stats && this.stats.trendDelta !== null && this.stats.trendDelta !== undefined) {
      const delta = this.stats.trendDelta;
      let trendCls;
      let arrowIcon;
      let deltaStr;
      let trendLabel;

      if (delta > 0) {
        trendCls = "trend-up";
        arrowIcon = "↑";
        deltaStr = `+${delta}%`;
        trendLabel = isAr ? `تحسن: +${delta}% عن الشهر السابق` : `Improving: +${delta}% vs previous 28 days`;
      } else if (delta < 0) {
        trendCls = "trend-down";
        arrowIcon = "↓";
        deltaStr = `${delta}%`;
        trendLabel = isAr ? `تراجع: ${delta}% عن الشهر السابق` : `Declining: ${delta}% vs previous 28 days`;
      } else {
        trendCls = "trend-stable";
        arrowIcon = "=";
        deltaStr = isAr ? "مستقر" : "Stable";
        trendLabel = isAr ? "مستقر: نفس وتيرة الشهر السابق" : "Stable: Same as previous 28 days";
      }

      const trendBadge = bottomRow.createSpan({
        cls: `dh-pulse-trend-badge ${trendCls}`
      });
      TooltipHelper.set(trendBadge, trendLabel);
      trendBadge.createSpan({ cls: "dh-pulse-trend-arrow", text: arrowIcon });
      trendBadge.createSpan({ cls: "dh-pulse-trend-delta", text: ` ${deltaStr}` });
    }
  }

  // =========================================================================
  // 2. Metrics Section (Symmetrical 3-Card Balance)
  // =========================================================================
  renderMetricsSection(parent, isAr) {
    const row = parent.createDiv({ cls: "dh-pulse-metrics-row" });

    const currentStreakVal = this.stats ? this.stats.currentStreak : (this.habit?.savedCurrentStreak || 0);
    const longestStreakVal = Math.max(
      this.stats?.longestStreak || 0,
      this.habit?.savedLongestStreak || 0,
      currentStreakVal
    );
    const recoveryScore = this.stats?.recoveryScore;

    const formatStreakUnit = (val) => {
      if (!isAr) return val === 1 ? "day" : "days";
      if (val === 2) return "يوم";
      return getDaysUnit(val, "ar");
    };

    // Card 1: Active/Current Streak
    const streakCard = row.createDiv({ cls: "dh-pulse-metric-card dh-pulse-streak-hero" });
    const streakHeader = streakCard.createDiv({ cls: "dh-pulse-card-label" });
    const streakIcon = streakHeader.createSpan({ cls: "dh-pulse-card-icon" });
    try { setIcon(streakIcon, "flame"); } catch { streakIcon.textContent = "🔥"; }
    streakHeader.createSpan({ text: this.t("stats_current_label") || (isAr ? "السلسلة الحالية" : "Current Streak") });

    const streakValWrap = streakCard.createDiv({ cls: "dh-pulse-card-val-wrap dh-pulse-streak-top" });
    streakValWrap.createSpan({ cls: "dh-pulse-card-num dh-pulse-streak-num", text: String(currentStreakVal) });
    streakValWrap.createSpan({
      cls: "dh-pulse-card-unit dh-pulse-streak-unit",
      text: ` ${formatStreakUnit(currentStreakVal)}`
    });

    // Card 2: Longest/Best Streak
    const longestCard = row.createDiv({ cls: "dh-pulse-metric-card dh-pill-longest" });
    const longestHeader = longestCard.createDiv({ cls: "dh-pulse-card-label" });
    const longestIcon = longestHeader.createSpan({ cls: "dh-pulse-card-icon" });
    try { setIcon(longestIcon, "trophy"); } catch { longestIcon.textContent = "👑"; }
    longestHeader.createSpan({ text: this.t("stats_longest_label") || (isAr ? "أطول سلسلة" : "Best Streak") });

    const longestValWrap = longestCard.createDiv({ cls: "dh-pulse-card-val-wrap" });
    longestValWrap.createSpan({ cls: "dh-pulse-card-num", text: String(longestStreakVal) });
    longestValWrap.createSpan({
      cls: "dh-pulse-card-unit",
      text: ` ${formatStreakUnit(longestStreakVal)}`
    });

    // Card 3: Recovery Pace / Resilience (Last 28 Days)
    const recoveryCard = row.createDiv({ cls: "dh-pulse-metric-card dh-pill-recovery" });
    const recoveryHeader = recoveryCard.createDiv({ cls: "dh-pulse-card-label" });
    const recoveryIcon = recoveryHeader.createSpan({ cls: "dh-pulse-card-icon" });
    try { setIcon(recoveryIcon, "zap"); } catch { recoveryIcon.textContent = "⚡"; }
    recoveryHeader.createSpan({ text: this.t("stats_recovery_speed") || (isAr ? "مرونة العودة" : "Bounce-back Pace") });

    const recoveryValWrap = recoveryCard.createDiv({ cls: "dh-pulse-card-val-wrap" });
    if (recoveryScore !== null && recoveryScore !== undefined) {
      const formattedRecovery = recoveryScore % 1 === 0 ? recoveryScore.toFixed(0) : recoveryScore.toFixed(1);
      recoveryValWrap.createSpan({ cls: "dh-pulse-card-num", text: formattedRecovery });
      recoveryValWrap.createSpan({
        cls: "dh-pulse-card-unit",
        text: ` ${formatStreakUnit(Math.round(recoveryScore))}`
      });
      TooltipHelper.set(recoveryCard, isAr ? "متوسط أيام الغياب قبل استئناف العادة خلال آخر 28 يوماً (الرقم الأقل أفضل)" : "Average days to resume habit after a break in the last 28 days (lower is better)");
    } else if (this.stats && this.stats.currentStreak > 0) {
      recoveryValWrap.createSpan({ cls: "dh-pulse-card-num is-text", text: isAr ? "ثبات تام" : "Solid Pace" });
      TooltipHelper.set(recoveryCard, isAr ? "لم يحدث أي انقطاع خلال الـ 28 يوماً الأخيرة — استمرارية تامة" : "No misses in the last 28 days — completely solid streak");
    } else {
      recoveryValWrap.createSpan({ cls: "dh-pulse-card-num is-pending", text: "—" });
      TooltipHelper.set(recoveryCard, isAr ? "لا توجد انقطاعات مسجلة بعد للقياس" : "No recorded breaks to measure yet");
    }
  }

  // =========================================================================
  // 3. Mini History Calendar Matrix (4 Weeks Aligned with Weekday Headers)
  // =========================================================================
  renderMiniHistory(parent, isAr) {
    const card = parent.createDiv({ cls: "dh-pulse-history-card" });

    const header = card.createDiv({ cls: "dh-pulse-history-header" });
    const historyTitle = this.t("mini_history_title") || this.t("pulse_history_title") || (isAr ? "سجل آخر 4 أسابيع" : "Last 4 Weeks History");
    header.createDiv({
      cls: "dh-pulse-history-title",
      text: historyTitle
    });

    const legend = header.createDiv({ cls: "dh-pulse-history-legend" });
    
    // Legend: Done
    const legDone = legend.createSpan({ cls: "dh-pulse-legend-item" });
    legDone.createSpan({ cls: "dh-legend-dot dot-completed" });
    
    legDone.createSpan({ text: isAr ? "مكتمل" : "Done" });

    // Legend: Missed
    const legMissed = legend.createSpan({ cls: "dh-pulse-legend-item" });
    legMissed.createSpan({ cls: "dh-legend-dot dot-missed" });
    legMissed.createSpan({ text: isAr ? "فائت" : "Missed" });

    // Legend: Off / Unscheduled
    const legOff = legend.createSpan({ cls: "dh-pulse-legend-item" });
    legOff.createSpan({ cls: "dh-legend-dot dot-unscheduled" });
    legOff.createSpan({ text: isAr ? "راحة" : "Off" });

    const weekStartDay = typeof this.plugin?.settings?.weekStartDay === "number" ? this.plugin.settings.weekStartDay : 6;
    
    // 7 Weekday Headers
    const weekdaysRow = card.createDiv({
      cls: "dh-pulse-history-weekdays",
      attr: { role: "row" }
    });

    const WEEKDAY_SHORT_AR = ["ح", "ن", "ث", "ر", "خ", "ج", "س"];
    const WEEKDAY_SHORT_EN = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    const WEEKDAY_FULL_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    const WEEKDAY_FULL_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    for (let c = 0; c < 7; c++) {
      const dayOfWeekIdx = (weekStartDay + c) % 7;
      const shortName = isAr ? WEEKDAY_SHORT_AR[dayOfWeekIdx] : WEEKDAY_SHORT_EN[dayOfWeekIdx];
      const fullName = isAr ? WEEKDAY_FULL_AR[dayOfWeekIdx] : WEEKDAY_FULL_EN[dayOfWeekIdx];
      const colHeader = weekdaysRow.createDiv({
        cls: "dh-pulse-history-weekday-col",
        attr: {
          role: "columnheader",
          "aria-label": fullName
        }
      });
      colHeader.createSpan({ text: shortName });
    }

    // 4 Rows x 7 Columns CSS Grid
    const grid = card.createDiv({
      cls: "dh-pulse-history-grid",
      attr: {
        role: "grid"
      }
    });

    // Map history entries by date string "YYYY-MM-DD"
    const historyMap = new Map();
    const history = (this.stats?.dailyHistory && Array.isArray(this.stats.dailyHistory))
      ? this.stats.dailyHistory
      : this.generateFallbackHistory();
    
    history.forEach(item => {
      if (item && item.date) {
        historyMap.set(item.date, item);
      }
    });

    const momentFn = window.moment;
    if (!momentFn) return;

    const todayMoment = momentFn();
    const todayDayOfWeek = todayMoment.day ? todayMoment.day() : 0;
    const daysFromStart = (todayDayOfWeek - weekStartDay + 7) % 7;
    const currentWeekStart = todayMoment.clone ? todayMoment.clone().subtract(daysFromStart, 'days') : todayMoment;
    const calendarStart = currentWeekStart.clone ? currentWeekStart.clone().subtract(3, 'weeks') : currentWeekStart;

    for (let dayOffset = 0; dayOffset < 28; dayOffset++) {
      const cellDate = calendarStart.clone ? calendarStart.clone().add(dayOffset, 'days') : null;
      const dateStr = cellDate?.format ? cellDate.format("YYYY-MM-DD") : `2026-01-${String(dayOffset + 1).padStart(2, '0')}`;
      const dayNum = cellDate?.date ? cellDate.date() : (dayOffset + 1);
      const isToday = cellDate?.isSame ? cellDate.isSame(todayMoment, 'day') : false;
      const isFuture = cellDate?.isAfter ? cellDate.isAfter(todayMoment, 'day') : false;

      let status = "unscheduled";
      if (isFuture) {
        status = "future";
      } else if (historyMap.has(dateStr)) {
        status = historyMap.get(dateStr).status;
      }

      const cell = grid.createDiv({
        cls: `dh-pulse-history-cell status-${status}${isToday ? " is-today" : ""}`,
        attr: {
          "role": "gridcell",
          "data-date": dateStr,
          "data-status": status
        }
      });

      cell.createSpan({ cls: "dh-cell-day-num", text: String(dayNum) });


      if (cellDate && !isFuture) {
        const mDate = cellDate.locale ? cellDate.clone().locale(isAr ? "ar" : "en") : cellDate;
        const dayName = mDate.format ? mDate.format("dddd") : "";
        const dateFormatted = mDate.format ? mDate.format(isAr ? "D MMMM YYYY" : "MMM D, YYYY") : dateStr;
        const hijriFormatted = DateUtils?.getHijriDate ? DateUtils.getHijriDate(mDate, isAr) : "";
        const statusLabel = TooltipHelper.getStatusLabel(status, this.t, isAr);

        const dateHeader = isToday ? `${dayName}، ${dateFormatted} (${isAr ? "اليوم" : "Today"})` : `${dayName}، ${dateFormatted}`;
        const hijriLine = (hijriFormatted && hijriFormatted !== "-" && !hijriFormatted.includes("غير متاح")) ? `${hijriFormatted}` : "";
        const statusLine = `${isAr ? "الحالة" : "Status"}: ${statusLabel}`;

        const richTooltip = [dateHeader, hijriLine, statusLine].filter(Boolean).join("\n");
        TooltipHelper.set(cell, richTooltip);
      } else if (isFuture) {
        TooltipHelper.set(cell, isAr ? "يوم قادم" : "Upcoming day");
      }
    }
  }

  generateFallbackHistory() {
    const today = (window.moment || (() => ({ clone: () => ({ subtract: () => ({ locale: () => ({ format: () => "2026-01-01" }) }) }) })))();
    const fallback = [];
    for (let i = 27; i >= 0; i--) {
      const d = today.clone().subtract(i, "days");
      fallback.push({
        date: d.clone().locale("en").format("YYYY-MM-DD"),
        status: "unscheduled"
      });
    }
    return fallback;
  }

  destroy() {
    if (this.rootEl) {
      this.rootEl.empty();
      this.rootEl = null;
    }
  }
}
