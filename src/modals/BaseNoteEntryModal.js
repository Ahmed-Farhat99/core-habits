import { Platform, setIcon } from 'obsidian';
import { BaseHabitModal } from './BaseHabitModal.js';
import { autoResizeTextarea, getDailyNotesInfo, getDailyNotePath } from '../utils/helpers.js';
import { VoiceRecorderComponent } from '../components/VoiceRecorderComponent.js';
import { NoticeService } from '../services/NoticeService.js';
import { WikilinkSuggestComponent } from '../components/WikilinkSuggestComponent.js';

/**
 * Base modal class for single-note entry popups (HabitCommentPopup, ReflectionPopup).
 * Encapsulates compact popup layout, header creation, category picker, auto-resizing input,
 * voice recorder integration, unified button hierarchy, and dirty state tracking.
 */
export class BaseNoteEntryModal extends BaseHabitModal {
  /**
   * @param {import('obsidian').App} app
   * @param {Object} plugin
   * @param {Object} [options]
   * @param {Object} [options.date]
   * @param {Function} [options.onSave]
   * @param {string} [options.sourcePath]
   */
  constructor(app, plugin, { date = null, onSave = null, sourcePath = "" } = {}) {
    super(app, plugin);
    this.date = date;
    this.onSave = onSave;
    this.sourcePath = sourcePath;
    this.initialValue = "";
    this.inputEl = null;
    this.voiceRecorder = null;
    this.wikilinkSuggest = null;
    this.saveBtn = null;
    this.cancelBtn = null;
    this._categoryButtons = null;
  }

  onOpen() {
    super.onOpen();
    const { contentEl, modalEl } = this;
    if (contentEl) {
      contentEl.addClass("daily-habits-modal", "dh-popup-compact");
    }
    if (modalEl) {
      modalEl.addClass("dh-popup-modal-parent");
    }
  }

  isDirty() {
    if (!this.inputEl) return false;
    const current = (this.inputEl.value || "").trim();
    const initial = (this.initialValue || "").trim();
    return current !== initial;
  }

  /**
   * Formats the modal date according to current plugin language and format translation key.
   * @param {string} [formatKey="date_format_medium"]
   * @returns {string}
   */
  getFormattedDate(formatKey = "date_format_medium") {
    if (!this.date) return "";
    const lang = this.plugin?.settings?.language || "ar";
    return this.date.clone().locale(lang).format(this.t(formatKey));
  }

  /**
   * Returns the active source path for link resolution, prioritizing explicit sourcePath,
   * daily note path for modal's date, or active workspace file path.
   * @returns {string}
   */
  getSourcePath() {
    if (this.sourcePath) return this.sourcePath;
    if (this.date) {
      try {
        const info = getDailyNotesInfo(this.app, this.plugin?.settings);
        const path = getDailyNotePath(this.date, info);
        if (path) return path;
      } catch {
        // Fallback gracefully
      }
    }
    const activeFile = this.app?.workspace?.getActiveFile?.();
    if (activeFile?.path) return activeFile.path;
    return "";
  }

  /**
   * Builds the popup header with icon, title, and optional meta text.
   * @param {HTMLElement} parentEl
   * @param {Object} options
   * @param {string} [options.icon]
   * @param {string} [options.iconName]
   * @param {string} [options.titleText]
   * @param {string} [options.metaText]
   * @param {string} [options.metaHtml]
   * @returns {{ header: HTMLElement, headerText: HTMLElement, metaEl: HTMLElement }}
   */
  createPopupHeader(parentEl, { icon = "", iconName = "", titleText = "", metaText = "", metaHtml = "" } = {}) {
    const header = parentEl.createDiv({ cls: "dh-popup-header" });
    if (iconName && typeof setIcon === "function") {
      const iconEl = header.createSpan({ cls: "dh-popup-header-icon" });
      setIcon(iconEl, iconName);
    } else if (icon) {
      header.createSpan({ cls: "dh-popup-header-icon", text: icon });
    }
    const headerText = header.createDiv({ cls: "dh-popup-header-text" });
    headerText.createDiv({ cls: "dh-popup-title", text: titleText });

    const metaEl = headerText.createDiv({ cls: "dh-popup-meta" });
    if (metaHtml) {
      metaEl.innerHTML = metaHtml;
    } else {
      metaEl.textContent = metaText || "";
    }
    return { header, headerText, metaEl };
  }

