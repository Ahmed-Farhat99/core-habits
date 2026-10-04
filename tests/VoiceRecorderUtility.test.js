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
    VoiceRecorderUtility.mediaRecorder = null;
    VoiceRecorderUtility.stream = null;
    VoiceRecorderUtility.chunks = [];
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
});
