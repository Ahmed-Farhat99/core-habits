import { ItemView, setIcon, Notice, debounce, Modal } from 'obsidian';
import { VIEW_TYPE_WEEKLY, DAY_KEYS, resolveHabitColorHex, DEBOUNCE_DELAY_MS, normalizeReflectionType, DEFAULT_REFLECTION_HEADING, DEFAULT_HABIT_NOTES_HEADING } from '../constants.js';
import { Utils } from '../utils/Utils.js';
import { AddHabitModal } from '../modals/AddHabitModal.js';
import { HabitCommentPopup } from '../modals/HabitCommentPopup.js';
import { ReflectionPopup } from '../modals/ReflectionPopup.js';
import { StreakCalculator } from '../services/StreakCalculator.js';
import { getNoteByDate, toggleHabit, findHabitEntry, DateUtils, TextUtils, calculateCurrentLevel, buildHierarchyLabels, injectHabitCommentIntoDailyNote, injectReflectionIntoDailyNote } from '../utils/helpers.js';
import { DiaryRenderer } from './DiaryRenderer.js';
import { DashboardRenderer } from './DashboardRenderer.js';

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
    this.previousCellState = new Map();
    this.previousSkipState = new Map();
    this.currentDateMode = "gregorian";
    this.currentViewMode = "grid";
    this.diaryViewMode = this.plugin.settings.diaryViewMode || "grouped";
    this.dailyReflectionDays = new Set();
    this.diaryRenderer = new DiaryRenderer(this);
    this.dashboardRenderer = new DashboardRenderer(this);
    // Load persisted collapse state from plugin data (survives Obsidian restarts)
    // Migration: convert old ":settings_expanded" keys to new ":expanded" format
    let groups = this.plugin.settings.collapsedGroups || [];
    if (Array.isArray(groups)) {
      groups = groups.map(key => key.replace(":settings_expanded", ":expanded"));
      // Clean stale entries: only keep IDs that match active habits
      const activeIds = new Set(this.plugin.habitManager.getActiveHabits().map(h => h.id));
      groups = groups.filter(key => {
        const habitId = key.replace(":expanded", "");
        return activeIds.has(habitId);
      });
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

  queueStreakCalculation(habit, row, isAr) {
    this._streakQueue.push({ habit, row, isAr });
    if (!this._isCalculatingStreaks) this.processStreakQueue();
  }

  async processStreakQueue() {
    this._isCalculatingStreaks = true;
    const currentToken = this.renderToken;
    while (this._streakQueue.length > 0) {
      if (this.renderToken !== currentToken) {
        break; // Abort stale queue
      }
      const { habit, row, isAr } = this._streakQueue.shift();
      try {
        const { currentStreak } = await this.streakCalculator.calculate(habit);
        // Yield to main thread so the UI doesn't freeze
        await new Promise(resolve => setTimeout(resolve, 10));

        const slot = row.querySelector(".dh-streak-badge-slot");
        if (slot && currentStreak >= 2) {
          const dayWord = isAr ? "يوم" : (currentStreak === 1 ? "day" : "days");
          const badge = slot.createSpan({
            cls: "dh-streak-badge",
            text: `🔥${currentStreak}`,
          });
          badge.title = isAr
            ? `سلسلة الاستمرار: ${currentStreak} ${dayWord} متواصل`
            : `Streak: ${currentStreak} consecutive ${dayWord}`;
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
    await this.renderWeeklyGrid();

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

    // Clean up memory when view is closed
    this.dailyStats = {};
    this.previousCellState.clear();
    this.previousSkipState.clear();
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
      el = this.contentEl.createDiv({ cls: "weekly-grid-container" });
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

    try {
      const scrollParent = container.closest(".workspace-leaf-content");
      const scrollTop = scrollParent ? scrollParent.scrollTop : 0;

      // Use a DocumentFragment or off-screen div to prevent flickering during async reads
      const tempContainer = document.createElement("div");
      tempContainer.className = "weekly-grid-container";
      
      this._streakCache = new Map();
      this.previousCellState.clear();
      this.previousSkipState.clear();
      this._streakQueue = [];
      this.renderToken = Date.now();

      const isAr = this.isAr;
      if (isAr) {
        tempContainer.setAttribute("dir", "rtl");
        tempContainer.classList.add("is-rtl");
      } else {
        tempContainer.setAttribute("dir", "ltr");
        tempContainer.classList.remove("is-rtl");
      }

      await this.renderWeekHeader(tempContainer, isAr);

      if (this.currentViewMode === "dashboard") {
        await this.dashboardRenderer.render(tempContainer);
      } else if (this.currentViewMode === "diary") {
        await this.diaryRenderer.render(tempContainer);
      } else {
        this.streakCalculator = new StreakCalculator(this.plugin, this._streakCache);
        const today = window.moment();
        await this.renderGridTable(tempContainer, today);
      }

      // Fast DOM swap after all async rendering is done
      container.empty();
      container.className = tempContainer.className;
      if (isAr) {
        container.setAttribute("dir", "rtl");
      } else {
        container.setAttribute("dir", "ltr");
      }
      
      while (tempContainer.firstChild) {
        container.appendChild(tempContainer.firstChild);
      }

      if (scrollParent && scrollTop > 0) {
        requestAnimationFrame(() => { scrollParent.scrollTop = scrollTop; });
      }
    } catch (err) {
      Utils.debugLog(this.plugin, "renderWeeklyGrid error", err);
      const isAr = this.isAr;
      new Notice(isAr ? "⚠️ خطأ في عرض الأسبوع" : "⚠️ Weekly view error");
      try {
        this.app.vault.adapter.write("weekly_error.txt", err.stack || err.toString());
      } catch { /* ignore */ }
    } finally {
      this._isRendering = false;
    }
  }

  async renderWeekHeader(container, isAr) {
    // Main Card Container
    const headerCard = container.createDiv({ cls: "weekly-header-controls" });
    const weekEnd = this.currentWeekStart.clone().add(6, "days");

    // --- NAVIGATION TABS ---
    const navTabs = headerCard.createDiv({ cls: "dh-nav-tabs" });

    const tabs = [
      { id: "grid", icon: "calendar", label: isAr ? "الجدول الأسبوعي" : "Weekly Grid" },
      { id: "dashboard", icon: "bar-chart-2", label: isAr ? "الإحصائيات" : "Statistics" },
      { id: "diary", icon: "book-open", label: isAr ? "يومياتي" : "My Diary" }
    ];

    tabs.forEach(tab => {
      const tabBtn = navTabs.createEl("button", {
        cls: `dh-nav-tab ${this.currentViewMode === tab.id ? "is-active" : ""}`,
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

      const prevIcon = isAr ? "chevron-right" : "chevron-left";
      const nextIcon = isAr ? "chevron-left" : "chevron-right";

      // 1. زر "اليوم" (اليمن في RTL)
      const todayBtn = mainStage.createEl("button", {
        cls: "dh-header-text-btn",
        title: isAr ? "العودة لليوم الحالي" : "Back to Today"
      });
      todayBtn.createSpan({ text: isAr ? "اليوم" : "Today" });

      todayBtn.onclick = async () => {
        this.initializeWeek();
        await this.renderWeeklyGrid();
      };

      // 2. حاوية التاريخ (الوسط)
      const dateWrap = mainStage.createDiv({ cls: "dh-date-title-wrap" });

      const prevBtn = dateWrap.createEl("button", { cls: "dh-nav-arrow-btn" });
      setIcon(prevBtn, prevIcon);
      prevBtn.onclick = async () => {
        this.currentWeekStart.subtract(7, "days");
        await this.renderWeeklyGrid();
      };

      const textWrap = dateWrap.createDiv({ cls: "dh-date-text-wrap" });
      this.dateDisplayEl = textWrap.createSpan({ cls: "dh-date-text" });
      this.dateDisplayEl.setAttribute("data-date-display", "true");
      this.updateDateDisplay(this.dateDisplayEl, isAr, weekEnd);

      if (this.plugin.settings.showHijriDate) {
        const modeSwitch = textWrap.createSpan({ cls: "dh-date-mode-pill" });
        modeSwitch.createSpan({ text: "[" });
        const gregorianTab = modeSwitch.createSpan({ cls: "dh-mode-btn-mini", text: isAr ? "م" : "G" });
        modeSwitch.createSpan({ text: " | " });
        const hijriTab = modeSwitch.createSpan({ cls: "dh-mode-btn-mini", text: isAr ? "هـ" : "H" });
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
            this.updateDateDisplay(this.dateDisplayEl, isAr, weekEnd);
          }
        };

        hijriTab.onclick = () => {
          if (this.currentDateMode !== "hijri") {
            this.currentDateMode = "hijri";
            hijriTab.addClass("active");
            gregorianTab.removeClass("active");
            this.updateDateDisplay(this.dateDisplayEl, isAr, weekEnd);
          }
        };
      }

      const nextBtn = dateWrap.createEl("button", { cls: "dh-nav-arrow-btn" });
      setIcon(nextBtn, nextIcon);
      nextBtn.onclick = async () => {
        this.currentWeekStart.add(7, "days");
        await this.renderWeeklyGrid();
      };

      // 3. زر "تحديث" (اليسار في RTL)
      const refreshBtn = mainStage.createEl("button", {
        cls: "dh-header-text-btn",
        title: isAr ? "تحديث البيانات" : "Refresh",
      });
      refreshBtn.createSpan({ text: isAr ? "تحديث" : "Refresh" });
      refreshBtn.onclick = async () => {
        await this.renderWeeklyGrid();
        new Notice(isAr ? "✓ تم التحديث" : "✓ Refreshed");
      };
    }

    headerCard.createDiv({ cls: "weekly-header-progress-container" });
  }

  // Helper to update date display
  updateDateDisplay(element, isAr, weekEnd) {
    if (!element) return; // Guard clause

    const hideYear = this.plugin.settings.hideYear;
    const dateFormat = hideYear ? "D MMMM" : "D MMMM YYYY";

    if (this.currentDateMode === "gregorian") {
      const locale = isAr ? "ar" : "en";
      // Clone and set locale purely for display purposes
      const startDisplay = this.currentWeekStart.clone().locale(locale);
      const endDisplay = weekEnd.clone().locale(locale);
      element.textContent = `${startDisplay.format(dateFormat)} - ${endDisplay.format(dateFormat)}`;
    } else {
      let hijriStart = DateUtils.getHijriDate(this.currentWeekStart, this.isAr);
      let hijriEnd = DateUtils.getHijriDate(weekEnd, this.isAr);

      if (hideYear) {
        hijriStart = hijriStart.replace(/\s+\d{4}\s*هـ?$/i, '').trim();
        hijriEnd = hijriEnd.replace(/\s+\d{4}\s*هـ?$/i, '').trim();
      }

      // Add RLM (\u200F) to enforce Right-to-Left ordering
      element.empty();
      element.createSpan({ cls: "hijri-date-text", text: `${hijriStart} - ${hijriEnd}` });
      element.createSpan({ text: " " });
      element.createSpan({ cls: "hijri-indicator", text: "هـ" });
    }
  }

  async renderGridTable(container, today) {
    const weekStartMs = this.currentWeekStart.clone().startOf("day").valueOf();
    const weekEndMs = this.currentWeekStart.clone().add(6, "days").endOf("day").valueOf();
    const habits = this.plugin.habitManager.getHabitsForTimeRange(weekStartMs, weekEndMs);

    if (habits.length === 0) {
      const isAr = this.isAr;
      container.createDiv({
        cls: "dh-empty-state",
        text: isAr ? "لا توجد عادات. أضف عادات من الإعدادات." : "No habits yet. Add habits from Settings.",
      });
      return;
    }

    // Create wrapper for sticky header functionality
    const tableWrapper = container.createDiv({ cls: "habits-grid-wrapper dh-desktop-scroll" });
    const table = tableWrapper.createDiv({ cls: "habits-grid" });

    // Initialize daily stats for percentage calculation
    this.dailyStats = {};
    this.dailyReflectionDays = new Set();
    for (let i = 0; i < 7; i++) {
      const dayDate = this.currentWeekStart.clone().add(i, "days");
      this.dailyStats[DateUtils.formatDateKey(dayDate)] = { total: 0, completed: 0 };
    }

    // Render headers (without percentages initially)
    const thead = await this.renderDayHeaders(table, today);

    // Batch read 7 files instead of (Habits * 7) reads
    const weekContent = new Map(); // Key: 'YYYY-MM-DD', Value: File Content
    this.activeFilePaths.clear(); // Reset watch list

    for (let i = 0; i < 7; i++) {
      const dayDate = this.currentWeekStart.clone().add(i, "days");
      const dailyNote = await getNoteByDate(this.app, dayDate, false, this.plugin.settings);
      if (dailyNote) {
        const content = await this.app.vault.cachedRead(dailyNote);
        const dateKey = DateUtils.formatDateKey(dayDate);
        weekContent.set(dateKey, content);
        if (this.parseDailyReflectionEntries(content, dayDate, dailyNote.path).length > 0) {
          this.dailyReflectionDays.add(dateKey);
        }
        this.activeFilePaths.add(dailyNote.path); // Add to watch list
      }
    }
    this.weekContentCache = weekContent;

    // Use DocumentFragment for batched DOM insertion
    const tbody = table.createDiv({ cls: "habits-tbody" });
    const fragment = document.createDocumentFragment();

    const { sorted: sortedHabits, labels: displayLabels } = buildHierarchyLabels(habits);
    const childRowsMap = new Map();

    // Color System — unified: --habit-color is the single source of truth
    const hexColorMap = new Map();
    for (const habit of sortedHabits) {
      if (!habit.parentId) {
        hexColorMap.set(habit.id, resolveHabitColorHex(habit.color));
      } else {
        // Child: always inherit parent's color
        hexColorMap.set(habit.id, hexColorMap.get(habit.parentId) ?? resolveHabitColorHex("teal"));
      }
    }

    // Render habit rows using pre-loaded content concurrently
    const rowPromises = sortedHabits.map(async (habit, habitIdx) => {
      try {
        const colorHex = hexColorMap.get(habit.id) || "#14b8a6";
        const dummyFrag = document.createElement("div");
        await this.renderHabitRow(dummyFrag, habit, weekContent, displayLabels[habitIdx], habits, colorHex);
        return { habit, row: dummyFrag.firstElementChild, error: false };
      } catch {
        return { habit, row: null, error: true, errorName: habit.name };
      }
    });

    const renderedResults = await Promise.all(rowPromises);

    for (const res of renderedResults) {
      if (res.error) {
        const errorRow = document.createElement("div");
        errorRow.className = "habit-error-row dh-grid-row";
        const errorCell = document.createElement("div");
        errorCell.className = "dh-grid-cell error-cell";
        errorCell.textContent = `⚠️ Error loading ${res.errorName}`;
        errorRow.appendChild(errorCell);
        fragment.appendChild(errorRow);
      } else if (res.row) {
        fragment.appendChild(res.row);
        if (res.habit.parentId) {
          const pid = res.habit.parentId;
          if (!childRowsMap.has(pid)) childRowsMap.set(pid, []);
          childRowsMap.get(pid).push(res.row);
        }
      }
    }

    // Append all rows at once
    tbody.appendChild(fragment);

    // Now wire up collapse/expand buttons (after DOM insertion)
    childRowsMap.forEach((childRows, pid) => {
      const toggleBtn = tbody.querySelector(`[data-collapse-id="${pid}"]`);
      if (!toggleBtn) return;

      // Restore saved state: collapsed by default unless user explicitly expanded
      // NOTE: collapsedGroups array stores EXPANDED group keys (historical naming).
      // Key format: "{parentId}:expanded". Presence = expanded, absence = collapsed.
      let collapsed = !this.plugin.settings.collapsedGroups.includes(pid + ":expanded");

      // Apply initial DOM state immediately (no animation flash on render)
      childRows.forEach(row => { row.style.display = collapsed ? "none" : ""; });
      toggleBtn.classList.toggle("is-collapsed", collapsed);
      toggleBtn.title = collapsed
        ? (this.isAr ? "عرض العادات الفرعية" : "Expand children")
        : (this.isAr ? "إخفاء العادات الفرعية" : "Collapse children");

      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        collapsed = !collapsed;
        toggleBtn.classList.toggle("is-collapsed", collapsed);
        toggleBtn.title = collapsed
          ? (this.isAr ? "عرض العادات الفرعية" : "Expand children")
          : (this.isAr ? "إخفاء العادات الفرعية" : "Collapse children");
        childRows.forEach(row => { row.style.display = collapsed ? "none" : ""; });

        // Persist state: expanded groups are tracked; default is collapsed
        const key = pid + ":expanded";
        if (collapsed) {
          this.plugin.settings.collapsedGroups = this.plugin.settings.collapsedGroups.filter(k => k !== key);
        } else {
          if (!this.plugin.settings.collapsedGroups.includes(key)) {
            this.plugin.settings.collapsedGroups.push(key);
          }
        }
        // Save directly without triggering view refresh (avoids full re-render jitter)
        this.plugin.saveSettings({ silent: true });
      };
    });

    await this.updateHeaderPercentages(thead);
    await this.updateUnifiedProgressBar(container);

    if (this.plugin.settings.enableReflectionJournal) {
      const tfoot = table.createDiv({ cls: "habits-tfoot" });
      const footerRow = tfoot.createDiv({ cls: "dh-reflection-footer-row dh-grid-row diary-row" });
      
      // Index column placeholder
      footerRow.createDiv({ cls: "habit-index-header dh-grid-cell" });
      
      // Diary Title column
      const titleCell = footerRow.createDiv({ cls: "dh-footer-title dh-grid-cell" });
      const iconSpan = titleCell.createSpan();
      setIcon(iconSpan, "book-open");
      titleCell.createSpan({ text: this.isAr ? " يومياتي" : " Diary" });
      
      const today = window.moment();
      for (let index = 0; index < 7; index++) {
        const dayCell = footerRow.createDiv({ cls: "day-cell dh-grid-cell" });
        const dayDate = this.currentWeekStart.clone().add(index, "days");
        const dateKey = DateUtils.formatDateKey(dayDate);
        
        if (!dayDate.isAfter(today, "day")) {
          const hasReflection = this.dailyReflectionDays?.has(dateKey);
          const btn = dayCell.createEl("button", {
            cls: `dh-footer-add-btn ${hasReflection ? "has-reflection" : ""}`,
            title: hasReflection
              ? (this.isAr ? "تم تسجيل يومية لهذا اليوم" : "Diary entry exists")
              : (this.isAr ? "تدوين ملاحظة اليوم" : "Add daily reflection")
          });
          btn.textContent = "📝";
          
          btn.onclick = (e) => {
            e.stopPropagation();
            this.openReflectionPopup(dayDate);
          };
        }
      }
    }

    if (this.plugin.settings.enableHabitContext) {
      this.populateCommentDots(tbody, sortedHabits, this.currentWeekStart);
    }
    
    if (!this.plugin.settings.hasSeenGridHint) {
      const hint = container.createDiv({ cls: "dh-grid-hint" });
      hint.createDiv({ cls: "dh-grid-hint-text", text: this.isAr ? "💡 تلميح: اضغط مطولاً أو بالزر الأيمن على أي مربع لتسجيل ملاحظة صوتية على العادة." : "💡 Tip: Long-press or right-click any checkbox to record a voice note for that habit." });
      const closeBtn = hint.createEl("button", { cls: "dh-grid-hint-close", text: "×", title: this.isAr ? "إخفاء التلميح" : "Hide hint" });
      closeBtn.onclick = async () => {
        hint.remove();
        this.plugin.settings.hasSeenGridHint = true;
        await this.plugin.saveSettings();
      };
    }
  }

  async updateHeaderPercentages(thead) {
    if (!thead) return;
    const today = window.moment();
    const statCells = thead.querySelectorAll(".day-stat-cell");
    const dayCount = 7;
    if (!statCells || statCells.length !== dayCount || !this.dailyStats) return;

    for (let index = 0; index < dayCount; index++) {
      const cell = statCells[index];
      if (!cell) continue;
      cell.empty();

      const dayDate = this.currentWeekStart.clone().add(index, "days");
      const dateKey = DateUtils.formatDateKey(dayDate);
      const stats = this.dailyStats[dateKey];

      if (stats && !dayDate.isAfter(today, "day") && stats.total > 0) {
        const percent = Math.min(100, Math.round((stats.completed / stats.total) * 100));
        let colorClass = "percent-low";
        if (percent === 100) colorClass = "percent-complete";
        else if (percent >= 80) colorClass = "percent-high";
        else if (percent >= 50) colorClass = "percent-medium";

        const badge = cell.createDiv({ cls: `day-stat-badge ${colorClass}` });
        badge.textContent = percent === 100 ? "✓" : `${percent}%`;
        badge.title = `${stats.completed}/${stats.total} Completed`;
      }
    }
  }

  async calculateLastWeekRateAsync() {
    const prevWeekStartStr = this.currentWeekStart.clone().subtract(7, "days").format("YYYY-MM-DD");
    if (this.lastWeekRatesCache && this.lastWeekRatesCache.has(prevWeekStartStr)) {
      return this.lastWeekRatesCache.get(prevWeekStartStr);
    }

    const today = window.moment();
    const prevWeekStart = this.currentWeekStart.clone().subtract(7, "days");
    let prevTotal = 0;
    let prevCompleted = 0;

    const prevWeekStartMs = prevWeekStart.clone().startOf("day").valueOf();
    const prevWeekEndMs = prevWeekStart.clone().add(6, "days").endOf("day").valueOf();
    const habits = this.plugin.habitManager.getHabitsForTimeRange(prevWeekStartMs, prevWeekEndMs);
    if (habits.length === 0) return 0;

    for (let i = 0; i < 7; i++) {
      const dayDate = prevWeekStart.clone().add(i, "days");
      if (dayDate.isAfter(today, "day")) continue;

      const dailyNote = await getNoteByDate(this.app, dayDate, false, this.plugin.settings);
      if (dailyNote) {
        const content = await this.app.vault.cachedRead(dailyNote);
        const scanned = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);

        for (const habit of habits) {
          const isAfterArchive = habit.archived && habit.archivedDate && dayDate.clone().startOf("day").isAfter(window.moment(habit.archivedDate).startOf("day"));
          if (isAfterArchive) continue;

          const dayOfWeek = dayDate.day();
          if (!this.plugin.habitManager.isHabitScheduledForDay(habit, dayOfWeek)) continue;

          const entry = findHabitEntry(scanned, habit.linkText, habit.nameHistory);
          if (entry && !entry.skipped) {
            prevTotal++;
            if (entry.completed) prevCompleted++;
          }
        }
      }
    }

    const rate = prevTotal > 0 ? Math.round((prevCompleted / prevTotal) * 100) : 0;

    if (!this.lastWeekRatesCache) this.lastWeekRatesCache = new Map();
    this.lastWeekRatesCache.set(prevWeekStartStr, rate);

    return rate;
  }

  async updateUnifiedProgressBar(container) {
    const today = window.moment();

    // Find the container in the header
    const progressContainer = container.querySelector(
      ".weekly-header-progress-container",
    );
    if (!progressContainer) return;

    progressContainer.empty(); // Clear previous

    // Check showCount setting - if false, don't show progress
    if (!this.plugin.settings.showCount) {
      return;
    }

    // Calculate weekly totals (only for past/today days)
    let weekTotal = 0;
    let weekCompleted = 0;

    for (const dateKey in this.dailyStats) {
      const stats = this.dailyStats[dateKey];
      // Parse date with explicit format
      const dayMoment = window.moment(dateKey, "YYYY-MM-DD", true);
      // Only count if not future
      if (!dayMoment.isAfter(today, "day")) {
        weekTotal += stats.total;
        weekCompleted += stats.completed;
      }
    }

    const weekPercentage =
      weekTotal > 0 ? Math.round((weekCompleted / weekTotal) * 100) : 0;

    // Pass total count to CSS
    progressContainer.style.setProperty(
      "--total-count",
      weekTotal > 0 ? weekTotal : 10,
    );

    // Wrapper for Bar + Stats
    const internalWrapper = progressContainer.createDiv({
      cls: "unified-progress-wrapper",
    });

    // 1. Label (NEW Narrative)
    const label = internalWrapper.createDiv({ cls: "progress-label" });
    label.textContent =
      this.isAr
        ? "معدل الإنجاز"
        : "Completion Rate";

    // 2. Count Badge (e.g. "45/60")
    const countBadge = internalWrapper.createDiv({ cls: "weekly-count-badge" });
    countBadge.textContent = `${weekCompleted}/${weekTotal}`;

    // 2. Bar
    const barContainer = internalWrapper.createDiv({
      cls: "weekly-progress-bar unified-bar",
    });
    const barFill = barContainer.createDiv({ cls: "weekly-progress-fill" });
    barFill.style.width = `${weekPercentage}%`;

    // Add color classes
    if (weekPercentage >= 90) barFill.addClass("progress-excellent");
    else if (weekPercentage >= 70) barFill.addClass("progress-good");
    else if (weekPercentage >= 50) barFill.addClass("progress-medium");
    else barFill.addClass("progress-low");

    // 3. Percentage Text
    const percentText = internalWrapper.createDiv({
      cls: "unified-percent-text",
    });
    percentText.textContent = `${weekPercentage}%`;

    // 4. (NEW) Weekly Barrier Breaking Caption
    const lastWeekRate = await this.calculateLastWeekRateAsync();

    const captionEl = progressContainer.createDiv({ cls: "weekly-barrier-caption" });
    const isAr = this.isAr;

    if (weekPercentage < lastWeekRate) {
      const gap = lastWeekRate - weekPercentage;
      captionEl.addClass("state-gap");
      captionEl.textContent = isAr
        ? `🚀 انطلاقة جيدة! باقي ${gap}% لتعادل إنجاز الأسبوع الماضي (${lastWeekRate}%).`
        : `🚀 Good start! ${gap}% left to match last week's record (${lastWeekRate}%).`;
    } else if (weekPercentage === lastWeekRate) {
      if (lastWeekRate === 0) {
        captionEl.style.display = "none";
      } else {
        captionEl.addClass("state-match");
        captionEl.textContent = isAr
          ? `🔥 ممتاز! لقد عادلت رقمك السابق (${lastWeekRate}%). خطوة واحدة لكسر الحاجز!`
          : `🔥 Awesome! You matched last week's record (${lastWeekRate}%). One step to break the barrier!`;
      }
    } else {
      const lead = weekPercentage - lastWeekRate;
      captionEl.addClass("state-break");
      captionEl.textContent = isAr
        ? `🏆 بطل! تم كسر الحاجز، أنت تتفوق بـ (+${lead}%) عن الأسبوع الماضي.`
        : `🏆 Barrier broken! You are leading by (+${lead}%) over last week.`;
    }
  }

  async renderDayHeaders(table) {
    const thead = table.createDiv({ cls: "habits-thead" });

    // Row 1: Day Names & Dates
    // CSS Grid controls the column sizing directly now
    const headerRow = thead.createDiv({ cls: "header-row-date dh-grid-row" });
    headerRow.createDiv({ cls: "habit-index-header dh-grid-cell", text: "#" });
    headerRow.createDiv({ cls: "corner-cell dh-grid-cell" });

    // Row 2: Daily Stats
    const statsRow = thead.createDiv({ cls: "header-row-stats dh-grid-row" });
    statsRow.createDiv({ cls: "habit-index-header dh-grid-cell" });
    statsRow.createDiv({ cls: "corner-cell stats-corner dh-grid-cell" });

    const t = (k) => this.plugin.translationManager.t(k);
    const isAr = this.isAr;
    const weekDayInfos = this.getWeekDayInfos();

    for (let i = 0; i < 7; i++) {
      const { dayDate, isToday, dayOfWeek } = weekDayInfos[i];

      const dayHeaderCell = headerRow.createDiv({
        cls: `day-header dh-grid-cell ${isToday ? "today" : ""} clickable`,
      });
      const name = t(DAY_KEYS[dayOfWeek]);

      dayHeaderCell.createDiv({ text: name, cls: "day-name" });

      const displayDate = dayDate.clone().locale(isAr ? "ar" : "en");
      dayHeaderCell.createDiv({
        text: displayDate.format(isAr ? "D MMM" : "MMM D"),
        cls: "day-date",
      });

      if (this.plugin.settings.showHijriDate) {
        try {
          const hijriDate = DateUtils.getHijriDate(dayDate, this.isAr);
          const hijriParts = hijriDate.replace(/\s+هـ$/, "").split(" ");
          const hijriShort = hijriParts.length >= 2 ? `${hijriParts[0]} ${hijriParts[1]}` : hijriDate;
          dayHeaderCell.createDiv({ text: hijriShort, cls: "day-date-hijri" });
        } catch (e) {
          Utils.debugLog(this.plugin, "Error displaying Hijri date:", e);
        }
      }

      dayHeaderCell.onclick = async () => {
        const dailyNote = await getNoteByDate(this.app, dayDate, false, this.plugin.settings);
        if (dailyNote) {
          await this.app.workspace.openLinkText(dailyNote.path, "", false);
        } else {
          new Notice(
            isAr ? "📝 لا توجد ملاحظة لهذا اليوم" : "📝 No note for this day",
          );
        }
      };
      dayHeaderCell.title = isAr ? "اضغط لفتح الملاحظة" : "Click to open note";

      statsRow.createDiv({
        cls: `day-stat-cell dh-grid-cell ${isToday ? "today" : ""}`,
      });

    }
    return thead;
  }

  // displayLabel is now a string like "1", "2", "2.1", "2.2"
  async renderHabitRow(container, habit, weekContent, displayLabel = "?", allHabits = [], colorHex = "#14b8a6") {
    const effectiveParentId = this.plugin.habitManager.getEffectiveParentId(habit.id);

    // Add child indentation if this habit has a valid active parent
    const isChild = effectiveParentId !== null;

    // Fix: A habit is considered a parent in this view if ANY habit in the current 'allHabits' scope considers it a parent.
    // This correctly handles parents whose children are all archived but still visible in this specific weekly view.
    const isParentHabit = allHabits.length > 0
      ? allHabits.some(h => this.plugin.habitManager.getEffectiveParentId(h.id) === habit.id)
      : this.plugin.habitManager.isParent(habit.id);
    const isAr = this.isAr; // define early — used by streak badge & open icon
    const rowCls = isChild ? "habit-row habit-row-child" : "habit-row";
    const rowClsFinal = `${rowCls} group-${effectiveParentId || habit.id} dh-grid-row dh-mobile-card`;
    const row = container.createDiv({ cls: rowClsFinal });

    // Inject the exact hex color for CSS unified system
    row.style.setProperty("--habit-color", colorHex);

    // Group hover attributes
    row.setAttribute("data-group-id", effectiveParentId || habit.id);
    const safeGroupId = (effectiveParentId || habit.id).replace(/["\\]/g, '\\$&');
    row.onmouseenter = () => {
      container.querySelectorAll(`[data-group-id="${safeGroupId}"]`).forEach(r => r.classList.add('dh-group-hover-active'));
    };
    row.onmouseleave = () => {
      container.querySelectorAll(`[data-group-id="${safeGroupId}"]`).forEach(r => r.classList.remove('dh-group-hover-active'));
    };

    // Habit index cell — show hierarchical label
    row.createDiv({
      cls: "habit-index-cell dh-grid-cell",
      text: String(displayLabel),
    });

    // Habit name cell
    const nameCell = row.createDiv({ cls: "habit-name-cell dh-grid-cell" });

    // DOM Restructuring for Robust Flexbox Layout
    const contentWrapper = nameCell.createDiv({ cls: "dh-name-content" });
    const metaWrapper = nameCell.createDiv({ cls: "dh-name-meta" });

    // Habit type dot
    contentWrapper.createSpan({
      cls: `dh-type-dot ${habit.habitType === "break" ? "break" : "build"}`,
      title: habit.habitType === "break" ? (this.isAr ? "كسر عادة" : "Break habit") : (this.isAr ? "بناء عادة" : "Build habit"),
    });

    // Child indent indicator
    if (isChild) {
      contentWrapper.createSpan({ cls: "dh-child-indent", text: "└ " });
    }

    // Collapse/expand button for parent habits
    if (isParentHabit) {
      const btn = contentWrapper.createSpan({
        cls: "dh-collapse-btn",
        title: this.isAr ? "إخفاء / عرض العادات الفرعية" : "Collapse / expand children",
        attr: { "data-collapse-id": habit.id },
      });
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="dh-chevron-icon"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
    }

    const habitName = habit.name ?? "";
    const nameLink = contentWrapper.createEl("span", {
      text: habitName,
      cls: "habit-name-link habit-pure-name",
      title: habitName,
    });

    // Child Progress — non-blocking, only counts children scheduled for today
    if (isParentHabit && allHabits.length > 0) {
      const allChildren = allHabits.filter(h => this.plugin.habitManager.getEffectiveParentId(h.id) === habit.id);
      if (allChildren.length > 0) {
        const today = window.moment();
        const todayDayOfWeek = today.day();
        // Only count children scheduled for today
        const scheduledChildren = allChildren.filter(child =>
          this.plugin.habitManager.isHabitScheduledForDay(child, todayDayOfWeek)
        );
        if (scheduledChildren.length > 0) {
          const progressSlot = metaWrapper.createDiv({ cls: "dh-child-progress" });

          const todayKey = DateUtils.formatDateKey(today);
          const todayContent = weekContent ? weekContent.get(todayKey) || null : null;
          Promise.all(scheduledChildren.map(child => this.getHabitStatusForDay(child, today, todayContent)))
            .then(statuses => {
              const completedCount = statuses.filter(s => s === "completed").length;
              const total = scheduledChildren.length;
              const checkStr = completedCount === total ? " ✓" : "";
              progressSlot.textContent = `(${completedCount}/${total}${checkStr})`;
              if (completedCount === total) progressSlot.addClass("complete");
            })
            .catch(() => { progressSlot.remove(); });
        }
      }
    }

    // Streak badge slot — placed inside metaWrapper
    metaWrapper.createSpan({ cls: "dh-streak-badge-slot" });
    this.queueStreakCalculation(habit, row, isAr);

    // Icon to open linked habit page — always last in meta block
    const openPageIcon = metaWrapper.createEl("span", {
      cls: "habit-open-page-icon",
      title: isAr ? "فتح صفحة العادة" : "Open habit page",
    });
    setIcon(openPageIcon, "external-link");

    openPageIcon.onclick = async (e) => {
      e.stopPropagation();
      if (this.plugin.habitNoteManager) {
        const file = this.plugin.habitNoteManager._resolveHabitFile(habit);
        if (file) {
          await this.app.workspace.getLeaf().openFile(file);
          return;
        }
      }
      
      const linkMatch = habit.linkText?.match(/\[\[([^\]]+)\]\]/);
      if (linkMatch && linkMatch[1]) {
        const noteName = linkMatch[1];
        await this.app.workspace.openLinkText(noteName, "", false);
      } else {
        new Notice(this.isAr ? "⚠️ لا توجد صفحة مرتبطة" : "⚠️ No linked page found");
      }
    };

    // Click habit name to open edit modal
    nameLink.onclick = () => {
      new AddHabitModal(
        this.app,
        this.plugin,
        async (updatedData) => {
          try {
            if (updatedData.levelData) {
              updatedData.currentLevel = calculateCurrentLevel(updatedData.levelData);
            }

            await this.plugin.habitManager.updateHabit(habit.id, updatedData);
            await this.renderWeeklyGrid();
            new Notice(`✅ ${updatedData.name}`);
          } catch (e) {
            console.error('[Core Habits] Update Habit Error:', e);
            new Notice(`❌ ${e.message}`);
          }
        },
        habit,
      ).open();
    };

    const today = window.moment();
    const weekDayInfos = this.getWeekDayInfos();

    for (let i = 0; i < 7; i++) {
      const { dayDate, dateKey, isToday, dayOfWeek } = weekDayInfos[i];
      const isScheduled = this.plugin.habitManager.isHabitScheduledForDay(
        habit,
        dayOfWeek,
      );
      const isFuture = dayDate.isAfter(today, "day");
      const isAfterArchive = habit.archived && habit.archivedDate && dayDate.clone().startOf("day").isAfter(window.moment(habit.archivedDate).startOf("day"));

      const cell = row.createDiv({
        cls: `day-cell dh-grid-cell ${isToday ? "is-today" : ""}`,
        attr: { "data-day-index": String(i) },
      });

      // Smart tooltip: habit name + day context on hover
      const tooltipDayName = this.plugin.translationManager.t(DAY_KEYS[dayOfWeek]);
      const tooltipDate = dayDate.clone().locale(isAr ? "ar" : "en").format(isAr ? "D MMM" : "MMM D");
      const baseTitle = `#${displayLabel} ${habitName} — ${tooltipDayName} ${tooltipDate}`;

      let tooltipText = this.plugin.settings.enableHabitContext
        ? `${baseTitle}\n(${isAr ? "كليك يمين لإضافة تعليق" : "Right-click to add comment"})`
        : baseTitle;

      if (isAfterArchive) {
        tooltipText = isAr ? `🔒 تم إيقاف/أرشفة هذه العادة\n${baseTitle}` : `🔒 Habit Archived\n${baseTitle}`;
      }
      cell.title = tooltipText;

      if (!isScheduled) {
        cell.textContent = "--";
        cell.addClass("not-scheduled");
      } else if (isAfterArchive) {
        cell.textContent = "🔒";
        cell.addClass("not-scheduled");
      } else if (isFuture) {
        cell.textContent = "☐";
        cell.addClass("future");
      } else {
        const preloaded = weekContent ? weekContent.get(dateKey) || null : null;
        const status = await this.getHabitStatusForDay(
          habit,
          dayDate,
          preloaded,
        );

        if (status === "uncompleted" && habit.restoredDate &&
          dayDate.isBefore(window.moment(habit.restoredDate), "day")) {
          cell.textContent = "--";
          cell.addClass("not-scheduled");
        } else {
          if (this.dailyStats[dateKey]) {
            this.dailyStats[dateKey].total++;
          }

          // Track cell state in Map instead of DOM class
          const cellKey = `${habit.id}:${dateKey}`;

          if (status === "completed") {
            cell.textContent = "✓";
            cell.addClass("completed");
            this.previousCellState.set(cellKey, true);
            this.previousSkipState.set(cellKey, false);
            if (this.dailyStats[dateKey]) {
              this.dailyStats[dateKey].completed++;
            }
          } else if (status === "skipped") {
            cell.textContent = "⊘";
            cell.addClass("skipped");
            this.previousCellState.set(cellKey, false);
            this.previousSkipState.set(cellKey, true);
            // Skipped habits don't count toward the day's expected total
            if (this.dailyStats[dateKey]) {
              this.dailyStats[dateKey].total = Math.max(0, this.dailyStats[dateKey].total - 1);
            }
          } else if (status === "missed") {
            cell.textContent = "x";
            cell.addClass("missed");
            this.previousCellState.set(cellKey, false);
            this.previousSkipState.set(cellKey, false);
          } else {
            cell.textContent = "☐";
            cell.addClass("pending");
            this.previousCellState.set(cellKey, false);
            this.previousSkipState.set(cellKey, false);
          }

          cell.setAttribute("data-status", status === "missed" ? "uncompleted" : status);
          cell.setAttribute("tabindex", "0");
          cell.setAttribute("role", "button");
          cell.onclick = async () => {
            const current = cell.getAttribute("data-status");
            let next;
            if (current === "completed") next = "skipped";
            else if (current === "skipped") next = "uncompleted";
            else next = "completed";
            await this.setHabitState(habit, dayDate, cell, next);
          };
          cell.onkeydown = (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              cell.click();
            }
          };
        }
      }

      // Feature: Habit Context (Long-press / Right-Click to add Comment)
      if (this.plugin.settings.enableHabitContext && isScheduled && !isFuture) {
        const openCommentPopup = (e) => {
          e.preventDefault();
          e.stopPropagation();

          new HabitCommentPopup(
            this.app,
            this.plugin,
            habit,
            dayDate,
            async (text) => {
              if (this.plugin.habitNoteManager) {
                const dateStr = dayDate.format("YYYY-MM-DD");
                await this.plugin.habitNoteManager.appendToHabitNoteLog(habit, dateStr, text);
              } else {
                await injectHabitCommentIntoDailyNote(this.app, this.plugin, habit, dayDate, text);
              }
            }
          ).open();
        };

        cell.oncontextmenu = openCommentPopup;

        // Touch long-press for mobile devices (500ms)
        // Works on Android, iOS, iPad — runs alongside click without conflict
        let _touchTimer = null;
        cell.addEventListener('touchstart', (e) => {
          _touchTimer = setTimeout(() => {
            _touchTimer = null;
            openCommentPopup(e);
          }, 500);
        }, { passive: true });
        cell.addEventListener('touchend', () => {
          if (_touchTimer) { clearTimeout(_touchTimer); _touchTimer = null; }
        });
        cell.addEventListener('touchmove', () => {
          if (_touchTimer) { clearTimeout(_touchTimer); _touchTimer = null; }
        });
      }
    }
    return row;
  }

  async getHabitStatusForDay(habit, date, preloadedContent = null) {
    try {
      let content = preloadedContent;

      if (content === null) {
        const dailyNote = await getNoteByDate(this.app, date, false, this.plugin.settings);
        if (!dailyNote) return "uncompleted";
        content = await this.app.vault.cachedRead(dailyNote);
      } else if (content === undefined) {
        return "uncompleted";
      }

      const habits = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
      const habitEntry = findHabitEntry(habits, habit.linkText, habit.nameHistory);

      if (!habitEntry) return "uncompleted";
      if (habitEntry.skipped) return "skipped";
      if (habitEntry.completed) return "completed";
      if (date.isBefore(window.moment(), "day")) return "missed";
      return "uncompleted";
    } catch (error) {
      console.error("[Core Habits] getHabitStatusForDay error:", error);
      return "uncompleted";
    }
  }

  async populateCommentDots(tbody, habits, weekStart) {
    const dailyContentByIndex = new Map();
    for (let i = 0; i < 7; i++) {
      const dayDate = weekStart.clone().add(i, "days");
      const dateKey = DateUtils.formatDateKey(dayDate);
      if (this.weekContentCache?.has(dateKey)) {
        dailyContentByIndex.set(i, this.weekContentCache.get(dateKey));
        continue;
      }

      const dailyNote = await getNoteByDate(this.app, dayDate, false, this.plugin.settings);
      if (!dailyNote) continue;

      try {
        dailyContentByIndex.set(i, await this.app.vault.cachedRead(dailyNote));
      } catch {
        // ignore cachedRead errors
      }
    }

    for (const habit of habits) {
      if (this._isClosed) return;

      const rows = tbody.querySelectorAll(`.habit-row`);
      for (const row of rows) {
        const nameEl = row.querySelector(".habit-pure-name");
        if (!nameEl || nameEl.textContent !== habit.name) continue;

        for (let i = 0; i < 7; i++) {
          const content = dailyContentByIndex.get(i);
          if (!content) continue;

          const cleanName = TextUtils.clean(habit.linkText || habit.name);
          const noteSection = this.extractSectionLines(content, this.getHabitNotesHeading()).join("\n");
          const hasComment =
            (habit.linkText && noteSection.includes(habit.linkText)) ||
            noteSection.includes(`[habit-note:: ${cleanName}]`) ||
            noteSection.includes(`habit:: ${cleanName}`);

          if (hasComment) {
            const cell = row.querySelector(`[data-day-index="${i}"]`);
            if (cell && !cell.querySelector(".dh-has-comment-dot")) {
              cell.createDiv({ cls: "dh-has-comment-dot" });
            }
          }
        }
        break;
      }
    }
  }

  async setHabitState(habit, date, cell, targetState) {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.isTogglingInProgress = true;
    const isAr = this.isAr;

    try {
      if (this.plugin.settings.autoWriteHabits) {
        await this.plugin.habitManager.ensureHabitsInNote(date, habit);
        // Prevent Obsidian vault.read() cache race condition after vault.process()
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      let dailyNote = await getNoteByDate(this.app, date, false, this.plugin.settings);
      if (!dailyNote) {
        if (!this.plugin.settings.autoWriteHabits) {
          const createNote = await new Promise((resolve) => {
            const modal = new Modal(this.app);
            const { contentEl } = modal;
            contentEl.createEl("p", {
              text: isAr ? "لا توجد ملاحظة لهذا اليوم. هل تريد إنشاؤها؟" : "No note for this day. Create one?"
            });
            const footer = contentEl.createDiv({ cls: "modal-button-container" });
            footer.createEl("button", { text: isAr ? "إلغاء" : "Cancel" }).onclick = () => { modal.close(); resolve(false); };
            footer.createEl("button", { text: isAr ? "إنشاء" : "Create", cls: "mod-cta" }).onclick = () => { modal.close(); resolve(true); };
            modal.open();
          });
          if (!createNote) return;
          await this.plugin.habitManager.ensureHabitsInNote(date);
          dailyNote = await getNoteByDate(this.app, date, false, this.plugin.settings);
          if (!dailyNote) {
            new Notice(isAr ? "⚠️ تعذر إنشاء الملاحظة" : "⚠️ Could not create note");
            return;
          }
        } else {
          new Notice(isAr ? "⚠️ لا توجد ملاحظة لهذا اليوم" : "⚠️ No note for this day");
          return;
        }
      }

      const content = await this.app.vault.read(dailyNote);
      const habits = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
      const habitEntry = findHabitEntry(habits, habit.linkText, habit.nameHistory);

      if (habitEntry) {
        this.ignoreModifyFiles.add(dailyNote.path);
        await toggleHabit(this.plugin, this.app, dailyNote, habitEntry, this.plugin.settings.marker, targetState);
        StreakCalculator.invalidate(habit.id); // Invalidate cache

        // Derive status from targetState directly to avoid stale read race condition
        const newStatus = targetState;
        cell.className = "day-cell dh-grid-cell";
        const dateKey = DateUtils.formatDateKey(date);
        const isToday = dateKey === DateUtils.formatDateKey(window.moment());
        if (isToday) cell.addClass("is-today");
        const cellKey = `${habit.id}:${dateKey}`;
        const wasCompleted = this.previousCellState.get(cellKey) || false;
        const wasSkipped = this.previousSkipState.get(cellKey) || false;

        let newContent = "";

        if (newStatus === "completed") {
          newContent = "✓";
          cell.addClass("completed");
        } else if (newStatus === "skipped") {
          newContent = "⊘";
          cell.addClass("skipped");
        } else {
          newContent = "☐";
          cell.addClass("pending");
        }

        const textNode = Array.from(cell.childNodes).find(n => n.nodeType === 3);
        if (textNode) {
          textNode.textContent = newContent;
        } else {
          cell.prepend(document.createTextNode(newContent));
        }

        // Update data-status for click cycling
        cell.setAttribute("data-status", newStatus);

        if (!this.dailyStats[dateKey]) this.dailyStats[dateKey] = { total: 0, completed: 0 };
        const dayStat = this.dailyStats[dateKey];
        if (newStatus === "completed" && !wasCompleted) {
          dayStat.completed++;
          if (typeof this.plugin.settings.lifetimeCompleted === "number") {
            this.plugin.settings.lifetimeCompleted++;
            this.plugin.saveSettings({ silent: true });
          }
        } else if (newStatus !== "completed" && wasCompleted) {
          dayStat.completed--;
          if (typeof this.plugin.settings.lifetimeCompleted === "number") {
            this.plugin.settings.lifetimeCompleted = Math.max(0, this.plugin.settings.lifetimeCompleted - 1);
            this.plugin.saveSettings({ silent: true });
          }
        }

        if (newStatus === "skipped" && !wasSkipped) dayStat.total = Math.max(0, dayStat.total - 1);
        else if (wasSkipped && newStatus !== "skipped") dayStat.total++;

        this.previousCellState.set(cellKey, newStatus === "completed");
        this.previousSkipState.set(cellKey, newStatus === "skipped");

        if (newStatus === "completed") {
          await this.plugin.audioEngine.playSound({ type: "check" });
          cell.addClass("habit-pulse");
          const t1 = setTimeout(() => {
            cell.removeClass("habit-pulse");
            this._visualTimers = (this._visualTimers || []).filter(t => t !== t1);
          }, 400);
          this._visualTimers = this._visualTimers || [];
          this._visualTimers.push(t1);
          await this.checkMilestone(dateKey);
        } else if (newStatus !== "skipped") {
          await this.plugin.audioEngine.playSound({ type: "uncheck" });
        }

        const contentEl = this.getWeeklyContentContainer();
        if (contentEl) {
          await this.updateUnifiedProgressBar(contentEl);
          const thead = contentEl.querySelector(".habits-thead");
          if (thead) await this.updateHeaderPercentages(thead);
        }

        // Live-update parent progress counter and streak badge
        this.refreshRowMeta(habit);
      } else {
        new Notice(isAr ? "⚠️ العادة غير موجودة في الملاحظة" : "⚠️ Habit not found in note");
      }
    } catch {
      new Notice(isAr ? "⚠️ حدث خطأ أثناء تحديث العادة" : "⚠️ Error updating habit");
    } finally {
      this.isProcessing = false;
      const t2 = setTimeout(() => {
        this.isTogglingInProgress = false;
        this._visualTimers = (this._visualTimers || []).filter(t => t !== t2);
      }, 500);
      this._visualTimers = this._visualTimers || [];
      this._visualTimers.push(t2);
    }
  }

  async checkMilestone(dateKey) {
    if (!this.dailyStats[dateKey]) return;
    const { completed, total } = this.dailyStats[dateKey];
    if (total === 0) return;
    const percent = Math.round((completed / total) * 100);

    if (!this.milestoneHit) this.milestoneHit = new Map();
    const lastHit = this.milestoneHit.get(dateKey) || 0;

    let level = 0;
    if (percent >= 100) level = 100;
    else if (percent >= 75) level = 75;
    else if (percent >= 50) level = 50;
    else if (percent >= 25) level = 25;

    if (level <= lastHit) return;
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
  }

  showDayGlow(dateKey) {
    // Use the scoped weekly content container, not the generic containerEl
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
            this._visualTimers = (this._visualTimers || []).filter(t => t !== t3);
          }, 2500);
          this._visualTimers = this._visualTimers || [];
          this._visualTimers.push(t3);
        });
        break;
      }
    }
  }

  showCompletionMessage() {
    const isAr = this.isAr;
    const messages = isAr
      ? ["🌟 أحسنت! أنجزت كل عادات اليوم", "💪 يوم مثالي!", "🎯 ممتاز! واصل هكذا"]
      : ["🌟 All habits done!", "💪 Perfect day!", "🎯 Excellent! Keep going"];
    new Notice(messages[Math.floor(Math.random() * messages.length)], 3000);
  }



  refreshRowMeta(habit) {
    const container = this.getWeeklyContentContainer();
    if (!container) return;
    const isAr = this.isAr;

    // 1. Update parent progress counter if this habit is a child
    if (habit.parentId) {
      // Find the parent row — it has data-group-id matching parentId but is NOT a child row
      const parentRows = container.querySelectorAll(`.habit-row[data-group-id="${habit.parentId}"]`);
      for (const row of parentRows) {
        if (row.classList.contains('habit-row-child')) continue;
        const progressSlot = row.querySelector('.dh-child-progress');
        if (!progressSlot) break;
        const today = window.moment();
        const todayDow = today.day();
        const allHabits = this.plugin.habitManager.getActiveHabits();
        const children = allHabits.filter(h => h.parentId === habit.parentId);
        const scheduled = children.filter(c =>
          this.plugin.habitManager.isHabitScheduledForDay(c, todayDow)
        );
        if (scheduled.length > 0) {
          const todayKey = DateUtils.formatDateKey(today);
          let completedCount = 0;
          for (const child of scheduled) {
            const cellKey = `${child.id}:${todayKey}`;
            if (this.previousCellState.get(cellKey)) completedCount++;
          }
          const checkStr = completedCount === scheduled.length ? " \u2713" : "";
          progressSlot.textContent = `(${completedCount}/${scheduled.length}${checkStr})`;
          if (completedCount === scheduled.length) progressSlot.addClass("complete");
          else progressSlot.removeClass("complete");
        }
        break;
      }
    }

    // 2. Update streak badge — delay to let Vault cache flush after file write
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      const habitName = habit.name ?? "";
      const rows = container.querySelectorAll('.habit-row');
      for (const row of rows) {
        const nameEl = row.querySelector('.habit-pure-name');
        if (!nameEl || nameEl.textContent !== habitName) continue;
        const slot = row.querySelector('.dh-streak-badge-slot');
        if (!slot) break;
        while (slot.firstChild) slot.removeChild(slot.firstChild);
        // Use existing streak calculator, clear its cache for fresh read
        const calc = this.streakCalculator;
        if (calc && calc.contentCache) calc.contentCache.clear();
        (calc || new StreakCalculator(this.plugin)).calculate(habit).then(({ currentStreak }) => {
          while (slot.firstChild) slot.removeChild(slot.firstChild);
          if (currentStreak >= 2) {
            const dayWord = isAr ? "\u064a\u0648\u0645" : (currentStreak === 1 ? "day" : "days");
            const badge = slot.createSpan({
              cls: "dh-streak-badge",
              text: `\uD83D\uDD25${currentStreak}`,
            });
            badge.title = isAr
              ? `\u0633\u0644\u0633\u0644\u0629 \u0627\u0644\u0627\u0633\u062a\u0645\u0631\u0627\u0631: ${currentStreak} ${dayWord} \u0645\u062a\u0648\u0627\u0635\u0644`
              : `Streak: ${currentStreak} consecutive ${dayWord}`;
          }
        }).catch(() => { });
        break;
      }
    }, 500);
  }

  getReflectionTypeMeta(type, isAr) {
    const normalized = normalizeReflectionType(type);
    const labels = {
      Good: isAr ? "جيد" : "Good",
      Bad: isAr ? "سيئ" : "Bad",
      Lesson: isAr ? "درس" : "Lesson",
      Idea: isAr ? "فكرة" : "Idea",
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
    const cleanHeading = (heading || "").trim();
    if (!content || !cleanHeading) return [];

    const headingRegex = new RegExp(`^${Utils.escapeRegExp(cleanHeading)}\\s*$`, "m");
    const match = content.match(headingRegex);
    if (!match) return [];

    const insertPos = match.index + match[0].length;
    const headingLevel = cleanHeading.match(/^#+/)?.[0]?.length || 2;
    const nextHeadingRegex = new RegExp(`\\n#{1,${headingLevel}} `, "m");
    const afterHeading = content.substring(insertPos);
    const nextMatch = afterHeading.match(nextHeadingRegex);
    const sectionEnd = nextMatch ? insertPos + nextMatch.index : content.length;

    return content
      .substring(insertPos, sectionEnd)
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);
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
      const savedFile = await injectReflectionIntoDailyNote(this.app, this.plugin, dayDate, text, type);
      this.dailyReflectionDays.add(dateKey);
      setTimeout(() => this.renderWeeklyGrid(), 0);
      return savedFile;
    }).open();
  }



}

export { WeeklyGridView };