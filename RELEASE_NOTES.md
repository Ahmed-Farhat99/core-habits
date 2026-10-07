# Core Habits 3.5.4

This release delivers the permanent fix for audio recording duration metadata across Android, Desktop, and iOS, restores hierarchical block integrity when reordering parent habits, and enhances vault order persistence.

## Key Highlights & Improvements

### 🎙️ Audio Recording & Duration Architecture
- **Injected EBML Duration Metadata**: Newly captured voice recordings now have accurate duration metadata injected directly into the WebM container via `fix-webm-duration` at recording completion. Obsidian's audio player now immediately displays the exact duration (e.g. `00:20`) instead of `Infinity` or blank timelines.
- **Android & Mobile Playback Stability**: Completely eliminated the legacy `1e101` seeking workaround that caused Chromium/Android webviews to latch onto device uptime or cluster timestamps (previously displaying 18+ hours). Seeking, pausing, and replaying now behave predictably.
- **Legacy Recording Graceful Playback**: Existing recordings without EBML metadata now stream naturally without seeking glitch loops or UI hangs.
- **RTL/LTR Audio Player Hygiene**: Added explicit `dir="ltr"` on all audio player wrappers to prevent inverted scrubber or volume slider glitches in Arabic interfaces.
- **Leak-Free Resource Cleanup**: Disconnecting or closing the recording modal immediately aborts media tracks and frees the hardware microphone, preventing orphan audio attachments.

### 🌳 Hierarchical Habit Reordering & Order Stability
- **Block-Preserving Parent Reordering**: Moving a top-level parent habit up or down now moves the entire family block (parent + all child sub-habits) together, eliminating parent-child hierarchy fragmentation.
- **Archive Position Preservation**: Restoring an archived habit now restores it to its exact original slot if previously present in `_order.md`.
- **Robust `_order.md` Parsing**: Added a regex fallback parser for `_order.md` in headless and test environments where `window.parseYaml` is absent.

### 📱 Diary & Mobile View Refinements
- **HTML5 Compliant Accordion Summary**: Moved the "+ Note" button out of the `<summary>` element in Diary day sections into an absolute logically positioned end-cluster (`inset-inline-end`), preventing disallowed interactive element conflicts while maintaining seamless RTL and LTR support.
- **Mobile Touch Targets**: Enlarged modal button hit areas (`touch-action: manipulation`, min-height 38px) on mobile viewports.

---

## Verification & Release Checklist

1. `npm ci` completes cleanly with exact reproducible lockfile resolution.
2. `npm run lint` and `npm run typecheck` pass with zero errors and zero warnings.
3. `npm run ui:check` confirms CSS token compliance across 14 files and 125 properties.
4. All 61 test files (724 tests) in `npm run test:run` pass with 100% compliance.
5. `npm run build` produces verified production assets matching the root directory.
6. `npm run release:check` passes with full version coherence across all metadata descriptors.
