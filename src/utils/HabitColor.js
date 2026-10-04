import { resolveHabitColorHex } from '../config/colors.js';

/** Resolve UI color IDs or an already resolved hex at the color boundary. */
export function normalizeHabitColorHex(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : resolveHabitColorHex(value);
}

/** Independent of display filtering and input order; uses the domain hierarchy. */
export function buildHabitColorMap(habits, habitManager = null) {
  const lookup = new Map((habitManager?.getHabits?.() || habits).map(h => [h.id, h]));
  for (const habit of habits) lookup.set(habit.id, habit);
  const colors = new Map();
  const resolve = (habit, visiting = new Set()) => {
    if (colors.has(habit.id)) return colors.get(habit.id);
    if (visiting.has(habit.id)) return normalizeHabitColorHex(habit.color);
    visiting.add(habit.id);
    const parentId = habitManager?.getEffectiveParentId
      ? habitManager.getEffectiveParentId(habit.id)
      : habit.parentId;
    const parent = lookup.get(parentId) || habitManager?.getHabitById?.(parentId);
    const color = parent && !parent.archived && !parent.deleted && !visiting.has(parent.id)
      ? resolve(parent, visiting)
      : normalizeHabitColorHex(habit.color);
    visiting.delete(habit.id);
    colors.set(habit.id, color);
    return color;
  };
  return new Map(habits.map(habit => [habit.id, resolve(habit)]));
}

/** Draft hierarchy/color changes must not use the persisted entity's parent. */
export function getFormHabitColorHex(formState, habit, habitManager) {
  const preview = {
    ...habit,
    id: habit?.id || "__habit_color_preview__",
    color: formState?.selectedColor ?? habit?.color,
    parentId: formState && Object.hasOwn(formState, "selectedParentId")
      ? formState.selectedParentId : habit?.parentId,
  };
  const active = habitManager?.getActiveHabits?.() || [];
  const map = buildHabitColorMap([...active.filter(h => h.id !== preview.id), preview]);
  return map.get(preview.id);
}

/** JS passes identity once; CSS owns all paint derived from this value. */
export function applyHabitColor(element, color) {
  element.classList.add("dh-habit-color-scope");
  element.style.setProperty("--habit-color", normalizeHabitColorHex(color));
}
