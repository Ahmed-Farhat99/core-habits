import { Utils } from './utils/Utils.js';
import { AudioEngine } from './services/AudioEngine.js';
import { HabitScanner } from './services/HabitScanner.js';
import { HabitNoteManager } from './services/HabitNoteManager.js';
import { HabitManager } from './services/HabitManager.js';
import { TranslationManager } from './services/TranslationManager.js';
import { HabitPostProcessor } from './views/HabitPostProcessor.js';
import { HabitRepository } from './repositories/HabitRepository.js';
import { HabitCommentRepository } from './repositories/HabitCommentRepository.js';
import { MigrationManager } from './services/MigrationManager.js';
import { StatsService } from './services/StatsService.js';
import { DiaryService } from './services/DiaryService.js';
import { HabitJournalService } from './services/HabitJournalService.js';
import { StreakCalculator } from './services/StreakCalculator.js';
import { VoiceRecorderUtility } from './services/VoiceRecorderUtility.js';
import { NoticeService } from './services/NoticeService.js';
import { VaultSourceStore } from './services/VaultSourceStore.js';

// CSS Styling Modules
import './styles/tokens.css';
import './styles/base.css';
import './styles/animations.css';
import './styles/button.css';
import './styles/habit-row.css';
import './styles/day-cell.css';
import './styles/grid.css';
import './styles/modal.css';
import './styles/notice.css';
import './styles/settings.css';
import './styles/statistics.css';
import './styles/diary-view.css';
import './styles/weekly-grid-layout.css';
import './styles/mobile.css';



import {
  Plugin,
  TFile,
  Platform,
  normalizePath,
} from "obsidian";

import {
  DEFAULT_PARENT_HEADING_AR,
  DEFAULT_HABIT_HEADING_AR,
  DEFAULT_REFLECTION_HEADING_AR,
  DEFAULT_HABIT_NOTES_HEADING_AR,
  DEFAULT_PARENT_HEADING_EN,
  DEFAULT_HABIT_HEADING_EN,
  DEFAULT_REFLECTION_HEADING_EN,
  DEFAULT_HABIT_NOTES_HEADING_EN,
  getDefaultHeadings,
  detectInitialLanguage,
  VIEW_TYPE_WEEKLY,
  VIEW_TYPE_HABIT_EDIT,
  DEFAULT_SETTINGS
} from './constants.js';

import { getNoteByDate, getDailyNotesInfo, getDailyNoteDate } from './utils/helpers.js';
import { WeeklyGridView } from './views/WeeklyGridView.js';
import { HabitEditView } from './views/HabitEditView.js';
import { DailyHabitsSettingTab } from './views/DailyHabitsSettingTab.js';
import { OnboardingModal } from './modals/OnboardingModal.js';
import { EditHabitModal } from './modals/EditHabitModal.js';
import { AddHabitModal } from './modals/AddHabitModal.js';
import './modals/ConfirmModal.js'; // Registers the discard confirmation used by BaseHabitModal.

