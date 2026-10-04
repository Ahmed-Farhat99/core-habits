/**
 * HabitCharterFields.js
 * Single Source of Truth for core habit charter fields:
 * 1. Name input & validation (+ conditional rename warning in edit mode)
 * 2. Habit classification type switcher (Build vs. Break / Gain vs. Quit)
 * 3. Parent habit selector & hierarchy rules
 * 4. Accent color picker with parent inheritance
 * 5. Repetition schedule & frequency picker
 * 
 * Reused identically across AddHabitModal and HabitManagementPanel (EditHabit).
 */
import { setIcon } from 'obsidian';
import { HabitColorPicker } from './HabitColorPicker.js';
import { HabitSchedulePicker } from './HabitSchedulePicker.js';
import { TooltipHelper } from '../../utils/TooltipHelper.js';

export class HabitCharterFields {
  /**
   * @param {HTMLElement} containerEl
   * @param {Object} options
   * @param {'create'|'edit'} [options.mode='create']
   * @param {Object} options.formState
   * @param {Object|null} [options.habit=null]
   * @param {Array} [options.activeHabits=[]]
   * @param {number} [options.weekStartDay=0]
   * @param {Object|null} [options.habitManager=null]
   * @param {Function} [options.t]
   * @param {Function} [options.onFieldChange] - (field, value) => void
   * @param {Function} [options.onNameChange] - (newName) => void
   * @param {Function} [options.onColorChange] - (newColor) => void
   * @param {Function} [options.onHabitTypeChange] - (newType) => void
   * @param {Function} [options.onEnterSave] - () => void
   */
  constructor(containerEl, {
    mode = 'create',
    formState,
    habit = null,
    activeHabits = [],
    weekStartDay = 0,
    habitManager = null,
    t = null,
    onFieldChange = null,
    onNameChange = null,
    onColorChange = null,
    onHabitTypeChange = null,
    onEnterSave = null
  }) {
    this.containerEl = containerEl;
    this.mode = mode;
    this.formState = formState;
    this.habit = habit;
    this.activeHabits = activeHabits;
    this.weekStartDay = weekStartDay;
    this.habitManager = habitManager;
    this.t = t || ((k) => k);

    this.onFieldChange = onFieldChange || (() => {});
    this.onNameChange = onNameChange || (() => {});
    this.onColorChange = onColorChange || (() => {});
    this.onHabitTypeChange = onHabitTypeChange || (() => {});
    this.onEnterSave = onEnterSave || (() => {});

    this.rootEl = null;
    this.nameInput = null;
    this.validationHint = null;
    this.colorPickerComponent = null;

    this.render();
  }

