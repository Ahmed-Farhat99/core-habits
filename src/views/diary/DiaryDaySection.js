import { setIcon } from 'obsidian';
import { DateUtils } from '../../utils/helpers.js';
import { DiaryParser } from '../../services/DiaryParser.js';
import { diaryEntriesLabel } from './diaryLabels.js';
import { TooltipHelper } from '../../utils/TooltipHelper.js';

export class DiaryDaySection {
  constructor(context, plugin, cardRenderer) {
    this.context = context;
    this.plugin = plugin;
    this.cardRenderer = cardRenderer;
    this.collapsedDays = new Set();
    this.openedDays = new Set();
  }

  /**
   * Renders a full day section with collapsible categories or chronological timeline
   * @param {HTMLElement} container
   * @param {moment.Moment} dayMoment
   * @param {Array<object>} dayEntries
   * @param {boolean} [isTimeline=false] - If true, renders entries chronologically without category accordion boxes
   * @param {boolean} [hideTypeBadge=false] - If true, hides the type badge (e.g. when under an outer type filter)
   * @param {boolean} [initiallyOpen=true] - Older days can defer rendering until opened
   */
  render(container, dayMoment, dayEntries, isTimeline = false, hideTypeBadge = false, initiallyOpen = true) {
    const t = (k, p) => this.plugin.translationManager?.t(k, p) || k;
    const lang = this.plugin.settings?.language || "ar";
    const isRTL = t("direction") === "rtl";
    const isToday = dayMoment.isSame(window.moment(), "day");
    const structured = DiaryParser.structureDailyJournal(dayEntries, dayMoment, isToday);

    const dayKey = dayMoment.format("YYYY-MM-DD");
    const isOpen = this.openedDays.has(dayKey) || (initiallyOpen && !this.collapsedDays.has(dayKey));

    const daySection = container.createEl("details", {
      cls: `dh-diary-day-section ${isToday ? "is-today" : ""} ${isTimeline ? "is-timeline" : ""}`,
      attr: isOpen ? { open: "true" } : {}
    });

    // ── Day Summary Header ──
    const summaryHeader = daySection.createEl("summary", {
      cls: "dh-diary-day-header"
    });

    // Start Cluster: Chevron + Date info
    const startCluster = summaryHeader.createDiv({ cls: "day-header-start" });

    // Rotating Chevron
    const chevronEl = startCluster.createSpan({ cls: "dh-day-chevron" });
    setIcon(chevronEl, isRTL ? "chevron-left" : "chevron-right");

    // Title group: Day Name + Date + Hijri + Today badge
    const titleGroup = startCluster.createDiv({ cls: "day-title-group" });

    const primaryDate = titleGroup.createDiv({ cls: "day-primary-date" });
    const dayName = dayMoment.clone().locale(lang).format("dddd");
    primaryDate.createSpan({
      cls: "day-name-text",
      text: dayName
    });
    primaryDate.createSpan({
      cls: "day-date-text",
      text: dayMoment.clone().locale(lang).format("D MMMM")
    });

    if (dayEntries.length > 0) {
      const countPill = primaryDate.createSpan({
        cls: "dh-diary-count-pill",
        text: String(dayEntries.length)
      });
      TooltipHelper.set(countPill, diaryEntriesLabel(this.plugin, dayEntries.length));
    }

    if (isToday) {
      primaryDate.createSpan({
        cls: "dh-today-badge",
        text: t("today") || "اليوم"
      });
    }

    // Secondary Hijri Date
    if (this.plugin.settings?.showHijriDate) {
      const hijriDateStr = DateUtils.getHijriDate(dayMoment, isRTL);
      if (hijriDateStr) {
        titleGroup.createSpan({ cls: "day-date-sep", text: "·" });
        titleGroup.createSpan({
          cls: "day-hijri-subtext",
          text: hijriDateStr
        });
      }
    }

    // End Cluster: Add Action (isolated, single stable item)
    const endCluster = summaryHeader.createDiv({ cls: "day-header-end" });

    const addBtn = endCluster.createEl("button", {
      cls: "dh-btn mod-ghost dh-day-add-btn",
      text: t("diary_add_entry_btn") || "+ تدوينة",
      attr: {
        type: "button"
      }
    });

    // Stop propagation so clicking "+ تدوينة" does not toggle the details accordion
    addBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.context.openReflectionPopup(dayMoment);
    };

