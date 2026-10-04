# Core Habits Data Contract

Status: approved baseline for repository and migration work. This document defines
the canonical runtime persistence schema, data ownership, and markdown representations
implemented by the Core Habits plugin (Schema v3).

## Data ownership

| Data | Single source of truth | Notes |
|---|---|---|
| Habit definition and lifecycle | Habit note frontmatter | Addressed by immutable `habit_id` (Schema v3) |
| Habit display order | `Core Habits/_order.md` | Single portable source of truth managed by `VaultOrderStore`; cached in `data.json` |
| Daily completion/skip state | Matching Daily Note | One occurrence per habit and date |
| Habit comment | Matching Daily Note | Associated by `[habit-id:: id]`, not display name |
| Daily reflection | Matching Daily Note | Independent from habit comments, under reflection heading |
| In-memory habit map | Derived memory | Must be rebuildable from habit notes |
| Current level / milestones | Derived state | Calculated dynamically from `saved_longest_streak` via `ProgressionEngine` |
| Statistics | Derived cache | Must be rebuildable from source files |

No feature may introduce another writable source for the same data.

## Habit identity

- `habit_id` is immutable and globally unique (e.g. `habit-1715000000000-abc12345`).
- A display name is mutable and is never an identity key.
- File resolution must ultimately use `habit_id` (cached in index map).
- `name_history` is compatibility metadata, not identity.
- File basename corresponds to the sanitized habit name (`Habit Name.md`).

## Habit Note Structure & Canonical Fields

Habit files live in `{habitNotesFolder}/Active/` or `{habitNotesFolder}/Archive/`.

The executable contract declaration is
[`src/domain/HabitDataContract.js`](../../src/domain/HabitDataContract.js) and
[`src/domain/HabitEntity.js`](../../src/domain/HabitEntity.js).

### Managed YAML Frontmatter Properties (Schema v3)

```yaml
---
schema_version: 3
habit_id: habit-1715000000000-abc12345
created_at: 1715000000000
archived: false
archived_at: null
restored_at: null
habit_type: build
color: teal
schedule: daily
parent_id: null
name_history:
  - Previous Name
saved_longest_streak: 14
identity: I am a consistent reader
cue: After morning coffee
friction: Keep the book on the pillow
reward: Favorite warm tea
level_1_goal: Read 2 pages daily
level_1_condition: Reach 7-day streak
level_1_achieved: true
notes: Optional short notes
---
```

### Schema v3 Invariants

- Canonical schema version is `schema_version: 3`.
- `order` is strictly stored in `Core Habits/_order.md` (`VaultOrderStore`); it is never written to habit note frontmatter.
- `current_level` is derived state; it is never written to habit note frontmatter (dynamically computed from `saved_longest_streak` and milestones by `ProgressionEngine`).
- Legacy properties (`goal`, `days`, `order`) are removed during v3 migration and never rewritten.
- Updating habit note properties is performed via Obsidian's native `app.fileManager.processFrontMatter()` API to preserve any custom user-added frontmatter properties.

### Habit Note Body Structure

The body of a habit note is user-authored and preserved across updates:
1. Embed block:
   ````markdown
   ```core-habits
   ```
   ````
2. Habit Engineering Callout (`> [!info] تصميم العادة` / `> [!info] Habit Design`).
3. Free-space blockquote notes section (`> **مساحة حرة للتدوين:**` / `> **Free Space for Notes:**`).
   - If frontmatter lacks `notes`, `HabitEntity.extractNotesFromBody()` extracts the text from this section.
   - Updating habit properties must never rebuild or delete the note body.

## Daily occurrence ownership

Daily Notes own occurrence state. `HabitManager.ensureHabitsInNote` writes checkboxes using the immutable `habit_id`:

```md
- [x] [[Reading]] [habit:: habit-uuid]
```

Or with a custom configured marker (e.g. `#habit`):
```md
- [x] [[Reading]] #habit [habit:: habit-uuid]
```

### Supported Occurrence Checkbox States
- `completed`: `- [x] [[Reading]] [habit:: habit-uuid]`
- `skipped` (excused): `- [-] [[Reading]] [habit:: habit-uuid]`
- `pending` / `uncompleted`: `- [ ] [[Reading]] [habit:: habit-uuid]`

### Compatibility Parsers (`HabitScanner`)
For older vaults and external edits, `HabitScanner` also accepts:
- `- [x] [[Reading]] [habit-id:: habit-uuid]`
- `- [x] [[Reading]] [habit:: true]` (resolved by link text and `name_history`)
- `- [x] [[Reading]] #habit`

Supported states are declared in `DAILY_OCCURRENCE_STATES`. Statistics consume the centralized state resolver rather than inferring states independently.

## Comments and reflections

Habit comments and daily reflections are date-bound events stored exclusively inside **Daily Notes**.

### Habit Comments Format
Written by `HabitCommentRepository`:
```md
- 10:30 [habit-id:: habit-uuid] [habit-note:: Reading] [[Reading]] - Completed chapter 4 today
```
- Stored under the configured `habitLogHeading` (default: `### 💬 ملاحظات العادات` / `### 💬 Habit Log`).
- Candidate headings and history are checked before insertion to prevent duplicate headings.

### Daily Reflections Format
Managed by `DiaryService`:
```md
- 21:00 [type:: Good] Had a productive day focusing on core tasks
```
- Stored under the configured `reflectionHeading` (default: `### 📝 تدوينات اليوم` / `### 📝 Daily Reflections`).
- Supported types: `Good`, `Bad`, `Lesson`, `Idea`.

## Migration guarantees

Migrations are idempotent and atomic:
- Pre-migration backups are created in `Core Habits/.backups/` before files are modified.
- Legacy parsers retain support for legacy v1/v2 frontmatter, legacy inline tags, and old log formats.
- Vault display orders in legacy frontmatter are consolidated into `_order.md`.

## Runtime Concurrency & Lifecycle Status

- Internal vault writes lock on specific file paths (`runWithLock(fn, targetPaths)`), preventing internal file modification races without blocking external sync (Obsidian Sync, Git).
- External file creations and modifications trigger explicit metadata synchronization and stats rescans.
- All toasts and user alerts are unified through `NoticeService`, ensuring consistent RTL/LTR text direction and design system styling.
