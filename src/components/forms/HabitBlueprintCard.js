/**
 * HabitBlueprintCard.js
 * Balanced, elegant component for habit behavioral blueprint (Identity, Cue, Routine/Friction, Reward).
 * Lives prominently in the Pulse Tab as an inspirational, interactive charter card with quick inline editing.
 */
import { setIcon } from 'obsidian';

export class HabitBlueprintCard {
  /**
   * @param {HTMLElement} container
   * @param {Object} options
   * @param {string} [options.habitType='build'] - 'build' | 'break'
   * @param {Object} [options.atomicDescription={}] - { identity, cue, friction, reward }
   * @param {string} [options.notes=''] - General habit notes/context
   * @param {boolean} [options.initiallyEditing=false]
   * @param {Function} options.onChange - (updatedAtomic, updatedNotes) => void
   * @param {Function} options.t - Translation function
   */
  constructor(container, {
    habitType = "build",
    atomicDescription = {},
    notes = "",
    initiallyEditing = false,
    onChange,
    t
  }) {
    this.container = container;
    this.habitType = habitType || "build";
    this.atomic = {
      identity: atomicDescription?.identity || "",
      cue: atomicDescription?.cue || "",
      friction: atomicDescription?.friction || "",
      reward: atomicDescription?.reward || ""
    };
    this.notes = notes || "";
    this.isEditing = initiallyEditing;
    this.onChange = onChange;
    this.t = t || ((k) => k);

    this.rootEl = null;
    this.render();
  }

  setHabitType(newType) {
    this.habitType = newType || "build";
    this.render();
  }

  setAtomicDescription(newAtomic) {
    this.atomic = {
      identity: newAtomic?.identity || "",
      cue: newAtomic?.cue || "",
      friction: newAtomic?.friction || "",
      reward: newAtomic?.reward || ""
    };
    this.render();
  }

  setNotes(newNotes) {
    this.notes = newNotes || "";
    this.render();
  }

  render() {
    this.container.empty();
    this.rootEl = this.container.createDiv({ cls: "dh-blueprint-card-wrap" });

    const isAr = !this.t || (this.t("direction") === "rtl");
    const isBreak = this.habitType === "break";

    const isOpen = this.isEditing || (this.isOpen !== undefined ? this.isOpen : false);
    const card = this.rootEl.createEl("details", {
      cls: `dh-blueprint-card dh-blueprint-details ${this.isEditing ? "is-editing" : "is-display"}`
    });
    card.open = isOpen;
    card.ontoggle = () => {
      this.isOpen = card.open;
    };

    // 1. Card Header as <summary>
    const header = card.createEl("summary", { cls: "dh-blueprint-header dh-blueprint-summary" });
    const titleWrap = header.createDiv({ cls: "dh-blueprint-title-wrap" });
    titleWrap.createEl("span", {
      text: this.t("habit_blueprint_title") || (isAr ? "تصميم العادة" : "Habit Design"),
      cls: "dh-blueprint-title"
    });

    const metaWrap = header.createDiv({ cls: "dh-blueprint-header-meta" });

    // Subtle preview badge when collapsed
    if (!this.isEditing && this.atomic.identity && this.atomic.identity.trim()) {
      metaWrap.createSpan({
        cls: "dh-blueprint-summary-badge",
        text: this.atomic.identity.trim()
      });
    }

    const editToggleBtn = metaWrap.createEl("button", {
      cls: `dh-btn-text-subtle dh-blueprint-toggle-btn ${this.isEditing ? "is-active dh-blueprint-done-btn" : ""}`,
      type: "button"
    });

    const btnIcon = editToggleBtn.createSpan({ cls: "dh-btn-icon" });
    const btnLabel = editToggleBtn.createSpan({ cls: "dh-btn-label" });

    if (this.isEditing) {
      try { setIcon(btnIcon, "check"); } catch { btnIcon.textContent = "✓"; }
      btnLabel.textContent = isAr ? " إتمام" : " Done";
      editToggleBtn.onclick = (e) => {
        if (e) {
          e.stopPropagation();
          e.preventDefault();
        }
        this.isEditing = false;
        this.render();
      };
    } else {
      try { setIcon(btnIcon, "pencil"); } catch { btnIcon.textContent = "✎"; }
      btnLabel.textContent = isAr ? " تعديل" : " Edit";
      editToggleBtn.onclick = (e) => {
        if (e) {
          e.stopPropagation();
          e.preventDefault();
        }
        this.isEditing = true;
        this.isOpen = true;
        this.render();
      };
    }

    // 2. Body Container inside <details>
    const contentWrapper = card.createDiv({ cls: "dh-blueprint-content-wrapper" });

    if (this.isEditing) {
      this.renderEditMode(contentWrapper, isAr, isBreak);
    } else {
      this.renderDisplayMode(contentWrapper, isAr, isBreak);
    }
  }

