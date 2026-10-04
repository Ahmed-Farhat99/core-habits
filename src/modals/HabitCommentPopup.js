import { Platform } from 'obsidian';
import { BaseNoteEntryModal } from './BaseNoteEntryModal.js';
import { autoResizeTextarea } from '../utils/helpers.js';
import { NoticeService } from '../services/NoticeService.js';

class HabitCommentPopup extends BaseNoteEntryModal {
  constructor(app, plugin, habit, date, onSave) {
    super(app, plugin, { date, onSave });
    this.habit = habit;
    this.initialComment = "";
  }

  isDirty() {
    if (!this.inputEl) return false;
    const current = (this.inputEl.value || "").trim();
    const initial = (this.initialComment || "").trim();
    return current !== initial;
  }

  onOpen() {
    super.onOpen();
    const { contentEl } = this;
    const t = (k, params = {}) => this.t(k, params);

    const dateStr = this.getFormattedDate("date_format_medium");
    const momentFn = typeof window !== "undefined" && window.moment ? window.moment : (typeof globalThis !== "undefined" && globalThis.moment ? globalThis.moment : null);
    const timeStr = momentFn ? momentFn().format("HH:mm") : "";
    const metaHtml = timeStr ? `${dateStr} • <bdi>${timeStr}</bdi>` : dateStr;

    // Compact header row with Lucide icon and BiDi-isolated time
    this.createPopupHeader(contentEl, {
      iconName: "message-square",
      titleText: this.habit?.name || "",
      metaHtml
    });

    const input = this.createNoteInput(contentEl, {
      placeholder: t("comment_placeholder"),
      rows: 3
    });

    // Load existing comment text
    input.disabled = true;
    input.placeholder = t("comment_loading");

    this.plugin?.habitCommentRepository?.getCommentForHabitDate(this.habit, this.date).then((existingComment) => {
      input.disabled = false;
      input.placeholder = t("comment_placeholder");
      input.value = existingComment || "";
      this.initialComment = input.value;
      this.initialValue = input.value;
      input.focus();
      autoResizeTextarea(input);
      if (Platform.isMobile) {
        setTimeout(() => input.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
      }
    }).catch((err) => {
      console.warn("[Core Habits] Failed to load existing comment:", err);
      input.disabled = false;
      input.placeholder = t("comment_placeholder");
      this.initialComment = "";
      this.initialValue = "";
      input.focus();
      autoResizeTextarea(input);
    });

    this.createPopupFooter(contentEl, {
      placeholderDefault: t("comment_placeholder"),
      cancelText: t("cancel"),
      saveText: t("comment_save")
    });
  }

  async handleSave(sanitized) {
    const savedFile = await this.onSave(sanitized);
    NoticeService.success(this.t("reflection_save_success_comment", { file: savedFile || this.habit?.name || "" }), { plugin: this.plugin });
  }
}

export { HabitCommentPopup };