export default class CoreHabitsPlugin extends Plugin {
  async onload() {
    this._isUnloading = false;
    this.startupError = null;
    this._globalLockCount = 0;
    this._lockedPaths = new Map();
    this.lockCount = 0;
    await this.loadSettings();
    this.isFullyLoaded = false;
    this.startupCooldown = true;

    const delay = (this.settings.syncStartupDelay ?? 15) * 1000;
    if (delay > 0) {
      this._cooldownTimer = setTimeout(() => {
        if (this._isUnloading) return;
        this.startupCooldown = false;
        Utils.debugLog(this, "Startup cooldown ended. Auto-write is now active.");
      }, delay);
    } else {
      this.startupCooldown = false;
    }

    this._openTimeouts = new Map();
    this.audioEngine = new AudioEngine(this);

    // Initialize Core Managers
    this.vaultSourceStore = new VaultSourceStore(this.app, this);
    this.translationManager = new TranslationManager(this);
    this.habitNoteManager = new HabitNoteManager(this.app, this);
    this.habitRepository = new HabitRepository(this.app, this);
    this.habitCommentRepository = new HabitCommentRepository(this.app, this);
    this.habitJournalService = new HabitJournalService(this);
    this.habitManager = new HabitManager(this);
    this.migrationManager = new MigrationManager(this.app, this);
    this.habitScanner = new HabitScanner();
    this.statsService = new StatsService(this);
    this.streakCalculator = new StreakCalculator(this);
    this.diaryService = new DiaryService(this.app, this);
    this.registerDiaryCacheInvalidation();

    // === DATA MIGRATION v3.0 & startup initialization ===
    // Will run after layout ready to ensure vault files are accessible
    this.app.workspace.onLayoutReady(async () => {
      await this.initializePluginState();

      // Show Startup Notices (Open Reminder, Daily Notes warning, and Missed Days)
      if (this.isFullyLoaded && this.settings.enableOpenReminder) {
        try {
          const count = await this.getIncompleteHabitsCountForToday();
          if (count > 0) {
            NoticeService.action({
              icon: "📋",
              count,
              message: this.translationManager.t("open_reminder_notice"),
              actionText: this.translationManager.t("notice_action_open"),
              onAction: () => this.activateWeeklyView(),
              duration: 12000,
              plugin: this
            });
          }
        } catch (e) {
          Utils.debugLog(this, "[Open Reminder] Failed:", e);
        }
      }

      const dnInfo = getDailyNotesInfo(this.app, this.settings);
      if (!this._isFirstRunOnboarding && dnInfo.source === "defaults" && !this._defaultsWarningShown) {
        const isAr = this.settings.language === "ar";
        const noticeMsg = this.translationManager?.t("notice_daily_notes_missing")
          || (isAr
            ? "لم يتم اكتشاف إعدادات Daily Notes. يتم استخدام الإعدادات الافتراضية (YYYY-MM-DD)."
            : "Daily Notes settings not detected. Using defaults (YYYY-MM-DD).");
        NoticeService.warning(noticeMsg, 10000, this);
        this._defaultsWarningShown = true;
      }

      if (this.settings.enableMissedDaysNotice) {
        this._missedDaysTimer = setTimeout(async () => {
          if (this._isUnloading) return;
          try {
            const missed = await this.calculateMissedDays();
            if (this._isUnloading) return;
            if (missed > 1) {
              const msg = `${missed - 1} ${this.translationManager.t("missed_days_notice")}`;
              NoticeService.warning(msg, 9000, this);
            }
          } catch (e) {
            Utils.debugLog(this, "[Missed Days Notice] Failed:", e);
          }
        }, 8000);
      }
    });

    // Register Markdown Post Processor
    this.habitPostProcessor = new HabitPostProcessor(this);
    this.registerMarkdownCodeBlockProcessor("core-habits", (source, el, ctx) => {
      this.habitPostProcessor.process(source, el, ctx);
    });

    // Register Weekly View
    this.registerView(
      VIEW_TYPE_WEEKLY,
      (leaf) => new WeeklyGridView(leaf, this),
    );

    // Register Habit Edit Popout View
    this.registerView(
      VIEW_TYPE_HABIT_EDIT,
      (leaf) => new HabitEditView(leaf, this),
    );

    // Ribbon Icon - opens Weekly View
    this.addRibbonIcon("calendar", "Weekly Habits", () =>
      this.activateWeeklyView(),
    );

    this.addCommand({
      id: "open-weekly-habits",
      name: "Open Weekly View",
      callback: () => this.activateWeeklyView(),
    });

    this.addCommand({
      id: "add-habit",
      name: "Add New Habit",
      callback: () => this.openAddHabit(),
    });

    this.addCommand({
      id: "open-onboarding",
      name: "Show Welcome & Guide",
      callback: () => new OnboardingModal(this.app, this).open(),
    });

    // Settings
    this.addSettingTab(new DailyHabitsSettingTab(this.app, this));

    this.registerEvent(
      this.app.vault.on('create', async (file) => {
        if (this._isUnloading || this.isFilePathLocked(file?.path)) return;
        if (!(file instanceof TFile) || !file.path.endsWith('.md')) return;
        if (this.habitManager) {
          await this.habitManager.syncFile(file);
        }
        if (this._isUnloading) return;
        if (this.statsService) {
          await this.statsService.rescanFile(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (this._isUnloading) return;
        if (this.isFilePathLocked(file?.path) || this.isFilePathLocked(oldPath)) return;
        if (!(file instanceof TFile) || !file.path.endsWith('.md')) return;
        void this.statsService.handleFileRename(file, oldPath);
        void this.handleVaultRename(file, oldPath).catch((error) => {
          console.error("[Core Habits] Failed to sync renamed habit note:", error);
        });
      })
    );

    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (this._isUnloading || !this.isFullyLoaded || this.startupCooldown) return;
        if (!this.settings.autoWriteHabits || !file || file.extension !== 'md') return;
        if (!getDailyNoteDate(file, this.app, this.settings)) return;
        
        if (this._openTimeouts.has(file.path)) {
          clearTimeout(this._openTimeouts.get(file.path));
        }
        
        const timeoutId = setTimeout(async () => {
          if (this._isUnloading) return;
          this._openTimeouts.delete(file.path);
          const parsedDate = getDailyNoteDate(file, this.app, this.settings);
          if (parsedDate) {
              // Only auto-write to the daily note if it is today or in the future
              const today = window.moment();
              if (parsedDate.isBefore(today, 'day')) {
                  return;
              }
              try {
                if (this._isUnloading) return;
                await this.habitManager.ensureHabitsInNote(parsedDate);
              } catch (error) {
                console.error("[Core Habits] Failed to update daily note habits:", error);
                NoticeService.error(this.translationManager.t("error_modifying_note"), this);
              }
          }
        }, 1500);
        
        this._openTimeouts.set(file.path, timeoutId);
      })
    );

