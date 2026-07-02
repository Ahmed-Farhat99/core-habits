import { ItemView, setIcon, Notice, debounce } from 'obsidian';
import { VIEW_TYPE_WEEKLY, DEBOUNCE_DELAY_MS, normalizeReflectionType, DEFAULT_REFLECTION_HEADING, DEFAULT_HABIT_NOTES_HEADING } from '../constants.js';
import { Utils } from '../utils/Utils.js';
import { ReflectionPopup } from '../modals/ReflectionPopup.js';
import { StreakCalculator } from '../services/StreakCalculator.js';
import { DateUtils, getNoteByDate, calculateCurrentLevel } from '../utils/helpers.js';
import { AddHabitModal } from '../modals/AddHabitModal.js';
import { HabitCommentPopup } from '../modals/HabitCommentPopup.js';
import { DiaryRenderer } from './DiaryRenderer.js';
import { DashboardRenderer } from './DashboardRenderer.js';
import { GridRenderer } from './GridRenderer.js';
import { StatusView } from './StatusView.js';

class WeeklyGridView extends ItemView {
  get isAr() {
    return this.plugin.settings.language === "ar";
  }
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentWeekStart = null;
    this.isProcessing = false;
    this.isTogglingInProgress = false;
    this.activeFilePaths = new Set();
    this.currentDateMode = "gregorian";
    this.currentViewMode = "grid";
    this.diaryViewMode = this.plugin.settings.diaryViewMode || "grouped";
    this.dailyReflectionDays = new Set();
    this.milestoneHit = new Map();
    this.focusedDayIndex = null;
    this.isCompactMode = false;

    const viewContext = {
      app: this.app,
      plugin: this.plugin,
      getComponent: () => this,
      isAr: () => this.isAr,
      getWeekStart: () => this.currentWeekStart,
      setWeekStart: (date) => { this.currentWeekStart = date; },
      getDiaryViewMode: () => this.diaryViewMode,
      setDiaryViewMode: async (mode) => {
        this.diaryViewMode = mode;
        this.plugin.settings.diaryViewMode = mode;
        await this.plugin.saveSettings({ silent: true });
        await this.renderWeeklyGrid();
      },
      openReflectionPopup: (dayDate) => this.openReflectionPopup(dayDate),
      parseDailyReflectionEntries: (content, dateMoment, path) => this.parseDailyReflectionEntries(content, dateMoment, path),
      getReflectionTypeMeta: (type) => this.getReflectionTypeMeta(type),
      renderWeeklyGrid: () => this.renderWeeklyGrid(),
      
      // Reflection and Active Paths updates
      updateReflectionDaysAndActiveFiles: (reflectionDays, activePaths) => {
        this.dailyReflectionDays = reflectionDays;
        this.activeFilePaths = activePaths;
      },
      getReflectionDays: () => this.dailyReflectionDays,
      getActiveFilePaths: () => this.activeFilePaths,
      
      // Cache / Stats (Dashboard)
      getLastFourWeeksCache: () => this._lastFourWeeksCache,
      setLastFourWeeksCache: (cache) => { this._lastFourWeeksCache = cache; },
      
      // Grid specific
      getDailyStats: () => this.dailyStats,
      setDailyStats: (stats) => { this.dailyStats = stats; },
      getWeekContentCache: () => this.weekContentCache,
      setWeekContentCache: (cache) => { this.weekContentCache = cache; },
      isClosed: () => this._isClosed,
      isProcessing: () => this.isProcessing,
      setProcessing: (val) => { this.isProcessing = val; },
      isTogglingInProgress: () => this.isTogglingInProgress,
      setTogglingInProgress: (val) => { this.isTogglingInProgress = val; },
      getIgnoreModifyFiles: () => this.ignoreModifyFiles,
      getVisualTimers: () => this._visualTimers,
      setVisualTimers: (timers) => { this._visualTimers = timers; },
      getWeeklyContentContainer: () => this.getWeeklyContentContainer(),
      getRenderToken: () => this.renderToken,
      getWeekDayInfos: () => this.getWeekDayInfos(),
      queueStreakCalculation: (habit, row) => this.queueStreakCalculation(habit, row),
      getHabitNotesHeading: () => this.getHabitNotesHeading(),
      extractSectionLines: (content, heading) => this.extractSectionLines(content, heading),
      isCompactMode: () => this.isCompactMode,
      getFocusedDayIndex: () => this.focusedDayIndex,
      setFocusedDayIndex: (idx) => { this.focusedDayIndex = idx; },
      
      // Added for decoupling
      getStreakCalculator: () => this.streakCalculator,
      getRefreshTimer: () => this._refreshTimer,
      setRefreshTimer: (timer) => { this._refreshTimer = timer; },
      getLastWeekRatesCache: () => this.lastWeekRatesCache,
      getMilestoneHit: () => this.milestoneHit,
      toggleHabitCompletion: (habit, date, targetState) => this.toggleHabitCompletion(habit, date, targetState),
      checkMilestone: (dateKey) => this.checkMilestone(dateKey),
      getWeeklyDiaryEntries: () => this.getWeeklyDiaryEntries(),
      openEditHabitModal: (habit) => this.openEditHabitModal(habit),
      openCommentPopup: (habit, date) => this.openCommentPopup(habit, date),
      openHabitPage: (habit) => this.openHabitPage(habit),
      openDailyNote: (date) => this.openDailyNote(date),
      toggleGroupCollapse: (pid, collapsed) => this.toggleGroupCollapse(pid, collapsed),
      dismissGridHint: () => this.dismissGridHint()
    };

