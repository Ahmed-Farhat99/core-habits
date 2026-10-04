import { setIcon, Menu } from 'obsidian';
import { DIARY_PERIODS } from '../../services/DiaryService.js';
import { CustomRangeModal } from '../../modals/CustomRangeModal.js';
import { TooltipHelper } from '../../utils/TooltipHelper.js';
import { showAnchoredMenu } from '../../utils/helpers.js';

export class DiaryHeader {
  constructor(context, app, plugin, diaryService, callbacks = {}) {
    this.context = context;
    this.app = app;
    this.plugin = plugin;
    this.diaryService = diaryService;
    this.callbacks = callbacks;
  }

  showAnchoredMenu(menu, triggerEl) {
    const isRTL = this.plugin.translationManager?.t("direction") === "rtl";
    showAnchoredMenu(menu, triggerEl, isRTL);
  }

  /**
   * Opens the native Obsidian menu for selecting time periods
   * @param {HTMLElement} triggerEl
   * @param {Function} onRefresh
   */
  openPeriodMenu(triggerEl, onRefresh) {
    const t = (k, p) => this.plugin.translationManager?.t(k, p) || k;
    const currentPeriod = this.diaryService.getPeriodType();
    const menu = new Menu();

    const periodOptions = [
      { id: DIARY_PERIODS.WEEK, label: t("period_week") },
      { id: DIARY_PERIODS.TWO_WEEKS, label: t("period_two_weeks") },
      { id: DIARY_PERIODS.MONTH, label: t("period_month") },
      { id: DIARY_PERIODS.QUARTER, label: t("period_quarter") },
      { id: DIARY_PERIODS.ALL, label: t("period_all") }
    ];

    periodOptions.forEach(opt => {
      menu.addItem(item => {
        item.setTitle(opt.label)
          .setChecked(currentPeriod === opt.id)
          .onClick(async () => {
            if (currentPeriod !== opt.id) {
              this.diaryService.setPeriodType(opt.id);
              await onRefresh();
            }
          });
      });
    });

    menu.addSeparator();

    // Custom Range Modal Option
    menu.addItem(item => {
      item.setTitle(t("period_custom"))
        .setIcon("calendar-with-checkmark")
        .setChecked(currentPeriod === DIARY_PERIODS.CUSTOM)
        .onClick(() => {
          const { startDate, endDate } = this.diaryService.getRange();
          new CustomRangeModal(this.app, this.plugin, startDate, endDate, async (s, eRange) => {
            this.diaryService.setCustomRange(s, eRange);
            await onRefresh();
          }).open();
        });
    });

    if (triggerEl) this.showAnchoredMenu(menu, triggerEl);
  }

  /**
   * Opens the native Obsidian menu for view options (grouped, timeline, by type, hide empty)
   * @param {HTMLElement} triggerEl
   * @param {Function} onViewModeChange
   */
  openViewOptionsMenu(triggerEl, onViewModeChange) {
    const t = (k, p) => this.plugin.translationManager?.t(k, p) || k;
    const currentMode = this.context.getDiaryViewMode ? this.context.getDiaryViewMode() : "grouped";
    const hideEmpty = this.diaryService.getHideEmptyDays();
    const menu = new Menu();
    const changeMode = async (mode) => {
      if (mode === currentMode) return;
      if (this.context.setDiaryViewMode) {
        // The owning view already renders after persisting this setting.
        await this.context.setDiaryViewMode(mode);
      } else {
        onViewModeChange();
      }
    };

    // View Modes
    menu.addItem(item => {
      item.setTitle(t("diary_mode_grouped"))
        .setIcon("calendar-days")
        .setChecked(currentMode === "grouped")
        .onClick(() => changeMode("grouped"));
    });

    menu.addItem(item => {
      item.setTitle(t("diary_mode_timeline"))
        .setIcon("list")
        .setChecked(currentMode === "timeline")
        .onClick(() => changeMode("timeline"));
    });

    menu.addItem(item => {
      item.setTitle(t("diary_mode_by_type"))
        .setIcon("layers")
        .setChecked(currentMode === "types")
        .onClick(() => changeMode("types"));
    });

    menu.addSeparator();

    // Toggle Empty Days
    menu.addItem(item => {
      item.setTitle(t("filter_hide_empty"))
        .setIcon("eye-off")
        .setChecked(hideEmpty)
        .onClick(() => {
          this.diaryService.setHideEmptyDays(!hideEmpty);
          onViewModeChange();
        });
    });

    if (triggerEl) this.showAnchoredMenu(menu, triggerEl);
  }

