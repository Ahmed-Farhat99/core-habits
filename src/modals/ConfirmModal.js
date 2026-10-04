import { BaseHabitModal } from './BaseHabitModal.js';
import { Utils } from '../utils/Utils.js';

export class ConfirmModal extends BaseHabitModal {
  constructor(app, plugin, message, options = {}) {
    super(app, plugin);
    this.message = message;
    this.options = options;
  }

  onOpen() {
    super.onOpen();
    const { contentEl, modalEl } = this;
    const t = (k, params = {}) => this.plugin?.translationManager ? this.plugin.translationManager.t(k, params) : k;

    contentEl.addClass("daily-habits-modal", "dh-popup-compact");
    if (modalEl) modalEl.addClass("dh-popup-modal-parent");

    const isDanger = this.options.isDanger !== false;
    const header = contentEl.createDiv({ cls: "dh-popup-header" });
    const iconChar = this.options.icon || (isDanger ? "⚠️" : "ℹ️");
    header.createSpan({
      cls: `dh-popup-header-icon ${isDanger ? "warning" : "info"}`,
      text: iconChar
    });

    const headerText = header.createDiv({ cls: "dh-popup-header-text" });

    const modalTitle = this.options.title || this.options.dialogTitle;
    if (modalTitle) {
      headerText.createDiv({ cls: "dh-popup-title", text: modalTitle });
      headerText.createDiv({ cls: "dh-popup-meta", text: this.message });
    } else {
      headerText.createDiv({ cls: "dh-popup-title", text: this.message });
    }

    const footer = contentEl.createDiv({ cls: "dh-modal-actions dh-popup-footer-right" });

    this._actionTaken = false;

    const cancelBtn = footer.createEl("button", {
      text: this.options.cancelText || t("cancel") || "إلغاء",
      cls: "dh-btn mod-cancel",
      type: "button"
    });

    const confirmBtn = footer.createEl("button", {
      text: this.options.confirmText || t("yes_sure") || "نعم، متأكد",
      cls: `dh-btn ${isDanger ? "mod-warning mod-danger" : "mod-cta"}`,
      type: "button"
    });

    confirmBtn.onclick = async () => {
      this._actionTaken = true;
      this.close();
      if (this.options.onConfirm) {
        await this.options.onConfirm();
      }
    };

    cancelBtn.onclick = () => {
      this._actionTaken = true;
      this.close();
      if (this.options.onCancel) {
        this.options.onCancel();
      }
    };

    // Keyboard support: Enter triggers confirm action
    contentEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        confirmBtn.click();
      }
    });

    // Safe focus: focus cancel for destructive actions, confirm for non-destructive
    setTimeout(() => {
      if (!isDanger) {
        confirmBtn.focus();
      } else {
        cancelBtn.focus();
      }
    }, 50);
  }

  onClose() {
    if (!this._actionTaken) {
      this._actionTaken = true;
      if (this.options.onCancel) {
        this.options.onCancel();
      }
    }
    super.onClose();
  }
}

// Register on BaseHabitModal and Utils to avoid circular ES module imports
BaseHabitModal.ConfirmModal = ConfirmModal;
Utils.ConfirmModal = ConfirmModal;