    this.diaryRenderer = new DiaryRenderer(viewContext);
    this.dashboardRenderer = new DashboardRenderer(viewContext);
    this.gridRenderer = new GridRenderer(viewContext);
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
    this.streakContentCache = new Map();
    this.streakCalculator = new StreakCalculator(this.plugin, this.streakContentCache);
    this.ignoreModifyFiles = new Set();
    this.renderToken = 0;
    this.initializeWeek();
    this.debouncedRefresh = debounce(
      this.renderWeeklyGrid.bind(this),
      DEBOUNCE_DELAY_MS,
      true,
    );
  }

  queueStreakCalculation(habit, row) {
    this._streakQueue.push({ habit, row });
    if (!this._isCalculatingStreaks) this.processStreakQueue();
  }

  async processStreakQueue() {
    this._isCalculatingStreaks = true;
    const currentToken = this.renderToken;
    while (this._streakQueue.length > 0) {
      if (this.renderToken !== currentToken) {
        break; // Abort stale queue
      }
      const { habit, row } = this._streakQueue.shift();
      try {
        const { currentStreak } = await this.streakCalculator.calculate(habit);
        // Yield to main thread so the UI doesn't freeze
        await new Promise(resolve => setTimeout(resolve, 10));

        const slot = row.querySelector(".dh-streak-badge-slot");
        if (slot && currentStreak >= 2) {
          const badge = slot.createSpan({
            cls: "dh-streak-badge",
            text: `🔥${currentStreak}`,
          });
          badge.title = this.plugin.translationManager.t("streak_title", { streak: currentStreak });
        }
      } catch (e) {
        console.warn("[Core Habits] Local streak calc failed for", habit.name, e);
      }
    }
    this._isCalculatingStreaks = false;
  }

  getViewType() {
    return VIEW_TYPE_WEEKLY;
  }

  getDisplayText() {
    return "Weekly Habits";
  }

  getIcon() {
    return "calendar";
  }

  initializeWeek() {
    const today = window.moment();
    const weekStartDay = this.plugin.settings.weekStartDay;
    const currentDayOfWeek = today.day();
    const daysFromWeekStart = (currentDayOfWeek - weekStartDay + 7) % 7;
    this.currentWeekStart = today.clone().subtract(daysFromWeekStart, "days");
  }

  async onOpen() {
    this.isCompactMode = this.contentEl.clientWidth > 0 && this.contentEl.clientWidth < 500;
    await this.renderWeeklyGrid();

    // ResizeObserver to watch container width changes dynamically
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (let entry of entries) {
          const width = entry.contentRect.width;
          if (width === 0) continue; // Skip hidden/unmounted
          const isCompact = width < 500;
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
        // Ignore updates during toggle to prevent flicker
        if (this.isTogglingInProgress) return;
        // Ignore updates during settings save to prevent cascade
        if (this.plugin._isSaving) return;

        if (this.ignoreModifyFiles.has(file.path)) {
          this.ignoreModifyFiles.delete(file.path);
          return;
        }

        if (this.activeFilePaths.has(file.path)) {
          Utils.debugLog(
            this.plugin,
            `Live Sync: Update triggered by ${file.basename}`,
          );
          this.debouncedRefresh();
        }
      }),
    );
  }

  async onClose() {
    this._isClosed = true;
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    if (this._visualTimers) {
      this._visualTimers.forEach(clearTimeout);
      this._visualTimers = [];
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Clean up memory when view is closed
    this.dailyStats = {};
    this.activeFilePaths.clear();
    if (this.milestoneHit) this.milestoneHit.clear();
    this.isProcessing = false;
    this.isTogglingInProgress = false;
    this.contentEl.empty();
  }

  // Method to refresh the view when settings change
  async refresh() {
    await this.renderWeeklyGrid();
  }

  /** Returns array of 7 day infos for the current week: { dayDate, dateKey, isToday, dayOfWeek }. */
  getWeekDayInfos() {
    const today = window.moment();
    const infos = [];
    for (let i = 0; i < 7; i++) {
      const dayDate = this.currentWeekStart.clone().add(i, "days");
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
    if (this._isRendering) return;
    this._isRendering = true;
    const container = this.getWeeklyContentContainer();
    if (!container) {
      this._isRendering = false;
      return;
    }

    if (!this.plugin.isFullyLoaded) {
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

      // Preload all week data concurrently
      await this.loadWeekData();

      // Use a DocumentFragment or off-screen div to prevent flickering during async reads
      const tempContainer = document.createElement("div");
      tempContainer.className = "weekly-grid-container daily-habits-plugin";
      
      this._streakCache = new Map();
      this._streakQueue = [];
      this.renderToken = Date.now();

      const dir = this.plugin.translationManager.t("direction");
      tempContainer.setAttribute("dir", dir);
      if (dir === "rtl") {
        tempContainer.classList.add("is-rtl");
      } else {
        tempContainer.classList.remove("is-rtl");
      }

      await this.renderWeekHeader(tempContainer);

      const viewContentEl = tempContainer.createDiv({ cls: "dh-view-content" });

      if (this.currentViewMode === "dashboard") {
        await this.dashboardRenderer.render(viewContentEl);
      } else if (this.currentViewMode === "diary") {
        await this.diaryRenderer.render(viewContentEl);
      } else {
        this.streakCalculator = new StreakCalculator(this.plugin, this._streakCache);
        const today = window.moment();
        const habits = this.plugin.habitManager.getActiveHabits();
        await this.gridRenderer.renderGridTable(viewContentEl, today, habits, this.weekContentCache);
      }


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
          if (newWrapper) {
            newWrapper.scrollTop = wrapperScrollTop;
            newWrapper.scrollLeft = wrapperScrollLeft;
          }
        });
      }

      if (scrollParent && scrollTop > 0) {
        requestAnimationFrame(() => { scrollParent.scrollTop = scrollTop; });
      }
    } catch (err) {
      Utils.debugLog(this.plugin, "renderWeeklyGrid error", err);
      new Notice(this.plugin.translationManager.t("weekly_view_error"));
      try {
        this.app.vault.adapter.write("weekly_error.txt", err.stack || err.toString());
      } catch { /* ignore */ }
    } finally {
      this._isRendering = false;
    }
  }

  async renderWeekHeader(container) {
    // Main Card Container
    const headerCard = container.createDiv({ cls: "weekly-header-controls" });
    const weekEnd = this.currentWeekStart.clone().add(6, "days");

    // --- NAVIGATION TABS ---
    const navTabs = headerCard.createDiv({ cls: "dh-nav-tabs" });

    const tabs = [
      { id: "grid", icon: "calendar", label: this.plugin.translationManager.t("tab_weekly_grid") },
      { id: "dashboard", icon: "bar-chart-2", label: this.plugin.translationManager.t("tab_statistics") },
      { id: "diary", icon: "book-open", label: this.plugin.translationManager.t("tab_my_diary") }
    ];

    tabs.forEach(tab => {
      const tabBtn = navTabs.createEl("button", {
        cls: `dh-btn dh-nav-tab ${this.currentViewMode === tab.id ? "is-active" : ""}`,
      });
      setIcon(tabBtn, tab.icon);
      tabBtn.createSpan({ cls: "dh-nav-tab-label", text: tab.label });

      tabBtn.onclick = async () => {
        if (this.currentViewMode !== tab.id) {
          this.currentViewMode = tab.id;
          await this.renderWeeklyGrid();
        }
      };
    });

    // --- WEEK NAVIGATION ---
    if (this.currentViewMode === "grid" || this.currentViewMode === "diary") {
      const mainStage = headerCard.createDiv({ cls: "dh-date-navigator-stage" });

      const dir = this.plugin.translationManager.t("direction");
      const prevIcon = dir === "rtl" ? "chevron-right" : "chevron-left";
      const nextIcon = dir === "rtl" ? "chevron-left" : "chevron-right";

      // 1. زر "اليوم" (اليمن في RTL)
      const todayBtn = mainStage.createEl("button", {
        cls: "dh-btn dh-header-text-btn",
        title: this.plugin.translationManager.t("back_to_today")
      });
      todayBtn.createSpan({ text: this.plugin.translationManager.t("today") });

      todayBtn.onclick = async () => {
        this.initializeWeek();
        await this.renderWeeklyGrid();
      };

      // 2. حاوية التاريخ (الوسط)
      const dateWrap = mainStage.createDiv({ cls: "dh-date-title-wrap" });

      const prevBtn = dateWrap.createEl("button", { cls: "dh-btn dh-nav-arrow-btn mod-icon" });
      setIcon(prevBtn, prevIcon);
      prevBtn.onclick = async () => {
        this.currentWeekStart.subtract(7, "days");
        await this.renderWeeklyGrid();
      };

      const textWrap = dateWrap.createDiv({ cls: "dh-date-text-wrap" });
      this.dateDisplayEl = textWrap.createSpan({ cls: "dh-date-text" });
      this.dateDisplayEl.setAttribute("data-date-display", "true");
      this.updateDateDisplay(this.dateDisplayEl, weekEnd);

      if (this.plugin.settings.showHijriDate) {
        const modeSwitch = textWrap.createSpan({ cls: "dh-date-mode-pill" });
        modeSwitch.createSpan({ text: "[" });
        const gregorianTab = modeSwitch.createSpan({ cls: "dh-mode-btn-mini", text: this.plugin.translationManager.t("gregorian_abbr") });
        modeSwitch.createSpan({ text: " | " });
        const hijriTab = modeSwitch.createSpan({ cls: "dh-mode-btn-mini", text: this.plugin.translationManager.t("hijri_abbr") });
        modeSwitch.createSpan({ text: "]" });

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
            this.updateDateDisplay(this.dateDisplayEl, weekEnd);
          }
        };

        hijriTab.onclick = () => {
          if (this.currentDateMode !== "hijri") {
            this.currentDateMode = "hijri";
            hijriTab.addClass("active");
            gregorianTab.removeClass("active");
            this.updateDateDisplay(this.dateDisplayEl, weekEnd);
          }
        };
      }

      const nextBtn = dateWrap.createEl("button", { cls: "dh-btn dh-nav-arrow-btn mod-icon" });
      setIcon(nextBtn, nextIcon);
      nextBtn.onclick = async () => {
        this.currentWeekStart.add(7, "days");
        await this.renderWeeklyGrid();
      };

      // 3. زر "تحديث" (اليسار في RTL)
      const refreshBtn = mainStage.createEl("button", {
        cls: "dh-btn dh-header-text-btn",
        title: this.plugin.translationManager.t("refresh_title"),
      });
      refreshBtn.createSpan({ text: this.plugin.translationManager.t("refresh") });
      refreshBtn.onclick = async () => {
        await this.renderWeeklyGrid();
        new Notice(this.plugin.translationManager.t("refreshed_success"));
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

  getReflectionHeading() {
    return this.plugin.settings.reflectionHeading || DEFAULT_REFLECTION_HEADING;
  }

  getHabitNotesHeading() {
    return this.plugin.settings.habitLogHeading || DEFAULT_HABIT_NOTES_HEADING;
  }

  extractSectionLines(content, heading) {
    return Utils.extractSectionLines(content, heading);
  }

  parseDailyReflectionEntries(content, dateMoment, path = "") {
    const lines = this.extractSectionLines(content, this.getReflectionHeading());
    const entries = [];
    const dateKey = DateUtils.formatDateKey(dateMoment);

    lines.forEach((line, index) => {
      if (!line.startsWith("-")) return;

      const match = line.match(/^-\s+(?:(\d{1,2}:\d{2})\s+)?(?:\[type::\s*([^\]]+)\]\s*)?(.*)$/);
      if (!match) return;

      const time = match[1] || "";
      const type = normalizeReflectionType(match[2]);
      const text = (match[3] || "").trim();
      if (!text) return;

      entries.push({
        date: dateKey,
        dateKey,
        time,
        type,
        text,
        path,
        moment: dateMoment.clone(),
        timestamp: dateMoment.clone().startOf("day").valueOf() + index,
      });
    });

    return entries;
  }



  openReflectionPopup(dayDate) {
    const dateKey = DateUtils.formatDateKey(dayDate);
    new ReflectionPopup(this.app, this.plugin, dayDate, async (text, type) => {
      const savedFile = await this.plugin.habitCommentRepository.injectReflection(dayDate, text, type);
      this.dailyReflectionDays.add(dateKey);
      setTimeout(() => this.renderWeeklyGrid(), 0);
      return savedFile;
    }).open();
  }

  async loadWeekData() {
    this.weeklyDiaryEntries = [];
    this.dailyReflectionDays.clear();
    this.activeFilePaths.clear();
    this.weekContentCache = new Map();

    const weekDayInfos = this.getWeekDayInfos();
    const loadPromises = weekDayInfos.map(async ({ dayDate, dateKey }) => {
      const file = await getNoteByDate(this.app, dayDate, false, this.plugin.settings);
      if (file) {
        this.activeFilePaths.add(file.path);
        const content = await this.app.vault.cachedRead(file);
        this.weekContentCache.set(dateKey, content);
        
        // Parse reflections
        const dayEntries = this.parseDailyReflectionEntries(content, dayDate, file.path);
        if (dayEntries.length > 0) {
          this.dailyReflectionDays.add(dateKey);
          this.weeklyDiaryEntries.push(...dayEntries);
        }
      } else {
        this.weekContentCache.set(dateKey, "");
      }
    });
    await Promise.all(loadPromises);

    // Sort entries by timestamp (timeline order)
    this.weeklyDiaryEntries.sort((a, b) => b.timestamp - a.timestamp);

    // Calculate weekly stats
    const habits = this.plugin.habitManager.getActiveHabits();
    this.dailyStats = await this.plugin.statsService.calculateWeeklyStats(
      habits,
      this.currentWeekStart,
      this.weekContentCache
    );
  }

  async toggleHabitCompletion(habit, date, targetState) {
    this.isTogglingInProgress = true;
    try {
      // Ensure habits checklist exists in the daily note BEFORE toggling
      await this.plugin.habitManager.ensureHabitsInNote(date, habit, true);

      const file = await getNoteByDate(this.app, date, true, this.plugin.settings);
      if (!file) return false;

      // Add to ignore modify list to prevent double rendering from live sync modify event
      this.ignoreModifyFiles.add(file.path);

      await this.plugin.habitManager.toggleHabitInNote(file, habit, targetState);

      // Reload data to recalculate cache & stats
      await this.loadWeekData();

      return true;
    } catch (e) {
      console.error("[Core Habits] toggleHabitCompletion error:", e);
      return false;
    } finally {
      this.isTogglingInProgress = false;
    }
  }

  async checkMilestone(dateKey) {
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
    new Notice(this.plugin.translationManager.t(randomKey), 3000);
  }

  getWeeklyDiaryEntries() {
    return this.weeklyDiaryEntries || [];
  }

  openEditHabitModal(habit) {
    new AddHabitModal(
      this.app,
      this.plugin,
      async (updatedData) => {
        try {
          if (updatedData.levelData) updatedData.currentLevel = calculateCurrentLevel(updatedData.levelData);
          await this.plugin.habitManager.updateHabit(habit.id, updatedData);
          await this.renderWeeklyGrid();
          new Notice(this.plugin.translationManager.t("success_updated", { name: updatedData.name }));
        } catch (e) {
          new Notice(`❌ Error: ${e.message}`);
        }
      },
      habit
    ).open();
  }

  openCommentPopup(habit, date) {
    new HabitCommentPopup(
      this.app,
      this.plugin,
      habit,
      date,
      async (comment) => {
        await this.plugin.habitCommentRepository.upsertCommentForHabitDate(habit, date, comment);
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
      new Notice(this.plugin.translationManager.t("error_habit_file_not_found"));
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
    if (collapsed) {
      if (!this.plugin.settings.collapsedGroups.includes(pid)) {
        this.plugin.settings.collapsedGroups.push(pid);
      }
    } else {
      this.plugin.settings.collapsedGroups = this.plugin.settings.collapsedGroups.filter(id => id !== pid);
    }
    this.plugin.saveSettings({ silent: true });
  }

  async dismissGridHint() {
    this.plugin.settings.hasSeenGridHint = true;
    await this.plugin.saveSettings();
  }



}

export { WeeklyGridView };