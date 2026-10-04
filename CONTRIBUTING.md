# Contributing to Core Habits

Thank you for your interest in contributing to **Core Habits**! We welcome contributions, bug reports, and suggestions from the Obsidian community.

---

## 🛠️ Development Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (version 20 or higher, 22 LTS / 24 recommended)
- `npm` (version 9 or higher)
- [Obsidian](https://obsidian.md/) (v1.7.0+ recommended) for testing inside an active vault

### Installation
1. Fork and clone the repository:
   ```bash
   git clone https://github.com/Ahmed-Farhat99/core-habits.git
   cd core-habits
   ```
2. Install exact dependencies:
   ```bash
   npm install
   ```

3. Start development watcher:
   ```bash
   npm run dev
   ```
   This will bundle the plugin to `main.js` and `styles.css` and recompile on changes.

---

## 🧪 Testing and Quality Checks

Before submitting a Pull Request, please ensure all automated checks pass locally:

```bash
# Run ESLint across source and test files
npm run lint

# Run UI CSS structure and ownership checks
npm run ui:check

# Run TypeScript declaration and contract typecheck
npm run typecheck

# Run full Vitest test suite
npm run test:run

# Build production bundle
npm run build

# Verify release metadata and asset integrity
npm run release:check
```

---

## 📂 Project Structure

```
├── src/
│   ├── components/      # UI components (suggest, voice recorder, panels)
│   ├── config/          # Default settings, headings, and constants
│   ├── locales/         # Bilingual translation files (Arabic & English)
│   ├── modals/          # Modal dialogs and entry popups
│   ├── repositories/    # File and data persistence layers
│   ├── services/        # Business logic engines (HabitManager, StreakCalculator, etc.)
│   ├── styles/          # Modular CSS stylesheets with design tokens
│   ├── utils/           # Shared utility and formatting functions
│   ├── views/           # Custom ItemViews (Weekly Grid, Diary, Statistics)
│   └── main.js          # Plugin entry point
├── tests/               # Vitest unit and integration tests
└── scripts/             # Release and CSS validation scripts
```

---

## 📝 Guidelines

### Code Quality & Obsidian API
- Use Obsidian's official public API (`obsidian`) whenever available. Avoid deprecated or undocumented internal methods.
- Do not use `localStorage` or `sessionStorage` for plugin persistence; use Obsidian's `loadData()` and `saveData()` or `getLanguage()`.
- Respect vault privacy: do not perform unconstrained vault operations when scoped directory lookups suffice.
- Ensure all new user-facing strings are added to both `src/locales/en.js` and `src/locales/ar.js`.

### CSS & Design
- Adhere to the CSS design tokens defined in `src/styles/tokens.css`.
- Ensure all layouts support both LTR and RTL (`[dir="rtl"]`) directions gracefully.
- Run `npm run ui:check` to ensure no conflicting or duplicate declarations.

### Submitting Pull Requests
1. Create a descriptive feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Write clean, readable code with accompanying tests in `tests/`.
3. Verify all validation scripts pass (`npm run lint`, `npm run typecheck`, `npm run ui:check`, `npm run test:run`, `npm run build`).
4. Commit with concise, conventional commit messages.
5. Push your branch and open a Pull Request against `main`.

---

## 🐛 Reporting Issues

If you find a bug or have a feature idea:
- Check existing [GitHub Issues](https://github.com/Ahmed-Farhat99/core-habits/issues) to avoid duplicates.
- Provide steps to reproduce, Obsidian version, OS, and screenshots or error console logs if applicable.

Thank you for helping make Core Habits better for everyone!
