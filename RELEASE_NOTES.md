# Core Habits 3.5.0

This release focuses on safer vault writes, consistent state and statistics, and a more maintainable codebase.

## Changes

- Habit note changes preserve the existing body and update owned frontmatter fields through Obsidian's file manager. Migration backs up affected notes before changing them and retains readers for older data formats.
- Daily checklist, comment, and reflection writes use the current Daily Note content. Date detection respects the configured Daily Notes folder and format.
- Statistics and cache invalidation share the same Daily Note detection path and rebuild from vault files after restart.
- Pending renders, timers, and service resources are guarded during view close and plugin unload. Disabling the plugin no longer detaches the user's open weekly view.
- The codebase now has narrower UI contexts, a centralized journal service, focused statistics modules, and incremental `checkJs` coverage.
- The release workflow runs tests, lint, type checking, build, and metadata and asset validation before creating a draft release.

## Before publishing

Verify in a backed-up test vault on desktop and mobile: existing habit migrations, custom Daily Notes templates and folders, habit toggles and comments, statistics after restart, audio recording, and plugin disable/re-enable. The automated suite cannot replace these Obsidian runtime checks.
