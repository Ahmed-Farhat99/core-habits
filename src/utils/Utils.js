import { ConfirmModal } from "../modals/ConfirmModal.js";


export class Utils {
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

  static extractSectionLines(content, heading) {
    const cleanHeading = (heading || "").trim();
    if (!content || !cleanHeading) return [];

    const headingRegex = new RegExp(`^${Utils.escapeRegExp(cleanHeading)}\\s*$`, "m");
    const match = content.match(headingRegex);
    if (!match) return [];

    const insertPos = match.index + match[0].length;
    const headingLevel = cleanHeading.match(/^#+/)?.[0]?.length || 2;
    const nextHeadingRegex = new RegExp(`\\n#{1,${headingLevel}} `, "m");
    const afterHeading = content.substring(insertPos);
    const nextMatch = afterHeading.match(nextHeadingRegex);
    const sectionEnd = nextMatch ? insertPos + nextMatch.index : content.length;

    return content
      .substring(insertPos, sectionEnd)
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);
  }

  static escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  static lightenHex(hex, amount = 0.2) {
    const normalize = (h) => h.replace("#", "").trim();
    let h = normalize(hex);
    if (h.length === 3) {
      h = h.split("").map(ch => ch + ch).join("");
    }
    const num = parseInt(h, 16);
    const r = (num >> 16) & 0xff;
    const g = (num >> 8) & 0xff;
    const b = num & 0xff;

    const clamp = (value) => Math.min(255, Math.max(0, Math.round(value)));
    const newR = clamp(r + (255 - r) * amount);
    const newG = clamp(g + (255 - g) * amount);
    const newB = clamp(b + (255 - b) * amount);

    return `#${((1 << 24) + (newR << 16) + (newG << 8) + newB).toString(16).slice(1)}`;
  }

  static showConfirmNotice(app, plugin, message, options = {}) {
    if (!app || !plugin) {
      console.error("[Core Habits] showConfirmNotice is missing app or plugin context!");
      return null;
    }
    const { onConfirm, onCancel, confirmText, cancelText } = options;
    const modal = new ConfirmModal(app, plugin, message, {
      confirmText,
      cancelText,
      onConfirm,
      onCancel
    });
    modal.open();
    return modal;
  }

