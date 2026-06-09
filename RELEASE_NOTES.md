# Core Habits v3.1.0 🚀

This is a massive update focused on extreme performance optimizations, native date support, and a much smoother user experience.

### ✨ What's New
- **Blazing Fast Dashboard**: Completely eliminated DOM lag, UI freezing, and memory leaks when rapidly checking/unchecking habits. The streak calculation engine now runs asynchronously and caches perfectly.
- **Smart Streak Engine (🔥)**: The streak logic has been entirely rebuilt. It now flawlessly calculates your longest streak and first completion date without double-counting days or missing historical data.
- **Native Hijri Dates**: The plugin now supports dynamic Hijri/Gregorian date formatting that automatically adapts to the plugin's interface language (Arabic vs English).
- **Clean Audio & Text Logs**: Added the ability to record audio voice notes and text reflections directly inside the habit's dedicated note.
- **Linter & Performance**: Removed unused variables and optimized background file writing.

### 🛠️ Fixes
- Fixed an issue where the "Streak Queue" would infinitely accumulate DOM rendering tasks, causing the entire table to flicker and crash.
- Fixed a bug where checking a habit multiple times quickly would lead to overlapping file writes.
- Corrected the UI overlapping of the header counters.

---

*Thank you for trusting Core Habits to build your core path.* 🌟
