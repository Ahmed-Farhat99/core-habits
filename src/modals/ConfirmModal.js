import { BaseHabitModal } from './BaseHabitModal.js';

export class ConfirmModal extends BaseHabitModal {
  constructor(app, plugin, message, options = {}) {
    super(app, plugin);
    this.message = message;
    this.options = options;
  }

  onOpen() {
    super.onOpen();
    const { contentEl, modalEl } = this;
    const t = (k, params = {}) => this.plugin.translationManager.t(k, params);

    contentEl.addClass("daily-habits-modal");
    contentEl.addClass("dh-popup-compact");
    modalEl.addClass("dh-popup-modal-parent");

    const header = contentEl.createDiv({ cls: "dh-popup-header" });
    header.createSpan({ cls: "dh-popup-header-icon warning", text: "⚠️" });
    const headerText = header.createDiv({ cls: "dh-popup-header-text" });
    headerText.createDiv({ cls: "dh-popup-title", text: this.message });

    const footer = contentEl.createDiv({ cls: "dh-modal-actions dh-popup-footer-right" });

    const confirmBtn = footer.createEl("button", {
      text: this.options.confirmText || t("yes_sure"),
      cls: "dh-btn mod-warning"
    });

    const cancelBtn = footer.createEl("button", {
      text: this.options.cancelText || t("cancel"),
      cls: "dh-btn"
    });

    confirmBtn.onclick = async () => {
      this.close();
      if (this.options.onConfirm) {
        await this.options.onConfirm();
      }
    };

    cancelBtn.onclick = () => {
      this.close();
      if (this.options.onCancel) {
        this.options.onCancel();
      }
    };
  }
}
