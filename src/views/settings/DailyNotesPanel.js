import { Setting } from 'obsidian';
import { NoticeService } from '../../services/NoticeService.js';
import { DEFAULT_SETTINGS } from '../../constants.js';
import { getDailyNotesInfo } from '../../utils/helpers.js';
import { persistSetting } from './persistSetting.js';

export class DailyNotesPanel {
  constructor(plugin, settingsTab) {
    this.plugin = plugin;
    this.settingsTab = settingsTab;
    this.app = plugin.app;
  }

  async saveAndRefresh(settingsKey, value, container, t, reRenderSettings = false) {
    try {
      await persistSetting(this.plugin, settingsKey, value);
    } catch (error) {
      this.render(container, t);
      NoticeService.error(this.plugin.translationManager.t("notice_error_prefix", { message: error.message }), this.plugin);
      return false;
    }
    if (reRenderSettings) {
      this.render(container, t);
    }
    this.plugin.refreshWeeklyViews();
    return true;
  }

  bindCommittedText(text, { key, fallback = "", historyKey = null }) {
    const input = text.inputEl;
    const commit = async () => {
      const value = input.value.trim() || fallback;
      const previous = this.plugin.settings[key];
      if (value === previous) return;
      try {
        await persistSetting(this.plugin, key, value, { historyKey });
        this.plugin.refreshWeeklyViews();
      } catch (error) {
        text.setValue(previous ?? "");
        NoticeService.error(this.plugin.translationManager.t("notice_error_prefix", { message: error.message }), this.plugin);
      }
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
  }

  render(container, t) {
    container.empty();

    // ─── 1. الاتصال بالملاحظات اليومية (Daily Notes Connection & Detection) ───
    container.createDiv({
      cls: "dh-settings-section-header",
      text: t("settings_other_heading"),
    });

    const dailyNotesInfo = getDailyNotesInfo(this.app, this.plugin.settings);
    const sourceLabels = {
      "daily-notes": { icon: "✅", label: t("settings_source_daily") },
      "periodic-notes": { icon: "✅", label: t("settings_source_periodic") },
      "manual": { icon: "⚙️", label: t("settings_source_manual") },
      "defaults": { icon: "⚠️", label: t("settings_source_defaults") },
    };
    const src = sourceLabels[dailyNotesInfo.source] || sourceLabels["defaults"];

    new Setting(container)
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

    const isManualMode = this.plugin.settings.dailyNotesSource === "manual" || dailyNotesInfo.source === "defaults";

    if (!isManualMode) {
      new Setting(container)
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
    } else {
      new Setting(container)
        .setName(t("settings_daily_folder"))
        .setDesc(t("settings_daily_folder_desc"))
        .addText((text) => {
          text
            .setPlaceholder("Cycles/Daily Notes")
            .setValue(this.plugin.settings.dailyNotesFolder);
          this.bindCommittedText(text, { key: "dailyNotesFolder" });
        });

      new Setting(container)
        .setName(t("settings_daily_format"))
        .setDesc(t("settings_daily_format_desc"))
        .addText((text) => {
          text
            .setPlaceholder("YYYY-MM-DD")
            .setValue(this.plugin.settings.dateFormat);
          this.bindCommittedText(text, { key: "dateFormat", fallback: "YYYY-MM-DD" });
        });
    }

    // ─── 2. أقسام وعناوين اليومية (Daily Note Sections & Headings) ───
    container.createDiv({
      cls: "dh-settings-section-header",
      text: t("settings_formatting_heading"),
    });

    new Setting(container)
      .setName(t("settings_daily_parent_heading"))
      .setDesc(t("settings_daily_parent_heading_desc"))
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.dailyParentHeading)
          .setValue(this.plugin.settings.dailyParentHeading ?? "");
        this.bindCommittedText(text, { key: "dailyParentHeading", historyKey: "dailyParentHeadingHistory" });
      });

    new Setting(container)
      .setName(t("habit_section_heading"))
      .setDesc(t("habit_section_heading_desc"))
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.habitHeading)
          .setValue(this.plugin.settings.habitHeading);
        this.bindCommittedText(text, { key: "habitHeading", fallback: DEFAULT_SETTINGS.habitHeading, historyKey: "habitHeadingHistory" });
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
        .addText((text) => {
          text
            .setPlaceholder(DEFAULT_SETTINGS.habitLogHeading)
            .setValue(this.plugin.settings.habitLogHeading);
          this.bindCommittedText(text, { key: "habitLogHeading", fallback: DEFAULT_SETTINGS.habitLogHeading, historyKey: "habitLogHeadingHistory" });
        });
    }

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
        .addText((text) => {
          text
            .setPlaceholder(DEFAULT_SETTINGS.reflectionHeading)
            .setValue(this.plugin.settings.reflectionHeading);
          this.bindCommittedText(text, { key: "reflectionHeading", fallback: DEFAULT_SETTINGS.reflectionHeading, historyKey: "reflectionHeadingHistory" });
        });
    }

    // ─── 3. سلوك الكتابة والمزامنة (Auto-Write & Sync Behavior) ───
    container.createDiv({
      cls: "dh-settings-section-header",
      text: t("settings_sync_behavior_heading"),
    });

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

    // ─── 4. الصيانة والأداء (Maintenance & Performance) ───
    container.createDiv({
      cls: "dh-settings-section-header",
      text: t("settings_maintenance_heading"),
    });

    new Setting(container)
      .setName(t("settings_recalculate_lifetime"))
      .setDesc(t("settings_recalculate_lifetime_desc"))
      .addButton((btn) =>
        btn
          .setButtonText(t("stats_calculate_btn"))
          .onClick(async () => {
            btn.setDisabled(true);
            btn.setButtonText("⏳ ...");
            try {
              const total = await this.plugin.statsService.initLifetimeIndex(true);
              NoticeService.success(`${t("stats_lifetime_achievements")}: ${total ?? this.plugin.settings.lifetimeCompleted}`, this.plugin);
            } catch (e) {
              NoticeService.error(e.message, this.plugin);
            } finally {
              btn.setDisabled(false);
              btn.setButtonText(t("stats_calculate_btn"));
            }
          })
      );
  }
}
