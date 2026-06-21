import { Modal, Notice, Platform } from 'obsidian';
import { VoiceRecorderUtility } from '../services/VoiceRecorderUtility.js';

class HabitCommentPopup extends Modal {
  constructor(app, plugin, habit, date, onSave) {
    super(app);
    this.plugin = plugin;
    this.habit = habit;
    this.date = date;
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    const isAr = this.plugin.settings.language === "ar";
    contentEl.addClass("dh-popup-compact");
    if (isAr) contentEl.addClass("is-rtl");
    contentEl.setAttr("dir", isAr ? "rtl" : "ltr");
    modalEl.addClass("dh-popup-modal-parent");

    const dateStr = this.date.clone().locale(isAr ? "ar" : "en").format("D MMM");

    // Compact header row: icon + title + meta inline
    const header = contentEl.createDiv({ cls: "dh-popup-header" });
    header.createSpan({ cls: "dh-popup-header-icon", text: "💬" });
    const headerText = header.createDiv({ cls: "dh-popup-header-text" });
    headerText.createDiv({ cls: "dh-popup-title", text: this.habit.name });
    headerText.createDiv({ cls: "dh-popup-meta", text: `${dateStr} • ${window.moment().format("HH:mm")}` });

    const inputWrapper = contentEl.createDiv({ cls: "dh-popup-input-wrapper" });
    const input = inputWrapper.createEl("textarea", {
      cls: "dh-popup-input dh-popup-input-standalone",
      attr: {
        placeholder: isAr ? "ماذا حدث؟ لماذا تأخرت؟ ما شعورك؟" : "What happened? Why delayed? Feeling?",
        rows: 3
      }
    });

    const footer = contentEl.createDiv({ cls: "dh-modal-actions dh-popup-footer-split" });

    const actionsLeft = footer.createDiv({ cls: "dh-popup-actions-left" });
    const micBtn = actionsLeft.createEl("button", {
      cls: "dh-popup-mic-btn",
      text: isAr ? "🎙️ تسجيل (اضغط مطولاً)" : "🎙️ Record (Hold)",
      title: isAr ? "اضغط مطولاً لتسجيل ملاحظة صوتية" : "Press and hold to record a voice note"
    });

    const actionsRight = footer.createDiv({ cls: "dh-popup-actions-right" });

    const saveBtn = actionsRight.createEl("button", {
      text: isAr ? "💾 حفظ" : "💾 Save",
      cls: "mod-cta"
    });

    const cancelBtn = actionsRight.createEl("button", { text: isAr ? "إلغاء" : "Cancel" });
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
        input.placeholder = isAr ? "ماذا حدث؟ لماذا تأخرت؟ ما شعورك؟" : "What happened? Why delayed? Feeling?";
        
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
        this.onSave(sanitized).then((savedFile) => {
          new Notice(isAr
            ? `✅ تم حفظ التعليق في: ${savedFile || this.habit.name}`
            : `✅ Saved to: ${savedFile || this.habit.name}`);
          this.close();
        }).catch(e => {
          new Notice(`❌ ${e.message}`);
          saveBtn.disabled = false;
          saveBtn.textContent = isAr ? "💾 حفظ" : "💾 Save";
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

/**
 * Feature: Daily Note Reflection
 * Small popup modal for writing the daily overall reflection
 */
export { HabitCommentPopup };