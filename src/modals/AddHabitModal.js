import { Notice, debounce, Platform } from 'obsidian';
import { HABIT_COLORS_PALETTE } from '../constants.js';
import { calculateCurrentLevel, autoResizeTextarea } from '../utils/helpers.js';
import { StreakStatsComponent } from '../components/StreakStatsComponent.js';
import { LogViewer } from '../components/LogViewer.js';
import { BaseHabitModal } from './BaseHabitModal.js';

class AddHabitModal extends BaseHabitModal {
  constructor(app, plugin, onSubmit, existingHabit = null) {
    super(app, plugin);
    this.onSubmit = onSubmit;
    this.existingHabit = existingHabit;

    // Initialize State
    const isEdit = !!existingHabit;
    this.formState = {
      name: isEdit ? existingHabit.name : "",
      selectedColor: isEdit ? (existingHabit.color || "teal") : "teal",
      selectedParentId: isEdit ? (existingHabit.parentId || null) : null,
      scheduleMode: isEdit && existingHabit.schedule?.type === "weekly" && existingHabit.schedule.days.length < 7 ? "specific" : "daily",
      selectedDays: isEdit && existingHabit.schedule?.type === "weekly" ? [...existingHabit.schedule.days] : [0, 1, 2, 3, 4, 5, 6],
      habitType: isEdit ? (existingHabit.habitType || "build") : "build",
      atomicIdentity: isEdit && existingHabit.atomicDescription ? existingHabit.atomicDescription.identity || "" : "",
      atomicCue: isEdit && existingHabit.atomicDescription ? existingHabit.atomicDescription.cue || "" : "",
      atomicFriction: isEdit && existingHabit.atomicDescription ? existingHabit.atomicDescription.friction || "" : "",
      atomicReward: isEdit && existingHabit.atomicDescription ? existingHabit.atomicDescription.reward || "" : "",
      useLevels: true,
      currentLevel: isEdit ? existingHabit.currentLevel || 1 : 1,
      levelData: isEdit && existingHabit.levelData ? JSON.parse(JSON.stringify(existingHabit.levelData)) : Array(5).fill().map(() => ({ goal: "", condition: "", achieved: false })),
      notes: isEdit ? (existingHabit.notes || "") : ""
    };
    this.activeTab = "basics";
  }

  onOpen() {
    super.onOpen();
    this.triggerElement = document.activeElement;
    const { contentEl, modalEl } = this;

    if (modalEl) modalEl.addClass("dh-add-habit-modal-wrapper");

    contentEl.addClass("daily-habits-modal");

    const t = (k, params = {}) => this.plugin.translationManager.t(k, params);
    const isEdit = !!this.existingHabit;

    // 1. Header
    const headerDiv = contentEl.createDiv({ cls: "modal-header-clean" });
    headerDiv.createEl("h2", {
      text: isEdit ? t("edit_habit_title") : t("add_habit_title"),
      cls: "modal-title-clean",
    });

    // 2. Streak Stats (Only in Edit Mode)
    if (isEdit) {
      new StreakStatsComponent(this.plugin, this.existingHabit).render(contentEl);
    }

    // 3. Form Container
    const form = contentEl.createDiv({ cls: "habit-form-container" });

    // 4. Tab Bar (Segmented Control)
    this.renderTabBar(form, t);

    // 5. Panels Container
    const panelsContainer = form.createDiv({ cls: "dh-modal-panels-container" });

    this.panels = {
      basics: panelsContainer.createDiv({ cls: "dh-modal-panel", attr: { id: "panel-basics" } }),
      gradation: panelsContainer.createDiv({ cls: "dh-modal-panel", attr: { id: "panel-gradation" } }),
      log: panelsContainer.createDiv({ cls: "dh-modal-panel dh-modal-log-panel", attr: { id: "panel-log" } })
    };

    // 6. Render Panel Contents
    this.renderBasicInfoSection(this.panels.basics, t);
    this.renderGradationSection(this.panels.gradation, t);

    // Only render log if habit context is enabled and editing an existing habit
    if (this.plugin.settings.enableHabitContext && isEdit) {
      new LogViewer(this.app, this.plugin, this.existingHabit, this.formState).render(this.panels.log);
    } else {
      this.panels.log.createDiv({
        cls: "dh-log-empty-state",
        text: isEdit ? t("habit_log_disabled") : t("save_habit_first_for_comments")
      });
    }

    // Initialize Active Tab
    this.switchModalTab(this.activeTab);

    // 7. Footer
    this.renderFooter(contentEl, t);

    // 8. Mobile: scroll focused inputs into view when keyboard appears
    if (Platform.isMobile) {
      contentEl.querySelectorAll('input, textarea, select').forEach(el => {
        el.addEventListener('focus', () => {
          setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
        });
      });
    }

    // Auto-focus the first input
    setTimeout(() => {
      const firstInput = contentEl.querySelector('input[type="text"]');
      if (firstInput) {
        firstInput.focus();
        firstInput.select();
      }
    }, 50);
  }

