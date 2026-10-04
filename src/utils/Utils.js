import { Keymap } from 'obsidian';
import { BaseHabitModal } from "../modals/BaseHabitModal.js";

export class Utils {
  /**
   * Static reference to ConfirmModal class to prevent eager module cycle.
   * Populated dynamically by ConfirmModal when loaded.
   * @type {typeof import('../modals/ConfirmModal.js').ConfirmModal|null}
   */
  static ConfirmModal = null;

  static debugLog(plugin, ...args) {
    if (plugin?.settings?.debugMode) {
      console.log("[Core Habits]", ...args);
    }
  }

  static fixAudioDuration(audioEl) {
    audioEl.addEventListener('loadedmetadata', () => {
      if (audioEl.duration === Infinity || isNaN(audioEl.duration)) {
        audioEl.currentTime = 1e101;
        audioEl.addEventListener('timeupdate', function f() {
          audioEl.currentTime = 0;
          audioEl.removeEventListener('timeupdate', f);
        });
      }
    });
  }

  /**
   * Binds click, middle-click, and hover-preview events to rendered internal and external links.
   * Ensures Obsidian native link behaviors (hover preview, open in new tab/window) work
   * in custom containers and modals.
   * @param {HTMLElement} container
   * @param {import('obsidian').App} app
   * @param {string} sourcePath
   * @param {boolean|string} [defaultNewLeaf="tab"]
   */
  static hookUpMarkdownLinks(container, app, sourcePath = "", defaultNewLeaf = "tab") {
    if (!container || !app?.workspace) return;

    // 1. Hover Preview (Page Preview on hover / Ctrl-hover according to user Obsidian settings)
    container.addEventListener("mouseover", (evt) => {
      const anchor = evt.target?.closest ? evt.target.closest("a.internal-link") : null;
      if (!anchor) return;
      const linkText = anchor.getAttribute("data-href") || anchor.getAttribute("href");
      if (linkText && app?.workspace?.trigger) {
        app.workspace.trigger("hover-link", {
          event: evt,
          source: "preview",
          hoverParent: { hoverPopover: null },
          targetEl: anchor,
          linktext: linkText,
          sourcePath
        });
      }
    });

    // 2. Click Handling (Standard click, Ctrl/Cmd click, Shift click)
    container.addEventListener("click", async (evt) => {
      const anchor = evt.target?.closest ? evt.target.closest("a") : null;
      if (!anchor) return;

      if (anchor.classList.contains("internal-link") || anchor.hasAttribute("data-href")) {
        evt.preventDefault();
        evt.stopPropagation();

        const linkText = anchor.getAttribute("data-href") || anchor.getAttribute("href");
        if (!linkText) return;

        const isMod = Keymap?.isModEvent ? Keymap.isModEvent(evt) : Boolean(evt.ctrlKey || evt.metaKey);
        const newLeaf = evt.shiftKey ? "window" : (isMod ? "tab" : defaultNewLeaf);

        try {
          await app.workspace.openLinkText(linkText, sourcePath, newLeaf);
        } catch (err) {
          console.warn("[Core Habits] Failed to open internal link:", linkText, err);
        }
      } else if (anchor.classList.contains("external-link") || anchor.getAttribute("href")?.startsWith("http")) {
        evt.preventDefault();
        evt.stopPropagation();
        const url = anchor.getAttribute("href");
        if (url) {
          window.open(url, "_blank");
        }
      }
    });

    // 3. Middle-click (Auxclick) for opening in a new tab
    container.addEventListener("auxclick", async (evt) => {
      if (evt.button !== 1) return;
      const anchor = evt.target?.closest ? evt.target.closest("a.internal-link") : null;
      if (!anchor) return;

      evt.preventDefault();
      evt.stopPropagation();

      const linkText = anchor.getAttribute("data-href") || anchor.getAttribute("href");
      if (linkText) {
        try {
          await app.workspace.openLinkText(linkText, sourcePath, "tab");
        } catch (err) {
          console.warn("[Core Habits] Failed to open link on middle click:", linkText, err);
        }
      }
    });
  }

