import { Notice, Platform } from 'obsidian';
import { BaseHabitModal } from './BaseHabitModal.js';
import { autoResizeTextarea } from '../utils/helpers.js';
import { VoiceRecorderComponent } from '../components/VoiceRecorderComponent.js';

class HabitCommentPopup extends BaseHabitModal {
  constructor(app, plugin, habit, date, onSave) {
    super(app, plugin);
    this.habit = habit;
    this.date = date;
    this.onSave = onSave;
  }

  onOpen() {
    super.onOpen();
    const { contentEl, modalEl } = this;
    const t = (k, params = {}) => this.plugin.translationManager.t(k, params);
    contentEl.addClass("daily-habits-modal");
    contentEl.addClass("dh-popup-compact");
    modalEl.addClass("dh-popup-modal-parent");

    const lang = this.plugin.settings.language || "ar";
    const dateStr = this.date.clone().locale(lang).format(t("date_format_medium"));

    // Compact header row: icon + title + meta inline
    const header = contentEl.createDiv({ cls: "dh-popup-header" });
    header.createSpan({ cls: "dh-popup-header-icon", text: "💬" });
    const headerText = header.createDiv({ cls: "dh-popup-header-text" });
    headerText.createDiv({ cls: "dh-popup-title", text: this.habit.name });
    headerText.createDiv({ cls: "dh-popup-meta", text: `${dateStr} • ${window.moment().format("HH:mm")}` });

    const inputWrapper = contentEl.createDiv({ cls: "dh-popup-input-wrapper" });
    const input = inputWrapper.createEl("textarea", {
      cls: "dh-popup-input dh-popup-input-standalone dh-auto-textarea",
      attr: {
        placeholder: t("comment_placeholder"),
        rows: 3
      }
    });

    const autoResize = () => autoResizeTextarea(input);
    input.oninput = autoResize;

    // Load existing comment text
    input.disabled = true;
    input.placeholder = t("comment_loading");
    
    this.plugin.habitCommentRepository.getCommentForHabitDate(this.habit, this.date).then(existingComment => {
      input.disabled = false;
      input.placeholder = t("comment_placeholder");
      input.value = existingComment || "";
      input.focus();
      autoResize();
      if (Platform.isMobile) {
        setTimeout(() => input.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
      }
    }).catch(err => {
      console.warn("[Core Habits] Failed to load existing comment:", err);
      input.disabled = false;
      input.placeholder = t("comment_placeholder");
      input.focus();
      autoResize();
    });

    const footer = contentEl.createDiv({ cls: "dh-modal-actions dh-popup-footer-split" });

    const actionsLeft = footer.createDiv({ cls: "dh-popup-actions-left" });
    this.voiceRecorder = new VoiceRecorderComponent(actionsLeft, {
      app: this.app,
      plugin: this.plugin,
      inputEl: input,
      placeholderDefault: t("comment_placeholder")
    });

    const actionsRight = footer.createDiv({ cls: "dh-popup-actions-right" });

    const saveBtn = actionsRight.createEl("button", {
      text: t("comment_save"),
      cls: "dh-btn mod-cta"
    });

    const cancelBtn = actionsRight.createEl("button", { text: t("cancel"), cls: "dh-btn" });
    cancelBtn.onclick = () => this.close();

    const submit = () => {
      if (this.voiceRecorder && this.voiceRecorder.isRecording) {
        new Notice(t("reflection_mic_stop_first"));
        return;
      }
      const sanitized = input.value
        .replace(/[\r\n]+/g, ' ')
        .replace(/^#+\s/gm, '')
        .substring(0, 2000)
        .trim();
      if (sanitized) {
        saveBtn.disabled = true;
        saveBtn.textContent = t("reflection_saving");
        this.onSave(sanitized).then((savedFile) => {
          new Notice(t("reflection_save_success_comment", { file: savedFile || this.habit.name }));
          this.close();
        }).catch(e => {
          new Notice(`❌ ${e.message}`);
          saveBtn.disabled = false;
          saveBtn.textContent = t("comment_save");
        });
      } else {
        this.close();
      }
    };

    saveBtn.onclick = submit;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
  }

  onClose() {
    if (this.voiceRecorder) {
      this.voiceRecorder.cleanup();
    }
    super.onClose();
  }
}

export { HabitCommentPopup };