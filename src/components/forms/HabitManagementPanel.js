/**
 * HabitManagementPanel.js
 * Consolidated Habit Charter & Management Panel.
 * Uses HabitCharterFields as the Single Source of Truth for habit fields,
 * combined with the lifecycle and archiving controls.
 */
import { setIcon } from 'obsidian';
import { HabitCharterFields } from './HabitCharterFields.js';
import { formatHabitAge } from '../../utils/helpers.js';
import { TooltipHelper } from '../../utils/TooltipHelper.js';

export class HabitManagementPanel {
  /**
   * @param {HTMLElement} containerEl
   * @param {Object} options
   * @param {Object} options.plugin
   * @param {Object} options.habit
   * @param {Object} options.formState
   * @param {Function} options.onFieldChange - (field, value) => void
   * @param {Function} [options.onHabitTypeChange] - (type) => void
   * @param {Function} [options.onColorChange] - (hex) => void
   * @param {Function} [options.onNameChange] - (name) => void
   * @param {Function} [options.onEnterSave] - () => void
   * @param {Function} [options.onLifecycleAction] - (btn, isArchived) => Promise<void>
   * @param {Function} options.t
   */
  constructor(containerEl, {
    plugin,
    habit,
    formState,
    onFieldChange,
    onHabitTypeChange = null,
    onColorChange = null,
    onNameChange = null,
    onEnterSave = null,
    onLifecycleAction = null,
    t
  }) {
    this.containerEl = containerEl;
    this.plugin = plugin;
    this.habit = habit;
    this.formState = formState;
    this.onFieldChange = onFieldChange;
    this.onHabitTypeChange = onHabitTypeChange;
    this.onColorChange = onColorChange;
    this.onNameChange = onNameChange;
    this.onEnterSave = onEnterSave;
    this.onLifecycleAction = onLifecycleAction;
    this.t = t || ((k) => k);

    this.rootEl = null;
    this.charterFields = null;

    this.render();
  }

  get nameInput() {
    return this.charterFields?.nameInput;
  }

  get validationHint() {
    return this.charterFields?.validationHint;
  }

  get colorPickerComponent() {
    return this.charterFields?.colorPickerComponent;
  }

  render() {
    this.containerEl.empty();
    this.rootEl = this.containerEl.createDiv({ cls: "dh-management-panel-wrap" });

    const isAr = !this.t || (this.t("direction") === "rtl");
    const activeHabits = this.plugin?.habitManager?.getActiveHabits() || [];

    const formWrap = this.rootEl.createDiv({ cls: "dh-management-form" });

    // 1. Single Source of Truth: Core Charter Fields (Mode: Edit)
    this.charterFields = new HabitCharterFields(formWrap, {
      mode: 'edit',
      formState: this.formState,
      habit: this.habit,
      activeHabits,
      weekStartDay: this.plugin?.settings?.weekStartDay ?? 0,
      habitManager: this.plugin?.habitManager,
      t: this.t,
      onFieldChange: this.onFieldChange,
      onNameChange: this.onNameChange,
      onColorChange: this.onColorChange,
      onHabitTypeChange: this.onHabitTypeChange,
      onEnterSave: this.onEnterSave
    });

    // 2. Lifecycle: Habit Archiving & Restoration
    this.renderLifecycleSection(formWrap, isAr);
  }