  /**
   * Renders the slim, elegant unified header strip
   * @param {HTMLElement} container
   * @param {Function} onRefresh
   */
  render(container, onRefresh) {
    const t = (k, p) => this.plugin.translationManager?.t(k, p) || k;
    const dir = t("direction");
    const isRTL = dir === "rtl";
    const currentPeriod = this.diaryService.getPeriodType();
    const isAll = currentPeriod === DIARY_PERIODS.ALL;
    const isContainingToday = this.diaryService.isCurrentRangeContainingToday();
    const hasActiveFilters = this.diaryService.hasActiveFilters();
    const activeFilterCount = this.diaryService.getActiveFilterCount();

    const headerStrip = container.createDiv({ cls: "dh-diary-header-strip" });

    // ── 1. Navigation Cluster (Left/Center in RTL) ───────────────────────────
    const navCluster = headerStrip.createDiv({ cls: "dh-diary-nav-cluster" });

    const prevIcon = isRTL ? "chevron-right" : "chevron-left";
    const nextIcon = isRTL ? "chevron-left" : "chevron-right";

    // Previous Chevron
    const prevBtn = navCluster.createEl("button", {
      cls: "dh-nav-arrow-btn",
      attr: { type: "button" }
    });
    TooltipHelper.set(prevBtn, t("previous") || "الفترة السابقة");
    setIcon(prevBtn, prevIcon);
    if (isAll) prevBtn.disabled = true;
    prevBtn.onclick = async () => {
      this.diaryService.navigate(-1);
      await onRefresh();
    };

    // Period Title Trigger Button
    const periodNames = {
      [DIARY_PERIODS.WEEK]: "period_week",
      [DIARY_PERIODS.TWO_WEEKS]: "period_two_weeks",
      [DIARY_PERIODS.MONTH]: "period_month",
      [DIARY_PERIODS.QUARTER]: "period_quarter",
      [DIARY_PERIODS.CUSTOM]: "period_custom",
      [DIARY_PERIODS.ALL]: "period_all"
    };
    const periodName = t(periodNames[currentPeriod] || "period_week");
    const periodRange = this.diaryService.getPeriodDisplayLabel();
    const periodBtn = navCluster.createEl("button", {
      cls: "dh-btn dh-period-menu-trigger",
      attr: { type: "button" }
    });
    TooltipHelper.set(periodBtn, `${t("period_menu_title")}: ${periodName} ${isAll ? "" : periodRange}`.trim());

    periodBtn.createSpan({ cls: "dh-period-preset", text: periodName });
    if (!isAll && periodRange && periodRange !== periodName) {
      periodBtn.createSpan({ cls: "dh-period-label-text", text: periodRange });
    }

    const chevronDown = periodBtn.createSpan({ cls: "dh-period-chevron-down" });
    setIcon(chevronDown, "chevron-down");
    periodBtn.onclick = () => {
      this.openPeriodMenu(periodBtn, onRefresh);
    };

    // Next Chevron
    const nextBtn = navCluster.createEl("button", {
      cls: "dh-nav-arrow-btn",
      attr: { type: "button" }
    });
    TooltipHelper.set(nextBtn, t("next") || "الفترة التالية");
    setIcon(nextBtn, nextIcon);
    if (isAll) nextBtn.disabled = true;
    nextBtn.onclick = async () => {
      this.diaryService.navigate(1);
      await onRefresh();
    };

    // In all-notes mode, Today returns to the current week.
    if (!isContainingToday || isAll) {
      const todayJumpBtn = navCluster.createEl("button", {
        cls: "dh-btn mod-pill-sm dh-today-jump-btn",
        text: t("today"),
        attr: { type: "button" }
      });
      TooltipHelper.set(todayJumpBtn, t("back_to_today"));
      todayJumpBtn.onclick = async () => {
        if (isAll) this.diaryService.setPeriodType(DIARY_PERIODS.WEEK);
        this.diaryService.goToToday();
        await onRefresh();
      };
    }

    // ── 2. Tools & Actions Cluster (Right/Far-side) ──────────────────────────
    const actionsCluster = headerStrip.createDiv({ cls: "dh-diary-actions-cluster" });

    // Search Toggle Button
    const searchBtn = actionsCluster.createEl("button", {
      cls: `dh-btn dh-header-text-btn dh-search-toggle-btn ${hasActiveFilters ? "has-active-filter" : ""}`,
      attr: { type: "button" }
    });
    this._searchBtn = searchBtn;
    setIcon(searchBtn, "search");
    TooltipHelper.set(searchBtn, t("diary_search_filters"));
    searchBtn.createSpan({ cls: "dh-diary-search-label", text: t("diary_search_filters") });

    if (hasActiveFilters) {
      searchBtn.createSpan({
        cls: "dh-filter-badge-dot",
        text: String(activeFilterCount)
      });
    }

    searchBtn.onclick = () => {
      if (this.callbacks.onToggleFilterTray) {
        this.callbacks.onToggleFilterTray();
      }
    };

    // View Options Menu Button
    const viewOptionsBtn = actionsCluster.createEl("button", {
      cls: "dh-btn dh-icon-btn dh-view-options-btn mod-icon",
      attr: { type: "button" }
    });
    setIcon(viewOptionsBtn, "sliders-horizontal");
    TooltipHelper.set(viewOptionsBtn, t("view_options"));
    viewOptionsBtn.onclick = () => {
      this.openViewOptionsMenu(viewOptionsBtn, () => {
        if (this.callbacks.onViewModeChange) {
          this.callbacks.onViewModeChange();
        }
      });
    };

    // Primary CTA: Add Today Reflection
    const addTodayBtn = actionsCluster.createEl("button", {
      cls: "dh-btn mod-cta dh-diary-add-btn",
      text: `+ ${t("diary_add_today_btn")}`,
      attr: { type: "button" }
    });
    addTodayBtn.onclick = () => {
      this.context.openReflectionPopup(window.moment());
    };
  }

  /**
   * Updates the visual indicator badge on the search toggle button
   */
  updateFilterBadge() {
    if (!this._searchBtn) return;
    const hasActiveFilters = this.diaryService.hasActiveFilters();
    const count = this.diaryService.getActiveFilterCount();

    if (hasActiveFilters) {
      this._searchBtn.addClass("has-active-filter");
      let badge = this._searchBtn.querySelector(".dh-filter-badge-dot");
      if (!badge) {
        badge = this._searchBtn.createSpan({ cls: "dh-filter-badge-dot" });
      }
      badge.textContent = String(count);
    } else {
      this._searchBtn.removeClass("has-active-filter");
      const badge = this._searchBtn.querySelector(".dh-filter-badge-dot");
      if (badge) badge.remove();
    }
  }

  updateSearchExpanded(isOpen) {
    this._searchBtn?.setAttribute("aria-expanded", isOpen ? "true" : "false");
  }
}
