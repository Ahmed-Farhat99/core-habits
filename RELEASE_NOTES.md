# Core Habits v3.3.0 🚀

This release introduces major architectural and mobile user experience improvements:

### ⚙️ Reactive Stats Indexing
- **In-Memory Cache Map**: Introduced a non-blocking background index that scans daily note completions asynchronously at startup, eliminating lag.
- **Event-Driven Rescan**: Registered metadata changes and vault delete listeners to scan individual daily note files dynamically and keep the lifetime stats count 100% accurate, even when editing daily notes manually in the editor or syncing.
- **Improved Dashboard UI**: Replaced the big "Calculate" button with automatic calculations and a mini `🔄` reload button inside the card subtitle for manual re-indexing.

### 📱 Specificity-Based Mobile Styling
- **Compact Modals**: Reduced modal action button heights from `46px` to `38px`, font-size from `1em` to `0.9em`, and padding from `14px 16px` to `10px 12px` for a cleaner look.
- **Stacked Split Footer**: Stacked the Reflection Modal's voice record button and save/cancel buttons vertically on mobile screens so they don't squish horizontally.
- **No More Nested Scrollbars**: Set `height: auto` and `overflow: visible` on all inner view content containers so that mobile vertical scrolling is handled natively by the parent leaf.
- **Clean CSS Override**: Used specific `body.is-mobile` class-prefix selectors instead of `!important` overrides, preserving CSS specificity and clean styling rules.
