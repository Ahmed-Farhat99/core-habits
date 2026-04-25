import { Utils } from './utils/Utils.js';
import { Mutex } from './utils/Mutex.js';
import { AudioEngine } from './services/AudioEngine.js';
import { VoiceRecorderUtility } from './services/VoiceRecorderUtility.js';
import { HabitScanner } from './services/HabitScanner.js';
import { StreakCalculator } from './services/StreakCalculator.js';

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

const {
  Plugin,
  ItemView,
  Setting,
  Notice,
  TFile,
  normalizePath,
  setIcon,
  FuzzySuggestModal,
  Modal,
  debounce,
  PluginSettingTab,
  Platform,
} = require("obsidian");

// Use window.moment instead of destructuring from obsidian
// This is more reliable across different Obsidian versions
const moment = window.moment;
const FILE_LOCK_CLEANUP_INTERVAL = 5 * 60 * 1000;
const LOCK_STALE_MS = 10 * 60 * 1000;

const DEFAULT_MARKER = "[habit:: true]";
const DEFAULT_PARENT_HEADING = "## 🌟 يومياتي";
const DEFAULT_REFLECTION_HEADING = "### 📝 تدوينات اليوم";
const DEFAULT_HABIT_NOTES_HEADING = "### 💬 ملاحظات العادات";
const REFLECTION_ENTRY_TYPES = ["Good", "Bad", "Lesson", "Idea"];

function normalizeReflectionType(type) {
  const cleanType = String(type || "").trim();
  return REFLECTION_ENTRY_TYPES.includes(cleanType) ? cleanType : "Idea";
}

const DEBOUNCE_DELAY_MS = 300;

/** Day-of-week translation keys (0=Sunday .. 6=Saturday). Use with translationManager.t(). */
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const VIEW_TYPE_WEEKLY = "weekly-habits-view";







/** Shared color palette — used by both AddHabitModal and WeeklyGridView.
 *  Colors chosen based on behavioral psychology + modern design principles:
 *  - Cool tones (teal/blue/cyan/indigo): focus, calm, clarity
 *  - Warm tones (amber/orange/rose): energy, passion, motivation
 *  - Growth tones (green/lime): renewal, health, progress
 *  - Neutral (slate): stability, maturity for established habits
 */
const HABIT_COLORS_PALETTE = [
  // Original 6 colors (preserved for backward compatibility)
  { id: "teal", hex: "#14b8a6" },  // Calm & balance — daily essentials
  { id: "blue", hex: "#3b82f6" },  // Trust & focus — learning & work
  { id: "purple", hex: "#8b5cf6" },  // Creativity & spirituality — reflection
  { id: "amber", hex: "#f59e0b" },  // Energy & warmth — morning & exercise
  { id: "rose", hex: "#f43f5e" },  // Passion & challenge — breaking bad habits
  { id: "green", hex: "#10b981" },  // Growth & health — nutrition & wellness
  // New 6 colors (behavioral psychology + modern design)
  { id: "indigo", hex: "#6366f1" },  // Depth & wisdom — reading & contemplation
  { id: "cyan", hex: "#06b6d4" },  // Clarity & purity — hydration & cleanliness
  { id: "pink", hex: "#ec4899" },  // Care & connection — social habits
  { id: "orange", hex: "#f97316" },  // Enthusiasm & productivity — achievement
  { id: "lime", hex: "#84cc16" },  // Renewal & freshness — new habits
  { id: "slate", hex: "#64748b" },  // Stability & maturity — established routines
];