  renderTabBar(container, t) {
    const tabsContainer = container.createDiv({ cls: "dh-modal-tabs-container" });

    this.tabs = {
      basics: tabsContainer.createEl("button", { cls: "dh-btn dh-modal-tab-btn", text: t("tab_basics_num") }),
      gradation: tabsContainer.createEl("button", { cls: "dh-btn dh-modal-tab-btn", text: t("tab_gradation_num") }),
      log: tabsContainer.createEl("button", { cls: "dh-btn dh-modal-tab-btn", text: t("tab_log_num") })
    };

    Object.keys(this.tabs).forEach(tabId => {
      this.tabs[tabId].onclick = () => this.switchModalTab(tabId);
    });
  }

  switchModalTab(tabId) {
    this.activeTab = tabId;
    if (this.tabs) {
      Object.keys(this.tabs).forEach(id => {
        this.tabs[id].toggleClass("is-active", id === tabId);
      });
    }
    if (this.panels) {
      Object.keys(this.panels).forEach(id => {
        this.panels[id].toggleClass("is-active", id === tabId);

        // Fix: recalculate textarea height when made visible
        if (id === tabId) {
          const textareas = this.panels[id].querySelectorAll('textarea.dh-auto-textarea');
          textareas.forEach(autoResizeTextarea);
        }
      });
    }
  }

