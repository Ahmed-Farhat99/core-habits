/**
 * HabitEditView.js
 * Dedicated Obsidian ItemView for editing habits inside a Native Popout Window.
 * Powered by HabitEditorComponent for zero code duplication with mobile modal.
 */
import { ItemView } from 'obsidian';
import { VIEW_TYPE_HABIT_EDIT } from '../constants.js';
import { HabitEditorComponent } from '../components/forms/HabitEditorComponent.js';

export class HabitEditView extends ItemView {
  /**
   * @param {import('obsidian').WorkspaceLeaf} leaf
   * @param {Object} plugin
   */
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.habit = null;
    this.onSubmit = null;
    this.editorComponent = null;

    this.containerEl.addClass("daily-habits-plugin", "dh-habit-edit-window");
    if (this.contentEl) {
      this.contentEl.addClass("daily-habits-plugin", "daily-habits-modal", "dh-edit-habit-modal", "dh-habit-edit-content");
    }
  }

  getViewType() {
    return VIEW_TYPE_HABIT_EDIT;
  }

  getDisplayText() {
    const t = (k, params = {}) => this.plugin?.translationManager?.t(k, params);
    const prefix = t("edit_habit_title") || (t("direction") === "rtl" ? "تعديل العادة" : "Edit Habit");
    return this.habit?.name ? `${prefix}: ${this.habit.name}` : prefix;
  }

  getIcon() {
    return "pencil";
  }

  /**
   * Ensure plugin stylesheets and theme classes are synced into the popout window document.
   */
  ensureStylesheets() {
    try {
      const targetDoc = this.containerEl?.win?.document || this.containerEl?.ownerDocument;
      const mainDoc = (typeof window !== 'undefined' ? window.document : null) || (typeof document !== 'undefined' ? document : null);
      if (!targetDoc || !mainDoc || targetDoc === mainDoc) return;

      // Sync theme classes on popout body
      if (mainDoc.body && targetDoc.body) {
        const themeClasses = Array.from(mainDoc.body.classList).filter(c => 
          c.startsWith('theme-') || c.startsWith('css-settings') || c.startsWith('mode-')
        );
        themeClasses.forEach(c => {
          if (!targetDoc.body.classList.contains(c)) {
            targetDoc.body.classList.add(c);
          }
        });
      }

      // Copy all style tags and plugin stylesheets from main window
      const mainStyles = mainDoc.querySelectorAll('style, link[rel="stylesheet"]');
      mainStyles.forEach(node => {
        const id = node.id;
        if (id && targetDoc.getElementById(id)) return;
        if (node.tagName === 'LINK') {
          const href = node.getAttribute('href');
          if (href && targetDoc.querySelector(`link[href="${href}"]`)) return;
        }
        targetDoc.head.appendChild(node.cloneNode(true));
      });
    } catch (e) {
      console.warn("[Core Habits] Could not sync stylesheets to popout window:", e);
    }
  }

  /**
   * Set or switch habit to be edited
   * @param {Object} habit
   * @param {Function} onSubmit
   */
  async setHabit(habit, onSubmit) {
    this.habit = habit;
    this.onSubmit = onSubmit;
    this.ensureStylesheets();

    this.containerEl.addClass("daily-habits-plugin", "dh-habit-edit-window");
    if (this.contentEl) {
      this.contentEl.addClass("daily-habits-plugin", "daily-habits-modal", "dh-edit-habit-modal", "dh-habit-edit-content");
    }

    const t = (k, params = {}) => this.plugin?.translationManager?.t(k, params);
    const dir = t("direction") || "ltr";
    this.containerEl.setAttribute("dir", dir);
    if (dir === "rtl") {
      this.containerEl.addClass("is-rtl");
    }

    // Update window/leaf display text in title bar
    if (typeof this.leaf?.updateHeader === "function") {
      this.leaf.updateHeader();
    }

    if (this.editorComponent) {
      this.editorComponent.setHabit(habit, async (updatedData) => {
        if (this.onSubmit) await this.onSubmit(updatedData);
        this.closeView();
      });
    } else {
      this.mountEditor();
    }
  }

  async onOpen() {
    this.ensureStylesheets();
    this.containerEl.addClass("daily-habits-plugin", "dh-habit-edit-window");
    if (this.contentEl) {
      this.contentEl.addClass("daily-habits-plugin", "daily-habits-modal", "dh-edit-habit-modal", "dh-habit-edit-content");
    }

    const t = (k, params = {}) => this.plugin?.translationManager?.t(k, params);
    const dir = t("direction") || "ltr";
    this.containerEl.setAttribute("dir", dir);
    if (dir === "rtl") {
      this.containerEl.addClass("is-rtl");
    }

    if (this.habit) {
      this.mountEditor();
    }
  }

  mountEditor() {
    this.ensureStylesheets();
    if (this.editorComponent) {
      this.editorComponent.destroy();
    }

    const targetEl = this.contentEl || this.containerEl;
    targetEl.addClass("daily-habits-plugin", "daily-habits-modal");

    this.editorComponent = new HabitEditorComponent(targetEl, {
      app: this.app,
      plugin: this.plugin,
      habit: this.habit,
      onSubmit: async (updatedData) => {
        if (this.onSubmit) await this.onSubmit(updatedData);
        this.closeView();
      },
      onClose: () => this.closeView(),
      onHabitArchived: () => this.closeView(),
      isModal: false
    });
  }

  closeView() {
    try {
      this.leaf.detach();
    } catch (e) {
      console.warn("[Core Habits] Error detaching edit leaf:", e);
    }
  }

  isDirty() {
    return this.editorComponent ? this.editorComponent.checkDirty() : false;
  }

  async onClose() {
    if (this.editorComponent) {
      this.editorComponent.destroy();
      this.editorComponent = null;
    }
  }
}
