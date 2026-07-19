import { Setting } from 'obsidian';
import { DEFAULT_SETTINGS, DEFAULT_HABIT_NOTES_HEADING, DEFAULT_REFLECTION_HEADING, VIEW_TYPE_WEEKLY } from '../../constants.js';
import { getDailyNotesInfo } from '../../utils/helpers.js';

export class AdvancedPanel {
  constructor(plugin, settingsTab) {
    this.plugin = plugin;
    this.settingsTab = settingsTab;
    this.app = plugin.app;
  }

  async saveAndRefresh(settingsKey, value, container, t, reRenderSettings = false) {
    this.plugin.settings[settingsKey] = value;
    await this.plugin.saveSettings();
    if (reRenderSettings) {
      this.render(container, t);
    }
    this.app.workspace.getLeavesOfType(VIEW_TYPE_WEEKLY).forEach((leaf) => {
      if (leaf.view && typeof leaf.view.refresh === "function") leaf.view.refresh();
    });
  }

  render(container, t) {
    container.empty();

    container.createDiv({
      cls: "dh-settings-section-header",
      text: t("settings_formatting_heading"),
    });

    new Setting(container)
      .setName(t("settings_daily_parent_heading"))
      .setDesc(t("settings_daily_parent_heading_desc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.dailyParentHeading)
          .setValue(this.plugin.settings.dailyParentHeading)
          .onChange(async (value) => {
            await this.saveAndRefresh("dailyParentHeading", value || DEFAULT_SETTINGS.dailyParentHeading, container, t);
          })
      );

    new Setting(container)
      .setName(t("habit_section_heading"))
      .setDesc(t("habit_section_heading_desc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.habitHeading)
          .setValue(this.plugin.settings.habitHeading)
          .onChange(async (value) => {
            await this.saveAndRefresh("habitHeading", value || DEFAULT_SETTINGS.habitHeading, container, t);
          })
      );

    new Setting(container)
      .setName(t("auto_write_habits"))
      .setDesc(t("auto_write_habits_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoWriteHabits)
          .onChange(async (value) => {
            await this.saveAndRefresh("autoWriteHabits", value, container, t, true);
          })
      );

    if (this.plugin.settings.autoWriteHabits) {
      new Setting(container)
        .setName(t("settings_sync_startup_delay"))
        .setDesc(t("settings_sync_startup_delay_desc"))
        .addSlider((slider) =>
          slider
            .setLimits(0, 60, 5)
            .setValue(this.plugin.settings.syncStartupDelay ?? 15)
            .setDynamicTooltip()
            .onChange(async (value) => {
              await this.saveAndRefresh("syncStartupDelay", value, container, t);
            })
        );
    }

    container.createDiv({
      cls: "dh-settings-section-header",
      text: t("settings_other_heading"),
    });

    const dailyNotesInfo = getDailyNotesInfo(this.app, this.plugin.settings);
    const advancedDailyNotes = container.createDiv({ cls: "dh-advanced-settings-block dh-daily-notes-info" });
    
    advancedDailyNotes.createEl("h4", { text: t("settings_advanced_notes_toggle"), cls: "dh-settings-block-title" });
    
    const dailyNotesContainer = advancedDailyNotes.createDiv();
    const sourceLabels = {
      "daily-notes": { icon: "✅", label: t("settings_source_daily") },
      "periodic-notes": { icon: "✅", label: t("settings_source_periodic") },
      "manual": { icon: "⚙️", label: t("settings_source_manual") },
      "defaults": { icon: "⚠️", label: t("settings_source_defaults") },
    };
    const src = sourceLabels[dailyNotesInfo.source] || sourceLabels["defaults"];

    new Setting(dailyNotesContainer)
      .setName(t("settings_daily_integration"))
      .setDesc(`${src.icon} ${src.label}`)
      .then((setting) => {
        if (dailyNotesInfo.source === "daily-notes" || dailyNotesInfo.source === "periodic-notes") {
          const detailsDiv = setting.descEl.createDiv({ cls: "dh-daily-notes-details" });
          if (dailyNotesInfo.folder) detailsDiv.createSpan({ text: t("settings_daily_folder_label", { folder: dailyNotesInfo.folder }) });
          if (dailyNotesInfo.format) {
            detailsDiv.createEl("br");
            detailsDiv.createSpan({ text: t("settings_daily_format_label", { format: dailyNotesInfo.format }) });
          }
          if (dailyNotesInfo.template) {
            detailsDiv.createEl("br");
            detailsDiv.createSpan({ text: t("settings_daily_template_label", { template: dailyNotesInfo.template }) });
          }
        }
      });

    new Setting(dailyNotesContainer)
      .setName(t("settings_source_label"))
      .setDesc(t("settings_source_desc"))
      .addDropdown((dd) =>
        dd
          .addOption("auto", t("settings_source_auto"))
          .addOption("manual", t("settings_source_manual_opt"))
          .setValue(this.plugin.settings.dailyNotesSource)
          .onChange(async (value) => {
            await this.saveAndRefresh("dailyNotesSource", value, container, t, true);
          })
      );

    if (this.plugin.settings.dailyNotesSource === "manual" || dailyNotesInfo.source === "defaults") {
      new Setting(dailyNotesContainer)
        .setName(t("settings_daily_folder"))
        .setDesc(t("settings_daily_folder_desc"))
        .addText((text) =>
          text
            .setPlaceholder("Cycles/Daily Notes")
            .setValue(this.plugin.settings.dailyNotesFolder)
            .onChange(async (value) => {
              await this.saveAndRefresh("dailyNotesFolder", value.trim(), container, t);
            })
        );

      new Setting(dailyNotesContainer)
        .setName(t("settings_daily_format"))
        .setDesc(t("settings_daily_format_desc"))
        .addText((text) =>
          text
            .setPlaceholder("YYYY-MM-DD")
            .setValue(this.plugin.settings.dateFormat)
            .onChange(async (value) => {
              await this.saveAndRefresh("dateFormat", value.trim() || "YYYY-MM-DD", container, t);
            })
        );
    }

    new Setting(dailyNotesContainer)
      .setName(t("settings_daily_locale"))
      .setDesc(t("settings_daily_locale_desc"))
      .addDropdown((dd) =>
        dd
          .addOption("obsidian", t("settings_daily_locale_obsidian"))
          .addOption("en", t("settings_daily_locale_en"))
          .addOption("fr", t("settings_daily_locale_fr"))
          .addOption("ar", t("settings_daily_locale_ar"))
          .setValue(this.plugin.settings.dailyNotesLocale || "obsidian")
          .onChange(async (value) => {
            await this.saveAndRefresh("dailyNotesLocale", value, container, t);
          })
      );

    container.createDiv({
      cls: "dh-settings-section-header",
      text: t("settings_habit_context_heading"),
    });

    new Setting(container)
      .setName(t("enable_habit_context"))
      .setDesc(t("enable_habit_context_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableHabitContext ?? true)
          .onChange(async (value) => {
            await this.saveAndRefresh("enableHabitContext", value, container, t, true);
          })
      );

    if (this.plugin.settings.enableHabitContext) {
      new Setting(container)
        .setName(t("habit_log_heading"))
        .setDesc(t("habit_log_heading_desc"))
        .addText((text) =>
          text
            .setPlaceholder(DEFAULT_SETTINGS.habitLogHeading || DEFAULT_HABIT_NOTES_HEADING)
            .setValue(this.plugin.settings.habitLogHeading)
            .onChange(async (value) => {
              const cleanVal = value.trim() || DEFAULT_SETTINGS.habitLogHeading || DEFAULT_HABIT_NOTES_HEADING;
              await this.saveAndRefresh("habitLogHeading", cleanVal, container, t);
            })
        );
    }

    container.createDiv({
      cls: "dh-settings-section-header",
      text: t("settings_journal_heading"),
    });

    new Setting(container)
      .setName(t("enable_reflection_journal"))
      .setDesc(t("enable_reflection_journal_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableReflectionJournal ?? true)
          .onChange(async (value) => {
            await this.saveAndRefresh("enableReflectionJournal", value, container, t, true);
          })
      );

    if (this.plugin.settings.enableReflectionJournal) {
      new Setting(container)
        .setName(t("reflection_heading"))
        .setDesc(t("reflection_heading_desc"))
        .addText((text) =>
          text
            .setPlaceholder(DEFAULT_SETTINGS.reflectionHeading || DEFAULT_REFLECTION_HEADING)
            .setValue(this.plugin.settings.reflectionHeading)
            .onChange(async (value) => {
              const cleanVal = value.trim() || DEFAULT_SETTINGS.reflectionHeading || DEFAULT_REFLECTION_HEADING;
              await this.saveAndRefresh("reflectionHeading", cleanVal, container, t);
            })
        );
    }
  }
}
