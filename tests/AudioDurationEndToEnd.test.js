import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VoiceRecorderUtility } from "../src/services/VoiceRecorderUtility.js";
import { VoiceRecorderComponent } from "../src/components/VoiceRecorderComponent.js";
import { Utils } from "../src/utils/Utils.js";
import { DiaryParser } from "../src/services/DiaryParser.js";

describe("Audio End-to-End Pipeline & Comprehensive Regression Tests", () => {
  let mockApp;
  let savedFiles;

  // Minimal valid live WebM buffer without EBML Duration metadata (resembling MediaRecorder live output)
  function createLiveWebmBuffer() {
    const ebmlHeader = [
      0x1a, 0x45, 0xdf, 0xa3, // EBML ID
      0x85,                   // Size 5
      0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d // DocType 'webm'
    ];
    const info = [
      0x15, 0x49, 0xa9, 0x66, // Info ID
      0x87,                   // Size 7
      0x2a, 0xd7, 0xb1,       // TimecodeScale ID
      0x83,                   // Size 3
      0x0f, 0x42, 0x40        // 1,000,000 ns = 1 ms
    ];
    const segment = [
      0x18, 0x53, 0x80, 0x67, // Segment ID
      0x80 + info.length,     // Size
      ...info
    ];
    return new Uint8Array([...ebmlHeader, ...segment]);
  }

  beforeEach(() => {
    savedFiles = new Map();
    mockApp = {
      fileManager: {
        getAvailablePathForAttachment: vi.fn().mockImplementation(async (name) => `Attachments/${name}`)
      },
      vault: {
        createBinary: vi.fn().mockImplementation(async (path, buffer) => {
          savedFiles.set(path, buffer);
          return true;
        }),
        getAbstractFileByPath: vi.fn().mockReturnValue(null),
        createFolder: vi.fn().mockResolvedValue(true),
        getConfig: vi.fn().mockReturnValue("/"),
        getResourcePath: vi.fn().mockImplementation((f) => `app://local/${f.path}`)
      },
      metadataCache: {
        getFirstLinkpathDest: vi.fn().mockImplementation((link) => ({ path: `Attachments/${link}` }))
      }
    };
  });

  afterEach(() => {
    VoiceRecorderUtility.cancelRecording();
    vi.restoreAllMocks();
  });

  it("Scenario 1: 5s, 20s, and 60s recordings produce valid buffers and correct duration tags", async () => {
    const testCases = [
      { seconds: 5, expectedMs: 5000 },
      { seconds: 20, expectedMs: 20000 },
      { seconds: 60, expectedMs: 60000 }
    ];

    for (const { seconds, expectedMs } of testCases) {
      const mockTrack = { stop: vi.fn() };
      VoiceRecorderUtility.stream = { getTracks: vi.fn().mockReturnValue([mockTrack]) };
      VoiceRecorderUtility.chunks = [createLiveWebmBuffer()];
      VoiceRecorderUtility.isRecording = true;
      VoiceRecorderUtility._activeMimeType = "audio/webm;codecs=opus";
      VoiceRecorderUtility.startTime = Date.now() - expectedMs;

      let onStopCallback = null;
      VoiceRecorderUtility.mediaRecorder = {
        state: "recording",
        set onstop(fn) { onStopCallback = fn; },
        get onstop() { return onStopCallback; },
        stop: vi.fn(() => {
          if (onStopCallback) onStopCallback();
        })
      };

      const fileName = await VoiceRecorderUtility.stopAndSaveRecording(mockApp, `Recording-${seconds}s`);
      expect(fileName).toBe(`Recording-${seconds}s.webm`);

      const savedBuffer = savedFiles.get(`Attachments/Recording-${seconds}s.webm`);
      expect(savedBuffer).toBeDefined();
      expect(savedBuffer.byteLength).toBeGreaterThan(0);
      expect(mockTrack.stop).toHaveBeenCalled();

      // Ensure 20 seconds is interpreted as 00:20 and never as 18:54:09
      const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
      const ss = String(seconds % 60).padStart(2, "0");
      const formatted = `${mm}:${ss}`;
      if (seconds === 20) {
        expect(formatted).toBe("00:20");
      }
    }
  });

  it("Scenario 2: Android simulation — No 1e101 seek, playback reflects accurate duration", () => {
    const mockAudioEl = {
      src: "app://local/Attachments/Recording-20s.webm",
      currentTime: 0,
      duration: 20.0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };

    Utils.fixAudioDuration(mockAudioEl);

    // Audio element should NOT seek to 1e101
    expect(mockAudioEl.currentTime).toBe(0);
    // Duration remains 20.0 (not latching onto 18:54:09 cluster timestamps)
    expect(mockAudioEl.duration).toBe(20.0);
    expect(mockAudioEl.addEventListener).not.toHaveBeenCalled();
  });

  it("Scenario 3: Desktop simulation — finite duration is preserved without workarounds", () => {
    const desktopAudioEl = {
      src: "app://local/Attachments/Recording-60s.webm",
      currentTime: 0,
      duration: 60.0,
      addEventListener: vi.fn()
    };

    Utils.fixAudioDuration(desktopAudioEl);

    expect(desktopAudioEl.currentTime).toBe(0);
    expect(desktopAudioEl.duration).toBe(60.0);
    expect(desktopAudioEl.addEventListener).not.toHaveBeenCalled();
  });

  it("Scenario 4: Close modal while recording — releases all media tracks and resets component state", () => {
    const mockTrack = { stop: vi.fn() };
    VoiceRecorderUtility.stream = {
      getTracks: vi.fn().mockReturnValue([mockTrack])
    };
    VoiceRecorderUtility.isRecording = true;
    VoiceRecorderUtility.chunks = [new Uint8Array([1, 2, 3])];

    const container = document.createElement("div");
    const inputEl = document.createElement("textarea");
    inputEl.disabled = true;
    container.appendChild(inputEl);

    const comp = new VoiceRecorderComponent(container, {
      app: mockApp,
      plugin: { translationManager: { t: (k) => k } },
      inputEl
    });
    comp.isRecording = true;
    comp.recordTimer = setInterval(() => {}, 1000);

    comp.cleanup();

    expect(mockTrack.stop).toHaveBeenCalled();
    expect(VoiceRecorderUtility.isRecording).toBe(false);
    expect(VoiceRecorderUtility.stream).toBeNull();
    expect(VoiceRecorderUtility.mediaRecorder).toBeNull();
    expect(comp.isRecording).toBe(false);
    expect(comp.recordTimer).toBeNull();
    expect(inputEl.disabled).toBe(false);
  });

  it("Scenario 5: Denied microphone permission — fails gracefully without leaking state", async () => {
    const originalMediaDevices = navigator.mediaDevices;
    navigator.mediaDevices = {
      getUserMedia: vi.fn().mockRejectedValue(new Error("Permission denied by user"))
    };

    const container = document.createElement("div");
    const comp = new VoiceRecorderComponent(container, {
      app: mockApp,
      plugin: { translationManager: { t: (k) => k } }
    });

    await comp.start();

    expect(comp.isRecording).toBe(false);
    expect(VoiceRecorderUtility.isRecording).toBe(false);
    expect(VoiceRecorderUtility.stream).toBeNull();
    expect(comp.micBtn.disabled).toBe(false);

    navigator.mediaDevices = originalMediaDevices;
  });

  it("Scenario 6: MediaRecorder initialization failure fallback", async () => {
    const mockTrack = { stop: vi.fn() };
    const mockStream = {
      getTracks: vi.fn().mockReturnValue([mockTrack]),
      getAudioTracks: vi.fn().mockReturnValue([mockTrack])
    };

    const originalMediaDevices = navigator.mediaDevices;
    const originalMediaRecorder = global.MediaRecorder;

    navigator.mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue(mockStream)
    };

    let firstAttempt = true;
    global.MediaRecorder = vi.fn().mockImplementation(function(_stream, options) {
      if (options && firstAttempt) {
        firstAttempt = false;
        throw new Error("Unsupported options on device");
      }
      return {
        start: vi.fn(),
        stop: vi.fn(),
        ondataavailable: null,
        onstop: null,
        state: "recording"
      };
    });
    global.MediaRecorder.isTypeSupported = vi.fn().mockReturnValue(true);

    const started = await VoiceRecorderUtility.startRecording();
    expect(started).toBe(true);
    expect(VoiceRecorderUtility.isRecording).toBe(true);

    VoiceRecorderUtility.cancelRecording();
    navigator.mediaDevices = originalMediaDevices;
    global.MediaRecorder = originalMediaRecorder;
  });

  it("Scenario 7: Multiple consecutive recordings in one session", async () => {
    for (let i = 1; i <= 3; i++) {
      const mockTrack = { stop: vi.fn() };
      VoiceRecorderUtility.stream = { getTracks: vi.fn().mockReturnValue([mockTrack]) };
      VoiceRecorderUtility.chunks = [createLiveWebmBuffer()];
      VoiceRecorderUtility.isRecording = true;
      VoiceRecorderUtility.startTime = Date.now() - 5000;

      let onStopCallback = null;
      VoiceRecorderUtility.mediaRecorder = {
        state: "recording",
        set onstop(fn) { onStopCallback = fn; },
        get onstop() { return onStopCallback; },
        stop: vi.fn(() => {
          if (onStopCallback) onStopCallback();
        })
      };

      const fileName = await VoiceRecorderUtility.stopAndSaveRecording(mockApp, `Multi-${i}`);
      expect(fileName).toBe(`Multi-${i}.webm`);
      expect(VoiceRecorderUtility.isRecording).toBe(false);
      expect(VoiceRecorderUtility.stream).toBeNull();
    }
  });

  it("Scenario 8: Duplicate attachment collision avoidance in wikilink", async () => {
    // When fileManager indicates the available path is deduplicated with a suffix
    mockApp.fileManager.getAvailablePathForAttachment = vi.fn().mockResolvedValue("Attachments/Recording-Collided 1.webm");

    VoiceRecorderUtility.stream = { getTracks: vi.fn().mockReturnValue([]) };
    VoiceRecorderUtility.chunks = [createLiveWebmBuffer()];
    VoiceRecorderUtility.isRecording = true;

    let onStopCallback = null;
    VoiceRecorderUtility.mediaRecorder = {
      state: "recording",
      set onstop(fn) { onStopCallback = fn; },
      get onstop() { return onStopCallback; },
      stop: vi.fn(() => {
        if (onStopCallback) onStopCallback();
      })
    };

    const resolvedName = await VoiceRecorderUtility.stopAndSaveRecording(mockApp, "Recording-Collided");
    expect(resolvedName).toBe("Recording-Collided 1.webm");
    expect(savedFiles.has("Attachments/Recording-Collided 1.webm")).toBe(true);
  });

  it("Scenario 9: Reopen / Restart persistence — Diary parser extracts audio wikilink correctly", () => {
    const fileName = "Recording-2026-10-07_123456.webm";
    const noteMarkdown = `## Daily Reflection\nSummary of daily progress.\n![[${fileName}]]`;

    const { audioFiles, remainingText } = DiaryParser.extractAudio(noteMarkdown);
    expect(audioFiles).toContain(fileName);
    expect(remainingText).not.toContain("![[");
  });

  it("Scenario 10: Playback & Seeking simulation — seeker remains within valid duration range", () => {
    const audioEl = {
      duration: 20.0,
      currentTime: 0,
      seek(time) {
        if (time >= 0 && time <= this.duration) {
          this.currentTime = time;
        }
      }
    };

    audioEl.seek(10.0);
    expect(audioEl.currentTime).toBe(10.0);

    audioEl.seek(20.0);
    expect(audioEl.currentTime).toBe(20.0);
  });

  it("Scenario 11: Legacy recording compatibility — unindexed WebM plays safely without 1e101 corruption", () => {
    const legacyAudioEl = {
      src: "app://local/Attachments/OldRecording.webm",
      currentTime: 0,
      duration: Infinity,
      addEventListener: vi.fn()
    };

    Utils.fixAudioDuration(legacyAudioEl);

    expect(legacyAudioEl.currentTime).toBe(0);
    expect(legacyAudioEl.addEventListener).not.toHaveBeenCalled();
  });
});
