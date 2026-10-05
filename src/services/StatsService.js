const moment = window.moment || globalThis.moment;
import { getNoteByDate, getAllNotesByDate, DateUtils, getDailyNoteDate, TextUtils } from '../utils/helpers.js';
import { StreakCalculator } from './StreakCalculator.js';
import { HabitAggregator } from '../domain/stats/HabitAggregator.js';
import { MetricsCalculator } from '../domain/stats/MetricsCalculator.js';
import { InsightsEngine } from '../domain/stats/InsightsEngine.js';

export class StatsService {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.dailyCompletions = new Map();
    this.degradedDates = new Map();
    this.scanErrors = [];
    this.aggregator = new HabitAggregator();
    this._periodStatsCache = new Map();
    this._indexPromise = null;
    this._destroyed = false;
    this._cacheGeneration = 0;
  }

  /**
   * Whether stats are currently degraded due to any failed or unreadable daily notes.
   * @returns {boolean}
   */
  get isDegraded() {
    return Boolean(this.degradedDates && this.degradedDates.size > 0);
  }

  /**
   * Returns list of dates that could not be scanned safely.
   * @returns {Array<object>}
   */
  getDegradedDates() {
    return Array.from((this.degradedDates || new Map()).values());
  }

  /**
   * Returns scan errors encountered during indexing.
   * @returns {Array<object>}
   */
  getScanErrors() {
    return [...(this.scanErrors || [])];
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
    if (dateKey) {
      StreakCalculator.invalidateDailyNote(dateKey);
      this.degradedDates.delete(dateKey);
    } else {
      StreakCalculator.invalidateAll();
      this.degradedDates.clear();
      this.scanErrors = [];
    }
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
      try {
        const candidateNotes = getAllNotesByDate(this.app, dateMoment, this.plugin.settings, this.plugin.vaultSourceStore);
        if (!candidateNotes || candidateNotes.length === 0) {
          const single = await getNoteByDate(this.app, dateMoment, false, this.plugin.settings, this.plugin.vaultSourceStore);
          if (!single) {
            return { hasNote: false, scanned: [] };
          }
          candidateNotes.push(single);
        }

        if (candidateNotes.length === 1) {
          let content;
          try {
            content = await this.app.vault.cachedRead(candidateNotes[0]);
          } catch (readErr) {
            console.warn(`[Core Habits] Failed to read note for date ${dateKey}:`, readErr);
            return { hasNote: true, scanned: null, error: readErr?.message, isDegraded: true };
          }
          const scanned = this.plugin.habitScanner.scan(content, this.plugin.settings?.marker);
          if (scanned === null) {
            return { hasNote: true, scanned: null, error: "scan_failed", isDegraded: true };
          }
          return { hasNote: true, scanned };
        }

        // Conflict resolution: merge habit entries across candidate notes
        const seenHabits = new Map();
        let anyReadSuccess = false;
        let anyError = false;

        for (const note of candidateNotes) {
          let content;
          try {
            content = await this.app.vault.cachedRead(note);
            anyReadSuccess = true;
          } catch (readErr) {
            anyError = true;
            console.warn(`[Core Habits] Candidate note unreadable for date ${dateKey}:`, readErr);
            continue;
          }
          const scanned = this.plugin.habitScanner.scan(content, this.plugin.settings?.marker);
          if (scanned === null) {
            anyError = true;
            continue;
          }
          for (const entry of scanned) {
            const key = entry.habitId || (entry.text ? TextUtils.foldArabic(entry.text) : null);
            if (!key) continue;
            if (!seenHabits.has(key)) {
              seenHabits.set(key, entry);
            } else {
              const existing = seenHabits.get(key);
              if (entry.completed && !existing.completed) {
                seenHabits.set(key, entry);
              } else if (entry.skipped && !existing.completed && !existing.skipped) {
                seenHabits.set(key, entry);
              }
            }
          }
        }

        if (!anyReadSuccess && candidateNotes.length > 0) {
          return { hasNote: true, scanned: null, error: "all_candidates_failed", isDegraded: true };
        }
        return { hasNote: true, scanned: Array.from(seenHabits.values()), isDegraded: anyError };
      } catch (err) {
        return { hasNote: true, scanned: null, error: err?.message, isDegraded: true };
      }
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

    try {
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
        const candidateNotes = getAllNotesByDate(this.app, date, this.plugin.settings, this.plugin.vaultSourceStore);
        if (candidateNotes.length > 0) {
          hasNote = true;
          if (candidateNotes.length === 1) {
            try {
              const content = await this.app.vault.cachedRead(candidateNotes[0]);
              scanned = this.plugin.habitScanner.scan(content, this.plugin.settings?.marker);
            } catch {
              scanned = null;
            }
          } else {
            // Multiple candidate notes exist for this date: resolve using existing resolveHabitStatus semantics
            let winningStatus = "ignored";
            let anySuccess = false;
            for (const note of candidateNotes) {
              try {
                const content = await this.app.vault.cachedRead(note);
                const noteScanned = this.plugin.habitScanner.scan(content, this.plugin.settings?.marker);
                if (noteScanned === null) continue;
                anySuccess = true;
                const status = this.aggregator.resolveHabitStatus(
                  habit,
                  date,
                  noteScanned,
                  true,
                  this.plugin.settings,
                  this.plugin.habitManager
                );
                if (status === "completed") {
                  return "completed";
                }
                if (status === "skipped") {
                  winningStatus = "skipped";
                } else if (status === "uncompleted" && winningStatus !== "skipped") {
                  winningStatus = "uncompleted";
                }
              } catch {
                // Ignore single read error and proceed with remaining candidate notes
              }
            }
            if (!anySuccess) {
              return "unknown";
            }
            return winningStatus;
          }
        } else {
          const singleNote = await getNoteByDate(this.app, date, false, this.plugin.settings, this.plugin.vaultSourceStore);
          if (singleNote) {
            hasNote = true;
            try {
              const content = await this.app.vault.cachedRead(singleNote);
              scanned = this.plugin.habitScanner.scan(content, this.plugin.settings?.marker);
            } catch {
              scanned = null;
            }
          }
        }
      }
    } catch {
      scanned = null;
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
      try {
        const dailyNote = await getNoteByDate(this.app, dayDate, false, this.plugin.settings);
        if (dailyNote) {
          const content = await this.app.vault.cachedRead(dailyNote);
          const scanned = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
          prevWeekContent.set(DateUtils.formatDateKey(dayDate), scanned);
        } else {
          prevWeekContent.set(DateUtils.formatDateKey(dayDate), null);
        }
      } catch (err) {
        console.warn(`[Core Habits] Failed to read note for last week rate calculation:`, err);
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
    if (this.plugin?.vaultSourceStore && typeof this.plugin.vaultSourceStore.collectCandidateFiles === "function") {
      return this.plugin.vaultSourceStore.collectCandidateFiles();
    }
    return this.app.vault.getMarkdownFiles().filter(file => getDailyNoteDate(file, this.app, this.plugin?.settings, this.plugin?.vaultSourceStore));
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

      // Group files by dateKey to handle multiple notes for the same date without overwriting or double counting
      const filesByDate = new Map();
      for (const file of files) {
        const d = getDailyNoteDate(file, this.app, this.plugin?.settings, this.plugin?.vaultSourceStore);
        if (!d) continue;
        const dateKey = d.locale("en").format("YYYY-MM-DD");
        if (!filesByDate.has(dateKey)) {
          filesByDate.set(dateKey, []);
        }
        filesByDate.get(dateKey).push(file);
      }

      const dateKeys = Array.from(filesByDate.keys());
      const BATCH_SIZE = 20;

      for (let i = 0; i < dateKeys.length; i += BATCH_SIZE) {
        if (typeof onProgress === "function") {
          onProgress(Math.min(i + BATCH_SIZE, dateKeys.length), dateKeys.length);
        }
        const batchKeys = dateKeys.slice(i, i + BATCH_SIZE);
        await Promise.all(batchKeys.map(async (dateKey) => {
          try {
            const dateFiles = filesByDate.get(dateKey);
            let scanFailed = false;
            let failureReason = null;
            let completedCount = 0;

            if (dateFiles.length === 1) {
              const file = dateFiles[0];
              let content;
              try {
                content = await this.app.vault.cachedRead(file);
              } catch (readErr) {
                scanFailed = true;
                failureReason = `Failed to read ${file.path}: ${readErr?.message || readErr}`;
              }

              if (!scanFailed) {
                if (!content.includes("- [")) {
                  completedCount = 0;
                } else {
                  let habits = null;
                  try {
                    habits = this.plugin.habitScanner.scan(content, this.plugin.settings?.marker);
                  } catch (scanErr) {
                    scanFailed = true;
                    failureReason = `Scanner threw for ${file.path}: ${scanErr?.message || scanErr}`;
                  }
                  if (!scanFailed && habits === null) {
                    scanFailed = true;
                    failureReason = `Scanner returned null for ${file.path}`;
                  } else if (!scanFailed) {
                    completedCount = habits.reduce((sum, h) => sum + (h.completed ? 1 : 0), 0);
                  }
                }
              }
            } else {
              // Conflict resolution: multiple daily notes exist for this date
              // Uses resolveHabitStatus semantics to guarantee at most 1 completion per habit (no double counting)
              const completedHabits = new Set();
              const dateMoment = moment(dateKey, "YYYY-MM-DD");
              let anyReadSuccess = false;
              let anyFileFailed = false;

              for (const file of dateFiles) {
                let content;
                try {
                  content = await this.app.vault.cachedRead(file);
                  anyReadSuccess = true;
                } catch (readErr) {
                  anyFileFailed = true;
                  console.warn(`[Core Habits] Failed to read candidate daily note ${file.path}:`, readErr);
                  continue;
                }
                if (!content.includes("- [")) continue;

                let scanned = null;
                try {
                  scanned = this.plugin.habitScanner.scan(content, this.plugin.settings?.marker);
                } catch {
                  scanned = null;
                }
                if (!scanned) {
                  anyFileFailed = true;
                  continue;
                }

                for (const entry of scanned) {
                  if (!entry.completed) continue;
                  const habitId = entry.habitId;
                  const habit = habitId && this.plugin.habitManager ? this.plugin.habitManager.getHabitById(habitId) : null;

                  if (habit) {
                    const status = this.aggregator.resolveHabitStatus(
                      habit,
                      dateMoment,
                      scanned,
                      true,
                      this.plugin.settings,
                      this.plugin.habitManager
                    );
                    if (status === "completed") {
                      completedHabits.add(habit.id);
                    }
                  } else {
                    const key = TextUtils.foldArabic(entry.text || "");
                    if (key) completedHabits.add(key);
                  }
                }
              }

              if (!anyReadSuccess && dateFiles.length > 0) {
                scanFailed = true;
                failureReason = `All candidate notes failed to read for date ${dateKey}`;
              } else {
                completedCount = completedHabits.size;
                if (anyFileFailed) {
                  this.degradedDates.set(dateKey, {
                    dateKey,
                    reason: "partial_candidates_failed",
                    retainedPrevious: false,
                  });
                }
              }
            }

            if (scanFailed) {
              console.warn(`[Core Habits] Scan failed for date ${dateKey}: ${failureReason}`);
              // Retain last known valid count if available, otherwise do NOT convert to false 0 completions
              if (previousCompletions && previousCompletions.has(dateKey)) {
                const prev = previousCompletions.get(dateKey);
                nextCompletions.set(dateKey, prev);
                this.degradedDates.set(dateKey, {
                  dateKey,
                  path: dateFiles[0]?.path,
                  reason: failureReason,
                  retainedPrevious: true,
                  previousValue: prev,
                });
              } else {
                this.degradedDates.set(dateKey, {
                  dateKey,
                  path: dateFiles[0]?.path,
                  reason: failureReason,
                  retainedPrevious: false,
                });
              }
              this.scanErrors.push({ dateKey, path: dateFiles[0]?.path, reason: failureReason });
            } else {
              nextCompletions.set(dateKey, completedCount);
              this.degradedDates.delete(dateKey);
            }
          } catch (err) {
            console.error(`[Core Habits] Unexpected error indexing date ${dateKey}:`, err);
            if (previousCompletions && previousCompletions.has(dateKey)) {
              nextCompletions.set(dateKey, previousCompletions.get(dateKey));
              this.degradedDates.set(dateKey, { dateKey, reason: err?.message, retainedPrevious: true });
            } else {
              this.degradedDates.set(dateKey, { dateKey, reason: err?.message, retainedPrevious: false });
            }
            this.scanErrors.push({ dateKey, reason: err?.message });
          }
        }));
      }

      if (this._destroyed) return null;
      this.dailyCompletions = nextCompletions;
      this.isLifetimeIndexFullyLoaded = true;
      await this.recalculateLifetimeCount();
      return this.plugin.settings.lifetimeCompleted;
    } catch (e) {
      this.dailyCompletions = previousCompletions || new Map();
      this.plugin.settings.lifetimeCompleted = previousTotal ?? 0;
      this.isLifetimeIndexFullyLoaded = wasLoaded;
      console.error("[Core Habits] Non-fatal error building lifetime index:", e);
      return this.plugin.settings.lifetimeCompleted ?? 0;
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
      const date = getDailyNoteDate(file, this.app, this.plugin?.settings, this.plugin?.vaultSourceStore);
      if (!date || this._destroyed) return;

      const dateKey = date.locale("en").format("YYYY-MM-DD");
      this.invalidateCache(dateKey);

      const candidateNotes = getAllNotesByDate(this.app, date, this.plugin?.settings, this.plugin?.vaultSourceStore);
      let completedCount = 0;
      let scanFailed = false;
      let failureReason = null;

      if (candidateNotes.length <= 1) {
        let content;
        try {
          content = await this.app.vault.read(file);
        } catch (readErr) {
          scanFailed = true;
          failureReason = `Failed to read ${file.path}: ${readErr?.message || readErr}`;
        }

        if (!scanFailed && content.includes("- [")) {
          let habits = null;
          try {
            habits = this.plugin.habitScanner.scan(content, this.plugin.settings?.marker);
          } catch (scanErr) {
            scanFailed = true;
            failureReason = `Scanner error for ${file.path}: ${scanErr?.message || scanErr}`;
          }
          if (!scanFailed && habits === null) {
            scanFailed = true;
            failureReason = `Scanner returned null for ${file.path}`;
          } else if (!scanFailed) {
            completedCount = habits.reduce((sum, h) => sum + (h.completed ? 1 : 0), 0);
          }
        }
      } else {
        const completedHabits = new Set();
        let anySuccess = false;
        for (const note of candidateNotes) {
          let content;
          try {
            content = note.path === file.path ? await this.app.vault.read(note) : await this.app.vault.cachedRead(note);
            anySuccess = true;
          } catch {
            continue;
          }
          if (!content.includes("- [")) continue;
          let habits = null;
          try {
            habits = this.plugin.habitScanner.scan(content, this.plugin.settings?.marker);
          } catch {
            habits = null;
          }
          if (!habits) continue;
          for (const h of habits) {
            if (h.completed) {
              const k = h.habitId || (h.text ? TextUtils.foldArabic(h.text) : null);
              if (k) completedHabits.add(k);
            }
          }
        }
        if (!anySuccess) {
          scanFailed = true;
          failureReason = `All candidate notes failed for ${dateKey}`;
        } else {
          completedCount = completedHabits.size;
        }
      }

      if (this._destroyed) return;
      const prevCount = this.dailyCompletions.get(dateKey);

      if (scanFailed) {
        console.warn(`[Core Habits] rescanFile failed for ${file.path}: ${failureReason}`);
        if (prevCount !== undefined) {
          this.degradedDates.set(dateKey, {
            dateKey,
            path: file.path,
            reason: failureReason,
            retainedPrevious: true,
            previousValue: prevCount,
          });
        } else {
          this.degradedDates.set(dateKey, {
            dateKey,
            path: file.path,
            reason: failureReason,
            retainedPrevious: false,
          });
        }
        return;
      }

      // Successful rescan: clear degraded state for dateKey
      this.degradedDates.delete(dateKey);
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
    const date = getDailyNoteDate(file, this.app, this.plugin?.settings, this.plugin?.vaultSourceStore);
    if (!date || this._destroyed) return;

    const dateKey = date.locale("en").format("YYYY-MM-DD");
    this.invalidateCache(dateKey);

    const remainingNotes = getAllNotesByDate(this.app, date, this.plugin?.settings, this.plugin?.vaultSourceStore)
      .filter(f => f.path !== file.path);

    if (remainingNotes.length > 0) {
      await this.rescanFile(remainingNotes[0]);
      return;
    }

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
