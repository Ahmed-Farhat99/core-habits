# Core Habits 3.5.1

This maintenance and quality release addresses Obsidian automated review requirements, improves link integration, and refines reflection modals with native Wikilink autocomplete.

## Key Highlights & Improvements

### 🔗 Wikilink Autocomplete & Note Linking
- **Inline Note Autocomplete**: Typing `[[` in reflection popups and comment textareas now opens an accessible autocomplete popover powered by Obsidian's native fuzzy search and aliases.
- **Interactive Markdown Links**: Internal and external links rendered in Diary and Habit Journey views now support Obsidian's native click actions, modifier keys (Ctrl/Cmd-click for new tab, Shift-click for new window), and page hover-previews.
- **Accurate Prefix Parsing**: Comment prefixes and habit names with markdown links are cleanly parsed without mangling subsequent markdown content.

### 🛡️ Compliance, Security & Obsidian Review Hardening
- **Official Obsidian API for Language**: Replaced web storage access with the official `getLanguage()` API from `obsidian`, removing all `localStorage` usage.
- **Cryptographic Build Provenance**: Configured GitHub Actions release workflow with official `actions/attest-build-provenance@v2` to generate verifiable cryptographic SLSA artifact attestations for release assets.
- **Strict Lockfile Parity**: Synchronized `package.json` and `package-lock.json` to guarantee reproducible dependency resolution across automated build runners.
- **CSS Modernization**: Streamlined grid gap declarations and text decoration rules, ensuring full compatibility with Obsidian's style guidelines.
- **Community Hygiene**: Added comprehensive `CONTRIBUTING.md` guide with development setup, testing commands, and PR guidelines.

## Verification Checklist

1. `npm ci` completes cleanly with exact lockfile resolution.
2. `npm run lint` and `npm run typecheck` pass with zero errors.
3. `npm run ui:check` confirms CSS ownership, token references, and no duplicate declarations.
4. All 50 test files in `npm run test:run` pass.
5. `npm run build` bundles `main.js` and `styles.css`.
6. `npm run release:check` validates metadata coherence across `manifest.json`, `package.json`, `package-lock.json`, and `versions.json`.
