import { Notice } from "obsidian";

export class Utils {
  static debugLog(plugin, ...args) {
    if (plugin?.settings?.debugMode) {
      console.log("[Core Habits]", ...args);
    }
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

  static showConfirmNotice(message, options = {}) {
    const { onConfirm, onCancel, isAr = false, confirmText, cancelText } = options;
    const fragment = document.createDocumentFragment();
    const container = document.createElement("div");
    container.className = "dh-delete-all-confirm";

    const msgSpan = document.createElement("span");
    msgSpan.textContent = message;
    container.appendChild(msgSpan);

    const btnContainer = document.createElement("div");
    btnContainer.className = "dh-confirm-buttons";
    container.appendChild(btnContainer);

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "dh-confirm-delete-btn";
    confirmBtn.textContent = confirmText || (isAr ? "نعم، متأكد" : "Yes, sure");
    confirmBtn.onclick = () => {
      container.remove();
      if (onConfirm) onConfirm();
    };
    btnContainer.appendChild(confirmBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "dh-cancel-btn";
    cancelBtn.textContent = cancelText || (isAr ? "إلغاء" : "Cancel");
    btnContainer.appendChild(cancelBtn);

    fragment.appendChild(container);
    const notice = typeof Notice !== "undefined" ? new Notice(fragment, 0) : null;
    confirmBtn.onclick = async () => { if (notice) notice.hide(); if (onConfirm) await onConfirm(); };
    cancelBtn.onclick = () => { if (notice) notice.hide(); if (onCancel) onCancel(); };
    return notice;
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
}
