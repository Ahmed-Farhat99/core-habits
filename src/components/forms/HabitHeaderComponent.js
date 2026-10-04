/**
 * HabitHeaderComponent.js
 * Extracted, single-responsibility header component for EditHabitModal and HabitEditView.
 * Renders habit identity (color dot, name, linked note shortcut) and vital pulse badges.
 */
import { getFormHabitColorHex, applyHabitColor } from '../../utils/HabitColor.js';
import { TooltipHelper } from '../../utils/TooltipHelper.js';
import { setIcon } from 'obsidian';

export class HabitHeaderComponent {
  /**
   * @param {HTMLElement} containerEl - Parent container
   * @param {Object} options
   * @param {import('obsidian').App} options.app
   * @param {Object} options.plugin
   * @param {Object} options.habit - Original habit entity
   * @param {Object} options.formState - Live editable form state
   * @param {Object|null} [options.stats=null] - Calculated streak and consistency stats
   * @param {Function} options.t - Translation helper
   */
  constructor(containerEl, { app, plugin, habit, formState, stats = null, t }) {
    this.containerEl = containerEl;
    this.app = app;
    this.plugin = plugin;
    this.habit = habit;
    this.formState = formState;
    this.stats = stats;
    this.t = t || ((k) => k);

    this.rootEl = null;
    this.colorDotEl = null;
    this.titleEl = null;
    this.statusBarEl = null;

    this.render();
  }

  render() {
    this.containerEl.empty();
    this.rootEl = this.containerEl.createDiv({ cls: "modal-header-clean dh-habit-hub-header" });

    const isAr = !this.t || (this.t("direction") === "rtl");
    const topRow = this.rootEl.createDiv({ cls: "dh-hub-top-row" });

    // Title group with color dot, habit name, and inline open page icon
    const titleGroup = topRow.createDiv({ cls: "dh-hub-title-group" });
    const colorHex = getFormHabitColorHex(this.formState, this.habit, this.plugin?.habitManager);

    this.colorDotEl = titleGroup.createSpan({
      cls: "dh-hub-color-dot"
    });
    TooltipHelper.set(this.colorDotEl, this.formState.habitType === "break" ? (this.t("break_habit") || (isAr ? "كسر عادة" : "Break Habit")) : (this.t("build_habit") || (isAr ? "بناء عادة" : "Build Habit")));
    this.updateColorDot(colorHex);

    this.titleEl = titleGroup.createEl("h2", {
      text: this.formState.name || this.habit.name,
      cls: "modal-title-clean dh-hub-title"
    });

    // Sleek inline linked file icon button (matches weekly grid view)
    const linkedFile = this.app?.metadataCache?.getFirstLinkpathDest(this.habit.name, "");
    if (linkedFile) {
      const openPageTooltip = `${this.t("grid_open_habit_page_tooltip") || (isAr ? "فتح صفحة العادة" : "Open habit note")}`;
      const linkBtn = titleGroup.createEl("button", {
        cls: "dh-file-context-link dh-file-context-icon-btn",
        type: "button",
        attr: {
          "role": "button",
          "tabindex": "0"
        }
      });
      TooltipHelper.set(linkBtn, openPageTooltip);

      try {
        setIcon(linkBtn, "external-link");
      } catch { /* Use the text fallback when an icon cannot be rendered. */ }

      if (!linkBtn.querySelector("svg")) {
        linkBtn.createSpan({ cls: "dh-link-arrow", text: "↗" });
      }

      linkBtn.onclick = (e) => {
        e.stopPropagation();
        if (this.app?.workspace?.openLinkText) {
          this.app.workspace.openLinkText(linkedFile.path, "", true);
        }
      };
    }

    // Clean, streamlined Status Bar (Metadata pills with tooltips)
    this.statusBarEl = this.rootEl.createDiv({ cls: "dh-hub-status-bar" });
    this.updateStatusBar();
  }

  updateTitle(newName) {
    if (this.titleEl) {
      this.titleEl.textContent = newName;
    }
  }

  updateColor() {
    this.updateColorDot(getFormHabitColorHex(this.formState, this.habit, this.plugin?.habitManager));
  }

  updateColorDot(hex) {
    if (this.rootEl) applyHabitColor(this.rootEl, hex);
  }

  updateStats(newStats) {
    this.stats = newStats;
    this.updateStatusBar();
  }

  updateStatusBar() {
    if (!this.statusBarEl) return;
    this.statusBarEl.empty();

    const isAr = !this.t || (this.t("direction") === "rtl");

    // 1. Habit Type badge (compact with rich tooltip)
    const isBreak = this.formState.habitType === "break";
    const typeLabel = isBreak
      ? (this.t("habit_type_break") || (isAr ? "إقلاع" : "Break"))
      : (this.t("habit_type_build") || (isAr ? "بناء" : "Build"));
    const typeTooltip = isBreak
      ? (isAr ? "نوع العادة: إقلاع عن سلوك غير مرغوب" : "Habit Type: Breaking an unwanted behavior")
      : (isAr ? "نوع العادة: بناء عادة إيجابية جديدة" : "Habit Type: Building a positive habit");

    const typePill = this.statusBarEl.createSpan({ cls: `dh-hub-status-pill type ${this.formState.habitType}` });
    typePill.textContent = typeLabel;
    TooltipHelper.set(typePill, typeTooltip);

    // 2. Schedule Summary badge (compact with rich tooltip)
    const isWeekly = this.formState.scheduleType === "weekly";
    const scheduleSummary = isWeekly
      ? `${this.formState.selectedDays.length}/7 ${this.t("days") || (isAr ? "أيام" : "days")}`
      : (this.t("schedule_daily") || (isAr ? "يومي" : "Daily"));
    const scheduleTooltip = isWeekly
      ? (isAr ? `الجدولة: تتكرر ${this.formState.selectedDays.length} أيام في الأسبوع` : `Schedule: ${this.formState.selectedDays.length} days per week`)
      : (isAr ? "الجدولة: تتكرر كل يوم" : "Schedule: Repeats every day");

    const schedPill = this.statusBarEl.createSpan({ cls: "dh-hub-status-pill schedule" });
    schedPill.createSpan({ text: scheduleSummary });
    TooltipHelper.set(schedPill, scheduleTooltip);
  }

  destroy() {
    if (this.rootEl) {
      this.rootEl.empty();
      this.rootEl = null;
    }
  }
}
