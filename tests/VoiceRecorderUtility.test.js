import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VoiceRecorderUtility } from "../src/services/VoiceRecorderUtility.js";

describe("VoiceRecorderUtility Tests", () => {
  let mockApp;

  beforeEach(() => {
    mockApp = {
      fileManager: {
        getAvailablePathForAttachment: vi.fn().mockImplementation(async (name) => `Attachments/${name}`)
      },
      vault: {
        createBinary: vi.fn().mockResolvedValue(true),
        getAbstractFileByPath: vi.fn().mockReturnValue(null),
        createFolder: vi.fn().mockResolvedValue(true),
        getConfig: vi.fn().mockReturnValue("/")
      }
    };
  });

  afterEach(() => {
    VoiceRecorderUtility.isRecording = false;
    VoiceRecorderUtility._isStarting = false;
    VoiceRecorderUtility.mediaRecorder = null;
    VoiceRecorderUtility.stream = null;
    VoiceRecorderUtility.chunks = [];
    VoiceRecorderUtility.startTime = null;
  });

  it("should determine proper audio extensions for MIME types", () => {
    expect(VoiceRecorderUtility.getAudioExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(VoiceRecorderUtility.getAudioExtension("audio/mp4")).toBe("mp4");
    expect(VoiceRecorderUtility.getAudioExtension("audio/aac")).toBe("mp4");
    expect(VoiceRecorderUtility.getAudioExtension("audio/ogg;codecs=opus")).toBe("ogg");
    expect(VoiceRecorderUtility.getAudioExtension("audio/wav")).toBe("wav");
    expect(VoiceRecorderUtility.getAudioExtension("")).toBe("webm");
  });

  it("should cleanly stop and save recording without throwing ReferenceError", async () => {
    const mockTrack = { stop: vi.fn() };
    VoiceRecorderUtility.stream = {
      getTracks: vi.fn().mockReturnValue([mockTrack])
    };
    VoiceRecorderUtility.chunks = [new Uint8Array([1, 2, 3])];
    VoiceRecorderUtility._activeMimeType = "audio/webm";
    VoiceRecorderUtility.isRecording = true;

    let onStopCallback = null;
    VoiceRecorderUtility.mediaRecorder = {
      set onstop(fn) { onStopCallback = fn; },
      get onstop() { return onStopCallback; },
      stop: vi.fn(() => {
        if (onStopCallback) onStopCallback();
      })
    };

    const fileName = await VoiceRecorderUtility.stopAndSaveRecording(mockApp, "Test-Habit-Audio");

    expect(fileName).toBe("Test-Habit-Audio.webm");
    expect(mockTrack.stop).toHaveBeenCalled();
    expect(mockApp.fileManager.getAvailablePathForAttachment).toHaveBeenCalledWith("Test-Habit-Audio.webm");
    expect(mockApp.vault.createBinary).toHaveBeenCalled();
    expect(VoiceRecorderUtility.isRecording).toBe(false);
  });

  it("should generate default timestamped filename if customName is omitted", async () => {
    VoiceRecorderUtility.stream = { getTracks: vi.fn().mockReturnValue([]) };
    VoiceRecorderUtility.chunks = [new Uint8Array([1, 2, 3])];
    VoiceRecorderUtility.isRecording = true;

    let onStopCallback = null;
    VoiceRecorderUtility.mediaRecorder = {
      set onstop(fn) { onStopCallback = fn; },
      get onstop() { return onStopCallback; },
      stop: vi.fn(() => {
        if (onStopCallback) onStopCallback();
      })
    };

    const fileName = await VoiceRecorderUtility.stopAndSaveRecording(mockApp);
    expect(fileName).toMatch(/^Recording-\d+.*\.webm$/);
    expect(mockApp.vault.createBinary).toHaveBeenCalled();
  });

  it("should calculate duration from startTime and reset it after saving", async () => {
    VoiceRecorderUtility.stream = { getTracks: vi.fn().mockReturnValue([]) };
    VoiceRecorderUtility.chunks = [new Uint8Array([1, 2, 3])];
    VoiceRecorderUtility.isRecording = true;
    VoiceRecorderUtility._activeMimeType = "audio/webm";
    // Simulate recording started 20 seconds ago
    VoiceRecorderUtility.startTime = Date.now() - 20000;

    let onStopCallback = null;
    VoiceRecorderUtility.mediaRecorder = {
      set onstop(fn) { onStopCallback = fn; },
      get onstop() { return onStopCallback; },
      stop: vi.fn(() => {
        if (onStopCallback) onStopCallback();
      })
    };

    const fileName = await VoiceRecorderUtility.stopAndSaveRecording(mockApp, "Recording-20s");
    expect(fileName).toBe("Recording-20s.webm");
    expect(VoiceRecorderUtility.startTime).toBeNull();
    expect(mockApp.vault.createBinary).toHaveBeenCalled();
  });

  it("should prioritize explicitDurationMs when provided or when startTime is not set", async () => {
    VoiceRecorderUtility.stream = { getTracks: vi.fn().mockReturnValue([]) };
    VoiceRecorderUtility.chunks = [new Uint8Array([1, 2, 3])];
    VoiceRecorderUtility.isRecording = true;
    VoiceRecorderUtility._activeMimeType = "audio/webm";
    VoiceRecorderUtility.startTime = null;

    let onStopCallback = null;
    VoiceRecorderUtility.mediaRecorder = {
      set onstop(fn) { onStopCallback = fn; },
      get onstop() { return onStopCallback; },
      stop: vi.fn(() => {
        if (onStopCallback) onStopCallback();
      })
    };

    const fileName = await VoiceRecorderUtility.stopAndSaveRecording(mockApp, "Recording-5s", 5000);
    expect(fileName).toBe("Recording-5s.webm");
    expect(mockApp.vault.createBinary).toHaveBeenCalled();
  });

  it("should test simulated durations for 5s, 20s, and 60s recordings", async () => {
    for (const durationSec of [5, 20, 60]) {
      VoiceRecorderUtility.stream = { getTracks: vi.fn().mockReturnValue([]) };
      VoiceRecorderUtility.chunks = [new Uint8Array([1, 2, 3])];
      VoiceRecorderUtility.isRecording = true;
      VoiceRecorderUtility._activeMimeType = "audio/webm";
      VoiceRecorderUtility.startTime = Date.now() - (durationSec * 1000);

      let onStopCallback = null;
      VoiceRecorderUtility.mediaRecorder = {
        set onstop(fn) { onStopCallback = fn; },
        get onstop() { return onStopCallback; },
        stop: vi.fn(() => {
          if (onStopCallback) onStopCallback();
        })
      };

      const name = `Recording-${durationSec}s`;
      const fileName = await VoiceRecorderUtility.stopAndSaveRecording(mockApp, name);
      expect(fileName).toBe(`${name}.webm`);
      expect(VoiceRecorderUtility.startTime).toBeNull();
    }
  });

  it("should reset startTime and clean up state on cancelRecording", () => {
    const mockTrack = { stop: vi.fn() };
    VoiceRecorderUtility.stream = {
      getTracks: vi.fn().mockReturnValue([mockTrack])
    };
    VoiceRecorderUtility.startTime = Date.now() - 10000;
    VoiceRecorderUtility.isRecording = true;
    VoiceRecorderUtility.chunks = [new Uint8Array([1, 2, 3])];
    VoiceRecorderUtility.mediaRecorder = {
      state: "recording",
      stop: vi.fn(),
      onstop: vi.fn(),
      ondataavailable: vi.fn()
    };

    VoiceRecorderUtility.cancelRecording();

    expect(VoiceRecorderUtility.startTime).toBeNull();
    expect(VoiceRecorderUtility.isRecording).toBe(false);
    expect(VoiceRecorderUtility.chunks).toEqual([]);
    expect(mockTrack.stop).toHaveBeenCalled();
  });

  it("should gracefully save non-webm formats without WebM patching errors", async () => {
    VoiceRecorderUtility.stream = { getTracks: vi.fn().mockReturnValue([]) };
    VoiceRecorderUtility.chunks = [new Uint8Array([1, 2, 3])];
    VoiceRecorderUtility.isRecording = true;
    VoiceRecorderUtility._activeMimeType = "audio/mp4";
    VoiceRecorderUtility.startTime = Date.now() - 15000;

    let onStopCallback = null;
    VoiceRecorderUtility.mediaRecorder = {
      set onstop(fn) { onStopCallback = fn; },
      get onstop() { return onStopCallback; },
      stop: vi.fn(() => {
        if (onStopCallback) onStopCallback();
      })
    };

    const fileName = await VoiceRecorderUtility.stopAndSaveRecording(mockApp, "Recording-mp4");
    expect(fileName).toBe("Recording-mp4.mp4");
    expect(mockApp.vault.createBinary).toHaveBeenCalled();
  });

  it("should prevent duplicate startRecording calls when already starting or recording", async () => {
    VoiceRecorderUtility.isRecording = true;
    const res = await VoiceRecorderUtility.startRecording();
    expect(res).toBe(false);

    VoiceRecorderUtility.isRecording = false;
    VoiceRecorderUtility._isStarting = true;
    const res2 = await VoiceRecorderUtility.startRecording();
    expect(res2).toBe(false);
  });

  it("should release stream tracks if MediaRecorder constructor or start throws", async () => {
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

    // Simulate throwing MediaRecorder constructor
    global.MediaRecorder = vi.fn().mockImplementation(function() {
      throw new Error("Simulated MediaRecorder initialization failure");
    });
    global.MediaRecorder.isTypeSupported = vi.fn().mockReturnValue(true);

    const started = await VoiceRecorderUtility.startRecording();
    expect(started).toBe(false);
    expect(mockTrack.stop).toHaveBeenCalled();
    expect(VoiceRecorderUtility.stream).toBeNull();
    expect(VoiceRecorderUtility.isRecording).toBe(false);

    navigator.mediaDevices = originalMediaDevices;
    global.MediaRecorder = originalMediaRecorder;
  });

  it("should nullify stream and mediaRecorder after stopAndSaveRecording completes", async () => {
    const mockTrack = { stop: vi.fn() };
    VoiceRecorderUtility.stream = {
      getTracks: vi.fn().mockReturnValue([mockTrack])
    };
    VoiceRecorderUtility.chunks = [new Uint8Array([1, 2, 3])];
    VoiceRecorderUtility.isRecording = true;
    VoiceRecorderUtility._activeMimeType = "audio/webm";

    let onStopCallback = null;
    VoiceRecorderUtility.mediaRecorder = {
      state: "recording",
      set onstop(fn) { onStopCallback = fn; },
      get onstop() { return onStopCallback; },
      stop: vi.fn(() => {
        if (onStopCallback) onStopCallback();
      })
    };

    await VoiceRecorderUtility.stopAndSaveRecording(mockApp, "CleanedRecording");

    expect(mockTrack.stop).toHaveBeenCalled();
    expect(VoiceRecorderUtility.stream).toBeNull();
    expect(VoiceRecorderUtility.mediaRecorder).toBeNull();
    expect(VoiceRecorderUtility.isRecording).toBe(false);
  });

  it("should safely handle MediaRecorder state when already inactive during stop", async () => {
    const mockTrack = { stop: vi.fn() };
    VoiceRecorderUtility.stream = {
      getTracks: vi.fn().mockReturnValue([mockTrack])
    };
    VoiceRecorderUtility.chunks = [new Uint8Array([1, 2, 3])];
    VoiceRecorderUtility.isRecording = true;

    let onStopCallback = null;
    const stopMock = vi.fn();
    VoiceRecorderUtility.mediaRecorder = {
      state: "inactive",
      set onstop(fn) { onStopCallback = fn; },
      get onstop() { return onStopCallback; },
      stop: stopMock
    };

    const promise = VoiceRecorderUtility.stopAndSaveRecording(mockApp, "InactiveRecording");
    // Should trigger onstop directly without throwing InvalidStateError
    const fileName = await promise;

    expect(fileName).toBe("InactiveRecording.webm");
    expect(stopMock).not.toHaveBeenCalled();
    expect(VoiceRecorderUtility.stream).toBeNull();
    expect(VoiceRecorderUtility.mediaRecorder).toBeNull();
  });
});
