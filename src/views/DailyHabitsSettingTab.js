import { PluginSettingTab, Setting, Notice, Modal, setIcon } from 'obsidian';
import { Utils } from '../utils/Utils.js';
import { HABIT_COLORS_PALETTE, DEFAULT_MARKER, VIEW_TYPE_WEEKLY, DAY_KEYS, DEFAULT_HABIT_NOTES_HEADING, DEFAULT_REFLECTION_HEADING, resolveHabitColorHex, DEFAULT_SETTINGS } from '../constants.js';
import { AddHabitModal } from '../modals/AddHabitModal.js';
import { RenameProgressModal } from '../modals/RenameProgressModal.js';
import { FileSuggestModal } from '../modals/FileSuggestModal.js';
import { PluginGuideComponent } from './PluginGuideComponent.js';
import { getNoteByDate, getDailyNotesInfo, buildHierarchyLabels, calculateCurrentLevel } from '../utils/helpers.js';

class DailyHabitsSettingTab extends PluginSettingTab {
  get isAr() {
    return this.plugin.settings.language === "ar";
  }
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.activeTab = "habits";
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("daily-habits-settings-container");

    const lang = this.plugin.settings.language;
    const isAr = lang === "ar";
    if (isAr) containerEl.addClass("is-rtl");
    else containerEl.removeClass("is-rtl");
    containerEl.setAttribute("dir", isAr ? "rtl" : "ltr");

    const t = (k) => this.plugin.translationManager.t(k);
    containerEl.createEl("h1", { text: t("settings_title") });

    // 1. Render Tab Navigation
    this.renderTabBar(containerEl, t, isAr);

    // 2. Create Panel Containers
    this.basicsPanel = containerEl.createDiv({ cls: "dh-settings-panel", attr: { id: "panel-basics" } });
    this.habitsPanel = containerEl.createDiv({ cls: "dh-settings-panel", attr: { id: "panel-habits" } });
    this.advancedPanel = containerEl.createDiv({ cls: "dh-settings-panel", attr: { id: "panel-advanced" } });
    this.guidePanel = containerEl.createDiv({ cls: "dh-settings-panel", attr: { id: "panel-guide" } });

    // 3. Render Panel Contents
    this.renderBasicsPanel(this.basicsPanel, t, isAr);
    this.renderHabitsPanel(this.habitsPanel, t, isAr);
    this.renderAdvancedPanel(this.advancedPanel, t, isAr);
    new PluginGuideComponent(this.plugin).render(this.guidePanel, t, isAr);

