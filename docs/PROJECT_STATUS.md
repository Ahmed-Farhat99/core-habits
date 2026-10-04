# Core Habits — Project status

Updated: 2026-09-27. Source version: 3.5.0. The project is in release-candidate verification; a public release has not been made from this worktree.

## Current architecture

- `src/main.js` registers views, commands, settings, events, and services.
- Habit definitions and lifecycle are stored in habit notes through `HabitManager`, `HabitRepository`, and `HabitNoteManager`.
- Daily checklist entries and journal content are stored in Daily Notes. `HabitJournalService` coordinates comment and reflection use cases.
- `StatsService` reads Daily Notes and maintains derived indexes. `src/domain/stats/` contains the calculations.
- `WeeklyGridView` owns the grid, diary, and statistics UI controllers. See [runtime boundaries](./architecture/runtime-boundaries.md).

## Verification status

The automated suite, ESLint, selected strict JavaScript type checking, production build, and release metadata check are the local gates. Their latest results should be taken from the current command output or CI run, rather than a fixed number in this document. Type checking is incremental and does not yet cover every source file.

Manual verification remains required in an actual Obsidian vault on desktop and mobile, with legacy data and the intended Daily Notes and sync setup. Automated tests use mocks and cannot establish full platform compatibility or prove that a user's vault can never be changed unexpectedly.

## Known constraints

- Daily Notes and Periodic Notes detection uses guarded internal plugin interfaces where available; manual configuration is the fallback. This integration needs testing against the Obsidian versions intended for release.
- Migration backups cover affected habit notes, not the entire vault. Users should keep their own full backup before upgrading.
- The release workflow produces a draft GitHub release. Publishing and Community Plugins submission require human review and manual Obsidian verification.

## References

- [Data contract](./architecture/data-contract.md)
- [UI architecture and design system](./architecture/ui-design-system.md)
- [Obsidian compatibility checklist](./OBSIDIAN_COMPATIBILITY.md)
- [Reference test scenarios](./testing/reference-scenarios.md)

