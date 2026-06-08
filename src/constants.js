export const DEFAULT_MARKER = "[habit:: true]";
export const DEFAULT_PARENT_HEADING = "## 🌟 يومياتي";
export const DEFAULT_REFLECTION_HEADING = "### 📝 تدوينات اليوم";
export const DEFAULT_HABIT_NOTES_HEADING = "### 💬 ملاحظات العادات";
export const REFLECTION_ENTRY_TYPES = ["Good", "Bad", "Lesson", "Idea"];

export function normalizeReflectionType(type) {
  const cleanType = String(type || "").trim();
  return REFLECTION_ENTRY_TYPES.includes(cleanType) ? cleanType : "Idea";
}

export const DEBOUNCE_DELAY_MS = 300;

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export const VIEW_TYPE_WEEKLY = "weekly-habits-view";

export const HABIT_COLORS_PALETTE = [
  { id: "teal", hex: "#14b8a6" },
  { id: "blue", hex: "#3b82f6" },
  { id: "purple", hex: "#8b5cf6" },
  { id: "amber", hex: "#f59e0b" },
  { id: "rose", hex: "#f43f5e" },
  { id: "green", hex: "#10b981" },
  { id: "indigo", hex: "#6366f1" },
  { id: "cyan", hex: "#06b6d4" },
  { id: "pink", hex: "#ec4899" },
  { id: "orange", hex: "#f97316" },
  { id: "lime", hex: "#84cc16" },
  { id: "slate", hex: "#64748b" },
];

export function resolveHabitColorHex(colorId) {
  const entry = HABIT_COLORS_PALETTE.find(c => c.id === colorId);
  return entry ? entry.hex : HABIT_COLORS_PALETTE[0].hex;
}

export const DEFAULT_SETTINGS = {
  marker: DEFAULT_MARKER,
  showCount: true,
  debugMode: false,
  dataVersion: 2,
  hideYear: false,
  lastSeenVersion: "",

  habits: [],

  weekStartDay: 6,
  showHijriDate: true,

  habitNotesFolder: "Core Habits",
  nativeMigrated: false,

  dailyParentHeading: DEFAULT_PARENT_HEADING,
  habitHeading: "### 🔄 تتبع العادات",
  autoWriteHabits: true,

  dailyNotesFolder: "",
  dailyNotesSource: "auto",
  dateFormat: "YYYY-MM-DD",

  language: "ar",



  enableOpenReminder: true,

  enableSound: true,

  collapsedGroups: [],

  enableHabitContext: true,
  habitLogHeading: DEFAULT_HABIT_NOTES_HEADING,

  enableReflectionJournal: true,
  reflectionHeading: DEFAULT_REFLECTION_HEADING,
  diaryViewMode: "grouped",
};

export const TRANSLATIONS = {
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
    enable_habit_context: "Enable habit context",
    enable_habit_context_desc: "Allow adding timestamped habit comments inside the matching Daily Note.",
    habit_log_heading: "Habit log heading",
    habit_log_heading_desc: "The heading inside each Daily Note where comments will be injected.",
    enable_reflection_journal: "Enable daily journal",
    enable_reflection_journal_desc: "Allow writing daily logs into the matching Daily Note.",
    reflection_heading: "Daily logs heading",
    reflection_heading_desc: "The heading inside each Daily Note where daily entries will be listed.",
    reflection_modal_title: "How was your day?",
  },
  ar: {
    reflection_good: "جيد",
    reflection_bad: "سيء",
    reflection_lesson: "درس",
    reflection_idea: "فكرة",
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
    enable_habit_context: "تفعيل تعليقات العادة (سياق العادة)",
    enable_habit_context_desc: "السماح بكتابة تعليقات العادات داخل ملف اليوم نفسه.",
    habit_log_heading: "عنوان تعليقات العادات",
    habit_log_heading_desc: "العنوان داخل ملف اليوم الذي ستُحفظ تحته تعليقات العادات.",
    enable_reflection_journal: "تفعيل سجل اليوميات",
    enable_reflection_journal_desc: "السماح بكتابة اليوميات داخل ملف اليوم نفسه بدل ملف مركزي.",
    reflection_heading: "عنوان قسم اليوميات",
    reflection_heading_desc: "العنوان داخل ملف اليوم الذي ستُضاف تحته تدوينات اليوم.",
    reflection_modal_title: "كيف كان يومك تقييماً عاماً؟",
  },
};
