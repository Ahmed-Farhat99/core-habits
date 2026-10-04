import { Setting } from 'obsidian';
import { NoticeService } from '../../services/NoticeService.js';
import { StreakCalculator } from '../../services/StreakCalculator.js';
import { Utils } from '../../utils/Utils.js';
import { persistSetting } from './persistSetting.js';

export class BasicsPanel {
  constructor(plugin, settingsTab) {
    this.plugin = plugin;
    this.settingsTab = settingsTab;
    this.app = plugin.app;
  }

  async saveSetting(key, value, { rerender = false, refresh = true } = {}) {
    try { await persistSetting(this.plugin, key, value); }
    catch (error) {
      this.settingsTab.display();
      NoticeService.error(this.plugin.translationManager.t("notice_error_prefix", { message: error.message }), this.plugin);
      return false;
    }
    if (rerender) this.settingsTab.display();
    if (refresh) this.plugin.refreshWeeklyViews();
    return true;
  }

  render(container, t) {
    container.empty();

    // ─── Group 1: Display & Interface ───
    container.createDiv({
      cls: "dh-settings-section-header",
      text: t("settings_group_display")
    });

    // Language
    new Setting(container)
      .setName(t("language"))
      .setDesc(t("language_desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("ar", "العربية")
          .addOption("en", "English")
          .setValue(this.plugin.settings.language || "ar")
          .onChange(async (value) => {
            await this.saveSetting("language", value, { rerender: true });
          })
      );

    // Show count
    new Setting(container)
      .setName(t("show_count"))
      .setDesc(t("show_count_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showCount)
          .onChange(async (value) => {
            await this.saveSetting("showCount", value);
          })
      );

    // Hide year
    new Setting(container)
      .setName(t("hide_year"))
      .setDesc(t("settings_hide_year_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.hideYear)
          .onChange(async (value) => {
            await this.saveSetting("hideYear", value);
          })
      );

    // Show Hijri date
    new Setting(container)
      .setName(t("show_hijri_date"))
      .setDesc(t("show_hijri_date_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showHijriDate ?? true)
          .onChange(async (value) => {
            await this.saveSetting("showHijriDate", value);
          })
      );

    // ─── Group 2: Storage & Files ───
    container.createDiv({
      cls: "dh-settings-section-header",
      text: t("settings_group_storage")
    });

    // Habit Notes Folder
    new Setting(container)
      .setName(t("settings_habits_folder"))
      .setDesc(t("settings_habits_folder_desc"))
      .addText((text) => {
        text
          .setPlaceholder("Core Habits")
          .setValue(this.plugin.settings.habitNotesFolder || "Core Habits");

        text.inputEl.addEventListener("blur", async () => {
          const oldRoot = this.plugin.settings.habitNotesFolder || "Core Habits";
          const newRoot = text.getValue().trim() || "Core Habits";
          if (oldRoot === newRoot) return;

          Utils.showConfirmNotice(
            this.app,
            this.plugin,
            t("settings_move_folder_confirm", { oldRoot, newRoot }),
            {
              confirmText: t("yes_sure"),
              cancelText: t("cancel"),
              onConfirm: async () => {
                try {
                  await this.plugin.habitNoteManager.moveRootFolder(newRoot);
                  this.plugin.habitManager.invalidateCaches();
                  this.settingsTab.refreshUI();
                  this.plugin.refreshWeeklyViews();
                  NoticeService.success(t("settings_folder_moved_success"), this.plugin);
                } catch (e) {
                  console.error("Folder move error:", e);
                  NoticeService.error(t("settings_folder_move_error"), this.plugin);
                  text.setValue(oldRoot);
                }
              },
              onCancel: () => {
                text.setValue(oldRoot);
              }
            }
          );
        });
      });

    // ─── Group 3: Schedule & Notifications ───
    container.createDiv({
      cls: "dh-settings-section-header",
      text: t("settings_group_schedule")
    });

    // Week start day
    new Setting(container)
      .setName(t("week_start"))
      .setDesc(t("week_start_desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("6", t("sat"))
          .addOption("0", t("sun"))
          .addOption("1", t("mon"))
          .addOption("2", t("tue"))
          .addOption("3", t("wed"))
          .addOption("4", t("thu"))
          .addOption("5", t("fri"))
          .setValue(String(this.plugin.settings.weekStartDay))
          .onChange(async (value) => {
            await this.saveSetting("weekStartDay", Number(value));
          })
      );

    // Streak break on missing note
    new Setting(container)
      .setName(t("streak_break_on_missing"))
      .setDesc(t("streak_break_on_missing_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.streakBreakOnMissing)
          .onChange(async (value) => {
            if (await this.saveSetting("streakBreakOnMissing", value)) StreakCalculator.invalidateAll();
          })
      );

    // Reminder on open
    new Setting(container)
      .setName(t("open_reminder"))
      .setDesc(t("open_reminder_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableOpenReminder ?? true)
          .onChange(async (value) => {
            await this.saveSetting("enableOpenReminder", value, { refresh: false });
          })
      );

    // Missed days notice
    new Setting(container)
      .setName(t("settings_missed_days_notice"))
      .setDesc(t("settings_missed_days_notice_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableMissedDaysNotice ?? true)
          .onChange(async (value) => {
            await this.saveSetting("enableMissedDaysNotice", value, { refresh: false });
          })
      );

    // Enable sound
    new Setting(container)
      .setName(t("enable_sound"))
      .setDesc(t("enable_sound_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableSound ?? true)
          .onChange(async (value) => {
            await this.saveSetting("enableSound", value, { refresh: false });
          })
      );
  }
}