  /**
   * Creates a standardized single-select category picker (e.g. Good / Bad / Lesson / Idea).
   * @param {HTMLElement} parentEl
   * @param {Object} options
   * @param {Array<{ key: string, label: string }>} options.categories
   * @param {string} options.selectedKey
   * @param {Function} options.onSelect
   * @returns {HTMLElement}
   */
  createCategoryPicker(parentEl, { categories = [], selectedKey = "", onSelect = null } = {}) {
    const container = parentEl.createDiv({ cls: "dh-reflection-type-picker", attr: { role: "radiogroup" } });
    this._categoryButtons = new Map();

    categories.forEach(({ key, label }) => {
      const isSelected = key === selectedKey;
      const btn = container.createEl("button", {
        cls: `dh-reflection-type-btn ${isSelected ? "is-active" : ""}`,
        text: label,
        type: "button",
        attr: {
          role: "radio",
          "aria-checked": isSelected ? "true" : "false"
        }
      });

      this._categoryButtons.set(key, btn);

      btn.onclick = () => {
        for (const [k, b] of this._categoryButtons.entries()) {
          const active = k === key;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-checked", active ? "true" : "false");
        }
        if (typeof onSelect === "function") {
          onSelect(key);
        }
      };
    });

    return container;
  }

  /**
   * Builds the textarea input wrapper with auto-resizing and enter-to-submit.
   * @param {HTMLElement} parentEl
   * @param {Object} [options]
   * @param {string} [options.placeholder]
   * @param {number} [options.rows=3]
   * @returns {HTMLTextAreaElement}
   */
  createNoteInput(parentEl, { placeholder = "", rows = 3 } = {}) {
    const inputWrapper = parentEl.createDiv({ cls: "dh-popup-input-wrapper" });
    const input = inputWrapper.createEl("textarea", {
      cls: "dh-popup-input dh-popup-input-standalone dh-auto-textarea",
      attr: {
        placeholder,
        rows
      }
    });
    this.inputEl = input;

    // Initialize Wikilink Autocomplete
    this.wikilinkSuggest = new WikilinkSuggestComponent({
      app: this.app,
      plugin: this.plugin,
      inputEl: input,
      containerEl: inputWrapper,
      getSourcePath: () => this.getSourcePath()
    });

    const autoResize = () => autoResizeTextarea(input);
    input.oninput = autoResize;
    setTimeout(autoResize, 0);

    input.addEventListener("keydown", (e) => {
      // Guard: If wikilink autocomplete is open, do not submit modal
      if (this.wikilinkSuggest?.isOpen) {
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.submit();
      }
    });

    return input;
  }

