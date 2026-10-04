import { setIcon } from 'obsidian';
import { NoticeService } from '../../services/NoticeService.js';
import { DAY_KEYS } from '../../constants.js';
import { DateUtils } from '../../utils/helpers.js';
import { TooltipHelper } from '../../utils/TooltipHelper.js';
import { CollapseButton } from '../../components/ui/CollapseButton.js';
import { buildHabitColorMap, applyHabitColor } from '../../utils/HabitColor.js';
import { GridInteractionHelper } from '../grid/GridInteractionHelper.js';

/**
 * HabitRowFactory
 * Unified factory for creating habit row DOM structures across
 * Desktop Grid, Compact Grid, and Settings views.
 */
export class HabitRowFactory {
  /**
   * Pre-calculates habit hex colors, taking into account parent-child inheritance.
   * @param {Array<object>} habits
   * @returns {Map<string, string>}
   */
  static buildColorMap(habits, habitManager = null) {
    return buildHabitColorMap(habits, habitManager);
  }

  /**
   * Resolves effective parent and hierarchy status for a habit.
   * @param {object} habit
   * @param {Array<object>} allHabits
   * @param {object} habitManager
   * @returns {{ effectiveParentId: string|null, isChild: boolean, isParentHabit: boolean }}
   */
  static resolveHierarchy(habit, allHabits, habitManager) {
    const effectiveParentId = habitManager.getEffectiveParentId(habit.id);
    const isChild = effectiveParentId !== null;
    const isParentHabit = allHabits.length > 0
      ? allHabits.some(h => habitManager.getEffectiveParentId(h.id) === habit.id)
      : habitManager.isParent(habit.id);
    return { effectiveParentId, isChild, isParentHabit };
  }

  /**
   * Creates the base row container with unified classes, dataset, and color variable.
   * @param {object} options
   * @returns {HTMLElement}
   */
  static createRowShell({ container, habit, effectiveParentId, isChild, colorHex, role = "row", extraClasses = [] }) {
    const classes = ["dh-habit", "habit-row"];
    if (isChild) classes.push("habit-row-child");
    if (extraClasses.length > 0) classes.push(...extraClasses);

    const row = container.createDiv({
      cls: classes.join(" "),
      attr: {
        role,
        "data-habit-id": habit.id,
      }
    });

    applyHabitColor(row, colorHex);
    row.setAttribute("data-group-id", effectiveParentId || habit.id);
    return row;
  }

  /**
   * Creates a standardized habit type dot with tooltip.
   * @param {HTMLElement} container
   * @param {string} habitType - "build" or "break"
   * @param {function} t - translation function
   * @returns {HTMLElement}
   */
  static createTypeDot(container, habitType, t, isChild = false) {
    const childClasses = isChild ? " is-child dh-child-indent" : "";
    const typeDot = container.createSpan({
      cls: `dh-type-dot ${habitType === "break" ? "break" : "build"}${childClasses}`
    });
    TooltipHelper.set(typeDot, t(habitType === "break" ? "grid_type_break" : "grid_type_build"));
    return typeDot;
  }

  /**
   * Creates a standardized group collapse/expand button.
   * @param {HTMLElement} container
   * @param {object} options
   * @returns {HTMLElement}
   */
  static createCollapseButton(container, options) {
    return CollapseButton.create(container, options);
  }

