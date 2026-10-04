const moment = window.moment || globalThis.moment;
import { getNoteByDate, DateUtils, getDailyNoteDate } from '../utils/helpers.js';
import { StreakCalculator } from './StreakCalculator.js';
import { HabitAggregator } from '../domain/stats/HabitAggregator.js';
import { MetricsCalculator } from '../domain/stats/MetricsCalculator.js';
import { InsightsEngine } from '../domain/stats/InsightsEngine.js';

export class StatsService {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.dailyCompletions = new Map();
    this.aggregator = new HabitAggregator();
    this._periodStatsCache = new Map();
    this._indexPromise = null;
    this._destroyed = false;
    this._cacheGeneration = 0;
  }

  /**
   * Clears in-memory statistics cache.
   * @param {string} [dateKey]
   */
  invalidateCache(dateKey = null) {
    if (this._destroyed) return;
    this._cacheGeneration++;
    if (this.aggregator) {
      this.aggregator.invalidateCache(dateKey);
    }
    if (this._periodStatsCache) {
      this._periodStatsCache.clear();
    }
    if (dateKey) StreakCalculator.invalidateDailyNote(dateKey);
    else StreakCalculator.invalidateAll();
    this.app?.workspace?.trigger?.("core-habits:cache-invalidated", dateKey ? { dateKey } : undefined);
  }

  /**
   * Retrieves comprehensive, fully aggregated period statistics.
   * Strictly READ-ONLY. Never writes to disk or settings.
   */
  async getPeriodStatistics(period) {
    if (!period || this._destroyed) return null;
    const generation = this._cacheGeneration;

    const cacheKey = `${period.type}_${period.startDate.format("YYYY-MM-DD")}_${period.endDate.format("YYYY-MM-DD")}`;
    if (this._periodStatsCache && this._periodStatsCache.has(cacheKey)) {
      return this._periodStatsCache.get(cacheKey);
    }

    const noteContentProvider = async (dateKey, dateMoment) => {
      const dailyNote = await getNoteByDate(this.app, dateMoment, false, this.plugin.settings);
      if (!dailyNote) {
        return { hasNote: false, scanned: [] };
      }
      const content = await this.app.vault.cachedRead(dailyNote);
      const scanned = this.plugin.habitScanner.scan(content, this.plugin.settings?.marker) || [];
      return { hasNote: true, scanned };
    };

    const startMs = period.startDate.valueOf();
    const endMs = period.endDate.valueOf();
    const habits = this.plugin.habitManager.getHabitsForTimeRange(startMs, endMs);

    const currentAgg = await this.aggregator.aggregate({
      habits,
      startDate: period.startDate,
      endDate: period.endDate,
      noteContentProvider,
      settings: this.plugin.settings,
      habitManager: this.plugin.habitManager,
      todayAnchor: moment().startOf("day"),
    });

    const compPeriod = period.getComparisonPeriod();
    const prevAgg = await this.aggregator.aggregate({
      habits,
      startDate: compPeriod.startDate,
      endDate: compPeriod.endDate,
      noteContentProvider,
      settings: this.plugin.settings,
      habitManager: this.plugin.habitManager,
      todayAnchor: moment().startOf("day"),
    });

    const weekStartDay = typeof this.plugin.settings?.weekStartDay === "number"
      ? this.plugin.settings.weekStartDay
      : 6;

    const metrics = MetricsCalculator.compute(currentAgg, prevAgg, weekStartDay, period);

    const isAr = this.plugin.settings?.language === "ar";
    const insights = InsightsEngine.generate(metrics, {
      isAr,
      t: (k, p) => this.plugin.translationManager.t(k, p),
    });

    const result = {
      period,
      metrics,
      insights,
      currentAgg,
      prevAgg,
    };

    if (!this._destroyed && generation === this._cacheGeneration) this._periodStatsCache.set(cacheKey, result);
    return result;
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
    let scanned = null;
    let hasNote = false;

    if (Array.isArray(preloadedContent)) {
      scanned = preloadedContent;
      hasNote = true;
    } else if (preloadedContent && typeof preloadedContent.hasNote === "boolean") {
      scanned = preloadedContent.scanned;
      hasNote = preloadedContent.hasNote;
    } else if (typeof preloadedContent === "string") {
      scanned = this.plugin.habitScanner.scan(preloadedContent, this.plugin.settings?.marker);
      hasNote = true;
    } else {
      const dailyNote = await getNoteByDate(this.app, date, false, this.plugin.settings);
      if (dailyNote) {
        hasNote = true;
        const content = await this.app.vault.cachedRead(dailyNote);
        scanned = this.plugin.habitScanner.scan(content, this.plugin.settings?.marker);
      }
    }

    return this.aggregator.resolveHabitStatus(
      habit,
      date,
      scanned,
      hasNote,
      this.plugin.settings,
      this.plugin.habitManager
    );
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
      parsedWeekContent.set(dateKey, typeof content === "string"
        ? { hasNote: true, scanned: this.plugin.habitScanner.scan(content, this.plugin.settings.marker) }
        : content === null
          ? { hasNote: false, scanned: [] }
          : content);
    }

    for (let i = 0; i < 7; i++) {
      const dayDate = currentWeekStart.clone().add(i, "days");
      const dateKey = DateUtils.formatDateKey(dayDate);
      dailyStats[dateKey] = { total: 0, completed: 0 };

      // Future days are not counted in stats
      if (dayDate.isAfter(today, "day")) {
        continue;
      }

      const content = parsedWeekContent.has(dateKey) ? parsedWeekContent.get(dateKey) : null;

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
  async calculateLastWeekRate(currentWeekStart, dayCount = 7) {
    const comparableDays = Math.max(0, Math.min(7, Math.trunc(dayCount)));
    if (comparableDays === 0) return null;
    const prevWeekStart = currentWeekStart.clone().subtract(7, "days");
    const prevWeekStartMs = prevWeekStart.clone().startOf("day").valueOf();
    const prevWeekEndMs = prevWeekStart.clone().add(6, "days").endOf("day").valueOf();
    const habits = this.plugin.habitManager.getHabitsForTimeRange(prevWeekStartMs, prevWeekEndMs);

    if (habits.length === 0) return null;

    // Load and scan content for previous week (once per day)
    const prevWeekContent = new Map();
    for (let i = 0; i < comparableDays; i++) {
      const dayDate = prevWeekStart.clone().add(i, "days");
      const dailyNote = await getNoteByDate(this.app, dayDate, false, this.plugin.settings);
      if (dailyNote) {
        const content = await this.app.vault.cachedRead(dailyNote);
        const scanned = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
        prevWeekContent.set(DateUtils.formatDateKey(dayDate), scanned);
      } else {
        prevWeekContent.set(DateUtils.formatDateKey(dayDate), null);
      }
    }

    const dailyStats = await this.calculateWeeklyStats(habits, prevWeekStart, prevWeekContent);

    let total = 0;
    let completed = 0;
    for (let i = 0; i < comparableDays; i++) {
      const stats = dailyStats[DateUtils.formatDateKey(prevWeekStart.clone().add(i, "days"))];
      total += stats.total;
      completed += stats.completed;
    }

    return total > 0 ? Math.round((completed / total) * 100) : null;
  }



  /**
   * Discovers and returns daily note files matching the configured folder and date format.
   * @private
   * @returns {Array<import('obsidian').TFile>}
   */
  _getDailyNoteFiles() {
    // LEGITIMATE USE: Vault scanning is required to scan daily notes and calculate lifetime statistics upon plugin initialization or manual recalculation.
    return this.app.vault.getMarkdownFiles().filter(file => getDailyNoteDate(file, this.app, this.plugin.settings));
  }

  /**
   * Synchronizes lifetime habit achievements across the vault.
   * Delegates to initLifetimeIndex to ensure consistent date filtering and index population.
   * @param {Function} [onProgress]
   * @returns {Promise<number>}
   */
  async syncLifetimeAchievements(onProgress) {
    const result = await this.initLifetimeIndex(true, onProgress);
    if (result === null) {
      throw new Error("Failed to sync lifetime stats");
    }
    return result;
  }

  async initLifetimeIndex(force = false, onProgress = null) {
    void force;
    if (this._destroyed) return null;
    if (this._indexPromise) return this._indexPromise;
    this._indexPromise = this._buildLifetimeIndex(onProgress);
    try {
      return await this._indexPromise;
    } finally {
      this._indexPromise = null;
    }
  }

  async _buildLifetimeIndex(onProgress) {
    const previousCompletions = this.dailyCompletions;
    const previousTotal = this.plugin.settings.lifetimeCompleted;
    const wasLoaded = this.isLifetimeIndexFullyLoaded;
    try {
      const files = this._getDailyNoteFiles();
      const nextCompletions = new Map();

      const BATCH_SIZE = 20;
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        if (typeof onProgress === "function") {
          onProgress(Math.min(i + BATCH_SIZE, files.length), files.length);
        }
        const batch = files.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (file) => {
          const content = await this.app.vault.cachedRead(file);
          const dateKey = getDailyNoteDate(file, this.app, this.plugin.settings).locale("en").format("YYYY-MM-DD");
          if (!content.includes("- [")) {
            nextCompletions.set(dateKey, 0);
            return;
          }
          const habits = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
          if (!habits) throw new Error(`Cannot safely scan daily note: ${file.path}`);
          const completedCount = habits.reduce((sum, h) => sum + (h.completed ? 1 : 0), 0);
          nextCompletions.set(dateKey, completedCount);
        }));
      }
      if (this._destroyed) return null;
      this.dailyCompletions = nextCompletions;
      this.isLifetimeIndexFullyLoaded = true;
      await this.recalculateLifetimeCount();
      return this.plugin.settings.lifetimeCompleted;
    } catch (e) {
      this.dailyCompletions = previousCompletions;
      this.plugin.settings.lifetimeCompleted = previousTotal;
      this.isLifetimeIndexFullyLoaded = wasLoaded;
      console.error("[Core Habits] Failed to initialize lifetime index", e);
      return null;
    }
  }

  async recalculateLifetimeCount() {
    if (this._destroyed) return;
    let total = 0;
    for (const count of this.dailyCompletions.values()) {
      total += count;
    }
    const previousTotal = this.plugin.settings.lifetimeCompleted;
    this.plugin.settings.lifetimeCompleted = total;
    try {
      await this.plugin.saveSettings({ silent: true });
    } catch (error) {
      this.plugin.settings.lifetimeCompleted = previousTotal;
      throw error;
    }
    if (this._destroyed) return;
    
    // Trigger dashboard UI refresh if active
    this.app?.workspace?.trigger?.("core-habits:stats-updated");
  }

  async rescanFile(file) {
    if (this._destroyed) return;
    if (this._indexPromise) await this._indexPromise;
    try {
      const date = getDailyNoteDate(file, this.app, this.plugin.settings);
      if (!date || this._destroyed) return;

      const dateKey = date.locale("en").format("YYYY-MM-DD");
      this.invalidateCache(dateKey);
      const content = await this.app.vault.read(file); // read latest content from disk directly
      let completedCount = 0;
      if (content.includes("- [")) {
        const habits = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
        if (!habits) throw new Error(`Cannot safely scan daily note: ${file.path}`);
        completedCount = habits.reduce((sum, h) => sum + (h.completed ? 1 : 0), 0);
      }
      if (this._destroyed) return;
      const prevCount = this.dailyCompletions.get(dateKey);
      this.dailyCompletions.set(dateKey, completedCount);
      if (this.isLifetimeIndexFullyLoaded && prevCount !== completedCount) {
        try {
          await this.recalculateLifetimeCount();
        } catch (error) {
          if (prevCount === undefined) this.dailyCompletions.delete(dateKey);
          else this.dailyCompletions.set(dateKey, prevCount);
          throw error;
        }
      }
    } catch (e) {
      console.error("[Core Habits] Failed to rescan file", file.path, e);
    }
  }

  async handleFileDelete(file) {
    if (this._destroyed) return;
    if (this._indexPromise) await this._indexPromise;
    const date = getDailyNoteDate(file, this.app, this.plugin.settings);
    if (!date || this._destroyed) return;

    const dateKey = date.locale("en").format("YYYY-MM-DD");
    this.invalidateCache(dateKey);
    if (this.dailyCompletions.has(dateKey)) {
      const previousCount = this.dailyCompletions.get(dateKey);
      this.dailyCompletions.delete(dateKey);
      if (this.isLifetimeIndexFullyLoaded) {
        try {
          await this.recalculateLifetimeCount();
        } catch (error) {
          this.dailyCompletions.set(dateKey, previousCount);
          throw error;
        }
      }
    }
  }

  async handleFileRename(file, oldPath) {
    if (this._destroyed) return;
    await this.handleFileDelete({ path: oldPath });
    if (this._destroyed) return;
    await this.rescanFile(file);
  }

  destroy() {
    this._destroyed = true;
    this.aggregator?.invalidateCache();
    this._periodStatsCache.clear();
    if (this.dailyCompletions) {
      this.dailyCompletions.clear();
    }
  }
}
