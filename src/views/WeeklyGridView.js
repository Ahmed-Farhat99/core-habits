import { GroupCollapseController } from '../components/ui/GroupCollapseController.js';
import { ItemView, setIcon, debounce } from 'obsidian';
import { NoticeService } from '../services/NoticeService.js';
import { VIEW_TYPE_WEEKLY, DEBOUNCE_DELAY_MS, normalizeReflectionType, DEFAULT_HABIT_NOTES_HEADING, BREAKPOINTS } from '../constants.js';
import { Utils } from '../utils/Utils.js';
import { ReflectionPopup } from '../modals/ReflectionPopup.js';
import { StreakCalculator } from '../services/StreakCalculator.js';
import { DateUtils, getNoteByDate, getDailyNoteDate } from '../utils/helpers.js';
import { TooltipHelper } from '../utils/TooltipHelper.js';
import { ProgressionEngine } from '../services/ProgressionEngine.js';
import { HabitCommentPopup } from '../modals/HabitCommentPopup.js';
import { DiaryViewController } from './diary/DiaryViewController.js';
import { StatisticsViewController } from './statistics/StatisticsViewController.js';
import { GridRenderer } from './GridRenderer.js';
import { StatusView } from './StatusView.js';
import { createWeeklyViewContexts } from './WeeklyViewContexts.js';
import { bindTabKeys } from '../components/ui/TabBar.js';

let weeklyPanelSequence = 0;

class WeeklyGridView extends ItemView {
  get isAr() {
    return this.plugin.settings.language === "ar";
  }

  get statisticsController() {
    if (!this._statisticsController) {
      this._statisticsController = new StatisticsViewController(this.viewContexts.statistics);
    }
    return this._statisticsController;
  }

  get diaryController() {
    if (!this._diaryController) {
      this._diaryController = new DiaryViewController(this.viewContexts.diary);
    }
    return this._diaryController;
  }
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentWeekStart = null;
    this._renderedWeekStartDay = this.plugin.settings.weekStartDay;
    this.isTogglingInProgress = false;
    this._pendingToggles = new Set();
    this.activeFilePaths = new Set();
    this.currentDateMode = "gregorian";
    this.currentViewMode = "grid";
    this.diaryViewMode = this.plugin.settings.diaryViewMode || "grouped";
    this.dailyReflectionDays = new Set();
    this.milestoneHit = new Map();
    this.focusedDayIndex = null;
    this.isCompactMode = false;
    this._isClosed = false;

