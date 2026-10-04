/**
 * AddHabitModal.js
 * High-speed, frictionless modal for creating new habits.
 * Structured with the shared modal foundation, clean UX hierarchy,
 * and powered by HabitCharterFields as the Single Source of Truth.
 */
import { Platform } from 'obsidian';
import { NoticeService } from '../services/NoticeService.js';
import { BaseHabitModal } from './BaseHabitModal.js';
import { HabitCharterFields } from '../components/forms/HabitCharterFields.js';

export class AddHabitModal extends BaseHabitModal {
  /**
   * @param {import('obsidian').App} app
   * @param {Object} plugin
   * @param {Function} onSubmit - (habitData) => Promise<void>
   */
  constructor(app, plugin, onSubmit) {
    super(app, plugin);
    this.onSubmit = onSubmit;

    // Default form state for new habit (fast capture)
    this.formState = {
      name: "",
      habitType: "build",
      selectedColor: "teal",
      selectedParentId: null,
      selectedDays: [0, 1, 2, 3, 4, 5, 6],
      scheduleType: "daily"
    };

    this.charterFields = null;
    this.isSaving = false;
  }

  /**
   * Check if any user-facing field has been modified from its initial default value.
   * Default values do NOT constitute dirty state.
   * @returns {boolean}
   */
  isDirty() {
    const { name, habitType, selectedColor, selectedParentId, selectedDays } = this.formState;

    if (name && name.trim().length > 0) return true;
    if (habitType && habitType !== "build") return true;
    if (selectedColor && selectedColor !== "teal") return true;
    if (selectedParentId !== null && selectedParentId !== "") return true;

    // Check days: default is all 7 days [0, 1, 2, 3, 4, 5, 6]
    if (!Array.isArray(selectedDays) || selectedDays.length !== 7) return true;
    const defaultDays = [0, 1, 2, 3, 4, 5, 6];
    for (let i = 0; i < 7; i++) {
      if (!selectedDays.includes(defaultDays[i])) return true;
    }

    return false;
  }

  onOpen() {
    super.onOpen();
    this.triggerElement = document.activeElement;
    const { contentEl, modalEl } = this;

    if (modalEl) {
      modalEl.addClass("dh-add-habit-modal-wrapper");
    }
    contentEl.addClass("dh-add-habit-modal");

    const t = (k, params = {}) => this.plugin.translationManager.t(k, params);

    // 1. Standard Header using Foundation with Lucide sparkles
    const modalTitle = t("add_habit_title") || (this.isAr ? "إضافة عادة جديدة" : "Add New Habit");
    this.createModalHeader(contentEl, {
      title: modalTitle,
      lucideIcon: "sparkles",
      icon: "✨"
    });

    // 2. Modal Body using Foundation & Shared Charter Fields
    const bodyEl = this.createModalBody(contentEl, "dh-add-habit-body");
    const formContainer = bodyEl.createDiv({ cls: "habit-form-container dh-add-habit-form" });

    this.charterFields = new HabitCharterFields(formContainer, {
      mode: "create",
      formState: this.formState,
      habit: null,
      activeHabits: this.plugin?.habitManager?.getActiveHabits() || [],
      weekStartDay: this.plugin?.settings?.weekStartDay ?? 0,
      habitManager: this.plugin?.habitManager,
      t,
      onEnterSave: () => this.saveHabit(this.saveBtn, t)
    });

    // 3. Footer using Foundation (Always Visible Cancel + Create)
    const { endGroup } = this.createModalFooter(contentEl, "dh-add-habit-footer");
    endGroup.addClass("dh-modal-actions-end");

    const { cancelBtn, saveBtn } = this.createFooterButtons(endGroup, {
      cancelText: t("cancel") || "Cancel",
      saveText: t("create_habit_btn") || (this.isAr ? "إنشاء العادة" : "Create habit"),
      onCancel: () => this.close(),
      onSave: async () => await this.saveHabit(saveBtn, t)
    });

    cancelBtn.addClass("dh-cancel-btn");
    saveBtn.addClass("dh-create-btn");
    this.saveBtn = saveBtn;

    // Mobile scroll focus
    if (Platform.isMobile) {
      contentEl.querySelectorAll('input, textarea, select').forEach(el => {
        el.addEventListener('focus', () => {
          setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
        });
      });
    }

    // Autofocus name input immediately
    setTimeout(() => {
      if (this.charterFields) {
        this.charterFields.focusNameInput();
      }
    }, 50);
  }

  async saveHabit(saveBtn, t) {
    if (this.isSaving) return;
    try {
      this.isSaving = true;
      const btn = saveBtn || this.saveBtn;
      if (btn) btn.disabled = true;

      if (!this.charterFields || !this.charterFields.validateName()) {
        const errorMsg = t("error_name_required") || "Habit name is required";
        NoticeService.warning(errorMsg, this.plugin);
        this.isSaving = false;
        if (btn) btn.disabled = false;
        return;
      }

      const { name, selectedDays, scheduleType, selectedParentId, selectedColor } = this.formState;

      await this.onSubmit({
        name: name.trim(),
        schedule: {
          type: scheduleType === "weekly" ? "weekly" : (selectedDays.length === 7 ? "daily" : "weekly"),
          days: selectedDays
        },
        levelData: null,
        currentLevel: 1,
        habitType: this.formState.habitType || "build",
        atomicDescription: {},
        parentId: selectedParentId || null,
        color: selectedColor || "teal",
        notes: null
      });

      // Force close to bypass isDirty discard confirmation prompt on successful creation
      this.forceClose();
    } catch (e) {
      this.isSaving = false;
      const btn = saveBtn || this.saveBtn;
      if (btn) btn.disabled = false;
      NoticeService.error(e.message, this.plugin);
      console.error("[Core Habits] Add habit error:", e);
    }
  }

  onClose() {
    if (this.charterFields) {
      this.charterFields.destroy();
      this.charterFields = null;
    }
    super.onClose();
    if (this.triggerElement && typeof this.triggerElement.focus === "function") {
      this.triggerElement.focus();
    }
  }
}