  renderLifecycleSection(parent, isAr) {
    const section = parent.createDiv({ cls: "dh-management-lifecycle-section" });
    const isArchived = Boolean(this.habit?.archived);

    // 1. Section Header Title with History icon
    const sectionHeader = section.createDiv({ cls: "dh-lifecycle-section-title" });
    const headerIcon = sectionHeader.createSpan({ cls: "dh-lifecycle-section-icon" });
    try { setIcon(headerIcon, "history"); } catch { headerIcon.textContent = "⏱"; }
    sectionHeader.createSpan({
      cls: "dh-lifecycle-section-text",
      text: this.t("habit_info_and_lifecycle_title") || (isAr ? "معلومات العادة ودورة الحياة" : "Habit Info & Lifecycle")
    });

    // 2. Metadata Grid (Habit Age, Creation Date, File Path, Archived Date)
    const metaGrid = section.createDiv({ cls: "dh-lifecycle-meta-grid" });

    // A. Creation Date & Age
    let createdAt = this.habit?.createdAt;
    if (!createdAt && this.plugin?.app?.vault && this.habit?.name) {
      const activeFolder = this.plugin?.habitNoteManager?.getActiveFolder ? this.plugin.habitNoteManager.getActiveFolder() : "Core Habits/Active";
      const file = this.plugin.app.vault.getAbstractFileByPath(`${activeFolder}/${this.habit.name}.md`);
      if (file?.stat?.ctime) createdAt = file.stat.ctime;
    }
    if (!createdAt && this.habit?.file?.stat?.ctime) {
      createdAt = this.habit.file.stat.ctime;
    }

    const ageInfo = createdAt ? formatHabitAge(createdAt, isAr ? "ar" : "en") : null;

    if (ageInfo) {
      // Habit Age
      const ageItem = metaGrid.createDiv({ cls: "dh-lifecycle-meta-item dh-meta-age-item" });
      ageItem.createDiv({
        cls: "dh-lifecycle-meta-label",
        text: this.t("habit_age_label") || (isAr ? "عمر العادة:" : "Habit Age:")
      });
      ageItem.createDiv({
        cls: "dh-lifecycle-meta-value dh-meta-highlight",
        text: ageInfo.ageText
      });

      // Creation Date
      const dateItem = metaGrid.createDiv({ cls: "dh-lifecycle-meta-item dh-meta-date-item" });
      dateItem.createDiv({
        cls: "dh-lifecycle-meta-label",
        text: this.t("habit_created_on_label") || (isAr ? "تاريخ الإنشاء:" : "Created On:")
      });
      dateItem.createDiv({
        cls: "dh-lifecycle-meta-value",
        text: ageInfo.formattedDate
      });
    }

    // B. Habit Note File Location (Clickable to open file)
    let filePath = "";
    if (this.plugin?.habitNoteManager?.getHabitFilePath && this.habit?.name) {
      filePath = this.plugin.habitNoteManager.getHabitFilePath(this.habit.name, isArchived);
    } else if (this.habit?.file?.path) {
      filePath = this.habit.file.path;
    } else if (this.habit?.name) {
      filePath = `Core Habits/${isArchived ? "Archive" : "Active"}/${this.habit.name}.md`;
    }

    if (filePath) {
      const fileItem = metaGrid.createDiv({ cls: "dh-lifecycle-meta-item dh-meta-file-item" });
      fileItem.createDiv({
        cls: "dh-lifecycle-meta-label",
        text: this.t("habit_note_file_label") || (isAr ? "مسار الملف:" : "Note File:")
      });
      const fileVal = fileItem.createDiv({
        cls: "dh-lifecycle-meta-value dh-meta-file-link",
        text: filePath
      });
      TooltipHelper.set(fileVal, isAr ? "انقر لفتح ملف الملاحظة" : "Click to open note file");
      fileVal.onclick = async () => {
        if (this.plugin?.app?.workspace) {
          await this.plugin.app.workspace.openLinkText(filePath, "", false);
        }
      };
    }

    // C. Archived Date if archived
    if (isArchived && this.habit?.archivedDate) {
      const mArchived = window.moment ? window.moment(this.habit.archivedDate) : null;
      if (mArchived && mArchived.isValid()) {
        const archItem = metaGrid.createDiv({ cls: "dh-lifecycle-meta-item dh-meta-archived-item" });
        archItem.createDiv({
          cls: "dh-lifecycle-meta-label",
          text: this.t("habit_archived_on_label") || (isAr ? "تاريخ الأرشفة:" : "Archived On:")
        });
        archItem.createDiv({
          cls: "dh-lifecycle-meta-value",
          text: mArchived.locale(isAr ? "ar" : "en").format("D MMMM YYYY")
        });
      }
    }

    // 3. Divider
    section.createDiv({ cls: "dh-lifecycle-divider" });

    // 4. Action Row (Archive / Restore)
    const actionRow = section.createDiv({ cls: "dh-lifecycle-header" });

    const infoCol = actionRow.createDiv({ cls: "dh-lifecycle-info" });
    infoCol.createDiv({
      cls: "dh-lifecycle-title",
      text: isAr ? "إدارة حالة العادة" : "Habit State Management"
    });
    infoCol.createDiv({
      cls: "dh-lifecycle-desc",
      text: isAr
        ? "أرشفة العادة تخفيها من لوحة المتابعة اليومية مع حفظ تاريخها وإنجازاتها بالكامل."
        : "Archiving hides the habit from daily views while keeping all historical data intact."
    });

    const lifecycleBtn = actionRow.createEl("button", {
      cls: `dh-btn dh-lifecycle-btn ${isArchived ? "mod-restore" : "mod-archive"}`,
      type: "button"
    });
    const btnIcon = lifecycleBtn.createSpan({ cls: "dh-btn-icon" });
    try {
      setIcon(btnIcon, isArchived ? "archive-restore" : "archive");
    } catch {
      btnIcon.textContent = isArchived ? "⎌" : "⌸";
    }
    lifecycleBtn.createSpan({
      cls: "dh-btn-text",
      text: isArchived
        ? (this.t("action_restore_habit") || (isAr ? "استعادة العادة" : "Restore habit"))
        : (this.t("action_archive_habit") || (isAr ? "أرشفة العادة" : "Archive habit"))
    });

    lifecycleBtn.onclick = async () => {
      if (this.onLifecycleAction) {
        await this.onLifecycleAction(lifecycleBtn, isArchived);
      }
    };
  }

  showNameError(errorMsg) {
    if (this.charterFields) {
      this.charterFields.showNameError(errorMsg);
    }
  }

  destroy() {
    if (this.charterFields) {
      this.charterFields.destroy();
      this.charterFields = null;
    }
    if (this.rootEl) {
      this.rootEl.empty();
      this.rootEl = null;
    }
  }
}
