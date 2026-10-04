import { setIcon } from 'obsidian';
import { DAY_KEYS } from '../../constants.js';
import { Utils } from '../../utils/Utils.js';
import { DateUtils, buildHierarchyLabels } from '../../utils/helpers.js';
import { TooltipHelper } from '../../utils/TooltipHelper.js';
import { GridInteractionHelper } from './GridInteractionHelper.js';
import { HabitRowFactory } from '../renderers/HabitRowFactory.js';

export class CompactGridRenderer {
  constructor(context, gridRenderer) {
    this.context = context;
    this.gridRenderer = gridRenderer;
    this.plugin = context.plugin;
  }

  get isAr() {
    return this.context.isAr();
  }

  updateFocusedDayStatus(element, stats, dayDate, today, t) {
    if (stats?.total > 0) {
      element.setAttribute("dir", this.isAr ? "rtl" : "ltr");
      element.textContent = t("grid_day_progress_short", { done: stats.completed, total: stats.total });
      return;
    }
    element.setAttribute("dir", "auto");
    element.textContent = dayDate.isAfter(today, "day")
      ? t("grid_future_day") : t("grid_no_counted_habits");
  }

  updateCompactWeekStrip(container) {
    const root = container.closest(".weekly-grid-container") || container;
    const weekStrip = root.querySelector(".dh-compact-week-strip");
    const dailyStats = this.context.getDailyStats ? this.context.getDailyStats() : null;
    const weekDayInfos = this.context.getWeekDayInfos ? this.context.getWeekDayInfos() : [];
    const today = window.moment();
    const t = (k, p) => this.plugin.translationManager.t(k, p);

    if (weekStrip && dailyStats && weekDayInfos.length === 7) {
      const dayPills = weekStrip.querySelectorAll(".dh-strip-day");
      dayPills.forEach((dayPill, i) => {
        const dayInfo = weekDayInfos[i];
        if (!dayInfo) return;
        const dayDateKey = DateUtils.formatDateKey(dayInfo.dayDate);
        const dayStats = dailyStats[dayDateKey];
        const pctBadge = dayPill.querySelector(".dh-strip-day-percentage");
        if (!pctBadge) return;

        pctBadge.className = "dh-strip-day-percentage";
        if (dayStats && !dayInfo.dayDate.isAfter(today, "day") && dayStats.total > 0) {
          const dayPct = Math.min(100, Math.round((dayStats.completed / dayStats.total) * 100));
          let colorClass = "pct-low";
          if (dayPct === 100) {
            colorClass = "pct-complete";
            pctBadge.textContent = "✓";
          } else {
            if (dayPct >= 80) colorClass = "pct-high";
            else if (dayPct >= 50) colorClass = "pct-medium";
            pctBadge.textContent = `${dayPct}%`;
          }
          pctBadge.addClass(colorClass);
          TooltipHelper.set(dayPill, `${t(DAY_KEYS[dayInfo.dayOfWeek])} ${dayInfo.dayDate.format("D")}: ${TooltipHelper.formatDailyCompletionRate(dayStats.completed, dayStats.total, t, this.isAr)}`);
        } else {
          pctBadge.textContent = "--";
          pctBadge.addClass("pct-none");
        }
      });
    }

    // Update focused day status in focusedDayBar
    const focusedIdx = this.context.getFocusedDayIndex ? this.context.getFocusedDayIndex() : 0;
    const focusedInfo = weekDayInfos[focusedIdx];
    const statusTextEl = root.querySelector(".dh-focused-day-status");
    if (statusTextEl && focusedInfo && dailyStats) {
      const focusedKey = DateUtils.formatDateKey(focusedInfo.dayDate);
      const stats = dailyStats[focusedKey];
      this.updateFocusedDayStatus(statusTextEl, stats, focusedInfo.dayDate, today, t);
    }
  }

