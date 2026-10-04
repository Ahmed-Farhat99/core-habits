import { Modal, setIcon } from 'obsidian';

export class BaseHabitModal extends Modal {
  /**
   * Static reference to ConfirmModal to avoid circular dependency at module evaluation time.
   * Registered by ConfirmModal upon declaration.
   * @type {typeof import('./ConfirmModal.js').ConfirmModal|null}
   */
  static ConfirmModal = null;

  constructor(app, plugin) {
    super(app);
    this.app = app;
    this.plugin = plugin;
    this._forceClose = false;
    this._isPromptingConfirm = false;

    if (!this.contentEl) {
      this.contentEl = document.createElement("div");
    }
    if (!this.modalEl) {
      this.modalEl = document.createElement("div");
    }
  }

  /**
   * Helper translation delegator
   */
  t(key, params = {}) {
    if (this.plugin?.translationManager?.t) {
      return this.plugin.translationManager.t(key, params);
    }
    return key;
  }

  /**
   * Defines whether this modal has unsaved user changes.
   * Subclasses with form state should override this.
   * Defaults to false (safe for non-lossy modals).
   * @returns {boolean}
   */
  isDirty() {
    return false;
  }

  /**
   * Closes the modal immediately, bypassing the unsaved changes check.
   * Use on successful save or when user explicitly confirmed discard.
   */
  forceClose() {
    this._forceClose = true;
    this.close();
  }

  /**
   * Safe close handler. Same contract as close().
   */
  safeClose() {
    this.close();
  }

  /**
   * Intercepts Obsidian's close() lifecycle (called on ESC, backdrop click, X-button, or programmatic close()).
   */
  close() {
    if (this._forceClose) {
      this._forceClose = false;
      this._isPromptingConfirm = false;
      super.close();
      return;
    }

    if (this._isPromptingConfirm) {
      return;
    }

    if (this.isDirty()) {
      this.promptDiscardConfirmation();
      return;
    }

    super.close();
  }

  /**
   * Shows a confirmation dialog to discard unsaved changes.
   * Reuses ConfirmModal if available, or native confirm as a graceful fallback.
   * @param {Function} [onDiscard]
   * @param {Function} [onKeepEditing]
   */
  promptDiscardConfirmation(onDiscard, onKeepEditing) {
    if (this._isPromptingConfirm) return;
    this._isPromptingConfirm = true;

    const t = (k, p = {}) => this.t(k, p);
    const isAr = this.plugin?.settings?.language === "ar" || t("direction") === "rtl";

    const title = t("confirm_discard_changes_title") || (isAr ? "تعديلات غير محفوظة" : "Unsaved Changes");
    const message = t("confirm_discard_changes_desc") || (isAr ? "لديك تعديلات غير محفوظة، هل أنت متأكد من تجاهلها؟" : "You have unsaved changes. Are you sure you want to discard them?");
    const discardText = t("discard_changes_btn") || (isAr ? "تجاهل التعديلات" : "Discard changes");
    const keepText = t("keep_editing_btn") || (isAr ? "متابعة التعديل" : "Keep editing");

    const ConfirmClass = BaseHabitModal.ConfirmModal;
    if (ConfirmClass) {
      const confirmModal = new ConfirmClass(
        this.app,
        this.plugin,
        message,
        {
          title: title,
          confirmText: discardText,
          cancelText: keepText,
          isDanger: true,
          onConfirm: () => {
            this._isPromptingConfirm = false;
            if (typeof onDiscard === "function") {
              onDiscard();
            } else {
              this.forceClose();
            }
          },
          onCancel: () => {
            this._isPromptingConfirm = false;
            if (typeof onKeepEditing === "function") {
              onKeepEditing();
            }
          }
        }
      );
      confirmModal.open();
    } else {
      // Graceful fallback (e.g. standalone test environments)
      const confirmed = typeof window !== "undefined" && typeof window.confirm === "function"
        ? window.confirm(message)
        : true;

      this._isPromptingConfirm = false;
      if (confirmed) {
        if (typeof onDiscard === "function") onDiscard();
        else this.forceClose();
      } else {
        if (typeof onKeepEditing === "function") onKeepEditing();
      }
    }
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    const dir = this.t("direction") || (this.plugin?.settings?.language === "ar" ? "rtl" : "ltr");

    if (modalEl) {
      modalEl.addClass("daily-habits-plugin", "dh-modal-wrapper");
      if (typeof modalEl.setAttr === "function") {
        modalEl.setAttr("dir", dir);
      } else if (modalEl.setAttribute) {
        modalEl.setAttribute("dir", dir);
      }
      if (dir === "rtl") {
        modalEl.addClass("is-rtl");
      } else {
        modalEl.removeClass("is-rtl");
      }
    }

    if (contentEl) {
      contentEl.empty();
      contentEl.addClass("daily-habits-plugin", "daily-habits-modal");

      if (typeof contentEl.setAttr === "function") {
        contentEl.setAttr("dir", dir);
      } else if (contentEl.setAttribute) {
        contentEl.setAttribute("dir", dir);
      }
      if (dir === "rtl") {
        contentEl.addClass("is-rtl");
      } else {
        contentEl.removeClass("is-rtl");
      }
    }
  }

