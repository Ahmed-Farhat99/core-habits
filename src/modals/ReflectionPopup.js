import { Modal, Notice, Platform } from 'obsidian';
import { REFLECTION_ENTRY_TYPES } from '../constants.js';
import { VoiceRecorderUtility } from '../services/VoiceRecorderUtility.js';

class ReflectionPopup extends Modal {
  constructor(app, plugin, date, onSave) {
    super(app);
    this.plugin = plugin;
    this.date = date;
    this.onSave = onSave;
    this.selectedType = REFLECTION_ENTRY_TYPES[0];
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    const isAr = this.plugin.settings.language === "ar";
    const t = (k) => this.plugin.translationManager.t(k);
    contentEl.addClass("dh-popup-compact");
    if (isAr) contentEl.addClass("is-rtl");
    contentEl.setAttr("dir", isAr ? "rtl" : "ltr");
    modalEl.addClass("dh-popup-modal-parent");

    const dateStr = this.date.clone().locale(isAr ? "ar" : "en").format(isAr ? "dddd، D MMM" : "ddd, D MMM");

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
      cls: "dh-popup-input dh-popup-input-standalone",
      attr: {
        placeholder: isAr ? "كيف كان يومك؟ ملاحظات سريعة..." : "How was your day? Quick notes...",
        rows: 4
      }
    });

    const footer = contentEl.createDiv({ cls: "dh-popup-footer dh-popup-footer-split" });

    const actionsLeft = footer.createDiv({ cls: "dh-popup-actions-left" });
    const micBtn = actionsLeft.createEl("button", {
      cls: "dh-popup-btn-cancel dh-popup-mic-btn",
      text: isAr ? "🎙️ تسجيل صوتي" : "🎙️ Voice Note",
      title: isAr ? "تسجيل ملاحظة صوتية" : "Record Voice Note"
    });

    const actionsRight = footer.createDiv({ cls: "dh-popup-actions-right" });

    const saveBtn = actionsRight.createEl("button", {
      text: isAr ? "📝 حفظ التدوين" : "📝 Save",
      cls: "dh-popup-btn-save"
    });

    const cancelBtn = actionsRight.createEl("button", { text: isAr ? "إلغاء" : "Cancel", cls: "dh-popup-btn-cancel" });
    cancelBtn.onclick = () => this.close();

    let isRecording = false;
    let recordTimer = null;
    let seconds = 0;

    micBtn.onclick = async () => {
      if (!isRecording) {
        const started = await VoiceRecorderUtility.startRecording();
        if (started) {
          isRecording = true;
          micBtn.addClass("is-recording");
          micBtn.textContent = isAr ? "⏹ إيقاف" : "⏹ Stop";
          input.disabled = true;
          input.placeholder = isAr ? "جاري التسجيل... 00:00" : "Recording... 00:00";
          seconds = 0;
          recordTimer = setInterval(() => {
            seconds++;
            const mm = String(Math.floor(seconds/60)).padStart(2, '0');
            const ss = String(seconds%60).padStart(2,'0');
            input.placeholder = isAr ? `جاري التسجيل... ${mm}:${ss}` : `Recording... ${mm}:${ss}`;
          }, 1000);
        } else {
          new Notice(isAr ? "فشل الوصول للميكروفون!" : "Microphone access failed!");
        }
      } else {
        clearInterval(recordTimer);
        input.placeholder = isAr ? "معالجة الصوت..." : "Processing audio...";
        const fileName = await VoiceRecorderUtility.stopAndSaveRecording(this.app);
        isRecording = false;
        micBtn.removeClass("is-recording");
        micBtn.textContent = isAr ? "🎙️ تسجيل صوتي" : "🎙️ Voice Note";
        input.disabled = false;
        input.placeholder = isAr ? "كيف كان يومك؟ ملاحظات سريعة..." : "How was your day? Quick notes...";
        
        if (fileName) {
          const sep = input.value ? "\n" : "";
          input.value += `${sep}![[${fileName}]]`;
          input.focus();
        } else {
           new Notice(isAr ? "فشل حفظ الملف الصوتي!" : "Failed to save audio file!");
        }
      }
    };

    const submit = () => {
      if (isRecording) {
        new Notice(isAr ? "أوقف التسجيل أولاً!" : "Stop recording first!");
        return;
      }
      const sanitized = input.value
        .replace(/[\r\n]+/g, ' ')
        .replace(/^#+\s/gm, '')
        .substring(0, 2000)
        .trim();
      if (sanitized) {
        saveBtn.disabled = true;
        saveBtn.textContent = isAr ? "جاري..." : "Saving...";
        this.onSave(sanitized, this.selectedType).then((savedFile) => {
          new Notice(isAr
            ? `✅ تم حفظ التدوين في ملف اليوم: ${savedFile || ""}`
            : `✅ Saved to daily note: ${savedFile || ""}`);
          this.close();
        }).catch(e => {
          new Notice(`❌ ${e.message}`);
          saveBtn.disabled = false;
          saveBtn.textContent = isAr ? "📝 حفظ التدوين" : "📝 Save";
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
    if (VoiceRecorderUtility.isRecording) {
      if (VoiceRecorderUtility.stream) {
        VoiceRecorderUtility.stream.getTracks().forEach(t => t.stop());
      }
      if (VoiceRecorderUtility.mediaRecorder && VoiceRecorderUtility.mediaRecorder.state !== "inactive") {
        VoiceRecorderUtility.mediaRecorder.stop();
      }
      VoiceRecorderUtility.isRecording = false;
      VoiceRecorderUtility.chunks = [];
    }
    this.contentEl.empty();
  }
}

export { ReflectionPopup };