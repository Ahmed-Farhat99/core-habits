import { describe, it, expect, beforeEach, vi } from "vitest";
import { BaseHabitModal } from "../src/modals/BaseHabitModal.js";
import { ConfirmModal } from "../src/modals/ConfirmModal.js";

describe("BaseHabitModal Foundation Tests", () => {
  let mockApp;
  let mockPlugin;

  beforeEach(() => {
    mockApp = {};
    mockPlugin = {
      settings: { language: "ar" },
      translationManager: {
        t: vi.fn().mockImplementation((key) => {
          const dict = {
            direction: "rtl",
            confirm_discard_changes_title: "تعديلات غير محفوظة",
            confirm_discard_changes_desc: "لديك تعديلات غير محفوظة، هل أنت متأكد من تجاهلها؟",
            discard_changes_btn: "تجاهل التعديلات",
            keep_editing_btn: "متابعة التعديل",
            cancel: "إلغاء",
            save_btn: "حفظ"
          };
          return dict[key] || key;
        })
      }
    };
  });

  it("should close immediately when modal is clean (isDirty === false)", () => {
    const modal = new BaseHabitModal(mockApp, mockPlugin);
    const superCloseSpy = vi.spyOn(Object.getPrototypeOf(BaseHabitModal.prototype), "close");

    modal.close();

    expect(superCloseSpy).toHaveBeenCalledTimes(1);
    expect(modal._isPromptingConfirm).toBe(false);
  });

  it("should intercept close() when modal is dirty and prompt confirmation", () => {
    class DirtyModal extends BaseHabitModal {
      isDirty() {
        return true;
      }
    }

    const modal = new DirtyModal(mockApp, mockPlugin);
    const superCloseSpy = vi.spyOn(Object.getPrototypeOf(BaseHabitModal.prototype), "close");
    const promptSpy = vi.spyOn(modal, "promptDiscardConfirmation");

    modal.close();

    // Must NOT call super.close() directly
    expect(superCloseSpy).not.toHaveBeenCalled();
    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(modal._isPromptingConfirm).toBe(true);
  });

  it("should close modal when user chooses Discard in confirmation prompt", () => {
    class DirtyModal extends BaseHabitModal {
      isDirty() {
        return true;
      }
    }

    const modal = new DirtyModal(mockApp, mockPlugin);
    const superCloseSpy = vi.spyOn(Object.getPrototypeOf(BaseHabitModal.prototype), "close");

    modal.close();
    expect(superCloseSpy).not.toHaveBeenCalled();

    // Trigger discard confirmation callback
    modal.forceClose();

    expect(superCloseSpy).toHaveBeenCalledTimes(1);
    expect(modal._isPromptingConfirm).toBe(false);
  });

  it("should remain open and not close when user chooses Keep Editing", () => {
    class DirtyModal extends BaseHabitModal {
      isDirty() {
        return true;
      }
    }

    const modal = new DirtyModal(mockApp, mockPlugin);
    const superCloseSpy = vi.spyOn(Object.getPrototypeOf(BaseHabitModal.prototype), "close");

    modal.promptDiscardConfirmation(
      () => modal.forceClose(),
      () => { /* Keep editing */ }
    );

    expect(superCloseSpy).not.toHaveBeenCalled();
    expect(modal._isPromptingConfirm).toBe(true);
  });

  it("should prevent duplicate confirmation prompts on rapid close() calls", () => {
    class DirtyModal extends BaseHabitModal {
      isDirty() {
        return true;
      }
    }

    const modal = new DirtyModal(mockApp, mockPlugin);
    const promptSpy = vi.spyOn(modal, "promptDiscardConfirmation");

    modal.close();
    modal.close();
    modal.close();

    expect(promptSpy).toHaveBeenCalledTimes(1);
  });

  it("should allow forceClose() to bypass confirmation loop completely", () => {
    class DirtyModal extends BaseHabitModal {
      isDirty() {
        return true;
      }
    }

    const modal = new DirtyModal(mockApp, mockPlugin);
    const superCloseSpy = vi.spyOn(Object.getPrototypeOf(BaseHabitModal.prototype), "close");

    modal.forceClose();

    expect(superCloseSpy).toHaveBeenCalledTimes(1);
    expect(modal._forceClose).toBe(false);
  });

  it("should cancel active voice recording on onClose() teardown", () => {
    const modal = new BaseHabitModal(mockApp, mockPlugin);
    modal.voiceRecorder = {
      cancelRecording: vi.fn()
    };

    modal.onClose();

    expect(modal.voiceRecorder.cancelRecording).toHaveBeenCalledTimes(1);
  });

  it("should build standardized header, body, footer, and footer buttons with correct hierarchy", () => {
    const modal = new BaseHabitModal(mockApp, mockPlugin);
    const root = document.createElement("div");

    // 1. Header
    const header = modal.createModalHeader(root, {
      title: "Test Modal Title",
      icon: "✨",
      subtitle: "Optional Subtitle"
    });
    expect(header.classList.contains("dh-modal-header")).toBe(true);
    expect(header.querySelector(".dh-modal-title").textContent).toBe("Test Modal Title");
    expect(header.querySelector(".dh-modal-header-icon").textContent).toBe("✨");
    expect(header.querySelector(".dh-modal-subtitle").textContent).toBe("Optional Subtitle");

    // 2. Body
    const body = modal.createModalBody(root, "custom-form");
    expect(body.classList.contains("dh-modal-body")).toBe(true);
    expect(body.classList.contains("custom-form")).toBe(true);

    // 3. Footer
    const { footerEl, startGroup, endGroup } = modal.createModalFooter(root);
    expect(footerEl.classList.contains("dh-modal-footer")).toBe(true);
    expect(startGroup.classList.contains("dh-modal-footer-start")).toBe(true);
    expect(endGroup.classList.contains("dh-modal-footer-end")).toBe(true);

    // 4. Buttons (Order: Cancel first, then Save)
    const onCancel = vi.fn();
    const onSave = vi.fn();
    const { cancelBtn, saveBtn } = modal.createFooterButtons(endGroup, {
      cancelText: "إلغاء",
      saveText: "حفظ",
      onCancel,
      onSave
    });

    expect(cancelBtn.classList.contains("mod-cancel")).toBe(true);
    expect(saveBtn.classList.contains("mod-cta")).toBe(true);

    // In DOM, cancelBtn is first child of endGroup, saveBtn is second
    expect(endGroup.children[0]).toBe(cancelBtn);
    expect(endGroup.children[1]).toBe(saveBtn);

    cancelBtn.click();
    expect(onCancel).toHaveBeenCalledTimes(1);

    saveBtn.click();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("should integrate with ConfirmModal without circular dependency or infinite recursion", () => {
    expect(BaseHabitModal.ConfirmModal).toBe(ConfirmModal);

    const confirmModal = new ConfirmModal(mockApp, mockPlugin, "هل أنت متأكد؟", {
      title: "تأكيد العملية",
      confirmText: "نعم",
      cancelText: "لا"
    });

    // ConfirmModal must NOT be dirty by default
    expect(confirmModal.isDirty()).toBe(false);

    const superCloseSpy = vi.spyOn(Object.getPrototypeOf(BaseHabitModal.prototype), "close");
    confirmModal.close();

    // Closing ConfirmModal must call super.close() immediately without prompt
    expect(superCloseSpy).toHaveBeenCalledTimes(1);
  });

  it("should decorate modalEl and contentEl with daily-habits-plugin and dir attribute on onOpen", () => {
    const modal = new BaseHabitModal(mockApp, mockPlugin);
    modal.modalEl = document.createElement("div");
    modal.contentEl = document.createElement("div");

    modal.onOpen();

    expect(modal.modalEl.classList.contains("daily-habits-plugin")).toBe(true);
    expect(modal.modalEl.classList.contains("dh-modal-wrapper")).toBe(true);
    expect(modal.modalEl.getAttribute("dir")).toBe("rtl");
    expect(modal.modalEl.classList.contains("is-rtl")).toBe(true);

    expect(modal.contentEl.classList.contains("daily-habits-plugin")).toBe(true);
    expect(modal.contentEl.classList.contains("daily-habits-modal")).toBe(true);
    expect(modal.contentEl.getAttribute("dir")).toBe("rtl");
    expect(modal.contentEl.classList.contains("is-rtl")).toBe(true);
  });

  it("should handle Enter key to confirm in ConfirmModal", async () => {
    const onConfirm = vi.fn();
    const modal = new ConfirmModal(mockApp, mockPlugin, "Confirm this action?", {
      onConfirm,
      isDanger: false
    });
    modal.modalEl = document.createElement("div");
    modal.contentEl = document.createElement("div");

    modal.onOpen();

    const enterEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    modal.contentEl.dispatchEvent(enterEvent);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

