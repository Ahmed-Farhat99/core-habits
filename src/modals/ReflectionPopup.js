import { Notice, Platform } from 'obsidian';
import { REFLECTION_ENTRY_TYPES } from '../constants.js';
import { BaseHabitModal } from './BaseHabitModal.js';
import { autoResizeTextarea } from '../utils/helpers.js';
import { VoiceRecorderComponent } from '../components/VoiceRecorderComponent.js';

class ReflectionPopup extends BaseHabitModal {
  constructor(app, plugin, date, onSave) {
    super(app, plugin);
    this.date = date;
    this.onSave = onSave;
    this.selectedType = REFLECTION_ENTRY_TYPES[0];
  }

  onOpen() {
    super.onOpen();
    const { contentEl, modalEl } = this;
    const t = (k, params = {}) => this.plugin.translationManager.t(k, params);
    contentEl.addClass("daily-habits-modal");
    contentEl.addClass("dh-popup-compact");
    modalEl.addClass("dh-popup-modal-parent");

    const lang = this.plugin.settings.language || "ar";
    const dateStr = this.date.clone().locale(lang).format(t("date_format_long"));

    // Compact header row
    const header = contentEl.createDiv({ cls: "dh-popup-header" });
    header.createSpan({ cls: "dh-popup-header-icon", text: "📝" });
    const headerText = header.createDiv({ cls: "dh-popup-header-text" });
    headerText.createDiv({ cls: "dh-popup-title", text: t("reflection_modal_title") });

    const metaLine = headerText.createDiv({ cls: "dh-popup-meta" });
    metaLine.createSpan({ text: dateStr });

    const typeLabels = {
      Good: t("reflection_good") || "Good",
      Bad: t("reflection_bad") || "Bad",
      Lesson: t("reflection_lesson") || "Lesson",
      Idea: t("reflection_idea") || "Idea",
    };
    const typePicker = contentEl.createDiv({ cls: "dh-reflection-type-picker" });
    REFLECTION_ENTRY_TYPES.forEach((type) => {
      const btn = typePicker.createEl("button", {
        cls: `dh-reflection-type-btn ${type === this.selectedType ? "is-active" : ""}`,
        text: typeLabels[type] || type,
      });
      btn.onclick = () => {
        this.selectedType = type;
        typePicker.querySelectorAll(".dh-reflection-type-btn").forEach((el) => el.removeClass("is-active"));
        btn.addClass("is-active");
      };
    });

    const inputWrapper = contentEl.createDiv({ cls: "dh-popup-input-wrapper" });
    const input = inputWrapper.createEl("textarea", {
      cls: "dh-popup-input dh-popup-input-standalone dh-auto-textarea",
      attr: {
        placeholder: t("reflection_notes_placeholder"),
        rows: 4
      }
    });

    const autoResize = () => autoResizeTextarea(input);
    input.oninput = autoResize;
    setTimeout(autoResize, 0);

    const footer = contentEl.createDiv({ cls: "dh-modal-actions dh-popup-footer-split" });

    const actionsLeft = footer.createDiv({ cls: "dh-popup-actions-left" });
    this.voiceRecorder = new VoiceRecorderComponent(actionsLeft, {
      app: this.app,
      plugin: this.plugin,
      inputEl: input,
      placeholderDefault: t("reflection_notes_placeholder")
    });

    const actionsRight = footer.createDiv({ cls: "dh-popup-actions-right" });

    const saveBtn = actionsRight.createEl("button", {
      text: t("reflection_save"),
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
        this.onSave(sanitized, this.selectedType).then((savedFile) => {
          new Notice(t("reflection_save_success", { file: savedFile || "" }));
          this.close();
        }).catch(e => {
          new Notice(`❌ ${e.message}`);
          saveBtn.disabled = false;
          saveBtn.textContent = t("reflection_save");
        });
      } else {
        this.close();
      }
    };

    saveBtn.onclick = submit;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    setTimeout(() => {
      input.focus();
      // Mobile: scroll input into view when keyboard appears
      if (Platform.isMobile) {
        setTimeout(() => input.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
      }
    }, 50);
  }

  onClose() {
    if (this.voiceRecorder) {
      this.voiceRecorder.cleanup();
    }
    super.onClose();
  }
}

export { ReflectionPopup };