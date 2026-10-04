# Reference Vault Scenarios

Fixtures under `tests/fixtures/` and mock suites serve as the regression and migration baseline.

| Scenario | Purpose | Test File |
|---|---|---|
| Active daily habit | Normal loading and completion | [`tests/HabitManager.test.js`](../../tests/HabitManager.test.js) |
| Weekly Arabic habit | Locale and schedule handling | [`tests/WeeklyGridView.test.js`](../../tests/WeeklyGridView.test.js) |
| Parent and child habits | Hierarchy, progress slots, and ordering | [`tests/HabitManager.test.js`](../../tests/HabitManager.test.js), [`tests/WeeklyGridView.test.js`](../../tests/WeeklyGridView.test.js) |
| Renamed habit | Historical-name compatibility (`name_history`) | [`tests/HabitSerialization.test.js`](../../tests/HabitSerialization.test.js) |
| Archived habit | Historical range and archive lifecycle | [`tests/HabitSerialization.test.js`](../../tests/HabitSerialization.test.js), [`tests/StatsService.test.js`](../../tests/StatsService.test.js) |
| Restored habit | Exclusion before restoration date | [`tests/StatsService.test.js`](../../tests/StatsService.test.js), [`tests/HabitSerialization.test.js`](../../tests/HabitSerialization.test.js) |
| Missing Daily Note | Missing-note policy (`streakBreakOnMissing`) | [`tests/StatsService.test.js`](../../tests/StatsService.test.js), [`tests/StatsEngine.test.js`](../../tests/StatsEngine.test.js) |
| Missing habit entry | Missing-entry policy and pre-creation ignore | [`tests/StatsService.test.js`](../../tests/StatsService.test.js) |
| Completed/skipped/pending entries | Task checkbox parsing | [`tests/HabitScanner.test.js`](../../tests/HabitScanner.test.js) |
| Legacy Daily Note comment | Migration of inline comments | [`tests/Migration.test.js`](../../tests/Migration.test.js) |
| Habit-note log comment | Migration and comment deduplication | [`tests/Migration.test.js`](../../tests/Migration.test.js), [`tests/HabitCommentRepository.test.js`](../../tests/HabitCommentRepository.test.js) |
| Arabic and English content | Locale-independent parsing & translations | [`tests/DiaryUI.test.js`](../../tests/DiaryUI.test.js), [`tests/WeeklyGridView.test.js`](../../tests/WeeklyGridView.test.js) |
| User-authored habit body | Content & engineering blockquote preservation | [`tests/HabitSerialization.test.js`](../../tests/HabitSerialization.test.js), [`tests/HabitNoteManager.test.js`](../../tests/HabitNoteManager.test.js) |
| Daily Notes integration | Guarded Daily Notes and Periodic Notes interfaces with a manual fallback | [`tests/Helpers.test.js`](../../tests/Helpers.test.js) |
| Fallback manual creation | Safe note creation and template variable parsing | [`tests/Helpers.test.js`](../../tests/Helpers.test.js) |
| Audio recording and playback | Web Audio API memo management | [`tests/AudioEngine.test.js`](../../tests/AudioEngine.test.js) |
| Statistics Domain Engine | Aggregate periods, metrics, and insights | [`tests/StatsEngine.test.js`](../../tests/StatsEngine.test.js) |
| Habit Modal UX & Form Validation | Tabs, schedule picker, levels, dirty state & lifecycle | [`tests/AddEditHabitModal.test.js`](../../tests/AddEditHabitModal.test.js) |
| Base Modal Architecture | Base modal lifecycle, tab switching, and keyboard navigation | [`tests/BaseHabitModal.test.js`](../../tests/BaseHabitModal.test.js) |
| Settings Tab Experience | Settings tab rendering, heading configurations, and language picker | [`tests/DailyHabitsSettingTab.test.js`](../../tests/DailyHabitsSettingTab.test.js) |
| Diary Day Section | Daily diary card rendering and reflection entry injection | [`tests/DiaryDaySection.test.js`](../../tests/DiaryDaySection.test.js) |
| Diary Journal Engine | Structured blocks, reflections, timeline parser | [`tests/DiaryParser.test.js`](../../tests/DiaryParser.test.js), [`tests/DiaryService.test.js`](../../tests/DiaryService.test.js) |
| Diary View Controller | Diary tab navigation, date synchronization, and view mode switching | [`tests/DiaryViewController.test.js`](../../tests/DiaryViewController.test.js) |
| Edit Habit Experience | Edit habit modal experience, blueprint editing, and lifecycle actions | [`tests/EditHabitExperience.test.js`](../../tests/EditHabitExperience.test.js) |
| Habit Comment Popup | Habit comment and reflection popup interaction and upserting | [`tests/HabitCommentPopup.test.js`](../../tests/HabitCommentPopup.test.js) |
| Localization Parity | 100% translation key parity between Arabic and English dictionaries | [`tests/Localization.test.js`](../../tests/Localization.test.js) |
| Progression Engine | Habit milestone progression, levels computation, and badge evaluation | [`tests/ProgressionEngine.test.js`](../../tests/ProgressionEngine.test.js) |
| Streak Calculation Engine | Current and longest streak calculation, grace periods, and invalidation | [`tests/StreakCalculator.test.js`](../../tests/StreakCalculator.test.js) |
| Tooltip Architecture | Custom tooltip creation, styling, and positioning | [`tests/TooltipArchitecture.test.js`](../../tests/TooltipArchitecture.test.js) |
| Voice Recorder Utility | Web Audio voice memo recording, timer formatting, and cleanup | [`tests/VoiceRecorderUtility.test.js`](../../tests/VoiceRecorderUtility.test.js) |
