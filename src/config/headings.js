export const DEFAULT_MARKER = "[habit:: true]";

export const DEFAULT_PARENT_HEADING_AR = "## 🌟 يومياتي";
export const DEFAULT_HABIT_HEADING_AR = "### 🔄 تتبع العادات";
export const DEFAULT_REFLECTION_HEADING_AR = "### 📝 تدوينات اليوم";
export const DEFAULT_HABIT_NOTES_HEADING_AR = "### 💬 ملاحظات العادات";

export const DEFAULT_PARENT_HEADING_EN = "## 🌟 Journal";
export const DEFAULT_HABIT_HEADING_EN = "### 🔄 Habits";
export const DEFAULT_REFLECTION_HEADING_EN = "### 📝 Reflections";
export const DEFAULT_HABIT_NOTES_HEADING_EN = "### 💬 Habit Notes";

// Baseline default constants for backward compatibility
export const DEFAULT_PARENT_HEADING = DEFAULT_PARENT_HEADING_AR;
export const DEFAULT_HABIT_HEADING = DEFAULT_HABIT_HEADING_AR;
export const DEFAULT_REFLECTION_HEADING = DEFAULT_REFLECTION_HEADING_AR;
export const DEFAULT_HABIT_NOTES_HEADING = DEFAULT_HABIT_NOTES_HEADING_AR;

/**
 * Returns localized default headings for the given language.
 * @param {string} [language]
 */
export function getDefaultHeadings(language = "en") {
  const isAr = String(language || "").toLowerCase().startsWith("ar");
  return {
    dailyParentHeading: isAr ? DEFAULT_PARENT_HEADING_AR : DEFAULT_PARENT_HEADING_EN,
    habitHeading: isAr ? DEFAULT_HABIT_HEADING_AR : DEFAULT_HABIT_HEADING_EN,
    reflectionHeading: isAr ? DEFAULT_REFLECTION_HEADING_AR : DEFAULT_REFLECTION_HEADING_EN,
    habitLogHeading: isAr ? DEFAULT_HABIT_NOTES_HEADING_AR : DEFAULT_HABIT_NOTES_HEADING_EN,
  };
}

export const KNOWN_HABIT_HEADINGS = [
  "### 🔄 تتبع العادات",
  "## 🔄 تتبع العادات",
  "### تتبع العادات",
  "## تتبع العادات",
  "### العادات",
  "## العادات",
  "### عاداتي اليومية",
  "### 🔄 Habits",
  "## 🔄 Habits",
  "### Habits",
  "## Habits",
  "### Daily Habits",
  "## Daily Habits",
  "### Habit Tracker"
];

export const KNOWN_HABIT_LOG_HEADINGS = [
  "### 💬 ملاحظات العادات",
  "### 💬 Habit Notes",
  "### 📝 ملاحظات العادات",
  "### 📝 Habit Notes",
  "## 💬 ملاحظات العادات",
  "## 💬 Habit Notes",
  "### Habit Notes",
  "## Habit Notes",
  "### ملاحظات العادات",
  "## ملاحظات العادات"
];

export const KNOWN_REFLECTION_HEADINGS = [
  "### 📝 تدوينات اليوم",
  "### 📝 Reflections",
  "### 💭 خواطر وأفكار",
  "### 💭 Daily Reflections",
  "## 📝 تدوينات اليوم",
  "## 📝 Reflections",
  "## 💭 خواطر وأفكار",
  "## 💭 Daily Reflections",
  "### خواطر وأفكار",
  "### Reflections",
  "### Daily Reflections"
];

export const REFLECTION_ENTRY_TYPES = ["Good", "Bad", "Lesson", "Idea"];

/** @param {unknown} type */
export function normalizeReflectionType(type) {
  const cleanType = String(type || "").trim();
  return REFLECTION_ENTRY_TYPES.includes(cleanType) ? cleanType : "Idea";
}

export const DEBOUNCE_DELAY_MS = 300;

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export const VIEW_TYPE_WEEKLY = "weekly-habits-view";
export const VIEW_TYPE_HABIT_EDIT = "core-habits-edit-view";
