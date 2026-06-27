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
}
