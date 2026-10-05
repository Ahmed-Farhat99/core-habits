import { getLanguage } from 'obsidian';
import {
  DEFAULT_MARKER,
  DEFAULT_PARENT_HEADING,
  DEFAULT_HABIT_HEADING,
  DEFAULT_REFLECTION_HEADING,
  DEFAULT_HABIT_NOTES_HEADING,
} from './headings.js';

/**
 * Safely detects the user's Obsidian interface language using the official Obsidian API.
 * Falls back to moment locale and navigator.language if getLanguage is unavailable.
 * @returns {"ar" | "en"}
 */
export function detectInitialLanguage() {
  try {
    if (typeof getLanguage === "function") {
      const lang = getLanguage();
      if (lang) {
        return String(lang).toLowerCase().startsWith("ar") ? "ar" : "en";
      }
    }
    const momentFactory = typeof window !== "undefined" ? window.moment : globalThis.moment;
    const momentLocale = momentFactory?.locale?.();
    if (momentLocale && String(momentLocale).toLowerCase().startsWith("ar")) {
      return "ar";
    }
    if (typeof navigator !== "undefined" && navigator.language) {
      if (navigator.language.toLowerCase().startsWith("ar")) return "ar";
    }
  } catch {
    // Graceful fallback
  }
  return "en";
}

export const DEFAULT_SETTINGS = {
  marker: DEFAULT_MARKER,
  showCount: true,
  debugMode: false,
  hideYear: false,
  lastSeenVersion: "",
  lifetimeCompleted: null,

  habits: [],

  weekStartDay: 6,
  showHijriDate: true,
  hasSeenGridHint: false,

  habitNotesFolder: "Core Habits",

  dailyParentHeading: DEFAULT_PARENT_HEADING,
  habitHeading: DEFAULT_HABIT_HEADING,
  habitHeadingHistory: [],
  dailyParentHeadingHistory: [],
  autoWriteHabits: true,
  syncStartupDelay: 15,

  dailyNotesFolder: "",
  dailyNotesSource: "auto",
  dateFormat: "YYYY-MM-DD",
  dailyNoteSourcesHistory: [],

  language: "ar",

  enableOpenReminder: true,
  enableMissedDaysNotice: true,

  enableSound: true,

  collapsedGroups: [],
  collapsedGroupsSemanticMigrated: false,

  habitOrder: [],
  habitOrderVersion: 0,

  enableHabitContext: true,
  habitLogHeading: DEFAULT_HABIT_NOTES_HEADING,
  habitLogHeadingHistory: [],

  enableReflectionJournal: true,
  reflectionHeading: DEFAULT_REFLECTION_HEADING,
  reflectionHeadingHistory: [],
  streakBreakOnMissing: false,
  diaryViewMode: "grouped",
};