  async renderCompactList(container, today, habits, weekContent) {
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const isAr = this.isAr;
    const weekDayInfos = this.context.getWeekDayInfos();
    const statusContent = this.gridRenderer.prepareWeekStatusContent(weekContent);

    // Get or initialize focused day index
    let focusedIdx = this.context.getFocusedDayIndex();
    if (focusedIdx === null || focusedIdx < 0 || focusedIdx > 6) {
      focusedIdx = 0;
      for (let i = 0; i < 7; i++) {
        if (weekDayInfos[i].isToday) {
          focusedIdx = i;
          break;
        }
      }
      this.context.setFocusedDayIndex(focusedIdx);
    }

    const { dayDate, isToday, dayOfWeek } = weekDayInfos[focusedIdx];
    const dateKey = DateUtils.formatDateKey(dayDate);

    // Create wrapper for the compact view
    const compactWrapper = container.createDiv({ cls: "dh-compact-view-wrapper" });

    const getShortDayName = (dow) => {
      const dayKeys = ["sun_short", "mon_short", "tue_short", "wed_short", "thu_short", "fri_short", "sat_short"];
      return t(dayKeys[dow]) || "";
    };

    // 1. The 7-Day Week Picker Strip (Top)
    const weekStrip = compactWrapper.createDiv({
      cls: "dh-compact-week-strip",
      attr: { role: "group", "aria-label": t("tab_weekly_grid") || "Week days" }
    });
    const dailyStats = this.context.getDailyStats ? this.context.getDailyStats() : null;

    for (let i = 0; i < 7; i++) {
      const dayInfo = weekDayInfos[i];
      const dayDateKey = DateUtils.formatDateKey(dayInfo.dayDate);
      const isDayActive = i === focusedIdx;
      const shortDayName = getShortDayName(dayInfo.dayOfWeek);
      
      const dayPill = weekStrip.createEl("button", {
        cls: `dh-strip-day ${isDayActive ? "is-active" : ""} ${dayInfo.isToday ? "is-today" : ""}`,
        attr: {
          type: "button",
          "data-day-index": String(i),
          role: "button",
          tabindex: isDayActive ? "0" : "-1",
          "aria-pressed": isDayActive ? "true" : "false",
          "aria-label": `${shortDayName} ${dayInfo.dayDate.format("D")}`
        }
      });

      // Day Short Name
      dayPill.createDiv({ cls: "dh-strip-day-name", text: shortDayName });

      // Day Number
      dayPill.createDiv({ cls: "dh-strip-day-num", text: dayInfo.dayDate.format("D") });

      // Completion Rate Badge
      const dayStats = dailyStats ? dailyStats[dayDateKey] : null;
      const pctBadge = dayPill.createDiv({ cls: "dh-strip-day-percentage" });
      
      if (dayStats && !dayInfo.dayDate.isAfter(today, "day") && dayStats.total > 0) {
        const dayPct = Math.min(100, Math.round((dayStats.completed / dayStats.total) * 100));
        let colorClass = "pct-low";
        if (dayPct === 100) {
          colorClass = "pct-complete";
          pctBadge.textContent = "✓";
        } else {
          if (dayPct >= 80) colorClass = "pct-high";
          else if (dayPct >= 50) colorClass = "pct-medium";
          pctBadge.textContent = `${dayPct}%`;
        }
        pctBadge.addClass(colorClass);
        TooltipHelper.set(dayPill, `${t(DAY_KEYS[dayInfo.dayOfWeek])} ${dayInfo.dayDate.format("D")}: ${TooltipHelper.formatDailyCompletionRate(dayStats.completed, dayStats.total, t, this.isAr)}`);
      } else {
        pctBadge.textContent = "--";
        pctBadge.addClass("pct-none");
      }

      // Click Action to jump to day
      dayPill.onclick = async () => {
        if (!isDayActive) {
          this.context.setFocusedDayIndex(i);
          await this.context.renderWeeklyGrid();
        }
      };
      dayPill.onkeydown = async (e) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          const direction = e.key === "ArrowRight" ? (isAr ? -1 : 1) : (isAr ? 1 : -1);
          const next = e.key === "Home" ? 0 : e.key === "End" ? 6 : (i + direction + 7) % 7;
          this.context.setFocusedDayIndex(next);
          await this.context.renderWeeklyGrid();
          this.context.getWeeklyContentContainer?.()?.querySelector(`.dh-strip-day[data-day-index="${next}"]`)?.focus();
        }
      };
    }

    // 2. Focused Day Context Bar (Date + Completion Status + Bulk Actions)
    const focusedDayBar = compactWrapper.createDiv({ cls: "dh-compact-focused-day-bar" });
    const infoSection = focusedDayBar.createDiv({ cls: "dh-focused-day-info" });
    
    const dateLine = infoSection.createDiv({ cls: "dh-focused-day-date-line" });
    const displayDate = dayDate.clone().locale(this.plugin.settings.language || "ar");
    const dayNameText = t(DAY_KEYS[dayOfWeek]);
    const dateLabelStr = displayDate.format(t("date_format_short"));
    const primaryDateText = `${dayNameText}، ${dateLabelStr}`;
    
    dateLine.createSpan({ cls: "dh-focused-day-date", text: primaryDateText });

    if (!isToday) {
      const todayJumpBtn = dateLine.createEl("button", {
        cls: "dh-btn mod-pill-sm dh-compact-today-btn-pill",
        text: t("today"),
        attr: { type: "button" }
      });
      TooltipHelper.set(todayJumpBtn, t("back_to_today"));
      todayJumpBtn.onclick = async () => {
        await this.context.goToCurrentWeek();
      };
    }

    if (this.plugin.settings.showHijriDate) {
      try {
        const hijriDate = DateUtils.getHijriDate(dayDate, isAr);
        if (hijriDate) {
          const hijriClean = hijriDate.replace(/\s+هـ$/, "");
          infoSection.createDiv({ cls: "dh-focused-day-hijri", text: hijriClean });
        }
      } catch (e) {
        Utils.debugLog(this.plugin, "Error calculating Hijri date:", e);
      }
    }

    const actionsSection = focusedDayBar.createDiv({ cls: "dh-focused-day-actions" });

    const focusedStats = dailyStats ? dailyStats[dateKey] : null;
    const statusPill = actionsSection.createDiv({ cls: "dh-focused-day-status-pill" });
    const statusTextEl = statusPill.createSpan({ cls: "dh-focused-day-status" });
    this.updateFocusedDayStatus(statusTextEl, focusedStats, dayDate, today, t);

    // Bulk Actions Button (inline in actionsSection)
    const hasParentHabits = habits.some(h => this.plugin.habitManager.isParent(h.id));
    if (hasParentHabits) {
      const parentHabits = habits.filter(h => this.plugin.habitManager.isParent(h.id));
      const parentIds = parentHabits.map(h => h.id);

      GridInteractionHelper.createBulkCollapseButton(actionsSection, compactWrapper, parentIds, {
        compact: true,
        settings: this.plugin.settings,
        t,
        onToggle: (ids, collapsed) => this.context.toggleAllGroupsCollapse(ids, collapsed)
      });
    }

    const listBody = compactWrapper.createDiv({ cls: "dh-compact-list", attr: { role: "list", "aria-label": primaryDateText } });
    const { sorted: sortedHabits } = buildHierarchyLabels(habits);

    // Color mapping
    const hexColorMap = HabitRowFactory.buildColorMap(sortedHabits, this.plugin.habitManager);

    const rowPromises = sortedHabits.map((habit) => {
      const dummyContainer = document.createElement("div");
      const colorHex = hexColorMap.get(habit.id);

      return HabitRowFactory.renderCompactRow({
        container: dummyContainer,
        habit,
        sortedHabits,
        colorHex,
        dayDate,
        dateKey,
        dayOfWeek,
        today,
        statusContent,
        context: this.context,
        plugin: this.plugin,
        isAr: this.isAr,
        t,
        getHabitStatusForDay: this.gridRenderer.getHabitStatusForDay.bind(this.gridRenderer),
        updateHeaderAndProgress: this.gridRenderer.updateHeaderAndProgress.bind(this.gridRenderer),
        refreshRowMeta: this.gridRenderer.refreshRowMeta.bind(this.gridRenderer)
      });
    });

    const renderedRows = await Promise.all(rowPromises);
    const fragment = document.createDocumentFragment();
    renderedRows.forEach(r => fragment.appendChild(r));
    listBody.appendChild(fragment);

    // Wire up collapse/expand buttons for compact rows
    const compactChildRowsMap = new Map();
    const compactRows = listBody.querySelectorAll('.dh-compact-row');
    for (const row of compactRows) {
      const gid = row.getAttribute('data-group-id');
      if (row.classList.contains('habit-row-child')) {
        if (!compactChildRowsMap.has(gid)) compactChildRowsMap.set(gid, []);
        compactChildRowsMap.get(gid).push(row);
      }
    }

    GridInteractionHelper.wireGroupCollapseButtons(listBody, compactChildRowsMap, {
      plugin: this.plugin,
      collapsedGroups: this.plugin.settings.collapsedGroups,
      t: this.plugin.translationManager.t.bind(this.plugin.translationManager),
      onToggle: (pid, collapsed) => this.context.toggleGroupCollapse(pid, collapsed)
    });

    // Add comment dots to compact rows if enabled
    if (this.plugin.settings.enableHabitContext) {
      const content = weekContent?.get(dateKey);
      const lines = content
        ? this.context.extractSectionLines(content, this.context.getHabitNotesHeading())
        : [];
      const rowsByHabitId = new Map(Array.from(listBody.querySelectorAll(".habit-row[data-habit-id]"), row => [row.getAttribute("data-habit-id"), row]));
      for (const habit of sortedHabits) {
        if (!GridInteractionHelper.hasHabitCommentLines(lines, habit)) continue;
        const btn = rowsByHabitId.get(habit.id)?.querySelector(".dh-compact-status-btn");
        if (btn && !btn.querySelector(".dh-has-comment-dot")) btn.createDiv({ cls: "dh-has-comment-dot" });
      }
    }

    // 3. Compact Reflection Footer
    if (this.plugin.settings.enableReflectionJournal) {
      const footer = compactWrapper.createDiv({ cls: "dh-compact-footer" });
      const diaryBtn = footer.createEl("button", {
        cls: `dh-btn dh-compact-diary-btn ${this.context.getReflectionDays()?.has(dateKey) ? "has-reflection" : ""}`
      });
      TooltipHelper.set(diaryBtn, this.context.getReflectionDays()?.has(dateKey)
        ? t("grid_diary_exists_tooltip")
        : t("grid_diary_add_tooltip"));
      setIcon(diaryBtn, "book-open");
      diaryBtn.createSpan({ text: t("grid_diary_label") + (this.context.getReflectionDays()?.has(dateKey) ? " ✓" : " +") });
      
      diaryBtn.onclick = (e) => {
        e.stopPropagation();
        this.context.openReflectionPopup(dayDate);
      };
    }

    // Update the progress bar percentages
    await this.gridRenderer.updateUnifiedProgressBar(container);
  }
}
