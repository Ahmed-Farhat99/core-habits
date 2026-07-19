import { Setting, Notice } from 'obsidian';
import { VIEW_TYPE_WEEKLY } from '../../constants.js';
import { StreakCalculator } from '../../services/StreakCalculator.js';
import { Utils } from '../../utils/Utils.js';

export class BasicsPanel {
  constructor(plugin, settingsTab) {
    this.plugin = plugin;
    this.settingsTab = settingsTab;
    this.app = plugin.app;
  }

  render(container, t) {
    container.empty();
    
    new Setting(container)
      .setName(t("language"))
      .setDesc(t("language_desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("ar", "العربية")
          .addOption("en", "English")
          .addOption("fr", "Français")
          .setValue(this.plugin.settings.language || "en")
          .onChange(async (value) => {
            this.plugin.settings.language = value;
            await this.plugin.saveSettings();
            if (this.plugin.localizeHabitNoteTemplatesForLanguage) {
              await this.plugin.localizeHabitNoteTemplatesForLanguage(value);
            }
            this.settingsTab.display(); // Full re-render needed for language change
            this.app.workspace.getLeavesOfType(VIEW_TYPE_WEEKLY).forEach((leaf) => {
              if (leaf.view && typeof leaf.view.refresh === "function") leaf.view.refresh();
            });
          })
      );

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
                  const oldFolder = this.app.vault.getAbstractFileByPath(oldRoot);
                  if (oldFolder) {
                    await this.app.fileManager.renameFile(oldFolder, newRoot);
                    new Notice(t("settings_folder_moved_success"));
                  } else {
                    await this.plugin.habitNoteManager.ensureFolders();
                  }

                  this.plugin.settings.habitNotesFolder = newRoot;
                  await this.plugin.saveSettings();

                  await this.plugin.habitManager.initialize();
                  this.settingsTab.refreshUI();
                  this.app.workspace.getLeavesOfType(VIEW_TYPE_WEEKLY).forEach((leaf) => {
                    if (leaf.view && typeof leaf.view.refresh === "function") leaf.view.refresh();
                  });
                } catch (e) {
                  console.error("Folder move error:", e);
                  new Notice(t("settings_folder_move_error"));
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

    new Setting(container)
      .setName(t("show_count"))
      .setDesc(t("show_count_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showCount)
          .onChange(async (value) => {
            this.plugin.settings.showCount = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName(t("hide_year"))
      .setDesc(t("settings_hide_year_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.hideYear)
          .onChange(async (value) => {
            this.plugin.settings.hideYear = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName(t("streak_break_on_missing"))
      .setDesc(t("streak_break_on_missing_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.streakBreakOnMissing)
          .onChange(async (value) => {
            this.plugin.settings.streakBreakOnMissing = value;
            await this.plugin.saveSettings();
            StreakCalculator.invalidateAll();
            this.app.workspace.getLeavesOfType(VIEW_TYPE_WEEKLY).forEach((leaf) => {
              if (leaf.view) {
                leaf.view._lastFourWeeksCache = null;
                leaf.view.lastWeekRatesCache = null;
                if (typeof leaf.view.refresh === "function") leaf.view.refresh();
              }
            });
          })
      );

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
            this.plugin.settings.weekStartDay = Number(value);
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName(t("open_reminder"))
      .setDesc(t("open_reminder_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableOpenReminder ?? true)
          .onChange(async (value) => {
            this.plugin.settings.enableOpenReminder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName(t("settings_missed_days_notice"))
      .setDesc(t("settings_missed_days_notice_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableMissedDaysNotice ?? true)
          .onChange(async (value) => {
            this.plugin.settings.enableMissedDaysNotice = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName(t("enable_sound"))
      .setDesc(t("enable_sound_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableSound ?? true)
          .onChange(async (value) => {
            this.plugin.settings.enableSound = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName(t("show_hijri_date"))
      .setDesc(t("show_hijri_date_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showHijriDate ?? true)
          .onChange(async (value) => {
            this.plugin.settings.showHijriDate = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