  static getHeadingLevel(heading, defaultLevel = 2) {
    return (heading || "").trim().match(/^#+/)?.[0]?.length || defaultLevel;
  }

  static escapeRegExp(string) {
    return (string || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Finds the byte boundaries of a markdown section under the specified heading.
   * Centralizes regex parsing and level detection for all markdown section operations.
   * 
   * @param {string} content - Full markdown document or block content.
   * @param {string} heading - Heading string (e.g. "## Habits" or "Habits").
   * @param {number} [defaultLevel=2] - Fallback heading level if no leading # is present.
   * @returns {{ start: number, contentStart: number, end: number, headingLevel: number } | null}
   */
  static findSectionRange(content, heading, defaultLevel = 2) {
    if (!content || !heading) return null;
    const cleanHeading = heading.trim();
    if (!cleanHeading) return null;

    const headingRegex = new RegExp(`^${Utils.escapeRegExp(cleanHeading)}\\s*$`, "m");
    const match = content.match(headingRegex);
    if (!match) return null;

    const start = match.index;
    const contentStart = start + match[0].length;
    const headingLevel = Utils.getHeadingLevel(cleanHeading, defaultLevel);
    const nextHeadingRegex = new RegExp(`\\n#{1,${headingLevel}} `, "m");
    const afterHeading = content.substring(contentStart);
    const nextMatch = afterHeading.match(nextHeadingRegex);
    const end = nextMatch ? contentStart + nextMatch.index : content.length;

    return {
      start,
      contentStart,
      end,
      headingLevel
    };
  }

  static extractSectionLines(content, heading) {
    const range = Utils.findSectionRange(content, heading, 2);
    if (!range) return [];

    return content
      .substring(range.contentStart, range.end)
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);
  }

  static lightenHex(hex, amount = 0.2) {
    const normalize = (h) => (h || "").replace("#", "").trim();
    let h = normalize(hex);
    if (h.length === 3) {
      h = h.split("").map(ch => ch + ch).join("");
    }
    const num = parseInt(h, 16);
    if (isNaN(num)) return hex;
    const r = (num >> 16) & 0xff;
    const g = (num >> 8) & 0xff;
    const b = num & 0xff;

    const clamp = (value) => Math.min(255, Math.max(0, Math.round(value)));
    const newR = clamp(r + (255 - r) * amount);
    const newG = clamp(g + (255 - g) * amount);
    const newB = clamp(b + (255 - b) * amount);

    return `#${((1 << 24) + (newR << 16) + (newG << 8) + newB).toString(16).slice(1)}`;
  }

  /**
   * Primary semantic method for showing standard confirmation dialogs.
   * @param {import('obsidian').App} app
   * @param {Object} plugin
   * @param {string} message
   * @param {Object} [options]
   * @returns {import('../modals/ConfirmModal.js').ConfirmModal|null}
   */
  static confirmDialog(app, plugin, message, options = {}) {
    return Utils.showConfirmNotice(app, plugin, message, options);
  }

  static showConfirmNotice(app, plugin, message, options = {}) {
    if (!app || !plugin) {
      console.error("[Core Habits] showConfirmNotice is missing app or plugin context!");
      return null;
    }
    const ModalClass = Utils.ConfirmModal || BaseHabitModal?.ConfirmModal;
    if (ModalClass) {
      const { onConfirm, onCancel, confirmText, cancelText, title, dialogTitle, isDanger, icon } = options;
      const modal = new ModalClass(app, plugin, message, {
        confirmText,
        cancelText,
        onConfirm,
        onCancel,
        title: title || dialogTitle,
        dialogTitle: dialogTitle || title,
        isDanger,
        icon
      });
      modal.open();
      return modal;
    }
    // Headless or fallback test environments
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      if (window.confirm(message)) {
        options.onConfirm?.();
      } else {
        options.onCancel?.();
      }
    }
    return null;
  }

  static insertNestedContent(content, parentHeading, subHeading, newText) {
    if (!newText) return content;
    const cleanSub = (subHeading || "").trim();

    if (!parentHeading) {
      const range = Utils.findSectionRange(content, cleanSub, 2);
      if (range) {
        return content.substring(0, range.end) + "\n" + newText + content.substring(range.end);
      } else {
        const separator = (content || "").trim().length > 0 ? "\n\n" : "";
        return (content || "") + separator + cleanSub + "\n" + newText + "\n";
      }
    }

    const cleanParent = parentHeading.trim();
    const parentRange = Utils.findSectionRange(content, cleanParent, 2);

    if (!parentRange) {
      const separator = (content || "").trim().length > 0 ? "\n\n" : "";
      return (content || "") + separator + cleanParent + "\n" + cleanSub + "\n" + newText + "\n";
    }

    const parentBlock = content.substring(parentRange.contentStart, parentRange.end);
    const subRange = Utils.findSectionRange(parentBlock, cleanSub, 3);

    if (subRange) {
      const subEnd = parentRange.contentStart + subRange.end;
      let appendPos = subEnd;
      while (appendPos > 0 && content.charAt(appendPos - 1) === '\n') appendPos--;
      return content.substring(0, appendPos) + "\n" + newText + "\n\n" + content.substring(appendPos).replace(/^\n+/, '');
    } else {
      let appendPos = parentRange.end;
      while (appendPos > 0 && content.charAt(appendPos - 1) === '\n') appendPos--;
      const separator = "\n\n";
      return content.substring(0, appendPos) + separator + cleanSub + "\n" + newText + "\n\n" + content.substring(appendPos).replace(/^\n+/, '');
    }
  }

  static getSectionContent(content, parentHeading, subHeading) {
    if (!content || !subHeading) return null;
    const cleanSub = subHeading.trim();
    if (!cleanSub) return null;

    if (!parentHeading) {
      const range = Utils.findSectionRange(content, cleanSub, 2);
      return range ? content.substring(range.contentStart, range.end) : null;
    }

    const cleanParent = parentHeading.trim();
    const parentRange = Utils.findSectionRange(content, cleanParent, 2);
    if (!parentRange) return null;

    const parentBlock = content.substring(parentRange.contentStart, parentRange.end);
    const subRange = Utils.findSectionRange(parentBlock, cleanSub, 3);
    if (subRange) {
      return parentBlock.substring(subRange.contentStart, subRange.end);
    }
    return null;
  }

  static replaceNestedContent(content, parentHeading, subHeading, newText) {
    const cleanSub = (subHeading || "").trim();
    if (!parentHeading) {
      const range = Utils.findSectionRange(content, cleanSub, 2);
      if (range) {
        return content.substring(0, range.contentStart) + "\n" + (newText || "").trim() + "\n" + content.substring(range.end);
      } else {
        return Utils.insertNestedContent(content, parentHeading, subHeading, newText);
      }
    }

    const cleanParent = parentHeading.trim();
    const parentRange = Utils.findSectionRange(content, cleanParent, 2);

    if (!parentRange) {
      return Utils.insertNestedContent(content, parentHeading, subHeading, newText);
    }

    const parentBlock = content.substring(parentRange.contentStart, parentRange.end);
    const subRange = Utils.findSectionRange(parentBlock, cleanSub, 3);

    if (subRange) {
      const subInsertPos = parentRange.contentStart + subRange.contentStart;
      const subEnd = parentRange.contentStart + subRange.end;
      return content.substring(0, subInsertPos) + "\n" + (newText || "").trim() + "\n" + content.substring(subEnd);
    } else {
      return Utils.insertNestedContent(content, parentHeading, subHeading, newText);
    }
  }

  static normalizePath(path) {
    if (!path) return "";
    const parts = path.replace(/\\/g, "/").split("/");
    const resolved = [];
    for (const part of parts) {
      const p = part.trim();
      if (!p || p === ".") continue;
      if (p === "..") {
        resolved.pop();
      } else {
        resolved.push(p);
      }
    }
    return resolved.join("/");
  }

  static isPathTraversal(path) {
    if (!path) return false;
    const parts = path.replace(/\\/g, "/").split("/");
    let depth = 0;
    for (const part of parts) {
      const p = part.trim();
      if (p === "..") {
        depth--;
        if (depth < 0) return true;
      } else if (p && p !== ".") {
        depth++;
      }
    }
    return false;
  }

  static isPathInsideFolder(filePath, folderPath) {
    const normFile = Utils.normalizePath(filePath);
    const normFolder = Utils.normalizePath(folderPath);

    if (!normFolder) {
      return true;
    }

    return normFile.startsWith(normFolder + "/") || normFile === normFolder;
  }

  /**
   * Retrieves all markdown habit note files residing in the Active/ or Archive/ folders.
   * @param {import('obsidian').Vault} vault
   * @param {object} habitNoteManager
   * @returns {Array<import('obsidian').TFile>}
   */
  static getHabitNoteFiles(vault, habitNoteManager) {
    if (!vault || !habitNoteManager) return [];
    const activeFolder = habitNoteManager.getActiveFolder();
    const archiveFolder = habitNoteManager.getArchiveFolder();

    // Prefer scoped folder children traversal (O(habits) instead of O(vault_files))
    if (typeof vault.getAbstractFileByPath === "function") {
      const activeObj = vault.getAbstractFileByPath(activeFolder);
      const archiveObj = vault.getAbstractFileByPath(archiveFolder);

      const hasChildren = (obj) => obj && Array.isArray(obj.children);
      if (hasChildren(activeObj) || hasChildren(archiveObj)) {
        const collectFiles = (folderObj) => {
          if (!folderObj || !Array.isArray(folderObj.children)) return [];
          const files = [];
          const stack = [...folderObj.children];
          while (stack.length > 0) {
            const item = stack.pop();
            if (!item) continue;
            if (Array.isArray(item.children)) {
              stack.push(...item.children);
            } else if (item.path && item.path.endsWith(".md")) {
              files.push(item);
            }
          }
          return files;
        };
        return [...collectFiles(activeObj), ...collectFiles(archiveObj)];
      }
    }

    // Fallback for environments or mocks without folder traversal
    const activeLower = (activeFolder || "").toLowerCase();
    const archiveLower = (archiveFolder || "").toLowerCase();
    const files = typeof vault.getMarkdownFiles === "function" ? vault.getMarkdownFiles() : [];

    return files.filter((file) => {
      const lowerPath = (file.path || "").toLowerCase();
      return (
        lowerPath.startsWith(activeLower + "/") || lowerPath === activeLower ||
        lowerPath.startsWith(archiveLower + "/") || lowerPath === archiveLower
      );
    });
  }
}

// Cross-export and attach helpers for convenience and unified developer access
import {
  getNoteByDate,
  TextUtils,
  findHabitEntry,
  buildHierarchyLabels,
  DateUtils,
  getDailyNotesInfo,
  autoResizeTextarea,
  formatDaysCount,
  getDaysUnit,
  formatHabitAge
} from "./helpers.js";

Utils.getNoteByDate = getNoteByDate;
Utils.TextUtils = TextUtils;
Utils.findHabitEntry = findHabitEntry;
Utils.buildHierarchyLabels = buildHierarchyLabels;
Utils.DateUtils = DateUtils;
Utils.getDailyNotesInfo = getDailyNotesInfo;
Utils.autoResizeTextarea = autoResizeTextarea;
Utils.formatDaysCount = formatDaysCount;
Utils.getDaysUnit = getDaysUnit;
Utils.formatHabitAge = formatHabitAge;

export {
  getNoteByDate,
  TextUtils,
  findHabitEntry,
  buildHierarchyLabels,
  DateUtils,
  getDailyNotesInfo,
  autoResizeTextarea,
  formatDaysCount,
  getDaysUnit,
  formatHabitAge
};
