import { Notice } from 'obsidian';
import { VoiceRecorderUtility } from '../services/VoiceRecorderUtility.js';

export class VoiceRecorderComponent {
  constructor(parentEl, options = {}) {
    this.parentEl = parentEl;
    this.app = options.app;
    this.plugin = options.plugin;
    this.inputEl = options.inputEl;
    this.placeholderDefault = options.placeholderDefault;
    this.onSaveSuccess = options.onSaveSuccess;

    this.isRecording = false;
    this.recordTimer = null;
    this.seconds = 0;
    this.micBtn = null;

    this.render();
  }

  render() {
    const t = (k, params = {}) => this.plugin.translationManager.t(k, params);

    this.micBtn = this.parentEl.createEl("button", {
      cls: "dh-btn dh-popup-mic-btn",
      text: t("reflection_record_hold"),
      title: t("reflection_record_title")
    });

    this.micBtn.onclick = async (e) => {
      e.preventDefault();
      if (!this.isRecording) {
        await this.start();
      } else {
        await this.stop();
      }
    };
  }

  async start() {
    const t = (k, params = {}) => this.plugin.translationManager.t(k, params);

    const started = await VoiceRecorderUtility.startRecording();
    if (started) {
      this.isRecording = true;
      this.micBtn.addClass("is-recording");
      this.micBtn.textContent = t("reflection_mic_stop");
      if (this.inputEl) {
        this.inputEl.disabled = true;
        this.inputEl.placeholder = t("reflection_mic_recording", { time: "00:00" });
      }
      this.seconds = 0;
      this.recordTimer = setInterval(() => {
        this.seconds++;
        const mm = String(Math.floor(this.seconds / 60)).padStart(2, '0');
        const ss = String(this.seconds % 60).padStart(2, '0');
        if (this.inputEl) {
          this.inputEl.placeholder = t("reflection_mic_recording", { time: `${mm}:${ss}` });
        }
      }, 1000);
    } else {
      new Notice(t("reflection_mic_failed"));
    }
  }

  async stop() {
    const t = (k, params = {}) => this.plugin.translationManager.t(k, params);

    if (this.recordTimer) {
      clearInterval(this.recordTimer);
      this.recordTimer = null;
    }

    if (this.inputEl) {
      this.inputEl.placeholder = t("reflection_mic_processing");
    }

    const fileName = await VoiceRecorderUtility.stopAndSaveRecording(this.app);
    this.isRecording = false;
    this.micBtn.removeClass("is-recording");
    this.micBtn.textContent = t("reflection_mic_btn_voice");

    if (this.inputEl) {
      this.inputEl.disabled = false;
      this.inputEl.placeholder = this.placeholderDefault || "";
    }

    if (fileName) {
      if (this.inputEl) {
        const sep = this.inputEl.value ? "\n" : "";
        this.inputEl.value += `${sep}![[${fileName}]]`;
        this.inputEl.focus();
        this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (typeof this.onSaveSuccess === 'function') {
        this.onSaveSuccess(fileName);
      }
    } else {
      new Notice(t("reflection_mic_save_failed"));
    }
  }

  cleanup() {
    if (this.recordTimer) {
      clearInterval(this.recordTimer);
      this.recordTimer = null;
    }
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
  }
}