  renderBasicInfoSection(panel, t) {
    const isEdit = !!this.existingHabit;
    const basicSection = panel.createDiv({ cls: "form-section" });

    // 1. Name Input
    const nameGroup = basicSection.createDiv({ cls: "form-group-clean" });
    nameGroup.createEl("label", { text: t("habit_name"), cls: "form-label-clean" });

    // Wrap input and path to prevent breaking the flex layout of form-group-clean
    const inputWrapper = nameGroup.createDiv({ cls: "dh-name-input-wrapper" });

    const nameInput = inputWrapper.createEl("input", {
      type: "text",
      placeholder: t("habit_name_placeholder"),
      cls: "form-input-clean dh-name-input-wide"
    });
    nameInput.value = this.formState.name;
    const initialName = this.formState.name;

    const pathDisplay = inputWrapper.createDiv({ cls: "dh-habit-file-path" });

    // Add checkbox for Rename in all notes
    const renameContainer = inputWrapper.createDiv({ cls: "dh-rename-checkbox-container" });
    const renameCheckbox = renameContainer.createEl("input", { type: "checkbox", id: "dh-rename-all-notes" });
    renameContainer.createEl("label", { text: t("rename_old_notes_label"), attr: { for: "dh-rename-all-notes" }, cls: "dh-atomic-hint" });

    const renameHint = inputWrapper.createDiv({ cls: "dh-atomic-hint" });
    renameHint.textContent = t("rename_old_notes_hint");

    const updatePathDisplay = (name) => {
      if (!name || !name.trim()) { pathDisplay.textContent = ""; return; }
      const linkedFile = this.app.metadataCache.getFirstLinkpathDest(name.trim(), "");
      pathDisplay.textContent = linkedFile
        ? `📁 ${linkedFile.path}`
        : t("no_linked_file");
    };
    if (isEdit) updatePathDisplay(this.formState.name);

    nameInput.oninput = (e) => {
      this.formState.name = e.target.value;
      const currentName = e.target.value.trim();

      if (isEdit && currentName && currentName !== initialName) {
        renameContainer.style.display = "flex";
        renameHint.style.display = "block";
      } else {
        renameContainer.style.display = "none";
        renameHint.style.display = "none";
        renameCheckbox.checked = false;
      }
    };
    nameInput.addEventListener("input", debounce(() => updatePathDisplay(nameInput.value), 400));

    this.formState.renameOldNotes = () => renameCheckbox.checked;

    // 1a. Habit Engineering (moved from its own tab)
    this.renderHabitEngineeringSection(basicSection, t);

    // Helper for active habits and children logic
    const activeHabits = this.plugin.habitManager.getActiveHabits();
    const thisId = isEdit ? this.existingHabit.id : null;
    const thisChildren = thisId ? activeHabits.filter(h => h.parentId === thisId) : [];
    const isThisAParent = thisChildren.length > 0;

    // 2. Parent / Children Info
    if (isThisAParent) {
      const childrenGroup = basicSection.createDiv({ cls: "form-group-clean dh-parent-group" });
      childrenGroup.createEl("label", { text: t("child_habits_label"), cls: "form-label-clean" });
      const childList = childrenGroup.createDiv({ cls: "dh-children-info" });
      thisChildren.forEach(ch => {
        childList.createDiv({ cls: "dh-child-tag", text: `└ ${ch.name}` });
      });
    } else {
      const topLevelHabits = activeHabits.filter(h => !h.parentId && h.id !== thisId);
      if (topLevelHabits.length > 0) {
        const parentGroup = basicSection.createDiv({ cls: "form-group-clean dh-parent-group" });
        parentGroup.createEl("label", { text: t("parent_habit"), cls: "form-label-clean" });
        const parentSelect = parentGroup.createEl("select", { cls: "form-input-clean dh-parent-select" });
        parentSelect.createEl("option", { text: t("parent_habit_none"), value: "" });
        topLevelHabits.forEach(h => {
          parentSelect.createEl("option", { text: h.name, value: h.id });
        });
        parentSelect.value = this.formState.selectedParentId || "";
        parentSelect.onchange = (e) => {
          this.formState.selectedParentId = e.target.value || null;
        };
      }
    }

    // 3. Color Picker (Always visible or toggled)
    const colorGroup = basicSection.createDiv({ cls: "form-group-clean dh-color-picker-group" });
    colorGroup.createEl("label", { text: t("color"), cls: "form-label-clean" });
    const colorRow = colorGroup.createDiv({ cls: "dh-color-swatches" });

    const colorPalette = HABIT_COLORS_PALETTE;

    const HABIT_COLORS = colorPalette.map(c => ({
      ...c,
      label: t(`color_${c.id}`),
    }));

    HABIT_COLORS.forEach(c => {
      const swatch = colorRow.createDiv({ cls: `dh-color-swatch ${this.formState.selectedColor === c.id ? "is-active" : ""}` });
      swatch.style.backgroundColor = c.hex;
      swatch.style.setProperty("--swatch-color", c.hex);
      swatch.title = c.label;
      swatch.onclick = () => {
        this.formState.selectedColor = c.id;
        colorRow.querySelectorAll(".dh-color-swatch").forEach(s => s.removeClass("is-active"));
        swatch.addClass("is-active");
      };
    });

    const updateColorPickerVisibility = () => {
      colorGroup.style.display = this.formState.selectedParentId ? "none" : "block";
    };
    updateColorPickerVisibility();

    // Hook the parentSelect change to update the color picker visibility
    if (!isThisAParent && activeHabits.filter(h => !h.parentId && h.id !== thisId).length > 0) {
      const parentSelect = basicSection.querySelector('.dh-parent-select');
      if (parentSelect) {
        parentSelect.addEventListener('change', () => {
          updateColorPickerVisibility();
        });
      }
    }

    // 4. Schedule
    basicSection.createEl("div", { cls: "dh-section-divider" }); // Visual separator
    const scheduleGroup = basicSection.createDiv({ cls: "form-group-clean dh-schedule-group" });
    scheduleGroup.createEl("label", { text: t("schedule_days"), cls: "form-label-clean" });

    const daysPicker = scheduleGroup.createDiv({ cls: "days-picker-clean" });
    daysPicker.style.display = "block";
    const dayGrid = daysPicker.createDiv({ cls: "days-grid-clean" });

    const dayLabels = {
      0: t("sun_short"),
      1: t("mon_short"),
      2: t("tue_short"),
      3: t("wed_short"),
      4: t("thu_short"),
      5: t("fri_short"),
      6: t("sat_short")
    };
    const wsd = this.plugin.settings.weekStartDay;
    const displayOrder = Array.from({ length: 7 }, (_, i) => (wsd + i) % 7);

    const renderDayChips = () => {
      dayGrid.empty();
      displayOrder.forEach((dayIndex) => {
        const chip = dayGrid.createDiv({
          cls: `day-chip-clean ${this.formState.selectedDays.includes(dayIndex) ? "is-selected" : ""}`,
          text: dayLabels[dayIndex],
        });
        chip.onclick = () => {
          if (this.formState.selectedDays.includes(dayIndex)) {
            if (this.formState.selectedDays.length > 1) {
              this.formState.selectedDays = this.formState.selectedDays.filter((d) => d !== dayIndex);
            }
          } else {
            this.formState.selectedDays.push(dayIndex);
          }
          this.formState.scheduleMode = this.formState.selectedDays.length === 7 ? "daily" : "specific";
          renderDayChips();
        };
      });
    };
    renderDayChips();
  }

