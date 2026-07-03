const moment = window.moment;
import { getNoteByDate, findHabitEntry, DateUtils, getDailyNotesInfo } from '../utils/helpers.js';

export class StatsService {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.dailyCompletions = new Map();
  }

  /**
   * Helper to determine the status of a habit on a specific date.
   * Resolves the daily note, checks if the note is missing, and checks the habit entry.
   * Returns:
   * - "completed": Habit completed
   * - "skipped": Habit skipped
   * - "uncompleted": Habit not completed
   * - "ignored": Habit should not count (either missing daily note when streakBreakOnMissing=false, or day is after archive/before restore/not scheduled)
   */
  async getHabitStatus(habit, date, preloadedContent = null) {
    const dayOfWeek = date.day();

    // 1. Check if scheduled for this day
    if (!this.plugin.habitManager.isHabitScheduledForDay(habit, dayOfWeek)) {
      return "ignored";
    }

    // 2. Check if date falls in an archived period (between archivedDate and restoredDate)
    if (habit.archivedDate && habit.restoredDate) {
      const archMoment = moment(habit.archivedDate).startOf("day");
      const restMoment = moment(habit.restoredDate).startOf("day");
      const dateMoment = date.clone().startOf("day");
      if (dateMoment.isSameOrAfter(archMoment) && dateMoment.isSameOrBefore(restMoment)) {
        return "ignored";
      }
    } else if (habit.restoredDate && date.isBefore(moment(habit.restoredDate), "day")) {
      return "ignored";
    }

    // 3. Check if after archivedDate
    const isAfterArchive = habit.archived && habit.archivedDate && 
      date.clone().startOf("day").isAfter(moment(habit.archivedDate).startOf("day"));
    if (isAfterArchive) {
      return "ignored";
    }

    // 4. Resolve content or scanned entries
    let scanned;
    if (Array.isArray(preloadedContent)) {
      scanned = preloadedContent;
    } else {
      let content = preloadedContent;
      if (content === null || content === undefined) {
        const dailyNote = await getNoteByDate(this.app, date, false, this.plugin.settings);
        if (!dailyNote) {
          // Daily note is missing
          if (this.plugin.settings.streakBreakOnMissing) {
            return "uncompleted"; // counts as scheduled but missed
          } else {
            return "ignored"; // skipped/ignored
          }
        }
        content = await this.app.vault.cachedRead(dailyNote);
      }
      scanned = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
    }

    const entry = findHabitEntry(scanned, habit.linkText, habit.nameHistory, habit.id);

    if (!entry) {
      if (habit.createdAt && date.clone().startOf("day").isBefore(window.moment(habit.createdAt).startOf("day"))) {
        return "ignored";
      }
      return "uncompleted"; // missing entry
    }
    if (entry.skipped) {
      return "skipped";
    }
    if (entry.completed) {
      return "completed";
    }
    return "uncompleted";
  }

  /**
   * Calculates completion stats for a 7-day week starting at currentWeekStart.
   * Returns daily stats map: { [dateKey]: { total: number, completed: number } }
   */
  async calculateWeeklyStats(habits, currentWeekStart, preloadedWeekContent = new Map()) {
    const dailyStats = {};
    const today = moment();

    // Optimisation: Pre-parse raw string content into scanned entries map once to avoid duplicate scanning in the loop
    const parsedWeekContent = new Map();
    for (const [dateKey, content] of preloadedWeekContent.entries()) {
      if (typeof content === "string") {
        parsedWeekContent.set(dateKey, this.plugin.habitScanner.scan(content, this.plugin.settings.marker));
      } else {
        parsedWeekContent.set(dateKey, content);
      }
    }

    for (let i = 0; i < 7; i++) {
      const dayDate = currentWeekStart.clone().add(i, "days");
      const dateKey = DateUtils.formatDateKey(dayDate);
      dailyStats[dateKey] = { total: 0, completed: 0 };

      // Future days are not counted in stats
      if (dayDate.isAfter(today, "day")) {
        continue;
      }

      const content = parsedWeekContent.get(dateKey) ?? null;

      for (const habit of habits) {
        const status = await this.getHabitStatus(habit, dayDate, content);
        if (status === "ignored") {
          continue;
        }

        dailyStats[dateKey].total++;
        if (status === "completed") {
          dailyStats[dateKey].completed++;
        } else if (status === "skipped") {
          // skipped habits don't count toward the day's expected total
          dailyStats[dateKey].total = Math.max(0, dailyStats[dateKey].total - 1);
        }
      }
    }

    return dailyStats;
  }

  /**
   * Calculates last week's completion rate percentage.
   */
  async calculateLastWeekRate(currentWeekStart) {
    const prevWeekStart = currentWeekStart.clone().subtract(7, "days");
    const prevWeekStartMs = prevWeekStart.clone().startOf("day").valueOf();
    const prevWeekEndMs = prevWeekStart.clone().add(6, "days").endOf("day").valueOf();
    const habits = this.plugin.habitManager.getHabitsForTimeRange(prevWeekStartMs, prevWeekEndMs);

    if (habits.length === 0) return 0;

    // Load and scan content for previous week (once per day)
    const prevWeekContent = new Map();
    for (let i = 0; i < 7; i++) {
      const dayDate = prevWeekStart.clone().add(i, "days");
      const dailyNote = await getNoteByDate(this.app, dayDate, false, this.plugin.settings);
      if (dailyNote) {
        const content = await this.app.vault.cachedRead(dailyNote);
        const scanned = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
        prevWeekContent.set(DateUtils.formatDateKey(dayDate), scanned);
      }
    }

    const dailyStats = await this.calculateWeeklyStats(habits, prevWeekStart, prevWeekContent);

    let total = 0;
    let completed = 0;
    for (const dateKey in dailyStats) {
      total += dailyStats[dateKey].total;
      completed += dailyStats[dateKey].completed;
    }

    return total > 0 ? Math.round((completed / total) * 100) : 0;
  }

  /**
   * Analyzes the last 4 weeks leading up to currentWeekStart.
   */
  async analyzeLastFourWeeks(currentWeekStart) {
    const today = moment();
    const weeksData = [];
    const dayStats = {};
    const habitStats = {};

    const startOfAnalysisMs = currentWeekStart.clone().subtract(3, "weeks").startOf("day").valueOf();
    const endOfAnalysisMs = currentWeekStart.clone().add(6, "days").endOf("day").valueOf();
    const habits = this.plugin.habitManager.getHabitsForTimeRange(startOfAnalysisMs, endOfAnalysisMs);

    if (habits.length === 0) {
      return { weeksData: [], dayStats: {}, bestHabit: null, worstHabit: null };
    }

    for (const habit of habits) {
      habitStats[habit.id] = {
        id: habit.id,
        name: (habit.name || habit.linkText || "Unknown").replace(/\[\[|\]\]/g, ""),
        completed: 0,
        total: 0
      };
    }

    for (let i = 0; i < 7; i++) {
      dayStats[i] = { completed: 0, total: 0 };
    }

    for (let w = 0; w < 4; w++) {
      const weekStart = currentWeekStart.clone().subtract(w * 7, "days");
      let weekCompleted = 0;
      let weekTotal = 0;

      // Preload and scan the week's contents once per day
      const weekContent = new Map();
      for (let i = 0; i < 7; i++) {
        const dayDate = weekStart.clone().add(i, "days");
        if (dayDate.isAfter(today, "day")) continue;

        const dailyNote = await getNoteByDate(this.app, dayDate, false, this.plugin.settings);
        if (dailyNote) {
          const content = await this.app.vault.cachedRead(dailyNote);
          const scanned = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
          weekContent.set(DateUtils.formatDateKey(dayDate), scanned);
        }
      }

      for (let i = 0; i < 7; i++) {
        const dayDate = weekStart.clone().add(i, "days");
        if (dayDate.isAfter(today, "day")) continue;

        const dayOfWeek = dayDate.day();
        const dateKey = DateUtils.formatDateKey(dayDate);
        const content = weekContent.get(dateKey) ?? null;

        for (const habit of habits) {
          const status = await this.getHabitStatus(habit, dayDate, content);
          if (status === "ignored" || status === "skipped") {
            continue;
          }

          weekTotal++;
          dayStats[dayOfWeek].total++;
          habitStats[habit.id].total++;

          if (status === "completed") {
            weekCompleted++;
            dayStats[dayOfWeek].completed++;
            habitStats[habit.id].completed++;
          }
        }
      }

      weeksData.push({
        weekStart,
        rate: weekTotal > 0 ? Math.round((weekCompleted / weekTotal) * 100) : 0
      });
    }

    let bestHabit = null;
    let worstHabit = null;
    let maxHabitPct = -1;
    let minHabitPct = 101;

    for (const hId in habitStats) {
      const st = habitStats[hId];
      if (st.total > 0) {
        const pct = Math.round((st.completed / st.total) * 100);
        st.pct = pct;
        if (pct > maxHabitPct) {
          maxHabitPct = pct;
          bestHabit = { ...st };
        }
        if (pct < minHabitPct) {
          minHabitPct = pct;
          worstHabit = { ...st };
        }
      }
    }

    return { weeksData, dayStats, bestHabit, worstHabit };
  }

  async syncLifetimeAchievements(onProgress) {
    let totalCompleted = 0;
    try {
      const info = getDailyNotesInfo(this.app, this.plugin.settings);
      let files = this.app.vault.getMarkdownFiles().filter(f => !f.path.startsWith(".obsidian"));
      if (info.folder) {
        files = files.filter(f => f.path.startsWith(info.folder));
      }
      
      const BATCH_SIZE = 20;
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        if (typeof onProgress === "function") {
          onProgress(Math.min(i + BATCH_SIZE, files.length), files.length);
        }
        const batch = files.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(async (file) => {
          const content = await this.app.vault.cachedRead(file);
          if (!content.includes("- [")) return 0;
          const habits = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
          return habits.reduce((sum, h) => sum + (h.completed ? 1 : 0), 0);
        }));
        totalCompleted += batchResults.reduce((sum, n) => sum + n, 0);
      }
      this.plugin.settings.lifetimeCompleted = totalCompleted;
      await this.plugin.saveSettings();
      return totalCompleted;
    } catch (e) {
      console.error("[Core Habits] Failed to sync lifetime stats", e);
      this.plugin.settings.lifetimeCompleted = null;
      throw e;
    }
  }

  async initLifetimeIndex() {
    this.dailyCompletions = new Map();
    try {
      const info = getDailyNotesInfo(this.app, this.plugin.settings);
      let files = this.app.vault.getMarkdownFiles().filter(f => !f.path.startsWith(".obsidian"));
      if (info.folder) {
        files = files.filter(f => f.path.startsWith(info.folder));
      }
      
      // Filter only daily notes matching the configuration format
      files = files.filter(f => {
        const date = window.moment(f.basename, info.format, true);
        return date.isValid();
      });

      const BATCH_SIZE = 20;
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (file) => {
          const content = await this.app.vault.cachedRead(file);
          const dateKey = file.basename;
          if (!content.includes("- [")) {
            this.dailyCompletions.set(dateKey, 0);
            return;
          }
          const habits = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
          const completedCount = habits.reduce((sum, h) => sum + (h.completed ? 1 : 0), 0);
          this.dailyCompletions.set(dateKey, completedCount);
        }));
      }

      this.recalculateLifetimeCount();
    } catch (e) {
      console.error("[Core Habits] Failed to initialize lifetime index", e);
    }
  }

  recalculateLifetimeCount() {
    let total = 0;
    for (const count of this.dailyCompletions.values()) {
      total += count;
    }
    this.plugin.settings.lifetimeCompleted = total;
    this.plugin.saveSettings({ silent: true });
    
    // Trigger dashboard UI refresh if active
    const activeView = this.app.workspace.getLeavesOfType("weekly-habits-view")[0]?.view;
    if (activeView && activeView.currentViewMode === "dashboard") {
      activeView.renderWeeklyGrid();
    }
  }

  async rescanFile(file) {
    if (!this.dailyCompletions) {
      this.dailyCompletions = new Map();
    }
    try {
      const info = getDailyNotesInfo(this.app, this.plugin.settings);
      const date = window.moment(file.basename, info.format, true);
      if (!date.isValid()) return;

      const dateKey = file.basename;
      const content = await this.app.vault.read(file); // read latest content from disk directly
      if (!content.includes("- [")) {
        this.dailyCompletions.set(dateKey, 0);
      } else {
        const habits = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
        const completedCount = habits.reduce((sum, h) => sum + (h.completed ? 1 : 0), 0);
        this.dailyCompletions.set(dateKey, completedCount);
      }
      this.recalculateLifetimeCount();
    } catch (e) {
      console.error("[Core Habits] Failed to rescan file", file.path, e);
    }
  }

  handleFileDelete(file) {
    if (!this.dailyCompletions) return;
    const info = getDailyNotesInfo(this.app, this.plugin.settings);
    const date = window.moment(file.basename, info.format, true);
    if (!date.isValid()) return;

    const dateKey = file.basename;
    if (this.dailyCompletions.has(dateKey)) {
      this.dailyCompletions.delete(dateKey);
      this.recalculateLifetimeCount();
    }
  }
}