    // 4. Initialize Active Tab
    this.switchTab(this.activeTab);
  }

  renderTabBar(containerEl, t, isAr) {
    const tabsContainer = containerEl.createDiv({ cls: "dh-settings-tabs-container" });

    this.tabs = {
      basics: tabsContainer.createEl("button", { cls: "dh-tab-btn", text: t("tab_basics") }),
      habits: tabsContainer.createEl("button", { cls: "dh-tab-btn", text: t("tab_habits") }),
      advanced: tabsContainer.createEl("button", { cls: "dh-tab-btn", text: t("tab_advanced") }),
      guide: tabsContainer.createEl("button", { cls: "dh-tab-btn", text: t("tab_guide") })
    };

    // Add Habit count badge to Habits tab
    const activeHabitsCount = this.plugin.habitManager.getActiveHabits().length;
    if (activeHabitsCount > 0) {
      this.tabs.habits.textContent += ` (${activeHabitsCount})`;
    }

    Object.keys(this.tabs).forEach(tabId => {
      this.tabs[tabId].onclick = () => this.switchTab(tabId);
    });
  }

  switchTab(tabId) {
    this.activeTab = tabId;

    // Update button states
    if (this.tabs) {
      Object.keys(this.tabs).forEach(id => {
        this.tabs[id].toggleClass("is-active", id === tabId);
      });
    }

    // Update panel visibility
    const panels = {
      basics: this.basicsPanel,
      habits: this.habitsPanel,
      advanced: this.advancedPanel,
      guide: this.guidePanel
    };

    Object.keys(panels).forEach(id => {
      if (panels[id]) {
        panels[id].toggleClass("is-active", id === tabId);
      }
    });

    // Refresh child panels dynamically if needed to fix heights
    if (tabId === "habits" && this.habitsContainer) {
      const searchInput = this.containerEl.querySelector('.dh-search-input');
      const filter = searchInput ? searchInput.value.trim().toLowerCase() : "";
      this.renderHabitsList(this.habitsContainer, filter);
    }
  }

  refreshUI() {
    const st = this.containerEl.scrollTop;
    const hasActive = this.plugin.habitManager.getActiveHabits().length > 0;
    const hasArchived = this.plugin.habitManager.getArchivedHabits().length > 0;
    const currentlyHasActive = !!this.containerEl.querySelector('.dh-danger-zone');
    const currentlyHasArchived = !!this.archivedContainer;

    if (hasActive !== currentlyHasActive || hasArchived !== currentlyHasArchived) {
      const searchInput = this.containerEl.querySelector('.dh-search-input');
      const filter = searchInput ? searchInput.value : "";
      this.display();
      this.containerEl.scrollTop = st;
      if (filter) {
        const newSearch = this.containerEl.querySelector('.dh-search-input');
        if (newSearch) {
          newSearch.value = filter;
          newSearch.focus();
        }
      }
    } else {
      if (this.habitsContainer) {
        const searchInput = this.containerEl.querySelector('.dh-search-input');
        const filter = searchInput ? searchInput.value.trim().toLowerCase() : "";
        this.renderHabitsList(this.habitsContainer, filter);
      }
      if (this.archivedContainer) {
        this.renderArchivedHabitsList(this.archivedContainer);
      }
    }
  }

  renderBasicsPanel(panel, t, isAr) {
    new Setting(panel)
      .setName(t("language"))
      .setDesc(t("language_desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("ar", "العربية")
          .addOption("en", "English")
          .setValue(this.plugin.settings.language || "ar")
          .onChange(async (value) => {
            this.plugin.settings.language = value;
            await this.plugin.saveSettings();
            this.display(); // Full re-render needed for language change
            this.app.workspace.getLeavesOfType(VIEW_TYPE_WEEKLY).forEach((leaf) => {
              if (leaf.view && typeof leaf.view.refresh === "function") leaf.view.refresh();
            });
          })
      );

    new Setting(panel)
      .setName(isAr ? "مجلد ملفات العادات" : "Habit notes folder")
      .setDesc(isAr ? "المجلد الذي ستحفظ فيه ملفات العادات (النشطة والمؤرشفة)" : "Folder where habit notes (Active/Archive) will be saved")
      .addText((text) =>
        text
          .setPlaceholder("Core Habits")
          .setValue(this.plugin.settings.habitNotesFolder || "Core Habits")
          .onChange(async (value) => {
            const oldRoot = this.plugin.settings.habitNotesFolder || "Core Habits";
            const newRoot = value.trim() || "Core Habits";
            this.plugin.settings.habitNotesFolder = newRoot;
            await this.plugin.saveSettings();
            
            if (oldRoot !== newRoot) {
              Utils.showConfirmNotice(
                isAr ? `هل تريد نقل الملفات من "${oldRoot}" إلى "${newRoot}"؟` 
                     : `Move files from "${oldRoot}" to "${newRoot}"?`,
                {
                  isAr,
                  onConfirm: async () => {
                    try {
                      const oldFolder = this.app.vault.getAbstractFileByPath(oldRoot);
                      if (oldFolder && newRoot) {
                        await this.app.fileManager.renameFile(oldFolder, newRoot);
                        new Notice(isAr ? "✅ تم نقل المجلد" : "✅ Folder moved");
                      } else {
                        new Notice(isAr ? "لم يتم العثور على المجلد القديم" : "Old folder not found");
                      }
                    } catch (e) {
                      console.error("Folder move error:", e);
                      new Notice(isAr ? "حدث خطأ أثناء نقل المجلد" : "Error moving folder");
                    }
                  }
                }
              );
            }
          })
      );



    new Setting(panel)
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

    new Setting(panel)
      .setName(t("hide_year"))
      .setDesc(isAr ? "إخفاء السنة في العنوان" : "Hide the year in the header")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.hideYear)
          .onChange(async (value) => {
            this.plugin.settings.hideYear = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(panel)
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

    new Setting(panel)
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

    new Setting(panel)
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

    new Setting(panel)
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

  renderHabitsPanel(panel, t, isAr) {
    new Setting(panel)
      .setName(t("auto_write_habits"))
      .setDesc(t("auto_write_habits_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoWriteHabits)
          .onChange(async (value) => {
            this.plugin.settings.autoWriteHabits = value;
            await this.plugin.saveSettings();
          })
      );

    const btnContainer = panel.createDiv();
    const addBtn = btnContainer.createEl("button", {
      text: t("add_habit_btn"),
      cls: "dh-add-habit-btn-hero",
    });
    addBtn.onclick = () => {
      new AddHabitModal(this.app, this.plugin, async (habitData) => {
        try {
          await this.plugin.habitManager.addHabit(habitData);
          await this.plugin.saveSettings();
          new Notice(t("success_added", { habit: habitData.name }));
          this.switchTab("habits");
          this.refreshUI(); // Check if structural update needed
        } catch (e) {
          new Notice(`Error: ${e.message}`);
        }
      }).open();
    };

    const importContainer = panel.createDiv({ cls: "dh-import-section" });
    new Setting(importContainer)
      .setName(t("import_habits"))
      .setDesc(t("import_desc"))
      .addButton((btn) => btn.setButtonText(isAr ? "📝 ملاحظة اليوم" : "📝 Today's Note").onClick(async () => {
        try {
          const today = window.moment();
          const dailyNote = await getNoteByDate(this.app, today, false);
          if (!dailyNote) {
            new Notice(isAr ? "لا توجد ملاحظة لليوم" : "No daily note found for today.");
            return;
          }
          const content = await this.app.vault.read(dailyNote);
          const count = await this.plugin.habitManager.importHabitsFromContent(content);
          if (count > 0) {
            new Notice(isAr ? `✅ تم استيراد ${count} عادة جديدة!` : `✅ Imported ${count} new habits!`);
            this.refreshUI();
          } else {
            new Notice(isAr ? "لم يتم العثور على عادات جديدة" : "No new habits found.");
          }
        } catch (e) {
          new Notice(isAr ? `فشل الاستيراد: ${e.message}` : `Import failed: ${e.message}`);
        }
      }))
      .addButton((btn) => btn.setButtonText(isAr ? "📂 اختيار ملف" : "📂 Choose File").onClick(() => {
        new FileSuggestModal(this.app, async (file) => {
          try {
            const content = await this.app.vault.read(file);
            const count = await this.plugin.habitManager.importHabitsFromContent(content);
            if (count > 0) {
              new Notice(isAr ? `✅ تم استيراد ${count} عادة من "${file.basename}"` : `✅ Imported ${count} habits from "${file.basename}"`);
              this.refreshUI();
            } else {
              new Notice(isAr ? "لم يتم العثور على عادات جديدة" : "No new habits found");
            }
          } catch (e) {
            new Notice(isAr ? `فشل الاستيراد: ${e.message}` : `Import failed: ${e.message}`);
          }
        }).open();
      }));

    const searchContainer = panel.createDiv({ cls: "dh-search-container" });
    const searchInput = searchContainer.createEl("input", {
      type: "text",
      placeholder: isAr ? "🔍 بحث في العادات..." : "🔍 Search habits...",
      cls: "dh-search-input",
    });
    searchInput.oninput = () => {
      this.renderHabitsList(this.habitsContainer, searchInput.value.trim().toLowerCase());
    };

    this.habitsContainer = panel.createDiv({ cls: "dh-habits-grid-settings" });
    this.renderHabitsList(this.habitsContainer);

    const archivedHabits = this.plugin.habitManager.getArchivedHabits();
    if (archivedHabits.length > 0) {
      const archivedHeader = panel.createDiv({
        cls: "dh-settings-section-header",
        text: isAr ? "📦 العادات المؤرشفة" : "📦 Archived Habits",
      });
      archivedHeader.style.marginTop = "20px";
      this.archivedContainer = panel.createDiv({ cls: "dh-habits-grid-settings" });
      this.renderArchivedHabitsList(this.archivedContainer);
    }

    if (this.plugin.habitManager.getActiveHabits().length > 0) {
      const dangerHeader = panel.createDiv({ cls: "dh-settings-section-header dh-danger-zone" });
      dangerHeader.createSpan({ text: isAr ? "منطقة الخطر" : "Danger Zone" });
      const dangerSetting = new Setting(panel)
        .setName(isAr ? "حذف جميع العادات" : "Delete all habits")
        .setDesc(isAr ? "حذف جميع العادات النشطة نهائياً (لن يتم حذف المؤرشفة). هذا الإجراء لا يمكن التراجع عنه." : "Permanently delete all active habits (archived will be kept). This cannot be undone.");
      dangerSetting.addButton((btn) => btn.setButtonText(isAr ? "🗑️ حذف الكل" : "🗑️ Delete all").setWarning().onClick(async () => {
        const habitsCount = this.plugin.habitManager.getActiveHabits().length;
        Utils.showConfirmNotice(isAr ? `⚠️ هل تريد حذف ${habitsCount} عادة نشطة؟` : `⚠️ Delete ${habitsCount} active habits?`, {
          isAr,
          onConfirm: async () => {
            const activeHabits = [...this.plugin.habitManager.getActiveHabits()];
            for (const h of activeHabits) {
              await this.plugin.habitManager.deleteHabit(h.id);
            }
            this.refreshUI();
            new Notice(isAr ? "✅ تم حذف جميع العادات النشطة" : "✅ All active habits deleted");
          }
        });
      }));
    }
  }

  renderAdvancedPanel(panel, t, isAr) {
    const formattingHeader = panel.createDiv({
      cls: "dh-settings-section-header",
      text: isAr ? "📐 إعدادات البنية والتنسيق (Formatting & Structure)" : "📐 Formatting & Structure",
    });
    
    new Setting(panel)
      .setName(t("habit_section_heading"))
      .setDesc(t("habit_section_heading_desc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.habitHeading)
          .setValue(this.plugin.settings.habitHeading)
          .onChange(async (value) => {
            this.plugin.settings.habitHeading = value || DEFAULT_SETTINGS.habitHeading;
            await this.plugin.saveSettings();
          })
      );



    const otherHeader = panel.createDiv({
      cls: "dh-settings-section-header",
      text: isAr ? "⚙️ إعدادات أخرى" : "⚙️ Other Settings",
    });
    otherHeader.style.marginTop = "20px";


    const dailyNotesInfo = getDailyNotesInfo(this.app, this.plugin.settings);
    const advancedDailyNotes = panel.createEl("details", { cls: "dh-advanced-settings-block dh-daily-notes-info" });
    advancedDailyNotes.style.marginTop = "20px";
    advancedDailyNotes.style.padding = "10px";
    advancedDailyNotes.style.background = "var(--background-secondary)";
    advancedDailyNotes.style.borderRadius = "var(--dh-radius-md)";
    const summary = advancedDailyNotes.createEl("summary", { text: isAr ? "إعدادات متقدمة للملاحظات اليومية (Daily Notes)" : "Advanced Daily Notes Settings" });
    summary.style.fontWeight = "bold";
    summary.style.cursor = "pointer";
    const dailyNotesContainer = advancedDailyNotes.createDiv();
    const sourceLabels = {
      "daily-notes": { icon: "✅", ar: "متصل بـ Daily Notes (تلقائي)", en: "Connected to Daily Notes (auto)" },
      "periodic-notes": { icon: "✅", ar: "متصل بـ Periodic Notes (تلقائي)", en: "Connected to Periodic Notes (auto)" },
      "manual": { icon: "⚙️", ar: "إعدادات يدوية", en: "Manual configuration" },
      "defaults": { icon: "⚠️", ar: "قيم افتراضية (YYYY-MM-DD)", en: "Default values (YYYY-MM-DD)" },
    };
    const src = sourceLabels[dailyNotesInfo.source] || sourceLabels["defaults"];

    new Setting(dailyNotesContainer)
      .setName(isAr ? "التكامل مع الملاحظات اليومية" : "Daily notes integration")
      .setDesc(`${src.icon} ${isAr ? src.ar : src.en}`)
      .then((setting) => {
        if (dailyNotesInfo.source === "daily-notes" || dailyNotesInfo.source === "periodic-notes") {
          const detailsDiv = setting.descEl.createDiv({ cls: "dh-daily-notes-details" });
          if (dailyNotesInfo.folder) detailsDiv.createSpan({ text: isAr ? `📁 المجلد: ${dailyNotesInfo.folder}` : `📁 Folder: ${dailyNotesInfo.folder}` });
          if (dailyNotesInfo.format) {
            detailsDiv.createEl("br");
            detailsDiv.createSpan({ text: isAr ? `📄 الصيغة: ${dailyNotesInfo.format}` : `📄 Format: ${dailyNotesInfo.format}` });
          }
          if (dailyNotesInfo.template) {
            detailsDiv.createEl("br");
            detailsDiv.createSpan({ text: isAr ? `📝 القالب: ${dailyNotesInfo.template}` : `📝 Template: ${dailyNotesInfo.template}` });
          }
        }
      });

    new Setting(dailyNotesContainer)
      .setName(isAr ? "مصدر الإعدادات" : "Settings source")
      .setDesc(isAr ? "تلقائي = يكتشف إعدادات Daily Notes / Periodic Notes. يدوي = استخدم الحقول أدناه." : "Auto = detect from Daily Notes / Periodic Notes. Manual = use the fields below.")
      .addDropdown((dd) =>
        dd
          .addOption("auto", isAr ? "تلقائي" : "Auto")
          .addOption("manual", isAr ? "يدوي" : "Manual")
          .setValue(this.plugin.settings.dailyNotesSource)
          .onChange(async (value) => {
            this.plugin.settings.dailyNotesSource = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.dailyNotesSource === "manual" || dailyNotesInfo.source === "defaults") {
      new Setting(dailyNotesContainer)
        .setName(isAr ? "مجلد الملاحظات اليومية" : "Daily notes folder")
        .setDesc(isAr ? "المسار النسبي للمجلد (اتركه فارغاً للجذر)" : "Relative path to folder (leave empty for vault root)")
        .addText((text) =>
          text
            .setPlaceholder("Cycles/Daily Notes")
            .setValue(this.plugin.settings.dailyNotesFolder)
            .onChange(async (value) => {
              this.plugin.settings.dailyNotesFolder = value.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(dailyNotesContainer)
        .setName(isAr ? "صيغة التاريخ" : "Date format")
        .setDesc(isAr ? "صيغة Moment.js لاسم الملف" : "Moment.js format for filename")
        .addText((text) =>
          text
            .setPlaceholder("YYYY-MM-DD")
            .setValue(this.plugin.settings.dateFormat)
            .onChange(async (value) => {
              this.plugin.settings.dateFormat = value.trim() || "YYYY-MM-DD";
              await this.plugin.saveSettings();
            })
        );
    }

    // --- Habit Context (Comments) Settings ---
    const contextHeader = panel.createDiv({
      cls: "dh-settings-section-header",
      text: isAr ? "💬 سياق العادات (التعليقات)" : "💬 Habit Context (Comments)",
    });
    contextHeader.style.marginTop = "20px";

    new Setting(panel)
      .setName(t("enable_habit_context"))
      .setDesc(t("enable_habit_context_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableHabitContext ?? true)
          .onChange(async (value) => {
            this.plugin.settings.enableHabitContext = value;
            await this.plugin.saveSettings();
            this.display(); // Refresh to show/hide the heading setting
          })
      );

    if (this.plugin.settings.enableHabitContext) {
      new Setting(panel)
        .setName(t("habit_log_heading"))
        .setDesc(t("habit_log_heading_desc"))
        .addText((text) =>
          text
            .setPlaceholder(DEFAULT_SETTINGS.habitLogHeading || DEFAULT_HABIT_NOTES_HEADING)
            .setValue(this.plugin.settings.habitLogHeading)
            .onChange(async (value) => {
              this.plugin.settings.habitLogHeading = value.trim() || DEFAULT_SETTINGS.habitLogHeading || DEFAULT_HABIT_NOTES_HEADING;
              await this.plugin.saveSettings();
            })
        );
    }

    // --- Daily Note Journal Settings ---
    const journalHeader = panel.createDiv({
      cls: "dh-settings-section-header",
      text: isAr ? "📝 يومياتي" : "📝 Daily Journal",
    });
    journalHeader.style.marginTop = "20px";

    new Setting(panel)
      .setName(t("enable_reflection_journal"))
      .setDesc(t("enable_reflection_journal_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableReflectionJournal ?? true)
          .onChange(async (value) => {
            this.plugin.settings.enableReflectionJournal = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.enableReflectionJournal) {
      new Setting(panel)
        .setName(t("reflection_heading"))
        .setDesc(t("reflection_heading_desc"))
        .addText((text) =>
          text
            .setPlaceholder(DEFAULT_SETTINGS.reflectionHeading || DEFAULT_REFLECTION_HEADING)
            .setValue(this.plugin.settings.reflectionHeading)
            .onChange(async (value) => {
              this.plugin.settings.reflectionHeading = value.trim() || DEFAULT_SETTINGS.reflectionHeading || DEFAULT_REFLECTION_HEADING;
              await this.plugin.saveSettings();
            })
        );
    }
  }

  renderHabitsList(container, searchFilter = "") {
    container.empty();
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const isAr = this.isAr;
    let habits = this.plugin.habitManager.getActiveHabits();

    if (searchFilter) {
      habits = habits.filter(h =>
        h.name.toLowerCase().includes(searchFilter) ||
        (h.linkText && h.linkText.toLowerCase().includes(searchFilter))
      );
    }

    if (habits.length === 0) {
      const emptyState = container.createDiv({ cls: "dh-empty-state" });
      emptyState.createDiv({ cls: "dh-empty-state-icon", text: "🌱" });
      emptyState.createDiv({ cls: "dh-empty-state-title", text: t("empty_state_title") });
      emptyState.createDiv({ cls: "dh-empty-state-desc", text: t("empty_state_desc") });
      const addBtn = emptyState.createEl("button", {
        cls: "dh-empty-state-btn",
        text: t("empty_state_btn"),
      });
      addBtn.onclick = () => {
        new AddHabitModal(this.app, this.plugin, async (habitData) => {
          try {
            await this.plugin.habitManager.addHabit(habitData);
            await this.plugin.saveSettings();
            new Notice(t("success_added", { habit: habitData.name }));
            this.switchTab("habits");
            this.display(); // Needed to update tab badges
          } catch (e) {
            new Notice(`❌ ${e.message}`);
          }
        }).open();
      };
      return;
    }

    const list = container.createDiv({ cls: "dh-habits-list" });

    // Add Header Row for better clarity
    const headerRow = list.createDiv({ cls: "dh-habit-row dh-list-header" });
    headerRow.createDiv({ cls: "dh-col-id", text: "#" });
    headerRow.createDiv({
      cls: "dh-col-name",
      text: t("habit_name") || "Habit Name",
    });
    headerRow.createDiv({ cls: "dh-col-level", text: t("level") || "Level" });
    headerRow.createDiv({
      cls: "dh-col-schedule",
      text: "", // Schedule column header (intentionally empty)
    });
    headerRow.createDiv({ cls: "dh-col-actions", text: "" }); // Actions column

    const { sorted: sortedHabits, labels: displayLabels } = buildHierarchyLabels(habits);

    // Map: parentId -> child rows (for collapse/expand in settings)
    const settingsChildRowsMap = new Map();

    sortedHabits.forEach((habit, index) => {
      const effectiveParentId = this.plugin.habitManager.getEffectiveParentId(habit.id);
      const isChild = effectiveParentId !== null;
      const isParent = this.plugin.habitManager.isParent(habit.id);

      let colorId = habit.color || "teal";
      if (isChild) {
        const parentHabit = habits.find(h => h.id === effectiveParentId);
        if (parentHabit) colorId = parentHabit.color || "teal";
      }
      const colorHex = resolveHabitColorHex(colorId);

      const rowCls = isChild ? "dh-habit-row dh-habit-row-child" : "dh-habit-row";
      const row = list.createDiv({ cls: rowCls });
      row.style.setProperty("--habit-color", colorHex);

      // Track child rows for collapse
      if (isChild) {
        const pid = effectiveParentId;
        if (!settingsChildRowsMap.has(pid)) settingsChildRowsMap.set(pid, []);
        settingsChildRowsMap.get(pid).push(row);
      }

      // 1. Order / hierarchy ID cell
      const idCell = row.createDiv({ cls: isChild ? "dh-col-id dh-child-indent-cell" : "dh-col-id" });
      idCell.createSpan({ text: displayLabels[index], cls: "dh-label-num" });

      // 2. Name & Link (with type dot, collapse btn for parents)
      const nameCol = row.createDiv({ cls: "dh-col-name" });
      const nameRow = nameCol.createDiv({ cls: "dh-habit-name-row" });
      nameRow.createSpan({
        cls: `dh-type-dot ${habit.habitType === "break" ? "break" : "build"}`,
        title: habit.habitType === "break" ? t("break_habit") : t("build_habit"),
      });

      if (isParent) {
        // Collapse button (onclick wired after full render)
        const btn = nameRow.createSpan({
          cls: "dh-collapse-btn",
          title: isAr ? "إخفاء / عرض الفروع" : "Collapse / expand children",
          attr: { "data-settings-collapse-id": habit.id },
        });
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="dh-chevron-icon"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
      }

      nameRow.createSpan({ cls: "dh-habit-name", text: habit.name });

      // Show link only if different/meaningful
      const expectedLink = `[[${habit.name}]]`;
      if (
        habit.linkText &&
        habit.linkText !== expectedLink &&
        habit.linkText !== habit.name
      ) {
        nameCol.createDiv({ cls: "dh-habit-link", text: habit.linkText });
      }

      // 3. Level
      const level = habit.currentLevel || 1;
      const levelCol = row.createDiv({ cls: "dh-col-level" });
      levelCol.createSpan({
        text: level.toLocaleString(),
        cls: `dh-level-badge level-${level}`,
      });

      // 4. Schedule (Smart Display)
      const scheduleCol = row.createDiv({ cls: "dh-col-schedule" });
      const isDaily =
        habit.schedule?.type === "all-days" || (habit.schedule?.days?.length ?? 0) === 7;

      if (isDaily) {
        scheduleCol.createSpan({
          text: isAr ? "🔁 يومي" : "🔁 Daily",
          cls: "dh-schedule-tag daily",
        });
      } else {
        const count = habit.schedule.days.length;
        const dayNames = DAY_KEYS.map((k) => this.plugin.translationManager.t(k));
        const selectedDays = [...(habit.schedule?.days || [])]
          .sort((a, b) => a - b)
          .map((d) => dayNames[d])
          .join("، ");

        scheduleCol.createSpan({
          text: isAr ? `🗓️ ${count} أيام` : `🗓️ ${count} Days`,
          cls: "dh-schedule-tag specific",
          title: selectedDays,
        });

      }

      // 5. Actions (Icons)
      const actionsCol = row.createDiv({ cls: "dh-col-actions" });

      // Group-scoped movement bounds
      // Bound correctly against the effective siblings in the resolved hierarchy
      const siblings = sortedHabits.filter(h => this.plugin.habitManager.getEffectiveParentId(h.id) === effectiveParentId);
      const posInGroup = siblings.findIndex(h => h.id === habit.id);
      const isFirstInGroup = posInGroup === 0;
      const isLastInGroup = posInGroup === siblings.length - 1;

      // 1. Move Up Button
      const moveUpBtn = actionsCol.createEl("button", { cls: "dh-icon-btn" });
      setIcon(moveUpBtn, "arrow-up");
      moveUpBtn.setAttribute("aria-label", isAr ? "نقل لأعلى" : "Move Up");
      if (isFirstInGroup) {
        moveUpBtn.addClass("is-disabled");
        moveUpBtn.disabled = true;
      }
      moveUpBtn.onclick = async () => {
        if (isFirstInGroup) return;
        try {
          await this.plugin.habitManager.moveHabitUp(habit.id);
          if (this.habitsContainer) this.renderHabitsList(this.habitsContainer);
          this.app.workspace.getLeavesOfType(VIEW_TYPE_WEEKLY).forEach((leaf) => {
            if (leaf.view && typeof leaf.view.refresh === "function") leaf.view.refresh();
          });
          new Notice(isAr ? "✅ تم النقل لأعلى" : "✅ Moved up");
        } catch (e) {
          console.error('[Core Habits] Move Up Error:', e);
          new Notice(`❌ Error: ${e.message}`);
        }
      };

      // 2. Move Down Button
      const moveDownBtn = actionsCol.createEl("button", { cls: "dh-icon-btn" });
      setIcon(moveDownBtn, "arrow-down");
      moveDownBtn.setAttribute("aria-label", isAr ? "نقل لأسفل" : "Move Down");
      if (isLastInGroup) {
        moveDownBtn.addClass("is-disabled");
        moveDownBtn.disabled = true;
      }
      moveDownBtn.onclick = async () => {
        if (isLastInGroup) return;
        try {
          await this.plugin.habitManager.moveHabitDown(habit.id);
          if (this.habitsContainer) this.renderHabitsList(this.habitsContainer);
          this.app.workspace.getLeavesOfType(VIEW_TYPE_WEEKLY).forEach((leaf) => {
            if (leaf.view && typeof leaf.view.refresh === "function") leaf.view.refresh();
          });
          new Notice(isAr ? "✅ تم النقل لأسفل" : "✅ Moved down");
        } catch (e) {
          console.error('[Core Habits] Move Down Error:', e);
          new Notice(`❌ Error: ${e.message}`);
        }
      };

      // 3. Edit Button
      const editBtn = actionsCol.createEl("button", { cls: "dh-icon-btn" });
      setIcon(editBtn, "pencil");
      editBtn.setAttribute("aria-label", t("edit_habit"));
      editBtn.onclick = () => {
        new AddHabitModal(
          this.app,
          this.plugin,
          async (updatedData) => {
            try {
              if (updatedData.levelData) {
                updatedData.currentLevel = calculateCurrentLevel(updatedData.levelData);
              }
              const shouldRenameAll = updatedData._renameInFiles;
              delete updatedData._renameInFiles;

              const oldName = habit.name;
              const newName = updatedData.name.trim();

              if (shouldRenameAll && oldName !== newName) {
                updatedData.linkText = `[[${newName}]]`;

                // Delegate physical file rename to HabitManager
                await this.plugin.habitManager.renameHabitFile(habit, newName);
              }
              await this.plugin.habitManager.updateHabit(habit.id, updatedData);

              if (shouldRenameAll && oldName !== newName) {
                const prep = await this.plugin.habitManager.prepareBatchRename(habit.id, oldName);

                if (!prep.needsConfirmation) {
                  new Notice(isAr ? "لم يتم العثور على ملفات قديمة للتحديث" : "No old files found to update");
                } else {
                  const confirmed = await new Promise((resolve) => {
                    const confirmModal = new Modal(this.app);
                    const { contentEl } = confirmModal;
                    contentEl.createEl("h2", { text: isAr ? "⚠️ تحديث جميع الملفات" : "⚠️ Update all files" });
                    contentEl.createEl("p", { text: isAr ? `سيتم تغيير "${oldName}" إلى "${newName}" في ${prep.fileCount} ملف.` : `Will change "${oldName}" to "${newName}" in ${prep.fileCount} file(s).` });
                    const footer = contentEl.createDiv({ cls: "modal-button-container" });
                    footer.createEl("button", { text: isAr ? "إلغاء" : "Cancel" }).onclick = () => { confirmModal.close(); resolve(false); };
                    footer.createEl("button", { text: isAr ? "نعم، تحديث الكل" : "Yes, update all", cls: "mod-warning" }).onclick = () => { confirmModal.close(); resolve(true); };
                    confirmModal.open();
                  });

                  if (confirmed) {
                    let cancelRequested = false;
                    let progressModal = new RenameProgressModal(
                      this.app, this.plugin, prep.fileCount, () => { cancelRequested = true; }
                    );
                    progressModal.open();

                    try {
                      const result = await this.plugin.habitManager.executeBatchRename(
                        newName, prep.uniqueOldNames, prep.filesToUpdate,
                        (curr, total) => progressModal.updateProgress(curr, total),
                        () => cancelRequested
                      );
                      progressModal.close();
                      if (cancelRequested) {
                        new Notice(isAr ? `⚠️ تم الإلغاء. المحدث: ${result.updated}` : `⚠️ Cancelled. Updated: ${result.updated}`);
                      } else {
                        new Notice(isAr ? `✅ تم تنظيف ${result.updated} رابط تاريخي بنجاح` : `✅ Successfully cleaned ${result.updated} historical links`);
                      }
                    } catch (err) {
                      progressModal.close();
                      console.error(err);
                      new Notice(isAr ? "❌ خطأ أثناء التحديث" : "❌ Error during update");
                    }
                  }
                }
              }

              this.refreshUI();
              new Notice(`✅ ${updatedData.name}`);
            } catch (e) {
              console.error('[Core Habits] Update Habit Error:', e);
              new Notice(`❌ Error: ${e.message}`);
            }
          },
          habit,
        ).open();
      };

      // 5. Delete Button
      const delBtn = actionsCol.createEl("button", {
        cls: "dh-icon-btn mod-warning",
      });
      setIcon(delBtn, "trash");
      delBtn.setAttribute("aria-label", t("delete"));
      delBtn.onclick = async () => {
        Utils.showConfirmNotice(
          isAr ? `⚠️ حذف "${habit.name}"؟` : `⚠️ Delete "${habit.name}"?`,
          {
            isAr,
            onConfirm: async () => {
              try {
                const deletedHabit = { ...habit };
                await this.plugin.habitManager.deleteHabit(habit.id);
                this.refreshUI();
                this.showUndoDeleteNotice(deletedHabit, t);
              } catch (e) {
                console.error('[Core Habits] Delete Error:', e);
                new Notice(`❌ Error: ${e.message}`);
              }
            },
          }
        );
      };

      // 6. Archive Button
      const archiveBtn = actionsCol.createEl("button", { cls: "dh-icon-btn" });
      setIcon(archiveBtn, "archive");
      archiveBtn.setAttribute("aria-label", isAr ? "أرشفة" : "Archive");
      archiveBtn.onclick = async () => {
        try {
          await this.plugin.habitManager.archiveHabit(habit.id);
          this.refreshUI();
          new Notice(isAr ? "✅ تم الأرشفة" : "✅ Archived");
        } catch (e) {
          console.error('[Core Habits] Archive Error:', e);
          new Notice(`❌ Error: ${e.message}`);
        }
      };
    });

    // Wire up collapse/expand buttons in settings list (after all rows are rendered)
    settingsChildRowsMap.forEach((childRows, pid) => {
      const toggleBtn = list.querySelector(`[data-settings-collapse-id="${pid}"]`);
      if (!toggleBtn) return;

      const parentHabit = habits.find(h => h.id === pid);
      if (!parentHabit) return;

      // Initialize state from settings (unified format: pid + ":expanded")
      const settingsKey = pid + ":expanded";
      // NOTE: collapsedGroups array stores EXPANDED group keys (historical naming).
      // Key format: "{parentId}:expanded". Presence = expanded, absence = collapsed.
      let collapsed = !this.plugin.settings.collapsedGroups.includes(settingsKey);

      const updateUI = () => {
        toggleBtn.classList.toggle("is-collapsed", collapsed);
        toggleBtn.title = collapsed
          ? (isAr ? "عرض الفروع" : "Expand children")
          : (isAr ? "إخفاء الفروع" : "Collapse children");
        childRows.forEach(row => {
          row.style.display = collapsed ? "none" : "";
        });
      };

      // Apply initial state
      updateUI();

      toggleBtn.onclick = async (e) => {
        e.stopPropagation();
        collapsed = !collapsed;

        // Save state persistently (unified format: pid + ":expanded")
        if (collapsed) {
          this.plugin.settings.collapsedGroups = this.plugin.settings.collapsedGroups.filter(k => k !== settingsKey);
        } else {
          if (!this.plugin.settings.collapsedGroups.includes(settingsKey)) {
            this.plugin.settings.collapsedGroups.push(settingsKey);
          }
        }
        await this.plugin.saveSettings({ silent: true });

        updateUI();
      };
    });
  }

  /**
   * Render archived habits list
   * @param {HTMLElement} container - Container element to render into
   */
  renderArchivedHabitsList(container) {
    container.empty();
    const isAr = this.isAr;
    const t = (key) => this.plugin.translationManager.t(key);

    const archivedHabits = this.plugin.habitManager.getArchivedHabits().sort((a, b) => a.order - b.order);

    if (archivedHabits.length === 0) {
      container.createEl("p", {
        text: isAr ? "لا توجد عادات مؤرشفة" : "No archived habits",
        cls: "dh-no-habits-message",
      });
      return;
    }

    // Archived habits column headers
    const list = container.createDiv({ cls: "dh-habits-list" });
    const headerRow = list.createDiv({ cls: "dh-habit-row dh-list-header archived" });
    headerRow.createDiv({ cls: "dh-col-id", text: "#" });
    headerRow.createDiv({ cls: "dh-col-name", text: isAr ? "اسم العادة" : "Habit Name" });
    headerRow.createDiv({ cls: "dh-col-level", text: isAr ? "تاريخ الأرشفة" : "Archive Date" });
    headerRow.createDiv({ cls: "dh-col-streak", text: isAr ? "أطول سلسلة" : "Longest Streak" });
    headerRow.createDiv({ cls: "dh-col-actions", text: "" });

    archivedHabits.forEach((habit, index) => {
      const row = list.createDiv({ cls: "dh-habit-row archived" });

      // Order number
      row.createDiv({ cls: "dh-col-id", text: (index + 1).toLocaleString() });

      // Name
      const nameCol = row.createDiv({ cls: "dh-col-name" });
      nameCol.createEl("span", { text: habit.name, cls: "dh-habit-name" });

      // Archive date
      const dateCol = row.createDiv({ cls: "dh-col-level" });
      if (habit.archivedDate) {
        const archivedDate = new Date(habit.archivedDate);
        dateCol.createEl("span", {
          text: archivedDate.toLocaleDateString(),
          cls: "dh-archived-date",
        });
      }

      // Streak
      const streakCol = row.createDiv({ cls: "dh-col-streak" });
      streakCol.createEl("span", {
        text: (habit.savedLongestStreak || 0).toString(),
        cls: "dh-archived-streak",
      });

      // Actions
      const actionsCol = row.createDiv({ cls: "dh-col-actions" });

      // Restore Button
      const restoreBtn = actionsCol.createEl("button", { cls: "dh-icon-btn" });
      setIcon(restoreBtn, "rotate-ccw");
      restoreBtn.setAttribute("aria-label", isAr ? "استعادة" : "Restore");
      restoreBtn.onclick = async () => {
        try {
          await this.plugin.habitManager.restoreHabit(habit.id);
          this.refreshUI();
          new Notice(isAr ? "✅ تم الاستعادة" : "✅ Restored");
        } catch (e) {
          console.error('[Core Habits] Restore Error:', e);
          new Notice(`❌ Error: ${e.message}`);
        }
      };

      // Permanent Delete Button
      const deleteBtn = actionsCol.createEl("button", {
        cls: "dh-icon-btn mod-warning",
      });
      setIcon(deleteBtn, "trash-2");
      deleteBtn.setAttribute("aria-label", isAr ? "حذف نهائي" : "Delete Permanently");
      deleteBtn.onclick = async () => {
        Utils.showConfirmNotice(
          isAr ? `⚠️ حذف "${habit.name}" نهائياً؟` : `⚠️ Permanently delete "${habit.name}"?`,
          {
            isAr,
            onConfirm: async () => {
              try {
                await this.plugin.habitManager.deleteHabitPermanently(habit.id);
                this.refreshUI();
                new Notice(isAr ? "✅ تم الحذف النهائي" : "✅ Permanently deleted");
              } catch (e) {
                console.error('[Core Habits] Permanent Delete Error:', e);
                new Notice(`❌ Error: ${e.message}`);
              }
            },
          }
        );
      };
    });
  }

  /**
   * Show a persistent Notice with Undo and Close buttons for habit deletion.
   * Note: This state is held in memory and purposefully reset on app close (the habit
   * is deleted instantly from settings, but held within the notice closure).
   */
  showUndoDeleteNotice(deletedHabit, t) {
    const isAr = this.isAr;

    const fragment = document.createDocumentFragment();
    const container = document.createElement("div");
    container.className = "dh-undo-notice";

    container.createSpan({
      text: isAr
        ? `🗑️ تم حذف "${deletedHabit.name}"`
        : `🗑️ Deleted "${deletedHabit.name}"`
    });

    const btnContainer = container.createDiv({ cls: "dh-undo-buttons" });

    const undoBtn = btnContainer.createEl("button", {
      text: isAr ? "تراجع" : "Undo",
      cls: "dh-undo-btn"
    });

    const closeBtn = btnContainer.createEl("button", {
      text: "✕",
      cls: "dh-close-btn"
    });
    fragment.appendChild(container);

    const notice = new Notice(fragment, 0);

    undoBtn.onclick = async () => {
      delete deletedHabit.streakData;
      await this.plugin.habitManager.addHabit(deletedHabit);

      notice.hide();
      this.refreshUI();
      new Notice(isAr ? "✅ تم استعادة العادة" : "✅ Habit restored");
    };

    closeBtn.onclick = () => {
      notice.hide();
    };
  }
}


export { DailyHabitsSettingTab };