  renderHabitEngineeringSection(panel, t) {
    const atomicSection = panel.createEl("details", { cls: "form-section dh-atomic-section" });
    
    const summary = atomicSection.createEl("summary", { cls: "dh-atomic-summary dh-accordion-summary" });
    summary.createEl("span", {
      text: t("habit_engineering_summary")
    });

    const contentDiv = atomicSection.createDiv({ cls: "dh-atomic-content" });

    const typeToggleRow = contentDiv.createDiv({ cls: "dh-type-toggle-row" });
    const buildBtn = typeToggleRow.createDiv({
      cls: `dh-type-btn build ${this.formState.habitType === "build" ? "is-active" : ""}`,
      text: t("habit_type_build"),
    });
    const breakBtn = typeToggleRow.createDiv({
      cls: `dh-type-btn break ${this.formState.habitType === "break" ? "is-active" : ""}`,
      text: t("habit_type_break"),
    });

    const atomicFields = contentDiv.createDiv({ cls: "dh-atomic-fields" });

    const fieldsRef = {};

    fieldsRef.identity = this.createAtomicField(atomicFields, this.formState.atomicIdentity, (v) => { this.formState.atomicIdentity = v; });
    fieldsRef.cue = this.createAtomicField(atomicFields, this.formState.atomicCue, (v) => { this.formState.atomicCue = v; });
    fieldsRef.friction = this.createAtomicField(atomicFields, this.formState.atomicFriction, (v) => { this.formState.atomicFriction = v; });
    fieldsRef.reward = this.createAtomicField(atomicFields, this.formState.atomicReward, (v) => { this.formState.atomicReward = v; });

    // 1b. Free-form Notes (moved here)
    const notesGroup = atomicFields.createDiv({ cls: "form-group-clean dh-atomic-field" });
    const notesLabelContainer = notesGroup.createDiv({ cls: "dh-atomic-label-container" });
    const notesTextWrapper = notesLabelContainer.createDiv({ cls: "dh-atomic-label-wrapper" });
    notesTextWrapper.createEl("label", { text: t("notes_label"), cls: "form-label-clean" });
    const notesHint = notesLabelContainer.createDiv({ cls: "dh-atomic-hint" });
    notesHint.textContent = t("notes_hint");
    const notesInput = notesGroup.createEl("textarea", {
      cls: "form-input-clean dh-atomic-input dh-auto-textarea dh-notes-input",
      attr: {
        placeholder: t("notes_placeholder"),
        rows: 2
      }
    });
    notesInput.value = this.formState.notes;
    const autoResizeNotes = () => autoResizeTextarea(notesInput);
    notesInput.oninput = (e) => { this.formState.notes = e.target.value; autoResizeNotes(); };
    setTimeout(autoResizeNotes, 0);

    const updateAtomicLabels = () => {
      const isB = this.formState.habitType === "break";

      // 1. Identity
      fieldsRef.identity.label.textContent = t("identity_label");
      fieldsRef.identity.hint.textContent = isB
        ? t("identity_hint_break")
        : t("identity_hint_build");
      fieldsRef.identity.input.setAttribute("placeholder", isB
        ? t("identity_placeholder_break")
        : t("identity_placeholder_build"));

      // 2. Cue
      fieldsRef.cue.label.textContent = isB ? t("cue_label_break") : t("cue_label_build");
      fieldsRef.cue.hint.textContent = isB
        ? t("cue_hint_break")
        : t("cue_hint_build");
      fieldsRef.cue.input.setAttribute("placeholder", isB
        ? t("cue_placeholder_break")
        : t("cue_placeholder_build"));

      // 3. Friction
      fieldsRef.friction.label.textContent = isB ? t("friction_label_break") : t("friction_label_build");
      fieldsRef.friction.hint.textContent = isB
        ? t("friction_hint_break")
        : t("friction_hint_build");
      fieldsRef.friction.input.setAttribute("placeholder", isB
        ? t("friction_placeholder_break")
        : t("friction_placeholder_build"));

      // 4. Reward
      fieldsRef.reward.label.textContent = isB ? t("reward_label_break") : t("reward_label_build");
      fieldsRef.reward.hint.textContent = isB
        ? t("reward_hint_break")
        : t("reward_hint_build");
      fieldsRef.reward.input.setAttribute("placeholder", isB
        ? t("reward_placeholder_break")
        : t("reward_placeholder_build"));
    };

    updateAtomicLabels();

    buildBtn.onclick = () => {
      this.formState.habitType = "build";
      buildBtn.addClass("is-active");
      breakBtn.removeClass("is-active");
      updateAtomicLabels();
    };
    breakBtn.onclick = () => {
      this.formState.habitType = "break";
      breakBtn.addClass("is-active");
      buildBtn.removeClass("is-active");
      updateAtomicLabels();
    };

    atomicSection.addEventListener("toggle", () => {
      if (atomicSection.open) {
        setTimeout(() => {
          atomicSection.querySelectorAll('textarea.dh-auto-textarea').forEach(autoResizeTextarea);
        }, 50);
      }
    });
  }

