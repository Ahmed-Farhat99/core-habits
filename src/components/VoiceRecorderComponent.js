import { setIcon } from 'obsidian';
import { VoiceRecorderUtility } from '../services/VoiceRecorderUtility.js';
import { NoticeService } from '../services/NoticeService.js';

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
    this.micIconEl = null;
    this.micTextEl = null;

    this.render();
  }

  render() {
    const t = (k, params = {}) => this.plugin.translationManager.t(k, params);

    this.micBtn = this.parentEl.createEl("button", {
      cls: "dh-btn dh-popup-mic-btn",
      type: "button"
    });

    this.micIconEl = this.micBtn.createSpan({ cls: "dh-popup-mic-icon" });
    if (typeof setIcon === "function") {
      setIcon(this.micIconEl, "mic");
    }

    this.micTextEl = this.micBtn.createSpan({
      cls: "dh-popup-mic-label",
      text: t("reflection_mic_btn_voice")
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
      if (typeof setIcon === "function") {
        setIcon(this.micIconEl, "square");
      }
      this.micTextEl.textContent = t("reflection_mic_stop");

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
      NoticeService.error(t("reflection_mic_failed"), { plugin: this.plugin });
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
    if (typeof setIcon === "function") {
      setIcon(this.micIconEl, "mic");
    }
    this.micTextEl.textContent = t("reflection_mic_btn_voice");

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
      NoticeService.error(t("reflection_mic_save_failed"), { plugin: this.plugin });
    }
  }

  pulseAttention() {
    if (this.micBtn) {
      this.micBtn.classList.remove("dh-pulse-attention");
      void this.micBtn.offsetWidth;
      this.micBtn.classList.add("dh-pulse-attention");
      setTimeout(() => {
        if (this.micBtn) {
          this.micBtn.classList.remove("dh-pulse-attention");
        }
      }, 1000);
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
