# Core Habits v3.2.1 🚀

This is a major release introducing an elegant, adaptive layout built intentionally for narrow sidebars and mobile screens, alongside critical hotfixes for Obsidian Daily Notes template engines (such as Templater), safe settings bootstrapping, and workspace lifecycle safety.

### ✨ What's New
- **Adaptive Layout & Sidebar Mode**: The Weekly Grid now automatically transitions to a beautiful, highly-legible Compact List layout when placed inside a narrow sidebar pane or opened on mobile devices.
- **RTL-Aware Day Navigator**: Switch between days easily inside the sidebar with chevron controls and a quick "Today" shortcut button, with native support for both English (LTR) and Arabic (RTL) locales.
- **Obsidian Daily Notes API Delegation**: Decoupled Daily Note creation so that it triggers Obsidian's internal daily notes commands. This allows templates containing Templater tags (`<% ... %>`) to run and expand fully before the habits section is appended.

### 🛠️ Fixes & Stability
- **Safe Settings Bootstrapping (Hotfix)**: Fixed a startup race condition where settings migrations would trigger view refreshes before the translation manager was initialized, eliminating `Cannot read properties of undefined (reading 't')` crashes.
- **Robust onunload Cleanup (Hotfix)**: Added safety checks in `onunload` to ensure the plugin unloads cleanly even if the loading phase was partially aborted, preventing broken cached layouts on reloads.
- **Deferred Onboarding (Hotfix)**: Moved Onboarding Modal initialization to the end of the workspace layout ready lifecycle to guarantee all translation dictionaries are fully loaded.
- **Historical Note Integrity**: Restructured the file-open auto-write behavior so that it only processes today's note or future notes. This ensures opening older daily notes will never overwrite, alter, or erase archived habits or historical completions.
- **DOM Size Optimization**: Reduced sidebar DOM nodes by up to 70% by transitioning from table layouts to dynamic lists, keeping Obsidian fast and lightweight on lower-end devices.

---

*Thank you for trusting Core Habits to build your core path.* 🌟
