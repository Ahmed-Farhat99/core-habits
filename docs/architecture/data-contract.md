# Core Habits Data Contract

Status: approved baseline for repository and migration work. This document does
not change runtime persistence by itself.

## Data ownership

| Data | Single source of truth | Notes |
|---|---|---|
| Habit definition and lifecycle | Habit note frontmatter | Addressed by immutable `habit_id` |
| Daily completion/skip state | Matching Daily Note | One occurrence per habit and date |
| Habit comment | Matching Daily Note | Associated by `habit_id`, not display name |
| Daily reflection | Matching Daily Note | Independent from habit comments |
| Plugin preferences | Plugin data | UI and integration preferences only |
| In-memory habit map | Derived memory | Must be rebuildable from habit notes |
| Statistics | Derived cache | Must be rebuildable from source files |

No feature may introduce another writable source for the same data.

## Habit identity

- `habit_id` is immutable and globally unique.
- A display name is mutable and is never an identity key.
- File resolution must ultimately use `habit_id`.
- `name_history` is compatibility metadata, not identity.

## Canonical habit fields

The executable declaration is
[`src/domain/HabitDataContract.js`](../../src/domain/HabitDataContract.js).
Every serializer and migration must preserve all fields declared there.

Lifecycle invariants:

- Active: `archived=false`, `archivedDate=null`.
- Archived: `archived=true`, `archivedDate` is present.
- Restoring records `restoredDate`; it does not rewrite historical occurrences.
- Timestamps are stored in an unambiguous machine-readable format.
- `habitsMap` is updated only after persistence succeeds.

## Daily occurrence ownership

Daily Notes own occurrence state. The target representation includes immutable
identity:

```md
- [x] [[Reading]] [habit-id:: habit-uuid] [habit:: true]
```

Supported states are declared in `DAILY_OCCURRENCE_STATES`. Statistics must
consume one centralized state resolver rather than infer states independently.

## Comments and reflections

Habit comments are date-bound events and therefore belong to Daily Notes:

```md
- 10:30 [habit-note-id:: habit-uuid] Comment text
```

Habit-note logs are legacy input during migration only. Reflections remain in
Daily Notes and are not mixed with habit comments.

## User-authored Markdown

- Frontmatter is plugin-managed.
- The habit note body is user-authored after initial creation.
- Updating habit properties must not rebuild or delete the note body.
- Automated sections require explicit stable boundaries if introduced later.

## Migration guarantees

Every migration must be versioned, idempotent, resumable, dry-run capable,
verified before completion, backed up or reversible, and explicit about
unresolved legacy records.

## Known contract violations in the current runtime

These are intentionally tested as expected failures until their approved stages:

- lifecycle fields are not round-tripped;
- scanner accepts unmarked checkboxes;
- comments have two persistence locations;
- rename UI references missing service methods;
- memory is updated before persistence is confirmed.

> [!NOTE]
> **Resolved Violations (v3.2.0):**
> * *Daily Note creation is coupled to auto-write:* Daily Note creation is now decoupled and delegated to Obsidian's official daily-notes/periodic-notes plugin API, ensuring templates are fully expanded by Obsidian before habits are written.
> * *Historical Integrity:* Auto-write on `file-open` is restricted to today and future notes, preventing silent modifications of older daily notes.
