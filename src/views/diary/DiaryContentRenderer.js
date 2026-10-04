import { DateUtils } from '../../utils/helpers.js';
import { DIARY_PERIODS } from '../../services/DiaryService.js';
import { normalizeReflectionType, REFLECTION_ENTRY_TYPES } from '../../constants.js';
import { DiaryDaySection } from './DiaryDaySection.js';
import { setIcon } from 'obsidian';
import { diaryEntriesLabel } from './diaryLabels.js';
import { TooltipHelper } from '../../utils/TooltipHelper.js';

export class DiaryContentRenderer {
  constructor(context, plugin, diaryService, cardRenderer, onFiltersReset) {
    this.context = context;
    this.plugin = plugin;
    this.diaryService = diaryService;
    this.onFiltersReset = onFiltersReset;
    this.daySection = new DiaryDaySection(context, plugin, cardRenderer);
    this.visibleMonthLimit = 6;
    this.openMonths = new Set();
    this.closedMonths = new Set();
    this.closedTypes = new Set();
    this.openTypes = new Set();
  }

  resetLimit() {
    this.visibleMonthLimit = 6;
  }

  render(bodyContainer, filteredEntries) {
    bodyContainer.empty();
    const t = (k, p) => this.plugin.translationManager?.t(k, p) || k;
    const mode = this.context.getDiaryViewMode ? this.context.getDiaryViewMode() : "grouped";

    if (!filteredEntries || filteredEntries.length === 0) {
      if (this.diaryService.hasActiveFilters()) {
        const emptyState = bodyContainer.createDiv({ cls: "dh-diary-empty-filter-state" });
        const icon = emptyState.createDiv({ cls: "dh-empty-icon" });
        setIcon(icon, "search-x");
        emptyState.createEl("h3", {
          cls: "dh-empty-title",
          text: t("filter_empty_state_title")
        });
        emptyState.createEl("p", {
          cls: "dh-empty-desc",
          text: t("filter_empty_state_desc")
        });
        const resetBtn = emptyState.createEl("button", {
          cls: "dh-btn dh-empty-filter-btn",
          text: t("filter_clear_btn")
        });
        resetBtn.onclick = () => {
          this.diaryService.resetFilters();
          this.onFiltersReset();
        };
        return;
      }

      // Check if user has "show empty days" enabled for short periods
      const hideEmpty = this.diaryService.getHideEmptyDays();
      const { startDate, endDate } = this.diaryService.getRange();

      if (!hideEmpty && startDate && endDate && endDate.diff(startDate, "days") <= 14) {
        // Show empty days list
        this.renderGroupedDays(bodyContainer, []);
        return;
      }

      const emptyState = bodyContainer.createDiv({ cls: "dh-diary-empty-state" });
      const icon = emptyState.createDiv({ cls: "dh-empty-icon" });
      setIcon(icon, "book-open");
      emptyState.createEl("h3", { cls: "dh-empty-title", text: t("diary_empty_title") });
      emptyState.createEl("p", { cls: "dh-empty-desc", text: t("diary_empty_desc") });
      return;
    }

    if (mode === "timeline") {
      this.renderTimeline(bodyContainer, filteredEntries);
      return;
    }

    if (mode === "types") {
      this.renderTypes(bodyContainer, filteredEntries);
      return;
    }

    // Default: mode === "grouped"
    this.renderGrouped(bodyContainer, filteredEntries);
  }

  renderTimeline(bodyContainer, filteredEntries) {
    this.renderUnifiedEntries(bodyContainer, filteredEntries, true, false);
  }

