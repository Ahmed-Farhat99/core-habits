/**
 * EditHabitModal.js
 * Lightweight modal wrapper around HabitEditorComponent.
 * Acts as the Mobile fallback for habit editing and maintains backward compatibility.
 */
import { BaseHabitModal } from './BaseHabitModal.js';
import { HabitEditorComponent } from '../components/forms/HabitEditorComponent.js';

export class EditHabitModal extends BaseHabitModal {
  /**
   * @param {import('obsidian').App} app
   * @param {Object} plugin
   * @param {Object} habit - Existing habit object
   * @param {Function} onSubmit - (updatedData) => Promise<void>
   */
  constructor(app, plugin, habit, onSubmit) {
    super(app, plugin);
    this.habit = habit;
    this.onSubmit = onSubmit;
    this.editorComponent = null;
  }

  onOpen() {
    super.onOpen();
    this.triggerElement = document.activeElement;
    const { contentEl, modalEl } = this;

    if (modalEl) modalEl.addClass("dh-edit-habit-modal-wrapper");
    contentEl.addClass("daily-habits-modal", "dh-edit-habit-modal");

    this.editorComponent = new HabitEditorComponent(contentEl, {
      app: this.app,
      plugin: this.plugin,
      habit: this.habit,
      onSubmit: this.onSubmit,
      onClose: () => this.forceClose(),
      onHabitArchived: () => this.forceClose(),
      isModal: true
    });
  }

  get formState() {
    return this.editorComponent ? this.editorComponent.formState : {};
  }

  isDirty() {
    return this.checkDirty();
  }

  checkDirty() {
    return this.editorComponent ? this.editorComponent.checkDirty() : false;
  }

  switchTab(tabId) {
    if (this.editorComponent) {
      this.editorComponent.switchTab(tabId);
    }
  }

  safeClose() {
    if (this.editorComponent) {
      this.editorComponent.safeClose();
    } else {
      this.close();
    }
  }

  async saveHabit(btn, t) {
    if (this.editorComponent) {
      await this.editorComponent.saveHabit(btn, t);
    }
  }

  async handleLifecycleAction(btn, isArchived, t) {
    if (this.editorComponent) {
      await this.editorComponent.handleLifecycleAction(btn, isArchived, t);
    }
  }

  onClose() {
    if (this.editorComponent) {
      this.editorComponent.destroy();
      this.editorComponent = null;
    }
    this.contentEl.empty();
    if (this.triggerElement && typeof this.triggerElement.focus === "function") {
      this.triggerElement.focus();
    }
  }
}
