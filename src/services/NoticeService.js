import { Notice } from 'obsidian';

/**
 * NoticeService
 * Centralized, unified toast & notice manager for Core Habits.
 * 
 * ARCHITECTURAL DESIGN:
 * 1. Wraps Obsidian's native Notice API so toasts integrate with the host's toast stack.
 * 2. Enforces .daily-habits-plugin and dir="rtl" / dir="ltr" on notice.noticeEl for complete Design System token inheritance.
 * 3. Prevents BiDi text reordering bugs using semantic <bdi> isolation.
 * 4. Standardizes interactive action toasts (Reminder on open, Undo removal).
 * 5. Uses design system buttons (.dh-btn) and tokens exclusively.
 */
export class NoticeService {
  /**
   * Helper to wrap counts or numbers in BiDi isolation tags.
   * @param {number|string} count
   * @returns {string}
   */
  static wrapCount(count) {
    return `<bdi class="dh-notice-count">${count}</bdi>`;
  }

  /**
   * Resolves the current reading direction ('rtl' or 'ltr').
   * @param {Object} [plugin]
   * @returns {"rtl"|"ltr"}
   */
  static getDirection(plugin = null) {
    if (typeof plugin?.translationManager?.isRTL === "function") {
      return plugin.translationManager.isRTL() ? "rtl" : "ltr";
    }
    if (plugin?.translationManager?.t) {
      const dir = plugin.translationManager.t("direction");
      if (dir === "rtl" || dir === "ltr") return dir;
    }
    if (plugin?.settings?.language === "ar") return "rtl";
    if (typeof document !== "undefined") {
      if (document.body?.classList?.contains("is-rtl") || document.documentElement?.dir === "rtl") {
        return "rtl";
      }
    }
    return "ltr";
  }

  /**
   * Prepares the Obsidian notice element with proper plugin scope and direction.
   * @param {Notice} notice
   * @param {Object} [plugin]
   * @returns {HTMLElement}
   */
  static prepareNoticeEl(notice, plugin = null) {
    const el = notice.noticeEl;
    if (!el) return el;

    el.addClass("daily-habits-plugin", "dh-notice");
    const dir = NoticeService.getDirection(plugin);
    el.setAttribute("dir", dir);
    if (dir === "rtl") {
      el.addClass("is-rtl");
    } else {
      el.removeClass("is-rtl");
    }
    return el;
  }

  /**
   * Robustly parses duration and plugin arguments across multiple invocation styles:
   * - (message, duration, plugin)
   * - (message, { plugin, duration })
   * - (message, { plugin })
   * - (message, plugin)
   * - (message, duration)
   * @private
   */
  static _parseArgs(durationOrOptions, defaultDuration, plugin) {
    let duration = defaultDuration;
    let actualPlugin = plugin;

    if (durationOrOptions && typeof durationOrOptions === "object") {
      if (typeof durationOrOptions.duration === "number") {
        duration = durationOrOptions.duration;
      }
      if (durationOrOptions.plugin) {
        actualPlugin = durationOrOptions.plugin;
      } else if (durationOrOptions.manifest || durationOrOptions.translationManager || durationOrOptions.settings) {
        actualPlugin = durationOrOptions;
      }
    } else if (typeof durationOrOptions === "number") {
      duration = durationOrOptions;
    }

    return { duration, plugin: actualPlugin };
  }

  /**
   * Shows a standard text notice with proper plugin context and direction.
   * @param {string} message
   * @param {number|Object} [durationOrOptions=4000]
   * @param {Object} [plugin=null]
   * @returns {Notice}
   */
  static show(message, durationOrOptions = 4000, plugin = null) {
    const { duration, plugin: actualPlugin } = NoticeService._parseArgs(durationOrOptions, 4000, plugin);
    const notice = new Notice(message, duration);
    NoticeService.prepareNoticeEl(notice, actualPlugin);
    return notice;
  }

  /**
   * Shows an informative notice.
   * @param {string} message
   * @param {number|Object} [durationOrOptions=4000]
   * @param {Object} [plugin=null]
   * @returns {Notice}
   */
  static info(message, durationOrOptions = 4000, plugin = null) {
    return NoticeService.show(message, durationOrOptions, plugin);
  }

  /**
   * Shows a success notice with green accent indicator.
   * @param {string} message
   * @param {number|Object} [durationOrOptions=4000]
   * @param {Object} [plugin=null]
   * @returns {Notice}
   */
  static success(message, durationOrOptions = 4000, plugin = null) {
    const { duration, plugin: actualPlugin } = NoticeService._parseArgs(durationOrOptions, 4000, plugin);
    const notice = new Notice(message, duration);
    const el = NoticeService.prepareNoticeEl(notice, actualPlugin);
    if (el) el.addClass("dh-notice-success");
    return notice;
  }

