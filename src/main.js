import { Utils } from './utils/Utils.js';
import { AudioEngine } from './services/AudioEngine.js';
import { HabitScanner } from './services/HabitScanner.js';
import { HabitNoteManager } from './services/HabitNoteManager.js';
import { HabitManager } from './services/HabitManager.js';
import { TranslationManager } from './services/TranslationManager.js';
import { HabitPostProcessor } from './views/HabitPostProcessor.js';

// CSS Styling Modules
import './styles/base.css';
import './styles/grid.css';
import './styles/modal.css';
import './styles/settings.css';
import './styles/diary.css';
import './styles/rtl.css';

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

import { getNoteByDate, findHabitEntry, getDailyNotesInfo } from './utils/helpers.js';
import { WeeklyGridView } from './views/WeeklyGridView.js';
import { DailyHabitsSettingTab } from './views/DailyHabitsSettingTab.js';
import { OnboardingModal } from './modals/OnboardingModal.js';

export default class DailyHabitsPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

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
    this.habitManager = new HabitManager(this);
    this.habitScanner = new HabitScanner();

    // === DATA MIGRATION v3.0 ===
    // Will run after layout ready to ensure vault files are accessible
    this.app.workspace.onLayoutReady(async () => {
      await this.migrateV3Data();
      
      // Initialize HabitManager (Reads all files into memory)
      await this.habitManager.initialize();

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
              await this.habitManager.ensureHabitsInNote(parsedDate);
          }
        }, 1500);
        
        this._openTimeouts.set(file.path, timeoutId);
      })
    );

    this.registerEvent(
      this.app.metadataCache.on('changed', async (file) => {
        if (!file || file.extension !== 'md') return;
        if (this.habitManager) {
          await this.habitManager.syncFile(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (this.habitManager) {
          this.habitManager.removeFile(file);
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
    this._sharedStreakCache = null;
    if (this.habitScanner) this.habitScanner.reset();
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
    if (!this.habitManager) return;
    
    // كشف نقل يدوي بين Active/ و Archive/
    if (this.habitNoteManager) {
      const moveType = this.habitNoteManager.detectManualMove(file.path, oldPath);
      if (moveType) {
        const cache = this.app.metadataCache.getFileCache(file);
        const habitId = cache?.frontmatter?.habit_id;
        if (habitId) {
          const habit = this.habitManager.getHabitById(habitId);
          if (habit) {
            habit.archived = moveType === 'archived';
            habit.archivedDate = moveType === 'archived' ? Date.now() : null;
            habit.restoredDate = moveType === 'restored' ? Date.now() : null;
            
            // Sync to properties
            const props = this.habitNoteManager._habitToProps(habit);
            await this.habitNoteManager.updateHabitNoteProps(file.path, props);
            
            // Update map
            this.habitManager.habitsMap.set(habit.id, habit);

            Utils.debugLog(this, `Manual move detected: ${habit.name} → ${moveType}`);
            return; // لا تعالج كتغيير اسم
          }
        }
      }
    }

    const oldBasename = oldPath.replace(/^.*\//, '').replace(/\.md$/, '');
    const newBasename = file.basename;
    if (oldBasename === newBasename) return;

    const oldLink = `[[${oldBasename}]]`;
    for (const habit of this.habitManager.getHabits()) {
      if (habit.linkText !== oldLink) continue;

      if (!habit.nameHistory) habit.nameHistory = [];
      if (!habit.nameHistory.includes(oldLink)) {
        habit.nameHistory.push(oldLink);
      }

      habit.linkText = `[[${newBasename}]]`;
      habit.name = newBasename;
      
      
      // Sync to properties
      const props = this.habitNoteManager._habitToProps(habit);
      await this.habitNoteManager.updateHabitNoteProps(file.path, props);
      
      // Update map
      this.habitManager.habitsMap.set(habit.id, habit);

      Utils.debugLog(this, `Vault rename synced: "${oldBasename}" → "${newBasename}"`);
    }
  }

  /**
   * Count incomplete habits for today (for the open reminder)
   * Only counts habits scheduled for today that have a daily note
   * @returns {Promise<number>} Count of incomplete habits
   */
  async getIncompleteHabitsCountForToday() {
    if (!this.habitManager) return 0;
    const today = window.moment();
    const dayOfWeek = today.day();
    const todayNote = await getNoteByDate(this.app, today, false, this.settings);
    if (!todayNote) return 0;

    const content = await this.app.vault.cachedRead(todayNote);
    const scanned = this.habitScanner.scan(content, this.settings.marker);

    let count = 0;
    const todayHabits = this.habitManager.getHabitsForDay(dayOfWeek);
    for (const habit of todayHabits) {
      const entry = findHabitEntry(scanned, habit.linkText, habit.nameHistory);
      if (!entry || (!entry.completed && !entry.skipped)) {
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
};

// ═══════════════════════════════════════════════════════════════════════════════
// 3. State Management — DEFAULT_SETTINGS, TRANSLATIONS, TranslationManager, HabitManager
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * @typedef {Object} HabitData
 * @property {string} id - Unique habit identifier
 * @property {string} name - Display name of the habit
 * @property {string} [linkText] - Text used in daily notes (e.g., [[Habit]])
 * @property {ScheduleData} schedule - Schedule configuration
 * @property {number} [currentLevel] - Current progression level (1-5)
 * @property {Array<LevelData>} [levelData] - Level progression data
 * @property {string|null} [parentId] - Parent habit id for sub-habits
 * @property {string} [color] - Theme color key (teal, blue, purple, etc.)
 * @property {'build'|'break'} [habitType] - Build or break habit
 * @property {number} [order] - Sort order among siblings
 * @property {string} [restoredDate] - Date when archived habit was restored
 * @property {string[]} [nameHistory] - Previous linkText values for historical matching after renames
 */