    this.registerEvent(
      this.app.metadataCache.on('changed', async (file) => {
        if (this._isUnloading || this.isFilePathLocked(file?.path)) return;
        if (!file || file.extension !== 'md') return;
        if (this.habitManager) {
          await this.habitManager.syncFile(file);
        }
        if (this._isUnloading) return;
        if (this.statsService) {
          await this.statsService.rescanFile(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', async (file) => {
        if (this._isUnloading || this.isFilePathLocked(file?.path)) return;
        if (this.habitManager) {
          await this.habitManager.removeFile(file);
        }
        if (this._isUnloading) return;
        if (this.statsService) {
          await this.statsService.handleFileDelete(file);
        }
      })
    );
  }

  registerDiaryCacheInvalidation() {
    const invalidateDailyNote = (file) => {
      if (this._isUnloading || !file || file.extension !== 'md') return;
      if (getDailyNoteDate(file, this.app, this.settings)) {
        this.diaryService.invalidateFile(file.path);
      }
    };
    this.registerEvent(this.app.vault.on('create', invalidateDailyNote));
    this.registerEvent(this.app.vault.on('modify', invalidateDailyNote));
    // A rename or deletion can leave entries cached under the former date key.
    const clearRenamedOrDeleted = (file) => {
      if (!this._isUnloading && file?.extension === 'md') this.diaryService.clearCache();
    };
    this.registerEvent(this.app.vault.on('rename', clearRenamedOrDeleted));
    this.registerEvent(this.app.vault.on('delete', clearRenamedOrDeleted));
  }

  async onunload() {
    this._isUnloading = true;
    this.isFullyLoaded = false;
    if (this._lockedPaths) {
      this._lockedPaths.clear();
      this._lockedPaths = null;
    }
    this._globalLockCount = 0;
    if (this._cooldownTimer) {
      clearTimeout(this._cooldownTimer);
      this._cooldownTimer = null;
    }
    if (this._missedDaysTimer) {
      clearTimeout(this._missedDaysTimer);
      this._missedDaysTimer = null;
    }
    if (this._openTimeouts) {
      for (const timeoutId of this._openTimeouts.values()) {
        clearTimeout(timeoutId);
      }
      this._openTimeouts.clear();
      this._openTimeouts = null;
    }
    if (this.habitManager) {
      try {
        await this.habitManager.flushMilestoneCheckpoints?.();
      } catch (err) {
        console.warn("[Core Habits] Error flushing checkpoints on unload:", err);
      }
      this.habitManager.destroy();
    }
    if (this.audioEngine) {
      await this.audioEngine.close();
    }
    if (this.statsService) {
      this.statsService.destroy();
    }
    if (this.diaryService) {
      this.diaryService.clearCache();
    }
    StreakCalculator.invalidateAll();
    VoiceRecorderUtility.cancelRecording();
  }

  /**
   * Initializes the plugin state safely: runs migrations, initializes habitManager,
   * checks for conflicts/malformed notes, and initializes stats index.
   * Isolates failures and exposes mobile-friendly recovery.
   * @returns {Promise<boolean>} True if startup was successful
   */
  async initializePluginState() {
    this.startupError = null;
    try {
      // 1. Initialize VaultSourceStore (Portable SSOT) before domain resolution, habits, or stats
      await this.vaultSourceStore.initialize();
      if (this._isUnloading) return false;

      // 2. Run data migrations FIRST on disk files/settings before interpreting into domain state.
      // File-level failures are isolated so a single corrupt or legacy note never halts startup.
      try {
        await this.migrationManager.migrateV3Data({ throwOnFailure: false });
      } catch (err) {
        console.error("[Core Habits] Non-fatal error during v3 data migration:", err);
      }
      if (this._isUnloading) return false;

      try {
        await this.migrationManager.runMigrations({ throwOnFailure: false });
      } catch (err) {
        console.error("[Core Habits] Non-fatal error during schema v2 migration:", err);
      }
      if (this._isUnloading) return false;

      try {
        await this.migrationManager.runSchemaV3Migration({ throwOnFailure: false });
      } catch (err) {
        console.error("[Core Habits] Non-fatal error during schema v3 migration:", err);
      }
      if (this._isUnloading) return false;

      // 3. Load persisted state on clean, migrated notes
      await this.habitManager.initialize();
      if (this._isUnloading) return false;

      // 3b. Check for repository conflicts and malformed notes to notify user gently
      const conflicts = this.habitManager.getConflicts?.() || [];
      const malformed = this.habitManager.getMalformedNotes?.() || [];

      if (conflicts.length > 0) {
        console.warn(
          `[Core Habits] Quarantined ${conflicts.length} conflicting habit(s) to protect your data:\n` +
          conflicts.map((c) => `  - [${c.type}] Habit ID: "${c.habitId}"\n    Files: ${c.paths.join("\n           ")}`).join("\n")
        );
        const conflictMsg = this.translationManager?.t("warning_duplicate_habits_quarantined", { count: conflicts.length })
          || `Core Habits: ${conflicts.length} conflicting habit(s) were quarantined to protect your data. Both copies were kept untouched. See console or settings for details.`;
        NoticeService.warning(conflictMsg, 10000, this);
      }

      if (malformed.length > 0) {
        console.warn(
          `[Core Habits] Skipped ${malformed.length} malformed note(s):\n` +
          malformed.map((m) => `  - [${m.reason}] ${m.path}: ${m.message}`).join("\n")
        );
        const malformedMsg = this.translationManager?.t("warning_malformed_habits", { count: malformed.length })
          || `Core Habits: ${malformed.length} habit note(s) are missing habit_id or unreadable and were skipped.`;
        NoticeService.warning(malformedMsg, 8000, this);
      }

      // 4. Ensure collapsed groups semantic migration completes once habits are loaded
      await this.migrationManager.migrateCollapsedGroupsSemantic();
      if (this._isUnloading) return false;

      // 5. Initialize stats index safely
      try {
        await this.statsService.initLifetimeIndex();
      } catch (statsErr) {
        console.error("[Core Habits] Non-fatal error initializing stats index:", statsErr);
      }
      if (this._isUnloading) return false;

      // 5b. Check if stats index is in degraded state and warn gently
      if (this.statsService?.isDegraded) {
        const degradedCount = this.statsService.getDegradedDates?.()?.length || 1;
        console.warn(`[Core Habits] Statistics index initialized in degraded state (${degradedCount} note(s) could not be read safely).`);
        const degradedMsg = this.translationManager?.t("warning_stats_degraded", { count: degradedCount })
          || `Core Habits: Statistics are partial. ${degradedCount} daily note(s) could not be read safely.`;
        NoticeService.warning(degradedMsg, 7000, this);
      }

      // 6. Check for partial migration failures to inform user gently without crashing
      const totalFailures = [
        ...(this.migrationManager?.lastMigrationFailures || []),
        ...(this.migrationManager?.lastV3MigrationFailures || []),
        ...(this.migrationManager?.lastV3DataFailures || [])
      ];
      if (totalFailures.length > 0) {
        console.warn(`[Core Habits] Plugin started, but ${totalFailures.length} item(s) could not be migrated automatically.`);
        const warnMsg = this.translationManager?.t("warning_migration_partial", { count: totalFailures.length })
          || `Core Habits: ${totalFailures.length} habit note(s) could not be migrated automatically. Safe backups preserved.`;
        NoticeService.warning(warnMsg, 8000, this);
      }

      this.isFullyLoaded = true;

      // Refresh Weekly View if it was opened before habits were loaded
      this.app.workspace.getLeavesOfType(VIEW_TYPE_WEEKLY).forEach((leaf) => {
        if (leaf.view && leaf.view.refresh) leaf.view.refresh();
      });

      // Check if user is an existing user with pre-existing habits
      const hasExistingHabits = (Array.isArray(this.settings.habits) && this.settings.habits.length > 0) ||
        (this.habitManager && typeof this.habitManager.getHabits === 'function' && this.habitManager.getHabits().length > 0);

      // Show Onboarding only on fresh install; show subtle notice on version upgrade
      if (!this.settings.lastSeenVersion) {
        if (hasExistingHabits) {
          this.settings.lastSeenVersion = this.manifest.version;
          void this.saveSettings();
        } else {
          this._isFirstRunOnboarding = true;
          new OnboardingModal(this.app, this).open();
          this.settings.lastSeenVersion = this.manifest.version;
          void this.saveSettings();
        }
      } else if (this.settings.lastSeenVersion !== this.manifest.version) {
        const updateMsg = this.translationManager.t("notice_plugin_updated", { version: this.manifest.version });
        if (updateMsg) {
          NoticeService.info(updateMsg, 5000, this);
        }
        this.settings.lastSeenVersion = this.manifest.version;
        void this.saveSettings();
      }

      return true;
    } catch (error) {
      if (this._isUnloading) return false;
      this.startupError = error;
      this.isFullyLoaded = false;
      console.error("[Core Habits] Startup or migration failed; automatic writes remain disabled:", error);
      NoticeService.error("Core Habits could not load its data safely. Check the recovery screen or backups before retrying.", 15000, this);
      this.app.workspace.getLeavesOfType(VIEW_TYPE_WEEKLY).forEach((leaf) => {
        if (leaf.view?.refresh) void leaf.view.refresh();
      });
      return false;
    }
  }

  /**
   * Retries plugin startup initialization safely after a failure.
   * Can be invoked from the Mobile/Desktop recovery UI.
   * @returns {Promise<boolean>} True if startup succeeded
   */
  async retryStartup() {
    this.startupError = null;
    this.isFullyLoaded = false;
    return await this.initializePluginState();
  }

  async activateWeeklyView() {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(VIEW_TYPE_WEEKLY)[0];

    if (!leaf) {
      // Create a new leaf in the main area (tab)
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_WEEKLY, active: true });
    }