  createAtomicField(parent, initialValue, onInput) {
    const group = parent.createDiv({ cls: "form-group-clean dh-atomic-field" });
    const labelContainer = group.createDiv({ cls: "dh-atomic-label-container" });

    const textWrapper = labelContainer.createDiv({ cls: "dh-atomic-label-wrapper" });
    const label = textWrapper.createEl("label", { cls: "form-label-clean" });

    // Hint text placed right below the label
    const hint = labelContainer.createDiv({ cls: "dh-atomic-hint" });

    const input = group.createEl("textarea", { cls: "form-input-clean dh-atomic-input dh-auto-textarea" });

    input.setAttribute("rows", "1");
    input.value = initialValue;

    const autoResize = () => autoResizeTextarea(input);
    input.oninput = (e) => { onInput(e.target.value); autoResize(); };
    setTimeout(autoResize, 0);

    return { group, label, hint, input };
  }

  renderGradationSection(panel, t) {
    const levelsSection = panel.createDiv({ cls: "form-section dh-gradation-section" });
    const heroSection = levelsSection.createDiv({ cls: "gradation-hero-section" });

    heroSection.createDiv({
      cls: `gradation-hint ${this.formState.useLevels ? "is-visible" : ""}`,
      text: t("gradation_hint")
    });

    const levelsCont = levelsSection.createDiv({ cls: "levels-container-clean" });
    levelsCont.style.display = this.formState.useLevels ? "block" : "none";

    const explanationDiv = levelsSection.createDiv({ cls: "dh-gradation-explanation" });
    explanationDiv.style.display = this.formState.useLevels ? "block" : "none";
    explanationDiv.createEl("p", {
      text: t("gradation_explanation")
    });

    const tableHeader = levelsCont.createDiv({ cls: "levels-header-clean" });
    tableHeader.createSpan({ text: "#" });
    const colsHeader = tableHeader.createDiv({ cls: "levels-cols-header-clean" });
    colsHeader.createSpan({ text: t("target_habit_level_label") });
    colsHeader.createSpan({ text: t("condition_label") });

    const conditionOptions = [
      { v: "", l: t("cond_select") },
      { v: "7 continuous days", l: t("cond_7d") },
      { v: "14 continuous days", l: t("cond_14d") },
      { v: "21 continuous days", l: t("cond_21d") },
      { v: "30 continuous days", l: t("cond_30d") },
      { v: "No condition (Lifestyle)", l: t("cond_lifestyle") },
    ];

    const placeholders = [
      t("placeholder_lvl_1"),
      t("placeholder_lvl_2"),
      t("placeholder_lvl_3"),
      t("placeholder_lvl_4"),
      t("placeholder_lvl_5")
    ];

    const renderLevels = () => {
      levelsCont.querySelectorAll(".level-row-clean").forEach(el => el.remove());

      for (let i = 0; i < 5; i++) {
        const levelNum = i + 1;
        const isDone = this.formState.levelData[i]?.achieved;

        const row = levelsCont.createDiv({
          cls: `level-row-clean ${isDone ? "is-achieved" : ""}`
        });

        const badgeCol = row.createDiv({});
        const badge = badgeCol.createDiv({
          cls: `level-num-badge ${isDone ? "is-achieved" : ""}`,
        });
        badge.textContent = isDone ? "✓" : levelNum;
        badge.onclick = () => {
          if (!this.formState.levelData[i].goal?.trim() || !this.formState.levelData[i].condition) {
            new Notice(t("error_fill_level"));
            return;
          }
          this.formState.levelData[i].achieved = !this.formState.levelData[i].achieved;
          renderLevels();
        };

        const inputsCol = row.createDiv({ cls: "level-inputs-col-clean" });

        const goalInp = inputsCol.createEl("input", {
          type: "text",
          placeholder: placeholders[i],
          cls: "level-input-clean dh-level-goal-input",
        });
        goalInp.value = this.formState.levelData[i].goal || "";
        goalInp.disabled = isDone;
        goalInp.oninput = (e) => (this.formState.levelData[i].goal = e.target.value);

        const conditionSelect = inputsCol.createEl("select", {
          cls: "level-input-clean dh-level-condition-select",
        });
        conditionOptions.forEach(opt => {
          conditionSelect.createEl("option", { text: opt.l, value: opt.v });
        });
        conditionSelect.value = this.formState.levelData[i].condition || "";
        conditionSelect.disabled = isDone;
        conditionSelect.onchange = (e) => (this.formState.levelData[i].condition = e.target.value);
      }
    };
    renderLevels();
  }

