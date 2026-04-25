const moment = window.moment;

export class StreakCalculator {
  static #cache = new Map();

  constructor(plugin, contentCache = null) {
    this.plugin = plugin;
    this.contentCache = contentCache;
  }

  async calculate(habit) {
    const todayStr = moment().format("YYYY-MM-DD");
    const cached = StreakCalculator.#cache.get(habit.id);
    if (cached && cached.computedAtDate === todayStr && (Date.now() - cached.computedAt < 10 * 60 * 1000)) {
      return cached.value;
    }

    // SNAPSHOT SYSTEM LOGIC
    // Check if we have a valid snapshot in the habit settings
    let snapshot = habit.streakSnapshot || null;
    let daysToLookBack = 365;
    const MAX_FILE_READS = 200;
    
    let currentStreak = 0;
    let longestStreak = habit.savedLongestStreak || 0;
    let firstCompletionDate = null;
    let consistencyCompleted = 0;
    let consistencyScheduled = 0;
    let totalGapDays = 0;
    let gapCount = 0;
    let currentGapLength = 0;
    let ongoingGapLength = 0;
    let hasSeenFirstRightCompletion = false;
    let currentStreakBroken = false;
    let tempStreak = 0;

    const today = moment();

    // If snapshot exists, we only need to look back to the lastCalculatedDate
    if (snapshot && snapshot.lastCalculatedDate) {
      const lastCalcMoment = moment(snapshot.lastCalculatedDate);
      if (lastCalcMoment.isValid() && lastCalcMoment.isBefore(today, 'day')) {
        daysToLookBack = today.diff(lastCalcMoment, 'days');
        
        // Load state from snapshot
        currentStreak = snapshot.currentStreak || 0;
        longestStreak = Math.max(longestStreak, snapshot.longestStreak || 0);
        firstCompletionDate = snapshot.firstCompletionDate ? moment(snapshot.firstCompletionDate) : null;
        consistencyCompleted = snapshot.consistencyCompleted || 0;
        consistencyScheduled = snapshot.consistencyScheduled || 0;
        totalGapDays = snapshot.totalGapDays || 0;
        gapCount = snapshot.gapCount || 0;
        currentGapLength = snapshot.currentGapLength || 0;
        ongoingGapLength = snapshot.ongoingGapLength || 0;
        hasSeenFirstRightCompletion = snapshot.hasSeenFirstRightCompletion || false;
        
        // If we have a current streak, then the streak was not broken yet
        if (currentStreak > 0) {
          tempStreak = currentStreak;
        } else {
          currentStreakBroken = true;
        }
      } else if (lastCalcMoment.isSame(today, 'day')) {
        daysToLookBack = 0; // Already up to date! Just checking today.
        
        currentStreak = snapshot.currentStreak || 0;
        longestStreak = Math.max(longestStreak, snapshot.longestStreak || 0);
        firstCompletionDate = snapshot.firstCompletionDate ? moment(snapshot.firstCompletionDate) : null;
        consistencyCompleted = snapshot.consistencyCompleted || 0;
        consistencyScheduled = snapshot.consistencyScheduled || 0;
        totalGapDays = snapshot.totalGapDays || 0;
        gapCount = snapshot.gapCount || 0;
        currentGapLength = snapshot.currentGapLength || 0;
        ongoingGapLength = snapshot.ongoingGapLength || 0;
        hasSeenFirstRightCompletion = snapshot.hasSeenFirstRightCompletion || false;
        if (currentStreak > 0) tempStreak = currentStreak;
        else currentStreakBroken = true;
      }
    }

    let fileReads = 0;
    const CONSISTENCY_WINDOW = 30;

    for (let i = 0; i <= daysToLookBack && fileReads < MAX_FILE_READS; i++) {
      const date = today.clone().subtract(i, "days");
      const dayOfWeek = date.day();

      if (!this.plugin.habitManager.isHabitScheduledForDay(habit, dayOfWeek)) {
        continue;
      }

      if (habit.restoredDate && date.isBefore(moment(habit.restoredDate), "day")) {
        break;
      }

      const dateKey = date.clone().locale("en").format("YYYY-MM-DD");
      let content = null;

      if (this.contentCache && this.contentCache.has(dateKey)) {
        content = this.contentCache.get(dateKey);
      } else {
        // Fallback to global plugin's getNoteByDate temporarily via app access or import
        // For now, we assume getNoteByDate is injected or available via this.plugin
        const dailyNote = await this.plugin.getNoteByDateFunc(this.plugin.app, date, false, this.plugin.settings);
        if (!dailyNote) {
          if (this.plugin.settings.streakBreakOnMissingNote && i > 0) {
            if (!currentStreakBroken) currentStreakBroken = true;
            tempStreak = 0;
            if (hasSeenFirstRightCompletion) currentGapLength++; else ongoingGapLength++;
          }
          continue;
        }
        fileReads++;
        content = await this.plugin.app.vault.cachedRead(dailyNote);
        if (this.contentCache) this.contentCache.set(dateKey, content);
      }

      const habits = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
      const entry = this.plugin.findHabitEntryFunc(habits, habit.linkText, habit.nameHistory);

      if (entry && entry.skipped) {
        continue;
      }

      if (entry && entry.completed) {
        tempStreak++;
        if (!firstCompletionDate) firstCompletionDate = date.clone();

        hasSeenFirstRightCompletion = true;
        if (currentGapLength > 0) {
          totalGapDays += currentGapLength;
          gapCount++;
          currentGapLength = 0;
        }

        if (!currentStreakBroken) {
          currentStreak = tempStreak;
        }
        longestStreak = Math.max(longestStreak, tempStreak);

        if (i < CONSISTENCY_WINDOW) {
          consistencyScheduled++;
          consistencyCompleted++;
        }
      } else {
        if (i === 0) continue;

        if (!currentStreakBroken) {
          currentStreakBroken = true;
        }
        tempStreak = 0;

        if (hasSeenFirstRightCompletion) {
          currentGapLength++;
        } else {
          ongoingGapLength++;
        }

        if (i < CONSISTENCY_WINDOW) {
          consistencyScheduled++;
        }
      }
    }

    const consistencyScore = consistencyScheduled > 0
      ? Math.round((consistencyCompleted / consistencyScheduled) * 100) : null;

    const consistencyLabel = this.getConsistencyLabel(consistencyScore);
    const recoveryScore = gapCount > 0 ? (totalGapDays / gapCount) : null;

    const result = { 
      currentStreak, 
      longestStreak, 
      firstCompletionDate, 
      consistencyScore, 
      consistencyLabel, 
      consistencyCompleted, 
      consistencyScheduled, 
      recoveryScore, 
      ongoingGapLength,
      // For snapshot storage
      lastCalculatedDate: todayStr,
      totalGapDays,
      gapCount,
      currentGapLength,
      hasSeenFirstRightCompletion
    };

    // Save snapshot back to habit implicitly (the plugin must save settings)
    habit.streakSnapshot = result;

    StreakCalculator.#cache.set(habit.id, {
      value: result,
      computedAt: Date.now(),
      computedAtDate: todayStr
    });
    return result;
  }

  static invalidate(habitId) {
    StreakCalculator.#cache.delete(habitId);
  }

  getConsistencyLabel(score) {
    const t = (k) => this.plugin.translationManager.t(k);
    if (score === null) return null;
    if (score >= 85) return t("consistency_excellent");
    if (score >= 65) return t("consistency_good");
    if (score >= 40) return t("consistency_fair");
    return t("consistency_low");
  }
}
