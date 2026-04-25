import { Utils } from '../utils/Utils.js';

export class AudioEngine {
  constructor(plugin) {
    this.plugin = plugin;
    this.sharedAudioContext = null;
    this.lastAudioPlayTime = 0;
    this.AUDIO_RATE_LIMIT_MS = 80;
    this.AUDIO_VOLUME = 0.15;
    this.AUDIO_DURATION_MS = 100;
  }

  getAudioContext() {
    if (!this.sharedAudioContext) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        try {
          this.sharedAudioContext = new AudioContext();
        } catch (e) {
          console.error("[Core Habits] Failed to create AudioContext:", e);
          return null;
        }
      }
    }
    return this.sharedAudioContext;
  }

  async playSound({ type = "check", level = null } = {}) {
    try {
      // Respect the enableSound setting
      if (this.plugin.settings.enableSound === false) return false;

      const now = Date.now();
      if (now - this.lastAudioPlayTime < this.AUDIO_RATE_LIMIT_MS) return false;
      this.lastAudioPlayTime = now;

      const ctx = this.getAudioContext();
      if (!ctx) return false;

      if (ctx.state === "suspended") {
        try { await ctx.resume(); } catch (e) { return false; }
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";

      osc.onended = () => { osc.disconnect(); gain.disconnect(); };

      let duration = this.AUDIO_DURATION_MS / 1000;
      let targetVolume = this.AUDIO_VOLUME;

      if (type === "milestone") {
        duration = 0.15;
        targetVolume = this.AUDIO_VOLUME * 0.9;
        if (level === "fair") {
          osc.frequency.setValueAtTime(700, ctx.currentTime);
          osc.frequency.linearRampToValueAtTime(900, ctx.currentTime + duration);
        } else if (level === "good") {
          osc.frequency.setValueAtTime(800, ctx.currentTime);
          osc.frequency.setValueAtTime(900, ctx.currentTime + duration * 0.5);
        } else if (level === "excellent") {
          osc.frequency.setValueAtTime(900, ctx.currentTime);
          osc.frequency.linearRampToValueAtTime(1100, ctx.currentTime + duration);
        } else if (level === "complete") {
          osc.frequency.setValueAtTime(1000, ctx.currentTime);
          osc.frequency.linearRampToValueAtTime(1200, ctx.currentTime + duration);
        }
      } else if (type === "uncheck") {
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(400, ctx.currentTime + duration * 0.5);
      } else if (type === "check") { // Default check sound
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(1000, ctx.currentTime + duration * 0.5);
      } else {
        Utils.debugLog(this.plugin, "Unknown sound type:", type);
        osc.frequency.setValueAtTime(800, ctx.currentTime); // Fallback to default check sound
        osc.frequency.linearRampToValueAtTime(1000, ctx.currentTime + duration * 0.5);
      }

      gain.gain.setValueAtTime(targetVolume, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + duration);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
      return true;
    } catch (e) {
      return false;
    }
  }

  async close() {
    if (this.sharedAudioContext) {
      try {
        await this.sharedAudioContext.close();
      } catch (e) { }
    }
  }
}
