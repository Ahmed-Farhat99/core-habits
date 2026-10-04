# Obsidian compatibility checklist

Source version: 3.5.0. The manifest declares Obsidian 1.7.0 as the minimum and `isDesktopOnly: false`. This is a support target, not a record of completed device testing.

## Integration boundaries

- Plugin lifecycle, views, commands, settings, vault reads and writes, and frontmatter updates use Obsidian APIs in `src/main.js`, `src/views/`, and `src/services/`.
- Daily Notes discovery in `src/utils/helpers.js` first checks the guarded internal Daily Notes plugin interface, then Periodic Notes, then the manual folder and format settings. These interfaces can change between Obsidian releases. A date-like filename outside the configured Daily Notes folder must not be treated as a Daily Note.
- Habit note updates use `fileManager.processFrontMatter`. A newly created habit note starts with an empty YAML block and receives its properties afterward. Existing note bodies are not rebuilt during property updates.
- Daily Note checklist and journal changes use vault processing and only update the plugin-owned entry or section. They must preserve adjacent user text.
- The plugin creates its own UI under `.daily-habits-plugin`; its CSS tokens and theme overrides should remain scoped to that class.

## Manual release matrix

- [ ] Desktop: light and dark themes, Arabic and English, weekly grid, diary, statistics, settings, and modal keyboard navigation.
- [ ] Mobile: narrow layouts, touch controls, on-screen keyboard, audio permission/recording, and unload/re-enable.
- [ ] Daily Notes: core plugin, Periodic Notes, manual folder and format, custom template, missing note, and date-like file outside the configured folder.
- [ ] Data safety: existing frontmatter and user body survive habit edit, rename, archive, restore, migration, checklist toggle, and comment edit.
- [ ] Sync and lifecycle: restart with a populated vault, rapid toggles, external file edits, plugin disable/re-enable, and a failed migration.
- [ ] Console: no uncaught errors or deprecated API failures on the intended minimum and current Obsidian versions.

See the [official plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) and [submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin) before publishing.
