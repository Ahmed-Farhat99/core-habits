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
    this._isBusy = false;
    this.recordTimer = null;
    this.seconds = 0;
    this.micBtn = null;
    this.micIconEl = null;
    this.micTextEl = null;

    this.render();
  }

  render() {
    const t = (k, params = {}) => this.plugin?.translationManager?.t(k, params) || k;
    const label = t("reflection_mic_btn_voice");

    this.micBtn = this.parentEl.createEl("button", {
      cls: "dh-btn dh-popup-mic-btn",
      type: "button",
      attr: {
        "aria-label": label
      }
    });

    this.micIconEl = this.micBtn.createSpan({ cls: "dh-popup-mic-icon" });
    if (typeof setIcon === "function") {
      setIcon(this.micIconEl, "mic");
    }

    this.micTextEl = this.micBtn.createSpan({
      cls: "dh-popup-mic-label",
      text: label
    });

    this.micBtn.onclick = async (e) => {
      e.preventDefault();
      if (this._isBusy) return;
      if (!this.isRecording) {
        await this.start();
      } else {
        await this.stop();
      }
    };
  }

  async start() {
    if (this.isRecording || this._isBusy) return;
    this._isBusy = true;
    this.micBtn.disabled = true;
    const t = (k, params = {}) => this.plugin?.translationManager?.t(k, params) || k;

    try {
      const started = await VoiceRecorderUtility.startRecording();
      if (started) {
        this.isRecording = true;
        this.micBtn.addClass("is-recording");
        if (typeof setIcon === "function") {
          setIcon(this.micIconEl, "square");
        }
        
        const initialText = `${t("reflection_mic_stop")} (00:00)`;
        this.micTextEl.textContent = initialText;
        this.micBtn.setAttribute("aria-label", initialText);

        if (this.inputEl) {
          this.inputEl.disabled = true;
          this.inputEl.placeholder = t("reflection_mic_recording", { time: "00:00" });
        }
        this.seconds = 0;
        this.recordTimer = setInterval(() => {
          this.seconds++;
          const mm = String(Math.floor(this.seconds / 60)).padStart(2, '0');
          const ss = String(this.seconds % 60).padStart(2, '0');
          const timeStr = `${mm}:${ss}`;
          const currentText = `${t("reflection_mic_stop")} (${timeStr})`;
          this.micTextEl.textContent = currentText;
          this.micBtn.setAttribute("aria-label", currentText);
          if (this.inputEl) {
            this.inputEl.placeholder = t("reflection_mic_recording", { time: timeStr });
          }
        }, 1000);
      } else {
        NoticeService.error(t("reflection_mic_failed"), { plugin: this.plugin });
      }
    } catch (e) {
      console.error("[Core Habits] Error starting recording:", e);
      NoticeService.error(t("reflection_mic_failed"), { plugin: this.plugin });
    } finally {
      this._isBusy = false;
      this.micBtn.disabled = false;
    }
  }

  async stop() {
    if (!this.isRecording || this._isBusy) return;
    this._isBusy = true;
    this.micBtn.disabled = true;
    this.micBtn.addClass("is-processing");
    const t = (k, params = {}) => this.plugin?.translationManager?.t(k, params) || k;

    if (this.recordTimer) {
      clearInterval(this.recordTimer);
      this.recordTimer = null;
    }

    const processingText = t("reflection_mic_processing");
    this.micTextEl.textContent = processingText;
    this.micBtn.setAttribute("aria-label", processingText);
    if (this.inputEl) {
      this.inputEl.placeholder = processingText;
    }

    try {
      const durationMs = this.seconds > 0 ? this.seconds * 1000 : null;
      const fileName = await VoiceRecorderUtility.stopAndSaveRecording(this.app, null, durationMs);

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
    } catch (err) {
      console.error("[Core Habits] Error saving recording:", err);
      NoticeService.error(t("reflection_mic_save_failed"), { plugin: this.plugin });
    } finally {
      this.isRecording = false;
      this.seconds = 0;
      this._isBusy = false;
      this.micBtn.disabled = false;
      this.micBtn.removeClass("is-recording");
      this.micBtn.removeClass("is-processing");
      if (typeof setIcon === "function") {
        setIcon(this.micIconEl, "mic");
      }
      const defaultLabel = t("reflection_mic_btn_voice");
      this.micTextEl.textContent = defaultLabel;
      this.micBtn.setAttribute("aria-label", defaultLabel);

      if (this.inputEl) {
        this.inputEl.disabled = false;
        this.inputEl.placeholder = this.placeholderDefault || "";
      }
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
    if (this.isRecording || VoiceRecorderUtility.isRecording) {
      VoiceRecorderUtility.cancelRecording();
      this.isRecording = false;
      this.seconds = 0;
      this._isBusy = false;
      if (this.micBtn) {
        this.micBtn.disabled = false;
        this.micBtn.removeClass("is-recording");
        this.micBtn.removeClass("is-processing");
        if (typeof setIcon === "function") {
          setIcon(this.micIconEl, "mic");
        }
        if (this.micTextEl) {
          const t = (k, params = {}) => this.plugin?.translationManager?.t(k, params) || k;
          const defaultLabel = t("reflection_mic_btn_voice");
          this.micTextEl.textContent = defaultLabel;
          this.micBtn.setAttribute("aria-label", defaultLabel);
        }
      }
      if (this.inputEl) {
        this.inputEl.disabled = false;
        this.inputEl.placeholder = this.placeholderDefault || "";
      }
    }
  }
}