  static insertNestedContent(content, parentHeading, subHeading, newText) {
    if (!newText) return content;
    const cleanSub = subHeading.trim();
    if (!parentHeading) {
      const headingRegex = new RegExp(`^${Utils.escapeRegExp(cleanSub)}\\s*$`, "m");
      const match = content.match(headingRegex);
      if (match) {
        const insertPos = match.index + match[0].length;
        const headingLevel = cleanSub.match(/^#+/)?.[0]?.length || 2;
        const nextHeadingRegex = new RegExp(`\\n#{1,${headingLevel}} `, 'm');
        const afterHeading = content.substring(insertPos);
        const nextMatch = afterHeading.match(nextHeadingRegex);
        const sectionEnd = nextMatch ? insertPos + nextMatch.index : content.length;
        return content.substring(0, sectionEnd) + "\n" + newText + content.substring(sectionEnd);
      } else {
        const separator = content.trim().length > 0 ? "\n\n" : "";
        return content + separator + cleanSub + "\n" + newText + "\n";
      }
    }

    const cleanParent = parentHeading.trim();
    const parentRegex = new RegExp(`^${Utils.escapeRegExp(cleanParent)}\\s*$`, "m");
    const parentMatch = content.match(parentRegex);

    if (!parentMatch) {
      const separator = content.trim().length > 0 ? "\n\n" : "";
      return content + separator + cleanParent + "\n" + cleanSub + "\n" + newText + "\n";
    }

    const parentInsertPos = parentMatch.index + parentMatch[0].length;
    const parentLevel = cleanParent.match(/^#+/)?.[0]?.length || 2;
    const nextParentRegex = new RegExp(`\\n#{1,${parentLevel}} `, 'm');
    const afterParent = content.substring(parentInsertPos);
    const nextParentMatch = afterParent.match(nextParentRegex);
    const parentEnd = nextParentMatch ? parentInsertPos + nextParentMatch.index : content.length;

    const parentBlock = content.substring(parentInsertPos, parentEnd);
    const subRegex = new RegExp(`^${Utils.escapeRegExp(cleanSub)}\\s*$`, "m");
    const subMatch = parentBlock.match(subRegex);

    if (subMatch) {
      const subInsertPos = parentInsertPos + subMatch.index + subMatch[0].length;
      const subLevel = cleanSub.match(/^#+/)?.[0]?.length || 3;
      const nextSubRegex = new RegExp(`\\n#{1,${subLevel}} `, 'm');
      const afterSub = content.substring(subInsertPos, parentEnd);
      const nextSubMatch = afterSub.match(nextSubRegex);
      const subEnd = nextSubMatch ? subInsertPos + nextSubMatch.index : parentEnd;
      
      let appendPos = subEnd;
      while (appendPos > 0 && content.charAt(appendPos - 1) === '\n') appendPos--;
      return content.substring(0, appendPos) + "\n" + newText + "\n\n" + content.substring(appendPos).replace(/^\n+/, '');
    } else {
      let appendPos = parentEnd;
      while (appendPos > 0 && content.charAt(appendPos - 1) === '\n') appendPos--;
      const separator = "\n\n";
      return content.substring(0, appendPos) + separator + cleanSub + "\n" + newText + "\n\n" + content.substring(appendPos).replace(/^\n+/, '');
    }
  }

  static getSectionContent(content, parentHeading, subHeading) {
    const cleanSub = subHeading.trim();
    if (!parentHeading) {
      const headingRegex = new RegExp(`^${Utils.escapeRegExp(cleanSub)}\\s*$`, "m");
      const match = content.match(headingRegex);
      if (match) {
        const insertPos = match.index + match[0].length;
        const headingLevel = cleanSub.match(/^#+/)?.[0]?.length || 2;
        const nextHeadingRegex = new RegExp(`\\n#{1,${headingLevel}} `, 'm');
        const afterHeading = content.substring(insertPos);
        const nextMatch = afterHeading.match(nextHeadingRegex);
        const sectionEnd = nextMatch ? insertPos + nextMatch.index : content.length;
        return content.substring(insertPos, sectionEnd);
      }
      return null;
    }

    const cleanParent = parentHeading.trim();
    const parentRegex = new RegExp(`^${Utils.escapeRegExp(cleanParent)}\\s*$`, "m");
    const parentMatch = content.match(parentRegex);

    if (!parentMatch) return null;

    const parentInsertPos = parentMatch.index + parentMatch[0].length;
    const parentLevel = cleanParent.match(/^#+/)?.[0]?.length || 2;
    const nextParentRegex = new RegExp(`\\n#{1,${parentLevel}} `, 'm');
    const afterParent = content.substring(parentInsertPos);
    const nextParentMatch = afterParent.match(nextParentRegex);
    const parentEnd = nextParentMatch ? parentInsertPos + nextParentMatch.index : content.length;

    const parentBlock = content.substring(parentInsertPos, parentEnd);
    const subRegex = new RegExp(`^${Utils.escapeRegExp(cleanSub)}\\s*$`, "m");
    const subMatch = parentBlock.match(subRegex);

    if (subMatch) {
      const subInsertPos = parentInsertPos + subMatch.index + subMatch[0].length;
      const subLevel = cleanSub.match(/^#+/)?.[0]?.length || 3;
      const nextSubRegex = new RegExp(`\\n#{1,${subLevel}} `, 'm');
      const afterSub = content.substring(subInsertPos, parentEnd);
      const nextSubMatch = afterSub.match(nextSubRegex);
      const subEnd = nextSubMatch ? subInsertPos + nextSubMatch.index : parentEnd;
      return content.substring(subInsertPos, subEnd);
    }
    return null;
  }

  static replaceNestedContent(content, parentHeading, subHeading, newText) {
    const cleanSub = subHeading.trim();
    if (!parentHeading) {
      const headingRegex = new RegExp(`^${Utils.escapeRegExp(cleanSub)}\\s*$`, "m");
      const match = content.match(headingRegex);
      if (match) {
        const insertPos = match.index + match[0].length;
        const headingLevel = cleanSub.match(/^#+/)?.[0]?.length || 2;
        const nextHeadingRegex = new RegExp(`\\n#{1,${headingLevel}} `, 'm');
        const afterHeading = content.substring(insertPos);
        const nextMatch = afterHeading.match(nextHeadingRegex);
        const sectionEnd = nextMatch ? insertPos + nextMatch.index : content.length;
        return content.substring(0, insertPos) + "\n" + newText.trim() + "\n" + content.substring(sectionEnd);
      } else {
        return Utils.insertNestedContent(content, parentHeading, subHeading, newText);
      }
    }

    const cleanParent = parentHeading.trim();
    const parentRegex = new RegExp(`^${Utils.escapeRegExp(cleanParent)}\\s*$`, "m");
    const parentMatch = content.match(parentRegex);

    if (!parentMatch) {
      return Utils.insertNestedContent(content, parentHeading, subHeading, newText);
    }

    const parentInsertPos = parentMatch.index + parentMatch[0].length;
    const parentLevel = cleanParent.match(/^#+/)?.[0]?.length || 2;
    const nextParentRegex = new RegExp(`\\n#{1,${parentLevel}} `, 'm');
    const afterParent = content.substring(parentInsertPos);
    const nextParentMatch = afterParent.match(nextParentRegex);
    const parentEnd = nextParentMatch ? parentInsertPos + nextParentMatch.index : content.length;

    const parentBlock = content.substring(parentInsertPos, parentEnd);
    const subRegex = new RegExp(`^${Utils.escapeRegExp(cleanSub)}\\s*$`, "m");
    const subMatch = parentBlock.match(subRegex);

    if (subMatch) {
      const subInsertPos = parentInsertPos + subMatch.index + subMatch[0].length;
      const subLevel = cleanSub.match(/^#+/)?.[0]?.length || 3;
      const nextSubRegex = new RegExp(`\\n#{1,${subLevel}} `, 'm');
      const afterSub = content.substring(subInsertPos, parentEnd);
      const nextSubMatch = afterSub.match(nextSubRegex);
      const subEnd = nextSubMatch ? subInsertPos + nextSubMatch.index : parentEnd;
      return content.substring(0, subInsertPos) + "\n" + newText.trim() + "\n" + content.substring(subEnd);
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
}

