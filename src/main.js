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

// CSS Styling Modules
import './styles/base.css';
import './styles/grid.css';
import './styles/modal.css';
import './styles/settings.css';
import './styles/diary.css';
import './styles/dashboard.css';
import './styles/mobile.css';

/*
  FILE STRUCTURE INDEX
  1. Core Initialization — Constants, Imports, Utils, AudioEngine
  2. Plugin Class        — DailyHabitsPlugin (onload, onunload, file locking)
  3. State Management    — DEFAULT_SETTINGS, TRANSLATIONS, TranslationManager, HabitManager
  4. Habit Logic Engine  — getNoteByDate, HabitScanner, toggleHabit, StreakCalculator
  5. UI: Modals          — FileSuggest, AddHabit, RenameProgress, Comment, Reflection
  6. UI: Views           — WeeklyGridView, PluginGuideComponent, DailyHabitsSettingTab
  7. Utilities           — Mutex, TextUtils, DateUtils, helpers
*/

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Core Initialization — Constants, Imports, Utils, AudioEngine
// ═══════════════════════════════════════════════════════════════════════════════

import {
  Plugin,
  Notice,
  TFile,
} from "obsidian";

import {
  DEFAULT_REFLECTION_HEADING,
  DEFAULT_HABIT_NOTES_HEADING,
  VIEW_TYPE_WEEKLY,
  DEFAULT_SETTINGS
} from './constants.js';

import { getNoteByDate, getDailyNotesInfo } from './utils/helpers.js';
import { WeeklyGridView } from './views/WeeklyGridView.js';
import { DailyHabitsSettingTab } from './views/DailyHabitsSettingTab.js';
import { OnboardingModal } from './modals/OnboardingModal.js';