  /**
   * Shows a warning notice.
   * @param {string} message
   * @param {number|Object} [durationOrOptions=6000]
   * @param {Object} [plugin=null]
   * @returns {Notice}
   */
  static warning(message, durationOrOptions = 6000, plugin = null) {
    const { duration, plugin: actualPlugin } = NoticeService._parseArgs(durationOrOptions, 6000, plugin);
    const notice = new Notice(message, duration);
    const el = NoticeService.prepareNoticeEl(notice, actualPlugin);
    if (el) el.addClass("dh-notice-warning");
    return notice;
  }

  /**
   * Alias for warning notice to guarantee API resilience.
   * @param {string} message
   * @param {number|Object} [durationOrOptions=6000]
   * @param {Object} [plugin=null]
   * @returns {Notice}
   */
  static warn(message, durationOrOptions = 6000, plugin = null) {
    return NoticeService.warning(message, durationOrOptions, plugin);
  }

  /**
   * Shows an error notice with danger accent indicator.
   * @param {string} message
   * @param {number|Object} [durationOrOptions=8000]
   * @param {Object} [plugin=null]
   * @returns {Notice}
   */
  static error(message, durationOrOptions = 8000, plugin = null) {
    const { duration, plugin: actualPlugin } = NoticeService._parseArgs(durationOrOptions, 8000, plugin);
    const notice = new Notice(message, duration);
    const el = NoticeService.prepareNoticeEl(notice, actualPlugin);
    if (el) el.addClass("dh-notice-error");
    return notice;
  }

  /**
   * Shows an interactive action toast (e.g. startup incomplete habits reminder).
   * Ensures BiDi isolation for counts and proper button placement.
   * 
   * @param {Object} options
   * @param {string} [options.icon="📋"]
   * @param {number|string} [options.count=null]
   * @param {string} options.message
   * @param {string} options.actionText
   * @param {Function} options.onAction
   * @param {number} [options.duration=12000]
   * @param {Object} [options.plugin=null]
   * @returns {Notice}
   */
  static action({
    icon = "📋",
    count = null,
    message,
    actionText,
    onAction,
    onClose = null,
    duration = 12000,
    plugin = null
  }) {
    const notice = new Notice("", duration);
    const container = notice.noticeEl;
    if (!container) return notice;

    container.empty();
    NoticeService.prepareNoticeEl(notice, plugin);

    const content = container.createDiv({ cls: "dh-notice-content" });

    // Text & Count section with BiDi protection
    const textGroup = content.createDiv({ cls: "dh-notice-text-group" });
    if (icon) {
      textGroup.createSpan({ cls: "dh-notice-icon", text: icon });
    }
    if (count !== null && count !== undefined) {
      textGroup.createEl("bdi", { cls: "dh-notice-count", text: String(count) });
    }
    textGroup.createSpan({ cls: "dh-notice-message", text: message });

    // Action buttons
    const actionsGroup = content.createDiv({ cls: "dh-notice-actions" });
    const btn = actionsGroup.createEl("button", {
      cls: "dh-btn dh-btn-sm mod-cta dh-notice-action-btn",
      text: actionText,
      type: "button"
    });

    btn.onclick = () => {
      notice.hide();
      if (typeof onAction === "function") {
        onAction();
      }
    };

    if (onClose) {
      const closeBtn = actionsGroup.createEl("button", {
        cls: "dh-btn dh-btn-sm mod-ghost dh-notice-close-btn",
        text: "✕",
        type: "button",
        attr: { "aria-label": "Close" }
      });
      closeBtn.onclick = () => {
        notice.hide();
        if (typeof onClose === "function") {
          onClose();
        }
      };
    }

    return notice;
  }

  /**
   * Shows an interactive Undo notice (e.g. after removing a habit).
   * 
   * @param {Object} options
   * @param {string} options.message
   * @param {string} [options.undoText="Undo"]
   * @param {Function} options.onUndo
   * @param {Function} [options.onClose]
   * @param {number} [options.duration=8000]
   * @param {Object} [options.plugin=null]
   * @returns {Notice}
   */
  static undo({
    message,
    undoText = "Undo",
    onUndo,
    onClose = null,
    duration = 8000,
    plugin = null
  }) {
    const notice = new Notice("", duration);
    const container = notice.noticeEl;
    if (!container) return notice;

    container.empty();
    NoticeService.prepareNoticeEl(notice, plugin);

    const content = container.createDiv({ cls: "dh-notice-content dh-notice-undo-content" });

    content.createSpan({ cls: "dh-notice-message", text: message });

    const actionsGroup = content.createDiv({ cls: "dh-notice-actions" });

    const undoBtn = actionsGroup.createEl("button", {
      cls: "dh-btn dh-btn-sm mod-cta dh-notice-undo-btn",
      text: undoText,
      type: "button"
    });

    const closeBtn = actionsGroup.createEl("button", {
      cls: "dh-btn dh-btn-sm mod-ghost dh-notice-close-btn",
      text: "✕",
      type: "button",
      attr: { "aria-label": "Close" }
    });

    undoBtn.onclick = () => {
      notice.hide();
      if (typeof onUndo === "function") {
        onUndo();
      }
    };

    closeBtn.onclick = () => {
      notice.hide();
      if (typeof onClose === "function") {
        onClose();
      }
    };

    return notice;
  }
}
