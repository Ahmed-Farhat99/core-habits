/**
 * Canonical data contract for Core Habits.
 *
 * This module defines ownership and types only. Runtime persistence remains
 * unchanged until the repository/migration stages adopt this contract.
 */

export const HABIT_SCHEMA_VERSION = 1;

export const DATA_OWNERSHIP = Object.freeze({
  habitDefinition: "habit-note-frontmatter",
  dailyOccurrence: "daily-note",
  habitComment: "daily-note",
  dailyReflection: "daily-note",
  pluginPreferences: "plugin-data",
  runtimeHabitIndex: "derived-memory",
  statistics: "derived-cache",
});

export const HABIT_REQUIRED_FIELDS = Object.freeze([
  "schemaVersion",
  "id",
  "name",
  "schedule",
  "createdAt",
  "archived",
  "order",
]);

export const HABIT_FIELD_CONTRACT = Object.freeze({
  schemaVersion: { type: "integer", persistedAs: "schema_version", required: true },
  id: { type: "string", persistedAs: "habit_id", required: true, immutable: true },
  name: { type: "string", persistedAs: "name", required: true },
  schedule: { type: "schedule", persistedAs: ["schedule", "days"], required: true },
  createdAt: { type: "timestamp", persistedAs: "created_at", required: true },
  archived: { type: "boolean", persistedAs: "archived", required: true },
  archivedDate: { type: "nullable-timestamp", persistedAs: "archived_at" },
  restoredDate: { type: "nullable-timestamp", persistedAs: "restored_at" },
  order: { type: "integer", persistedAs: "order", required: true },
  parentId: { type: "nullable-string", persistedAs: "parent_id" },
  nameHistory: { type: "string-array", persistedAs: "name_history" },
  savedLongestStreak: { type: "integer", persistedAs: "saved_longest_streak" },
  habitType: { type: "enum", values: ["build", "break"], persistedAs: "habit_type" },
  color: { type: "string", persistedAs: "color" },
  currentLevel: { type: "integer", persistedAs: "current_level" },
  levelData: { type: "level-array", persistedAs: "level_*" },
  atomicDescription: { type: "atomic-description", persistedAs: ["identity", "cue", "friction", "reward"] },
  notes: { type: "string", persistedAs: "notes" },
});

export const DAILY_OCCURRENCE_STATES = Object.freeze([
  "not-scheduled",
  "completed",
  "skipped",
  "uncompleted",
  "missing-note",
  "missing-entry",
  "before-created",
  "after-archived",
  "before-restored",
]);

export function inspectHabitContract(habit) {
  const errors = [];

  if (!habit || typeof habit !== "object" || Array.isArray(habit)) {
    return ["Habit must be an object"];
  }

  for (const field of HABIT_REQUIRED_FIELDS) {
    if (habit[field] === undefined || habit[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (habit.id !== undefined && (typeof habit.id !== "string" || habit.id.trim() === "")) {
    errors.push("id must be a non-empty string");
  }
  if (habit.name !== undefined && (typeof habit.name !== "string" || habit.name.trim() === "")) {
    errors.push("name must be a non-empty string");
  }
  if (habit.schemaVersion !== undefined && !Number.isInteger(habit.schemaVersion)) {
    errors.push("schemaVersion must be an integer");
  }
  if (habit.order !== undefined && !Number.isInteger(habit.order)) {
    errors.push("order must be an integer");
  }
  if (habit.archived !== undefined && typeof habit.archived !== "boolean") {
    errors.push("archived must be a boolean");
  }
  if (habit.schedule !== undefined) {
    const days = habit.schedule?.days;
    if (!Array.isArray(days) || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      errors.push("schedule.days must contain integers from 0 to 6");
    }
  }

  return errors;
}
