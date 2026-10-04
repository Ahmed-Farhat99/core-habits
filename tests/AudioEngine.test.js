import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AudioEngine } from "../src/services/AudioEngine.js";

describe("AudioEngine Tests", () => {
  let mockPlugin;
  let audioEngine;
  let mockAudioContext;
  let mockOscillator;
  let mockGain;
  let originalAudioContext;

  beforeEach(() => {
    mockPlugin = {
      settings: {
        enableSound: true,
        debugMode: false,
      },
    };

    mockOscillator = {
      type: "",
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      frequency: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      onended: null,
    };

    mockGain = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
    };

    mockAudioContext = {
      state: "running",
      currentTime: 0,
      destination: {},
      createOscillator: vi.fn().mockReturnValue(mockOscillator),
      createGain: vi.fn().mockReturnValue(mockGain),
      resume: vi.fn().mockResolvedValue(),
      close: vi.fn().mockResolvedValue(),
    };

    originalAudioContext = window.AudioContext;
    window.AudioContext = vi.fn(function () {
      return mockAudioContext;
    });

    audioEngine = new AudioEngine(mockPlugin);
  });

  afterEach(() => {
    window.AudioContext = originalAudioContext;
    vi.clearAllMocks();
  });

  it("should return false immediately if enableSound setting is false", async () => {
    mockPlugin.settings.enableSound = false;
    const result = await audioEngine.playSound({ type: "check" });
    expect(result).toBe(false);
    expect(window.AudioContext).not.toHaveBeenCalled();
  });

  it("should enforce rate-limiting within AUDIO_RATE_LIMIT_MS", async () => {
    const firstPlay = await audioEngine.playSound({ type: "check" });
    expect(firstPlay).toBe(true);

    // Call immediately (less than 80ms)
    const secondPlay = await audioEngine.playSound({ type: "check" });
    expect(secondPlay).toBe(false);

    // After waiting > 80ms, it should allow playing again
    audioEngine.lastAudioPlayTime = Date.now() - 100;
    const thirdPlay = await audioEngine.playSound({ type: "check" });
    expect(thirdPlay).toBe(true);
  });

  it("should resume context if state is suspended", async () => {
    mockAudioContext.state = "suspended";
    const result = await audioEngine.playSound({ type: "check" });
    expect(mockAudioContext.resume).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("should play default check sound with correct frequencies", async () => {
    const result = await audioEngine.playSound({ type: "check" });
    expect(result).toBe(true);
    expect(mockOscillator.type).toBe("sine");
    expect(mockOscillator.frequency.setValueAtTime).toHaveBeenCalledWith(800, 0);
    expect(mockOscillator.frequency.linearRampToValueAtTime).toHaveBeenCalledWith(1000, expect.any(Number));
    expect(mockOscillator.start).toHaveBeenCalledWith(0);
    expect(mockOscillator.stop).toHaveBeenCalledWith(expect.any(Number));
  });

  it("should play uncheck sound with descending frequency", async () => {
    const result = await audioEngine.playSound({ type: "uncheck" });
    expect(result).toBe(true);
    expect(mockOscillator.frequency.setValueAtTime).toHaveBeenCalledWith(600, 0);
    expect(mockOscillator.frequency.linearRampToValueAtTime).toHaveBeenCalledWith(400, expect.any(Number));
  });

  it("should play milestone sounds with correct frequencies for each level", async () => {
    const expectations = [
      { level: "fair", startFreq: 700, endFreq: 900, isRamp: true },
      { level: "good", startFreq: 800, endFreq: 900, isRamp: false },
      { level: "excellent", startFreq: 900, endFreq: 1100, isRamp: true },
      { level: "complete", startFreq: 1000, endFreq: 1200, isRamp: true }
    ];

    for (const exp of expectations) {
      vi.clearAllMocks();
      audioEngine.lastAudioPlayTime = 0; // reset rate limiter
      const result = await audioEngine.playSound({ type: "milestone", level: exp.level });
      expect(result).toBe(true);
      expect(mockOscillator.frequency.setValueAtTime).toHaveBeenCalledWith(exp.startFreq, 0);
      if (exp.isRamp) {
        expect(mockOscillator.frequency.linearRampToValueAtTime).toHaveBeenCalledWith(exp.endFreq, expect.any(Number));
      } else {
        expect(mockOscillator.frequency.setValueAtTime).toHaveBeenCalledWith(exp.endFreq, expect.any(Number));
      }
    }
  });

  it("should fallback gracefully for unknown sound type", async () => {
    const result = await audioEngine.playSound({ type: "unknown_type" });
    expect(result).toBe(true);
    expect(mockOscillator.frequency.setValueAtTime).toHaveBeenCalledWith(800, 0);
  });

  it("should disconnect nodes when oscillator ends", async () => {
    await audioEngine.playSound({ type: "check" });
    expect(mockOscillator.onended).toBeTypeOf("function");
    mockOscillator.onended();
    expect(mockOscillator.disconnect).toHaveBeenCalled();
    expect(mockGain.disconnect).toHaveBeenCalled();
  });

  it("should close AudioContext on close()", async () => {
    audioEngine.getAudioContext();
    await audioEngine.close();
    expect(mockAudioContext.close).toHaveBeenCalled();
  });

  it("should return null if AudioContext constructor throws", () => {
    window.AudioContext = vi.fn(function () {
      throw new Error("Not supported");
    });
    const ctx = audioEngine.getAudioContext();
    expect(ctx).toBeNull();
  });
});