  renderDisplayMode(card, isAr, isBreak) {
    const grid = card.createDiv({ cls: "dh-blueprint-display-grid" });

    const items = [
      {
        key: "identity",
        label: this.t("identity_label") || (isAr ? "الهوية المستهدفة" : "Target Identity"),
        value: this.atomic.identity,
        placeholder: isBreak
          ? (this.t("identity_placeholder_break_short") || (isAr ? "+ حدد الهوية المستهدفة" : "+ Set target identity"))
          : (this.t("identity_placeholder_build_short") || (isAr ? "+ حدد الهوية المستهدفة" : "+ Set target identity")),
        colorClass: "theme-identity",
        icon: "target"
      },
      {
        key: "cue",
        label: isBreak
          ? (this.t("cue_label_break") || (isAr ? "إشارة التنبيه" : "Trigger Cue"))
          : (this.t("cue_label_build_short") || (isAr ? "المحفز والإشارة" : "Cue & Trigger")),
        value: this.atomic.cue,
        placeholder: isBreak
          ? (this.t("cue_placeholder_break_short") || (isAr ? "+ حدد إشارة التنبيه" : "+ Set trigger cue"))
          : (this.t("cue_placeholder_build_short") || (isAr ? "+ حدد وقت ومكان البداية" : "+ Set cue & location")),
        colorClass: "theme-cue",
        icon: "clock"
      },
      {
        key: "friction",
        label: isBreak
          ? (this.t("friction_label_break") || (isAr ? "زيادة المقاومة والبديل" : "Friction & Alternative"))
          : (this.t("routine_label_build_short") || (isAr ? "خطوة البداية" : "Starting Action")),
        value: this.atomic.friction,
        placeholder: isBreak
          ? (this.t("routine_placeholder_break_short") || (isAr ? "+ حدد كيفية تصعيب العادة" : "+ Increase friction"))
          : (this.t("routine_placeholder_build_short") || (isAr ? "+ حدد خطوة البداية اليسيرة" : "+ Make starting effortless")),
        colorClass: "theme-routine",
        icon: "zap"
      },
      {
        key: "reward",
        label: isBreak
          ? (this.t("reward_label_break") || (isAr ? "المكافأة البديلة" : "Alternative Reward"))
          : (this.t("reward_label_build_short") || (isAr ? "المكافأة" : "Reward")),
        value: this.atomic.reward,
        placeholder: isBreak
          ? (this.t("reward_placeholder_break_short") || (isAr ? "+ حدد المكافأة البديلة" : "+ Set alternative reward"))
          : (this.t("reward_placeholder_build_short") || (isAr ? "+ حدد المكافأة الفورية" : "+ Set immediate reward")),
        colorClass: "theme-reward",
        icon: "gift"
      }
    ];

    items.forEach(item => {
      const itemCard = grid.createDiv({ cls: `dh-blueprint-item ${item.colorClass} ${item.value ? "has-value" : "is-empty"}` });

      const itemHeader = itemCard.createDiv({ cls: "dh-blueprint-item-header" });
      if (item.icon) {
        const iconSpan = itemHeader.createSpan({ cls: "dh-blueprint-item-icon" });
        try { setIcon(iconSpan, item.icon); } catch { /* test fallback */ }
      }
      itemHeader.createSpan({ text: item.label, cls: "dh-blueprint-item-label" });

      const itemBody = itemCard.createDiv({ cls: "dh-blueprint-item-body" });
      if (item.value && item.value.trim()) {
        itemBody.createEl("span", { text: item.value.trim(), cls: "dh-blueprint-value-text" });
      } else {
        itemBody.createEl("span", { text: item.placeholder, cls: "dh-blueprint-placeholder-text" });
      }

      // Quick click to edit
      itemCard.onclick = () => {
        this.isEditing = true;
        this.render();
      };
    });

    // 5. Notes Row (General Habit Notes & Context)
    const hasNotes = Boolean(this.notes && this.notes.trim());
    const notesRow = grid.createDiv({
      cls: `dh-blueprint-notes-item ${hasNotes ? "has-value" : "is-empty"}`
    });
    const notesHeader = notesRow.createDiv({ cls: "dh-blueprint-item-header" });
    const notesIcon = notesHeader.createSpan({ cls: "dh-blueprint-item-icon" });
    try { setIcon(notesIcon, "file-text"); } catch { /* test fallback */ }
    notesHeader.createSpan({
      text: this.t("notes_label_clean") || (isAr ? "سياق وملاحظات العادة" : "Habit Notes & Context"),
      cls: "dh-blueprint-item-label"
    });

    const notesBody = notesRow.createDiv({ cls: "dh-blueprint-item-body" });
    if (hasNotes) {
      notesBody.createEl("span", { text: this.notes.trim(), cls: "dh-blueprint-value-text" });
    } else {
      notesBody.createEl("span", {
        text: isAr ? "+ إضافة ملاحظات أو دوافع شخصية..." : "+ Add habit notes or motivations...",
        cls: "dh-blueprint-placeholder-text"
      });
    }

    notesRow.onclick = () => {
      this.isEditing = true;
      this.render();
    };
  }