  renderFooter(container, t) {
    const footer = container.createDiv({ cls: "dh-modal-actions" });

    const saveBtn = footer.createEl("button", {
      text: t("save_btn"),
      cls: "dh-btn mod-cta",
    });

    const cancelBtn = footer.createEl("button", { text: t("cancel"), cls: "dh-btn" });
    cancelBtn.onclick = () => this.close();

    saveBtn.onclick = async () => {
      try {
        saveBtn.disabled = true;
        const { name, selectedDays, useLevels, levelData, habitType, atomicIdentity, atomicCue, atomicFriction, atomicReward, selectedParentId, selectedColor, notes } = this.formState;

        if (!name.trim()) {
          new Notice(t("error_name_required"));
          if (this.activeTab !== "basics") {
            this.switchModalTab("basics");
            const nameInput = this.contentEl.querySelector(".dh-name-input-wide");
            if (nameInput) nameInput.focus();
          }
          saveBtn.disabled = false;
          return;
        }

        await this.onSubmit({
          name: name.trim(),
          schedule: {
            type: selectedDays.length === 7 ? "daily" : "weekly",
            days: selectedDays,
          },
          levelData: useLevels ? levelData : null,
          currentLevel: useLevels ? calculateCurrentLevel(levelData) : null,
          habitType: habitType,
          atomicDescription: {
            identity: atomicIdentity ? atomicIdentity.trim().replace(/[|[\]<>]/g, "") || null : null,
            cue: atomicCue ? atomicCue.trim().replace(/[|[\]<>]/g, "") || null : null,
            friction: atomicFriction ? atomicFriction.trim().replace(/[|[\]<>]/g, "") || null : null,
            reward: atomicReward ? atomicReward.trim().replace(/[|[\]<>]/g, "") || null : null,
          },
          parentId: selectedParentId || null,
          color: selectedColor || "teal",
          notes: notes ? notes.trim().replace(/[|<>]/g, "") || null : null,
          _renameInFiles: this.formState.renameOldNotes && !!this.existingHabit ? this.formState.renameOldNotes() : false
        });
        if (this.triggerElement) this.triggerElement.focus();
        this.close();
      } catch (e) {
        saveBtn.disabled = false;
        new Notice(`❌ ${e.message}`);
        console.error(e);
      }
    };
  }

  onClose() {
    this.contentEl.empty();
    if (this.triggerElement) this.triggerElement.focus();
  }
}

export { AddHabitModal };