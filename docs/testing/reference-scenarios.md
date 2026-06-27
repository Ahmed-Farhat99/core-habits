# Reference Vault Scenarios

Fixtures under `tests/fixtures/reference-vault` are the regression and migration
baseline. Tests that mutate data must copy them to a temporary directory.

| Scenario | Purpose |
|---|---|
| Active daily habit | Normal loading and completion |
| Weekly Arabic habit | Locale and schedule handling |
| Parent and child habits | Hierarchy and ordering |
| Renamed habit | Historical-name compatibility |
| Archived habit | Historical range and archive lifecycle |
| Restored habit | Exclusion before restoration |
| Missing Daily Note | Missing-note policy |
| Missing habit entry | Missing-entry policy |
| Completed/skipped/pending entries | State parsing |
| Legacy Daily Note comment | Legacy comment migration |
| Habit-note log comment | Duplicate-source migration |
| Arabic and English content | Locale-independent parsing |
| Custom daily-note folder | Manual integration |
| User-authored habit body | Content preservation |
| Duplicate/missing habit IDs | Integrity diagnostics |
| Active/archive name collision | File-resolution diagnostics |
| Daily Notes API Integration | Delegation to official daily-notes and periodic-notes plugins |
| Fallback manual creation | Safe raw note creation and template variable parsing |

The expected inventory is recorded in the fixture manifest. Deliberately invalid
files are part of the baseline and must be diagnosed rather than silently loaded.

