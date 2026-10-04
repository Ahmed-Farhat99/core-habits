# Runtime boundaries

The plugin entry point (`src/main.js`) owns Obsidian registration and constructs the services. Runtime identifiers such as command IDs and view types are unchanged by these internal boundaries.

| Use case | UI entry | Service | File owner |
|---|---|---|---|
| Habit definitions and lifecycle | Settings and habit editor | `HabitManager` | `HabitRepository` / `HabitNoteManager` |
| Daily checklist entries | Weekly grid | `HabitManager` | Daily Note through `getNoteByDate` and `vault.process` |
| Habit comments and reflections | Weekly view and journey panel | `HabitJournalService` | `HabitCommentRepository` |
| Diary display | Diary controller | `DiaryService` | Daily Notes, read only |
| Statistics | Grid and statistics controller | `StatsService` | Daily Notes, read only; derived cache |

`WeeklyGridView` passes three narrow contexts from `WeeklyViewContexts.js`: grid, diary, and statistics. Each context reads current view state when invoked. The controllers do not own persisted data.

Legacy habit frontmatter and note formats remain supported by `HabitEntity`, `HabitNoteManager`, and `MigrationManager`. Do not remove those parsing paths based only on missing direct imports: Obsidian can reach them through registered events, commands, or old vault files.

`npm run typecheck` uses `tsconfig.check.json` with strict `checkJs` for a small set of modules. Expand its `include` list one boundary at a time after adding JSDoc or declaration types. The whole application is not yet TypeScript checked.