  renderTypes(bodyContainer, filteredEntries) {
    const isRTL = this.plugin.translationManager?.t("direction") === "rtl";
    let typeIndex = 0;
    REFLECTION_ENTRY_TYPES.forEach(type => {
      const typeMeta = this.context.getReflectionTypeMeta(type);
      const typeEntries = filteredEntries
        .filter(entry => normalizeReflectionType(entry.type) === type)
        .sort((a, b) => b.timestamp - a.timestamp);

      if (typeEntries.length === 0) return;

      const isOpen = this.openTypes.has(type) || (typeIndex === 0 && !this.closedTypes.has(type));
      typeIndex++;
      const typeSection = bodyContainer.createEl("details", {
        cls: `dh-diary-type-section type-${typeMeta.cls}`,
        attr: isOpen ? { open: "true" } : {}
      });
      const typeHeader = typeSection.createEl("summary", {
        cls: `dh-diary-type-header type-${typeMeta.cls}`
      });

      const titleWrap = typeHeader.createDiv({ cls: "type-title-wrap" });
      const chevron = titleWrap.createSpan({ cls: "dh-category-chevron" });
      setIcon(chevron, isRTL ? "chevron-left" : "chevron-right");

      titleWrap.createSpan({ cls: `dh-category-dot type-${typeMeta.cls}` });
      titleWrap.createSpan({ cls: "type-title", text: typeMeta.label });

      if (typeEntries.length > 0) {
        const countPill = titleWrap.createSpan({
          cls: "dh-diary-count-pill",
          text: String(typeEntries.length)
        });
        TooltipHelper.set(countPill, diaryEntriesLabel(this.plugin, typeEntries.length));
      }

      const entriesList = typeSection.createDiv({ cls: "dh-diary-entries-list" });
      let typeRendered = false;
      const renderTypeEntries = () => {
        if (typeRendered) return;
        this.renderDays(entriesList, typeEntries, true, true, false, 3);
        typeRendered = true;
      };
      if (isOpen) renderTypeEntries();
      typeSection.ontoggle = () => {
        if (typeSection.open) {
          this.openTypes.add(type);
          this.closedTypes.delete(type);
          renderTypeEntries();
        } else {
          this.closedTypes.add(type);
          this.openTypes.delete(type);
        }
      };
    });
  }

  renderGrouped(bodyContainer, filteredEntries) {
    this.renderUnifiedEntries(bodyContainer, filteredEntries, false, false);
  }

  /**
   * Unified renderer for Grouped and Timeline modes across short and long ranges
   */
  renderUnifiedEntries(bodyContainer, filteredEntries, isTimeline = false, hideTypeBadge = false) {
    const t = (k, p) => this.plugin.translationManager?.t(k, p) || k;
    const lang = this.plugin.settings?.language || "ar";
    const isRTL = t("direction") === "rtl";
    const periodType = this.diaryService.getPeriodType();
    const isLongRange = [
      DIARY_PERIODS.MONTH,
      DIARY_PERIODS.QUARTER,
      DIARY_PERIODS.ALL
    ].includes(periodType) || (periodType === DIARY_PERIODS.CUSTOM && filteredEntries.length > 20);

    if (isLongRange) {
      // Group by Month (YYYY-MM)
      const monthMap = new Map();
      filteredEntries.forEach(entry => {
        const monthKey = entry.moment.format("YYYY-MM");
        if (!monthMap.has(monthKey)) monthMap.set(monthKey, []);
        monthMap.get(monthKey).push(entry);
      });

      const monthKeys = Array.from(monthMap.keys()).sort((a, b) => b.localeCompare(a));
      const maxMonthsToShow = this.visibleMonthLimit || 6;
      const visibleMonthKeys = monthKeys.slice(0, maxMonthsToShow);

      visibleMonthKeys.forEach((monthKey, idx) => {
        const monthEntries = monthMap.get(monthKey);
        const monthMoment = window.moment(monthKey, "YYYY-MM");
        const isOpen = this.openMonths.has(monthKey) || (idx === 0 && !this.closedMonths.has(monthKey));

        const monthSection = bodyContainer.createEl("details", {
          cls: "dh-diary-month-section",
          attr: isOpen ? { open: "true" } : {}
        });

        const monthHeader = monthSection.createEl("summary", { cls: "dh-diary-month-header" });
        const monthTitleWrap = monthHeader.createDiv({ cls: "month-title-wrap" });
        const chevron = monthTitleWrap.createSpan({ cls: "dh-month-chevron" });
        setIcon(chevron, isRTL ? "chevron-left" : "chevron-right");

        monthTitleWrap.createSpan({
          cls: "month-title",
          text: monthMoment.locale(lang).format("MMMM YYYY")
        });

        if (monthEntries.length > 0) {
          const countPill = monthTitleWrap.createSpan({
            cls: "dh-diary-count-pill",
            text: String(monthEntries.length)
          });
          TooltipHelper.set(countPill, diaryEntriesLabel(this.plugin, monthEntries.length));
        }

        const monthBody = monthSection.createDiv({ cls: "dh-diary-month-body" });
        let monthRendered = false;
        const renderMonthEntries = () => {
          if (monthRendered) return;
          this.renderDays(monthBody, monthEntries, isTimeline, hideTypeBadge, false, 3);
          monthRendered = true;
        };
        if (isOpen) renderMonthEntries();

        monthSection.ontoggle = () => {
          if (monthSection.open) {
            this.openMonths.add(monthKey);
            this.closedMonths.delete(monthKey);
            renderMonthEntries();
          } else {
            this.closedMonths.add(monthKey);
            this.openMonths.delete(monthKey);
          }
        };
      });

      if (monthKeys.length > maxMonthsToShow) {
        const loadMoreMonthsBtn = bodyContainer.createEl("button", {
          cls: "dh-btn dh-diary-load-more-btn",
          text: `${t("diary_load_more")} (${visibleMonthKeys.length}/${monthKeys.length})`
        });
        loadMoreMonthsBtn.onclick = () => {
          this.visibleMonthLimit = (this.visibleMonthLimit || 6) + 6;
          this.render(bodyContainer, filteredEntries);
        };
      }
    } else {
      // Grouped by day directly (Week, 2 Weeks, short custom)
      this.renderDays(bodyContainer, filteredEntries, isTimeline, hideTypeBadge);
    }
  }

