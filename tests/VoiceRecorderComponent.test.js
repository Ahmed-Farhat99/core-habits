import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VoiceRecorderComponent } from "../src/components/VoiceRecorderComponent.js";
import { VoiceRecorderUtility } from "../src/services/VoiceRecorderUtility.js";

describe("VoiceRecorderComponent States, Lifecycle & UI Tests", () => {
  let container;
  let mockPlugin;
  let mockApp;
  let mockInputEl;

  beforeEach(() => {
    container = document.createElement("div");
    mockInputEl = document.createElement("textarea");
    mockInputEl.placeholder = "Write a reflection...";
    container.appendChild(mockInputEl);

    mockPlugin = {
      translationManager: {
        t: (k, params = {}) => {
          if (k === "reflection_mic_btn_voice") return "تسجيل صوتي";
          if (k === "reflection_mic_stop") return "إيقاف التسجيل";
          if (k === "reflection_mic_recording") return `جاري التسجيل... ${params.time || ""}`;
          if (k === "reflection_mic_processing") return "معالجة الصوت...";
          if (k === "reflection_mic_failed") return "فشل الوصول للميكروفون!";
          if (k === "reflection_mic_save_failed") return "فشل حفظ الملف الصوتي!";
          return k;
        }
      }
    };
    mockApp = {};
  });

  afterEach(() => {
    VoiceRecorderUtility.cancelRecording();
    vi.restoreAllMocks();
  });

  it("Idle State: should render with correct icon, label, aria-label, and enabled state", () => {
    const comp = new VoiceRecorderComponent(container, {
      app: mockApp,
      plugin: mockPlugin,
      inputEl: mockInputEl,
      placeholderDefault: "Write a reflection..."
    });

    expect(comp.micBtn).not.toBeNull();
    expect(comp.micBtn.classList.contains("dh-popup-mic-btn")).toBe(true);
    expect(comp.micBtn.classList.contains("is-recording")).toBe(false);
    expect(comp.micBtn.disabled).toBe(false);
    expect(comp.micBtn.getAttribute("aria-label")).toBe("تسجيل صوتي");
    expect(comp.micTextEl.textContent).toBe("تسجيل صوتي");
    expect(comp.isRecording).toBe(false);
    expect(mockInputEl.disabled).toBe(false);
  });

  it("Recording State: should update label with live timer and disable textarea", async () => {
    vi.spyOn(VoiceRecorderUtility, "startRecording").mockResolvedValue(true);

    const comp = new VoiceRecorderComponent(container, {
      app: mockApp,
      plugin: mockPlugin,
      inputEl: mockInputEl,
      placeholderDefault: "Write a reflection..."
    });

    await comp.start();

    expect(comp.isRecording).toBe(true);
    expect(comp.micBtn.classList.contains("is-recording")).toBe(true);
    expect(comp.micTextEl.textContent).toBe("إيقاف التسجيل (00:00)");
    expect(mockInputEl.disabled).toBe(true);
    expect(mockInputEl.placeholder).toContain("00:00");

    comp.cleanup();
  });

  it("Stopping / Processing State: should enter is-processing, disable button, and save", async () => {
    vi.spyOn(VoiceRecorderUtility, "startRecording").mockResolvedValue(true);
    let capturedStateDuringStop = null;

    vi.spyOn(VoiceRecorderUtility, "stopAndSaveRecording").mockImplementation(async () => {
      // Capture button state while asynchronous saving is in progress
      capturedStateDuringStop = {
        isProcessing: comp.micBtn.classList.contains("is-processing"),
        isDisabled: comp.micBtn.disabled,
        label: comp.micTextEl.textContent
      };
      return "Recording-2026-10-07.webm";
    });

    const onSaveSpy = vi.fn();
    const comp = new VoiceRecorderComponent(container, {
      app: mockApp,
      plugin: mockPlugin,
      inputEl: mockInputEl,
      onSaveSuccess: onSaveSpy
    });

    await comp.start();
    await comp.stop();

    // Verify state while stop was in flight
    expect(capturedStateDuringStop).not.toBeNull();
    expect(capturedStateDuringStop.isProcessing).toBe(true);
    expect(capturedStateDuringStop.isDisabled).toBe(true);
    expect(capturedStateDuringStop.label).toBe("معالجة الصوت...");

    // Verify return to idle after stop finishes
    expect(comp.isRecording).toBe(false);
    expect(comp.micBtn.disabled).toBe(false);
    expect(comp.micBtn.classList.contains("is-processing")).toBe(false);
    expect(comp.micTextEl.textContent).toBe("تسجيل صوتي");
    expect(mockInputEl.disabled).toBe(false);
    expect(mockInputEl.value).toContain("![[Recording-2026-10-07.webm]]");
    expect(onSaveSpy).toHaveBeenCalledWith("Recording-2026-10-07.webm");
  });

  it("Error State: should safely recover to idle if startRecording fails", async () => {
    vi.spyOn(VoiceRecorderUtility, "startRecording").mockResolvedValue(false);

    const comp = new VoiceRecorderComponent(container, {
      app: mockApp,
      plugin: mockPlugin,
      inputEl: mockInputEl,
      placeholderDefault: "Write a reflection..."
    });

    await comp.start();

    expect(comp.isRecording).toBe(false);
    expect(comp.micBtn.disabled).toBe(false);
    expect(comp.micBtn.classList.contains("is-recording")).toBe(false);
    expect(mockInputEl.disabled).toBe(false);
    expect(mockInputEl.placeholder).toBe("Write a reflection...");
  });

  it("Close Modal Cleanup: cancels recording and restores inputEl and mic button", () => {
    const cancelSpy = vi.spyOn(VoiceRecorderUtility, "cancelRecording");

    const comp = new VoiceRecorderComponent(container, {
      app: mockApp,
      plugin: mockPlugin,
      inputEl: mockInputEl,
      placeholderDefault: "Write a reflection..."
    });

    comp.isRecording = true;
    mockInputEl.disabled = true;
    comp.cleanup();

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(comp.isRecording).toBe(false);
    expect(mockInputEl.disabled).toBe(false);
    expect(mockInputEl.placeholder).toBe("Write a reflection...");
    expect(comp.micBtn.disabled).toBe(false);
    expect(comp.micTextEl.textContent).toBe("تسجيل صوتي");
  });

  it("pulseAttention: should add and remove animation class", async () => {
    const comp = new VoiceRecorderComponent(container, {
      app: mockApp,
      plugin: mockPlugin
    });

    comp.pulseAttention();
    expect(comp.micBtn.classList.contains("dh-pulse-attention")).toBe(true);
  });
});
