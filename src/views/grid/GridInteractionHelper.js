import { NoticeService } from '../../services/NoticeService.js';
import { CollapseButton } from '../../components/ui/CollapseButton.js';
import { GroupCollapseController } from '../../components/ui/GroupCollapseController.js';
import { TooltipHelper } from '../../utils/TooltipHelper.js';
import { HabitCommentRepository } from '../../repositories/HabitCommentRepository.js';

export class GridInteractionHelper {
  static getDayAvailability(habit, dayDate, today, habitManager) {
    if (!habitManager.isHabitScheduledForDay(habit, dayDate.day())) return "not-scheduled";
    if (habit.archived && habit.archivedDate && dayDate.isAfter(window.moment(habit.archivedDate), "day")) return "archived";
    if (dayDate.isAfter(today, "day")) return "future";
    if (habit.restoredDate && dayDate.isBefore(window.moment(habit.restoredDate), "day")) return "ignored";
    return "available";
  }

  static getVisibleStatus(status, preloaded, dayDate, today) {
    if (status === "ignored" && preloaded?.hasNote === false) {
      return dayDate.isBefore(today, "day") ? "missed" : "uncompleted";
    }
    return status;
  }

  /**
   * Computes the next 3-state habit completion status:
   * "completed" -> "skipped" -> "uncompleted" -> "completed"
   * @param {string|null} currentStatus
   * @returns {"completed" | "skipped" | "uncompleted"}
   */
  static getNextStatus(currentStatus) {
    if (currentStatus === "completed") return "skipped";
    if (currentStatus === "skipped") return "uncompleted";
    return "completed";
  }

  /**
   * Returns display symbol for a given status.
   * @param {string|null} status
   * @returns {string}
   */
  static getStatusIcon(status) {
    switch (status) {
      case "completed":
        return "✓";
      case "skipped":
        return "⊘";
      case "missed":
        return "x";
      default:
        return "☐";
    }
  }

  /**
   * Applies the habit-pulse CSS class and removes it after durationMs.
   * @param {HTMLElement} element
   * @param {number} [durationMs=400]
   */
  static triggerPulseAnimation(element, durationMs = 400) {
    if (!element) return;
    if (typeof element.addClass === "function") {
      element.addClass("habit-pulse");
    } else if (element.classList) {
      element.classList.add("habit-pulse");
    }
    setTimeout(() => {
      if (element) {
        if (typeof element.removeClass === "function") {
          element.removeClass("habit-pulse");
        } else if (element.classList) {
          element.classList.remove("habit-pulse");
        }
      }
    }, durationMs);
  }

