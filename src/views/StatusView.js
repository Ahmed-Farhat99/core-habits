export class StatusView {
  /**
   * Renders a unified empty state.
   * @param {HTMLElement} container 
   * @param {object} options 
   * @param {string} options.icon - Emoji or icon name (default: '🌱')
   * @param {string} options.title - The title text
   * @param {string} options.description - Optional description text
   * @param {object} options.button - Optional button options: { text, onClick }
   */
  static renderEmptyState(container, options = {}) {
    container.empty();
    const emptyState = container.createDiv({ cls: "dh-empty-state" });
    
    emptyState.createDiv({ 
      cls: "dh-empty-state-icon", 
      text: options.icon || "🌱" 
    });
    
    if (options.title) {
      emptyState.createDiv({ 
        cls: "dh-empty-state-title", 
        text: options.title 
      });
    }
    
    if (options.description) {
      emptyState.createDiv({ 
        cls: "dh-empty-state-desc", 
        text: options.description 
      });
    }
    
    if (options.button && options.button.text && options.button.onClick) {
      const btn = emptyState.createEl("button", {
        cls: "dh-btn dh-empty-state-btn mod-cta",
        text: options.button.text
      });
      btn.onclick = (e) => {
        e.stopPropagation();
        options.button.onClick(e);
      };
    }
    
    return emptyState;
  }

  /**
   * Renders a unified loading spinner.
   * @param {HTMLElement} container 
   * @param {string} text - Message text to show
   * @returns {object} An object with updateText function and the element
   */
  static renderLoading(container, text) {
    container.empty();
    const loadingEl = container.createDiv({ cls: "dh-loading-spinner text-center" });
    
    // Spinner icon container
    loadingEl.createDiv({ cls: "dh-spinner-icon", text: "⏳" });
    
    const textEl = loadingEl.createDiv({ cls: "dh-loading-text", text: text || "" });
    
    return {
      element: loadingEl,
      updateText: (newText) => {
        textEl.textContent = newText;
      }
    };
  }

  /**
   * Renders a unified error state.
   * @param {HTMLElement} container 
   * @param {string} text - Error message text to show
   * @param {string} icon - Optional error icon (default: '⚠️')
   * @returns {HTMLElement} The error element
   */
  static renderError(container, text, icon = "⚠️") {
    container.empty();
    const errorEl = container.createDiv({ cls: "dh-empty-state error-state" });
    
    errorEl.createDiv({ cls: "dh-empty-state-icon error-icon", text: icon });
    
    if (text) {
      errorEl.createDiv({ cls: "dh-empty-state-title error-text", text: text });
    }
    
    return errorEl;
  }

  /**
   * Renders an actionable, mobile-friendly startup failure & recovery screen.
   * Provides Retry without console reliance, copy error log to clipboard,
   * safe backup status, and expandable technical details.
   * @param {HTMLElement} container 
   * @param {object} options
   * @param {Error|any} options.error
   * @param {Function} options.onRetry
   * @param {Function} [options.t]
   * @param {boolean} [options.isAr]
   * @param {string} [options.backupFolder]
   * @returns {HTMLElement}
   */
  static renderStartupFailure(container, options = {}) {
    container.empty();
    const t = options.t || ((k) => k);
    const error = options.error;

    const wrapper = container.createDiv({ cls: "dh-empty-state error-state dh-startup-failure-state" });
    if (options.isAr) {
      wrapper.setAttribute("dir", "rtl");
    }

    // Safety icon
    wrapper.createDiv({ cls: "dh-empty-state-icon error-icon", text: "🛡️" });

    // Title
    const titleText = t("startup_failure_title") || "Core Habits could not initialize safely";
    wrapper.createDiv({ cls: "dh-empty-state-title error-text", text: titleText });

    // Reassuring explanation
    const descText = t("startup_failure_desc") || "Your habit files and data are safe. Automatic operations were paused to prevent any data loss.";
    wrapper.createDiv({ cls: "dh-empty-state-desc", text: descText });

    // Action buttons container
    const actionsEl = wrapper.createDiv({ cls: "dh-recovery-actions" });

    // Primary Retry Button
    const retryBtn = actionsEl.createEl("button", {
      cls: "dh-btn dh-recovery-retry-btn mod-cta",
      text: t("startup_failure_retry") || "Retry Loading"
    });

    retryBtn.onclick = async (e) => {
      e.stopPropagation();
      retryBtn.disabled = true;
      retryBtn.textContent = t("startup_failure_retrying") || "Retrying...";
      try {
        if (typeof options.onRetry === "function") {
          await options.onRetry();
        }
      } catch (retryErr) {
        console.error("[Core Habits] Retry failed:", retryErr);
        retryBtn.disabled = false;
        retryBtn.textContent = t("startup_failure_retry") || "Retry Loading";
      }
    };

    // Copy Error Report Button (crucial on Mobile where console is unavailable)
    const copyBtn = actionsEl.createEl("button", {
      cls: "dh-btn dh-recovery-copy-btn",
      text: t("startup_failure_copy_report") || "Copy Error Report"
    });

    const errorDetailsText = [
      `[Core Habits Startup Error Report]`,
      `Date: ${new Date().toISOString()}`,
      `Error: ${error?.name || "Error"}: ${error?.message || String(error)}`,
      error?.stack ? `Stack:\n${error.stack}` : "",
      error?.cause ? `Cause:\n${error.cause?.stack || error.cause?.message || String(error.cause)}` : "",
      `UserAgent: ${typeof navigator !== "undefined" ? navigator.userAgent : "unknown"}`
    ].filter(Boolean).join("\n\n");

    copyBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(errorDetailsText);
          const orig = copyBtn.textContent;
          copyBtn.textContent = t("startup_failure_copied") || "Copied to clipboard!";
          setTimeout(() => { copyBtn.textContent = orig; }, 3000);
        } else {
          throw new Error("Clipboard API unavailable");
        }
      } catch (err) {
        console.warn("[Core Habits] Could not copy to clipboard:", err);
        copyBtn.textContent = t("startup_failure_copy_failed") || "Failed to copy error report.";
      }
    };

    // Backup notification notice
    if (options.backupFolder) {
      let backupNotice = t("startup_failure_backups_notice", { path: options.backupFolder })
        || `Automated pre-migration backups are preserved at ${options.backupFolder}`;
      if (backupNotice.includes("{path}")) {
        backupNotice = backupNotice.replace("{path}", options.backupFolder);
      }
      wrapper.createDiv({ cls: "dh-recovery-backup-notice", text: backupNotice });
    }

    // Expandable details block (visible on tap without opening devtools)
    const detailsEl = wrapper.createEl("details", { cls: "dh-recovery-details" });
    detailsEl.createEl("summary", { text: t("startup_failure_details_title") || "Error details & recovery report" });

    const stackPre = detailsEl.createEl("pre", { cls: "dh-recovery-stack" });
    stackPre.createEl("code", { text: errorDetailsText });

    return wrapper;
  }
}