    // ── Day Body ──
    const bodyEl = daySection.createDiv({ cls: `dh-diary-day-body ${isTimeline ? "is-timeline" : ""}` });

    let bodyRendered = false;
    const renderEntries = () => {
      if (bodyRendered) return;
      bodyRendered = true;
      if (isTimeline) {
        const sortedEntries = [...dayEntries].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        sortedEntries.forEach(entry => this.cardRenderer.render(bodyEl, entry, false, hideTypeBadge));
        return;
      }
      const categories = [
        { key: "good", label: t("diary_section_good") || "جيد", entries: structured.sections.good, cls: "good" },
        { key: "bad", label: t("diary_section_bad") || "سيء", entries: structured.sections.bad, cls: "bad" },
        { key: "lesson", label: t("diary_section_lesson") || "درس", entries: structured.sections.lesson, cls: "lesson" },
        { key: "notes", label: t("diary_section_notes") || "خواطر وأفكار", entries: structured.sections.notes, cls: "notes" }
      ];

      const activeCategories = categories.filter(c => c.entries.length > 0);

      if (activeCategories.length === 1 && activeCategories[0].entries.length === 1) {
        const entry = activeCategories[0].entries[0];
        this.cardRenderer.render(bodyEl, entry, false, false);
      } else {
        activeCategories.forEach(cat => this.renderCategoryGroup(bodyEl, cat));
      }
    };
    if (isOpen) renderEntries();

    daySection.ontoggle = () => {
      if (daySection.open) {
        this.openedDays.add(dayKey);
        this.collapsedDays.delete(dayKey);
        renderEntries();
      } else {
        this.collapsedDays.add(dayKey);
        this.openedDays.delete(dayKey);
      }
    };

    return daySection;
  }

  /**
   * Renders a plain category heading and its entries within a day.
   */
  renderCategoryGroup(parentEl, category) {
    const groupEl = parentEl.createDiv({ cls: `dh-diary-category-group type-${category.cls}` });
    const summaryEl = groupEl.createDiv({ cls: `dh-diary-category-header type-${category.cls}` });

    const startDiv = summaryEl.createDiv({ cls: "category-header-start" });
    startDiv.createSpan({ cls: `dh-category-dot type-${category.cls}` });

    startDiv.createSpan({ cls: "category-title", text: category.label });

    const listEl = groupEl.createDiv({ cls: "dh-diary-category-entries" });
    category.entries.forEach(entry => {
      // hideTypeBadge is true since the category header already indicates the type
      this.cardRenderer.render(listEl, entry, false, true);
    });
  }

  /**
   * Renders an ultra-compact single-line row for days with 0 entries (when show empty days is enabled)
   * @param {HTMLElement} container
   * @param {moment.Moment} dayMoment
   * @param {object} context
   * @param {object} plugin
   */
  static renderEmptyDayRow(container, dayMoment, context, plugin) {
    const t = (k, p) => plugin.translationManager?.t(k, p) || k;
    const lang = plugin.settings?.language || "ar";
    const isToday = dayMoment.isSame(window.moment(), "day");

    const row = container.createDiv({
      cls: `dh-diary-empty-day-row ${isToday ? "is-today" : ""}`
    });

    const isRTL = t("direction") === "rtl";
    const startInfo = row.createDiv({ cls: "empty-day-start" });
    startInfo.createSpan({
      cls: "empty-day-date",
      text: dayMoment.clone().locale(lang).format(t("date_format_diary_header") || "dddd، D MMMM")
    });

    if (isToday) {
      startInfo.createSpan({
        cls: "dh-today-badge",
        text: t("today") || "اليوم"
      });
    }

    if (plugin.settings?.showHijriDate) {
      const hijriDateStr = DateUtils.getHijriDate(dayMoment, isRTL);
      if (hijriDateStr) {
        startInfo.createSpan({ cls: "day-date-sep", text: "·" });
        startInfo.createSpan({
          cls: "day-hijri-subtext",
          text: hijriDateStr
        });
      }
    }

    const endAction = row.createDiv({ cls: "empty-day-end" });
    endAction.createSpan({
      cls: "empty-day-notice",
      text: t("diary_no_entries_short") || "لا توجد تدوينات"
    });

    const addBtn = endAction.createEl("button", {
      cls: "dh-btn mod-ghost dh-empty-add-btn",
      text: t("diary_add_entry_btn") || "+ تدوينة",
      attr: {
        type: "button"
      }
    });

    addBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      context.openReflectionPopup(dayMoment);
    };

    return row;
  }
}