  /**
   * Renders a list of entries grouped by day using DiaryDaySection
   * @param {HTMLElement} container
   * @param {Array<object>} entries
   * @param {boolean} [isTimeline=false]
   * @param {boolean} [hideTypeBadge=false]
   * @param {boolean} [showEmptyDays=true]
   * @param {number} [initiallyOpenDays=Infinity]
   */
  renderDays(container, entries, isTimeline = false, hideTypeBadge = false, showEmptyDays = true, initiallyOpenDays = Infinity) {
    const hideEmpty = this.diaryService.getHideEmptyDays();

    const dayMap = new Map();
    (entries || []).forEach(entry => {
      if (!dayMap.has(entry.dateKey)) dayMap.set(entry.dateKey, []);
      dayMap.get(entry.dateKey).push(entry);
    });

    const { startDate, endDate } = this.diaryService.getRange();

    // Short range with empty day placeholders if hideEmpty is false
    if (showEmptyDays && startDate && endDate && !hideEmpty && !this.diaryService.hasActiveFilters() && endDate.diff(startDate, "days") <= 14) {
      const daysCount = endDate.diff(startDate, "days") + 1;
      for (let i = daysCount - 1; i >= 0; i--) {
        const d = startDate.clone().add(i, "days");
        const dateKey = DateUtils.formatDateKey(d);
        const dayEntries = dayMap.get(dateKey) || [];

        if (dayEntries.length > 0) {
          this.daySection.render(container, d, dayEntries, isTimeline, hideTypeBadge);
        } else {
          DiaryDaySection.renderEmptyDayRow(container, d, this.context, this.plugin);
        }
      }
      return;
    }

    // Standard day grouping (shows all non-empty days)
    [...dayMap.keys()].sort((a, b) => b.localeCompare(a)).forEach((dayKey, index) => {
      const dayEntries = dayMap.get(dayKey);
      const dayMoment = dayEntries[0].moment;
      this.daySection.render(container, dayMoment, dayEntries, isTimeline, hideTypeBadge, index < initiallyOpenDays);
    });
  }

  renderGroupedDays(container, entries) {
    this.renderDays(container, entries, false, false);
  }

}