  /**
   * Builds the footer with VoiceRecorder on the left and Cancel/Save buttons on the right.
   * Maintains strict DOM order: [Cancel] then [Save].
   * @param {HTMLElement} parentEl
   * @param {Object} options
   * @param {string} [options.placeholderDefault]
   * @param {string} [options.cancelText]
   * @param {string} [options.saveText]
   * @returns {{ footer: HTMLElement, actionsLeft: HTMLElement, actionsRight: HTMLElement, cancelBtn: HTMLButtonElement, saveBtn: HTMLButtonElement }}
   */
  createPopupFooter(parentEl, { placeholderDefault = "", cancelText = null, saveText = null } = {}) {
    const footer = parentEl.createDiv({ cls: "dh-modal-actions dh-popup-footer-split" });

    const actionsLeft = footer.createDiv({ cls: "dh-popup-actions-left" });
    this.voiceRecorder = new VoiceRecorderComponent(actionsLeft, {
      app: this.app,
      plugin: this.plugin,
      inputEl: this.inputEl,
      placeholderDefault: placeholderDefault
    });

    const actionsRight = footer.createDiv({ cls: "dh-popup-actions-right" });

    const cancelBtn = actionsRight.createEl("button", {
      text: cancelText || this.t("cancel") || "إلغاء",
      cls: "dh-btn mod-cancel",
      type: "button"
    });
    cancelBtn.onclick = () => this.close();
    this.cancelBtn = cancelBtn;

    const saveBtn = actionsRight.createEl("button", {
      text: saveText || this.t("reflection_save") || this.t("comment_save") || "حفظ",
      cls: "dh-btn mod-cta",
      type: "button"
    });
    saveBtn.onclick = () => this.submit();
    this.saveBtn = saveBtn;

    return { footer, actionsLeft, actionsRight, cancelBtn, saveBtn };
  }

  /**
   * Strips markdown heading prefixes and excess linebreaks. Caps at 2000 chars.
   * @param {string} raw
   * @returns {string}
   */
  sanitizeText(raw) {
    return (raw || "")
      .replace(/[\r\n]+/g, " ")
      .replace(/^#+\s/gm, "")
      .substring(0, 2000)
      .trim();
  }

  /**
   * Displays input validation error animation.
   */
  showInputError() {
    if (this.inputEl) {
      this.inputEl.focus();
      this.inputEl.classList.add("dh-input-error");
      setTimeout(() => {
        if (this.inputEl) {
          this.inputEl.classList.remove("dh-input-error");
        }
      }, 1500);
    }
  }

  /**
   * Focuses the textarea and smoothly scrolls it into view on mobile.
   * @param {number} [delay=50]
   */
  focusInput(delay = 50) {
    const doFocus = () => {
      if (this.inputEl) {
        this.inputEl.focus();
        autoResizeTextarea(this.inputEl);
        if (Platform.isMobile) {
          setTimeout(() => this.inputEl?.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
        }
      }
    };

    if (delay > 0) {
      setTimeout(doFocus, delay);
    } else {
      doFocus();
    }
  }

  /**
   * Submits note content. Handles voice-recording guard, sanitation, button loading state, and save execution.
   */
  async submit() {
    if (this.voiceRecorder && this.voiceRecorder.isRecording) {
      NoticeService.warning(this.t("reflection_mic_stop_first"), { plugin: this.plugin });
      if (typeof this.voiceRecorder.pulseAttention === "function") {
        this.voiceRecorder.pulseAttention();
      }
      return;
    }

    const sanitized = this.sanitizeText(this.inputEl ? this.inputEl.value : "");
    if (!sanitized) {
      this.showInputError();
      return;
    }

    const saveBtn = this.saveBtn;
    const originalSaveText = saveBtn ? saveBtn.textContent : "";
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = this.t("reflection_saving");
    }

    try {
      await this.handleSave(sanitized);
      this.forceClose();
    } catch (e) {
      NoticeService.error(`❌ ${e.message}`, { plugin: this.plugin });
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = originalSaveText;
      }
    }
  }

  /**
   * Subclasses must implement the actual persistence logic.
   * @returns {Promise<void>}
   */
  async handleSave() {
    throw new Error("BaseNoteEntryModal: handleSave must be implemented by subclass");
  }

  onClose() {
    if (this.wikilinkSuggest && typeof this.wikilinkSuggest.destroy === "function") {
      this.wikilinkSuggest.destroy();
      this.wikilinkSuggest = null;
    }
    if (this.voiceRecorder && typeof this.voiceRecorder.cleanup === "function") {
      this.voiceRecorder.cleanup();
    }
    super.onClose();
  }
}