  renderEditMode(card, isAr, isBreak) {
    const grid = card.createDiv({ cls: "dh-behavior-inputs-grid dh-blueprint-edit-grid" });

    // 1. Identity Field
    this.createField(
      grid,
      this.t("identity_label") || (isAr ? "الهوية المستهدفة" : "Target Identity"),
      isBreak
        ? (this.t("identity_placeholder_break") || (isAr ? "من تريد أن تصبح؟ (مثال: شخص غير مدخن)" : "Who do you want to be?"))
        : (this.t("identity_placeholder_build") || (isAr ? "من تريد أن تصبح؟ (مثال: أنا قارئ منتظم)" : "Who do you want to be?")),
      this.atomic.identity,
      (v) => { this.atomic.identity = v; this.notifyChange(); }
    );

    // 2. Cue Field
    this.createField(
      grid,
      isBreak
        ? (this.t("cue_label_break") || (isAr ? "إشارة التنبيه" : "Trigger Cue"))
        : (this.t("cue_label_build_short") || (isAr ? "المحفز والإشارة" : "Cue & Trigger")),
      isBreak
        ? (this.t("cue_placeholder_break") || (isAr ? "مثال: الشعور بالملل أو التوتر" : "e.g. Feeling stressed"))
        : (this.t("cue_placeholder_build") || (isAr ? "مثال: بعد صلاة الفجر في مكتبي" : "e.g. After dawn prayer in my office")),
      this.atomic.cue,
      (v) => { this.atomic.cue = v; this.notifyChange(); }
    );

    // 3. Routine / Friction Field
    this.createField(
      grid,
      isBreak
        ? (this.t("friction_label_break") || (isAr ? "زيادة المقاومة والبديل" : "Friction & Alternative"))
        : (this.t("routine_label_build_short") || (isAr ? "خطوة البداية" : "Starting Action")),
      isBreak
        ? (this.t("friction_placeholder_break") || (isAr ? "مثال: حذف التطبيق أو وضع كلمة سر معقدة" : "e.g. Delete app"))
        : (this.t("routine_placeholder_build") || (isAr ? "مثال: وضع الكتاب على الوسادة صباحاً" : "e.g. Put book on desk")),
      this.atomic.friction,
      (v) => { this.atomic.friction = v; this.notifyChange(); }
    );

    // 4. Reward Field
    this.createField(
      grid,
      isBreak
        ? (this.t("reward_label_break") || (isAr ? "المكافأة البديلة" : "Alternative Reward"))
        : (this.t("reward_label_build_short") || (isAr ? "المكافأة" : "Reward")),
      isBreak
        ? (this.t("reward_placeholder_break") || (isAr ? "مثال: المشي 5 دقائق أو شرب ماء" : "e.g. 5-min walk"))
        : (this.t("reward_placeholder_build") || (isAr ? "مثال: كوب قهوة مفضل" : "e.g. Cup of coffee")),
      this.atomic.reward,
      (v) => { this.atomic.reward = v; this.notifyChange(); }
    );

    // 5. Notes Textarea
    const notesGroup = grid.createDiv({ cls: "form-group-clean dh-behavior-grid-item dh-blueprint-notes-field" });
    const notesLabel = notesGroup.createEl("label", { cls: "form-label-clean dh-blueprint-field-label" });
    notesLabel.createSpan({
      text: this.t("notes_label_clean") || (isAr ? "سياق وملاحظات العادة" : "Habit Notes & Context")
    });

    const notesInput = notesGroup.createEl("textarea", {
      cls: "form-input-clean dh-notes-input dh-blueprint-notes-textarea",
      attr: {
        rows: "2",
        placeholder: this.t("notes_placeholder") || (isAr ? "أفكار إضافية، دوافع شخصية عميقة، أو ملاحظات خاصة بهذه العادة..." : "Thoughts, context, or deep motivations for this habit...")
      }
    });
    notesInput.value = this.notes || "";
    notesInput.oninput = (e) => {
      this.notes = e.target.value;
      this.notifyChange();
    };
  }