    workspace.revealLeaf(leaf);
  }

  refreshWeeklyViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_WEEKLY).forEach((leaf) => {
      if (leaf.view && typeof leaf.view.refresh === "function") {
        leaf.view.refresh();
      }
    });
  }

  async loadSettings() {
    const savedData = await this.loadData() || {};
    const isNewInstall = !savedData || Object.keys(savedData).length === 0 || savedData.language === undefined;

    let initialDefaults = DEFAULT_SETTINGS;
    if (isNewInstall) {
      const detectedLang = detectInitialLanguage();
      const defaultHeadings = getDefaultHeadings(detectedLang);
      initialDefaults = Object.assign({}, DEFAULT_SETTINGS, {
        language: detectedLang,
        showHijriDate: detectedLang === "ar",
        weekStartDay: detectedLang === "ar" ? 6 : 0,
        ...defaultHeadings
      });
    }

    this.settings = Object.assign({}, initialDefaults, savedData);
    delete this.settings.reflectionJournalPath;

    if (MigrationManager.upgradeLegacyHeadings(this.settings, savedData)) {
      await this.saveSettings();
    }

    const isAr = this.settings.language === "ar";
    if (!this.settings.reflectionHeading) {
      this.settings.reflectionHeading = isAr ? DEFAULT_REFLECTION_HEADING_AR : DEFAULT_REFLECTION_HEADING_EN;
    }
    if (!this.settings.habitLogHeading) {
      this.settings.habitLogHeading = isAr ? DEFAULT_HABIT_NOTES_HEADING_AR : DEFAULT_HABIT_NOTES_HEADING_EN;
    }
    if (!this.settings.dailyParentHeading) {
      this.settings.dailyParentHeading = isAr ? DEFAULT_PARENT_HEADING_AR : DEFAULT_PARENT_HEADING_EN;
    }
    if (!this.settings.habitHeading) {
      this.settings.habitHeading = isAr ? DEFAULT_HABIT_HEADING_AR : DEFAULT_HABIT_HEADING_EN;
    }
    if (!["grouped", "timeline", "types"].includes(this.settings.diaryViewMode)) {
      this.settings.diaryViewMode = "grouped";
    }
  }

  async handleVaultRename(file, oldPath) {
    if (this.habitManager) {
      await this.habitManager.handleVaultRename(file, oldPath);
    }
  }

  async getIncompleteHabitsCountForToday() {
    if (!this.habitManager || !this.statsService) return 0;
    const today = window.moment();
    const todayNote = await getNoteByDate(this.app, today, false, this.settings);
    const habits = this.habitManager.getActiveHabits();
    const dayOfWeek = today.day();

    // Only count active habits that are scheduled for today
    const scheduledHabits = habits.filter(habit =>
      this.habitManager.isHabitScheduledForDay(habit, dayOfWeek)
    );

    if (!todayNote) {
      // If no daily note exists yet, all scheduled habits are considered incomplete
      return scheduledHabits.length;
    }

    const content = await this.app.vault.cachedRead(todayNote);
    let count = 0;
    for (const habit of scheduledHabits) {
      const status = await this.statsService.getHabitStatus(habit, today, content);
      if (status === "uncompleted") {
        count++;
      }
    }
    return count;
  }

  /**
   * Migrate old habits data to v3.0 format (Files as Source of Truth).
   * Kept as delegator for backward compatibility.
   */
  async migrateV3Data() {
    return await this.migrationManager.migrateV3Data();
  }

  async saveSettings(options = {}) {
    await this.saveData(this.settings);

    if (!options.silent && this.isFullyLoaded) {
      // Refresh Weekly View if open
      this.app.workspace.getLeavesOfType(VIEW_TYPE_WEEKLY).forEach((leaf) => {
        if (leaf.view instanceof WeeklyGridView) leaf.view.refresh();
      });
    }
  }

  async calculateMissedDays() {
    try {
      const today = window.moment().startOf("day");
      // Check backwards up to 60 days for the most recent daily note without scanning the entire vault
      for (let diff = 1; diff <= 60; diff++) {
        const pastDay = today.clone().subtract(diff, "days");
        const file = await getNoteByDate(this.app, pastDay, false, this.settings);
        if (file) {
          return diff;
        }
      }
      return 0;
    } catch (e) {
      console.warn("[Core Habits] Failed to calculate missed days:", e);
      return 0;
    }
  }

  isFilePathLocked(filePath) {
    if ((this._globalLockCount || 0) > 0) return true;
    if (!filePath || !this._lockedPaths || this._lockedPaths.size === 0) return false;
    const normalized = normalizePath(filePath.replace(/\\/g, "/"));
    if (this._lockedPaths.has(normalized)) return true;
    for (const locked of this._lockedPaths.keys()) {
      if (normalized === locked || normalized.startsWith(locked + "/")) {
        return true;
      }
    }
    return false;
  }

  get isInternalFileOperation() {
    return (this._globalLockCount || 0) > 0 || (this._lockedPaths?.size || 0) > 0;
  }

  get lockCount() {
    return (this._globalLockCount || 0) + (this._lockedPaths?.size || 0);
  }

  set lockCount(val) {
    this._globalLockCount = Math.max(0, val || 0);
  }

  async runWithLock(callback, targetPaths = []) {
    let fn = callback;
    let paths = targetPaths;
    if (typeof callback !== 'function' && typeof targetPaths === 'function') {
      fn = targetPaths;
      paths = callback;
    }
    if (typeof fn !== 'function') {
      throw new Error('runWithLock requires a callable function');
    }

    const rawPaths = Array.isArray(paths) ? paths : (paths ? [paths] : []);
    const normalizedPaths = rawPaths
      .map(p => (typeof p === 'string' ? p : p?.path))
      .filter(Boolean)
      .map(p => normalizePath(p.replace(/\\/g, "/")));

    const isGlobal = normalizedPaths.length === 0;
    if (isGlobal) {
      this._globalLockCount = (this._globalLockCount || 0) + 1;
    } else {
      if (!this._lockedPaths) this._lockedPaths = new Map();
      for (const p of normalizedPaths) {
        this._lockedPaths.set(p, (this._lockedPaths.get(p) || 0) + 1);
      }
    }

    try {
      return await fn();
    } finally {
      await new Promise(resolve => setTimeout(resolve, 150));
      if (!this._isUnloading) {
        if (isGlobal) {
          this._globalLockCount = Math.max(0, (this._globalLockCount || 0) - 1);
        } else if (this._lockedPaths) {
          for (const p of normalizedPaths) {
            const count = this._lockedPaths.get(p) || 0;
            if (count <= 1) {
              this._lockedPaths.delete(p);
            } else {
              this._lockedPaths.set(p, count - 1);
            }
          }
        }
      }
    }
  }

  /**
   * Centralized habit editor launcher.
   * On Desktop: opens Native Popout Window via official openPopoutLeaf.
   * On Mobile: opens responsive EditHabitModal.
   * Smart single-instance management: focuses existing popout if already open.
   * @param {Object} habit
   * @param {Function} onSubmit
   */
  async openEditHabit(habit, onSubmit) {
    if (Platform.isMobile) {
      new EditHabitModal(this.app, this, habit, onSubmit).open();
      return;
    }

    if (typeof this.app?.workspace?.openPopoutLeaf === 'function') {
      const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HABIT_EDIT);
      if (existingLeaves && existingLeaves.length > 0) {
        const leaf = existingLeaves[0];
        const view = leaf.view;
        if (view instanceof HabitEditView || typeof view?.setHabit === 'function') {
          // If already editing this habit, focus the window
          if (view.habit?.id === habit.id) {
            this.app.workspace.setActiveLeaf(leaf, { focus: true });
            if (view.containerEl?.win) view.containerEl.win.focus();
            return;
          }

          // If different habit and current is dirty, warn before switching
          if (typeof view.isDirty === 'function' && view.isDirty()) {
            this.app.workspace.setActiveLeaf(leaf, { focus: true });
            if (view.containerEl?.win) view.containerEl.win.focus();
            const t = (k, p = {}) => this.translationManager.t(k, p);
            NoticeService.warning(t("confirm_discard_changes_desc") || "لديك تعديلات غير محفوظة في نافذة التعديل المفتوحة.", this);
            return;
          }

          // Update habit in existing window and bring to front
          await view.setHabit(habit, onSubmit);
          this.app.workspace.setActiveLeaf(leaf, { focus: true });
          if (view.containerEl?.win) view.containerEl.win.focus();
          return;
        }
      }

      // Open new popout leaf with comfortable desktop dimensions
      const leaf = this.app.workspace.openPopoutLeaf({
        size: { width: 720, height: 640 }
      });
      await leaf.setViewState({
        type: VIEW_TYPE_HABIT_EDIT,
        active: true
      });
      const view = leaf.view;
      if (view instanceof HabitEditView || typeof view?.setHabit === 'function') {
        await view.setHabit(habit, onSubmit);
      }
    } else {
      new EditHabitModal(this.app, this, habit, onSubmit).open();
    }
  }

  /**
   * Centralized new habit modal launcher.
   * @param {Function} [onSubmit]
   */
  openAddHabit(onSubmit) {
    new AddHabitModal(
      this.app,
      this,
      onSubmit || (async (habitData) => {
        await this.habitManager.addHabit(habitData);
        this.refreshWeeklyViews();
        NoticeService.success(this.translationManager.t("success_added", { habit: habitData.name }), this);
      })
    ).open();
  }
}
