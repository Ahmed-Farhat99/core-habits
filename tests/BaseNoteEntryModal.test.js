import { describe, it, expect, beforeEach, vi } from "vitest";
import { BaseNoteEntryModal } from "../src/modals/BaseNoteEntryModal.js";

describe("BaseNoteEntryModal Foundation Tests", () => {
  let mockApp;
  let mockPlugin;
  let mockDate;

  beforeEach(() => {
    mockApp = {};
    mockDate = {
      clone: () => ({
        locale: () => ({
          format: () => "21 سبتمبر 2026"
        })
      })
    };
    mockPlugin = {
      settings: { language: "ar" },
      translationManager: {
        t: vi.fn().mockImplementation((k) => {
          const dict = {
            direction: "rtl",
            cancel: "إلغاء",
            reflection_mic_stop_first: "أوقف التسجيل أولاً",
            reflection_saving: "جاري الحفظ..."
          };
          return dict[k] || k;
        })
      }
    };
  });

  it("should initialize default state correctly", () => {
    const modal = new BaseNoteEntryModal(mockApp, mockPlugin, { date: mockDate });
    expect(modal.date).toBe(mockDate);
    expect(modal.inputEl).toBeNull();
    expect(modal.voiceRecorder).toBeNull();
    expect(modal.saveBtn).toBeNull();
    expect(modal.cancelBtn).toBeNull();
    expect(modal.isDirty()).toBe(false);
  });

  it("should sanitize text properly (strip markdown headings, multi-newlines, whitespace)", () => {
    const modal = new BaseNoteEntryModal(mockApp, mockPlugin);
    
    // Normal text
    expect(modal.sanitizeText("  Simple thought  ")).toBe("Simple thought");

    // Markdown headings and multiple newlines
    const rawWithMarkdown = "### Heading 3\n\nSome reflection text\n\nMore notes";
    expect(modal.sanitizeText(rawWithMarkdown)).toBe("Heading 3 Some reflection text More notes");

    // Truncate text longer than 2000 chars
    const hugeText = "a".repeat(3000);
    expect(modal.sanitizeText(hugeText).length).toBe(2000);
  });

  it("should format date localized according to translation key", () => {
    const modal = new BaseNoteEntryModal(mockApp, mockPlugin, { date: mockDate });
    expect(modal.getFormattedDate("date_format_medium")).toBe("21 سبتمبر 2026");
  });

  it("should apply popup compact styles onOpen", () => {
    const modal = new BaseNoteEntryModal(mockApp, mockPlugin, { date: mockDate });
    modal.onOpen();

    expect(modal.contentEl.classList.contains("dh-popup-compact")).toBe(true);
    expect(modal.contentEl.classList.contains("daily-habits-modal")).toBe(true);
    expect(modal.modalEl.classList.contains("dh-popup-modal-parent")).toBe(true);
  });

  it("should prevent submission when voice recorder is actively recording", async () => {
    const modal = new BaseNoteEntryModal(mockApp, mockPlugin);
    modal.onOpen();
    const mockPulse = vi.fn();
    modal.voiceRecorder = { isRecording: true, cleanup: vi.fn(), pulseAttention: mockPulse };
    modal.inputEl = { value: "Valid note" };

    const handleSaveSpy = vi.spyOn(modal, "handleSave");
    await modal.submit();

    expect(handleSaveSpy).not.toHaveBeenCalled();
    expect(mockPulse).toHaveBeenCalledTimes(1);
  });

  it("should show input error animation when submitting empty note", async () => {
    const modal = new BaseNoteEntryModal(mockApp, mockPlugin);
    modal.onOpen();
    const input = modal.createNoteInput(modal.contentEl, { placeholder: "Write note..." });
    input.value = "   ";

    const showInputErrorSpy = vi.spyOn(modal, "showInputError");
    const handleSaveSpy = vi.spyOn(modal, "handleSave");

    await modal.submit();

    expect(showInputErrorSpy).toHaveBeenCalledTimes(1);
    expect(handleSaveSpy).not.toHaveBeenCalled();
  });

  it("should invoke voiceRecorder.cleanup() upon onClose", () => {
    const modal = new BaseNoteEntryModal(mockApp, mockPlugin);
    const mockCleanup = vi.fn();
    modal.voiceRecorder = { cleanup: mockCleanup };

    modal.onClose();

    expect(mockCleanup).toHaveBeenCalledTimes(1);
  });

  it("should create category picker with correct accessibility roles and selection handling", () => {
    const modal = new BaseNoteEntryModal(mockApp, mockPlugin);
    modal.onOpen();

    const categories = [
      { key: "Good", label: "جيد" },
      { key: "Bad", label: "سيء" },
      { key: "Idea", label: "فكرة" }
    ];
    const onSelectSpy = vi.fn();

    const picker = modal.createCategoryPicker(modal.contentEl, {
      categories,
      selectedKey: "Good",
      onSelect: onSelectSpy
    });

    expect(picker.getAttribute("role")).toBe("radiogroup");
    const buttons = picker.querySelectorAll("button");
    expect(buttons.length).toBe(3);

    // Initial selected state
    expect(buttons[0].classList.contains("is-active")).toBe(true);
    expect(buttons[0].getAttribute("aria-checked")).toBe("true");
    expect(buttons[1].classList.contains("is-active")).toBe(false);
    expect(buttons[1].getAttribute("aria-checked")).toBe("false");

    // Click on Idea
    buttons[2].click();
    expect(buttons[0].classList.contains("is-active")).toBe(false);
    expect(buttons[0].getAttribute("aria-checked")).toBe("false");
    expect(buttons[2].classList.contains("is-active")).toBe(true);
    expect(buttons[2].getAttribute("aria-checked")).toBe("true");
    expect(onSelectSpy).toHaveBeenCalledWith("Idea");
  });

  it("should submit on Enter and allow new lines on Shift+Enter", () => {
    const modal = new BaseNoteEntryModal(mockApp, mockPlugin);
    modal.onOpen();

    const submitSpy = vi.spyOn(modal, "submit").mockImplementation(() => {});
    const input = modal.createNoteInput(modal.contentEl, { placeholder: "Type here" });

    // Shift + Enter should NOT submit
    const shiftEnterEvent = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, cancelable: true });
    input.dispatchEvent(shiftEnterEvent);
    expect(shiftEnterEvent.defaultPrevented).toBe(false);
    expect(submitSpy).not.toHaveBeenCalled();

    // Plain Enter should submit and prevent default
    const enterEvent = new KeyboardEvent("keydown", { key: "Enter", shiftKey: false, cancelable: true });
    input.dispatchEvent(enterEvent);
    expect(enterEvent.defaultPrevented).toBe(true);
    expect(submitSpy).toHaveBeenCalledTimes(1);
  });

  it("should create popup header with icon, title, and isolated metaHtml", () => {
    const modal = new BaseNoteEntryModal(mockApp, mockPlugin);
    modal.onOpen();

    const { header, metaEl } = modal.createPopupHeader(modal.contentEl, {
      iconName: "book-open",
      titleText: "يوميات",
      metaHtml: "21 سبتمبر • <bdi>14:30</bdi>"
    });

    expect(header.querySelector(".dh-popup-title").textContent).toBe("يوميات");
    expect(metaEl.innerHTML).toBe("21 سبتمبر • <bdi>14:30</bdi>");
  });
});