  onClose() {
    this._isPromptingConfirm = false;
    this._forceClose = false;

    // Clean up any active voice recorder if attached to the modal
    if (this.voiceRecorder && typeof this.voiceRecorder.cancelRecording === "function") {
      this.voiceRecorder.cancelRecording();
    }

    if (this.contentEl) {
      this.contentEl.empty();
    }
  }

  // ─── Shared UI Construction Helpers ─────────────────────────────────────────

  /**
   * Creates a standardized modal header
   * @param {HTMLElement} parentEl
   * @param {Object} options
   * @param {string} options.title
   * @param {string} [options.icon]
   * @param {string} [options.subtitle]
   * @returns {HTMLElement}
   */
  createModalHeader(parentEl, { title, icon = null, lucideIcon = null, subtitle = null }) {
    const header = parentEl.createDiv({ cls: "dh-modal-header" });
    const startWrap = header.createDiv({ cls: "dh-modal-header-start" });

    const resolvedIcon = lucideIcon || icon;
    if (resolvedIcon) {
      const iconSpan = startWrap.createSpan({ cls: "dh-modal-header-icon" });
      let renderedSvg = false;
      if (typeof resolvedIcon === "string" && !/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]/u.test(resolvedIcon)) {
        try {
          setIcon(iconSpan, resolvedIcon);
          renderedSvg = Boolean(iconSpan.querySelector("svg"));
        } catch { /* fallback in test or minimal env */ }
      }
      if (!renderedSvg) {
        iconSpan.textContent = resolvedIcon;
      }
    }

    const textWrap = startWrap.createDiv({ cls: "dh-modal-header-text" });
    textWrap.createEl("h2", { cls: "dh-modal-title", text: title });

    if (subtitle) {
      textWrap.createDiv({ cls: "dh-modal-subtitle", text: subtitle });
    }

    return header;
  }

  /**
   * Creates a standardized modal body
   * @param {HTMLElement} parentEl
   * @param {string} [customCls]
   * @returns {HTMLElement}
   */
  createModalBody(parentEl, customCls = "") {
    return parentEl.createDiv({ cls: `dh-modal-body ${customCls}`.trim() });
  }

  /**
   * Creates a standardized modal footer with start & end action groups
   * @param {HTMLElement} parentEl
   * @param {string} [customCls]
   * @returns {{ footerEl: HTMLElement, startGroup: HTMLElement, endGroup: HTMLElement }}
   */
  createModalFooter(parentEl, customCls = "") {
    const footerEl = parentEl.createDiv({ cls: `dh-modal-footer ${customCls}`.trim() });
    const startGroup = footerEl.createDiv({ cls: "dh-modal-footer-start" });
    const endGroup = footerEl.createDiv({ cls: "dh-modal-footer-end" });
    return { footerEl, startGroup, endGroup };
  }

  /**
   * Standardized footer buttons helper with consistent DOM ordering
   * Order: [Cancel] then [Primary Action]
   * @param {HTMLElement} container
   * @param {Object} options
   * @param {string} [options.cancelText]
   * @param {string} [options.saveText]
   * @param {boolean} [options.isDanger=false]
   * @param {Function} [options.onCancel]
   * @param {Function} [options.onSave]
   * @returns {{ cancelBtn: HTMLButtonElement, saveBtn: HTMLButtonElement }}
   */
  createFooterButtons(container, {
    cancelText = null,
    saveText = null,
    isDanger = false,
    onCancel = null,
    onSave = null
  } = {}) {
    const isAr = this.plugin?.settings?.language === "ar" || this.t("direction") === "rtl";
    const resolvedCancelText = cancelText || this.t("cancel") || (isAr ? "إلغاء" : "Cancel");
    const resolvedSaveText = saveText || this.t("save_btn") || (isAr ? "حفظ" : "Save");

    const cancelBtn = container.createEl("button", {
      text: resolvedCancelText,
      cls: "dh-btn mod-cancel",
      type: "button"
    });

    const saveBtn = container.createEl("button", {
      text: resolvedSaveText,
      cls: `dh-btn ${isDanger ? "mod-warning mod-danger" : "mod-cta mod-primary"}`,
      type: "button"
    });

    if (onCancel) {
      cancelBtn.onclick = () => onCancel();
    } else {
      cancelBtn.onclick = () => this.close();
    }

    if (onSave) {
      saveBtn.onclick = async () => await onSave();
    }

    return { cancelBtn, saveBtn };
  }
}