  /**
   * Attaches right-click (contextmenu) and 500ms long-press touch handlers for habit comments.
   * @param {HTMLElement} element
   * @param {Function} onOpenPopup - (event) => void
   */
  static attachCommentPopupListeners(element, onOpenPopup, isActive = () => true) {
    if (!element || typeof onOpenPopup !== "function") return;

    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isActive()) return;
      onOpenPopup(e);
    };

    element.oncontextmenu = handler;

    let touchTimer = null;
    let suppressClick = false;
    element.addEventListener("click", (e) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
    element.addEventListener(
      "touchstart",
      (e) => {
        if (touchTimer) clearTimeout(touchTimer);
        touchTimer = setTimeout(() => {
          touchTimer = null;
          if (!isActive()) return;
          suppressClick = true;
          onOpenPopup(e);
          setTimeout(() => { suppressClick = false; }, 800);
        }, 500);
      },
      { passive: true }
    );

    const clearTimer = () => {
      if (touchTimer) {
        clearTimeout(touchTimer);
        touchTimer = null;
      }
    };

    element.addEventListener("touchend", clearTimer);
    element.addEventListener("touchmove", clearTimer);
    element.addEventListener("touchcancel", clearTimer);
  }

  /**
   * Wires up group collapse/expand buttons with tooltips, DOM display updates, and persistence.
   * @param {HTMLElement} container
   * @param {Map<string, HTMLElement[]>} childRowsMap - Map of groupId -> child row elements
   * @param {Object} options
   * @param {string[]} [options.collapsedGroups=[]]
   * @param {Function} options.t - Translation function
   * @param {Function} options.onToggle - (groupId, collapsed) => void
   */
  static wireGroupCollapseButtons(container, childRowsMap, options) {
    return GroupCollapseController.wire(container, childRowsMap, options);
  }

  static findCollapseButton(container, parentId) {
    return GroupCollapseController.findButton(container, parentId);
  }

  static setGroupCollapsed(container, parentId, collapsed, t, childRows = null) {
    return GroupCollapseController.setGroup(container, parentId, collapsed, t, childRows);
  }

  static setAllGroupsCollapsed(container, parentIds, collapsed, t) {
    return GroupCollapseController.setAll(container, parentIds, collapsed, t);
  }

  static createBulkCollapseButton(host, scope, parentIds, { compact = false, settings, t, onToggle }) {
    const button = host.createEl("button", {
      cls: compact ? "dh-btn dh-compact-bulk-btn" : "dh-btn dh-bulk-toggle-btn desktop-corner-btn"
    });
    const icon = button.createSpan({ cls: "dh-bulk-icon" });
    const label = button.createSpan({ cls: "dh-bulk-text" });
    const allCollapsed = () => parentIds.every(id => {
      const control = this.findCollapseButton(scope, id);
      return control ? CollapseButton.isCollapsed(control) : settings.collapsedGroups.includes(id);
    });
    const updateLabel = () => {
      const collapsed = allCollapsed();
      icon.textContent = collapsed ? "⊞" : "⊟";
      label.textContent = t(collapsed ? "grid_expand_groups" : "grid_collapse_groups");
      TooltipHelper.set(button, label.textContent);
    };
    updateLabel();
    scope.addEventListener("dh-group-state-changed", updateLabel);

    button.onclick = async event => {
      event.stopPropagation();
      const collapsed = !allCollapsed();
      this.setAllGroupsCollapsed(scope, parentIds, collapsed, t);
      updateLabel();
      button.disabled = true;
      try { await onToggle(parentIds, collapsed); }
      catch (error) {
        for (const id of parentIds) {
          this.setGroupCollapsed(scope, id, settings.collapsedGroups.includes(id), t);
        }
        NoticeService.error(t("notice_error_prefix", { message: error.message }));
      } finally {
        button.disabled = false;
        updateLabel();
      }
    };
    return button;
  }

  /**
   * Calculates progress metrics and updates a child progress slot element: "(completed/total ✓)"
   * @param {HTMLElement} progressSlot
   * @param {Array<string>} statuses - List of statuses for child habits
   * @param {number} totalScheduled - Total scheduled children count
   */
  static updateChildProgressSlot(progressSlot, statuses, totalScheduled, t = null) {
    if (!progressSlot) return;
    if (!totalScheduled || totalScheduled <= 0) {
      progressSlot.textContent = "";
      TooltipHelper.set(progressSlot, null);
      if (typeof progressSlot.removeClass === "function") {
        progressSlot.removeClass("complete");
      }
      return;
    }

    const completedCount = statuses.filter((s) => s === "completed").length;
    const isComplete = completedCount === totalScheduled;
    const checkStr = isComplete ? " ✓" : "";
    progressSlot.textContent = t
      ? `${t("grid_child_progress_short", { done: completedCount, total: totalScheduled })}${checkStr}`
      : `(${completedCount}/${totalScheduled}${checkStr})`;
    TooltipHelper.set(progressSlot, t
      ? t("grid_child_progress_description", { done: completedCount, total: totalScheduled })
      : `${completedCount} of ${totalScheduled} subhabits completed`);

    if (isComplete) {
      if (typeof progressSlot.addClass === "function") progressSlot.addClass("complete");
    } else {
      if (typeof progressSlot.removeClass === "function") progressSlot.removeClass("complete");
    }
  }

  /**
   * Checks whether daily note content contains any comments for a habit.
   * @param {string|null} content - Raw note content
   * @param {Object} habit - Habit object
   * @param {Object} context - View context containing extractSectionLines and getHabitNotesHeading
   * @returns {boolean}
   */
  static hasHabitComment(content, habit, context) {
    if (!content || !habit || !context) return false;
    const heading = typeof context.getHabitNotesHeading === "function" ? context.getHabitNotesHeading() : null;
    const extractFn = typeof context.extractSectionLines === "function" ? context.extractSectionLines.bind(context) : null;
    if (!extractFn || !heading) return false;

    return this.hasHabitCommentLines(extractFn(content, heading), habit);
  }

  static hasHabitCommentLines(lines, habit) {
    return Array.isArray(lines) && lines.some(line => HabitCommentRepository.isCommentLineForHabit(line, habit));
  }
}
