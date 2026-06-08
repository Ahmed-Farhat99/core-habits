import { Modal } from 'obsidian';

class RenameProgressModal extends Modal {
  constructor(app, plugin, totalFiles, onCancel) {
    super(app);
    this.plugin = plugin;
    this.totalFiles = totalFiles;
    this.processed = 0;
    this.onCancel = onCancel;
    this.cancelled = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("rename-progress-modal");

    // Header
    const isAr = this.plugin.settings.language === "ar";
    contentEl.setAttr("dir", isAr ? "rtl" : "ltr");

    contentEl.createEl("h2", {
      text: isAr ? "جارٍ تحديث الملفات..." : "Updating files..."
    });

    // Progress Bar Container
    const barContainer = contentEl.createDiv({ cls: "progress-bar-container" });
    this.progressBar = barContainer.createDiv({ cls: "progress-bar-fill" });
    this.progressBar.style.width = "0%";

    // Progress Text
    this.progressText = contentEl.createEl("p", {
      text: `0 / ${this.totalFiles}`,
      cls: "progress-text",
    });

    // Cancel Button
    const footer = contentEl.createDiv({ cls: "modal-button-container" });
    const cancelBtn = footer.createEl("button", {
      text: isAr ? "إلغاء" : "Cancel",
      cls: "mod-warning",
    });
    cancelBtn.onclick = () => {
      this.cancelled = true;
      if (this.onCancel) this.onCancel();
      this.close();
    };
  }

  updateProgress(current, total) {
    this.processed = current;
    const percentage = Math.round((current / total) * 100);

    if (this.progressBar) {
      this.progressBar.style.width = `${percentage}%`;
    }

    if (this.progressText) {
      this.progressText.textContent = `${current} / ${total}`;
    }
  }

  onClose() {
  }
}

/**
 * Modal to show progress during batch operations like renaming files
 */
export { RenameProgressModal };