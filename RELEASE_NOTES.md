# Core Habits 3.5.3

This stability and data integrity release resolves critical startup resilience issues, eliminates daily note duplicate creation hazards, and ensures reliable habit renaming across lagging metadata cache conditions.

## Key Highlights & Improvements

### 🛡️ Startup Resilience & Notice Contract
- **Non-Fatal Startup Notice Safety**: Fixed a critical startup blocker where conflicting or malformed habit warnings failed to display and caused initialization errors. Harmonized the `NoticeService` API contract with a defensive `.warn` alias to guarantee graceful degradation.
- **Quarantine Isolation Reliability**: Conflicting habit IDs and malformed notes are safely isolated into quarantine without halting the plugin lifecycle or losing user notes.

### 📝 Daily Note Deduplication & Write Safety
- **Authoritative Provider Respect**: Resolved a split-brain issue where daily notes created by Obsidian's native `daily-notes` or `periodic-notes` plugins were discarded if their directory pattern differed slightly from calculated defaults, preventing duplicate note creation.
- **Concurrency & Existing File Guards**: Added proactive checks before manual fallback creation to eliminate race condition exceptions and duplicate writes.

### 🔄 Resilient Manual Habit Rename Handling
- **Multi-Tiered Identifier Resolution**: When users rename habit notes directly in the Obsidian File Explorer, `handleVaultRename` now seamlessly falls back to the in-memory indexed path (`getHabitIdByPath`) or direct frontmatter disk parsing if Obsidian's `metadataCache` has not completed indexing yet.
- **Intact Name History & Link Tracking**: Guarantees that historical link text (`nameHistory`) and active links are reliably updated during external and explorer renames.

### 🧹 Code Hygiene & Strict Verification
- **Zero Warnings Linter Cleanliness**: Removed all unused imports and stale references across the codebase.
- **Complete Test Suite Verification**: All 58 test suites (687 tests) pass with 100% compliance.

## Verification Checklist

1. `npm ci` completes cleanly with exact lockfile resolution.
2. `npm run lint` and `npm run typecheck` pass with zero errors and zero warnings.
3. `npm run ui:check` confirms CSS ownership, token references, and no duplicate declarations.
4. All 58 test files in `npm run test:run` pass.
5. `npm run build` bundles `main.js` and `styles.css`.
6. `npm run release:check -- 3.5.3` validates metadata coherence across `manifest.json`, `package.json`, `package-lock.json`, and `versions.json`.
