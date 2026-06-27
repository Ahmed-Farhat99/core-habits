export const canonicalHabit = {
  id: "habit-1234567890",
  name: "Reading Books",
  linkText: "[[Reading Books]]",
  habitType: "build",
  color: "teal",
  schedule: { type: "weekly", days: [1, 3, 5] },
  currentLevel: 2,
  archived: true,
  parentId: "parent-habit-id",
  createdAt: 1718976000000, // 2024-06-21
  order: 5,
  nameHistory: ["[[Read Books]]", "[[Daily Reading]]"],
  atomicDescription: {
    identity: "I am a reader",
    cue: "After dinner at the desk",
    friction: "Keep book open on desk",
    reward: "A cup of herbal tea"
  },
  notes: "Manual user notes are kept here.",
  levelData: [
    { goal: "Read 5 pages", condition: "At least 5 pages", achieved: true },
    { goal: "Read 10 pages", condition: "At least 10 pages", achieved: false },
    { goal: "Read 20 pages", condition: "At least 20 pages", achieved: false },
    { goal: "Read 30 pages", condition: "At least 30 pages", achieved: false },
    { goal: "Read 50 pages", condition: "At least 50 pages", achieved: false }
  ],
  archivedDate: 1718990000000,
  restoredDate: null,
  savedLongestStreak: 12
};