  render() {
    this.containerEl.empty();
    const isAr = !this.t || (this.t("direction") === "rtl");

    this.rootEl = this.containerEl.createDiv({ cls: "dh-charter-fields-wrap" });

    // ─── Group 1: Habit Identity (Name & Type Switch) ───────────────────────────
    const identityCard = this.rootEl.createDiv({ cls: "dh-form-group-card dh-identity-card" });

    // 1. Name Field
    const nameGroup = identityCard.createDiv({ cls: "form-group-clean dh-charter-name-group" });
    nameGroup.createEl("label", {
      text: this.t("habit_name") || (isAr ? "اسم العادة" : "Habit name"),
      cls: "form-label-clean"
    });

    const inputWrapper = nameGroup.createDiv({ cls: "dh-name-input-wrapper" });
    this.nameInput = inputWrapper.createEl("input", {
      type: "text",
      placeholder: this.t("habit_name_placeholder") || (isAr ? "مثال: صلاة الضحى، قراءة 15 دقيقة" : "e.g. Morning Run, Reading"),
      cls: "form-input-clean dh-name-input-wide",
      attr: {
        "aria-label": this.t("habit_name") || "Habit Name",
        "aria-required": "true"
      }
    });
    this.nameInput.value = this.formState.name || "";

    // Inline validation hint
    this.validationHint = inputWrapper.createDiv({ cls: "dh-inline-validation-hint" });
    this.validationHint.style.display = "none";

    // Edit Mode Only: Rename Warning Card for past daily notes
    let renameContainer = null;
    let renameCheckbox = null;
    if (this.mode === 'edit' && this.habit) {
      renameContainer = inputWrapper.createDiv({ cls: "dh-rename-warning-card" });
      renameContainer.style.display = "none";

      const renameCheckboxRow = renameContainer.createDiv({ cls: "dh-rename-checkbox-row" });
      renameCheckbox = renameCheckboxRow.createEl("input", {
        type: "checkbox",
        id: "dh-edit-rename-all-notes"
      });
      renameCheckboxRow.createEl("label", {
        text: this.t("rename_old_notes_label") || (isAr ? "تحديث الاسم في الملاحظات اليومية القديمة أيضاً؟" : "Update name in past daily notes as well?"),
        attr: { for: "dh-edit-rename-all-notes" },
        cls: "dh-rename-label"
      });

      const renameHint = renameContainer.createDiv({ cls: "dh-rename-hint" });
      renameHint.textContent = this.t("rename_old_notes_hint") || (isAr
        ? "سيتم تحديث اسم ملف العادة وتعديل الإشارات السابقة في اليوميات بدقة."
        : "Renames the habit file and updates references in historical notes.");

      renameCheckbox.onchange = (e) => {
        this.formState.renameOldNotes = e.target.checked;
        this.onFieldChange("renameOldNotes", e.target.checked);
      };
    }

    this.nameInput.oninput = (e) => {
      const currentName = e.target.value;
      this.formState.name = currentName;
      this.onFieldChange("name", currentName);
      this.onNameChange(currentName.trim());

      const trimmed = currentName.trim();
      if (trimmed) {
        this.validationHint.style.display = "none";
        this.nameInput.classList.remove("dh-input-error");
      }

      if (renameContainer && renameCheckbox && this.habit) {
        const initialName = (this.habit.name || "").trim();
        if (trimmed && trimmed !== initialName) {
          renameContainer.style.display = "flex";
        } else {
          renameContainer.style.display = "none";
          renameCheckbox.checked = false;
          this.formState.renameOldNotes = false;
          this.onFieldChange("renameOldNotes", false);
        }
      }
    };

    this.nameInput.onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.onEnterSave();
      }
    };

    // 2. Habit Type Switch (Build vs. Break)
    const typeGroup = identityCard.createDiv({ cls: "form-group-clean dh-type-group dh-charter-type-group" });
    typeGroup.createEl("label", {
      text: this.t("habit_type_label") || (isAr ? "نوع العادة:" : "Habit Type:"),
      cls: "form-label-clean"
    });

    const pillSwitch = typeGroup.createDiv({ cls: "dh-pill-switch" });
    
    // Build Button
    const buildDesc = this.t("habit_type_build_desc") || (isAr ? "اكتساب وبناء عادة إيجابية جديدة" : "Build and cultivate a positive habit");
    const buildBtn = pillSwitch.createEl("button", {
      cls: `dh-pill-btn build ${this.formState.habitType !== "break" ? "is-active" : ""}`,
      type: "button"
    });
    TooltipHelper.set(buildBtn, buildDesc);
    const buildIcon = buildBtn.createSpan({ cls: "dh-pill-icon" });
    try { setIcon(buildIcon, "trending-up"); } catch { buildIcon.textContent = "▲"; }
    buildBtn.createSpan({
      cls: "dh-pill-label",
      text: this.t("habit_type_build") || (isAr ? "بناء" : "Build")
    });

    // Break Button
    const breakDesc = this.t("habit_type_break_desc") || (isAr ? "التخلّي عن عادة سلبية أو الإقلاع عنها" : "Break and quit an unwanted habit");
    const breakBtn = pillSwitch.createEl("button", {
      cls: `dh-pill-btn break ${this.formState.habitType === "break" ? "is-active" : ""}`,
      type: "button"
    });
    TooltipHelper.set(breakBtn, breakDesc);
    const breakIcon = breakBtn.createSpan({ cls: "dh-pill-icon" });
    try { setIcon(breakIcon, "shield"); } catch { breakIcon.textContent = "▼"; }
    breakBtn.createSpan({
      cls: "dh-pill-label",
      text: this.t("habit_type_break") || (isAr ? "إقلاع" : "Break")
    });

    buildBtn.onclick = () => {
      this.formState.habitType = "build";
      buildBtn.addClass("is-active");
      breakBtn.removeClass("is-active");
      this.onFieldChange("habitType", "build");
      this.onHabitTypeChange("build");
    };

    breakBtn.onclick = () => {
      this.formState.habitType = "break";
      breakBtn.addClass("is-active");
      buildBtn.removeClass("is-active");
      this.onFieldChange("habitType", "break");
      this.onHabitTypeChange("break");
    };

    // ─── Group 2: Organization & Appearance (Parent & Color) ────────────────────
    const orgCard = this.rootEl.createDiv({ cls: "dh-form-group-card dh-organization-card" });

    // 3. Hierarchy: Parent Habit Selector or Children Info
    const thisId = this.habit?.id;
    const thisChildren = thisId ? this.activeHabits.filter(h => h.parentId === thisId) : [];
    const isThisAParent = thisChildren.length > 0;

    if (isThisAParent && this.mode === 'edit') {
      const childrenGroup = orgCard.createDiv({ cls: "form-group-clean dh-parent-group" });
      childrenGroup.createEl("label", {
        text: this.t("child_habits_label") || (isAr ? "العادات التابعة لهذه العادة:" : "Child Habits:"),
        cls: "form-label-clean"
      });
      const childList = childrenGroup.createDiv({ cls: "dh-children-info" });
      thisChildren.forEach(ch => {
        childList.createDiv({ cls: "dh-child-tag", text: `└ ${ch.name}` });
      });
    } else {
      const topLevelHabits = this.activeHabits.filter(h => !h.parentId && (!thisId || h.id !== thisId));
      if (topLevelHabits.length > 0) {
        const parentGroup = orgCard.createDiv({ cls: "form-group-clean dh-parent-group" });
        parentGroup.createEl("label", {
          text: this.t("parent_habit") || (isAr ? "العادة الأم (اختياري):" : "Parent Habit (Optional):"),
          cls: "form-label-clean"
        });

        const parentSelect = parentGroup.createEl("select", { cls: "form-input-clean dh-parent-select" });
        parentSelect.createEl("option", {
          text: this.t("parent_habit_none") || (isAr ? "عادة مستقلة" : "Independent habit"),
          value: ""
        });
        topLevelHabits.forEach(h => {
          parentSelect.createEl("option", { text: h.name, value: h.id });
        });
        parentSelect.value = this.formState.selectedParentId || "";

        parentSelect.onchange = (e) => {
          const newPid = e.target.value || null;
          this.formState.selectedParentId = newPid;
          const parentHabit = newPid ? this.activeHabits.find(h => h.id === newPid) : null;
          if (this.colorPickerComponent) {
            this.colorPickerComponent.setParentHabit(parentHabit);
          }
          const activeColor = parentHabit ? parentHabit.color : this.formState.selectedColor;
          this.onColorChange(activeColor);
          this.onFieldChange("selectedParentId", newPid);
        };
      }
    }

    // 4. Habit Color Picker
    const initialParent = this.formState.selectedParentId
      ? this.activeHabits.find(h => h.id === this.formState.selectedParentId)
      : null;

    const colorContainer = orgCard.createDiv({ cls: "dh-component-wrap-color" });
    this.colorPickerComponent = new HabitColorPicker(colorContainer, {
      selectedColor: this.formState.selectedColor,
      parentHabit: initialParent,
      habitManager: this.habitManager,
      onChange: (newColor) => {
        this.formState.selectedColor = newColor;
        this.onColorChange(newColor);
        this.onFieldChange("selectedColor", newColor);
      },
      t: this.t
    });

    // ─── Group 3: Schedule & Frequency ──────────────────────────────────────────
    const scheduleCard = this.rootEl.createDiv({ cls: "dh-form-group-card dh-schedule-card" });
    const scheduleContainer = scheduleCard.createDiv({ cls: "dh-component-wrap-schedule" });
    new HabitSchedulePicker(scheduleContainer, {
      initialDays: this.formState.selectedDays,
      weekStartDay: this.weekStartDay,
      onChange: ({ type, days }) => {
        this.formState.scheduleType = type;
        this.formState.selectedDays = days;
        this.onFieldChange("scheduleType", type);
        this.onFieldChange("selectedDays", days);
      },
      t: this.t
    });
  }

  /**
   * Validate habit name and trigger inline error display if empty.
   * @returns {boolean}
   */
  validateName() {
    const raw = (this.nameInput && this.nameInput.value && this.nameInput.value.trim())
      ? this.nameInput.value
      : (this.formState.name || "");
    const trimmed = raw.trim();
    if (!trimmed) {
      const isAr = !this.t || (this.t("direction") === "rtl");
      const errorMsg = this.t("error_name_required") || (isAr ? "اسم العادة مطلوب" : "Habit name is required");
      this.showNameError(errorMsg);
      return false;
    }
    return true;
  }

  showNameError(errorMsg) {
    if (this.nameInput) {
      this.nameInput.focus();
      this.nameInput.classList.add("dh-input-error");
      setTimeout(() => this.nameInput?.classList.remove("dh-input-error"), 2000);
    }
    if (this.validationHint) {
      this.validationHint.textContent = errorMsg;
      this.validationHint.style.display = "block";
    }
  }

  focusNameInput() {
    if (this.nameInput) {
      this.nameInput.focus();
      if (typeof this.nameInput.select === "function") {
        this.nameInput.select();
      }
    }
  }

  destroy() {
    if (this.rootEl) {
      this.rootEl.empty();
      this.rootEl = null;
    }
    this.nameInput = null;
    this.validationHint = null;
    this.colorPickerComponent = null;
  }
}
