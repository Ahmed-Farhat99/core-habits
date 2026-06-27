# Core Habits v3.2.0 🚀

This release introduces an elegant, adaptive layout built intentionally for narrow sidebars and mobile screens, alongside critical fixes for Daily Notes template engines (such as Templater) and historical log safety.

### ✨ What's New
- **Adaptive Layout & Sidebar Mode**: The Weekly Grid now automatically transitions to a beautiful, highly-legible Compact List layout when placed inside a narrow sidebar pane or opened on mobile devices.
- **RTL-Aware Day Navigator**: Switch between days easily inside the sidebar with chevron controls and a quick "Today" shortcut button, with native support for both English (LTR) and Arabic (RTL) locales.
- **Obsidian Daily Notes API Delegation**: Decoupled Daily Note creation so that it triggers Obsidian's internal daily notes commands. This allows templates containing Templater tags (`<% ... %>`) to run and expand fully before the habits section is appended.

### 🛠️ Fixes
- **Historical Note Integrity**: Restructured the file-open auto-write behavior so that it only processes today's note or future notes. This ensures opening older daily notes will never overwrite, alter, or erase archived habits or historical completions.
- **DOM Size Optimization**: Reduced sidebar DOM nodes by up to 70% by transitioning from table layouts to dynamic lists, keeping Obsidian fast and lightweight on lower-end devices.

---

*Thank you for trusting Core Habits to build your core path.* 🌟