export default class DailyHabitsPlugin extends Plugin {
  async onload() {
    this.lockCount = 0;
    await this.loadSettings();
    this.isFullyLoaded = false;

    // Show Onboarding if newly updated or installed
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.lastSeenVersion !== this.manifest.version) {
        new OnboardingModal(this.app, this).open();
        this.settings.lastSeenVersion = this.manifest.version;
        this.saveSettings();
      }
    });

    this._openTimeouts = new Map();
    this.audioEngine = new AudioEngine(this);

    // Initialize Core Managers
    this.translationManager = new TranslationManager(this);
    this.habitNoteManager = new HabitNoteManager(this.app, this);
    this.habitRepository = new HabitRepository(this.app, this);
    this.habitCommentRepository = new HabitCommentRepository(this.app, this);
    this.habitManager = new HabitManager(this);
    this.migrationManager = new MigrationManager(this.app, this);
    this.habitScanner = new HabitScanner();
    this.statsService = new StatsService(this);

    // === DATA MIGRATION v3.0 & startup initialization ===
    // Will run after layout ready to ensure vault files are accessible
    this.app.workspace.onLayoutReady(async () => {
      // 1. Initialize HabitManager first (reads existing files) to prevent erasing collapsedGroups
      await this.habitManager.initialize();

      // 2. Run v3 JSON-to-file migration if needed
      await this.migrateV3Data();

      // 3. Re-initialize if migration actually wrote new files (so they are loaded into memory)
      if (this.settings.habitsBackup && this.settings.habitsBackup.length > 0) {
        await this.habitManager.initialize();
      }

      // 4. Run our schema version 1 / comments migration
      await this.migrationManager.runMigrations();

      // 5. Re-initialize HabitManager to load updated schema/properties into memory
      await this.habitManager.initialize();
      
      this.isFullyLoaded = true;

      // Refresh Weekly View if it was opened before habits were loaded
      this.app.workspace.getLeavesOfType(VIEW_TYPE_WEEKLY).forEach((leaf) => {
        if (leaf.view && leaf.view.refresh) leaf.view.refresh();
      });
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
      id: "open-onboarding",
      name: "Show Welcome & Guide",
      callback: () => new OnboardingModal(this.app, this).open(),
    });

    // Settings
    this.addSettingTab(new DailyHabitsSettingTab(this.app, this));

    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (this.isInternalFileOperation) return;
        if (!(file instanceof TFile) || !file.path.endsWith('.md')) return;
        this.handleVaultRename(file, oldPath);
      })
    );

    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (!this.settings.autoWriteHabits || !file || file.extension !== 'md') return;
        
        if (this._openTimeouts.has(file.path)) {
          clearTimeout(this._openTimeouts.get(file.path));
        }
        
        const timeoutId = setTimeout(async () => {
          this._openTimeouts.delete(file.path);
          const info = getDailyNotesInfo(this.app, this.settings);
          const format = info.format || "YYYY-MM-DD";
          
          // Strict parsing to detect if the opened file is a daily note
          const parsedDate = window.moment(file.basename, format, true);
          if (parsedDate.isValid()) {
              // Only auto-write to the daily note if it is today or in the future
              const today = window.moment();
              if (parsedDate.isBefore(today, 'day')) {
                  return;
              }
              await this.habitManager.ensureHabitsInNote(parsedDate);
          }
        }, 1500);
        
        this._openTimeouts.set(file.path, timeoutId);
      })
    );

    this.registerEvent(
      this.app.metadataCache.on('changed', async (file) => {
        if (this.isInternalFileOperation) return;
        if (!file || file.extension !== 'md') return;
        if (this.habitManager) {
          await this.habitManager.syncFile(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', async (file) => {
        if (this.isInternalFileOperation) return;
        if (this.habitManager) {
          await this.habitManager.removeFile(file);
        }
      })
    );

    if (this.settings.enableOpenReminder) {
      this.app.workspace.onLayoutReady(async () => {
        try {
          const count = await this.getIncompleteHabitsCountForToday();
          if (count > 0) {
            const msg = `📋 ${count} ${this.translationManager.t("open_reminder_notice")}`;
            new Notice(msg, 7000);
          }
        } catch (e) {
          Utils.debugLog(this, "[Open Reminder] Failed:", e);
        }

        const dnInfo = getDailyNotesInfo(this.app, this.settings);
        if (dnInfo.source === "defaults" && !this._defaultsWarningShown) {
          const isAr = this.settings.language === "ar";
          new Notice(isAr
            ? "⚠️ لم يتم اكتشاف إعدادات Daily Notes. يتم استخدام الإعدادات الافتراضية (YYYY-MM-DD). راجع تبويب 'متقدم' في إعدادات الإضافة."
            : "⚠️ Daily Notes settings not detected. Using defaults (YYYY-MM-DD). Check 'Advanced' tab in plugin settings."
            , 10000);
          this._defaultsWarningShown = true;
        }
      });
    }
  }

  async onunload() {
    if (this._openTimeouts) {
      for (const timeoutId of this._openTimeouts.values()) {
        clearTimeout(timeoutId);
      }
      this._openTimeouts.clear();
      this._openTimeouts = null;
    }
    await this.audioEngine.close();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_WEEKLY);
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

  async loadSettings() {
    const savedData = await this.loadData() || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, savedData);
    delete this.settings.reflectionJournalPath;

    if (savedData.dailyParentHeading === undefined) {
      if (this.settings.habitHeading.startsWith("## ")) {
        this.settings.habitHeading = this.settings.habitHeading.replace(/^##\s+/, "### ");
      }
      if ((this.settings.reflectionHeading || "").startsWith("## ")) {
        this.settings.reflectionHeading = this.settings.reflectionHeading.replace(/^##\s+/, "### ");
      }
      if ((this.settings.habitLogHeading || "").startsWith("## ")) {
        this.settings.habitLogHeading = this.settings.habitLogHeading.replace(/^##\s+/, "### ");
      }
      await this.saveSettings();
    }

    if (!this.settings.reflectionHeading || this.settings.reflectionHeading.includes("يومياتي")) {
      this.settings.reflectionHeading = DEFAULT_REFLECTION_HEADING;
    }
    if (!this.settings.habitLogHeading || this.settings.habitLogHeading.includes("سجل المتابعة")) {
      this.settings.habitLogHeading = DEFAULT_HABIT_NOTES_HEADING;
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
    if (!todayNote) return 0;

    const content = await this.app.vault.cachedRead(todayNote);
    let count = 0;
    const habits = this.habitManager.getHabits();
    for (const habit of habits) {
      const status = await this.statsService.getHabitStatus(habit, today, content);
      if (status === "uncompleted") {
        count++;
      }
    }
    return count;
  }

  /**
   * Migrate old habits data to v3.0 format (Files as Source of Truth)
   */
  async migrateV3Data() {
    if (this.settings.v3Migrated) return;

    if (this.settings.habits && Array.isArray(this.settings.habits) && this.settings.habits.length > 0) {
      Utils.debugLog(this, `Migrating ${this.settings.habits.length} habits to v3 (Files-based)`);
      
      for (const habit of this.settings.habits) {
        let file = this.habitNoteManager._findFileByHabitId(habit.id);
        if (!file) {
          const expectedPath = this.habitNoteManager.getHabitFilePath(habit.name, habit.archived);
          file = this.app.vault.getAbstractFileByPath(expectedPath);
        }

        if (file) {
          const props = this.habitNoteManager._habitToProps(habit);
          await this.habitNoteManager.updateHabitNoteProps(file.path, props);
        } else {
          await this.habitNoteManager.createHabitNote(habit);
        }
      }

      this.settings.habitsBackup = this.settings.habits;
      this.settings.habits = [];
    }
    
    // تنظيف collapsedGroups من IDs غير موجودة
    if (Array.isArray(this.settings.collapsedGroups) && this.habitManager) {
      const habitIds = new Set(this.habitManager.getHabits().map(h => h.id));
      const cleaned = this.settings.collapsedGroups.filter(key => {
        const id = key.split(":")[0];
        return habitIds.has(id);
      });
      if (cleaned.length !== this.settings.collapsedGroups.length) {
        this.settings.collapsedGroups = cleaned;
      }
    }

    this.settings.v3Migrated = true;
    await this.saveSettings();
    Utils.debugLog(this, `V3 Migration complete!`);
  }

  async saveSettings(options = {}) {
    await this.saveData(this.settings);

    if (!options.silent) {
      // Refresh Weekly View if open
      this.app.workspace.getLeavesOfType(VIEW_TYPE_WEEKLY).forEach((leaf) => {
        if (leaf.view instanceof WeeklyGridView) leaf.view.refresh();
      });
    }
  }

  get isInternalFileOperation() {
    return (this.lockCount || 0) > 0;
  }

  async runWithLock(callback) {
    if (this.lockCount === undefined) this.lockCount = 0;
    this.lockCount++;
    try {
      return await callback();
    } finally {
      await new Promise(resolve => setTimeout(resolve, 150));
      this.lockCount = Math.max(0, this.lockCount - 1);
    }
  }
};
