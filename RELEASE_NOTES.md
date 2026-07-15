# Core Habits v3.4.0 🚀

This release introduces critical synchronization fixes, a redesigned mobile workflow with live statistics, robust clean code improvements, and modern security provenance:

### ⚙️ Startup Sync Cooldown (Race Condition Fix)
- **Startup Protection**: Introduced a configurable cooldown delay (default 15 seconds, adjustable via slider under Advanced Settings) that blocks auto-writing default templates on startup. This gives Obsidian sync services (e.g. Remotely Save) ample time to fetch/download newer cloud files, resolving the bug where checked habits disappeared.
- **Improved Settings Tab**: Added an interactive slider control conditional on enabling `autoWriteHabits` with dynamic tooltips and instant configuration updates.

### 📱 Premium 7-Day Week Picker Strip on Mobile
- **Interactive Week Strip**: Replaced the clunky `<` and `>` navigation in the compact layout with a highly responsive, clickable 7-day horizontal calendar strip for phones and sidebars.
- **Live Daily Completion Rates**: Displays the name abbreviation, day number, and **live daily completion statistics** (`💯`, `80%`, etc.) for all 7 days of the active week.
- **Visual Today Indicator**: Highlighted today's date with a subtle accent-colored dot at the top of the pill card, mimicking premium native calendars (like Google and Apple Calendar).
- **Instant List Loading**: Tapping any day in the strip instantly renders its specific habits list and updates percentage badges dynamically upon toggling.

### 🛡️ Clean Code & Failure Notifications
- **Clean Exception Handling**: Conducted a deep code quality audit (`$clean-code-guard`). Removed silent UI toggle failures by integrating visual warnings (`new Notice`) if a habit update transaction fails.
- **Removed Specificity Hacks**: Cleaned up the CSS stylesheet by completely eliminating the use of `!important`, relying on precise CSS Specificity hierarchies.
- **Upgraded Platform Target**: Bumped minimum supported Obsidian version to `1.5.0` to utilize native CSS Grid Subgrid safely, resolving legacy browser compatibility warnings.

### 🔒 Build Provenance & Security
- **GitHub Artifact Attestations**: Integrated cryptographic build provenance signing for release assets (`main.js` and `styles.css`) using GitHub Actions, ensuring that the released binaries match the public source repository.