/** Resolves a color id to its hex value. Falls back to first palette entry. */
function resolveHabitColorHex(colorId) {
  const entry = HABIT_COLORS_PALETTE.find(c => c.id === colorId);
  return entry ? entry.hex : HABIT_COLORS_PALETTE[0].hex;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Plugin Class — DailyHabitsPlugin
// ═══════════════════════════════════════════════════════════════════════════════
module.exports = class DailyHabitsPlugin extends Plugin {
  async onload() {
    this.fileLocks = new Map();
    this.audioEngine = new AudioEngine(this);
    this.getNoteByDateFunc = getNoteByDate;
    this.findHabitEntryFunc = findHabitEntry;
    await this.loadSettings();

    // === DATA MIGRATION v2.0 ===
    // Fix old habits that don't have the new v2.0 fields
    await this.migrateHabitsData();

    // Initialize TranslationManager
    this.translationManager = new TranslationManager(this);

    // Initialize HabitManager
    this.habitManager = new HabitManager(this);

    // Initialize HabitScanner
    this.habitScanner = new HabitScanner();

    this.registerInterval(
      window.setInterval(() => this.cleanStaleLocks(), FILE_LOCK_CLEANUP_INTERVAL)
    );

    // Register Weekly View
    this.registerView(
      VIEW_TYPE_WEEKLY,
      (leaf) => new WeeklyGridView(leaf, this),
    );

    // Ribbon Icon - opens Weekly View
    this.addRibbonIcon("calendar", "Weekly Habits", () =>
      this.activateWeeklyView(),
    );

    // Command
    this.addCommand({
      id: "open-weekly-habits",
      name: "Open Weekly View",
      callback: () => this.activateWeeklyView(),
    });

    // Settings
    this.addSettingTab(new DailyHabitsSettingTab(this.app, this));

    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (!(file instanceof TFile) || !file.path.endsWith('.md')) return;
        this.handleVaultRename(file, oldPath);
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
        if (dnInfo.source === "defaults" && !this.settings._defaultsWarningShown) {
          const isAr = this.settings.language === "ar";
          new Notice(isAr
            ? "⚠️ لم يتم اكتشاف إعدادات Daily Notes. يتم استخدام الإعدادات الافتراضية (YYYY-MM-DD). راجع تبويب 'متقدم' في إعدادات الإضافة."
            : "⚠️ Daily Notes settings not detected. Using defaults (YYYY-MM-DD). Check 'Advanced' tab in plugin settings."
            , 10000);
          this.settings._defaultsWarningShown = true;
          await this.saveSettings({ silent: true });
        }
      });
    }
  }

  async onunload() {
    this.fileLocks.clear();
    this._sharedStreakCache = null;
    if (this.habitScanner) this.habitScanner.reset();
    await this.audioEngine.close();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_WEEKLY);
  }

  cleanStaleLocks() {
    const now = Date.now();
    for (const [path, entry] of this.fileLocks.entries()) {
      if (now - entry.lastUsed > LOCK_STALE_MS) {
        this.fileLocks.delete(path);
      }
    }
  }

  getFileLock(path) {
    const existing = this.fileLocks.get(path);
    if (existing) {
      existing.lastUsed = Date.now(); // refresh timestamp on every access
      return existing.mutex;
    }
    // Mutex is defined lower in the file but hoisted conceptually by runtime evaluation
    const entry = { mutex: new Mutex(), lastUsed: Date.now() };
    this.fileLocks.set(path, entry);
    return entry.mutex;
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

  handleVaultRename(file, oldPath) {
    const oldBasename = oldPath.replace(/^.*\//, '').replace(/\.md$/, '');
    const newBasename = file.basename;
    if (oldBasename === newBasename) return;

    const oldLink = `[[${oldBasename}]]`;
    let changed = false;

    for (const habit of this.settings.habits) {
      if (habit.linkText !== oldLink) continue;

      if (!habit.nameHistory) habit.nameHistory = [];
      if (!habit.nameHistory.includes(oldLink)) {
        habit.nameHistory.push(oldLink);
      }

      habit.linkText = `[[${newBasename}]]`;
      habit.name = newBasename;
      changed = true;
      Utils.debugLog(this, `Vault rename synced: "${oldBasename}" → "${newBasename}"`);
    }

    if (changed) {
      if (!this._isSaving) {
        this.saveSettings().catch(e => console.error('[Core Habits] Failed to save after rename:', e));
      } else {
        Utils.debugLog(this, `Vault rename synced: avoided write conflict because _isSaving is true`);
      }
    }
  }

  /**
   * Count incomplete habits for today (for the open reminder)
   * Only counts habits scheduled for today that have a daily note
   * @returns {Promise<number>} Count of incomplete habits
   */
  async getIncompleteHabitsCountForToday() {
    if (!this.habitManager) return 0;
    const today = moment();
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
   * Migrate old habits data to v2.0 format
   * Adds missing fields: archived, archivedDate, order
   */
  async migrateHabitsData() {
    if (this.settings.dataVersion >= 2) return;

    if (!this.settings.habits || !Array.isArray(this.settings.habits)) {
      return;
    }

    let needsSave = false;

    this.settings.habits.forEach((habit, index) => {
      if (typeof habit.archived === "undefined") {
        habit.archived = false;
        needsSave = true;
      }

      if (typeof habit.createdAt === "undefined") {
        let createdAt = Date.now();
        if (habit.id && habit.id.startsWith("habit-")) {
          const parts = habit.id.split("-");
          if (parts.length > 1) {
            const parsed = parseInt(parts[1], 10);
            if (!isNaN(parsed)) createdAt = parsed;
          }
        }
        habit.createdAt = createdAt;
        needsSave = true;
      }

      if (typeof habit.archivedDate === "undefined") {
        habit.archivedDate = null;
        needsSave = true;
      }

      if (typeof habit.order === "undefined") {
        habit.order = index;
        needsSave = true;
      }

      if (typeof habit.restoredDate === "undefined") {
        habit.restoredDate = null;
        needsSave = true;
      }

      if (typeof habit.savedLongestStreak === "undefined") {
        habit.savedLongestStreak = 0;
        needsSave = true;
      }

      if (typeof habit.color === "undefined") {
        habit.color = "teal";
        needsSave = true;
      }

      if (!Array.isArray(habit.nameHistory)) {
        habit.nameHistory = [];
        needsSave = true;
      }

      if (habit.atomicDescription) {
        if (typeof habit.atomicDescription.why !== "undefined") {
          habit.atomicDescription.identity = habit.atomicDescription.why;
          delete habit.atomicDescription.why;
          needsSave = true;
        }
        if (typeof habit.atomicDescription.resistance !== "undefined") {
          // Both break and build might have had resistance mapped to something else, moving to friction
          habit.atomicDescription.friction = habit.atomicDescription.resistance;
          delete habit.atomicDescription.resistance;
          needsSave = true;
        }
      }
    });

    if (typeof this.settings.dataVersion === "undefined") {
      this.settings.dataVersion = 2;
      needsSave = true;
    }

    if (needsSave) {
      await this.saveSettings({ silent: true });
    }
  }

  async saveSettings(options = {}) {
    // Prevent cascade: mark saving state to suppress vault.on('modify') events during save
    this._isSaving = true;
    try {
      await this.saveData(this.settings);
    } finally {
      // Always release the flag, even if saveData throws
      this._isSaving = false;
    }

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

/**
 * @typedef {Object} ScheduleData
 * @property {'daily'|'weekly'} type - Schedule type ('all-days' migrated to 'daily')
 * @property {number[]} days - Days of week (0=Sunday, 6=Saturday)
 */

/**
 * @typedef {Object} LevelData
 * @property {string} goal - Level goal description
 * @property {string} condition - Success condition
 * @property {boolean} achieved - Whether level is completed
 */

const DEFAULT_SETTINGS = {
  marker: DEFAULT_MARKER,
  showCount: true,
  lifetimeCompleted: null,
  debugMode: false,
  dataVersion: 2,
  hideYear: false,

  habits: [],

  weekStartDay: 6,
  showHijriDate: true,

  dailyParentHeading: DEFAULT_PARENT_HEADING,
  habitHeading: "### 🔄 تتبع العادات",
  autoWriteHabits: true,

  dailyNotesFolder: "",
  dailyNotesSource: "auto",
  dateFormat: "YYYY-MM-DD",

  language: "ar",

  // Streak behaviour: if true, a day with no daily note is treated as a missed day
  // and breaks the current streak. If false (default), missing notes are silently skipped.
  streakBreakOnMissingNote: false,

  enableOpenReminder: true,

  enableSound: true,

  // Collapsed habit groups (array of parent IDs) — persisted across Obsidian restarts
  collapsedGroups: [],

  // Habit Context (Comments)
  enableHabitContext: true,
  habitLogHeading: DEFAULT_HABIT_NOTES_HEADING,

  // Daily Note Journal
  enableReflectionJournal: true,
  reflectionHeading: DEFAULT_REFLECTION_HEADING,
  diaryViewMode: "grouped",
};

const TRANSLATIONS = {
  en: {
    settings_title: "Core Habits",
    habit_marker: "Habit marker",
    habit_marker_desc: "String to identify habits in daily notes.",
    show_count: "Show progress",
    show_count_desc: "Show completed/total count in header.",
    hide_year: "Hide year",
    week_start: "Week start day",
    week_start_desc: "Day the week starts on.",
    add_habit_btn: "+ Add habit",
    delete: "Delete",
    error_name_required: "Habit name is required",
    success_added: 'Added "{habit}"',
    language: "Language",
    language_desc: "Choose plugin interface language.",
    sat: "Saturday",
    sun: "Sunday",
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    habit_name: "Habit name",
    frequency: "Frequency",
    import_habits: "Import from today's note",
    import_desc: "Scan today's note for habits and add them.",
    edit_habit: "Edit",
    streak_break_on_missing: "Missing note breaks streak",
    streak_break_on_missing_desc: "If enabled, a day with no daily note counts as a missed day and breaks your streak. If disabled (default), missing notes are ignored — streak is only broken when a note exists but the habit is unchecked.",
    habit_section_heading: "Habit section heading",
    habit_section_heading_desc: "The heading under which habits will be written in daily notes.",
    auto_write_habits: "Auto-write habits",
    auto_write_habits_desc: "Automatically add habits to daily notes when you open them.",
    level: "Level",
    build_habit: "Build 🟢",
    break_habit: "Break 🔴",
    consistency_excellent: "Excellent",
    consistency_good: "Good",
    consistency_fair: "Fair",
    consistency_low: "Needs work",

    open_reminder: "Reminder on open",
    open_reminder_desc: "Show a notice with incomplete habits count when Obsidian opens.",
    open_reminder_notice: "incomplete habits today",
    enable_sound: "Enable sound effects",
    enable_sound_desc: "Play feedback sounds when checking/unchecking habits and reaching milestones.",
    show_hijri_date: "Show Hijri date",
    show_hijri_date_desc: "Display the Hijri (Islamic) calendar date alongside the Gregorian date.",
    parent_habit: "Parent habit (optional)",
    parent_habit_none: "— None (top-level) —",
    tab_basics: "⚙️ Basics",
    tab_habits: "📋 Habits",
    tab_advanced: "🔗 Advanced",
    tab_guide: "📖 Guide",
    empty_state_title: "No habits yet",
    empty_state_desc: "Start your journey towards better habits and stick to them daily.",
    empty_state_btn: "+ Add first habit",

    // --- Habit Context (Comments) Translations ---
    enable_habit_context: "Enable habit context",
    enable_habit_context_desc: "Allow adding timestamped habit comments inside the matching Daily Note.",
    habit_log_heading: "Habit log heading",
    habit_log_heading_desc: "The heading inside each Daily Note where comments will be injected.",

    // --- Daily Note Journal Translations ---
    enable_reflection_journal: "Enable daily journal",
    enable_reflection_journal_desc: "Allow writing daily logs into the matching Daily Note.",
    reflection_heading: "Daily logs heading",
    reflection_heading_desc: "The heading inside each Daily Note where daily entries will be listed.",
    reflection_modal_title: "How was your day?",
  },
  ar: {
    settings_title: "إعدادات Core Habits",
    habit_marker: "علامة العادة",
    habit_marker_desc: "النص المستخدم لتمييز العادات في الملاحظات اليومية.",
    show_count: "إظهار التقدم",
    show_count_desc: "عرض عدد المكتمل/الكلي في العنوان.",
    hide_year: "إخفاء السنة",
    week_start: "بداية الأسبوع",
    week_start_desc: "اليوم الذي يبدأ به الأسبوع.",
    add_habit_btn: "+ إضافة عادة",
    delete: "حذف",
    error_name_required: "اسم العادة مطلوب",
    success_added: 'تمت إضافة "{habit}"',
    language: "اللغة / Language",
    language_desc: "اختر لغة الواجهة.",
    sat: "السبت",
    sun: "الأحد",
    mon: "الاثنين",
    tue: "الثلاثاء",
    wed: "الأربعاء",
    thu: "الخميس",
    fri: "الجمعة",
    habit_name: "اسم العادة",
    frequency: "التكرار",
    import_habits: "استيراد من ملاحظة اليوم",
    import_desc: "فحص ملاحظة اليوم وإضافة العادات الجديدة للإعدادات.",
    edit_habit: "تعديل",
    streak_break_on_missing: "غياب الملاحظة يكسر السلسلة",
    streak_break_on_missing_desc: "عند التفعيل: يوم بلا ملاحظة يومية = يوم فائت يكسر السلسلة. عند الإيقاف (الافتراضي): الأيام بلا ملاحظة تُتجاهل — السلسلة تنكسر فقط عندما توجد ملاحظة لكن العادة لم تُنجَز.",
    level: "المستوى",
    habit_section_heading: "عنوان قسم العادات",
    habit_section_heading_desc: "العنوان الذي سيتم كتابة العادات تحته في الملاحظات اليومية.",
    auto_write_habits: "كتابة العادات تلقائياً",
    auto_write_habits_desc: "إضافة العادات تلقائياً عند فتح الملاحظة اليومية.",
    build_habit: "بناء 🟢",
    break_habit: "كسر 🔴",
    consistency_excellent: "ممتاز",
    consistency_good: "جيد",
    consistency_fair: "مقبول",
    consistency_low: "يحتاج تحسين",

    open_reminder: "تذكير عند الفتح",
    open_reminder_desc: "عرض إشعار بعدد العادات غير المكتملة عند فتح Obsidian.",
    open_reminder_notice: "عادة غير مكتملة اليوم",
    enable_sound: "تفعيل المؤثرات الصوتية",
    enable_sound_desc: "تشغيل أصوات عند تحديد العادات وإلغائها والوصول إلى الإنجازات.",
    show_hijri_date: "إظهار التاريخ الهجري",
    show_hijri_date_desc: "عرض التاريخ الهجري بجانب التاريخ الميلادي.",
    parent_habit: "العادة الأم (اختياري)",
    parent_habit_none: "— بلا (مستقلة) —",
    tab_basics: "⚙️ الأساسيات",
    tab_habits: "📋 العادات",
    tab_advanced: "🔗 متقدم",
    tab_guide: "📖 دليل الإضافة",
    empty_state_title: "لا توجد عادات بعد",
    empty_state_desc: "ابدأ رحلتك نحو عادات أفضل والتزم بها يومياً.",
    empty_state_btn: "+ إضافة أول عادة",

    // --- Habit Context (Comments) Translations ---
    enable_habit_context: "تفعيل تعليقات العادة (سياق العادة)",
    enable_habit_context_desc: "السماح بكتابة تعليقات العادات داخل ملف اليوم نفسه.",
    habit_log_heading: "عنوان تعليقات العادات",
    habit_log_heading_desc: "العنوان داخل ملف اليوم الذي ستُحفظ تحته تعليقات العادات.",

    // --- Daily Note Journal Translations ---
    enable_reflection_journal: "تفعيل سجل اليوميات",
    enable_reflection_journal_desc: "السماح بكتابة اليوميات داخل ملف اليوم نفسه بدل ملف مركزي.",
    reflection_heading: "عنوان قسم اليوميات",
    reflection_heading_desc: "العنوان داخل ملف اليوم الذي ستُضاف تحته تدوينات اليوم.",
    reflection_modal_title: "كيف كان يومك تقييماً عاماً؟",
  },
};

class TranslationManager {
  constructor(plugin) {
    this.plugin = plugin;
  }

  t(key, params = {}) {
    const lang = this.plugin.settings.language || "ar";
    const dict = TRANSLATIONS[lang] || TRANSLATIONS["en"];
    let text = dict[key] || TRANSLATIONS["en"][key] || key;

    Object.keys(params).forEach((param) => {
      text = text.replace(`{${param}}`, params[param]);
    });

    return text;
  }
}

class HabitManager {
  constructor(plugin) {
    this.plugin = plugin;
  }

  /**
   * Get all habits
   * @returns {Array} Array of habit objects
   */
  getHabits() {
    return this.plugin.settings.habits || [];
  }

  /**
   * Get habits that were active during a specific time range.
   * @param {number} rangeStartMs - Start of the time range in milliseconds
   * @param {number} rangeEndMs - End of the time range in milliseconds
   */
  getHabitsForTimeRange(rangeStartMs, rangeEndMs) {
    const allHabits = this.getHabits();
    return allHabits.filter((habit) => {
      const createdAt = habit.createdAt || 0;

      // Scenario 3: Hide if created after this range
      if (createdAt > rangeEndMs) {
        return false;
      }

      // Scenario 1 & 2: Archived check
      if (habit.archived) {
        if (habit.archivedDate && habit.archivedDate < rangeStartMs) {
          return false; // Archived before the range started
        }
      }

      // Scenario 4: Restored habits are naturally caught by the `!archived` branch 
      // where they are treated as always active.

      return true;
    });
  }

  /**
   * Get a habit by ID
   * @param {string} id - Habit ID
   * @returns {Object|null} Habit object or null
   */
  getHabitById(id) {
    return this.getHabits().find((h) => h.id === id) || null;
  }

  /**
   * Add a new habit
   * @param {Object} habitData - Habit data {name, schedule, habitType, atomicDescription, parentId}
   * @returns {Promise<Object>} The created habit
   */
  async addHabit(habitData) {
    const errors = this.validateHabit(habitData);
    if (errors.length > 0) {
      throw new Error(`Validation failed: ${errors.join(", ")}`);
    }

    // Check for duplicate names
    const isAr = this.plugin.settings.language === "ar";
    const existingHabit = this.getHabits().find(
      (h) =>
        h.name.trim().toLowerCase() === habitData.name.trim().toLowerCase(),
    );
    if (existingHabit) {
      const typeLabel = existingHabit.habitType === "break"
        ? (isAr ? "ترك عادة" : "break habit")
        : (isAr ? "بناء عادة" : "build habit");
      throw new Error(
        isAr
          ? `عادة بنفس الاسم موجودة بالفعل (${typeLabel}): "${habitData.name}"`
          : `A habit with this name already exists (${typeLabel}): "${habitData.name}"`,
      );
    }

    // Auto-generate linkText if not provided
    const linkText = habitData.linkText || `[[${habitData.name.trim()}]]`;

    const newHabit = {
      id: habitData.id || `habit-${Date.now()}`,
      createdAt: habitData.createdAt || Date.now(),
      name: habitData.name,
      linkText: linkText,
      schedule: habitData.schedule || {
        type: "daily",
        days: [0, 1, 2, 3, 4, 5, 6],
      },
      levelData: habitData.levelData || null,
      currentLevel: habitData.currentLevel || null,
      order: habitData.order ?? this.getActiveHabits().length,
      archived: habitData.archived ?? false,
      archivedDate: habitData.archivedDate || null,
      habitType: habitData.habitType || "build",
      atomicDescription: habitData.atomicDescription || null,
      parentId: habitData.parentId || null,
      color: habitData.color || "teal",
      nameHistory: [],
    };

    this.plugin.settings.habits.push(newHabit);
    await this.plugin.saveSettings();

    Utils.debugLog(this.plugin, `Added habit: ${newHabit.name} (${newHabit.id})`);
    return newHabit;
  }

  /**
   * Update an existing habit
   * @param {string} id - Habit ID
   * @param {Object} habitData - Updated habit data
   * @returns {Promise<Object>} The updated habit
   */
  async updateHabit(id, habitData) {
    const index = this.plugin.settings.habits.findIndex((h) => h.id === id);
    if (index === -1) {
      throw new Error(`Habit not found: ${id}`);
    }

    const errors = this.validateHabit(habitData);
    if (errors.length > 0) {
      throw new Error(`Validation failed: ${errors.join(", ")}`);
    }

    const currentHabit = this.plugin.settings.habits[index];

    // Check for duplicate names (skip self)
    if (habitData.name && habitData.name.trim().toLowerCase() !== currentHabit.name.trim().toLowerCase()) {
      const isAr = this.plugin.settings.language === "ar";
      const duplicate = this.getHabits().find(
        (h) => h.id !== id && h.name.trim().toLowerCase() === habitData.name.trim().toLowerCase(),
      );
      if (duplicate) {
        throw new Error(
          isAr
            ? `عادة بنفس الاسم موجودة بالفعل: "${habitData.name}"`
            : `A habit with this name already exists: "${habitData.name}"`,
        );
      }
    }

    const nameChanged = habitData.name && habitData.name.trim() !== currentHabit.name.trim();
    if (nameChanged) {
      if (!currentHabit.nameHistory) currentHabit.nameHistory = [];
      if (!currentHabit.nameHistory.includes(currentHabit.linkText)) {
        currentHabit.nameHistory.push(currentHabit.linkText);
      }
    }

    const updated = {
      ...currentHabit,
      ...habitData,
      id,
      nameHistory: currentHabit.nameHistory || [],
    };

    this.plugin.settings.habits[index] = updated;
    await this.plugin.saveSettings();

    Utils.debugLog(this.plugin, `Updated habit: ${updated.name} (${id})`);
    return updated;
  }

  /**
   * Archive a habit (soft delete)
   * @param {string} id - Habit ID
   * @returns {Promise<Object>} The archived habit
   */
  async archiveHabit(id) {
    const habit = this.getHabitById(id);
    if (!habit) {
      throw new Error(`Habit not found: ${id}`);
    }

    try {
      const streakCalc = new StreakCalculator(this.plugin);
      const streakData = await streakCalc.calculate(habit);
      habit.savedLongestStreak = Math.max(
        streakData.longestStreak,
        habit.savedLongestStreak || 0
      );
    } catch (e) {
      console.warn("[Core Habits] Could not save streak before archive:", e);
    }

    habit.archived = true;
    habit.archivedDate = Date.now();
    habit.restoredDate = null;
    await this.plugin.saveSettings();

    Utils.debugLog(this.plugin, `Archived habit: ${habit.name} (${id})`);
    return habit;
  }

  /**
   * Restore an archived habit
   * @param {string} id - Habit ID
   * @returns {Promise<Object>} The restored habit
   */
  async restoreHabit(id) {
    const habit = this.getHabitById(id);
    if (!habit) {
      throw new Error(`Habit not found: ${id}`);
    }

    habit.archived = false;
    habit.archivedDate = null;
    habit.restoredDate = Date.now();

    // Place it at the end of its active sibling group to avoid order collision
    const siblings = this.getActiveHabits().filter(h => h.parentId === habit.parentId);
    let maxOrder = -1;
    siblings.forEach(h => { if (h.order > maxOrder) maxOrder = h.order; });
    habit.order = maxOrder + 1;

    await this.plugin.saveSettings();

    Utils.debugLog(this.plugin, `Restored habit: ${habit.name} (${id})`);
    return habit;
  }

  /**
   * Delete a habit immediately (without archiving first)
   * @param {string} id - Habit ID
   * @returns {Promise<Object>} The deleted habit
   */
  async deleteHabit(id) {
    const index = this.plugin.settings.habits.findIndex((h) => h.id === id);
    if (index === -1) {
      throw new Error(`Habit not found: ${id}`);
    }

    const deleted = this.plugin.settings.habits.splice(index, 1)[0];
    await this.plugin.saveSettings();

    Utils.debugLog(this.plugin, `Deleted habit: ${deleted.name} (${id})`);
    return deleted;
  }

  /**
   * Permanently delete a habit (only for archived habits)
   * @param {string} id - Habit ID
   * @returns {Promise<void>}
   */
  async deleteHabitPermanently(id) {
    const index = this.plugin.settings.habits.findIndex((h) => h.id === id);
    if (index === -1) {
      throw new Error(`Habit not found: ${id}`);
    }

    const habit = this.plugin.settings.habits[index];
    if (!habit.archived) {
      throw new Error(`Cannot delete non-archived habit. Archive it first.`);
    }

    this.plugin.settings.habits.splice(index, 1);
    await this.plugin.saveSettings();

    Utils.debugLog(this.plugin, `Permanently deleted habit: ${habit.name} (${id})`);
  }

  /**
   * Get only active (non-archived) habits, sorted by order
   * @returns {Array} Array of active habits sorted by order
   */
  getActiveHabits() {
    return this.getHabits()
      .filter((h) => !h.archived)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  /**
   * Get only archived habits
   * @returns {Array} Array of archived habits
   */
  getArchivedHabits() {
    return this.getHabits().filter((h) => h.archived);
  }

  /**
   * Get the effective parent ID of a habit (returns null if parent is archived/deleted)
   * @param {string} id - Habit ID
   * @returns {string|null}
   */
  getEffectiveParentId(id) {
    const habit = this.getHabitById(id);
    if (!habit || !habit.parentId) return null;
    const parentIsActive = this.getActiveHabits().some((h) => h.id === habit.parentId);
    return parentIsActive ? habit.parentId : null;
  }

  /**
   * Check if a habit has any active children
   * @param {string} id - Habit ID
   * @returns {boolean}
   */
  isParent(id) {
    return this.getActiveHabits().some((h) => this.getEffectiveParentId(h.id) === id);
  }

  /**
   * Get effective siblings of a habit, cleanly resolving orphans to top-level.
   */
  getEffectiveSiblings(habitToMove) {
    const active = this.getActiveHabits();
    const targetParentId = this.getEffectiveParentId(habitToMove.id);

    return active
      .filter((h) => this.getEffectiveParentId(h.id) === targetParentId)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  /**
   * Move a habit up in the order
   * @param {string} id - Habit ID
   * @returns {Promise<void>}
   */
  async moveHabitUp(id) {
    const habitToMove = this.getHabitById(id);
    if (!habitToMove) {
      throw new Error(`Habit not found: ${id}`);
    }

    // Use robust effective siblings logic (covers orphans automatically)
    const siblings = this.getEffectiveSiblings(habitToMove);

    // Normalize orders to guarantee distinct sequential values
    siblings.forEach((h, i) => { h.order = i; });

    const index = siblings.findIndex((h) => h.id === id);

    if (index === -1) {
      throw new Error(`Habit not found: ${id}`);
    }

    if (index === 0) {
      return;
    }

    const currentHabit = siblings[index];
    const previousHabit = siblings[index - 1];

    // Swap order directly
    const temp = currentHabit.order;
    currentHabit.order = previousHabit.order;
    previousHabit.order = temp;

    await this.plugin.saveSettings();
    Utils.debugLog(this.plugin, `Moved habit up: ${currentHabit.name}`);
  }

  /**
   * Move a habit down in the order
   * @param {string} id - Habit ID
   * @returns {Promise<void>}
   */
  async moveHabitDown(id) {
    const habitToMove = this.getHabitById(id);
    if (!habitToMove) {
      throw new Error(`Habit not found: ${id}`);
    }

    // Use robust effective siblings logic (covers orphans automatically)
    const siblings = this.getEffectiveSiblings(habitToMove);

    // Normalize orders to guarantee distinct sequential values
    siblings.forEach((h, i) => { h.order = i; });

    const index = siblings.findIndex((h) => h.id === id);

    if (index === -1) {
      throw new Error(`Habit not found: ${id}`);
    }

    if (index === siblings.length - 1) {
      return;
    }

    const currentHabit = siblings[index];
    const nextHabit = siblings[index + 1];

    // Swap order directly
    const temp = currentHabit.order;
    currentHabit.order = nextHabit.order;
    nextHabit.order = temp;

    await this.plugin.saveSettings();
    Utils.debugLog(this.plugin, `Moved habit down: ${currentHabit.name}`);
  }

  /**
   * Physically rename the habit's linked note file via Obsidian FileManager.
   * @param {Object} habit - Habit object with linkText
   * @param {string} newName - New desired file name
   * @returns {Promise<{renamed: boolean, reason?: string}>}
   */
  async renameHabitFile(habit, newName) {
    const currentLinkPath = habit.linkText.replace(/\[\[|\]\]/g, "");
    const file = this.plugin.app.metadataCache.getFirstLinkpathDest(currentLinkPath, "");
    if (!file) return { renamed: false, reason: "file_not_found" };

    const newFilePath = normalizePath(newName + ".md");
    const existingFile = this.plugin.app.vault.getAbstractFileByPath(newFilePath);
    if (existingFile) {
      const isAr = this.plugin.settings.language === "ar";
      new Notice(isAr
        ? `⚠️ ملاحظة: الملف "${newFilePath}" موجود بالفعل. سيتم تحديث الروابط فقط.`
        : `⚠️ Note: File "${newFilePath}" already exists. Links will be updated only.`);
      return { renamed: false, reason: "file_exists" };
    }

    try {
      await this.plugin.app.fileManager.renameFile(file, newFilePath);
      return { renamed: true };
    } catch (err) {
      console.error('[Core Habits] Physical Rename Error:', err);
      return { renamed: false, reason: err.message };
    }
  }

  /**
   * Identifies all files requiring a rename.
   */
  async prepareBatchRename(habitId, oldName) {
    const habit = this.getHabitById(habitId);
    if (!habit) {
      throw new Error(`Habit not found: ${habitId}`);
    }

    const historicalNames = [oldName, ...(habit.nameHistory || []).map(n => n.replace(/\[\[|\]\]/g, ""))];
    const uniqueOldNames = [...new Set(historicalNames)];
    const oldLinkTexts = uniqueOldNames.map(name => `[[${name}]]`);
    const filesToUpdate = [];

    const resolvedLinks = this.plugin.app.metadataCache.resolvedLinks;
    const unresolvedLinks = this.plugin.app.metadataCache.unresolvedLinks;
    const candidates = new Set();

    for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
      if (uniqueOldNames.some(name => links[name] || links[name + ".md"])) candidates.add(sourcePath);
    }
    for (const [sourcePath, links] of Object.entries(unresolvedLinks)) {
      if (uniqueOldNames.some(name => links[name] || links[name + ".md"])) candidates.add(sourcePath);
    }

    for (const filePath of candidates) {
      const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
      if (file) {
        try {
          const content = await this.plugin.app.vault.read(file);
          if (oldLinkTexts.some(lt => content.includes(lt))) {
            filesToUpdate.push(file);
          }
        } catch (err) {
          Utils.debugLog(this.plugin, `Error reading ${file.path}: ${err}`);
        }
      }
    }

    return {
      needsConfirmation: filesToUpdate.length > 0,
      fileCount: filesToUpdate.length,
      filesToUpdate,
      uniqueOldNames
    };
  }

  /**
   * Executes the batch rename logic.
   */
  async executeBatchRename(newName, uniqueOldNames, filesToUpdate, onProgress, getCancelStatus) {
    let processed = 0;
    let errors = 0;

    const regexPatterns = uniqueOldNames.map(name => {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\[\\[${escapedName}(#[^|\\]]*)?(\\|[^\\]]*)?\\]\\]`, 'g');
    });

    for (let i = 0; i < filesToUpdate.length; i += 10) {
      if (getCancelStatus && getCancelStatus()) break;

      const batch = filesToUpdate.slice(i, i + 10);

      await Promise.all(
        batch.map(async (file) => {
          try {
            await this.plugin.app.vault.process(file, (content) => {
              let newContent = content;
              regexPatterns.forEach(regex => {
                newContent = newContent.replace(regex, (match, header, alias) => {
                  return `[[${newName}${header || ""}${alias || ""}]]`;
                });
              });
              return newContent;
            });
            processed++;
          } catch (err) {
            console.error(`[Core Habits] Failed to update ${file.path}:`, err);
            errors++;
          }
        })
      );

      if (onProgress) onProgress(processed + errors, filesToUpdate.length);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return { updated: processed, errors };
  }

  /**
   * Check if a habit is scheduled for a specific day
   * @param {Object} habit - Habit object
   * @param {number} dayOfWeek - Day of week (0=Sunday, 6=Saturday)
   * @returns {boolean} True if scheduled
   */
  isHabitScheduledForDay(habit, dayOfWeek) {
    return Array.isArray(habit.schedule?.days) && habit.schedule.days.includes(dayOfWeek);
  }

  /**
   * Get habits scheduled for a specific day
   * @param {number} dayOfWeek - Day of week (0=Sunday, 6=Saturday)
   * @returns {Array} Array of habits scheduled for this day
   */
  getHabitsForDay(dayOfWeek) {
    return this.getActiveHabits()
      .filter((h) => this.isHabitScheduledForDay(h, dayOfWeek))
      .sort((a, b) => a.order - b.order);
  }

  /**
   * Validate habit data
   * @param {Object} habitData - Habit data to validate
   * @returns {Array<string>} Array of error messages (empty if valid)
   */
  validateHabit(habitData) {
    const errors = [];
    const isAr = this.plugin.settings.language === "ar";

    if (!habitData.name || habitData.name.trim() === "") {
      errors.push(isAr ? "اسم العادة مطلوب" : "Habit name is required");
      return errors;
    }

    const name = habitData.name.trim();

    // Length validation
    if (name.length > 200) {
      errors.push(
        isAr
          ? "اسم العادة طويل جداً (الحد الأقصى 200 حرف)"
          : "Habit name too long (max 200 characters)",
      );
    }

    // Forbidden characters that break the plugin
    const forbidden = ["[[", "]]", "[habit::", "\n", "\r", "\t", "|", "<", ">"];
    for (const char of forbidden) {
      if (name.includes(char)) {
        errors.push(
          isAr
            ? `اسم العادة لا يمكن أن يحتوي على: ${char}`
            : `Habit name cannot contain: ${char}`,
        );
      }
    }

    const specialChars = /[()[\]{}*+?.^$|\\]/;
    if (specialChars.test(name)) {
      Utils.debugLog(this.plugin, "Habit name contains special characters:", name);
    }

    if (habitData.schedule) {
      if (!["daily", "weekly"].includes(habitData.schedule.type)) {
        errors.push(isAr ? "نوع الجدول غير صحيح" : "Invalid schedule type");
      }

      if (habitData.schedule.type === "weekly") {
        if (!Array.isArray(habitData.schedule.days)) {
          errors.push(isAr ? "أيام الجدول يجب أن تكون مصفوفة" : "Schedule days must be an array");
        } else if (habitData.schedule.days.length === 0) {
          errors.push(isAr ? "يجب تحديد يوم واحد على الأقل" : "At least one day must be selected");
        } else if (habitData.schedule.days.some(d => d < 0 || d > 6)) {
          errors.push(isAr ? "أيام الجدول غير صحيحة (0-6)" : "Invalid schedule days (0-6)");
        }
      }
    }

    return errors;
  }

  /**
   * Ensure habits for a specific date exist in the daily note
   * @param {Moment} date - The date to check
   * @returns {Promise<void>}
   */
  async ensureHabitsInNote(date) {
    if (!this.plugin.settings.autoWriteHabits) return;

    // Use lock to prevent race with toggles
    // Note: We use fileLock later after ensuring note exists.

    try {
      // 2. Get/Create Daily Note
      const dailyNote = await getNoteByDate(this.plugin.app, date, true, this.plugin.settings);
      if (!dailyNote) return;

      const fileLock = this.plugin.getFileLock(dailyNote.path);

      await fileLock.dispatch(async () => {
        // Use vault.process for atomic guaranteed fresh reads and writes
        await this.plugin.app.vault.process(dailyNote, (content) => {
          const originalContent = content;

          // 1. Get habits scheduled for this day
          const dayOfWeek = date.day();
          const scheduledHabits = this.getHabitsForDay(dayOfWeek);

          if (scheduledHabits.length === 0) return originalContent;

          // Generate habits text that MAY need addition
          const existingHabits = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
          let addedCount = 0;

          const habitsToAdd = [];
          for (const habit of scheduledHabits) {
            const allNames = [
              habit.linkText.replace(/\[\[|\]\]/g, ""),
              ...(habit.nameHistory || []).map(n => n.replace(/\[\[|\]\]/g, "")),
            ];
            const exists = existingHabits.some((h) => allNames.some(name => h.text.includes(name)));
            if (!exists) {
              habitsToAdd.push(`- [ ] ${habit.linkText} ${this.plugin.settings.marker}`);
              addedCount++;
            }
          }

          if (addedCount > 0) {
            const newContent = Utils.insertNestedContent(
              content,
              this.plugin.settings.dailyParentHeading,
              this.plugin.settings.habitHeading,
              habitsToAdd.join("\n")
            );
            if (newContent !== originalContent) {
              Utils.debugLog(this.plugin, `Added ${addedCount} habits to ${dailyNote.basename}`);
              return newContent;
            }
          }
          return originalContent;
        });
      });
    } catch (error) {
      console.error("[Core Habits] Sync failed:", error);
    }
  }

  /**
   * Import habits found in a note content that are not in settings
   * @param {string} content - Note content
   * @returns {Promise<number>} Number of imported habits
   */
  async importHabitsFromContent(content) {
    const foundHabits = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
    let importedCount = 0;

    for (const habit of foundHabits) {
      const fullLink = habit.text;
      // Check if this habit already exists in settings
      // We compare normalized link text
      const exists = this.plugin.settings.habits.some(
        (h) =>
          h.linkText.replace(/\s+/g, "").toLowerCase() === fullLink.replace(/\s+/g, "").toLowerCase() ||
          h.name.trim().toLowerCase() === fullLink.replace(/\[\[|\]\]/g, "").trim().toLowerCase(),
      );

      if (!exists) {
        // Determine clean name
        const cleanName = fullLink.replace(/\[\[|\]\]/g, "").trim();

        // Add it
        await this.addHabit({
          name: cleanName,
          linkText: fullLink,
          schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] }, // Default to daily
        });
        importedCount++;
      }
    }
    return importedCount;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Habit Logic Engine — getNoteByDate, HabitScanner, toggleHabit, StreakCalculator
// ═══════════════════════════════════════════════════════════════════════════════
async function getNoteByDate(app, dateMoment, createIfNeeded = false, pluginSettings = null) {
  const info = getDailyNotesInfo(app, pluginSettings);
  let format = info.format;
  let folder = info.folder;
  let templatePath = info.template;

  // The previous call to .locale('ar') mutated the shared moment object, causing this to be Arabic.
  // We clone it and force english for the filename generation.
  let fileName = dateMoment.clone().locale("en").format(format);

  let normalizedPath = folder ? `${folder}/${fileName}.md` : `${fileName}.md`;
  normalizedPath = normalizedPath.replace(/\/+/g, "/");

  let file = app.vault.getAbstractFileByPath(normalizedPath);
  if (!file && createIfNeeded) {
    try {
      if (folder) {
        const folderExists = app.vault.getAbstractFileByPath(folder);
        if (!folderExists) await app.vault.createFolder(folder);
      }

      // Template support: read template and apply variables
      let content = "";
      if (templatePath) {
        // Normalize template path
        let templateFilePath = templatePath;
        if (!templateFilePath.endsWith(".md")) {
          templateFilePath += ".md";
        }

        const templateFile = app.vault.getAbstractFileByPath(templateFilePath);
        if (templateFile) {
          try {
            content = await app.vault.read(templateFile);
            content = content.replace(/\{\{date\}\}/g, fileName);
            content = content.replace(/\{\{title\}\}/g, fileName);
            content = content.replace(/\{\{date:([^}]+)\}\}/g, (match, fmt) => {
              return dateMoment.clone().locale("en").format(fmt);
            });
          } catch (e) {
            console.warn("[Core Habits] Could not read template:", e);
          }
        }
      }

      file = await app.vault.create(normalizedPath, content);
    } catch (err) {
      console.error("[Core Habits] Failed to create daily note:", err);
      new Notice(pluginSettings?.language === "ar" ? "⚠️ تعذر إنشاء الملاحظة اليومية" : "⚠️ Could not create daily note");
      return null;
    }
  }
  return file;
}

/**
 * Superfast extraction of habit logs from exactly the X most recent Daily Notes.
 * Completely decouples the habit log from the habit's own file.
 */
async function extractHabitHistoryFromDailyNotes(app, plugin, habitName, daysToLookBack = 30) {
  const entries = [];
  const cleanHabitName = TextUtils.clean(habitName);
  const now = window.moment();
  
  for (let i = 0; i < daysToLookBack; i++) {
    const targetDate = now.clone().subtract(i, 'days');
    const file = await getNoteByDate(app, targetDate, false, plugin.settings);
    if (!file) continue;

    const content = await app.vault.cachedRead(file);
    const lines = content.split('\n');
    
    for (const line of lines) {
      if (line.includes(`[habit-note:: ${cleanHabitName}]`)) {
        let cleanLine = line.trim();
        if (cleanLine.startsWith('- ')) {
          cleanLine = cleanLine.substring(2).trim();
        }
        // Remove the habit label text the user already knows they're looking at
        cleanLine = cleanLine.replace(new RegExp(`\\[habit-note:: ${Utils.escapeRegExp(cleanHabitName)}\\] .*? - `, "i"), "");
        
        entries.push({ date: targetDate, text: cleanLine });
      }
    }
  }
  return entries;
}



async function toggleHabit(plugin, app, file, habit, marker, targetState = null) {
  const lock = plugin.getFileLock(file.path);

  await lock.dispatch(async () => {
    await app.vault.process(file, (data) => {
      const separator = data.includes("\r\n") ? "\r\n" : "\n";
      const lines = data.split(/\r?\n/);
      let targetIndex = habit.lineIndex;

      if (targetIndex >= 0 && targetIndex < lines.length) {
        if (!lines[targetIndex].includes(habit.text)) {
          targetIndex = -1;
        }
      } else {
        targetIndex = -1;
      }

      if (targetIndex === -1) {
        const safeText = Utils.escapeRegExp(habit.text);
        targetIndex = lines.findIndex((line) => {
          return /^\s*-\s*\[([ x\-])\]/i.test(line) &&
            new RegExp(`(\\[\\[)?${safeText}(\\]\\])?`, "i").test(line);
        });
      }

      if (targetIndex === -1) {
        new Notice(plugin.settings.language === "ar" ? "⚠️ تعذر العثور على العادة في الملف. يرجى التحديث." : "⚠️ Could not find habit in file. Please reload.");
        return data;
      }

      const line = lines[targetIndex];
      const checkboxRegex = /^(\s*-\s*\[)([ x\-])(\].*)$/i;
      const match = line.match(checkboxRegex);

      if (match) {
        let newChar;
        if (targetState === "completed") {
          newChar = "x";
        } else if (targetState === "skipped") {
          newChar = "-";
        } else if (targetState === "uncompleted") {
          newChar = " ";
        } else {
          const current = match[2].toLowerCase();
          newChar = current === "x" ? " " : "x";
        }
        lines[targetIndex] = `${match[1]}${newChar}${match[3]}`;
      }

      return lines.join(separator);
    });
  });
}



// ═══════════════════════════════════════════════════════════════════════════════
// 5–6. UI — Modals, Views, Settings
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Simple file suggester modal using Obsidian's built-in FuzzySuggestModal.
 * This provides a clean, native Obsidian experience for file selection.
 */
class FileSuggestModal extends FuzzySuggestModal {
  constructor(app, onSelect) {
    super(app);
    this.onSelect = onSelect;
  }

  getItems() {
    // Return all markdown files in the vault
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file) {
    // Display the file path in the suggester
    return file.path;
  }

  onChooseItem(file, evt) {
    //Call the callback with the selected file
    this.onSelect(file);
  }
}

class AddHabitModal extends Modal {
  constructor(app, plugin, onSubmit, existingHabit = null) {
    super(app);
    this.plugin = plugin;
    this.onSubmit = onSubmit;
    this.existingHabit = existingHabit;

    // Initialize State
    const isEdit = !!existingHabit;
    this.formState = {
      name: isEdit ? existingHabit.name : "",
      selectedColor: isEdit ? (existingHabit.color || "teal") : "teal",
      selectedParentId: isEdit ? (existingHabit.parentId || null) : null,
      scheduleMode: isEdit && existingHabit.schedule?.type === "weekly" && existingHabit.schedule.days.length < 7 ? "specific" : "daily",
      selectedDays: isEdit && existingHabit.schedule?.type === "weekly" ? [...existingHabit.schedule.days] : [0, 1, 2, 3, 4, 5, 6],
      habitType: isEdit ? (existingHabit.habitType || "build") : "build",
      atomicIdentity: isEdit && existingHabit.atomicDescription ? existingHabit.atomicDescription.identity || "" : "",
      atomicCue: isEdit && existingHabit.atomicDescription ? existingHabit.atomicDescription.cue || "" : "",
      atomicFriction: isEdit && existingHabit.atomicDescription ? existingHabit.atomicDescription.friction || "" : "",
      atomicReward: isEdit && existingHabit.atomicDescription ? existingHabit.atomicDescription.reward || "" : "",
      useLevels: isEdit ? existingHabit.levelData && existingHabit.levelData.some((l) => l.goal) : false,
      currentLevel: isEdit ? existingHabit.currentLevel || 1 : 1,
      levelData: isEdit && existingHabit.levelData ? JSON.parse(JSON.stringify(existingHabit.levelData)) : Array(5).fill().map(() => ({ goal: "", condition: "", achieved: false })),
      notes: isEdit ? (existingHabit.notes || "") : ""
    };
    this.activeTab = "basics";
  }

  onOpen() {
    this.triggerElement = document.activeElement;
    const { contentEl, modalEl } = this;

    if (modalEl) modalEl.addClass("dh-add-habit-modal-wrapper");

    contentEl.empty();
    contentEl.addClass("daily-habits-modal");

    const t = (k) => this.plugin.translationManager.t(k);
    const isAr = this.plugin.settings.language === "ar";
    const isEdit = !!this.existingHabit;

    if (isAr) {
      contentEl.addClass("is-rtl");
      contentEl.setAttr("dir", "rtl");
    }

    // 1. Header
    const headerDiv = contentEl.createDiv({ cls: "modal-header-clean" });
    headerDiv.createEl("h2", {
      text: isEdit ? (isAr ? "تعديل العادة" : "Edit Habit") : (isAr ? "إضافة عادة جديدة" : "Add New Habit"),
      cls: "modal-title-clean",
    });

    // 2. Streak Stats (Only in Edit Mode)
    if (isEdit) {
      this.renderStreakStats(contentEl, t, isAr);
    }

    // 3. Form Container
    const form = contentEl.createDiv({ cls: "habit-form-container" });

    // 4. Tab Bar (Segmented Control)
    this.renderTabBar(form, t, isAr);

    // 5. Panels Container
    const panelsContainer = form.createDiv({ cls: "dh-modal-panels-container" });

    this.panels = {
      basics: panelsContainer.createDiv({ cls: "dh-modal-panel", attr: { id: "panel-basics" } }),
      engineering: panelsContainer.createDiv({ cls: "dh-modal-panel", attr: { id: "panel-engineering" } }),
      gradation: panelsContainer.createDiv({ cls: "dh-modal-panel", attr: { id: "panel-gradation" } }),
      log: panelsContainer.createDiv({ cls: "dh-modal-panel dh-modal-log-panel", attr: { id: "panel-log" } })
    };

    // 6. Render Panel Contents
    this.renderBasicInfoSection(this.panels.basics, t, isAr);
    this.renderHabitEngineeringSection(this.panels.engineering, t, isAr);
    this.renderGradationSection(this.panels.gradation, t, isAr);

    // Only render log if habit context is enabled and editing an existing habit
    if (this.plugin.settings.enableHabitContext && isEdit) {
      this.renderLogSection(this.panels.log, t, isAr);
    } else {
      this.panels.log.createDiv({
        cls: "dh-log-empty-state",
        text: isAr ? (isEdit ? "ميزة سجل المتابعة معطلة من الإعدادات." : "احفظ العادة أولاً لتتمكن من إضافة وقراءة التعليقات.")
          : (isEdit ? "Habit context feature is disabled in settings." : "Save the habit first to add and read comments.")
      });
    }

    // Initialize Active Tab
    this.switchModalTab(this.activeTab);

    // 7. Footer
    this.renderFooter(contentEl, t, isAr);

    // 8. Mobile: scroll focused inputs into view when keyboard appears
    if (Platform.isMobile) {
      contentEl.querySelectorAll('input, textarea, select').forEach(el => {
        el.addEventListener('focus', () => {
          setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
        });
      });
    }
  }

  renderTabBar(container, t, isAr) {
    const tabsContainer = container.createDiv({ cls: "dh-modal-tabs-container" });

    this.tabs = {
      basics: tabsContainer.createEl("button", { cls: "dh-modal-tab-btn", text: isAr ? "1. الأساسيات" : "1. Basics" }),
      engineering: tabsContainer.createEl("button", { cls: "dh-modal-tab-btn", text: isAr ? "2. هندسة العادة" : "2. Habit Engineering" }),
      gradation: tabsContainer.createEl("button", { cls: "dh-modal-tab-btn", text: isAr ? "3. التدرج" : "3. Gradation" }),
      log: tabsContainer.createEl("button", { cls: "dh-modal-tab-btn", text: isAr ? "4. السجل" : "4. Log" })
    };

    Object.keys(this.tabs).forEach(tabId => {
      this.tabs[tabId].onclick = () => this.switchModalTab(tabId);
    });
  }

  switchModalTab(tabId) {
    this.activeTab = tabId;
    if (this.tabs) {
      Object.keys(this.tabs).forEach(id => {
        this.tabs[id].toggleClass("is-active", id === tabId);
      });
    }
    if (this.panels) {
      Object.keys(this.panels).forEach(id => {
        this.panels[id].toggleClass("is-active", id === tabId);

        // Fix: recalculate textarea height when made visible
        if (id === tabId) {
          const textareas = this.panels[id].querySelectorAll('textarea.dh-auto-textarea');
          textareas.forEach(ta => {
            ta.style.setProperty("height", "auto", "important");
            ta.style.setProperty("height", `${ta.scrollHeight}px`, "important");
          });
        }
      });
    }
  }

  renderStreakStats(container, t, isAr) {
    const statsContainer = container.createDiv({ cls: "streak-stats-compact" });
    const badgesRow = statsContainer.createDiv({ cls: "streak-badges-row" });
    const detailsContainer = statsContainer.createDiv({ cls: "streak-details-container" });

    const line1 = badgesRow.createDiv({ cls: "streak-compact-line" });
    line1.textContent = isAr ? "جاري الحساب..." : "Calculating...";

    this.plugin._sharedStreakCache = this.plugin._sharedStreakCache || new Map();
    const calculator = new StreakCalculator(this.plugin, this.plugin._sharedStreakCache);
    calculator.calculate(this.existingHabit).then(({ currentStreak, longestStreak, firstCompletionDate, consistencyScore, consistencyLabel, consistencyCompleted, consistencyScheduled, recoveryScore, ongoingGapLength }) => {
      badgesRow.empty();

      const streakWordAr = (n) => n === 1 ? "يوم" : n === 2 ? "يومين" : n <= 10 ? "أيام" : "يوماً";
      const longestText = longestStreak > 0 ? `${longestStreak} ${isAr ? streakWordAr(longestStreak) : "days"}` : (isAr ? "لا يوجد" : "None");
      const currentText = currentStreak > 0 ? `${currentStreak} ${isAr ? streakWordAr(currentStreak) : "days"}` : (isAr ? "لا يوجد" : "None");

      const longestBadge = badgesRow.createDiv({ cls: "streak-badge streak-badge-longest" });
      longestBadge.createSpan({ cls: "streak-badge-icon", text: "🏆" });
      longestBadge.createSpan({ cls: "streak-badge-label", text: isAr ? "أطول سلسلة:" : "Longest:" });
      longestBadge.createSpan({ cls: "streak-badge-value", text: longestText });

      const currentBadge = badgesRow.createDiv({ cls: "streak-badge streak-badge-current" });
      currentBadge.createSpan({ cls: "streak-badge-icon", text: "🔥" });
      currentBadge.createSpan({ cls: "streak-badge-label", text: isAr ? "السلسلة الحالية:" : "Current:" });
      currentBadge.createSpan({ cls: "streak-badge-value", text: currentText });

      if (firstCompletionDate) {
        const line2 = detailsContainer.createDiv({ cls: "streak-detail-item" });
        line2.createSpan({ cls: "streak-detail-icon", text: "📅" });
        const dateStr = firstCompletionDate.locale(isAr ? "ar" : "en").format(isAr ? "D MMMM YYYY" : "D MMM YYYY");
        const daysSince = window.moment().diff(firstCompletionDate, "days");
        const dWord = isAr ? streakWordAr(daysSince) : (daysSince === 1 ? "day" : "days");
        line2.createSpan({ cls: "streak-detail-label", text: isAr ? "أول إنجاز" : "First completion" });
        line2.createSpan({ cls: "streak-detail-value", text: `${dateStr}` });
        line2.createSpan({ cls: "streak-detail-sub", text: `(${isAr ? "مضى " : ""}${daysSince} ${dWord})` });
      }

      if (consistencyScore !== null) {
        const line3 = detailsContainer.createDiv({ cls: "streak-detail-item" });
        line3.createSpan({ cls: "streak-detail-icon", text: "📈" });
        line3.createSpan({ cls: "streak-detail-label", text: isAr ? "الالتزام" : "Consistency" });
        line3.createSpan({ cls: "streak-detail-value", text: `${consistencyCompleted}/${consistencyScheduled}` });

        const pctCls = consistencyScore >= 80 ? "excellent" : consistencyScore >= 60 ? "good" : consistencyScore >= 40 ? "fair" : "low";
        line3.createSpan({ cls: `streak-detail-pct ${pctCls}`, text: `${consistencyScore}%` });
        line3.createSpan({ cls: "streak-detail-sub", text: isAr ? "(آخر 30 يوماً)" : "(30 days)" });
      }

      if (recoveryScore !== null) {
        const rRate = Math.round(recoveryScore * 10) / 10;
        const rateRounded = Math.round(recoveryScore);
        const line4 = detailsContainer.createDiv({ cls: "streak-detail-item dh-recovery-row" });
        line4.createSpan({ cls: "streak-detail-icon", text: "🛟" });
        line4.createSpan({ cls: "streak-detail-label", text: isAr ? "قوة الإنقاذ" : "Recovery Speed" });

        let rateText = isAr ? `${rRate} يوم` : `${rRate} days`;
        let decisionMsg = "";
        let rateCls = "";

        if (ongoingGapLength > rateRounded + 0.5 && ongoingGapLength >= 2) {
          rateCls = "low";
          decisionMsg = isAr ? `متأخر عن المعتاد (${rRate}يوم).. بسّط وعد اليوم!` : `Behind average (${rRate}d). Simplify & recover!`;
        } else if (rateRounded <= 1.5) {
          rateCls = "excellent";
          decisionMsg = isAr ? "مرونة عالية - بطل التعافي!" : "High resilience champ!";
        } else if (rateRounded <= 2.5) {
          rateCls = "good";
          decisionMsg = isAr ? "تعافي جيد غالباً" : "Good recovery speed";
        } else {
          rateCls = "low";
          decisionMsg = isAr ? "قرار: بسّط العادة فور السقوط" : "Decision: Simplify post-fail";
        }

        line4.createSpan({ cls: `streak-detail-pct ${rateCls}`, text: rateText });
        line4.createSpan({ cls: "streak-detail-sub dh-recovery-sub", text: `(${decisionMsg})` });
      } else if (ongoingGapLength > 1) {
        // Fallback when no past gaps exist but they are failing now
        const line5 = detailsContainer.createDiv({ cls: "streak-detail-item dh-recovery-row" });
        line5.createSpan({ cls: "streak-detail-icon", text: "⚠️" });
        line5.createSpan({ cls: "streak-detail-label", text: isAr ? "تنبيه تسريب" : "Leak Alert" });
        line5.createSpan({ cls: `streak-detail-pct low`, text: isAr ? `${ongoingGapLength} أيام` : `${ongoingGapLength} days` });
        line5.createSpan({ cls: "streak-detail-sub dh-recovery-sub", text: isAr ? "(بسّط العادة لإيقاف النزيف!)" : "(Simplify habit to stop the leak!)" });
      }
    }).catch(() => {
      badgesRow.empty();
      const lineErr = badgesRow.createDiv({ cls: "streak-compact-line" });
      lineErr.textContent = isAr ? "خطأ في جلب الإحصائيات" : "Error loading stats";
    });
  }

  renderBasicInfoSection(panel, t, isAr) {
    const isEdit = !!this.existingHabit;
    const basicSection = panel.createDiv({ cls: "form-section" });

    // 1. Name Input
    const nameGroup = basicSection.createDiv({ cls: "form-group-clean" });
    nameGroup.createEl("label", { text: t("habit_name"), cls: "form-label-clean" });

    // Wrap input and path to prevent breaking the flex layout of form-group-clean
    const inputWrapper = nameGroup.createDiv({ cls: "dh-name-input-wrapper", attr: { style: "display: flex; flex-direction: column; width: 100%; gap: 4px;" } });

    const nameInput = inputWrapper.createEl("input", {
      type: "text",
      placeholder: isAr ? "مثال: صلاة الفجر في المسجد" : "e.g. Fajr prayer at mosque",
      cls: "form-input dh-name-input-wide"
    });
    nameInput.value = this.formState.name;
    const initialName = this.formState.name;

    const pathDisplay = inputWrapper.createDiv({ cls: "dh-habit-file-path", attr: { style: "margin-top: 2px;" } });

    // Add checkbox for Rename in all notes
    const renameContainer = inputWrapper.createDiv({ cls: "dh-rename-checkbox-container", attr: { style: "display: none; align-items: center; gap: 6px; margin-top: 4px; padding: 6px; background: var(--background-secondary); border-radius: 4px; border: 1px solid var(--background-modifier-border);" } });
    const renameCheckbox = renameContainer.createEl("input", { type: "checkbox", id: "dh-rename-all-notes" });
    const renameLabel = renameContainer.createEl("label", { text: isAr ? "إعادة التسمية في جميع الملاحظات القديمة؟ (اختياري)" : "Rename in all older notes? (Optional)", attr: { for: "dh-rename-all-notes" }, cls: "dh-atomic-hint" });
    renameLabel.style.margin = "0";

    const renameHint = inputWrapper.createDiv({ cls: "dh-atomic-hint", attr: { style: "display: none; font-size: 0.8em; opacity: 0.8; margin-top: 2px;" } });
    renameHint.textContent = isAr
      ? "💡 سيتم استبدال الاسم الحالي وكل الأسماء السابقة لهذه العادة بالاسم الجديد في كل ملفاتك."
      : "💡 This will replace the current name and all previous aliases with the new name across your vault.";

    const updatePathDisplay = (name) => {
      if (!name || !name.trim()) { pathDisplay.textContent = ""; return; }
      const linkedFile = this.app.metadataCache.getFirstLinkpathDest(name.trim(), "");
      pathDisplay.textContent = linkedFile
        ? `📁 ${linkedFile.path}`
        : (isAr ? "📁 لا يوجد ملف مرتبط (سيُنشأ تلقائياً)" : "📁 No linked file (will be created)");
    };
    if (isEdit) updatePathDisplay(this.formState.name);

    nameInput.oninput = (e) => {
      this.formState.name = e.target.value;
      const currentName = e.target.value.trim();

      if (isEdit && currentName && currentName !== initialName) {
        renameContainer.style.display = "flex";
        renameHint.style.display = "block";
      } else {
        renameContainer.style.display = "none";
        renameHint.style.display = "none";
        renameCheckbox.checked = false;
      }
    };
    nameInput.addEventListener("input", debounce(() => updatePathDisplay(nameInput.value), 400));

    this.formState.renameOldNotes = () => renameCheckbox.checked;

    // 1b. Free-form Notes
    const notesGroup = basicSection.createDiv({ cls: "form-group-clean" });
    notesGroup.createEl("label", { text: isAr ? "ملاحظات (اختياري)" : "Notes (optional)", cls: "form-label-clean" });
    const notesHint = notesGroup.createDiv({ cls: "dh-atomic-hint" });
    notesHint.textContent = isAr ? "مساحة حرة: الوقت، المكان، تذكير، أي شيء تريده" : "Free space: time, place, reminders, anything you want";
    const notesInput = notesGroup.createEl("textarea", {
      cls: "form-input dh-auto-textarea dh-notes-input",
      attr: {
        placeholder: isAr ? "مثال: هذه العادة أعملها الساعة 6 صباحاً بعد القهوة..." : "e.g. This habit is at 6am after coffee...",
        rows: 2
      }
    });
    notesInput.value = this.formState.notes;
    const autoResizeNotes = () => {
      notesInput.style.setProperty("height", "auto", "important");
      notesInput.style.setProperty("height", `${notesInput.scrollHeight}px`, "important");
    };
    notesInput.oninput = (e) => { this.formState.notes = e.target.value; autoResizeNotes(); };
    setTimeout(autoResizeNotes, 0);

    // Helper for active habits and children logic
    const activeHabits = this.plugin.habitManager.getActiveHabits();
    const thisId = isEdit ? this.existingHabit.id : null;
    const thisChildren = thisId ? activeHabits.filter(h => h.parentId === thisId) : [];
    const isThisAParent = thisChildren.length > 0;

    // 2. Parent / Children Info
    if (isThisAParent) {
      const childrenGroup = basicSection.createDiv({ cls: "form-group-clean dh-parent-group" });
      childrenGroup.createEl("label", { text: isAr ? "العادات المرتبطة بها:" : "Child Habits:", cls: "form-label-clean" });
      const childList = childrenGroup.createDiv({ cls: "dh-children-info" });
      thisChildren.forEach(ch => {
        childList.createDiv({ cls: "dh-child-tag", text: `└ ${ch.name}` });
      });
    } else {
      const topLevelHabits = activeHabits.filter(h => !h.parentId && h.id !== thisId);
      if (topLevelHabits.length > 0) {
        const parentGroup = basicSection.createDiv({ cls: "form-group-clean dh-parent-group" });
        parentGroup.createEl("label", { text: t("parent_habit"), cls: "form-label-clean" });
        const parentSelect = parentGroup.createEl("select", { cls: "form-input dh-parent-select" });
        parentSelect.createEl("option", { text: t("parent_habit_none"), value: "" });
        topLevelHabits.forEach(h => {
          parentSelect.createEl("option", { text: h.name, value: h.id });
        });
        parentSelect.value = this.formState.selectedParentId || "";
        parentSelect.onchange = (e) => {
          this.formState.selectedParentId = e.target.value || null;
        };
      }
    }

    // 3. Color Picker (Always visible or toggled)
    const colorGroup = basicSection.createDiv({ cls: "form-group-clean dh-color-picker-group" });
    colorGroup.createEl("label", { text: isAr ? "اللون" : "Color", cls: "form-label-clean" });
    const colorRow = colorGroup.createDiv({ cls: "dh-color-swatches" });

    const colorLabelsAr = {
      teal: "أخضر مائي", blue: "أزرق", purple: "بنفسجي",
      amber: "ذهبي", rose: "وردي", green: "أخضر",
      indigo: "نيلي", cyan: "سماوي", pink: "زهري",
      orange: "برتقالي", lime: "ليموني", slate: "رمادي"
    };
    const colorPalette = HABIT_COLORS_PALETTE;

    const HABIT_COLORS = colorPalette.map(c => ({
      ...c,
      label: isAr ? (colorLabelsAr[c.id] || c.id) : c.id.charAt(0).toUpperCase() + c.id.slice(1),
    }));

    HABIT_COLORS.forEach(c => {
      const swatch = colorRow.createDiv({ cls: `dh-color-swatch ${this.formState.selectedColor === c.id ? "is-active" : ""}` });
      swatch.style.backgroundColor = c.hex;
      swatch.style.setProperty("--swatch-color", c.hex);
      swatch.title = c.label;
      swatch.onclick = () => {
        this.formState.selectedColor = c.id;
        colorRow.querySelectorAll(".dh-color-swatch").forEach(s => s.removeClass("is-active"));
        swatch.addClass("is-active");
      };
    });

    const updateColorPickerVisibility = () => {
      colorGroup.style.display = this.formState.selectedParentId ? "none" : "flex";
    };
    updateColorPickerVisibility();

    // Hook the parentSelect change to update the color picker visibility
    if (!isThisAParent && activeHabits.filter(h => !h.parentId && h.id !== thisId).length > 0) {
      const parentSelect = basicSection.querySelector('.dh-parent-select');
      if (parentSelect) {
        parentSelect.addEventListener('change', () => {
          updateColorPickerVisibility();
        });
      }
    }

    // 4. Schedule
    basicSection.createEl("div", { cls: "dh-section-divider" }); // Visual separator
    const scheduleGroup = basicSection.createDiv({ cls: "form-group-clean" });
    scheduleGroup.createEl("label", { text: t("frequency"), cls: "form-label-clean" });

    const toggleContainer = scheduleGroup.createDiv({ cls: "schedule-toggle-container" });
    const optDaily = toggleContainer.createDiv({
      cls: `schedule-toggle-option ${this.formState.scheduleMode === "daily" ? "is-active" : ""}`,
      text: isAr ? "كل الأيام" : "Every Day"
    });
    const optSpecific = toggleContainer.createDiv({
      cls: `schedule-toggle-option ${this.formState.scheduleMode === "specific" ? "is-active" : ""}`,
      text: isAr ? "أيام محددة" : "Specific Days"
    });

    const daysPicker = scheduleGroup.createDiv({ cls: "days-picker-clean" });
    daysPicker.style.display = this.formState.scheduleMode === "specific" ? "block" : "none";
    const dayGrid = daysPicker.createDiv({ cls: "days-grid-clean" });

    const dayLabels = isAr
      ? { 0: "الأحد", 1: "الاثنين", 2: "الثلاثاء", 3: "الأربعاء", 4: "الخميس", 5: "الجمعة", 6: "السبت" }
      : { 0: "Su", 1: "M", 2: "Tu", 3: "W", 4: "Th", 5: "F", 6: "Sa" };
    const wsd = this.plugin.settings.weekStartDay;
    const displayOrder = Array.from({ length: 7 }, (_, i) => (wsd + i) % 7);

    const renderDayChips = () => {
      dayGrid.empty();
      displayOrder.forEach((dayIndex) => {
        const chip = dayGrid.createDiv({
          cls: `day-chip-clean ${this.formState.selectedDays.includes(dayIndex) ? "is-selected" : ""}`,
          text: dayLabels[dayIndex],
        });
        chip.onclick = () => {
          if (this.formState.scheduleMode === "daily") return;
          if (this.formState.selectedDays.includes(dayIndex)) {
            if (this.formState.selectedDays.length > 1) {
              this.formState.selectedDays = this.formState.selectedDays.filter((d) => d !== dayIndex);
            }
          } else {
            this.formState.selectedDays.push(dayIndex);
          }
          renderDayChips();
        };
      });
    };
    renderDayChips();

    optDaily.onclick = () => {
      this.formState.scheduleMode = "daily";
      this.formState.selectedDays = [0, 1, 2, 3, 4, 5, 6];
      optDaily.addClass("is-active");
      optSpecific.removeClass("is-active");
      daysPicker.style.display = "none";
      renderDayChips();
    };

    optSpecific.onclick = () => {
      this.formState.scheduleMode = "specific";
      optSpecific.addClass("is-active");
      optDaily.removeClass("is-active");
      daysPicker.style.display = "block";
    };
  }

  renderHabitEngineeringSection(panel, t, isAr) {
    const atomicSection = panel.createDiv({ cls: "form-section dh-atomic-section" });

    atomicSection.createEl("p", {
      text: isAr
        ? "💡 هندسة العادات (اختياري): أسئلة للتحليل العميق وبناء العادات المتينة."
        : "💡 Habit Engineering (Optional): Deep analysis questions for strong habits.",
      cls: "dh-atomic-optional-note"
    });

    const typeToggleRow = atomicSection.createDiv({ cls: "dh-type-toggle-row" });
    const buildBtn = typeToggleRow.createDiv({
      cls: `dh-type-btn build ${this.formState.habitType === "build" ? "is-active" : ""}`,
      text: isAr ? "بناء عادة" : "Build",
    });
    const breakBtn = typeToggleRow.createDiv({
      cls: `dh-type-btn break ${this.formState.habitType === "break" ? "is-active" : ""}`,
      text: isAr ? "كسر عادة" : "Break",
    });

    const atomicFields = atomicSection.createDiv({ cls: "dh-atomic-fields" });

    const fieldsRef = {};

    fieldsRef.identity = this.createAtomicField(atomicFields, this.formState.atomicIdentity, (v) => { this.formState.atomicIdentity = v; });
    fieldsRef.cue = this.createAtomicField(atomicFields, this.formState.atomicCue, (v) => { this.formState.atomicCue = v; });
    fieldsRef.friction = this.createAtomicField(atomicFields, this.formState.atomicFriction, (v) => { this.formState.atomicFriction = v; });
    fieldsRef.reward = this.createAtomicField(atomicFields, this.formState.atomicReward, (v) => { this.formState.atomicReward = v; });

    const updateAtomicLabels = () => {
      const isB = this.formState.habitType === "break";

      // 1. Identity
      fieldsRef.identity.label.textContent = isAr ? "الهوية المستهدفة" : "Target Identity";
      fieldsRef.identity.hint.textContent = isB
        ? (isAr ? "من تريد أن تصبح؟ (مثال: \"أنا شخص يتحكم برغباته\")" : "Who do you want to become?")
        : (isAr ? "من تريد أن تصبح؟ بدل \"أريد قراءة كتاب\" قل \"أنا قارئ نهم\"" : "Instead of 'I want to read', say 'I am a reader'");
      fieldsRef.identity.input.setAttribute("placeholder", isB
        ? (isAr ? "مثال: أنا شخص غير مدخن" : "e.g. I am a non-smoker")
        : (isAr ? "مثال: أنا قارئ منتظم" : "e.g. I am a consistent reader"));

      // 2. Cue — الإشارة
      fieldsRef.cue.label.textContent = isB ? (isAr ? "الإشارة (الإخفاء)" : "Cue (Hide)") : (isAr ? "الإشارة (متى وأين؟)" : "Cue (When & Where?)");
      fieldsRef.cue.hint.textContent = isB
        ? (isAr ? "ما الذي يدفعك للعادة السيئة؟ ألغِ المحفز أو أخفِه" : "What triggers it? Remove or hide it")
        : (isAr ? "سوف أقوم بـ [العادة] في الساعة [...] في مكان [...]" : "I will do [habit] at [time] in [place]");
      fieldsRef.cue.input.setAttribute("placeholder", isB
        ? (isAr ? "مثال: حذف التطبيق المشتت" : "e.g. Delete distracting app")
        : (isAr ? "مثال: بعد صلاة الفجر مباشرة في غرفة المكتب" : "e.g. Right after Fajr in study room"));

      // 3. Friction — السهولة / التصعيب
      fieldsRef.friction.label.textContent = isB ? (isAr ? "التصعيب (زيادة العقبات)" : "Make it Difficult") : (isAr ? "السهولة (تسهيل البدء)" : "Make it Easy");
      fieldsRef.friction.hint.textContent = isB
        ? (isAr ? "كيف تزيد العقبات؟ أضف خطوات تمنعك من البدء" : "Add steps/obstacles to prevent starting")
        : (isAr ? "ابدأ بأقل من دقيقتين — مثال: لبس الحذاء الرياضي فقط" : "Start with under 2 minutes");
      fieldsRef.friction.input.setAttribute("placeholder", isB
        ? (isAr ? "مثال: إبعاد الهاتف عن غرفة النوم" : "e.g. Keep phone away from bedroom")
        : (isAr ? "مثال: تجهيز ملابس الرياضة من الليل" : "e.g. Prepare gym clothes the night before"));

      // 4. Reward — المكافأة
      fieldsRef.reward.label.textContent = isB ? (isAr ? "العقوبة (فورية)" : "Punishment (Immediate)") : (isAr ? "المكافأة (فورية)" : "Reward (Immediate)");
      fieldsRef.reward.hint.textContent = isB
        ? (isAr ? "ما العقوبة الفورية إذا استسلمت؟" : "Immediate consequence if you fail?")
        : (isAr ? "كافئ نفسك فوراً — مثال: قهوة، شوكولاتة صغيرة، شربة ماء بارد" : "Reward yourself immediately");
      fieldsRef.reward.input.setAttribute("placeholder", isB
        ? (isAr ? "مثال: التبرع بـ 50 ريال كعقوبة" : "e.g. Donate 50 SAR as penalty")
        : (isAr ? "مثال: كوب قهوة مفضل" : "e.g. Favorite cup of coffee"));
    };

    updateAtomicLabels();

    buildBtn.onclick = () => {
      this.formState.habitType = "build";
      buildBtn.addClass("is-active");
      breakBtn.removeClass("is-active");
      updateAtomicLabels();
    };
    breakBtn.onclick = () => {
      this.formState.habitType = "break";
      breakBtn.addClass("is-active");
      buildBtn.removeClass("is-active");
      updateAtomicLabels();
    };
  }

  createAtomicField(parent, initialValue, onInput) {
    const group = parent.createDiv({ cls: "form-group-clean dh-atomic-field" });
    const labelContainer = group.createDiv({ cls: "dh-atomic-label-container" });

    const textWrapper = labelContainer.createDiv({ cls: "dh-atomic-label-wrapper" });
    const label = textWrapper.createEl("label", { cls: "form-label-clean" });

    // Hint text placed right below the label
    const hint = labelContainer.createDiv({ cls: "dh-atomic-hint" });

    const input = group.createEl("textarea", { cls: "form-input dh-atomic-input dh-auto-textarea" });

    input.setAttribute("rows", "1");
    input.value = initialValue;

    const autoResize = () => {
      input.style.setProperty("height", "auto", "important");
      input.style.setProperty("height", `${input.scrollHeight}px`, "important");
    };
    input.oninput = (e) => { onInput(e.target.value); autoResize(); };
    setTimeout(autoResize, 0);

    return { group, label, hint, input };
  }

  renderGradationSection(panel, t, isAr) {
    const levelsSection = panel.createDiv({ cls: "form-section dh-gradation-section" });
    const heroSection = levelsSection.createDiv({ cls: "gradation-hero-section" });

    const heroBtn = heroSection.createDiv({
      cls: `gradation-hero-btn ${this.formState.useLevels ? "is-active" : ""}`,
      text: isAr ? "تفعيل منهج التدرج" : "Enable Gradation Method"
    });

    const heroHint = heroSection.createDiv({
      cls: `gradation-hint ${this.formState.useLevels ? "is-visible" : ""}`,
      text: isAr ? "تدرج في عملك حتى تصل لغايتك" : "Graduate in your work until you reach your goal"
    });

    const levelsCont = levelsSection.createDiv({ cls: "levels-container-clean" });
    levelsCont.style.display = this.formState.useLevels ? "block" : "none";

    const explanationDiv = levelsSection.createDiv({ cls: "dh-gradation-explanation" });
    explanationDiv.style.display = this.formState.useLevels ? "block" : "none";
    explanationDiv.createEl("p", {
      text: isAr
        ? "💡 فكرة التدرج: العادات الكبرى تبدأ بخطوات صغيرة جداً. ركز فقط على المرحلة الحالية وتلبية 'شرط الانتقال'. الاستمرارية تسبق الكمية."
        : "💡 Gradation Method: Big habits start with tiny steps. Focus only on the current level until you meet the 'Condition'."
    });

    heroBtn.onclick = () => {
      this.formState.useLevels = !this.formState.useLevels;
      heroBtn.toggleClass("is-active", this.formState.useLevels);
      heroHint.toggleClass("is-visible", this.formState.useLevels);

      if (this.formState.useLevels) {
        levelsCont.style.display = "block";
        explanationDiv.style.display = "block";
        const firstInp = levelsCont.querySelector(".dh-level-goal-input");
        if (firstInp) firstInp.focus();
      } else {
        levelsCont.style.display = "none";
        explanationDiv.style.display = "none";
      }
    };

    const tableHeader = levelsCont.createDiv({ cls: "levels-header-clean" });
    tableHeader.createSpan({ text: "#" });
    const colsHeader = tableHeader.createDiv({ cls: "levels-cols-header-clean" });
    colsHeader.createSpan({ text: isAr ? "مستوى العادة المستهدف" : "Target Habit Level" });
    colsHeader.createSpan({ text: isAr ? "شرط الانتقال" : "Condition" });

    const conditionOptionsAr = [
      { v: "", l: "اختر الشرط..." },
      { v: "7 أيام متواصلة", l: "7 أيام متواصلة" },
      { v: "14 يوماً متواصلة", l: "14 يوماً متواصلة" },
      { v: "21 يوماً متواصلة", l: "21 يوماً متواصلة" },
      { v: "30 يوماً متواصلة", l: "30 يوماً متواصلة" },
      { v: "بدون شرط (أسلوب حياة)", l: "بدون شرط (أسلوب حياة)" },
    ];
    const conditionOptionsEn = [
      { v: "", l: "Select condition..." },
      { v: "7 continuous days", l: "7 continuous days" },
      { v: "14 continuous days", l: "14 continuous days" },
      { v: "21 continuous days", l: "21 continuous days" },
      { v: "30 continuous days", l: "30 continuous days" },
      { v: "No condition (Lifestyle)", l: "No condition (Lifestyle)" },
    ];

    const placeholders = isAr ? [
      "أقل القليل: آية واحدة، أو عدة ضغط واحدة",
      "البداية الفعلية: صفحة، أو 5 دقائق رياضة",
      "الزيادة المعتدلة: صفحتين/ربع حزب، أو 15 دقيقة رياضة",
      "مستوى التحدي: 10 صفحات/نصف جزء، أو 30 دقيقة رياضة",
      "الغاية المنشودة: جزء يومياً، أو 45 دقيقة رياضة"
    ] : [
      "Atomic start: 1 verse, or 1 push-up",
      "Real start: 1 page, or 5 min exercise",
      "Moderate growth: 2 pages, or 15 min exercise",
      "Challenge level: half juz, or 30 min exercise",
      "Ultimate goal: 1 full juz, or 45 min workout"
    ];

    const opts = isAr ? conditionOptionsAr : conditionOptionsEn;

    const renderLevels = () => {
      levelsCont.querySelectorAll(".level-row-clean").forEach(el => el.remove());

      for (let i = 0; i < 5; i++) {
        const levelNum = i + 1;
        const isDone = this.formState.levelData[i]?.achieved;

        const row = levelsCont.createDiv({
          cls: `level-row-clean ${isDone ? "is-achieved" : ""}`
        });

        const badgeCol = row.createDiv({});
        const badge = badgeCol.createDiv({
          cls: `level-num-badge ${isDone ? "is-achieved" : ""}`,
        });
        badge.textContent = isDone ? "✓" : levelNum;
        badge.onclick = () => {
          if (!this.formState.levelData[i].goal?.trim() || !this.formState.levelData[i].condition) {
            new Notice(isAr ? "املأ الهدف والشرط أولاً" : "Fill goal and condition first");
            return;
          }
          this.formState.levelData[i].achieved = !this.formState.levelData[i].achieved;
          renderLevels();
        };

        const inputsCol = row.createDiv({ cls: "level-inputs-col-clean" });

        const goalInp = inputsCol.createEl("input", {
          type: "text",
          placeholder: placeholders[i],
          cls: "level-input-clean dh-level-goal-input",
        });
        goalInp.value = this.formState.levelData[i].goal || "";
        goalInp.disabled = isDone;
        goalInp.oninput = (e) => (this.formState.levelData[i].goal = e.target.value);

        const conditionSelect = inputsCol.createEl("select", {
          cls: "level-input-clean dh-level-condition-select",
        });
        opts.forEach(opt => {
          conditionSelect.createEl("option", { text: opt.l, value: opt.v });
        });
        conditionSelect.value = this.formState.levelData[i].condition || "";
        conditionSelect.disabled = isDone;
        conditionSelect.onchange = (e) => (this.formState.levelData[i].condition = e.target.value);
      }
    };
    renderLevels();
  }

  async renderLogSection(panel, t, isAr) {
    const logSection = panel.createDiv({ cls: "form-section dh-log-section" });

    // Compact Header with Action Button
    const headerRow = logSection.createDiv({ cls: "dh-log-section-header-row", attr: { style: "display: flex; justify-content: space-between; align-items: center;" } });
    headerRow.createEl("h3", {
      text: isAr ? "سجل المتابعة والتعليقات" : "Habit Context Log",
      cls: "dh-log-section-title",
      attr: { style: "margin: 0;" }
    });

    const container = logSection.createDiv({ cls: "dh-log-entries-container" });

    const addNoteBtn = headerRow.createEl("button", {
      text: isAr ? "🎙️ أضف ملاحظة لليوم" : "🎙️ Add Note Today",
      cls: "dh-log-add-note-btn dh-brand-btn"
    });
    
    addNoteBtn.onclick = () => {
      new HabitCommentPopup(
        this.app,
        this.plugin,
        this.existingHabit || this.formState,
        window.moment(),
        async (text) => {
          await injectHabitCommentIntoDailyNote(this.app, this.plugin, this.existingHabit || this.formState, window.moment(), text);
          this.renderLogSectionOnly(container, isAr);
        }
      ).open();
    };

    container.textContent = isAr ? "جاري تحميل السجل..." : "Loading log...";
    this.renderLogSectionOnly(container, isAr);
  }

  async renderLogSectionOnly(container, isAr) {
    try {
      const habitName = this.existingHabit?.linkText || this.existingHabit?.name || this.formState.name;
      if (!habitName) {
        container.empty();
        return;
      }
      
      const entries = await extractHabitHistoryFromDailyNotes(this.app, this.plugin, habitName, 90);

      container.empty();

      if (entries.length === 0) {
        container.createDiv({
          cls: "dh-log-empty-state",
          text: isAr ? "السجل فارغ. استمر في العادة ووثق تقدمك يوماً بيوم!" : "Log is empty. Keep tracking and document your progress day by day!"
        });
        return;
      }

      // Group entries by Month
      const grouped = {};
      entries.forEach(entry => {
        const monthKey = entry.date.locale(isAr ? 'ar' : 'en').format("MMMM YYYY");
        if (!grouped[monthKey]) grouped[monthKey] = [];
        grouped[monthKey].push(entry);
      });

      Object.keys(grouped).forEach((monthKey, idx) => {
        const details = container.createEl("details", { cls: "dh-log-month-group" });
        if (idx === 0) details.open = true;
        
        details.createEl("summary", { text: monthKey, cls: "dh-log-month-summary" });
        const groupDiv = details.createDiv({ cls: "dh-log-month-content" });

        grouped[monthKey].forEach(entry => {
          const entryDiv = groupDiv.createDiv({ cls: "dh-log-entry" });

          const dateFormatted = entry.date.locale(isAr ? 'ar' : 'en').format("DD MMM");
          let temp = `**${dateFormatted}** | ${entry.text}`;

          const tokens = [];

          // Process audio voice notes first
          temp = temp.replace(/!\[\[([^\]]+\.webm)\]\]/i, (match, p1) => {
            tokens.push({ type: 'audio', text: p1 });
            return `__TOKEN_${tokens.length - 1}__`;
          });

          // Replace links
          temp = temp.replace(/\[\[(.*?)\]\]/g, (match, p1) => {
            tokens.push({ type: 'link', text: p1 });
            return `__TOKEN_${tokens.length - 1}__`;
          });
          // Replace rates
          temp = temp.replace(/\[Rate:: (.*?)\]/g, (match, p1) => {
            tokens.push({ type: 'rate', text: p1 });
            return `__TOKEN_${tokens.length - 1}__`;
          });
          // Replace bold
          temp = temp.replace(/\*\*(.*?)\*\*/g, (match, p1) => {
            tokens.push({ type: 'bold', text: p1 });
            return `__TOKEN_${tokens.length - 1}__`;
          });

          // Append nodes securely
          const parts = temp.split(/(__TOKEN_\d+__)/);
          parts.forEach(part => {
            const tokenMatch = part.match(/__TOKEN_(\d+)__/);
            if (tokenMatch) {
              const token = tokens[parseInt(tokenMatch[1])];
              if (token.type === 'link') entryDiv.createSpan({ cls: "dh-log-link", text: token.text });
              else if (token.type === 'audio') {
                const audioFile = this.app.metadataCache.getFirstLinkpathDest(token.text, "");
                if (audioFile) {
                  const src = this.app.vault.getResourcePath(audioFile);
                  const audioEl = entryDiv.createEl("audio", { attr: { controls: true, src: src } });
                  audioEl.style.width = "100%";
                  audioEl.style.height = "36px";
                  audioEl.style.marginTop = "8px";
                  audioEl.style.borderRadius = "8px";
                  audioEl.onclick = (e) => e.stopPropagation();
                  
                  // Mutual exclusion for audio playback
                  audioEl.addEventListener('play', () => {
                    document.querySelectorAll('audio').forEach(a => {
                      if (a !== audioEl && !a.paused) a.pause();
                    });
                  });
                } else {
                  entryDiv.createSpan({ text: token.text });
                }
              }
              else if (token.type === 'rate') entryDiv.createSpan({ cls: "dh-log-rate-badge", text: token.text });
              else if (token.type === 'bold') entryDiv.createEl("strong", { text: token.text });
            } else if (part) {
              entryDiv.appendChild(document.createTextNode(part));
            }
          });
        });
      });

    } catch (e) {
      console.error("[Core Habits] Error loading log:", e);
      container.textContent = isAr ? "خطأ في تحميل السجل" : "Error loading log";
    }
  }

  renderFooter(container, t, isAr) {
    const footer = container.createDiv({ cls: "dh-popup-footer dh-modal-footer" });

    const saveBtn = footer.createEl("button", {
      text: isAr ? "💾 حفظ" : "💾 Save",
      cls: "dh-popup-btn-save dh-save-habit-btn",
    });

    const cancelBtn = footer.createEl("button", { text: isAr ? "إلغاء" : "Cancel", cls: "dh-popup-btn-cancel" });
    cancelBtn.onclick = () => this.close();

    saveBtn.onclick = async () => {
      try {
        saveBtn.disabled = true;
        const { name, scheduleMode, selectedDays, useLevels, levelData, currentLevel, habitType, atomicIdentity, atomicCue, atomicFriction, atomicReward, selectedParentId, selectedColor, notes } = this.formState;

        if (!name.trim()) {
          new Notice(t("error_name_required"));
          if (this.activeTab !== "basics") {
            this.switchModalTab("basics");
            const nameInput = this.contentEl.querySelector(".dh-name-input-wide");
            if (nameInput) nameInput.focus();
          }
          saveBtn.disabled = false;
          return;
        }

        await this.onSubmit({
          name: name.trim(),
          schedule: {
            type: selectedDays.length === 7 ? "daily" : "weekly",
            days: selectedDays,
          },
          levelData: useLevels ? levelData : null,
          currentLevel: useLevels ? currentLevel : null,
          habitType: habitType,
          atomicDescription: {
            identity: atomicIdentity ? atomicIdentity.trim().replace(/[|\[\]<>]/g, "") || null : null,
            cue: atomicCue ? atomicCue.trim().replace(/[|\[\]<>]/g, "") || null : null,
            friction: atomicFriction ? atomicFriction.trim().replace(/[|\[\]<>]/g, "") || null : null,
            reward: atomicReward ? atomicReward.trim().replace(/[|\[\]<>]/g, "") || null : null,
          },
          parentId: selectedParentId || null,
          color: selectedColor || "teal",
          notes: notes ? notes.trim().replace(/[|<>]/g, "") || null : null,
          _renameInFiles: this.formState.renameOldNotes && !!this.existingHabit ? this.formState.renameOldNotes() : false
        });
        if (this.triggerElement) this.triggerElement.focus();
        this.close();
      } catch (e) {
        saveBtn.disabled = false;
        new Notice(`❌ ${e.message}`);
        console.error(e);
      }
    };
  }

  onClose() {
    this.contentEl.empty();
    if (this.triggerElement) this.triggerElement.focus();
  }
}

/**
 * Progress modal for batch renaming operations
 */
class RenameProgressModal extends Modal {
  constructor(app, plugin, totalFiles, onCancel) {
    super(app);
    this.plugin = plugin;
    this.totalFiles = totalFiles;
    this.processed = 0;
    this.onCancel = onCancel;
    this.cancelled = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("rename-progress-modal");

    // Header
    const isAr = this.plugin.settings.language === "ar";
    contentEl.setAttr("dir", isAr ? "rtl" : "ltr");

    contentEl.createEl("h2", {
      text: isAr ? "جارٍ تحديث الملفات..." : "Updating files..."
    });

    // Progress Bar Container
    const barContainer = contentEl.createDiv({ cls: "progress-bar-container" });
    this.progressBar = barContainer.createDiv({ cls: "progress-bar-fill" });
    this.progressBar.style.width = "0%";

    // Progress Text
    this.progressText = contentEl.createEl("p", {
      text: `0 / ${this.totalFiles}`,
      cls: "progress-text",
    });

    // Cancel Button
    const footer = contentEl.createDiv({ cls: "modal-button-container" });
    const cancelBtn = footer.createEl("button", {
      text: isAr ? "إلغاء" : "Cancel",
      cls: "mod-warning",
    });
    cancelBtn.onclick = () => {
      this.cancelled = true;
      if (this.onCancel) this.onCancel();
      this.close();
    };
  }

  updateProgress(current, total) {
    this.processed = current;
    const percentage = Math.round((current / total) * 100);

    if (this.progressBar) {
      this.progressBar.style.width = `${percentage}%`;
    }

    if (this.progressText) {
      this.progressText.textContent = `${current} / ${total}`;
    }
  }

  onClose() {
  }
}

/**
 * Feature: Habit Context
 * Small popup modal for adding a comment to a specific habit execution
 */
class HabitCommentPopup extends Modal {
  constructor(app, plugin, habit, date, onSave) {
    super(app);
    this.plugin = plugin;
    this.habit = habit;
    this.date = date;
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    const isAr = this.plugin.settings.language === "ar";
    contentEl.addClass("dh-popup-compact");
    if (isAr) contentEl.addClass("is-rtl");
    contentEl.setAttr("dir", isAr ? "rtl" : "ltr");
    modalEl.style.width = "420px";

    const dateStr = this.date.clone().locale(isAr ? "ar" : "en").format("D MMM");

    // Compact header row: icon + title + meta inline
    const header = contentEl.createDiv({ cls: "dh-popup-header" });
    header.createSpan({ cls: "dh-popup-header-icon", text: "💬" });
    const headerText = header.createDiv({ cls: "dh-popup-header-text" });
    headerText.createDiv({ cls: "dh-popup-title", text: this.habit.name });
    headerText.createDiv({ cls: "dh-popup-meta", text: `${dateStr} • ${window.moment().format("HH:mm")}` });

    const inputWrapper = contentEl.createDiv({ cls: "dh-popup-input-wrapper" });
    const input = inputWrapper.createEl("textarea", {
      cls: "dh-popup-input dh-popup-input-standalone",
      attr: {
        placeholder: isAr ? "ماذا حدث؟ لماذا تأخرت؟ ما شعورك؟" : "What happened? Why delayed? Feeling?",
        rows: 3
      }
    });

    const footer = contentEl.createDiv({ cls: "dh-popup-footer dh-popup-footer-split" });

    const actionsLeft = footer.createDiv({ cls: "dh-popup-actions-left" });
    const micBtn = actionsLeft.createEl("button", {
      cls: "dh-popup-btn-cancel dh-popup-mic-btn",
      text: isAr ? "🎙️ تسجيل صوتي" : "🎙️ Voice Note",
      title: isAr ? "تسجيل ملاحظة صوتية" : "Record Voice Note"
    });

    const actionsRight = footer.createDiv({ cls: "dh-popup-actions-right" });

    const saveBtn = actionsRight.createEl("button", {
      text: isAr ? "💾 حفظ" : "💾 Save",
      cls: "dh-popup-btn-save"
    });

    const cancelBtn = actionsRight.createEl("button", { text: isAr ? "إلغاء" : "Cancel", cls: "dh-popup-btn-cancel" });
    cancelBtn.onclick = () => this.close();

    let isRecording = false;
    let recordTimer = null;
    let seconds = 0;

    micBtn.onclick = async () => {
      if (!isRecording) {
        const started = await VoiceRecorderUtility.startRecording();
        if (started) {
          isRecording = true;
          micBtn.addClass("is-recording");
          micBtn.textContent = isAr ? "⏹ إيقاف" : "⏹ Stop";
          input.disabled = true;
          input.placeholder = isAr ? "جاري التسجيل... 00:00" : "Recording... 00:00";
          seconds = 0;
          recordTimer = setInterval(() => {
            seconds++;
            const mm = String(Math.floor(seconds/60)).padStart(2, '0');
            const ss = String(seconds%60).padStart(2,'0');
            input.placeholder = isAr ? `جاري التسجيل... ${mm}:${ss}` : `Recording... ${mm}:${ss}`;
          }, 1000);
        } else {
          new Notice(isAr ? "فشل الوصول للميكروفون!" : "Microphone access failed!");
        }
      } else {
        clearInterval(recordTimer);
        input.placeholder = isAr ? "معالجة الصوت..." : "Processing audio...";
        const fileName = await VoiceRecorderUtility.stopAndSaveRecording(app);
        isRecording = false;
        micBtn.removeClass("is-recording");
        micBtn.textContent = isAr ? "🎙️ تسجيل صوتي" : "🎙️ Voice Note";
        input.disabled = false;
        input.placeholder = isAr ? "ماذا حدث؟ لماذا تأخرت؟ ما شعورك؟" : "What happened? Why delayed? Feeling?";
        
        if (fileName) {
          const sep = input.value ? "\\n" : "";
          input.value += `${sep}![[${fileName}]]`;
          input.focus();
        } else {
           new Notice(isAr ? "فشل حفظ الملف الصوتي!" : "Failed to save audio file!");
        }
      }
    };

    const submit = () => {
      if (isRecording) {
        new Notice(isAr ? "أوقف التسجيل أولاً!" : "Stop recording first!");
        return;
      }
      const sanitized = input.value
        .replace(/[\r\n]+/g, ' ')
        .replace(/^#+\s/gm, '')
        .substring(0, 2000)
        .trim();
      if (sanitized) {
        saveBtn.disabled = true;
        saveBtn.textContent = isAr ? "جاري..." : "Saving...";
        this.onSave(sanitized).then((savedFile) => {
          new Notice(isAr
            ? `✅ تم حفظ التعليق في: ${savedFile || this.habit.name}`
            : `✅ Saved to: ${savedFile || this.habit.name}`);
          this.close();
        }).catch(e => {
          new Notice(`❌ ${e.message}`);
          saveBtn.disabled = false;
          saveBtn.textContent = isAr ? "💾 حفظ" : "💾 Save";
        });
      } else {
        this.close();
      }
    };

    saveBtn.onclick = submit;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    setTimeout(() => {
      input.focus();
      // Mobile: scroll input into view when keyboard appears
      if (Platform.isMobile) {
        setTimeout(() => input.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
      }
    }, 50);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Feature: Daily Note Reflection
 * Small popup modal for writing the daily overall reflection
 */
class ReflectionPopup extends Modal {
  constructor(app, plugin, date, onSave) {
    super(app);
    this.plugin = plugin;
    this.date = date;
    this.onSave = onSave;
    this.selectedType = REFLECTION_ENTRY_TYPES[0];
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    const isAr = this.plugin.settings.language === "ar";
    const t = (k) => this.plugin.translationManager.t(k);
    contentEl.addClass("dh-popup-compact");
    if (isAr) contentEl.addClass("is-rtl");
    contentEl.setAttr("dir", isAr ? "rtl" : "ltr");
    modalEl.style.width = "440px";

    const dateStr = this.date.clone().locale(isAr ? "ar" : "en").format(isAr ? "dddd، D MMM" : "ddd, D MMM");

    // Compact header row
    const header = contentEl.createDiv({ cls: "dh-popup-header" });
    header.createSpan({ cls: "dh-popup-header-icon", text: "📝" });
    const headerText = header.createDiv({ cls: "dh-popup-header-text" });
    headerText.createDiv({ cls: "dh-popup-title", text: t("reflection_modal_title") });

    const metaLine = headerText.createDiv({ cls: "dh-popup-meta" });
    metaLine.createSpan({ text: dateStr });

    const typeLabels = {
      Good: isAr ? "جيد" : "Good",
      Bad: isAr ? "سيئ" : "Bad",
      Lesson: isAr ? "درس" : "Lesson",
      Idea: isAr ? "فكرة" : "Idea",
    };
    const typePicker = contentEl.createDiv({ cls: "dh-reflection-type-picker" });
    REFLECTION_ENTRY_TYPES.forEach((type) => {
      const btn = typePicker.createEl("button", {
        cls: `dh-reflection-type-btn ${type === this.selectedType ? "is-active" : ""}`,
        text: typeLabels[type] || type,
      });
      btn.onclick = () => {
        this.selectedType = type;
        typePicker.querySelectorAll(".dh-reflection-type-btn").forEach((el) => el.removeClass("is-active"));
        btn.addClass("is-active");
      };
    });

    const inputWrapper = contentEl.createDiv({ cls: "dh-popup-input-wrapper" });
    const input = inputWrapper.createEl("textarea", {
      cls: "dh-popup-input dh-popup-input-standalone",
      attr: {
        placeholder: isAr ? "كيف كان يومك؟ ملاحظات سريعة..." : "How was your day? Quick notes...",
        rows: 4
      }
    });

    const footer = contentEl.createDiv({ cls: "dh-popup-footer dh-popup-footer-split" });

    const actionsLeft = footer.createDiv({ cls: "dh-popup-actions-left" });
    const micBtn = actionsLeft.createEl("button", {
      cls: "dh-popup-btn-cancel dh-popup-mic-btn",
      text: isAr ? "🎙️ تسجيل صوتي" : "🎙️ Voice Note",
      title: isAr ? "تسجيل ملاحظة صوتية" : "Record Voice Note"
    });

    const actionsRight = footer.createDiv({ cls: "dh-popup-actions-right" });

    const saveBtn = actionsRight.createEl("button", {
      text: isAr ? "📝 حفظ التدوين" : "📝 Save",
      cls: "dh-popup-btn-save"
    });

    const cancelBtn = actionsRight.createEl("button", { text: isAr ? "إلغاء" : "Cancel", cls: "dh-popup-btn-cancel" });
    cancelBtn.onclick = () => this.close();

    let isRecording = false;
    let recordTimer = null;
    let seconds = 0;

    micBtn.onclick = async () => {
      if (!isRecording) {
        const started = await VoiceRecorderUtility.startRecording();
        if (started) {
          isRecording = true;
          micBtn.addClass("is-recording");
          micBtn.textContent = isAr ? "⏹ إيقاف" : "⏹ Stop";
          input.disabled = true;
          input.placeholder = isAr ? "جاري التسجيل... 00:00" : "Recording... 00:00";
          seconds = 0;
          recordTimer = setInterval(() => {
            seconds++;
            const mm = String(Math.floor(seconds/60)).padStart(2, '0');
            const ss = String(seconds%60).padStart(2,'0');
            input.placeholder = isAr ? `جاري التسجيل... ${mm}:${ss}` : `Recording... ${mm}:${ss}`;
          }, 1000);
        } else {
          new Notice(isAr ? "فشل الوصول للميكروفون!" : "Microphone access failed!");
        }
      } else {
        clearInterval(recordTimer);
        input.placeholder = isAr ? "معالجة الصوت..." : "Processing audio...";
        const fileName = await VoiceRecorderUtility.stopAndSaveRecording(app);
        isRecording = false;
        micBtn.removeClass("is-recording");
        micBtn.textContent = isAr ? "🎙️ تسجيل صوتي" : "🎙️ Voice Note";
        input.disabled = false;
        input.placeholder = isAr ? "كيف كان يومك؟ ملاحظات سريعة..." : "How was your day? Quick notes...";
        
        if (fileName) {
          const sep = input.value ? "\\n" : "";
          input.value += `${sep}![[${fileName}]]`;
          input.focus();
        } else {
           new Notice(isAr ? "فشل حفظ الملف الصوتي!" : "Failed to save audio file!");
        }
      }
    };

    const submit = () => {
      if (isRecording) {
        new Notice(isAr ? "أوقف التسجيل أولاً!" : "Stop recording first!");
        return;
      }
      const sanitized = input.value
        .replace(/[\r\n]+/g, ' ')
        .replace(/^#+\s/gm, '')
        .substring(0, 2000)
        .trim();
      if (sanitized) {
        saveBtn.disabled = true;
        saveBtn.textContent = isAr ? "جاري..." : "Saving...";
        this.onSave(sanitized, this.selectedType).then((savedFile) => {
          new Notice(isAr
            ? `✅ تم حفظ التدوين في ملف اليوم: ${savedFile || ""}`
            : `✅ Saved to daily note: ${savedFile || ""}`);
          this.close();
        }).catch(e => {
          new Notice(`❌ ${e.message}`);
          saveBtn.disabled = false;
          saveBtn.textContent = isAr ? "📝 حفظ التدوين" : "📝 Save";
        });
      } else {
        this.close();
      }
    };

    saveBtn.onclick = submit;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    setTimeout(() => {
      input.focus();
      // Mobile: scroll input into view when keyboard appears
      if (Platform.isMobile) {
        setTimeout(() => input.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
      }
    }, 50);
  }

  onClose() {
    this.contentEl.empty();
  }
}

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
    // Load persisted collapse state from plugin data (survives Obsidian restarts)
    // Migration: convert old ":settings_expanded" keys to new ":expanded" format
    let groups = this.plugin.settings.collapsedGroups || [];
    if (Array.isArray(groups)) {
      groups = groups.map(key => key.replace(":settings_expanded", ":expanded"));
      this.plugin.settings.collapsedGroups = groups;
    }
    this.lastWeekRatesCache = new Map();
    this._streakQueue = [];
    this._isCalculatingStreaks = false;
    this.streakContentCache = new Map();
    this.streakCalculator = new StreakCalculator(this.plugin, this.streakContentCache);
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
    while (this._streakQueue.length > 0) {
      const { habit, row, isAr } = this._streakQueue.shift();
      try {
        const { currentStreak } = await this.streakCalculator.calculate(habit);
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

      container.empty();
      container.addClass("weekly-grid-container");
      container.removeClass("dh-diary-view-container");
      container.removeClass("decision-dashboard-container");
      this._streakCache = new Map();

      const isAr = this.isAr;
      if (isAr) {
        container.setAttribute("dir", "rtl");
        container.addClass("is-rtl");
      } else {
        container.setAttribute("dir", "ltr");
        container.removeClass("is-rtl");
      }

      await this.renderWeekHeader(container, isAr);

      if (this.currentViewMode === "dashboard") {
        await this.renderDecisionDashboard(container);
      } else if (this.currentViewMode === "diary") {
        await this.renderDiaryView(container);
      } else {
        this.streakCalculator = new StreakCalculator(this.plugin, this._streakCache);
        const today = window.moment();
        await this.renderGridTable(container, today);
      }

      if (scrollParent && scrollTop > 0) {
        requestAnimationFrame(() => { scrollParent.scrollTop = scrollTop; });
      }
    } catch (err) {
      Utils.debugLog(this.plugin, "renderWeeklyGrid error", err);
      const isAr = this.isAr;
      new Notice(isAr ? "⚠️ خطأ في عرض الأسبوع" : "⚠️ Weekly view error");
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
      let hijriStart = DateUtils.getHijriDate(this.currentWeekStart);
      let hijriEnd = DateUtils.getHijriDate(weekEnd);

      if (hideYear) {
        hijriStart = hijriStart.replace(/\s+\d{4}\s*هـ?$/i, '').trim();
        hijriEnd = hijriEnd.replace(/\s+\d{4}\s*هـ?$/i, '').trim();
      }

      // Add RLM (\u200F) to enforce Right-to-Left ordering
      element.textContent = `\u200F${hijriStart}\u200F - \u200F${hijriEnd}\u200F`;
    }
  }

  async renderGridTable(container, today) {
    // Create wrapper for sticky header functionality
    const tableWrapper = container.createDiv({ cls: "habits-grid-wrapper" });
    const table = tableWrapper.createDiv({ cls: "habits-grid" });

    const weekStartMs = this.currentWeekStart.clone().startOf("day").valueOf();
    const weekEndMs = this.currentWeekStart.clone().add(6, "days").endOf("day").valueOf();
    const habits = this.plugin.habitManager.getHabitsForTimeRange(weekStartMs, weekEndMs);

    if (habits.length === 0) {
      const isAr = this.isAr;
      const emptyRow = table.createDiv({ cls: "dh-grid-row empty-message-row" });
      emptyRow.createDiv({
        text: isAr ? "لا توجد عادات. أضف عادات من الإعدادات." : "No habits yet. Add habits from Settings.",
        cls: "empty-message",
      });
      return;
    }

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
      } catch (err) {
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
      let collapsed = !this.plugin.settings.collapsedGroups.includes(pid + ":expanded");

      // Apply initial DOM state immediately (no animation flash on render)
      childRows.forEach(row => { row.style.display = collapsed ? "none" : ""; });
      toggleBtn.textContent = collapsed ? "▸" : "▾";
      toggleBtn.title = collapsed
        ? (this.isAr ? "عرض العادات الفرعية" : "Expand children")
        : (this.isAr ? "إخفاء العادات الفرعية" : "Collapse children");

      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        collapsed = !collapsed;
        toggleBtn.textContent = collapsed ? "▸" : "▾";
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
      const footerRow = tfoot.createDiv({ cls: "dh-reflection-footer-row dh-grid-row" });
      
      // Index column placeholder
      footerRow.createDiv({ cls: "habit-index-header dh-grid-cell" });
      
      // Diary Title column
      const titleCell = footerRow.createDiv({ cls: "dh-footer-title dh-grid-cell" });
      titleCell.createSpan({ text: this.isAr ? "📝 يومياتي" : "📝 Diary" });
      
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
          const hijriDate = DateUtils.getHijriDate(dayDate);
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
    const rowClsFinal = `${rowCls} group-${effectiveParentId || habit.id} dh-grid-row`;
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
      contentWrapper.createSpan({
        cls: "dh-collapse-btn",
        text: "▾",
        title: this.isAr ? "إخفاء / عرض العادات الفرعية" : "Collapse / expand children",
        attr: { "data-collapse-id": habit.id },
      });
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
    const streakBadgeSlot = metaWrapper.createSpan({ cls: "dh-streak-badge-slot" });
    this.queueStreakCalculation(habit, row, isAr);

    // Icon to open linked habit page — always last in meta block
    const openPageIcon = metaWrapper.createEl("span", {
      cls: "habit-open-page-icon",
      title: isAr ? "فتح صفحة العادة" : "Open habit page",
    });
    setIcon(openPageIcon, "external-link");

    openPageIcon.onclick = async (e) => {
      e.stopPropagation();
      // Extract note name from linkText like [[Note Name]]
      const linkMatch = habit.linkText?.match(/\[\[([^\]]+)\]\]/);
      if (linkMatch && linkMatch[1]) {
        const noteName = linkMatch[1];
        await this.app.workspace.openLinkText(noteName, "", false);
      } else {
        new Notice(isAr ? "⚠️ لا توجد صفحة مرتبطة" : "⚠️ No linked page found");
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
          dayDate.isBefore(moment(habit.restoredDate), "day")) {
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
            async (text) => await injectHabitCommentIntoDailyNote(this.app, this.plugin, habit, dayDate, text)
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
      } catch (e) {
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
        await this.plugin.habitManager.ensureHabitsInNote(date);
      }

      const dailyNote = await getNoteByDate(this.app, date, false, this.plugin.settings);
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
          const createdNote = await getNoteByDate(this.app, date, false, this.plugin.settings);
          if (!createdNote) {
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
    } catch (error) {
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

  /* -------------------------------------------------------------------------
     NEW: Decision Dashboard Methods
     ------------------------------------------------------------------------- */
  async syncLifetimeAchievements(containerEl, isAr) {
    if (this.plugin.settings.lifetimeCompleted !== null) return;

    const loadingEl = containerEl.createDiv({ cls: "dh-loading-spinner text-center" });

    let totalCompleted = 0;
    try {
      let files = this.app.vault.getMarkdownFiles().filter(f => !f.path.startsWith(".obsidian") && f.stat.size < 500000);
      if (files.length > 2000) {
        files = files.slice(0, 2000);
        new Notice(isAr ? "⚠️ تمت معالجة أحدث 2000 ملف فقط لتجنب ضغط الذاكرة" : "⚠️ Processed limit 2000 files to save memory", 5000);
      }
      const BATCH_SIZE = 20;
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        loadingEl.textContent = isAr
          ? `جاري الحساب التراكمي... (${Math.min(i + BATCH_SIZE, files.length)}/${files.length} ملف) ⏳`
          : `Calculating... (${Math.min(i + BATCH_SIZE, files.length)}/${files.length} files) ⏳`;
        const batch = files.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(async (file) => {
          const content = await this.app.vault.cachedRead(file);
          if (!content.includes(this.plugin.settings.marker)) return 0;
          const habits = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
          return habits.reduce((sum, h) => sum + (h.completed ? 1 : 0), 0);
        }));
        totalCompleted += batchResults.reduce((sum, n) => sum + n, 0);
      }
      this.plugin.settings.lifetimeCompleted = totalCompleted;
      await this.plugin.saveSettings({ silent: true });
    } catch (e) {
      Utils.debugLog(this.plugin, "Failed to sync lifetime stats", e);
      this.plugin.settings.lifetimeCompleted = 0;
    }

    loadingEl.remove();
    await this.renderDecisionDashboard(containerEl.parentElement);
  }

  async analyzeLastFourWeeks() {
    const now = Date.now();
    if (this._lastFourWeeksCache && (now - this._lastFourWeeksCache.timestamp < 120000)) {
      return this._lastFourWeeksCache.data;
    }

    const today = window.moment();
    const isAr = this.isAr;
    const weeksData = [];
    const dayStats = {};
    const habitStats = {};

    // Analyze over the last 4 weeks leading up to the current week
    const startOfAnalysisMs = this.currentWeekStart.clone().subtract(3, "weeks").startOf("day").valueOf();
    const endOfAnalysisMs = this.currentWeekStart.clone().add(6, "days").endOf("day").valueOf();
    const habits = this.plugin.habitManager.getHabitsForTimeRange(startOfAnalysisMs, endOfAnalysisMs);

    if (habits.length === 0) return { weeksData: [], dayStats: {}, bestHabit: null, worstHabit: null, isAr };

    for (const habit of habits) {
      habitStats[habit.id] = {
        id: habit.id,
        name: (habit.name || habit.linkText).replace(/\[\[|\]\]/g, ""),
        completed: 0,
        total: 0
      };
    }

    for (let w = 0; w < 4; w++) {
      const weekStart = this.currentWeekStart.clone().subtract(w * 7, "days");
      let weekCompleted = 0;
      let weekTotal = 0;

      const dayPromises = [];
      for (let i = 0; i < 7; i++) {
        const dayDate = weekStart.clone().add(i, "days");
        if (dayDate.isAfter(today, "day")) continue;

        const dayOfWeek = dayDate.day();
        if (!dayStats[dayOfWeek]) {
          dayStats[dayOfWeek] = { completed: 0, total: 0 };
        }

        dayPromises.push((async () => {
          const dailyNote = await getNoteByDate(this.app, dayDate, false, this.plugin.settings);
          if (!dailyNote) return null;

          const content = await this.app.vault.cachedRead(dailyNote);
          const scanned = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);

          const results = [];
          for (const habit of habits) {
            const entry = findHabitEntry(scanned, habit.linkText, habit.nameHistory);
            if (entry && !entry.skipped) {
              results.push({
                habitId: habit.id,
                dayOfWeek,
                completed: entry.completed ? 1 : 0
              });
            }
          }
          return results;
        })());
      }

      const daysResults = [];
      for (const promise of dayPromises) {
        daysResults.push(await promise);
      }

      for (const results of daysResults) {
        if (!results) continue;
        for (const res of results) {
          weekTotal++;
          dayStats[res.dayOfWeek].total++;
          habitStats[res.habitId].total++;
          if (res.completed) {
            weekCompleted++;
            dayStats[res.dayOfWeek].completed++;
            habitStats[res.habitId].completed++;
          }
        }
      }

      weeksData.push({
        weekStart: weekStart,
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
        if (pct > maxHabitPct) { maxHabitPct = pct; bestHabit = Object.assign({}, st, { pct }); }
        if (pct < minHabitPct) { minHabitPct = pct; worstHabit = Object.assign({}, st, { pct }); }
      }
    }

    const result = { weeksData, dayStats, bestHabit, worstHabit, isAr };
    this._lastFourWeeksCache = { timestamp: now, data: result };
    return result;
  }

  async renderDecisionDashboard(container) {
    container.addClass("decision-dashboard-container");
    const isAr = this.isAr;

    if (this.plugin.settings.lifetimeCompleted === null) {
      const btnGroup = container.createDiv({ cls: "dh-pulse-card", style: "text-align: center; padding: 20px;" });
      btnGroup.createEl("h3", { text: isAr ? "حساب الإنجازات التراكمية" : "Calculate Lifetime Achievements" });
      btnGroup.createEl("p", { text: isAr ? "لحساب الإحصائيات الشاملة، نحتاج إلى فحص ملفاتك لمرة واحدة فقط." : "To calculate global stats, we need to scan your files once." });
      const btn = btnGroup.createEl("button", { cls: "mod-cta" });
      btn.textContent = isAr ? "بدء الحساب التراكمي الآن" : "Start Calculation Now";
      btn.onclick = async () => {
        btnGroup.empty();
        await this.syncLifetimeAchievements(container, isAr);
      };
      return;
    }

    // --- Section 1: Global Pulse Cards ---
    const cardsRow = container.createDiv({ cls: "dh-pulse-cards-row dh-grid-row" });

    const lifetimeCard = cardsRow.createDiv({ cls: "dh-pulse-card" });
    lifetimeCard.createDiv({ cls: "pulse-title", text: isAr ? "إجمالي الإنجازات" : "Lifetime Achievements" });
    lifetimeCard.createDiv({ cls: "pulse-value", text: this.plugin.settings.lifetimeCompleted.toString() });
    lifetimeCard.createDiv({ cls: "pulse-subtitle", text: isAr ? "🌟 علامة [x] مسطّرة في تاريخك" : "🌟 Total [x] in your vault" });

    const activeHabits = this.plugin.habitManager.getActiveHabits();
    const builds = activeHabits.filter(h => h.habitType === "build").length;
    const breaks = activeHabits.filter(h => h.habitType === "break").length;

    const identityCard = cardsRow.createDiv({ cls: "dh-pulse-card" });
    identityCard.createDiv({ cls: "pulse-title", text: isAr ? "توزيع الهوية" : "Identity Mix" });
    const identityVal = identityCard.createDiv({ cls: "pulse-value identity-value" });

    const buildWrap = identityVal.createDiv({ cls: "id-stat build-stat" });
    buildWrap.createSpan({ cls: "id-dot green-dot" });
    buildWrap.createSpan({ text: isAr ? `بناء: ${builds}` : `Build: ${builds}` });

    const breakWrap = identityVal.createDiv({ cls: "id-stat break-stat" });
    breakWrap.createSpan({ cls: "id-dot red-dot" });
    breakWrap.createSpan({ text: isAr ? `ترك: ${breaks}` : `Break: ${breaks}` });

    // Header notice based on user request (no textareas)
    const advisoryNote = container.createDiv({ cls: "dh-advisory-note" });
    advisoryNote.createSpan({ cls: "adv-icon", text: "💡" });
    advisoryNote.createSpan({
      cls: "adv-text", text: isAr
        ? "نصيحة: إذا اتخذت قراراً جديداً بناءً على هذه الأرقام، اكتبه فوراً في ملاحظة اليوم أو في ملف العادة لتثبيته."
        : "Tip: If you make a new decision based on these trends, write it immediately in today's note or the habit file."
    });

    // Render skeleton loader while data crunches (prevents UI freeze feeling)
    const loadingState = container.createDiv({ cls: "dh-skeleton-loader" });
    const skeletonCardsGrid = loadingState.createDiv({ cls: "dh-skeleton-cards-grid" });
    skeletonCardsGrid.createDiv({ cls: "dh-skeleton-card" });
    skeletonCardsGrid.createDiv({ cls: "dh-skeleton-card" });
    loadingState.createDiv({ cls: "dh-skeleton-row" });
    loadingState.createDiv({ cls: "dh-skeleton-row short" });
    loadingState.createDiv({ cls: "dh-skeleton-card" });
    loadingState.createDiv({ cls: "dh-skeleton-row" });
    loadingState.createDiv({ cls: "dh-skeleton-row short" });

    const { weeksData, dayStats, bestHabit, worstHabit } = await this.analyzeLastFourWeeks();
    loadingState.remove();

    if (weeksData.length === 0) return;

    // --- Section 2: Weekly Trends Table ---
    const trendsSection = container.createDiv({ cls: "dh-dashboard-section" });
    trendsSection.createEl("h3", { text: isAr ? "📈 اتجاهات الأسابيع الأخيرة" : "📈 Recent Weekly Trends" });
    trendsSection.createEl("p", {
      cls: "dh-section-desc",
      text: isAr ? "نظرة على آخر 4 أسابيع فقط (وليس كل تاريخك) لمعرفة مسارك الحالي واتخاذ قرارات تصحيحية فورية." : "A look at your last 4 weeks only to discover your current trajectory and make quick course corrections."
    });

    const tableTrends = trendsSection.createEl("table", { cls: "dh-dashboard-table" });
    const theadTrends = tableTrends.createEl("thead");
    const trThTrends = theadTrends.createEl("tr");
    trThTrends.createEl("th", { text: isAr ? "الأسبوع" : "Week" });
    trThTrends.createEl("th", { text: isAr ? "نسبة الإنجاز" : "Completion Rate" });
    trThTrends.createEl("th", { text: isAr ? "التغير (Trend)" : "Trend" });

    const tbodyTrends = tableTrends.createEl("tbody");

    // We show from Week 0 to Week -3
    for (let i = 0; i < weeksData.length; i++) {
      const tr = tbodyTrends.createEl("tr");
      let weekName = "";
      if (i === 0) weekName = isAr ? "هذا الأسبوع (مختار)" : "Current Week (Selected)";
      else if (i === 1) weekName = isAr ? "الأسبوع الماضي" : "Last Week (-1)";
      else weekName = isAr ? `الأسبوع -${i}` : `Week -${i}`;

      tr.createEl("td", { text: weekName });
      tr.createEl("td", { text: `${weeksData[i].rate}%` });

      // Trend cell (compared to prior week if exists)
      const trendCell = tr.createEl("td");
      if (i < weeksData.length - 1) {
        const diff = weeksData[i].rate - weeksData[i + 1].rate;
        if (diff > 0) {
          trendCell.textContent = isAr ? `🟢 تقدم بـ ${diff}%` : `🟢 +${diff}%`;
          trendCell.style.color = 'var(--dh-progress-excellent)';
        } else if (diff < 0) {
          const absDiff = Math.abs(diff);
          trendCell.textContent = isAr ? `🔴 تراجع بـ ${absDiff}%` : `🔴 -${absDiff}%`;
          trendCell.style.color = 'var(--dh-progress-critical)';
        } else {
          trendCell.textContent = isAr ? `➖ استقرار` : `➖ 0%`;
        }
      } else {
        trendCell.textContent = "—";
      }
    }

    // --- Best & Worst Habits Highlighter ---
    if (bestHabit && worstHabit && bestHabit.name !== worstHabit.name) {
      const habitsFocus = container.createDiv({ cls: "dh-habit-focus-box" });

      const bestEl = habitsFocus.createDiv({ cls: "focus-item best-focus clickable-card" });
      bestEl.createDiv({ cls: "focus-icon", text: "🎯" });
      const bText = bestEl.createDiv({ cls: "focus-text" });
      bText.createDiv({ cls: "focus-label", text: isAr ? "العادة الأقوى التزاماً" : "Most Consistent" });
      bText.createDiv({ cls: "focus-name", text: `${bestHabit.name} (${bestHabit.pct}%)` });

      bestEl.onclick = () => {
        const h = this.plugin.habitManager.getHabitById(bestHabit.id);
        if (h) {
          new AddHabitModal(
            this.app,
            this.plugin,
            async (updatedData) => {
              try {
                if (updatedData.levelData) updatedData.currentLevel = calculateCurrentLevel(updatedData.levelData);
                await this.plugin.habitManager.updateHabit(h.id, updatedData);
                await this.renderWeeklyGrid();
                new Notice(`✅ ${updatedData.name}`);
              } catch (e) {
                new Notice(`❌ Error: ${e.message}`);
              }
            },
            h
          ).open();
        }
      };

      const worstEl = habitsFocus.createDiv({ cls: "focus-item worst-focus clickable-card" });
      worstEl.createDiv({ cls: "focus-icon", text: "⚠️" });
      const wText = worstEl.createDiv({ cls: "focus-text" });
      wText.createDiv({ cls: "focus-label", text: isAr ? "العادة الأضعف (نقطة تسريب)" : "Needs Attention" });
      wText.createDiv({ cls: "focus-name", text: `${worstHabit.name} (${worstHabit.pct}%)` });

      worstEl.onclick = () => {
        const h = this.plugin.habitManager.getHabitById(worstHabit.id);
        if (h) {
          new AddHabitModal(
            this.app,
            this.plugin,
            async (updatedData) => {
              try {
                if (updatedData.levelData) updatedData.currentLevel = calculateCurrentLevel(updatedData.levelData);
                await this.plugin.habitManager.updateHabit(h.id, updatedData);
                await this.renderWeeklyGrid();
                new Notice(`✅ ${updatedData.name}`);
              } catch (e) {
                new Notice(`❌ Error: ${e.message}`);
              }
            },
            h
          ).open();
        }
      };
    }

    // --- Section 3: Day-by-Day Analysis ---
    const daySection = container.createDiv({ cls: "dh-dashboard-section" });
    daySection.createEl("h3", { text: isAr ? "📅 تحليل الأنماط اليومية (المتوسط)" : "📅 Day-by-Day Patterns (Average)" });
    daySection.createEl("p", {
      cls: "dh-section-desc",
      text: isAr ? "متوسط أداء كل يوم خلال الـ 28 يوماً الماضية. اكتشف يوم 'التسريب' وعالجه، ويوم ذروتك واستغله." : "Average performance over the last 28 days. Find your 'leaky' day to fix and your golden day to leverage."
    });

    const tableDays = daySection.createEl("table", { cls: "dh-dashboard-table day-patterns-table" });
    const theadDays = tableDays.createEl("thead");
    const trThDays = theadDays.createEl("tr");

    // Reorder days based on language settings
    const wsd = this.plugin.settings.weekStartDay;
    const dayOrder = Array.from({ length: 7 }, (_, i) => (wsd + i) % 7);

    for (const d of dayOrder) {
      trThDays.createEl("th", { text: this.plugin.translationManager.t(DAY_KEYS[d]) });
    }

    // Find min/max for highlighting
    let maxPct = -1;
    let minPct = 101;
    let validDaysCount = 0;

    const computedDays = {};
    for (const d of dayOrder) {
      const stats = dayStats[d];
      if (!stats || stats.total === 0) {
        computedDays[d] = NaN;
      } else {
        const pct = Math.round((stats.completed / stats.total) * 100);
        computedDays[d] = pct;
        validDaysCount++;
        if (pct > maxPct) maxPct = pct;
        if (pct < minPct) minPct = pct;
      }
    }

    if (maxPct === minPct) {
      minPct = -1;
      maxPct = -1;
    }

    const tbodyDays = tableDays.createEl("tbody");
    const trTbDays = tbodyDays.createEl("tr");

    for (const d of dayOrder) {
      const td = trTbDays.createEl("td");
      const v = computedDays[d];
      if (isNaN(v)) {
        td.textContent = "—";
      } else {
        let content = `${v}%`;
        if (v === maxPct) {
          content += " ✅";
          td.addClass("day-golden");
        } else if (v === minPct) {
          content += " 🔴";
          td.addClass("day-weakest");
        }
        td.textContent = content;
      }
    }

    if (validDaysCount > 0 && maxPct !== -1) {
      const diagnosis = daySection.createDiv({ cls: "day-diagnosis-text" });
      diagnosis.textContent = isAr
        ? "توجيه: أضعف أيامك باللون الأحمر، وهو 'نقطة التسريب'. أما أقوى أيامك بالأخضر، فحاول استنساخ ما تفعله فيه!"
        : "Guideline: Red indicates your weakest day that needs a routine fix, and Green is your strongest. Double down on what works!";
    }
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

  async readWeeklyDiaryEntries() {
    const entries = [];
    this.dailyReflectionDays = new Set();
    this.activeFilePaths.clear();

    for (let i = 0; i < 7; i++) {
      const dayDate = this.currentWeekStart.clone().add(i, "days");
      const dailyNote = await getNoteByDate(this.app, dayDate, false, this.plugin.settings);
      if (!dailyNote) continue;

      try {
        const content = await this.app.vault.cachedRead(dailyNote);
        this.activeFilePaths.add(dailyNote.path);
        const dayEntries = this.parseDailyReflectionEntries(content, dayDate, dailyNote.path);
        if (dayEntries.length > 0) {
          this.dailyReflectionDays.add(DateUtils.formatDateKey(dayDate));
          entries.push(...dayEntries);
        }
      } catch (e) {
        Utils.debugLog(this.plugin, "Failed to read diary daily note", dailyNote.path, e);
      }
    }

    return entries.sort((a, b) => b.timestamp - a.timestamp);
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

  renderDiaryEntryCard(parent, entry, isAr) {
    const typeMeta = this.getReflectionTypeMeta(entry.type, isAr);
    const entryCard = parent.createDiv({ cls: `dh-diary-entry-card type-${typeMeta.cls}` });

    const cardHeader = entryCard.createDiv({ cls: "entry-card-header" });
    const datePart = cardHeader.createDiv({ cls: "entry-date-part" });
    datePart.createSpan({ cls: "entry-day", text: entry.moment.clone().locale(isAr ? "ar" : "en").format("dddd") });
    datePart.createSpan({ cls: "entry-date", text: entry.moment.clone().locale(isAr ? "ar" : "en").format("D MMMM") });

    const badgePart = cardHeader.createDiv({ cls: "entry-badge-part" });
    badgePart.createSpan({ cls: `entry-type-badge type-${typeMeta.cls}`, text: typeMeta.label });
    if (entry.time) {
      badgePart.createSpan({ cls: "entry-time-badge", text: entry.time });
    }

    const bodyEl = entryCard.createDiv({ cls: "entry-card-body" });
    const webmMatch = entry.text.match(/!\[\[([^\]]+\.webm)\]\]/i);

    if (webmMatch) {
      const fileName = webmMatch[1];
      const audioFile = this.app.metadataCache.getFirstLinkpathDest(fileName, "");
      
      if (audioFile) {
        const src = this.app.vault.getResourcePath(audioFile);
        const audioEl = bodyEl.createEl("audio", { attr: { controls: true, src: src } });
        audioEl.style.width = "100%";
        audioEl.style.height = "36px";
        audioEl.style.marginTop = "4px";
        audioEl.style.borderRadius = "8px";
        
        // Prevent clicking the audio control from opening the daily note
        audioEl.onclick = (e) => e.stopPropagation();

        const remainingText = entry.text.replace(webmMatch[0], "").trim();
        if (remainingText) {
          bodyEl.createDiv({ text: remainingText, cls: "entry-action-text", attr: { style: "margin-top: 6px;" } });
        }
      } else {
        bodyEl.setText(entry.text);
      }
    } else if (entry.text.includes("![[")) {
      const { MarkdownRenderer } = require("obsidian");
      MarkdownRenderer.renderMarkdown(entry.text, bodyEl, entry.path || "", this);
    } else {
      bodyEl.setText(entry.text);
    }

    entryCard.onclick = async () => {
      const dailyNote = await getNoteByDate(this.app, entry.moment, false, this.plugin.settings);
      if (dailyNote) {
        await this.app.workspace.getLeaf(false).openFile(dailyNote);
      }
    };
  }

  renderDiaryTypeSections(container, entries, isAr) {
    REFLECTION_ENTRY_TYPES.forEach(type => {
      const typeMeta = this.getReflectionTypeMeta(type, isAr);
      const typeEntries = entries
        .filter(entry => normalizeReflectionType(entry.type) === type)
        .sort((a, b) => b.timestamp - a.timestamp);

      if (typeEntries.length === 0) return;

      const typeSection = container.createEl("details", {
        cls: `dh-diary-week-section dh-diary-type-section type-${typeMeta.cls}`,
        attr: { open: "true" }
      });
      const typeHeader = typeSection.createEl("summary", { cls: `dh-diary-week-header dh-diary-type-header type-${typeMeta.cls}` });

      const titleWrap = typeHeader.createDiv({ cls: "week-title-wrap" });
      titleWrap.createSpan({ cls: `dh-type-dot type-${typeMeta.cls}` });
      titleWrap.createSpan({ cls: "week-title", text: typeMeta.label });

      const metaWrap = typeHeader.createDiv({ cls: "week-meta-wrap" });
      metaWrap.createSpan({ cls: "entry-count", text: isAr ? `${typeEntries.length} تدوينة` : `${typeEntries.length} entries` });

      const entriesList = typeSection.createDiv({ cls: "dh-diary-entries-list" });
      typeEntries.forEach(entry => this.renderDiaryEntryCard(entriesList, entry, isAr));
    });
  }

  async renderDiaryView(container) {
    container.addClass("dh-diary-view-container");
    const isAr = this.plugin.settings.language === "ar";
    const weekEnd = this.currentWeekStart.clone().add(6, "days");
    const entries = await this.readWeeklyDiaryEntries();

    const toolbar = container.createDiv({ cls: "dh-diary-toolbar" });
    const titleWrap = toolbar.createDiv({ cls: "dh-diary-title-wrap" });
    titleWrap.createDiv({
      cls: "dh-diary-title",
      text: isAr ? "يوميات الأسبوع" : "Weekly diary",
    });
    titleWrap.createDiv({
      cls: "dh-diary-range",
      text: isAr
        ? `${this.currentWeekStart.clone().locale("ar").format("D MMMM")} - ${weekEnd.clone().locale("ar").format("D MMMM")}`
        : `${this.currentWeekStart.clone().locale("en").format("D MMM")} - ${weekEnd.clone().locale("en").format("D MMM")}`,
    });

    const actions = toolbar.createDiv({ cls: "dh-diary-actions" });
    const todayBtn = actions.createEl("button", {
      cls: "dh-diary-add-btn",
      text: isAr ? "تدوينة اليوم" : "Today entry",
    });
    todayBtn.onclick = () => this.openReflectionPopup(window.moment());

    const modeSwitch = actions.createEl("select", { cls: "dh-diary-mode-select dropdown" });
    [
      { id: "grouped", label: isAr ? "حسب الأيام" : "Grouped" },
      { id: "timeline", label: isAr ? "خط زمني" : "Timeline" },
      { id: "types", label: isAr ? "حسب النوع" : "By type" },
    ].forEach(mode => {
      const option = modeSwitch.createEl("option", {
        value: mode.id,
        text: mode.label,
      });
      if (this.diaryViewMode === mode.id) option.selected = true;
    });
    modeSwitch.onchange = async (e) => {
      const newMode = e.target.value;
      if (this.diaryViewMode === newMode) return;
      this.diaryViewMode = newMode;
      this.plugin.settings.diaryViewMode = newMode;
      await this.plugin.saveSettings({ silent: true });
      await this.renderWeeklyGrid();
    };

    if (entries.length === 0) {
      const emptyState = container.createDiv({ cls: "dh-diary-empty-state" });
      emptyState.createEl("h3", { text: isAr ? "لا توجد تدوينات في هذا الأسبوع" : "No entries this week" });
      emptyState.createEl("p", { text: isAr ? "اكتب تدوينة اليوم من الزر بالأعلى. سيتم حفظها داخل ملف اليوم نفسه." : "Use the button above. Entries are saved inside the matching Daily Note." });
      return;
    }

    if (this.diaryViewMode === "timeline") {
      const list = container.createDiv({ cls: "dh-diary-entries-list dh-diary-timeline-list" });
      entries.forEach(entry => this.renderDiaryEntryCard(list, entry, isAr));
      return;
    }

    if (this.diaryViewMode === "types") {
      this.renderDiaryTypeSections(container, entries, isAr);
      return;
    }

    for (let i = 0; i < 7; i++) {
      const dayDate = this.currentWeekStart.clone().add(i, "days");
      const dateKey = DateUtils.formatDateKey(dayDate);
      const dayEntries = entries
        .filter(entry => entry.dateKey === dateKey)
        .sort((a, b) => a.timestamp - b.timestamp);
      if (dayEntries.length === 0) continue;

      const isOpen = dayDate.isSame(window.moment(), "day");
      const daySection = container.createEl("details", {
        cls: "dh-diary-week-section",
        attr: isOpen ? { open: "true" } : {}
      });
      const dayHeader = daySection.createEl("summary", { cls: "dh-diary-week-header" });
      const titleWrap = dayHeader.createDiv({ cls: "week-title-wrap" });
      titleWrap.createSpan({ cls: "week-icon", text: "📅" });
      titleWrap.createSpan({
        cls: "week-title",
        text: dayDate.clone().locale(isAr ? "ar" : "en").format(isAr ? "dddd، D MMMM" : "dddd, D MMMM"),
      });

      const metaWrap = dayHeader.createDiv({ cls: "week-meta-wrap" });
      metaWrap.createSpan({ cls: "entry-count", text: isAr ? `${dayEntries.length} تدوينة` : `${dayEntries.length} entries` });
      const addDayBtn = metaWrap.createEl("button", {
        cls: "dh-diary-day-add-btn",
        text: "+",
        title: isAr ? "إضافة تدوينة لهذا اليوم" : "Add entry for this day",
      });
      addDayBtn.onclick = (e) => {
        e.stopPropagation();
        this.openReflectionPopup(dayDate);
      };

      const entriesList = daySection.createDiv({ cls: "dh-diary-entries-list" });
      dayEntries.forEach(entry => this.renderDiaryEntryCard(entriesList, entry, isAr));
    }
  }

}

class PluginGuideComponent {
  constructor(plugin) {
    this.plugin = plugin;
  }

  render(panel, t, isAr) {
    panel.empty();
    panel.addClass("dh-guide-panel");

    panel.createEl("h2", { text: t("tab_guide"), cls: "dh-guide-main-title" });

    // Helper for sections
    const createSection = (icon, titleAr, titleEn) => {
      const section = panel.createDiv({ cls: "dh-guide-section" });
      const header = section.createDiv({ cls: "dh-guide-header" });
      const iconWrap = header.createDiv({ cls: "dh-guide-icon" });
      setIcon(iconWrap, icon);
      header.createEl("h3", { text: isAr ? titleAr : titleEn });
      return section.createDiv({ cls: "dh-guide-content" });
    };

    // 1. How to Start
    const start = createSection("rocket", "كيف تبدأ", "Getting Started");
    const startList = start.createEl("ol", { cls: "dh-guide-steps" });
    [
      isAr ? "اذهب إلى تبويب 'العادات' وأضف عاداتك." : "Go to the 'Habits' tab and add your habits.",
      isAr ? "افتح 'الجدول الأسبوعي' من أيقونة التقويم في الشريط الجانبي." : "Open 'Weekly Grid' from the calendar icon in the sidebar.",
      isAr ? "اضغط على الخلية لتعليم العادة ✓ أو تخطيها ⊘ أو إلغائها ☐." : "Click a cell to mark it ✓, skip ⊘, or unmark ☐.",
      isAr ? "تابع إحصائياتك من تبويب 'الإحصائيات'." : "Track your stats from the 'Statistics' tab."
    ].forEach(text => startList.createEl("li", { text }));

    // 2. Meaning of Symbols
    const symbols = createSection("info", "معاني الرموز", "Symbols Meaning");
    const symbolsGrid = symbols.createDiv({ cls: "dh-guide-symbols-grid" });
    const createSymbol = (s, cls, dAr, dEn) => {
      const row = symbolsGrid.createDiv({ cls: "dh-guide-symbol-row" });
      row.createDiv({ cls: `day-cell dh-grid-cell ${cls}`, text: s });
      row.createDiv({ cls: "dh-guide-symbol-text", text: isAr ? dAr : dEn });
    };
    createSymbol("✓", "completed", "مكتمل بنجاح", "Successfully completed");
    createSymbol("x", "missed", "فائت (يوم مضى)", "Missed (Past day)");
    createSymbol("⊘", "skipped", "تم التخطي (السلسلة لا تنكسر)", "Skipped (Streak preserved)");
    createSymbol("☐", "pending", "بانتظار الإنجاز", "Pending today");
    createSymbol("--", "not-scheduled", "غير مجدول لهذا اليوم", "Not scheduled for this day");

    // Footer Tip
    panel.createDiv({
      cls: "dh-guide-tip",
      text: isAr
        ? "نصيحة: 'القليل المستمر خير من الكثير المنقطع'. ابدأ اليوم بأصغر فعل ممكن!"
        : "Tip: 'Consistency over Intensity'. Start today with the tiniest action!"
    });
  }
}

class DailyHabitsSettingTab extends PluginSettingTab {
  get isAr() {
    return this.plugin.settings.language === "ar";
  }
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.activeTab = "habits";
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("daily-habits-settings-container");

    const lang = this.plugin.settings.language;
    const isAr = lang === "ar";
    if (isAr) containerEl.addClass("is-rtl");
    else containerEl.removeClass("is-rtl");
    containerEl.setAttribute("dir", isAr ? "rtl" : "ltr");

    const t = (k) => this.plugin.translationManager.t(k);
    containerEl.createEl("h1", { text: t("settings_title") });

    // 1. Render Tab Navigation
    this.renderTabBar(containerEl, t, isAr);

    // 2. Create Panel Containers
    this.basicsPanel = containerEl.createDiv({ cls: "dh-settings-panel", attr: { id: "panel-basics" } });
    this.habitsPanel = containerEl.createDiv({ cls: "dh-settings-panel", attr: { id: "panel-habits" } });
    this.advancedPanel = containerEl.createDiv({ cls: "dh-settings-panel", attr: { id: "panel-advanced" } });
    this.guidePanel = containerEl.createDiv({ cls: "dh-settings-panel", attr: { id: "panel-guide" } });

    // 3. Render Panel Contents
    this.renderBasicsPanel(this.basicsPanel, t, isAr);
    this.renderHabitsPanel(this.habitsPanel, t, isAr);
    this.renderAdvancedPanel(this.advancedPanel, t, isAr);
    new PluginGuideComponent(this.plugin).render(this.guidePanel, t, isAr);

    // 4. Initialize Active Tab
    this.switchTab(this.activeTab);
  }

  renderTabBar(containerEl, t, isAr) {
    const tabsContainer = containerEl.createDiv({ cls: "dh-settings-tabs-container" });

    this.tabs = {
      basics: tabsContainer.createEl("button", { cls: "dh-tab-btn", text: t("tab_basics") }),
      habits: tabsContainer.createEl("button", { cls: "dh-tab-btn", text: t("tab_habits") }),
      advanced: tabsContainer.createEl("button", { cls: "dh-tab-btn", text: t("tab_advanced") }),
      guide: tabsContainer.createEl("button", { cls: "dh-tab-btn", text: t("tab_guide") })
    };

    // Add Habit count badge to Habits tab
    const activeHabitsCount = this.plugin.habitManager.getActiveHabits().length;
    if (activeHabitsCount > 0) {
      this.tabs.habits.textContent += ` (${activeHabitsCount})`;
    }

    Object.keys(this.tabs).forEach(tabId => {
      this.tabs[tabId].onclick = () => this.switchTab(tabId);
    });
  }

  switchTab(tabId) {
    this.activeTab = tabId;

    // Update button states
    if (this.tabs) {
      Object.keys(this.tabs).forEach(id => {
        this.tabs[id].toggleClass("is-active", id === tabId);
      });
    }

    // Update panel visibility
    const panels = {
      basics: this.basicsPanel,
      habits: this.habitsPanel,
      advanced: this.advancedPanel,
      guide: this.guidePanel
    };

    Object.keys(panels).forEach(id => {
      if (panels[id]) {
        panels[id].toggleClass("is-active", id === tabId);
      }
    });

    // Refresh child panels dynamically if needed to fix heights
    if (tabId === "habits" && this.habitsContainer) {
      const searchInput = this.containerEl.querySelector('.dh-search-input');
      const filter = searchInput ? searchInput.value.trim().toLowerCase() : "";
      this.renderHabitsList(this.habitsContainer, filter);
    }
  }

  refreshUI() {
    const st = this.containerEl.scrollTop;
    const hasActive = this.plugin.habitManager.getActiveHabits().length > 0;
    const hasArchived = this.plugin.habitManager.getArchivedHabits().length > 0;
    const currentlyHasActive = !!this.containerEl.querySelector('.dh-danger-zone');
    const currentlyHasArchived = !!this.archivedContainer;

    if (hasActive !== currentlyHasActive || hasArchived !== currentlyHasArchived) {
      const searchInput = this.containerEl.querySelector('.dh-search-input');
      const filter = searchInput ? searchInput.value : "";
      this.display();
      this.containerEl.scrollTop = st;
      if (filter) {
        const newSearch = this.containerEl.querySelector('.dh-search-input');
        if (newSearch) {
          newSearch.value = filter;
          newSearch.focus();
        }
      }
    } else {
      if (this.habitsContainer) {
        const searchInput = this.containerEl.querySelector('.dh-search-input');
        const filter = searchInput ? searchInput.value.trim().toLowerCase() : "";
        this.renderHabitsList(this.habitsContainer, filter);
      }
      if (this.archivedContainer) {
        this.renderArchivedHabitsList(this.archivedContainer);
      }
    }
  }

  renderBasicsPanel(panel, t, isAr) {
    new Setting(panel)
      .setName(t("language"))
      .setDesc(t("language_desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("ar", "العربية")
          .addOption("en", "English")
          .setValue(this.plugin.settings.language || "ar")
          .onChange(async (value) => {
            this.plugin.settings.language = value;
            await this.plugin.saveSettings();
            this.display(); // Full re-render needed for language change
            this.app.workspace.getLeavesOfType(VIEW_TYPE_WEEKLY).forEach((leaf) => {
              if (leaf.view && typeof leaf.view.refresh === "function") leaf.view.refresh();
            });
          })
      );

    new Setting(panel)
      .setName(t("habit_section_heading"))
      .setDesc(t("habit_section_heading_desc"))
      .addText((text) =>
        text
          .setPlaceholder("## 🎯 تتبع العادات")
          .setValue(this.plugin.settings.habitHeading)
          .onChange(async (value) => {
            this.plugin.settings.habitHeading = value || "## 🎯 تتبع العادات";
            await this.plugin.saveSettings();
          })
      );

    new Setting(panel)
      .setName(t("habit_marker"))
      .setDesc(t("habit_marker_desc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_MARKER)
          .setValue(this.plugin.settings.marker)
          .onChange(async (value) => {
            if (value.trim() && value !== this.plugin.settings.marker) {
              if (this.plugin.settings.habits && this.plugin.settings.habits.length > 0) {
                const isAr = this.plugin.settings.language === "ar";
                Utils.showConfirmNotice(
                  isAr ? "⚠️ تغيير العلامة سيجعل الإضافة تفقد القدرة على قراءة العادات القديمة وتُصَفِّر إحصائياتك. هل أنت متأكد؟" : "⚠️ Changing the marker will prevent the plugin from reading your past habits and reset stats. Are you sure?",
                  {
                    isAr,
                    confirmText: isAr ? "نعم، غيّر العلامة" : "Yes, change marker",
                    onConfirm: async () => {
                      this.plugin.settings.marker = value;
                      await this.plugin.saveSettings();
                    },
                    onCancel: () => {
                      this.display(); // Reset UI safely
                    }
                  }
                )
              } else {
                this.plugin.settings.marker = value;
                await this.plugin.saveSettings();
              }
            }
          })
      );

    const markerWarning = panel.createDiv({ cls: "setting-item-description" });
    markerWarning.style.cssText = "color: var(--text-error); margin-top: -12px; padding: 4px 0 12px; font-size: 0.85em;";
    markerWarning.textContent = isAr
      ? "⚠️ تحذير: تغيير هذه العلامة بعد استخدامها سيمنع قراءة بياناتك السابقة. السلاسل والإحصائيات ستصبح صفر."
      : "⚠️ Warning: Changing this marker after use will make all previous data unreadable. Streaks and stats will reset to zero.";

    new Setting(panel)
      .setName(t("show_count"))
      .setDesc(t("show_count_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showCount)
          .onChange(async (value) => {
            this.plugin.settings.showCount = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(panel)
      .setName(t("hide_year"))
      .setDesc(isAr ? "إخفاء السنة في العنوان" : "Hide the year in the header")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.hideYear)
          .onChange(async (value) => {
            this.plugin.settings.hideYear = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(panel)
      .setName(t("week_start"))
      .setDesc(t("week_start_desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("6", t("sat"))
          .addOption("0", t("sun"))
          .addOption("1", t("mon"))
          .addOption("2", t("tue"))
          .addOption("3", t("wed"))
          .addOption("4", t("thu"))
          .addOption("5", t("fri"))
          .setValue(String(this.plugin.settings.weekStartDay))
          .onChange(async (value) => {
            this.plugin.settings.weekStartDay = Number(value);
            await this.plugin.saveSettings();
          })
      );

    new Setting(panel)
      .setName(t("open_reminder"))
      .setDesc(t("open_reminder_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableOpenReminder ?? true)
          .onChange(async (value) => {
            this.plugin.settings.enableOpenReminder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(panel)
      .setName(t("enable_sound"))
      .setDesc(t("enable_sound_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableSound ?? true)
          .onChange(async (value) => {
            this.plugin.settings.enableSound = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(panel)
      .setName(t("show_hijri_date"))
      .setDesc(t("show_hijri_date_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showHijriDate ?? true)
          .onChange(async (value) => {
            this.plugin.settings.showHijriDate = value;
            await this.plugin.saveSettings();
          })
      );
  }

  renderHabitsPanel(panel, t, isAr) {
    new Setting(panel)
      .setName(t("auto_write_habits"))
      .setDesc(t("auto_write_habits_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoWriteHabits)
          .onChange(async (value) => {
            this.plugin.settings.autoWriteHabits = value;
            await this.plugin.saveSettings();
          })
      );

    const btnContainer = panel.createDiv();
    const addBtn = btnContainer.createEl("button", {
      text: t("add_habit_btn"),
      cls: "dh-add-habit-btn-hero",
    });
    addBtn.onclick = () => {
      new AddHabitModal(this.app, this.plugin, async (habitData) => {
        try {
          await this.plugin.habitManager.addHabit(habitData);
          await this.plugin.saveSettings();
          new Notice(t("success_added", { habit: habitData.name }));
          this.switchTab("habits");
          this.refreshUI(); // Check if structural update needed
        } catch (e) {
          new Notice(`Error: ${e.message}`);
        }
      }).open();
    };

    const importContainer = panel.createDiv({ cls: "dh-import-section" });
    new Setting(importContainer)
      .setName(t("import_habits"))
      .setDesc(t("import_desc"))
      .addButton((btn) => btn.setButtonText(isAr ? "📝 ملاحظة اليوم" : "📝 Today's Note").onClick(async () => {
        try {
          const today = window.moment();
          const dailyNote = await getNoteByDate(this.app, today, false);
          if (!dailyNote) {
            new Notice(isAr ? "لا توجد ملاحظة لليوم" : "No daily note found for today.");
            return;
          }
          const content = await this.app.vault.read(dailyNote);
          const count = await this.plugin.habitManager.importHabitsFromContent(content);
          if (count > 0) {
            new Notice(isAr ? `✅ تم استيراد ${count} عادة جديدة!` : `✅ Imported ${count} new habits!`);
            this.refreshUI();
          } else {
            new Notice(isAr ? "لم يتم العثور على عادات جديدة" : "No new habits found.");
          }
        } catch (e) {
          new Notice(isAr ? `فشل الاستيراد: ${e.message}` : `Import failed: ${e.message}`);
        }
      }))
      .addButton((btn) => btn.setButtonText(isAr ? "📂 اختيار ملف" : "📂 Choose File").onClick(() => {
        new FileSuggestModal(this.app, async (file) => {
          try {
            const content = await this.app.vault.read(file);
            const count = await this.plugin.habitManager.importHabitsFromContent(content);
            if (count > 0) {
              new Notice(isAr ? `✅ تم استيراد ${count} عادة من "${file.basename}"` : `✅ Imported ${count} habits from "${file.basename}"`);
              this.refreshUI();
            } else {
              new Notice(isAr ? "لم يتم العثور على عادات جديدة" : "No new habits found");
            }
          } catch (e) {
            new Notice(isAr ? `فشل الاستيراد: ${e.message}` : `Import failed: ${e.message}`);
          }
        }).open();
      }));

    const searchContainer = panel.createDiv({ cls: "dh-search-container" });
    const searchInput = searchContainer.createEl("input", {
      type: "text",
      placeholder: isAr ? "🔍 بحث في العادات..." : "🔍 Search habits...",
      cls: "dh-search-input",
    });
    searchInput.oninput = () => {
      this.renderHabitsList(this.habitsContainer, searchInput.value.trim().toLowerCase());
    };

    this.habitsContainer = panel.createDiv({ cls: "dh-habits-grid-settings" });
    this.renderHabitsList(this.habitsContainer);

    const archivedHabits = this.plugin.habitManager.getArchivedHabits();
    if (archivedHabits.length > 0) {
      const archivedHeader = panel.createDiv({
        cls: "dh-settings-section-header",
        text: isAr ? "📦 العادات المؤرشفة" : "📦 Archived Habits",
      });
      archivedHeader.style.marginTop = "20px";
      this.archivedContainer = panel.createDiv({ cls: "dh-habits-grid-settings" });
      this.renderArchivedHabitsList(this.archivedContainer);
    }

    if (this.plugin.habitManager.getActiveHabits().length > 0) {
      const dangerHeader = panel.createDiv({ cls: "dh-settings-section-header dh-danger-zone" });
      dangerHeader.createSpan({ text: isAr ? "منطقة الخطر" : "Danger Zone" });
      const dangerSetting = new Setting(panel)
        .setName(isAr ? "حذف جميع العادات" : "Delete all habits")
        .setDesc(isAr ? "حذف جميع العادات نهائياً. هذا الإجراء لا يمكن التراجع عنه." : "Permanently delete all habits. This cannot be undone.");
      dangerSetting.addButton((btn) => btn.setButtonText(isAr ? "🗑️ حذف الكل" : "🗑️ Delete all").setWarning().onClick(async () => {
        const habitsCount = this.plugin.habitManager.getActiveHabits().length;
        Utils.showConfirmNotice(isAr ? `⚠️ هل تريد حذف ${habitsCount} عادة؟` : `⚠️ Delete ${habitsCount} habits?`, {
          isAr,
          onConfirm: async () => {
            this.plugin.settings.habits = [];
            await this.plugin.saveSettings();
            this.refreshUI();
            new Notice(isAr ? "✅ تم حذف جميع العادات" : "✅ All habits deleted");
          }
        });
      }));
    }
  }

  renderAdvancedPanel(panel, t, isAr) {
    new Setting(panel)
      .setName(t("streak_break_on_missing"))
      .setDesc(t("streak_break_on_missing_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.streakBreakOnMissingNote ?? false)
          .onChange(async (value) => {
            this.plugin.settings.streakBreakOnMissingNote = value;
            await this.plugin.saveSettings();
          })
      );

    const dailyNotesInfo = getDailyNotesInfo(this.app, this.plugin.settings);
    const dailyNotesContainer = panel.createDiv({ cls: "dh-daily-notes-info" });
    const sourceLabels = {
      "daily-notes": { icon: "✅", ar: "متصل بـ Daily Notes (تلقائي)", en: "Connected to Daily Notes (auto)" },
      "periodic-notes": { icon: "✅", ar: "متصل بـ Periodic Notes (تلقائي)", en: "Connected to Periodic Notes (auto)" },
      "manual": { icon: "⚙️", ar: "إعدادات يدوية", en: "Manual configuration" },
      "defaults": { icon: "⚠️", ar: "قيم افتراضية (YYYY-MM-DD)", en: "Default values (YYYY-MM-DD)" },
    };
    const src = sourceLabels[dailyNotesInfo.source] || sourceLabels["defaults"];

    new Setting(dailyNotesContainer)
      .setName(isAr ? "التكامل مع الملاحظات اليومية" : "Daily notes integration")
      .setDesc(`${src.icon} ${isAr ? src.ar : src.en}`)
      .then((setting) => {
        if (dailyNotesInfo.source === "daily-notes" || dailyNotesInfo.source === "periodic-notes") {
          const detailsDiv = setting.descEl.createDiv({ cls: "dh-daily-notes-details" });
          if (dailyNotesInfo.folder) detailsDiv.createSpan({ text: isAr ? `📁 المجلد: ${dailyNotesInfo.folder}` : `📁 Folder: ${dailyNotesInfo.folder}` });
          if (dailyNotesInfo.format) {
            detailsDiv.createEl("br");
            detailsDiv.createSpan({ text: isAr ? `📄 الصيغة: ${dailyNotesInfo.format}` : `📄 Format: ${dailyNotesInfo.format}` });
          }
          if (dailyNotesInfo.template) {
            detailsDiv.createEl("br");
            detailsDiv.createSpan({ text: isAr ? `📝 القالب: ${dailyNotesInfo.template}` : `📝 Template: ${dailyNotesInfo.template}` });
          }
        }
      });

    new Setting(dailyNotesContainer)
      .setName(isAr ? "مصدر الإعدادات" : "Settings source")
      .setDesc(isAr ? "تلقائي = يكتشف إعدادات Daily Notes / Periodic Notes. يدوي = استخدم الحقول أدناه." : "Auto = detect from Daily Notes / Periodic Notes. Manual = use the fields below.")
      .addDropdown((dd) =>
        dd
          .addOption("auto", isAr ? "تلقائي" : "Auto")
          .addOption("manual", isAr ? "يدوي" : "Manual")
          .setValue(this.plugin.settings.dailyNotesSource)
          .onChange(async (value) => {
            this.plugin.settings.dailyNotesSource = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.dailyNotesSource === "manual" || dailyNotesInfo.source === "defaults") {
      new Setting(dailyNotesContainer)
        .setName(isAr ? "مجلد الملاحظات اليومية" : "Daily notes folder")
        .setDesc(isAr ? "المسار النسبي للمجلد (اتركه فارغاً للجذر)" : "Relative path to folder (leave empty for vault root)")
        .addText((text) =>
          text
            .setPlaceholder("Cycles/Daily Notes")
            .setValue(this.plugin.settings.dailyNotesFolder)
            .onChange(async (value) => {
              this.plugin.settings.dailyNotesFolder = value.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(dailyNotesContainer)
        .setName(isAr ? "صيغة التاريخ" : "Date format")
        .setDesc(isAr ? "صيغة Moment.js لاسم الملف" : "Moment.js format for filename")
        .addText((text) =>
          text
            .setPlaceholder("YYYY-MM-DD")
            .setValue(this.plugin.settings.dateFormat)
            .onChange(async (value) => {
              this.plugin.settings.dateFormat = value.trim() || "YYYY-MM-DD";
              await this.plugin.saveSettings();
            })
        );
    }

    // --- Habit Context (Comments) Settings ---
    const contextHeader = panel.createDiv({
      cls: "dh-settings-section-header",
      text: isAr ? "💬 سياق العادات (التعليقات)" : "💬 Habit Context (Comments)",
    });
    contextHeader.style.marginTop = "20px";

    new Setting(panel)
      .setName(t("enable_habit_context"))
      .setDesc(t("enable_habit_context_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableHabitContext ?? true)
          .onChange(async (value) => {
            this.plugin.settings.enableHabitContext = value;
            await this.plugin.saveSettings();
            this.display(); // Refresh to show/hide the heading setting
          })
      );

    if (this.plugin.settings.enableHabitContext) {
      new Setting(panel)
        .setName(t("habit_log_heading"))
        .setDesc(t("habit_log_heading_desc"))
        .addText((text) =>
          text
            .setPlaceholder(DEFAULT_HABIT_NOTES_HEADING)
            .setValue(this.plugin.settings.habitLogHeading)
            .onChange(async (value) => {
              this.plugin.settings.habitLogHeading = value.trim() || DEFAULT_HABIT_NOTES_HEADING;
              await this.plugin.saveSettings();
            })
        );
    }

    // --- Daily Note Journal Settings ---
    const journalHeader = panel.createDiv({
      cls: "dh-settings-section-header",
      text: isAr ? "📝 يومياتي" : "📝 Daily Journal",
    });
    journalHeader.style.marginTop = "20px";

    new Setting(panel)
      .setName(t("enable_reflection_journal"))
      .setDesc(t("enable_reflection_journal_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableReflectionJournal ?? true)
          .onChange(async (value) => {
            this.plugin.settings.enableReflectionJournal = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.enableReflectionJournal) {
      new Setting(panel)
        .setName(t("reflection_heading"))
        .setDesc(t("reflection_heading_desc"))
        .addText((text) =>
          text
            .setPlaceholder(DEFAULT_REFLECTION_HEADING)
            .setValue(this.plugin.settings.reflectionHeading)
            .onChange(async (value) => {
              this.plugin.settings.reflectionHeading = value.trim() || DEFAULT_REFLECTION_HEADING;
              await this.plugin.saveSettings();
            })
        );
    }
  }

  renderHabitsList(container, searchFilter = "") {
    container.empty();
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const isAr = this.isAr;
    let habits = this.plugin.habitManager.getActiveHabits();

    if (searchFilter) {
      habits = habits.filter(h =>
        h.name.toLowerCase().includes(searchFilter) ||
        (h.linkText && h.linkText.toLowerCase().includes(searchFilter))
      );
    }

    if (habits.length === 0) {
      const emptyState = container.createDiv({ cls: "dh-empty-state" });
      emptyState.createDiv({ cls: "dh-empty-state-icon", text: "🌱" });
      emptyState.createDiv({ cls: "dh-empty-state-title", text: t("empty_state_title") });
      emptyState.createDiv({ cls: "dh-empty-state-desc", text: t("empty_state_desc") });
      const addBtn = emptyState.createEl("button", {
        cls: "dh-empty-state-btn",
        text: t("empty_state_btn"),
      });
      addBtn.onclick = () => {
        new AddHabitModal(this.app, this.plugin, async (habitData) => {
          try {
            await this.plugin.habitManager.addHabit(habitData);
            await this.plugin.saveSettings();
            new Notice(t("success_added", { habit: habitData.name }));
            this.switchTab("habits");
            this.display(); // Needed to update tab badges
          } catch (e) {
            new Notice(`❌ ${e.message}`);
          }
        }).open();
      };
      return;
    }

    const list = container.createDiv({ cls: "dh-habits-list" });

    // Add Header Row for better clarity
    const headerRow = list.createDiv({ cls: "dh-habit-row dh-list-header" });
    headerRow.createDiv({ cls: "dh-col-id", text: "#" });
    headerRow.createDiv({
      cls: "dh-col-name",
      text: t("habit_name") || "Habit Name",
    });
    headerRow.createDiv({ cls: "dh-col-level", text: t("level") || "Level" });
    headerRow.createDiv({
      cls: "dh-col-schedule",
      text: "", // Schedule column header (intentionally empty)
    });
    headerRow.createDiv({ cls: "dh-col-actions", text: "" }); // Actions column

    const { sorted: sortedHabits, labels: displayLabels } = buildHierarchyLabels(habits);

    // Map: parentId -> child rows (for collapse/expand in settings)
    const settingsChildRowsMap = new Map();

    sortedHabits.forEach((habit, index) => {
      const effectiveParentId = this.plugin.habitManager.getEffectiveParentId(habit.id);
      const isChild = effectiveParentId !== null;
      const isParent = this.plugin.habitManager.isParent(habit.id);

      let colorId = habit.color || "teal";
      if (isChild) {
        const parentHabit = habits.find(h => h.id === effectiveParentId);
        if (parentHabit) colorId = parentHabit.color || "teal";
      }
      const colorHex = resolveHabitColorHex(colorId);

      const rowCls = isChild ? "dh-habit-row dh-habit-row-child" : "dh-habit-row";
      const row = list.createDiv({ cls: rowCls });
      row.style.setProperty("--habit-color", colorHex);

      // Track child rows for collapse
      if (isChild) {
        const pid = effectiveParentId;
        if (!settingsChildRowsMap.has(pid)) settingsChildRowsMap.set(pid, []);
        settingsChildRowsMap.get(pid).push(row);
      }

      // 1. Order / hierarchy ID cell
      const idCell = row.createDiv({ cls: isChild ? "dh-col-id dh-child-indent-cell" : "dh-col-id" });
      idCell.createSpan({ text: displayLabels[index], cls: "dh-label-num" });

      // 2. Name & Link (with type dot, collapse btn for parents)
      const nameCol = row.createDiv({ cls: "dh-col-name" });
      const nameRow = nameCol.createDiv({ cls: "dh-habit-name-row" });
      nameRow.createSpan({
        cls: `dh-type-dot ${habit.habitType === "break" ? "break" : "build"}`,
        title: habit.habitType === "break" ? t("break_habit") : t("build_habit"),
      });

      if (isParent) {
        // Collapse button (onclick wired after full render)
        nameRow.createSpan({
          cls: "dh-collapse-btn",
          text: "▾",
          title: isAr ? "إخفاء / عرض الفروع" : "Collapse / expand children",
          attr: { "data-settings-collapse-id": habit.id },
        });
      }

      nameRow.createSpan({ cls: "dh-habit-name", text: habit.name });

      // Show link only if different/meaningful
      const expectedLink = `[[${habit.name}]]`;
      if (
        habit.linkText &&
        habit.linkText !== expectedLink &&
        habit.linkText !== habit.name
      ) {
        nameCol.createDiv({ cls: "dh-habit-link", text: habit.linkText });
      }

      // 3. Level
      const level = habit.currentLevel || 1;
      const levelCol = row.createDiv({ cls: "dh-col-level" });
      levelCol.createSpan({
        text: level.toLocaleString(),
        cls: `dh-level-badge level-${level}`,
      });

      // 4. Schedule (Smart Display)
      const scheduleCol = row.createDiv({ cls: "dh-col-schedule" });
      const isDaily =
        habit.schedule.type === "all-days" || habit.schedule.days.length === 7;

      if (isDaily) {
        scheduleCol.createSpan({
          text: isAr ? "🔁 يومي" : "🔁 Daily",
          cls: "dh-schedule-tag daily",
        });
      } else {
        const count = habit.schedule.days.length;
        const dayNames = DAY_KEYS.map((k) => this.plugin.translationManager.t(k));
        const selectedDays = habit.schedule.days
          .sort()
          .map((d) => dayNames[d])
          .join("، ");

        scheduleCol.createSpan({
          text: isAr ? `🗓️ ${count} أيام` : `🗓️ ${count} Days`,
          cls: "dh-schedule-tag specific",
          title: selectedDays,
        });

      }

      // 5. Actions (Icons)
      const actionsCol = row.createDiv({ cls: "dh-col-actions" });

      // Group-scoped movement bounds
      // Bound correctly against the effective siblings in the resolved hierarchy
      const siblings = sortedHabits.filter(h => this.plugin.habitManager.getEffectiveParentId(h.id) === effectiveParentId);
      const posInGroup = siblings.findIndex(h => h.id === habit.id);
      const isFirstInGroup = posInGroup === 0;
      const isLastInGroup = posInGroup === siblings.length - 1;

      // 1. Move Up Button
      const moveUpBtn = actionsCol.createEl("button", { cls: "dh-icon-btn" });
      setIcon(moveUpBtn, "arrow-up");
      moveUpBtn.setAttribute("aria-label", isAr ? "نقل لأعلى" : "Move Up");
      if (isFirstInGroup) {
        moveUpBtn.addClass("is-disabled");
        moveUpBtn.disabled = true;
      }
      moveUpBtn.onclick = async () => {
        if (isFirstInGroup) return;
        try {
          await this.plugin.habitManager.moveHabitUp(habit.id);
          if (this.habitsContainer) this.renderHabitsList(this.habitsContainer);
          this.app.workspace.getLeavesOfType(VIEW_TYPE_WEEKLY).forEach((leaf) => {
            if (leaf.view && typeof leaf.view.refresh === "function") leaf.view.refresh();
          });
          new Notice(isAr ? "✅ تم النقل لأعلى" : "✅ Moved up");
        } catch (e) {
          console.error('[Core Habits] Move Up Error:', e);
          new Notice(`❌ Error: ${e.message}`);
        }
      };

      // 2. Move Down Button
      const moveDownBtn = actionsCol.createEl("button", { cls: "dh-icon-btn" });
      setIcon(moveDownBtn, "arrow-down");
      moveDownBtn.setAttribute("aria-label", isAr ? "نقل لأسفل" : "Move Down");
      if (isLastInGroup) {
        moveDownBtn.addClass("is-disabled");
        moveDownBtn.disabled = true;
      }
      moveDownBtn.onclick = async () => {
        if (isLastInGroup) return;
        try {
          await this.plugin.habitManager.moveHabitDown(habit.id);
          if (this.habitsContainer) this.renderHabitsList(this.habitsContainer);
          this.app.workspace.getLeavesOfType(VIEW_TYPE_WEEKLY).forEach((leaf) => {
            if (leaf.view && typeof leaf.view.refresh === "function") leaf.view.refresh();
          });
          new Notice(isAr ? "✅ تم النقل لأسفل" : "✅ Moved down");
        } catch (e) {
          console.error('[Core Habits] Move Down Error:', e);
          new Notice(`❌ Error: ${e.message}`);
        }
      };

      // 3. Edit Button
      const editBtn = actionsCol.createEl("button", { cls: "dh-icon-btn" });
      setIcon(editBtn, "pencil");
      editBtn.setAttribute("aria-label", t("edit_habit"));
      editBtn.onclick = () => {
        new AddHabitModal(
          this.app,
          this.plugin,
          async (updatedData) => {
            try {
              if (updatedData.levelData) {
                updatedData.currentLevel = calculateCurrentLevel(updatedData.levelData);
              }
              const shouldRenameAll = updatedData._renameInFiles;
              delete updatedData._renameInFiles;

              const oldName = habit.name;
              const newName = updatedData.name.trim();

              if (shouldRenameAll && oldName !== newName) {
                updatedData.linkText = `[[${newName}]]`;

                // Delegate physical file rename to HabitManager
                await this.plugin.habitManager.renameHabitFile(habit, newName);
              }
              await this.plugin.habitManager.updateHabit(habit.id, updatedData);

              if (shouldRenameAll && oldName !== newName) {
                const prep = await this.plugin.habitManager.prepareBatchRename(habit.id, oldName);

                if (!prep.needsConfirmation) {
                  new Notice(isAr ? "لم يتم العثور على ملفات قديمة للتحديث" : "No old files found to update");
                } else {
                  const confirmed = await new Promise((resolve) => {
                    const confirmModal = new Modal(this.app);
                    const { contentEl } = confirmModal;
                    contentEl.createEl("h2", { text: isAr ? "⚠️ تحديث جميع الملفات" : "⚠️ Update all files" });
                    contentEl.createEl("p", { text: isAr ? `سيتم تغيير "${oldName}" إلى "${newName}" في ${prep.fileCount} ملف.` : `Will change "${oldName}" to "${newName}" in ${prep.fileCount} file(s).` });
                    const footer = contentEl.createDiv({ cls: "modal-button-container" });
                    footer.createEl("button", { text: isAr ? "إلغاء" : "Cancel" }).onclick = () => { confirmModal.close(); resolve(false); };
                    footer.createEl("button", { text: isAr ? "نعم، تحديث الكل" : "Yes, update all", cls: "mod-warning" }).onclick = () => { confirmModal.close(); resolve(true); };
                    confirmModal.open();
                  });

                  if (confirmed) {
                    let cancelRequested = false;
                    let progressModal = new RenameProgressModal(
                      this.app, this.plugin, prep.fileCount, () => { cancelRequested = true; }
                    );
                    progressModal.open();

                    try {
                      const result = await this.plugin.habitManager.executeBatchRename(
                        newName, prep.uniqueOldNames, prep.filesToUpdate,
                        (curr, total) => progressModal.updateProgress(curr, total),
                        () => cancelRequested
                      );
                      progressModal.close();
                      if (cancelRequested) {
                        new Notice(isAr ? `⚠️ تم الإلغاء. المحدث: ${result.updated}` : `⚠️ Cancelled. Updated: ${result.updated}`);
                      } else {
                        new Notice(isAr ? `✅ تم تنظيف ${result.updated} رابط تاريخي بنجاح` : `✅ Successfully cleaned ${result.updated} historical links`);
                      }
                    } catch (err) {
                      progressModal.close();
                      console.error(err);
                      new Notice(isAr ? "❌ خطأ أثناء التحديث" : "❌ Error during update");
                    }
                  }
                }
              }

              this.refreshUI();
              new Notice(`✅ ${updatedData.name}`);
            } catch (e) {
              console.error('[Core Habits] Update Habit Error:', e);
              new Notice(`❌ Error: ${e.message}`);
            }
          },
          habit,
        ).open();
      };

      // 5. Delete Button
      const delBtn = actionsCol.createEl("button", {
        cls: "dh-icon-btn mod-warning",
      });
      setIcon(delBtn, "trash");
      delBtn.setAttribute("aria-label", t("delete"));
      delBtn.onclick = async () => {
        Utils.showConfirmNotice(
          isAr ? `⚠️ حذف "${habit.name}"؟` : `⚠️ Delete "${habit.name}"?`,
          {
            isAr,
            onConfirm: async () => {
              try {
                const deletedHabit = { ...habit };
                await this.plugin.habitManager.deleteHabit(habit.id);
                this.refreshUI();
                this.showUndoDeleteNotice(deletedHabit, t);
              } catch (e) {
                console.error('[Core Habits] Delete Error:', e);
                new Notice(`❌ Error: ${e.message}`);
              }
            },
          }
        );
      };

      // 6. Archive Button
      const archiveBtn = actionsCol.createEl("button", { cls: "dh-icon-btn" });
      setIcon(archiveBtn, "archive");
      archiveBtn.setAttribute("aria-label", isAr ? "أرشفة" : "Archive");
      archiveBtn.onclick = async () => {
        try {
          await this.plugin.habitManager.archiveHabit(habit.id);
          this.refreshUI();
          new Notice(isAr ? "✅ تم الأرشفة" : "✅ Archived");
        } catch (e) {
          console.error('[Core Habits] Archive Error:', e);
          new Notice(`❌ Error: ${e.message}`);
        }
      };
    });

    // Wire up collapse/expand buttons in settings list (after all rows are rendered)
    settingsChildRowsMap.forEach((childRows, pid) => {
      const toggleBtn = list.querySelector(`[data-settings-collapse-id="${pid}"]`);
      if (!toggleBtn) return;

      const parentHabit = habits.find(h => h.id === pid);
      if (!parentHabit) return;

      // Initialize state from settings (unified format: pid + ":expanded")
      const settingsKey = pid + ":expanded";
      let collapsed = !this.plugin.settings.collapsedGroups.includes(settingsKey);

      const updateUI = () => {
        toggleBtn.textContent = collapsed ? "▸" : "▾";
        toggleBtn.title = collapsed
          ? (isAr ? "عرض الفروع" : "Expand children")
          : (isAr ? "إخفاء الفروع" : "Collapse children");
        childRows.forEach(row => {
          row.style.display = collapsed ? "none" : "";
        });
      };

      // Apply initial state
      updateUI();

      toggleBtn.onclick = async (e) => {
        e.stopPropagation();
        collapsed = !collapsed;

        // Save state persistently (unified format: pid + ":expanded")
        if (collapsed) {
          this.plugin.settings.collapsedGroups = this.plugin.settings.collapsedGroups.filter(k => k !== settingsKey);
        } else {
          if (!this.plugin.settings.collapsedGroups.includes(settingsKey)) {
            this.plugin.settings.collapsedGroups.push(settingsKey);
          }
        }
        await this.plugin.saveSettings({ silent: true });

        updateUI();
      };
    });
  }

  /**
   * Render archived habits list
   * @param {HTMLElement} container - Container element to render into
   */
  renderArchivedHabitsList(container) {
    container.empty();
    const isAr = this.isAr;
    const t = (key) => this.plugin.translationManager.t(key);

    const archivedHabits = this.plugin.habitManager.getArchivedHabits().sort((a, b) => a.order - b.order);

    if (archivedHabits.length === 0) {
      container.createEl("p", {
        text: isAr ? "لا توجد عادات مؤرشفة" : "No archived habits",
        cls: "dh-no-habits-message",
      });
      return;
    }

    // Archived habits column headers
    const list = container.createDiv({ cls: "dh-habits-list" });
    const headerRow = list.createDiv({ cls: "dh-habit-row dh-list-header archived" });
    headerRow.createDiv({ cls: "dh-col-id", text: "#" });
    headerRow.createDiv({ cls: "dh-col-name", text: isAr ? "اسم العادة" : "Habit Name" });
    headerRow.createDiv({ cls: "dh-col-level", text: isAr ? "تاريخ الأرشفة" : "Archive Date" });
    headerRow.createDiv({ cls: "dh-col-streak", text: isAr ? "أطول سلسلة" : "Longest Streak" });
    headerRow.createDiv({ cls: "dh-col-actions", text: "" });

    archivedHabits.forEach((habit, index) => {
      const row = list.createDiv({ cls: "dh-habit-row archived" });

      // Order number
      row.createDiv({ cls: "dh-col-id", text: (index + 1).toLocaleString() });

      // Name
      const nameCol = row.createDiv({ cls: "dh-col-name" });
      nameCol.createEl("span", { text: habit.name, cls: "dh-habit-name" });

      // Archive date
      const dateCol = row.createDiv({ cls: "dh-col-level" });
      if (habit.archivedDate) {
        const archivedDate = new Date(habit.archivedDate);
        dateCol.createEl("span", {
          text: archivedDate.toLocaleDateString(),
          cls: "dh-archived-date",
        });
      }

      // Streak
      const streakCol = row.createDiv({ cls: "dh-col-streak" });
      streakCol.createEl("span", {
        text: (habit.savedLongestStreak || 0).toString(),
        cls: "dh-archived-streak",
      });

      // Actions
      const actionsCol = row.createDiv({ cls: "dh-col-actions" });

      // Restore Button
      const restoreBtn = actionsCol.createEl("button", { cls: "dh-icon-btn" });
      setIcon(restoreBtn, "rotate-ccw");
      restoreBtn.setAttribute("aria-label", isAr ? "استعادة" : "Restore");
      restoreBtn.onclick = async () => {
        try {
          await this.plugin.habitManager.restoreHabit(habit.id);
          this.refreshUI();
          new Notice(isAr ? "✅ تم الاستعادة" : "✅ Restored");
        } catch (e) {
          console.error('[Core Habits] Restore Error:', e);
          new Notice(`❌ Error: ${e.message}`);
        }
      };

      // Permanent Delete Button
      const deleteBtn = actionsCol.createEl("button", {
        cls: "dh-icon-btn mod-warning",
      });
      setIcon(deleteBtn, "trash-2");
      deleteBtn.setAttribute("aria-label", isAr ? "حذف نهائي" : "Delete Permanently");
      deleteBtn.onclick = async () => {
        Utils.showConfirmNotice(
          isAr ? `⚠️ حذف "${habit.name}" نهائياً؟` : `⚠️ Permanently delete "${habit.name}"?`,
          {
            isAr,
            onConfirm: async () => {
              try {
                await this.plugin.habitManager.deleteHabitPermanently(habit.id);
                this.refreshUI();
                new Notice(isAr ? "✅ تم الحذف النهائي" : "✅ Permanently deleted");
              } catch (e) {
                console.error('[Core Habits] Permanent Delete Error:', e);
                new Notice(`❌ Error: ${e.message}`);
              }
            },
          }
        );
      };
    });
  }

  /**
   * Show a persistent Notice with Undo and Close buttons for habit deletion.
   * Note: This state is held in memory and purposefully reset on app close (the habit
   * is deleted instantly from settings, but held within the notice closure).
   */
  showUndoDeleteNotice(deletedHabit, t) {
    const isAr = this.isAr;

    const fragment = document.createDocumentFragment();
    const container = document.createElement("div");
    container.className = "dh-undo-notice";

    container.createSpan({
      text: isAr
        ? `🗑️ تم حذف "${deletedHabit.name}"`
        : `🗑️ Deleted "${deletedHabit.name}"`
    });

    const btnContainer = container.createDiv({ cls: "dh-undo-buttons" });

    const undoBtn = btnContainer.createEl("button", {
      text: isAr ? "تراجع" : "Undo",
      cls: "dh-undo-btn"
    });

    const closeBtn = btnContainer.createEl("button", {
      text: "✕",
      cls: "dh-close-btn"
    });
    fragment.appendChild(container);

    const notice = new Notice(fragment, 0);

    undoBtn.onclick = async () => {
      delete deletedHabit.streakData;
      const insertAt = this.plugin.settings.habits.findIndex(h => h.order > deletedHabit.order);
      if (insertAt === -1) {
        this.plugin.settings.habits.push(deletedHabit);
      } else {
        this.plugin.settings.habits.splice(insertAt, 0, deletedHabit);
      }
      await this.plugin.saveSettings();

      notice.hide();
      this.refreshUI();
      new Notice(isAr ? "✅ تم استعادة العادة" : "✅ Habit restored");
    };

    closeBtn.onclick = () => {
      notice.hide();
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Utilities — Mutex, TextUtils, DateUtils, helpers
// ═══════════════════════════════════════════════════════════════════════════════

// Simpler Mutex

class TextUtils {
  static clean(text) {
    if (!text) return "";
    return text.normalize("NFC").replace(/\[\[|\]\]/g, "").trim();
  }
}

function findHabitEntry(scannedHabits, linkText, nameHistory = []) {
  const allNames = [
    TextUtils.clean(linkText),
    ...nameHistory.map(n => TextUtils.clean(n)),
  ];
  return scannedHabits.find(h => {
    const t = TextUtils.clean(h.text);
    return allNames.some(name => t === name || t.startsWith(name + " "));
  });
}

function calculateCurrentLevel(levelData) {
  if (!levelData) return null;
  let maxAchieved = -1;
  for (let i = 0; i < 5; i++) {
    if (levelData[i]?.achieved) maxAchieved = i;
  }
  return maxAchieved === -1 ? 1 : Math.min(maxAchieved + 2, 5);
}

/**
 * Builds a flat sorted list (parents then children) and display labels (e.g. "1", "2.1").
 * Orphan habits automatically act as top-level habits to gracefully handle archiving/deletion.
 */
function buildHierarchyLabels(habits) {
  if (!Array.isArray(habits) || habits.length === 0) return { sorted: [], labels: [] };

  const activeIds = new Set(habits.map(h => h.id));
  const getEffectiveParentId = (h) => {
    if (!h.parentId) return null;
    return activeIds.has(h.parentId) ? h.parentId : null;
  };

  const topLevel = habits.filter(h => getEffectiveParentId(h) === null)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const sorted = [];
  const labels = [];
  let pCounter = 0;
  const cMap = new Map();

  for (const parent of topLevel) {
    sorted.push(parent);

    pCounter++;
    labels.push(String(pCounter));

    const children = habits.filter(h => getEffectiveParentId(h) === parent.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    for (const child of children) {
      sorted.push(child);
      const cc = (cMap.get(parent.id) || 0) + 1;
      cMap.set(parent.id, cc);
      labels.push(`${pCounter}.${cc}`);
    }
  }

  return { sorted, labels };
}

class DateUtils {
  /** @param {moment.Moment} date - Moment instance. Returns YYYY-MM-DD in en locale for stable keys. */
  static formatDateKey(date) {
    return date && typeof date.clone === "function"
      ? date.clone().locale("en").format("YYYY-MM-DD")
      : "";
  }

  static getHijriDate(date) {
    if (!date) return "-";
    try {
      let nativeDate;
      if (date instanceof Date) {
        nativeDate = date;
      } else if (date && typeof date.toDate === "function") {
        nativeDate = date.toDate();
      } else if (date && typeof date === "object" && date._d) {
        nativeDate = date._d;
      } else {
        nativeDate = new Date(date);
      }

      if (isNaN(nativeDate.getTime())) return "التاريخ الهجري غير متاح";

      const formatter = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });

      let formatted = formatter.format(nativeDate);
      const arabicToEnglish = {
        "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
        "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
      };

      return formatted.replace(/[٠-٩]/g, (digit) => arabicToEnglish[digit]);
    } catch (error) {
      console.warn("[Core Habits] Hijri date format error:", error);
      return "التاريخ الهجري غير متاح";
    }
  }
}

function getDailyNotesInfo(app, pluginSettings = null) {
  const fallbackFormat = pluginSettings?.dateFormat || "YYYY-MM-DD";
  const fallbackFolder = pluginSettings?.dailyNotesFolder || "";
  let info = { source: "defaults", enabled: true, format: fallbackFormat, folder: fallbackFolder, template: "" };

  if (pluginSettings?.dailyNotesSource === "manual") {
    info.source = "manual";
    return info;
  }

  try {
    const dnPlugin = app.internalPlugins.getPluginById("daily-notes");
    if (dnPlugin && dnPlugin.enabled) {
      info.source = "daily-notes";
      if (dnPlugin.instance?.options) {
        info.format = dnPlugin.instance.options.format || info.format;
        info.folder = dnPlugin.instance.options.folder || info.folder;
        info.template = dnPlugin.instance.options.template || "";
      }
      return info;
    }
  } catch (e) { }

  try {
    const pn = app.plugins?.getPlugin("periodic-notes");
    if (pn?.settings?.daily?.enabled) {
      info.source = "periodic-notes";
      info.format = pn.settings.daily.format || info.format;
      info.folder = pn.settings.daily.folder || info.folder;
      info.template = pn.settings.daily.template || "";
      return info;
    }
  } catch (e) { }

  if (fallbackFolder || (pluginSettings?.dateFormat && pluginSettings.dateFormat !== "YYYY-MM-DD")) {
    info.source = "manual";
  }

  return info;
}

/**
 * Safely ensures a section (heading) exists in a file and appends a new line under it.
 * Uses vault.process for atomic read-write to prevent data loss.
 * @param {App} app - Obsidian App instance
 * @param {TFile} file - The file to modify
 * @param {string} heading - The markdown heading (e.g. "## 📖 سجل المتابعة")
 * @param {string} newLine - The line to append under the heading
 */
async function ensureNestedSectionInFile(app, file, parentHeading, subHeading, newLine) {
  await app.vault.process(file, (content) => {
    return Utils.insertNestedContent(content, parentHeading, subHeading, newLine);
  });
}

/**
 * Injects a timestamped habit comment into the matching Daily Note.
 */
async function injectHabitCommentIntoDailyNote(app, plugin, habit, targetDate, comment) {
  const file = await getNoteByDate(app, targetDate, true, plugin.settings);
  if (!file) {
    throw new Error(plugin.settings.language === "ar"
      ? "تعذر فتح ملف اليوم."
      : "Could not open the daily note.");
  }

  const timeStr = window.moment().format("HH:mm");
  const cleanName = TextUtils.clean(habit.linkText || habit.name);
  const habitLabel = habit.linkText || habit.name;
  const commentLine = `- ${timeStr} [habit-note:: ${cleanName}] ${habitLabel} - ${comment}`;
  const heading = plugin.settings.habitLogHeading || DEFAULT_HABIT_NOTES_HEADING;

  await ensureNestedSectionInFile(app, file, plugin.settings.dailyParentHeading, heading, commentLine);
  return file.basename;
}

/**
 * Injects a typed daily reflection into the matching Daily Note.
 */
async function injectReflectionIntoDailyNote(app, plugin, targetDate, text, type = "Idea") {
  const file = await getNoteByDate(app, targetDate, true, plugin.settings);
  if (!file) {
    throw new Error(plugin.settings.language === "ar"
      ? "تعذر فتح ملف اليوم."
      : "Could not open the daily note.");
  }

  const timeStr = window.moment().format("HH:mm");
  const reflectionType = normalizeReflectionType(type);
  const reflectionLine = `- ${timeStr} [type:: ${reflectionType}] ${text}`;
  const heading = plugin.settings.reflectionHeading || DEFAULT_REFLECTION_HEADING;

  await ensureNestedSectionInFile(app, file, plugin.settings.dailyParentHeading, heading, reflectionLine);
  return file.basename;
}
