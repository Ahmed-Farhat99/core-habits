import { BaseHabitModal } from './BaseHabitModal.js';
import { Utils } from '../utils/Utils.js';
import { NoticeService } from '../services/NoticeService.js';

class RenameProgressModal extends BaseHabitModal {
  constructor(app, plugin, totalFiles, onCancel) {
    super(app, plugin);
    this.totalFiles = totalFiles;
    this.processed = 0;
    this.onCancel = onCancel;
    this.cancelled = false;
  }

  onOpen() {
    super.onOpen();
    const { contentEl } = this;
    contentEl.addClass("rename-progress-modal");

    // Header
    const t = (key) => this.plugin.translationManager.t(key);

    contentEl.createEl("h2", {
      text: t("rename_updating")
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
    const footer = contentEl.createDiv({ cls: "dh-modal-actions dh-popup-footer-right" });
    const cancelBtn = footer.createEl("button", {
      text: t("cancel"),
      cls: "dh-btn mod-cancel",
      type: "button"
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
    super.onClose();
  }

  /**
   * Encapsulates the UI confirmation, progress modal, and notices for batch renaming.
   */
  static async runBatchRenameWorkflow(app, plugin, { oldName, newName, prep, execute }) {
    const t = (key, params) => plugin.translationManager ? plugin.translationManager.t(key, params) : key;
    if (!prep.needsConfirmation) {
      NoticeService.info(t("rename_no_files_notice"), { plugin });
      return;
    }

    const confirmed = await new Promise((resolve) => {
      Utils.confirmDialog(
        app,
        plugin,
        t("rename_confirm_desc", { oldName, newName, count: prep.fileCount }),
        {
          dialogTitle: t("rename_confirm_title"),
          confirmText: t("rename_confirm_btn_all"),
          cancelText: t("cancel"),
          isDanger: true,
          icon: "⚠️",
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false)
        }
      );
    });

    if (confirmed) {
      let cancelRequested = false;
      const progressModal = new RenameProgressModal(
        app, plugin, prep.fileCount, () => { cancelRequested = true; }
      );
      if (progressModal.contentEl) {
        progressModal.open();
      }

      try {
        const result = await execute(
          (curr, total) => {
            if (progressModal.updateProgress) progressModal.updateProgress(curr, total);
          },
          () => cancelRequested
        );
        if (progressModal.close) progressModal.close();
        if (cancelRequested) {
          NoticeService.warning(t("rename_cancelled_notice", { count: result?.updated || 0 }), { plugin });
        } else {
          NoticeService.success(t("rename_success_notice", { count: result?.updated || 0 }), { plugin });
        }
      } catch (err) {
        if (progressModal.close) progressModal.close();
        console.error(err);
        NoticeService.error(t("rename_error_notice"), { plugin });
      }
    }
  }
}

/**
 * Modal to show progress during batch operations like renaming files
 */
export { RenameProgressModal };