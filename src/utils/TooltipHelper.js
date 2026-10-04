/**
 * TooltipHelper.js
 * Centralized, unified tooltip manager for Core Habits.
 * 
 * ARCHITECTURAL DESIGN:
 * 1. Enforces Obsidian's native tooltip mechanism (`aria-label`) across all components.
 * 2. Prevents native browser/OS tooltips by proactively stripping the HTML `title` attribute.
 * 3. Provides localized semantic formatters so that no English code strings (e.g. "skipped") leak into the UI.
 * 4. Eliminates redundant, conflicting, or dual tooltips on interactive elements.
 */

const managedLabels = new WeakMap();

export class TooltipHelper {
  /**
   * Sets a unified Obsidian tooltip on the given element.
   * Strips any native `title` attribute/property to prevent dual OS tooltips.
   * 
   * @param {HTMLElement|Element} el - Target DOM element
   * @param {string|null|undefined} text - Tooltip content
   * @param {object} [options] - Options
   * @param {"top"|"bottom"|"left"|"right"} [options.placement] - Tooltip position
   */
  static set(el, text, options = {}) {
    if (!el) return;

    // 1. Proactively strip native browser/OS tooltip to prevent duplicate popups
    if (typeof el.removeAttribute === "function" && el.hasAttribute("title")) {
      el.removeAttribute("title");
    }
    if ("title" in el && el.title) {
      try {
        el.title = "";
      } catch {
        // In case property is read-only in some environments
      }
    }

    const trimmed = typeof text === "string" ? text.trim() : "";

    // 2. Clear tooltip if text is empty or non-string
    if (!trimmed) {
      if (typeof el.removeAttribute === "function") {
        const owned = managedLabels.get(el);
        if (owned && el.getAttribute("aria-label") === owned.text) {
          if (owned.previous) el.setAttribute("aria-label", owned.previous);
          else el.removeAttribute("aria-label");
        }
        managedLabels.delete(el);
        el.removeAttribute("data-tooltip-position");
      }
      return;
    }

    // 3. Set standard Obsidian aria-label tooltip
    if (typeof el.setAttribute === "function") {
      const owned = managedLabels.get(el);
      managedLabels.set(el, { text: trimmed, previous: owned && el.getAttribute("aria-label") === owned.text ? owned.previous : el.getAttribute("aria-label") });
      el.setAttribute("aria-label", trimmed);
      if (options.placement) el.setAttribute("data-tooltip-position", options.placement);
      else el.removeAttribute("data-tooltip-position");
    }
  }

  /**
   * Resolves a fully localized label for a habit status.
   * Guaranteed never to return a raw English code variable if language is Arabic.
   * 
   * @param {string} status - "completed" | "skipped" | "missed" | "uncompleted" | "not_scheduled"
   * @param {Function} [t] - Translation function
   * @param {boolean} [isAr] - Whether the active language is Arabic
   * @returns {string}
   */
  static getStatusLabel(status, t, isAr = false) {
    const translate = typeof t === "function" ? t : () => "";
    const normalized = String(status || "").toLowerCase().trim();

    const lookup = (k) => {
      const res = translate(k);
      return (typeof res === "string" && res.trim().length > 0 && res !== k) ? res : null;
    };

    switch (normalized) {
      case "completed":
        return lookup("status_completed") || lookup("completed") || (isAr ? "مُنجَز" : "Completed");
      case "skipped":
        return lookup("status_skipped") || lookup("skipped") || (isAr ? "معذور" : "Excused");
      case "missed":
        return lookup("status_missed") || lookup("missed") || (isAr ? "فائت" : "Missed");
      case "uncompleted":
      case "pending":
        return lookup("status_uncompleted") || lookup("uncompleted") || (isAr ? "بانتظار الإنجاز" : "Pending");
      case "not-scheduled":
      case "not_scheduled":
        return lookup("status_not_scheduled") || lookup("grid_habit_not_scheduled_tooltip") || (isAr ? "غير مجدول" : "Not scheduled");
      case "future":
        return lookup("status_future") || lookup("future") || (isAr ? "قادم" : "Upcoming");
      default:
        return lookup(normalized) || normalized;
    }
  }

  /**
   * Composes a single, unified tooltip text for a habit grid cell.
   * 
   * @param {object} params
   * @param {string} params.habitName
   * @param {string} params.dayName
   * @param {string} params.dateFormatted
   * @param {string} params.status - "completed" | "skipped" | "missed" | "uncompleted"
   * @param {boolean} [params.hasRightClickHint] - Whether right-click context hint is enabled
   * @param {boolean} [params.isArchived] - Whether the habit is archived
   * @param {Function} params.t - Translation function
   * @param {boolean} [params.isAr] - Arabic flag
   * @returns {string}
   */
  static formatHabitCell({
    habitName = "",
    dayName = "",
    dateFormatted = "",
    status = "uncompleted",
    hasRightClickHint = false,
    isArchived = false,
    t,
    isAr = false
  }) {
    const translate = typeof t === "function" ? t : (k) => k;
    const baseSubject = `${habitName} — ${dayName} ${dateFormatted}`.trim();

    if (isArchived) {
      return translate("grid_habit_archived_tooltip", { title: baseSubject }) || baseSubject;
    }

    const statusLabel = TooltipHelper.getStatusLabel(status, translate, isAr);
    const cellSummary = `${baseSubject} (${statusLabel})`;

    if (hasRightClickHint) {
      const hint = translate("grid_cell_right_click_hint");
      if (hint) {
        return `${cellSummary} • ${hint}`;
      }
    }

    return cellSummary;
  }

  /**
   * Formats the tooltip for clicking/editing a habit name.
   */
  static formatHabitEdit(habitName, t, isAr = false) {
    const translate = typeof t === "function" ? t : (k) => k;
    const prefix = translate("edit_habit") || (isAr ? "تعديل" : "Edit");
    return `${prefix}: ${habitName}`;
  }

  /**
   * Formats the tooltip for a day header cell (date + note shortcut).
   */
  static formatDayHeader(dayName, dateFormatted, t, isAr = false) {
    const translate = typeof t === "function" ? t : (k) => k;
    const noteHint = translate("grid_click_open_note_tooltip") || (isAr ? "انقر لفتح الملاحظة اليومية" : "Click to open daily note");
    return `${dayName} ${dateFormatted} • ${noteHint}`;
  }

  /**
   * Formats completion rate stats badge (e.g. "5/8 مكتمل" instead of hardcoded English).
   */
  static formatDailyCompletionRate(completed, total, t, isAr = false) {
    const translate = typeof t === "function" ? t : (k) => k;
    const completedWord = translate("completed") || (isAr ? "مكتمل" : "Completed");
    return `${completed}/${total} ${completedWord}`;
  }

  /**
   * Formats streak count badge tooltip.
   */
  static formatStreak(streak, t, isAr = false) {
    const translate = typeof t === "function" ? t : (k) => k;
    return translate("streak_title", { streak }) || (isAr ? `سلسلة: ${streak} أيام متتالية` : `Streak: ${streak} consecutive days`);
  }
}
