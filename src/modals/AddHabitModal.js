import { Modal, Notice, debounce, Platform } from 'obsidian';
import { HABIT_COLORS_PALETTE } from '../constants.js';
import { calculateCurrentLevel } from '../utils/helpers.js';
import { StreakStatsComponent } from '../components/StreakStatsComponent.js';
import { LogViewer } from '../components/LogViewer.js';

class AddHabitModal extends Modal {
  constructor(app, plugin, onSubmit, existingHabit = null) {
    super(app);
    this.plugin = plugin;
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
    this.triggerElement = document.activeElement;
    const { contentEl, modalEl } = this;

    if (modalEl) modalEl.addClass("dh-add-habit-modal-wrapper");

    contentEl.empty();
    contentEl.addClass("daily-habits-modal");

    const t = (k) => this.plugin.translationManager.t(k);
    const isAr = this.plugin.settings.language === "ar";
    const isEdit = !!this.existingHabit;

    if (isAr) {
      contentEl.addClass("is-rtl");
      contentEl.setAttr("dir", "rtl");
    }

    // 1. Header
    const headerDiv = contentEl.createDiv({ cls: "modal-header-clean" });
    headerDiv.createEl("h2", {
      text: isEdit ? (isAr ? "تعديل العادة" : "Edit Habit") : (isAr ? "إضافة عادة جديدة" : "Add New Habit"),
      cls: "modal-title-clean",
    });

    // 2. Streak Stats (Only in Edit Mode)
    if (isEdit) {
      new StreakStatsComponent(this.plugin, this.existingHabit).render(contentEl);
    }

    // 3. Form Container
    const form = contentEl.createDiv({ cls: "habit-form-container" });

    // 4. Tab Bar (Segmented Control)
    this.renderTabBar(form, t, isAr);

    // 5. Panels Container
    const panelsContainer = form.createDiv({ cls: "dh-modal-panels-container" });

    this.panels = {
      basics: panelsContainer.createDiv({ cls: "dh-modal-panel", attr: { id: "panel-basics" } }),
      gradation: panelsContainer.createDiv({ cls: "dh-modal-panel", attr: { id: "panel-gradation" } }),
      log: panelsContainer.createDiv({ cls: "dh-modal-panel dh-modal-log-panel", attr: { id: "panel-log" } })
    };

    // 6. Render Panel Contents
    this.renderBasicInfoSection(this.panels.basics, t, isAr);
    this.renderGradationSection(this.panels.gradation, t, isAr);

    // Only render log if habit context is enabled and editing an existing habit
    if (this.plugin.settings.enableHabitContext && isEdit) {
      new LogViewer(this.app, this.plugin, this.existingHabit, this.formState).render(this.panels.log);
    } else {
      this.panels.log.createDiv({
        cls: "dh-log-empty-state",
        text: isAr ? (isEdit ? "ميزة سجل المتابعة معطلة من الإعدادات." : "احفظ العادة أولاً لتتمكن من إضافة وقراءة التعليقات.")
          : (isEdit ? "Habit context feature is disabled in settings." : "Save the habit first to add and read comments.")
      });
    }

    // Initialize Active Tab
    this.switchModalTab(this.activeTab);

    // 7. Footer
    this.renderFooter(contentEl, t, isAr);

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

  renderTabBar(container, t, isAr) {
    const tabsContainer = container.createDiv({ cls: "dh-modal-tabs-container" });

    this.tabs = {
      basics: tabsContainer.createEl("button", { cls: "dh-modal-tab-btn", text: isAr ? "1. الأساسيات" : "1. Basics" }),
      gradation: tabsContainer.createEl("button", { cls: "dh-modal-tab-btn", text: isAr ? "2. التدرج" : "2. Gradation" }),
      log: tabsContainer.createEl("button", { cls: "dh-modal-tab-btn", text: isAr ? "3. السجل" : "3. Log" })
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
          textareas.forEach(ta => {
            ta.style.height = "auto";
            ta.style.height = `${ta.scrollHeight}px`;
          });
        }
      });
    }
  }

  renderBasicInfoSection(panel, t, isAr) {
    const isEdit = !!this.existingHabit;
    const basicSection = panel.createDiv({ cls: "form-section" });

    // 1. Name Input
    const nameGroup = basicSection.createDiv({ cls: "form-group-clean" });
    nameGroup.createEl("label", { text: t("habit_name"), cls: "form-label-clean" });

    // Wrap input and path to prevent breaking the flex layout of form-group-clean
    const inputWrapper = nameGroup.createDiv({ cls: "dh-name-input-wrapper" });

    const nameInput = inputWrapper.createEl("input", {
      type: "text",
      placeholder: isAr ? "مثال: صلاة الفجر في المسجد" : "e.g. Fajr prayer at mosque",
      cls: "form-input dh-name-input-wide"
    });
    nameInput.value = this.formState.name;
    const initialName = this.formState.name;

    const pathDisplay = inputWrapper.createDiv({ cls: "dh-habit-file-path" });

    // Add checkbox for Rename in all notes
    const renameContainer = inputWrapper.createDiv({ cls: "dh-rename-checkbox-container" });
    const renameCheckbox = renameContainer.createEl("input", { type: "checkbox", id: "dh-rename-all-notes" });
    renameContainer.createEl("label", { text: isAr ? "إعادة التسمية في جميع الملاحظات القديمة؟ (اختياري)" : "Rename in all older notes? (Optional)", attr: { for: "dh-rename-all-notes" }, cls: "dh-atomic-hint" });

    const renameHint = inputWrapper.createDiv({ cls: "dh-atomic-hint" });
    renameHint.textContent = isAr
      ? "💡 سيتم استبدال الاسم الحالي وكل الأسماء السابقة لهذه العادة بالاسم الجديد في كل ملفاتك."
      : "💡 This will replace the current name and all previous aliases with the new name across your vault.";

    const updatePathDisplay = (name) => {
      if (!name || !name.trim()) { pathDisplay.textContent = ""; return; }
      const linkedFile = this.app.metadataCache.getFirstLinkpathDest(name.trim(), "");
      pathDisplay.textContent = linkedFile
        ? `📁 ${linkedFile.path}`
        : (isAr ? "📁 لا يوجد ملف مرتبط (سيُنشأ تلقائياً)" : "📁 No linked file (will be created)");
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
    this.renderHabitEngineeringSection(basicSection, t, isAr);

    // Helper for active habits and children logic
    const activeHabits = this.plugin.habitManager.getActiveHabits();
    const thisId = isEdit ? this.existingHabit.id : null;
    const thisChildren = thisId ? activeHabits.filter(h => h.parentId === thisId) : [];
    const isThisAParent = thisChildren.length > 0;

    // 2. Parent / Children Info
    if (isThisAParent) {
      const childrenGroup = basicSection.createDiv({ cls: "form-group-clean dh-parent-group" });
      childrenGroup.createEl("label", { text: isAr ? "العادات المرتبطة بها:" : "Child Habits:", cls: "form-label-clean" });
      const childList = childrenGroup.createDiv({ cls: "dh-children-info" });
      thisChildren.forEach(ch => {
        childList.createDiv({ cls: "dh-child-tag", text: `└ ${ch.name}` });
      });
    } else {
      const topLevelHabits = activeHabits.filter(h => !h.parentId && h.id !== thisId);
      if (topLevelHabits.length > 0) {
        const parentGroup = basicSection.createDiv({ cls: "form-group-clean dh-parent-group" });
        parentGroup.createEl("label", { text: t("parent_habit"), cls: "form-label-clean" });
        const parentSelect = parentGroup.createEl("select", { cls: "form-input dh-parent-select" });
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
    colorGroup.createEl("label", { text: isAr ? "اللون" : "Color", cls: "form-label-clean" });
    const colorRow = colorGroup.createDiv({ cls: "dh-color-swatches" });

    const colorLabelsAr = {
      teal: "أخضر مائي", blue: "أزرق", purple: "بنفسجي",
      amber: "ذهبي", rose: "وردي", green: "أخضر",
      indigo: "نيلي", cyan: "سماوي", pink: "زهري",
      orange: "برتقالي", lime: "ليموني", slate: "رمادي"
    };
    const colorPalette = HABIT_COLORS_PALETTE;

    const HABIT_COLORS = colorPalette.map(c => ({
      ...c,
      label: isAr ? (colorLabelsAr[c.id] || c.id) : c.id.charAt(0).toUpperCase() + c.id.slice(1),
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
    scheduleGroup.createEl("label", { text: isAr ? "أيام التكرار" : "Frequency", cls: "form-label-clean" });
    const scheduleHint = scheduleGroup.createDiv({ cls: "dh-atomic-hint" });
    scheduleHint.textContent = isAr ? "(تحديد جميع الأيام يعني أن العادة يومية)" : "(Selecting all days means it's a daily habit)";

    const daysPicker = scheduleGroup.createDiv({ cls: "days-picker-clean" });
    daysPicker.style.display = "block";
    const dayGrid = daysPicker.createDiv({ cls: "days-grid-clean" });

    const dayLabels = isAr
      ? { 0: "الأحد", 1: "الاثنين", 2: "الثلاثاء", 3: "الأربعاء", 4: "الخميس", 5: "الجمعة", 6: "السبت" }
      : { 0: "Su", 1: "M", 2: "Tu", 3: "W", 4: "Th", 5: "F", 6: "Sa" };
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

  renderHabitEngineeringSection(panel, t, isAr) {
    const atomicSection = panel.createEl("details", { cls: "form-section dh-atomic-section" });
    
    const summary = atomicSection.createEl("summary", { cls: "dh-atomic-summary dh-accordion-summary" });
    summary.createEl("span", {
      text: isAr
        ? "💡 هندسة العادات (خياري): أسئلة للتحليل العميق"
        : "💡 Habit Engineering (Optional): Deep analysis questions"
    });

    const contentDiv = atomicSection.createDiv({ cls: "dh-atomic-content" });

    const typeToggleRow = contentDiv.createDiv({ cls: "dh-type-toggle-row" });
    const buildBtn = typeToggleRow.createDiv({
      cls: `dh-type-btn build ${this.formState.habitType === "build" ? "is-active" : ""}`,
      text: isAr ? "بناء عادة" : "Build",
    });
    const breakBtn = typeToggleRow.createDiv({
      cls: `dh-type-btn break ${this.formState.habitType === "break" ? "is-active" : ""}`,
      text: isAr ? "كسر عادة" : "Break",
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
    notesTextWrapper.createEl("label", { text: isAr ? "ملاحظات (اختياري)" : "Notes (optional)", cls: "form-label-clean" });
    const notesHint = notesLabelContainer.createDiv({ cls: "dh-atomic-hint" });
    notesHint.textContent = isAr ? "مساحة حرة: الوقت، المكان، تذكير، أي شيء تريده" : "Free space: time, place, reminders, anything you want";
    const notesInput = notesGroup.createEl("textarea", {
      cls: "form-input dh-atomic-input dh-auto-textarea dh-notes-input",
      attr: {
        placeholder: isAr ? "مثال: هذه العادة أعملها الساعة 6 صباحاً بعد القهوة..." : "e.g. This habit is at 6am after coffee...",
        rows: 2
      }
    });
    notesInput.value = this.formState.notes;
    const autoResizeNotes = () => {
      notesInput.style.height = "auto";
      notesInput.style.height = `${notesInput.scrollHeight}px`;
    };
    notesInput.oninput = (e) => { this.formState.notes = e.target.value; autoResizeNotes(); };
    setTimeout(autoResizeNotes, 0);

    const updateAtomicLabels = () => {
      const isB = this.formState.habitType === "break";

      // 1. Identity
      fieldsRef.identity.label.textContent = isAr ? "الهوية المستهدفة" : "Target Identity";
      fieldsRef.identity.hint.textContent = isB
        ? (isAr ? "من تريد أن تصبح؟ (مثال: \"أنا شخص يتحكم برغباته\")" : "Who do you want to become?")
        : (isAr ? "من تريد أن تصبح؟ بدل \"أريد قراءة كتاب\" قل \"أنا قارئ نهم\"" : "Instead of 'I want to read', say 'I am a reader'");
      fieldsRef.identity.input.setAttribute("placeholder", isB
        ? (isAr ? "مثال: أنا شخص غير مدخن" : "e.g. I am a non-smoker")
        : (isAr ? "مثال: أنا قارئ منتظم" : "e.g. I am a consistent reader"));

      // 2. Cue — الإشارة
      fieldsRef.cue.label.textContent = isB ? (isAr ? "الإشارة (الإخفاء)" : "Cue (Hide)") : (isAr ? "الإشارة (متى وأين؟)" : "Cue (When & Where?)");
      fieldsRef.cue.hint.textContent = isB
        ? (isAr ? "ما الذي يدفعك للعادة السيئة؟ ألغِ المحفز أو أخفِه" : "What triggers it? Remove or hide it")
        : (isAr ? "سوف أقوم بـ [العادة] في الساعة [...] في مكان [...]" : "I will do [habit] at [time] in [place]");
      fieldsRef.cue.input.setAttribute("placeholder", isB
        ? (isAr ? "مثال: حذف التطبيق المشتت" : "e.g. Delete distracting app")
        : (isAr ? "مثال: بعد صلاة الفجر مباشرة في غرفة المكتب" : "e.g. Right after Fajr in study room"));

      // 3. Friction — السهولة / التصعيب
      fieldsRef.friction.label.textContent = isB ? (isAr ? "التصعيب (زيادة العقبات)" : "Make it Difficult") : (isAr ? "السهولة (تسهيل البدء)" : "Make it Easy");
      fieldsRef.friction.hint.textContent = isB
        ? (isAr ? "كيف تزيد العقبات؟ أضف خطوات تمنعك من البدء" : "Add steps/obstacles to prevent starting")
        : (isAr ? "ابدأ بأقل من دقيقتين — مثال: لبس الحذاء الرياضي فقط" : "Start with under 2 minutes");
      fieldsRef.friction.input.setAttribute("placeholder", isB
        ? (isAr ? "مثال: إبعاد الهاتف عن غرفة النوم" : "e.g. Keep phone away from bedroom")
        : (isAr ? "مثال: تجهيز ملابس الرياضة من الليل" : "e.g. Prepare gym clothes the night before"));

      // 4. Reward — المكافأة
      fieldsRef.reward.label.textContent = isB ? (isAr ? "العقوبة (فورية)" : "Punishment (Immediate)") : (isAr ? "المكافأة (فورية)" : "Reward (Immediate)");
      fieldsRef.reward.hint.textContent = isB
        ? (isAr ? "ما العقوبة الفورية إذا استسلمت؟" : "Immediate consequence if you fail?")
        : (isAr ? "كافئ نفسك فوراً — مثال: قهوة، شوكولاتة صغيرة، شربة ماء بارد" : "Reward yourself immediately");
      fieldsRef.reward.input.setAttribute("placeholder", isB
        ? (isAr ? "مثال: التبرع بـ 50 ريال كعقوبة" : "e.g. Donate 50 SAR as penalty")
        : (isAr ? "مثال: كوب قهوة مفضل" : "e.g. Favorite cup of coffee"));
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
  }

  createAtomicField(parent, initialValue, onInput) {
    const group = parent.createDiv({ cls: "form-group-clean dh-atomic-field" });
    const labelContainer = group.createDiv({ cls: "dh-atomic-label-container" });

    const textWrapper = labelContainer.createDiv({ cls: "dh-atomic-label-wrapper" });
    const label = textWrapper.createEl("label", { cls: "form-label-clean" });

    // Hint text placed right below the label
    const hint = labelContainer.createDiv({ cls: "dh-atomic-hint" });

    const input = group.createEl("textarea", { cls: "form-input dh-atomic-input dh-auto-textarea" });

    input.setAttribute("rows", "2");
    input.value = initialValue;

    const autoResize = () => {
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight}px`;
    };
    input.oninput = (e) => { onInput(e.target.value); autoResize(); };
    setTimeout(autoResize, 0);

    return { group, label, hint, input };
  }

  renderGradationSection(panel, t, isAr) {
    const levelsSection = panel.createDiv({ cls: "form-section dh-gradation-section" });
    const heroSection = levelsSection.createDiv({ cls: "gradation-hero-section" });


    heroSection.createDiv({
      cls: `gradation-hint ${this.formState.useLevels ? "is-visible" : ""}`,
      text: isAr ? "تدرج في عملك حتى تصل لغايتك" : "Graduate in your work until you reach your goal"
    });

    const levelsCont = levelsSection.createDiv({ cls: "levels-container-clean" });
    levelsCont.style.display = this.formState.useLevels ? "block" : "none";

    const explanationDiv = levelsSection.createDiv({ cls: "dh-gradation-explanation" });
    explanationDiv.style.display = this.formState.useLevels ? "block" : "none";
    explanationDiv.createEl("p", {
      text: isAr
        ? "💡 فكرة التدرج: العادات الكبرى تبدأ بخطوات صغيرة جداً. ركز فقط على المرحلة الحالية وتلبية 'شرط الانتقال'. الاستمرارية تسبق الكمية."
        : "💡 Gradation Method: Big habits start with tiny steps. Focus only on the current level until you meet the 'Condition'."
    });


    const tableHeader = levelsCont.createDiv({ cls: "levels-header-clean" });
    tableHeader.createSpan({ text: "#" });
    const colsHeader = tableHeader.createDiv({ cls: "levels-cols-header-clean" });
    colsHeader.createSpan({ text: isAr ? "مستوى العادة المستهدف" : "Target Habit Level" });
    colsHeader.createSpan({ text: isAr ? "شرط الانتقال" : "Condition" });

    const conditionOptionsAr = [
      { v: "", l: "اختر الشرط..." },
      { v: "7 أيام متواصلة", l: "7 أيام متواصلة" },
      { v: "14 يوماً متواصلة", l: "14 يوماً متواصلة" },
      { v: "21 يوماً متواصلة", l: "21 يوماً متواصلة" },
      { v: "30 يوماً متواصلة", l: "30 يوماً متواصلة" },
      { v: "بدون شرط (أسلوب حياة)", l: "بدون شرط (أسلوب حياة)" },
    ];
    const conditionOptionsEn = [
      { v: "", l: "Select condition..." },
      { v: "7 continuous days", l: "7 continuous days" },
      { v: "14 continuous days", l: "14 continuous days" },
      { v: "21 continuous days", l: "21 continuous days" },
      { v: "30 continuous days", l: "30 continuous days" },
      { v: "No condition (Lifestyle)", l: "No condition (Lifestyle)" },
    ];

    const placeholders = isAr ? [
      "أقل القليل: آية واحدة، أو عدة ضغط واحدة",
      "البداية الفعلية: صفحة، أو 5 دقائق رياضة",
      "الزيادة المعتدلة: صفحتين/ربع حزب، أو 15 دقيقة رياضة",
      "مستوى التحدي: 10 صفحات/نصف جزء، أو 30 دقيقة رياضة",
      "الغاية المنشودة: جزء يومياً، أو 45 دقيقة رياضة"
    ] : [
      "Atomic start: 1 verse, or 1 push-up",
      "Real start: 1 page, or 5 min exercise",
      "Moderate growth: 2 pages, or 15 min exercise",
      "Challenge level: half juz, or 30 min exercise",
      "Ultimate goal: 1 full juz, or 45 min workout"
    ];

    const opts = isAr ? conditionOptionsAr : conditionOptionsEn;

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
            new Notice(isAr ? "املأ الهدف والشرط أولاً" : "Fill goal and condition first");
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
        opts.forEach(opt => {
          conditionSelect.createEl("option", { text: opt.l, value: opt.v });
        });
        conditionSelect.value = this.formState.levelData[i].condition || "";
        conditionSelect.disabled = isDone;
        conditionSelect.onchange = (e) => (this.formState.levelData[i].condition = e.target.value);
      }
    };
    renderLevels();
  }



  renderFooter(container, t, isAr) {
    const footer = container.createDiv({ cls: "dh-modal-actions" });

    const saveBtn = footer.createEl("button", {
      text: isAr ? "💾 حفظ" : "💾 Save",
      cls: "mod-cta",
    });

    const cancelBtn = footer.createEl("button", { text: isAr ? "إلغاء" : "Cancel" });
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

/**
 * Progress modal for batch renaming operations
 */
export { AddHabitModal };