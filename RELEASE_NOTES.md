# Core Habits v3.2.2 🚀

This is a maintenance and stability release fixing critical user experience issues in the Daily/Compact View and startup notices, while also cleaning up runtime memory overhead.

### 🛠️ Fixes & Stability
- **Daily View Collapse / Expand**: Resolved a CSS specificity issue where `.dh-compact-row` used `!important` display rules, which overrode inline JS toggles and broke the ability to collapse/expand habits in the Daily (Compact) list.
- **Startup Notification Race Condition**: Fixed a race condition where startup reminder notices ran before the `HabitManager` finished loading files into memory on layout ready, resulting in incorrect count readings. All startup notices now execute in sequential order after full database and translation bootstrapping.
- **Smart Completion Calculations**: Updated the incomplete habits calculator to target active scheduled habits for the current day. If your Daily Note for today doesn't exist yet, it now correctly assumes all scheduled habits for today are pending (instead of returning 0).
- **Unused State Cleanups**: Removed obsolete mapping trackers (`previousCellState` and `previousSkipState`) to optimize active memory usage and keep the plugin lightweight.
- **Refined Assets**: Updated all README.md presentation screenshots to use modern mockup cards with high-readability borders and dark backgrounds.

---

*Thank you for trusting Core Habits to build your core path.* 🌟
