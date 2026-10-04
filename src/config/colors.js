export const HABIT_COLORS_PALETTE = [
  { id: "rose", hex: "#f43f5e" },
  { id: "pink", hex: "#ec4899" },
  { id: "orange", hex: "#f97316" },
  { id: "amber", hex: "#f59e0b" },
  { id: "lime", hex: "#84cc16" },
  { id: "green", hex: "#10b981" },
  { id: "teal", hex: "#14b8a6" },
  { id: "cyan", hex: "#06b6d4" },
  { id: "blue", hex: "#3b82f6" },
  { id: "indigo", hex: "#6366f1" },
  { id: "purple", hex: "#8b5cf6" },
  { id: "slate", hex: "#64748b" },
];

/** @param {string} colorId @returns {string} */
export function resolveHabitColorHex(colorId) {
  const entry = HABIT_COLORS_PALETTE.find(c => c.id === colorId);
  return entry ? entry.hex : (HABIT_COLORS_PALETTE.find(c => c.id === "teal")?.hex || "#14b8a6");
}