  /**
   * Creates an accessible habit name link with tooltip and keyboard/click navigation.
   * @param {HTMLElement} container
   * @param {object} options
   * @returns {HTMLElement}
   */
  static createNameLink(container, { habit, t, isAr, onOpenEdit }) {
    const habitName = habit.name ?? "";
    const nameLink = container.createEl("span", {
      text: habitName,
      cls: "habit-name-link habit-pure-name",
      attr: {
        role: "button",
        tabindex: "0"
      }
    });
    TooltipHelper.set(nameLink, TooltipHelper.formatHabitEdit(habitName, t, isAr));

    nameLink.onclick = (e) => {
      e?.stopPropagation();
      onOpenEdit();
    };
    nameLink.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        onOpenEdit();
      }
    };
    return nameLink;
  }

  /**
   * Creates a streak badge slot and queues calculation.
   * @param {HTMLElement} container
   * @param {object} options
   * @returns {HTMLElement}
   */
  static createStreakBadgeSlot(container, { habit, row, context }) {
    const slot = container.createSpan({ cls: "dh-streak-badge-slot" });
    context?.queueStreakCalculation?.(habit, row);
    return slot;
  }

  /**
   * Creates an open-page link/button with external-link icon and tooltips.
   * @param {HTMLElement} container
   * @param {object} options
   * @returns {HTMLElement}
   */
  static createOpenPageIcon(container, { t, onOpenPage, extraAttrs = {} }) {
    const openPageIcon = container.createEl("button", {
      cls: "habit-open-page-icon",
      attr: {
        type: "button",
        ...extraAttrs
      }
    });
    TooltipHelper.set(openPageIcon, t("grid_open_habit_page_tooltip") || "Open habit page");
    setIcon(openPageIcon, "external-link");

    openPageIcon.onclick = (e) => {
      e.stopPropagation();
      onOpenPage();
    };
    openPageIcon.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        onOpenPage();
      }
    };
    return openPageIcon;
  }

  /**
   * Asynchronously calculates and renders child progress for a parent habit.
   * @param {HTMLElement} metaWrapper
   * @param {object} options
   */
  static async renderChildProgress(metaWrapper, {
    allChildren,
    dayDate,
    dayOfWeek,
    contentForDate,
    habitManager,
    getHabitStatusForDay,
    isClosed,
    t
  }) {
    const scheduledChildren = allChildren.filter(child =>
      habitManager.isHabitScheduledForDay(child, dayOfWeek)
    );
    if (scheduledChildren.length === 0) return null;

    const progressSlot = metaWrapper.createDiv({ cls: "dh-child-progress" });
    try {
      const statuses = await Promise.all(
        scheduledChildren.map(child => getHabitStatusForDay(child, dayDate, contentForDate))
      );
      if (typeof isClosed === "function" && isClosed()) return null;
      GridInteractionHelper.updateChildProgressSlot(
        progressSlot,
        statuses,
        scheduledChildren.length,
        t
      );
      return progressSlot;
    } catch {
      progressSlot.remove();
      return null;
    }
  }

  /**
   * Renders a full desktop weekly grid row for a habit.
   * @param {object} params
   * @returns {Promise<HTMLElement>}
   */
  static async renderDesktopRow({
    container,
    habit,
    weekContent,
    displayLabel = "?",
    allHabits = [],
    colorHex,
    context,
    plugin,
    isAr,
    getHabitStatusForDay,
    updateHeaderAndProgress,
    refreshRowMeta
  }) {
    const t = plugin.translationManager.t.bind(plugin.translationManager);
    const { effectiveParentId, isChild, isParentHabit } = HabitRowFactory.resolveHierarchy(habit, allHabits, plugin.habitManager);

    const row = HabitRowFactory.createRowShell({
      container,
      habit,
      effectiveParentId,
      isChild,
      colorHex,
      role: "row",
      extraClasses: ["dh-grid-row"]
    });

    row.createDiv({
      cls: "habit-index-cell dh-grid-cell",
      text: String(displayLabel),
      attr: { role: "rowheader" }
    });

    const nameCell = row.createDiv({ cls: "habit-name-cell dh-grid-cell", attr: { role: "rowheader" } });
    const contentWrapper = nameCell.createDiv({ cls: "dh-name-content" });
    const metaWrapper = nameCell.createDiv({ cls: "dh-name-meta" });

    HabitRowFactory.createTypeDot(contentWrapper, habit.habitType, t, isChild);

    if (isParentHabit) {
      const isCollapsed = plugin.settings.collapsedGroups.includes(habit.id);
      HabitRowFactory.createCollapseButton(contentWrapper, { habitId: habit.id, isCollapsed, t });
    }

    HabitRowFactory.createNameLink(contentWrapper, {
      habit,
      t,
      isAr,
      onOpenEdit: () => context.openEditHabitModal(habit)
    });

    // Parent child progress
    const weekDayInfos = context.getWeekDayInfos();
    if (isParentHabit && allHabits.length > 0 && weekDayInfos.some(info => info.isToday)) {
      const allChildren = allHabits.filter(h => plugin.habitManager.getEffectiveParentId(h.id) === habit.id);
      if (allChildren.length > 0) {
        const today = window.moment();
        const todayDayOfWeek = today.day();
        const todayKey = DateUtils.formatDateKey(today);
        const todayContent = weekContent ? weekContent.get(todayKey) || null : null;

        HabitRowFactory.renderChildProgress(metaWrapper, {
          habit,
          allChildren,
          dayDate: today,
          dayOfWeek: todayDayOfWeek,
          contentForDate: todayContent,
          habitManager: plugin.habitManager,
          getHabitStatusForDay,
          isClosed: context.isClosed?.bind(context),
          t
        });
      }
    }

    HabitRowFactory.createStreakBadgeSlot(metaWrapper, { habit, row, context });

    HabitRowFactory.createOpenPageIcon(metaWrapper, {
      habit,
      t,
      onOpenPage: () => context.openHabitPage(habit)
    });

    const today = window.moment();
    const habitName = habit.name ?? "";

    for (let i = 0; i < 7; i++) {
      const { dayDate, dateKey, isToday, dayOfWeek } = weekDayInfos[i];
      const availability = GridInteractionHelper.getDayAvailability(habit, dayDate, today, plugin.habitManager);

      const cell = row.createDiv({
        cls: `day-cell dh-grid-cell ${isToday ? "is-today" : ""}`,
        attr: { "data-day-index": String(i), role: "gridcell" },
      });

      const tooltipDayName = t(DAY_KEYS[dayOfWeek]);
      const lang = plugin.settings.language || "ar";
      const tooltipDate = dayDate.clone().locale(lang).format(t("date_format_short"));

      if (availability === "not-scheduled") {
        cell.textContent = "--";
        cell.addClass("not-scheduled");
        TooltipHelper.set(cell, TooltipHelper.formatHabitCell({
          habitName,
          dayName: tooltipDayName,
          dateFormatted: tooltipDate,
          status: "not_scheduled",
          t,
          isAr
        }));
      } else if (availability === "archived") {
        cell.textContent = "🔒";
        cell.addClass("not-scheduled");
        TooltipHelper.set(cell, TooltipHelper.formatHabitCell({
          habitName,
          dayName: tooltipDayName,
          dateFormatted: tooltipDate,
          isArchived: true,
          t,
          isAr
        }));
      } else if (availability === "future") {
        cell.textContent = "☐";
        cell.addClass("future");
        TooltipHelper.set(cell, TooltipHelper.formatHabitCell({
          habitName,
          dayName: tooltipDayName,
          dateFormatted: tooltipDate,
          status: "future",
          t,
          isAr
        }));
      } else if (availability === "ignored") {
        cell.textContent = "--";
        cell.addClass("not-scheduled");
      } else {
        const preloaded = weekContent ? (weekContent.has(dateKey) ? weekContent.get(dateKey) : undefined) : null;
        const status = await getHabitStatusForDay(habit, dayDate, preloaded);
        const displayStatus = GridInteractionHelper.getVisibleStatus(status, preloaded, dayDate, today);

        if (displayStatus === "ignored") {
          cell.textContent = "--";
          cell.addClass("not-scheduled");
        } else {
          if (displayStatus === "completed") {
            cell.textContent = "✓";
            cell.addClass("completed");
          } else if (displayStatus === "skipped") {
            cell.textContent = "⊘";
            cell.addClass("skipped");
          } else if (displayStatus === "missed") {
            cell.textContent = "x";
            cell.addClass("missed");
          } else {
            cell.textContent = "☐";
            cell.addClass("pending");
          }

          cell.setAttribute("data-status", displayStatus === "missed" ? "uncompleted" : displayStatus);
          cell.setAttribute("tabindex", "0");
          cell.setAttribute("role", "button");
          TooltipHelper.set(cell, TooltipHelper.formatHabitCell({
            habitName,
            dayName: tooltipDayName,
            dateFormatted: tooltipDate,
            status: displayStatus,
            hasRightClickHint: plugin.settings.enableHabitContext,
            t,
            isAr
          }));

          const rowToken = context.getRenderToken?.();
          cell.onclick = async () => {
            if (context.isClosed?.() || plugin._isUnloading) return;
            if (cell.getAttribute("aria-busy") === "true") return;
            const current = cell.getAttribute("data-status");
            const next = GridInteractionHelper.getNextStatus(current);
            cell.setAttribute("aria-busy", "true");
            let success;
            try {
              success = await context.toggleHabitCompletion(habit, dayDate, next);
            } finally {
              cell.removeAttribute("aria-busy");
            }
            if (success === null || context.isClosed?.() ||
                (rowToken !== undefined && rowToken !== context.getRenderToken?.())) return;
            if (success) {
              cell.className = `day-cell dh-grid-cell ${isToday ? "is-today" : ""}`;
              const newContent = GridInteractionHelper.getStatusIcon(next);
              if (next === "completed") {
                cell.addClass("completed");
                GridInteractionHelper.triggerPulseAnimation(cell, 400);
              } else if (next === "skipped") {
                cell.addClass("skipped");
              } else {
                cell.addClass("pending");
              }

              const textNode = Array.from(cell.childNodes).find(n => n.nodeType === 3);
              if (textNode) {
                textNode.textContent = newContent;
              } else {
                cell.prepend(document.createTextNode(newContent));
              }
              cell.setAttribute("data-status", next);
              TooltipHelper.set(cell, TooltipHelper.formatHabitCell({
                habitName,
                dayName: tooltipDayName,
                dateFormatted: tooltipDate,
                status: next,
                hasRightClickHint: plugin.settings.enableHabitContext,
                t,
                isAr
              }));

              await updateHeaderAndProgress();
              await context.checkMilestone(dateKey);
              refreshRowMeta(habit, dayDate);
            } else {
              NoticeService.error(t("grid_update_habit_error"), plugin);
            }
          };
          cell.onkeydown = (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              cell.click();
            }
          };
        }
      }

      if (plugin.settings.enableHabitContext && availability !== "not-scheduled" && availability !== "future") {
        GridInteractionHelper.attachCommentPopupListeners(cell, () => {
          context.openCommentPopup(habit, dayDate);
        }, () => !context.isClosed?.() && !plugin._isUnloading);
      }
    }
    return row;
  }

  /**
   * Renders a compact weekly grid row for a habit on a focused day.
   * @param {object} params
   * @returns {Promise<HTMLElement>}
   */
  static async renderCompactRow({
    container,
    habit,
    sortedHabits,
    colorHex,
    dayDate,
    dateKey,
    dayOfWeek,
    today,
    statusContent,
    context,
    plugin,
    isAr,
    t,
    getHabitStatusForDay,
    updateHeaderAndProgress,
    refreshRowMeta
  }) {
    const { effectiveParentId, isChild, isParentHabit } = HabitRowFactory.resolveHierarchy(habit, sortedHabits, plugin.habitManager);

    const row = HabitRowFactory.createRowShell({
      container,
      habit,
      effectiveParentId,
      isChild,
      colorHex,
      role: "listitem",
      extraClasses: ["dh-compact-row"]
    });

    // Left-side details (Name, Hierarchy, Type Indicator)
    const nameSection = row.createDiv({ cls: "dh-compact-name-section" });

    HabitRowFactory.createTypeDot(nameSection, habit.habitType, t, isChild);

    if (isParentHabit) {
      const isCollapsed = plugin.settings.collapsedGroups.includes(habit.id);
      HabitRowFactory.createCollapseButton(nameSection, { habitId: habit.id, isCollapsed, t });
    }

    HabitRowFactory.createNameLink(nameSection, {
      habit,
      t,
      isAr,
      onOpenEdit: () => context.openEditHabitModal(habit)
    });

    const metaWrapper = row.createDiv({ cls: "dh-compact-meta-section" });
    if (isParentHabit) {
      const allChildren = sortedHabits.filter(h => plugin.habitManager.getEffectiveParentId(h.id) === habit.id);
      if (allChildren.length > 0) {
        const todayContent = statusContent.has(dateKey) ? statusContent.get(dateKey) : null;
        const progressSlot = await HabitRowFactory.renderChildProgress(metaWrapper, {
          habit,
          allChildren,
          dayDate,
          dayOfWeek,
          contentForDate: todayContent,
          habitManager: plugin.habitManager,
          getHabitStatusForDay,
          isClosed: context.isClosed?.bind(context),
          t
        });
        if (progressSlot) {
          row.addClass("has-child-progress");
        }
      }
    }

    const actionSection = row.createDiv({ cls: "dh-compact-action-section" });
    HabitRowFactory.createStreakBadgeSlot(actionSection, { habit, row, context });

    HabitRowFactory.createOpenPageIcon(actionSection, {
      habit,
      t,
      onOpenPage: () => context.openHabitPage(habit),
      extraAttrs: { type: "button" }
    });

    const availability = GridInteractionHelper.getDayAvailability(habit, dayDate, today, plugin.habitManager);
    const habitName = habit.name ?? "";

    if (availability === "not-scheduled") {
      const span = actionSection.createSpan({ cls: "dh-compact-status-text not-scheduled", text: "--" });
      TooltipHelper.set(span, TooltipHelper.getStatusLabel("not-scheduled", t, isAr));
    } else if (availability === "archived") {
      const span = actionSection.createSpan({ cls: "dh-compact-status-text archived", text: "🔒" });
      TooltipHelper.set(span, t("grid_habit_archived_tooltip", { title: habitName }));
    } else if (availability === "future") {
      const span = actionSection.createSpan({ cls: "dh-compact-status-text future", text: "☐" });
      TooltipHelper.set(span, TooltipHelper.getStatusLabel("future", t, isAr));
    } else if (availability === "ignored") {
      actionSection.createSpan({ cls: "dh-compact-status-text ignored", text: "--" });
    } else {
      const preloaded = statusContent.has(dateKey) ? statusContent.get(dateKey) : null;
      const status = await getHabitStatusForDay(habit, dayDate, preloaded);
      const displayStatus = GridInteractionHelper.getVisibleStatus(status, preloaded, dayDate, today);

      if (displayStatus === "ignored") {
        actionSection.createSpan({ cls: "dh-compact-status-text ignored", text: "--" });
      } else {
        const statusBtn = actionSection.createEl("button", {
          cls: `dh-compact-status-btn status-${displayStatus}`,
          attr: {
            "data-status": displayStatus === "missed" ? "uncompleted" : displayStatus
          }
        });
        TooltipHelper.set(statusBtn, `${habitName}: ${TooltipHelper.getStatusLabel(displayStatus, t, isAr)}`);

        if (displayStatus === "completed") statusBtn.textContent = "✓";
        else if (displayStatus === "skipped") statusBtn.textContent = "⊘";
        else if (displayStatus === "missed") statusBtn.textContent = "x";
        else statusBtn.textContent = "☐";

        const rowToken = context.getRenderToken?.();
        statusBtn.onclick = async (e) => {
          e.stopPropagation();
          if (context.isClosed?.() || plugin._isUnloading) return;
          if (statusBtn.disabled) return;
          const current = statusBtn.getAttribute("data-status");
          const next = GridInteractionHelper.getNextStatus(current);
          statusBtn.disabled = true;
          let success;
          try {
            success = await context.toggleHabitCompletion(habit, dayDate, next);
          } finally {
            statusBtn.disabled = false;
          }
          if (success === null || context.isClosed?.() ||
              (rowToken !== undefined && rowToken !== context.getRenderToken?.())) return;
          if (success) {
            statusBtn.className = `dh-compact-status-btn status-${next}`;
            statusBtn.setAttribute("data-status", next);
            TooltipHelper.set(statusBtn, `${habitName}: ${TooltipHelper.getStatusLabel(next, t, isAr)}`);

            statusBtn.textContent = GridInteractionHelper.getStatusIcon(next);
            if (next === "completed") {
              GridInteractionHelper.triggerPulseAnimation(statusBtn, 400);
            }

            await updateHeaderAndProgress();
            await context.checkMilestone(dateKey);
            refreshRowMeta(habit, dayDate);
          } else {
            NoticeService.error(t("grid_update_habit_error"), plugin);
          }
        };

        if (plugin.settings.enableHabitContext) {
          GridInteractionHelper.attachCommentPopupListeners(statusBtn, () => {
            context.openCommentPopup(habit, dayDate);
          }, () => !context.isClosed?.() && !plugin._isUnloading);
        }
      }
    }
    return row;
  }
}