    this.viewContexts = createWeeklyViewContexts(this);
    this._diaryController = null;
    this._statisticsController = null;
    this.gridRenderer = new GridRenderer(this.viewContexts.grid);
    // Load persisted collapse state from plugin data (survives Obsidian restarts)
    // Clean stale entries: only keep IDs that match active habits
    let groups = this.plugin.settings.collapsedGroups || [];
    if (Array.isArray(groups)) {
      const activeIds = new Set(this.plugin.habitManager.getActiveHabits().map(h => h.id));
      groups = groups.filter(id => activeIds.has(id));
      this.plugin.settings.collapsedGroups = groups;
    }
    this.lastWeekRatesCache = new Map();
    this._streakQueue = [];
    this._isCalculatingStreaks = false;
    this.streakCalculator = new StreakCalculator(this.plugin, new Map());
    this.renderToken = 0;
    this._weekLoadGeneration = 0;
    this.initializeWeek();
    this.debouncedRefresh = debounce(
      this.renderWeeklyGrid.bind(this),
      DEBOUNCE_DELAY_MS,
      true,
    );
  }

  queueStreakCalculation(habit, row) {
    if (this._isClosed) return;
    if (typeof IntersectionObserver !== "undefined") {
      if (!this._streakObserver) {
        const token = this.renderToken;
        this._streakObserver = new IntersectionObserver((entries) => {
          if (this._isClosed || this.renderToken !== token) return;
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            this._streakObserver?.unobserve(entry.target);
            const pending = this._visibleStreaks?.get(entry.target);
            this._visibleStreaks?.delete(entry.target);
            if (pending) {
              this._streakQueue.push(pending);
              if (!this._isCalculatingStreaks) void this.processStreakQueue();
            }
          }
        }, { rootMargin: "160px 0px" });
      }
      this._visibleStreaks ||= new Map();
      this._visibleStreaks.set(row, { habit, row });
      this._streakObserver.observe(row);
      return;
    }
    this._streakQueue.push({ habit, row });
    if (!this._isCalculatingStreaks) this.processStreakQueue();
  }

  async processStreakQueue() {
    this._isCalculatingStreaks = true;
    const currentToken = this.renderToken;
    while (this._streakQueue.length > 0) {
      if (this._isClosed || this.renderToken !== currentToken) {
        break; // Abort stale queue
      }
      const { habit, row } = this._streakQueue.shift();
      try {
        const { currentStreak } = await this.streakCalculator.calculate(habit);
        // Yield to main thread so the UI doesn't freeze
        await new Promise(resolve => setTimeout(resolve, 10));
        if (this._isClosed || this.renderToken !== currentToken) break;

        const slot = row.querySelector(".dh-streak-badge-slot");
        if (slot && currentStreak >= 2) {
          const badge = slot.createSpan({
            cls: "dh-streak-badge",
            text: `🔥${currentStreak}`,
          });
          TooltipHelper.set(badge, TooltipHelper.formatStreak(currentStreak, this.plugin.translationManager.t.bind(this.plugin.translationManager), this.isAr));
        }
      } catch (e) {
        console.warn("[Core Habits] Local streak calc failed for", habit.name, e);
      }
    }
    this._isCalculatingStreaks = false;
    if (!this._isClosed && this._streakQueue.length > 0) void this.processStreakQueue();
  }

  getViewType() {
    return VIEW_TYPE_WEEKLY;
  }

  getDisplayText() {
    return "Core Habits";
  }

  getIcon() {
    return "calendar";
  }

  invalidateViewCaches() {
    if (this.lastWeekRatesCache) {
      this.lastWeekRatesCache.clear();
    } else {
      this.lastWeekRatesCache = new Map();
    }
    this.streakCalculator?.contentCache?.clear();
  }

  initializeWeek() {
    const today = window.moment();
    const weekStartDay = this.plugin.settings.weekStartDay;
    const currentDayOfWeek = today.day();
    const daysFromWeekStart = (currentDayOfWeek - weekStartDay + 7) % 7;
    this.currentWeekStart = today.clone().subtract(daysFromWeekStart, "days");
    this.focusedDayIndex = null;
  }

  async goToCurrentWeek() {
    this.initializeWeek();
    await this.renderWeeklyGrid();
  }

  async onOpen() {
    this._isClosed = false;
    this.isCompactMode = this.contentEl.clientWidth > 0 && this.contentEl.clientWidth < BREAKPOINTS.COMPACT;
    await this.renderWeeklyGrid();
    if (this._isClosed || this.plugin._isUnloading) return;

    // ResizeObserver to watch container width changes dynamically
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (let entry of entries) {
          const width = entry.contentRect.width;
          if (width === 0) continue; // Skip hidden/unmounted
          const isCompact = width < BREAKPOINTS.COMPACT;
          if (isCompact !== this.isCompactMode) {
            this.isCompactMode = isCompact;
            this.debouncedRefresh();
          }
        }
      });
      this.resizeObserver.observe(this.contentEl);
    }

    // Live Sync: Listen for modifications only on active files
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this._isClosed || this.plugin._isUnloading) return;
        // Ignore updates during toggle to prevent flicker
        if (this.isTogglingInProgress) return;
        // Ignore updates during settings save to prevent cascade
        if (this.plugin._isSaving) return;

        if (this.activeFilePaths.has(file.path) || (this.currentViewMode === "diary" && getDailyNoteDate(file, this.app, this.plugin.settings))) {
          Utils.debugLog(
            this.plugin,
            `Live Sync: Update triggered by ${file.basename}`,
          );
          this.debouncedRefresh();
        }
      })
    );

    const refreshDiaryForFileChange = (file, oldPath = null) => {
      if (this._isClosed || this.plugin._isUnloading || this.currentViewMode !== "diary") return;
      const isDailyNote = getDailyNoteDate(file, this.app, this.plugin.settings);
      const wasDailyNote = oldPath && getDailyNoteDate({ path: oldPath }, this.app, this.plugin.settings);
      if (isDailyNote || wasDailyNote) this.debouncedRefresh();
    };
    this.registerEvent(this.app.vault.on("create", (file) => refreshDiaryForFileChange(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => refreshDiaryForFileChange(file)));
    this.registerEvent(this.app.vault.on("rename", refreshDiaryForFileChange));

    // Workspace Events: Decoupled service notifications
    if (this.app?.workspace?.on) {
      this.registerEvent(
        this.app.workspace.on("core-habits:cache-invalidated", () => {
          this.invalidateViewCaches();
        })
      );

      this.registerEvent(
        this.app.workspace.on("core-habits:stats-updated", () => {
          if (!this._isClosed && !this.plugin._isUnloading && this.currentViewMode === "dashboard") {
            this.renderWeeklyGrid();
          }
        })
      );
    }
  }

  async onClose() {
    this._isClosed = true;
    this.renderToken++;
    this._weekLoadGeneration++;
    this._streakObserver?.disconnect();
    this._streakObserver = null;
    this._visibleStreaks?.clear();
    this._pendingRender = false;
    this._streakQueue = [];
    this.debouncedRefresh?.cancel?.();
    if (this._pendingRenderTimer) clearTimeout(this._pendingRenderTimer);
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    if (this._visualTimers) {
      this._visualTimers.forEach(clearTimeout);
      this._visualTimers = [];
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this._diaryController && typeof this._diaryController.destroy === "function") {
      this._diaryController.destroy();
      this._diaryController = null;
    }
    if (this._statisticsController && typeof this._statisticsController.destroy === "function") {
      this._statisticsController.destroy();
    }

    // Clean up memory when view is closed
    this.invalidateViewCaches();
    this.dailyStats = {};
    this.activeFilePaths.clear();
    if (this.milestoneHit) this.milestoneHit.clear();
    this.isTogglingInProgress = false;
    this._pendingToggles?.clear();
    this.contentEl.empty();
  }

  // Method to refresh the view when settings change
  async refresh() {
    if (!this.currentWeekStart) this.initializeWeek();
    if (this._renderedWeekStartDay !== this.plugin.settings.weekStartDay) {
      const anchor = this.currentWeekStart.clone().add(3, "days");
      const daysFromWeekStart = (anchor.day() - this.plugin.settings.weekStartDay + 7) % 7;
      this.currentWeekStart = anchor.subtract(daysFromWeekStart, "days");
      this.focusedDayIndex = null;
      this._renderedWeekStartDay = this.plugin.settings.weekStartDay;
    }
    await this.renderWeeklyGrid();
  }

  /** Returns array of 7 day infos for the current week: { dayDate, dateKey, isToday, dayOfWeek }. */
  getWeekDayInfos(weekStart = this.currentWeekStart) {
    const today = window.moment();
    const infos = [];
    for (let i = 0; i < 7; i++) {
      const dayDate = weekStart.clone().add(i, "days");
      infos.push({
        dayDate,
        dateKey: DateUtils.formatDateKey(dayDate),
        isToday: DateUtils.formatDateKey(dayDate) === DateUtils.formatDateKey(today),
        dayOfWeek: dayDate.day(),
      });
    }
    return infos;
  }

  /** Returns the single content container for the weekly view; creates it if missing. */
  getWeeklyContentContainer() {
    if (this._isClosed || this.plugin._isUnloading) return null;
    this.contentEl.classList.add("dh-weekly-query-host");
    if (this._contentContainerEl && this.contentEl.contains(this._contentContainerEl)) {
      return this._contentContainerEl;
    }
    let el = this.contentEl.querySelector('[data-dh-view="weekly-content"]');
    if (!el) {
      el = this.contentEl.createDiv({ cls: "weekly-grid-container daily-habits-plugin" });
      el.setAttribute("data-dh-view", "weekly-content");
    }
    this._contentContainerEl = el;
    return el;
  }

  async renderWeeklyGrid() {
    if (this._isClosed || this.plugin._isUnloading) return;
    if (this._isRendering) {
      this.renderToken++;
      this._streakQueue = [];
      this._streakObserver?.disconnect();
      this._streakObserver = null;
      this._visibleStreaks?.clear();
      this._pendingRender = true;
      return;
    }
    this._isRendering = true;
    const renderToken = ++this.renderToken;
    this._streakQueue = [];
    this._streakObserver?.disconnect();
    this._streakObserver = null;
    this._visibleStreaks?.clear();
    const container = this.getWeeklyContentContainer();
    if (!container) {
      this._isRendering = false;
      return;
    }

    if (!this.plugin.isFullyLoaded) {
      if (this.plugin.startupError) {
        StatusView.renderStartupFailure(container, {
          error: this.plugin.startupError,
          onRetry: async () => {
            const success = await this.plugin.retryStartup();
            if (success && this.refresh) {
              this.refresh();
            }
          },
          t: (k, p) => this.t(k, p),
          isAr: (this.plugin.settings?.language || "en") === "ar",
          backupFolder: `${this.plugin.habitNoteManager?.getRootFolder?.() || "Core Habits"}/.backups`
        });
        this._isRendering = false;
        return;
      }
      const loadingText = this.plugin.translationManager
        ? this.plugin.translationManager.t("loading_habits")
        : "Loading habits...";
      StatusView.renderLoading(container, loadingText);
      this._isRendering = false;
      return;
    }


    try {
      const scrollParent = container.closest(".workspace-leaf-content");
      const scrollTop = scrollParent ? scrollParent.scrollTop : 0;

      // Preload all week data concurrently (only needed for grid and dashboard, not diary)
      if (this.currentViewMode !== "diary") {
        const loaded = await this.loadWeekData(this.currentWeekStart.clone(), renderToken);
        if (loaded === false) return;
        if (this._isClosed || this.plugin._isUnloading || this.renderToken !== renderToken) return;
      }

      // Use a DocumentFragment or off-screen div to prevent flickering during async reads
      const tempContainer = document.createElement("div");
      tempContainer.className = `weekly-grid-container daily-habits-plugin is-${this.currentViewMode}-view`;
      
      this._streakCache = new Map();

      const dir = this.plugin.translationManager.t("direction");
      tempContainer.setAttribute("dir", dir);
      if (dir === "rtl") {
        tempContainer.classList.add("is-rtl");
      } else {
        tempContainer.classList.remove("is-rtl");
      }

      await this.renderWeekHeader(tempContainer);
      if (this._isClosed || this.plugin._isUnloading || this.renderToken !== renderToken) return;

      const viewContentEl = tempContainer.createDiv({
        cls: "dh-view-content",
        attr: {
          id: this._tabPanelId,
          role: "tabpanel",
          "aria-labelledby": `${this._tabPanelId}-${this.currentViewMode}`
        }
      });

      try {
        if (this.currentViewMode === "dashboard") {
          await this.statisticsController.render(viewContentEl);
        } else if (this.currentViewMode === "diary") {
          await this.diaryController.render(viewContentEl);
        } else {
          this.streakCalculator = new StreakCalculator(this.plugin, this._streakCache);
          const today = window.moment();
          const habits = this.plugin.habitManager.getActiveHabits();
          await this.gridRenderer.renderGridTable(viewContentEl, today, habits, this.weekContentCache);
        }
      } catch (subViewErr) {
        console.error("[Core Habits] Subview render error:", subViewErr);
        Utils.debugLog(this.plugin, "Subview render error", subViewErr);
        const errorEl = StatusView.renderError(
          viewContentEl,
          this.plugin.translationManager.t("weekly_view_error") || "Error rendering view",
          "⚠️"
        );
        const retryBtn = errorEl.createEl("button", {
          cls: "dh-btn mod-cta",
          text: this.plugin.translationManager.t("refresh") || "Retry",
        });
        retryBtn.onclick = () => {
          this.renderWeeklyGrid();
        };
      }
      if (this._isClosed || this.plugin._isUnloading || this.renderToken !== renderToken) return;

      // Preserve scroll position of the grid wrapper to prevent jump-to-top on re-render
      const existingWrapper = container.querySelector(".habits-grid-wrapper");
      const wrapperScrollTop = existingWrapper ? existingWrapper.scrollTop : 0;
      const wrapperScrollLeft = existingWrapper ? existingWrapper.scrollLeft : 0;

      // Fast DOM swap after all async rendering is done
      container.empty();
      for (const attr of tempContainer.attributes) {
        container.setAttribute(attr.name, attr.value);
      }
      
      while (tempContainer.firstChild) {
        container.appendChild(tempContainer.firstChild);
      }

      const newWrapper = container.querySelector(".habits-grid-wrapper");
      if (newWrapper) {
        newWrapper.scrollTop = wrapperScrollTop;
        newWrapper.scrollLeft = wrapperScrollLeft;
        requestAnimationFrame(() => {
          if (!this._isClosed && this.renderToken === renderToken && newWrapper) {
            newWrapper.scrollTop = wrapperScrollTop;
            newWrapper.scrollLeft = wrapperScrollLeft;
          }
        });
      }

      if (scrollParent && scrollTop > 0) {
        requestAnimationFrame(() => { if (!this._isClosed && this.renderToken === renderToken) scrollParent.scrollTop = scrollTop; });
      }
    } catch (err) {
      if (this._isClosed || this.plugin._isUnloading) return;
      console.error("[Core Habits] renderWeeklyGrid error:", err);
      Utils.debugLog(this.plugin, "renderWeeklyGrid error", err);
      NoticeService.error(this.plugin.translationManager.t("weekly_view_error"), this.plugin);

      try {
        const errorEl = StatusView.renderError(
          container,
          this.plugin.translationManager.t("weekly_view_error") || "An unexpected error occurred",
          "⚠️"
        );
        const retryBtn = errorEl.createEl("button", {
          cls: "dh-btn mod-cta",
          text: this.plugin.translationManager.t("refresh") || "Retry",
        });
        retryBtn.onclick = () => {
          this.renderWeeklyGrid();
        };
      } catch { /* ignore secondary error */ }
    } finally {
      this._isRendering = false;
      if (this._pendingRender && !this._isClosed && !this.plugin._isUnloading) {
        this._pendingRender = false;
        this._pendingRenderTimer = setTimeout(() => {
          this._pendingRenderTimer = null;
          if (!this._isClosed && !this.plugin._isUnloading) void this.renderWeeklyGrid();
        }, 0);
      }
    }
  }

  async renderWeekHeader(container) {
    this._tabPanelId ||= `dh-weekly-panel-${++weeklyPanelSequence}`;
    // Main Card Container
    const headerCard = container.createDiv({ cls: "weekly-header-controls" });
    const weekEnd = this.currentWeekStart.clone().add(6, "days");

    // --- NAVIGATION TABS ---
    const navTabs = headerCard.createDiv({
      cls: "dh-tabs dh-nav-tabs",
      attr: { role: "tablist", "aria-label": this.plugin.translationManager.t("view_mode") || "View mode" }
    });

    const tabs = [
      { id: "grid", icon: "calendar", label: this.plugin.translationManager.t("tab_weekly_grid") },
      { id: "dashboard", icon: "bar-chart-2", label: this.plugin.translationManager.t("tab_statistics") },
      { id: "diary", icon: "book-open", label: this.plugin.translationManager.t("tab_my_diary") }
    ];

    const tabButtons = {};
    tabs.forEach(tab => {
      const selected = this.currentViewMode === tab.id;
      const tabBtn = navTabs.createEl("button", {
        cls: `dh-tab dh-nav-tab ${selected ? "is-active" : ""}`,
        attr: {
          id: `${this._tabPanelId}-${tab.id}`,
          type: "button",
          role: "tab",
          "aria-controls": this._tabPanelId,
          "aria-selected": String(selected),
          tabindex: selected ? "0" : "-1"
        }
      });
      tabButtons[tab.id] = tabBtn;
      setIcon(tabBtn, tab.icon);
      tabBtn.createSpan({ cls: "dh-nav-tab-label", text: tab.label });

      tabBtn.onclick = async () => {
        if (this.currentViewMode !== tab.id) {
          this.currentViewMode = tab.id;
          await this.renderWeeklyGrid();
        }
      };
    });
    bindTabKeys(navTabs, tabButtons, (tabId) => tabButtons[tabId].click());

    // --- WEEK NAVIGATION ---
    if (this.currentViewMode === "grid") {
      const mainStage = headerCard.createDiv({ cls: "dh-date-navigator-stage" });

      const dir = this.plugin.translationManager.t("direction");
      const prevIcon = dir === "rtl" ? "chevron-right" : "chevron-left";
      const nextIcon = dir === "rtl" ? "chevron-left" : "chevron-right";

      // --- ZONE 1: START ACTIONS (Fixed position: Today + Previous Week) ---
      const startZone = mainStage.createDiv({ cls: "dh-nav-zone dh-nav-zone-start" });

      const todayBtn = startZone.createEl("button", {
        cls: "dh-header-text-btn",
        attr: { type: "button" }
      });
      TooltipHelper.set(todayBtn, this.plugin.translationManager.t("back_to_today"));
      setIcon(todayBtn, "calendar-days");
      todayBtn.createSpan({ cls: "dh-header-action-label", text: this.plugin.translationManager.t("today") });
      todayBtn.onclick = async () => {
        await this.goToCurrentWeek();
      };

      const prevBtn = startZone.createEl("button", {
        cls: "dh-nav-arrow-btn",
        attr: { type: "button" }
      });
      TooltipHelper.set(prevBtn, this.plugin.translationManager.t("grid_previous_week"));
      setIcon(prevBtn, prevIcon);
      prevBtn.onclick = async () => {
        this.currentWeekStart.subtract(7, "days");
        await this.renderWeeklyGrid();
      };

      // --- ZONE 2: CENTER DATE & MODE SWITCH (Flexible & Centered) ---
      const dateWrap = mainStage.createDiv({ cls: "dh-date-title-wrap dh-nav-zone-center" });
      const textWrap = dateWrap.createDiv({ cls: "dh-date-text-wrap" });

      this.dateDisplayEl = textWrap.createSpan({ cls: "dh-date-text" });
      this.dateDisplayEl.setAttribute("data-date-display", "true");
      this.updateDateDisplay(this.dateDisplayEl, weekEnd);

      if (this.plugin.settings.showHijriDate) {
        const modeSwitch = textWrap.createSpan({ cls: "dh-date-mode-pill" });
        const gregorianTab = modeSwitch.createEl("button", {
          cls: "dh-mode-btn-mini",
          text: this.plugin.translationManager.t("grid_gregorian_short"),
          attr: {
            type: "button",
            "aria-label": this.plugin.translationManager.t("grid_gregorian_date"),
            "aria-pressed": this.currentDateMode === "gregorian" ? "true" : "false"
          }
        });
        const hijriTab = modeSwitch.createEl("button", {
          cls: "dh-mode-btn-mini",
          text: this.plugin.translationManager.t("grid_hijri_short"),
          attr: {
            type: "button",
            "aria-label": this.plugin.translationManager.t("grid_hijri_date"),
            "aria-pressed": this.currentDateMode === "hijri" ? "true" : "false"
          }
        });

        if (this.currentDateMode === "gregorian") {
          gregorianTab.addClass("active");
        } else {
          hijriTab.addClass("active");
        }

        gregorianTab.onclick = () => {
          if (this.currentDateMode !== "gregorian") {
            this.currentDateMode = "gregorian";
            gregorianTab.addClass("active");
            hijriTab.removeClass("active");
            gregorianTab.setAttribute("aria-pressed", "true");
            hijriTab.setAttribute("aria-pressed", "false");
            this.updateDateDisplay(this.dateDisplayEl, weekEnd);
          }
        };

        hijriTab.onclick = () => {
          if (this.currentDateMode !== "hijri") {
            this.currentDateMode = "hijri";
            hijriTab.addClass("active");
            gregorianTab.removeClass("active");
            hijriTab.setAttribute("aria-pressed", "true");
            gregorianTab.setAttribute("aria-pressed", "false");
            this.updateDateDisplay(this.dateDisplayEl, weekEnd);
          }
        };
      }

      // --- ZONE 3: END ACTIONS (Fixed position: Next Week + Refresh) ---
      const endZone = mainStage.createDiv({ cls: "dh-nav-zone dh-nav-zone-end" });

      const nextBtn = endZone.createEl("button", {
        cls: "dh-nav-arrow-btn",
        attr: { type: "button" }
      });
      TooltipHelper.set(nextBtn, this.plugin.translationManager.t("grid_next_week"));
      setIcon(nextBtn, nextIcon);
      nextBtn.onclick = async () => {
        this.currentWeekStart.add(7, "days");
        await this.renderWeeklyGrid();
      };

      const refreshBtn = endZone.createEl("button", {
        cls: "dh-header-text-btn",
        attr: { type: "button" },
      });
      setIcon(refreshBtn, "rotate-cw");
      refreshBtn.createSpan({ cls: "dh-header-action-label", text: this.plugin.translationManager.t("refresh") });
      refreshBtn.onclick = async () => {
        if (this._isRefreshing) return;
        this._isRefreshing = true;
        refreshBtn.disabled = true;
        try {
          await this.renderWeeklyGrid();
          NoticeService.success(this.plugin.translationManager.t("refreshed_success"), this.plugin);
        } finally {
          setTimeout(() => {
            if (this._isClosed || this.plugin._isUnloading) return;
            this._isRefreshing = false;
            refreshBtn.disabled = false;
          }, 300);
        }
      };
    }

    headerCard.createDiv({ cls: "weekly-header-progress-container" });
  }

  // Helper to update date display
  updateDateDisplay(element, weekEnd) {
    if (!element) return; // Guard clause

    const hideYear = this.plugin.settings.hideYear;
    const dateFormat = hideYear ? "D MMMM" : "D MMMM YYYY";
    const isAr = this.isAr;

    if (this.currentDateMode === "gregorian") {
      const locale = isAr ? "ar" : "en";
      // Clone and set locale purely for display purposes
      const startDisplay = this.currentWeekStart.clone().locale(locale);
      const endDisplay = weekEnd.clone().locale(locale);
      element.textContent = `${startDisplay.format(dateFormat)} - ${endDisplay.format(dateFormat)}`;
    } else {
      let hijriStart = DateUtils.getHijriDate(this.currentWeekStart, isAr);
      let hijriEnd = DateUtils.getHijriDate(weekEnd, isAr);

      if (hideYear) {
        hijriStart = hijriStart.replace(/[,،]?\s+\d{4}\s*(?:هـ|AH)?$/i, '').trim();
        hijriEnd = hijriEnd.replace(/[,،]?\s+\d{4}\s*(?:هـ|AH)?$/i, '').trim();
      }

      element.empty();
      const hasIndicator = hijriStart.includes("هـ") || hijriStart.includes("AH") || hijriEnd.includes("هـ") || hijriEnd.includes("AH");
      element.createSpan({ cls: "hijri-date-text", text: `${hijriStart} - ${hijriEnd}` });
      if (!hideYear && !hasIndicator) {
        element.createSpan({ text: " " });
        element.createSpan({ cls: "hijri-indicator", text: "هـ" });
      }
    }
  }


  getReflectionTypeMeta(type) {
    const normalized = normalizeReflectionType(type);
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const labels = {
      Good: t("reflection_good"),
      Bad: t("reflection_bad"),
      Lesson: t("reflection_lesson"),
      Idea: t("reflection_idea"),
    };
    return {
      value: normalized,
      label: labels[normalized] || normalized,
      cls: normalized.toLowerCase(),
    };
  }

  getHabitNotesHeading() {
    return this.plugin.settings.habitLogHeading || DEFAULT_HABIT_NOTES_HEADING;
  }

  extractSectionLines(content, heading) {
    return Utils.extractSectionLines(content, heading);
  }

  openReflectionPopup(dayDate) {
    const dateKey = DateUtils.formatDateKey(dayDate);
    new ReflectionPopup(this.app, this.plugin, dayDate, async (text, type) => {
      const savedFile = await this.plugin.habitJournalService.saveReflection(dayDate, text, type);
      this.dailyReflectionDays.add(dateKey);
      if (!this._isClosed && !this.plugin._isUnloading) {
        setTimeout(() => { if (!this._isClosed && !this.plugin._isUnloading) void this.renderWeeklyGrid(); }, 0);
      }
      return savedFile;
    }).open();
  }

  async loadWeekData(weekStart = this.currentWeekStart.clone(), expectedToken = null) {
    const generation = ++this._weekLoadGeneration;
    const reflectionDays = new Set();
    const activeFilePaths = new Set();
    const weekContentCache = new Map();
    const weekDayInfos = this.getWeekDayInfos(weekStart);
    const loadPromises = weekDayInfos.map(async ({ dayDate, dateKey }) => {
      const file = await getNoteByDate(this.app, dayDate, false, this.plugin.settings);
      if (file) {
        activeFilePaths.add(file.path);
        const content = await this.app.vault.cachedRead(file);
        weekContentCache.set(dateKey, content);
        
        if (this.plugin.diaryService?.parseDailyReflectionEntries(content, dayDate, file.path).length > 0) {
          reflectionDays.add(dateKey);
        }
      } else {
        weekContentCache.set(dateKey, null);
      }
    });
    await Promise.all(loadPromises);
    const habits = this.plugin.habitManager.getActiveHabits();
    const dailyStats = await this.plugin.statsService.calculateWeeklyStats(
      habits,
      weekStart,
      weekContentCache
    );
    if (this._isClosed || this.plugin._isUnloading || generation !== this._weekLoadGeneration ||
        (expectedToken !== null && expectedToken !== this.renderToken) ||
        DateUtils.formatDateKey(weekStart) !== DateUtils.formatDateKey(this.currentWeekStart)) return false;
    this.dailyReflectionDays = reflectionDays;
    this.activeFilePaths = activeFilePaths;
    this.weekContentCache = weekContentCache;
    this.dailyStats = dailyStats;
    return true;
  }

  async toggleHabitCompletion(habit, date, targetState) {
    const toggleKey = `${habit.id}:${DateUtils.formatDateKey(date)}`;
    if (this._pendingToggles.has(toggleKey)) return null;
    this._pendingToggles.add(toggleKey);
    this.isTogglingInProgress = true;
    try {
      const wasMissingNote = this.weekContentCache?.get(DateUtils.formatDateKey(date)) === null;
      const didToggle = await this.plugin.habitManager.toggleHabitForDate(date, habit, targetState);
      if (!didToggle) return false;

      // Reload data to recalculate cache & stats
      await this.loadWeekData();
      if (wasMissingNote && !this._isClosed && this.currentViewMode === "grid") {
        await this.renderWeeklyGrid();
      }

      return true;
    } catch (e) {
      console.error("[Core Habits] toggleHabitCompletion error:", e);
      return false;
    } finally {
      this._pendingToggles.delete(toggleKey);
      this.isTogglingInProgress = this._pendingToggles.size > 0;
    }
  }

  async checkMilestone(dateKey) {
    if (this._isClosed || this.plugin._isUnloading) return 0;
    const dailyStats = this.dailyStats;
    if (!dailyStats || !dailyStats[dateKey]) return 0;
    const { completed, total } = dailyStats[dateKey];
    if (total === 0) return 0;
    const percent = Math.round((completed / total) * 100);

    const lastHit = this.milestoneHit.get(dateKey) || 0;

    let level = 0;
    if (percent >= 100) level = 100;
    else if (percent >= 75) level = 75;
    else if (percent >= 50) level = 50;
    else if (percent >= 25) level = 25;

    if (level <= lastHit) return level;
    this.milestoneHit.set(dateKey, level);

    if (level === 100) {
      await this.plugin.audioEngine.playSound({ type: "milestone", level: "complete" });
      if (this._isClosed || this.plugin._isUnloading) return level;
      this.showDayGlow(dateKey);
      this.showCompletionMessage();
    } else if (level === 75) {
      await this.plugin.audioEngine.playSound({ type: "milestone", level: "excellent" });
    } else if (level === 50) {
      await this.plugin.audioEngine.playSound({ type: "milestone", level: "good" });
    } else if (level === 25) {
      await this.plugin.audioEngine.playSound({ type: "milestone", level: "fair" });
    }
    return level;
  }

  showDayGlow(dateKey) {
    const container = this.getWeeklyContentContainer();
    if (!container) return;
    const grid = container.querySelector(".habits-grid");
    if (!grid) return;
    const startDate = this.currentWeekStart.clone();
    for (let i = 0; i < 7; i++) {
      const dayKey = startDate.clone().add(i, "days").locale("en").format("YYYY-MM-DD");
      if (dayKey === dateKey) {
        const cells = grid.querySelectorAll(`[data-day-index="${i}"]`);
        cells.forEach(c => {
          c.addClass("day-complete-glow");
          const t3 = setTimeout(() => {
            c.removeClass("day-complete-glow");
            const timers = (this._visualTimers || []).filter(t => t !== t3);
            this._visualTimers = timers;
          }, 2500);
          const timers = this._visualTimers || [];
          timers.push(t3);
          this._visualTimers = timers;
        });
        break;
      }
    }
  }

  showCompletionMessage() {
    const keys = ["completion_msg_1", "completion_msg_2", "completion_msg_3"];
    const randomKey = keys[Math.floor(Math.random() * keys.length)];
    NoticeService.success(this.plugin.translationManager.t(randomKey), 3000, this.plugin);
  }

  openEditHabitModal(habit) {
    this.plugin.openEditHabit(
      habit,
      async (updatedData) => {
        const merged = { ...habit, ...updatedData };
        const effectiveLevel = updatedData.currentLevel
          || ProgressionEngine.calculateLevel(merged, null, updatedData.levelData);
        updatedData.currentLevel = Math.max(habit.currentLevel || 1, effectiveLevel);
        await this.plugin.habitManager.updateHabit(habit.id, updatedData);
        try { await this.renderWeeklyGrid(); }
        catch (error) { console.warn("[Core Habits] Habit updated, but the weekly view could not refresh:", error); }
        NoticeService.success(this.plugin.translationManager.t("success_updated", { name: updatedData.name }), this.plugin);
      }
    );
  }

  openCommentPopup(habit, date) {
    new HabitCommentPopup(
      this.app,
      this.plugin,
      habit,
      date,
      async (comment) => {
        await this.plugin.habitJournalService.saveHabitComment(habit, date, comment);
        await this.loadWeekData();
        await this.renderWeeklyGrid();
      }
    ).open();
  }

  async openHabitPage(habit) {
    const path = this.plugin.habitNoteManager.getHabitFilePath(habit.name, habit.archived);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file) {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    } else {
      NoticeService.error(this.plugin.translationManager.t("error_habit_file_not_found"), this.plugin);
    }
  }

  async openDailyNote(dayDate) {
    const file = await getNoteByDate(this.app, dayDate, true, this.plugin.settings);
    if (file) {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    }
  }

  toggleGroupCollapse(pid, collapsed) {
    return this.toggleAllGroupsCollapse([pid], collapsed);
  }

  async toggleAllGroupsCollapse(parentIds, collapsed) {
    await GroupCollapseController.persist(this.plugin, parentIds, collapsed);
  }

  async dismissGridHint() {
    this.plugin.settings.hasSeenGridHint = true;
    await this.plugin.saveSettings();
  }
}

export { WeeklyGridView };
