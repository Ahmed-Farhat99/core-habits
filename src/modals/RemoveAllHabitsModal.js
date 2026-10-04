import { BaseHabitModal } from './BaseHabitModal.js';

export class RemoveAllHabitsModal extends BaseHabitModal {
  constructor(app, plugin, count, onConfirm) {
    super(app, plugin);
    this.count = count;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    super.onOpen();
    const { contentEl, modalEl } = this;
    const t = (k, params = {}) => this.plugin.translationManager.t(k, params);

    contentEl.addClass("daily-habits-modal", "dh-remove-all-modal");
    modalEl.addClass("dh-popup-modal-parent");

    const expectedWord = t("settings_confirm_remove_word") || (this.plugin.settings?.language === "ar" ? "إزالة" : "remove");

    const header = contentEl.createDiv({ cls: "dh-popup-header" });
    header.createSpan({ cls: "dh-popup-header-icon warning", text: "⚠️" });
    const headerText = header.createDiv({ cls: "dh-popup-header-text" });
    headerText.createDiv({ cls: "dh-popup-title", text: t("settings_remove_all") });

    contentEl.createEl("p", {
      text: t("settings_remove_all_warning", { count: this.count }),
      cls: "dh-danger-desc"
    });

    contentEl.createEl("p", {
      text: t("settings_type_remove_to_confirm", { word: expectedWord }),
      cls: "dh-danger-prompt"
    });

    const input = contentEl.createEl("input", {
      type: "text",
      cls: "dh-confirm-input",
      placeholder: expectedWord
    });

    const footer = contentEl.createDiv({ cls: "dh-modal-actions dh-popup-footer-right" });

    const cancelBtn = footer.createEl("button", {
      text: t("cancel"),
      cls: "dh-btn mod-cancel",
      type: "button"
    });

    const confirmBtn = footer.createEl("button", {
      text: t("settings_remove_all_btn"),
      cls: "dh-btn mod-warning mod-danger",
      type: "button"
    });
    confirmBtn.disabled = true;

    input.addEventListener("input", () => {
      const val = input.value.trim().toLowerCase();
      const match = val === expectedWord.toLowerCase();
      confirmBtn.disabled = !match;
      confirmBtn.classList.toggle("is-active", match);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !confirmBtn.disabled) {
        e.preventDefault();
        confirmBtn.click();
      }
    });

    confirmBtn.onclick = async () => {
      if (confirmBtn.disabled) return;
      confirmBtn.disabled = true;
      this.close();
      if (this.onConfirm) {
        await this.onConfirm();
      }
    };

    cancelBtn.onclick = () => {
      this.close();
    };

    setTimeout(() => input.focus(), 60);
  }
}