  createField(parent, labelText, placeholderText, initialValue, onInput, icon = "") {
    const group = parent.createDiv({ cls: "form-group-clean dh-behavior-grid-item" });
    const label = group.createEl("label", { cls: "form-label-clean dh-blueprint-field-label" });
    if (icon) {
      label.createSpan({ text: `${icon} `, cls: "dh-blueprint-field-icon" });
    }
    label.createSpan({ text: labelText });

    const input = group.createEl("input", {
      type: "text",
      cls: "form-input-clean dh-behavior-input",
      attr: { placeholder: placeholderText }
    });
    input.value = initialValue || "";
    input.oninput = (e) => onInput(e.target.value);

    return { group, input };
  }

  notifyChange() {
    if (this.onChange) {
      this.onChange(this.getData(), this.notes);
    }
  }

  getData() {
    return {
      identity: this.atomic.identity ? this.atomic.identity.trim().replace(/[|[\]<>]/g, "") || null : null,
      cue: this.atomic.cue ? this.atomic.cue.trim().replace(/[|[\]<>]/g, "") || null : null,
      friction: this.atomic.friction ? this.atomic.friction.trim().replace(/[|[\]<>]/g, "") || null : null,
      reward: this.atomic.reward ? this.atomic.reward.trim().replace(/[|[\]<>]/g, "") || null : null
    };
  }

  getNotes() {
    return this.notes ? this.notes.trim() : "";
  }

  destroy() {
    if (this.rootEl) {
      this.rootEl.empty();
      this.rootEl = null;
    }
  }
}
