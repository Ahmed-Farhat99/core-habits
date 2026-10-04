import { describe, it, expect, beforeEach, vi } from "vitest";
import { HabitCommentPopup } from "../src/modals/HabitCommentPopup.js";
import { ReflectionPopup } from "../src/modals/ReflectionPopup.js";
import { BaseHabitModal } from "../src/modals/BaseHabitModal.js";
import "../src/modals/ConfirmModal.js"; // Registers the runtime discard dialog.

describe("HabitCommentPopup and ReflectionPopup Discard Prevention & Button Hierarchy", () => {
  let mockApp;
  let mockPlugin;
  let mockHabit;
  let mockDate;

  beforeEach(() => {
    mockApp = {};
    mockHabit = { name: "Morning Reading", property: "reading" };
    mockDate = {
      clone: () => ({
        locale: () => ({
          format: () => "20 سبتمبر 2026"
        })
      })
    };
    mockPlugin = {
      settings: { language: "ar" },
      habitCommentRepository: {
        getCommentForHabitDate: vi.fn().mockResolvedValue("")
      },
      translationManager: {
        t: vi.fn().mockImplementation((k) => {
          const dict = {
            direction: "rtl",
            comment_placeholder: "اكتب خاطرة...",
            comment_loading: "جاري التحميل...",
            comment_save: "حفظ",
            cancel: "إلغاء",
            reflection_modal_title: "تدوين يومي",
            reflection_notes_placeholder: "كيف كان يومك؟",
            reflection_save: "حفظ التدوين",
            reflection_saving: "جاري...",
            reflection_save_success_comment: "تم الحفظ",
            reflection_save_success: "تم الحفظ"
          };
          return dict[k] || k;
        })
      }
    };
  });

  describe("HabitCommentPopup", () => {
    it("should start with clean state (isDirty === false)", () => {
      const popup = new HabitCommentPopup(mockApp, mockPlugin, mockHabit, mockDate, vi.fn());
      expect(popup.isDirty()).toBe(false);
    });

    it("should become dirty when user modifies text in textarea", () => {
      const popup = new HabitCommentPopup(mockApp, mockPlugin, mockHabit, mockDate, vi.fn());
      popup.onOpen();

      expect(popup.isDirty()).toBe(false);

      popup.inputEl.value = "New insightful thought";
      expect(popup.isDirty()).toBe(true);

      popup.inputEl.value = "";
      expect(popup.isDirty()).toBe(false);
    });

    it("should recognize dirty state against pre-existing comments", async () => {
      mockPlugin.habitCommentRepository.getCommentForHabitDate.mockResolvedValue("Existing comment");
      const popup = new HabitCommentPopup(mockApp, mockPlugin, mockHabit, mockDate, vi.fn());
      popup.onOpen();

      // Wait for repository promise resolution
      await new Promise((r) => setTimeout(r, 10));

      expect(popup.initialComment).toBe("Existing comment");
      expect(popup.isDirty()).toBe(false);

      popup.inputEl.value = "Existing comment edited";
      expect(popup.isDirty()).toBe(true);

      popup.inputEl.value = "Existing comment";
      expect(popup.isDirty()).toBe(false);
    });

    it("should intercept close() when dirty and prevent silent data loss", () => {
      const popup = new HabitCommentPopup(mockApp, mockPlugin, mockHabit, mockDate, vi.fn());
      popup.onOpen();
      popup.inputEl.value = "Important reflection note";

      const promptSpy = vi.spyOn(popup, "promptDiscardConfirmation");
      const superCloseSpy = vi.spyOn(Object.getPrototypeOf(BaseHabitModal.prototype), "close");

      popup.close();

      expect(promptSpy).toHaveBeenCalledTimes(1);
      expect(superCloseSpy).not.toHaveBeenCalled();
      expect(popup._isPromptingConfirm).toBe(true);
    });

    it("should close immediately without confirmation when clean", () => {
      const popup = new HabitCommentPopup(mockApp, mockPlugin, mockHabit, mockDate, vi.fn());
      popup.onOpen();

      const promptSpy = vi.spyOn(popup, "promptDiscardConfirmation");
      const superCloseSpy = vi.spyOn(Object.getPrototypeOf(BaseHabitModal.prototype), "close");

      popup.close();

      expect(promptSpy).not.toHaveBeenCalled();
      expect(superCloseSpy).toHaveBeenCalledTimes(1);
    });

    it("should structure footer buttons in unified order: cancel first, save second", () => {
      const popup = new HabitCommentPopup(mockApp, mockPlugin, mockHabit, mockDate, vi.fn());
      popup.onOpen();

      const actionsRight = popup.contentEl.querySelector(".dh-popup-actions-right");
      expect(actionsRight).not.toBeNull();

      const buttons = actionsRight.querySelectorAll("button");
      expect(buttons.length).toBe(2);

      // Child 0 must be Cancel button
      expect(buttons[0].classList.contains("mod-cancel")).toBe(true);
      expect(buttons[0].textContent).toBe("إلغاء");

      // Child 1 must be Save button (CTA)
      expect(buttons[1].classList.contains("mod-cta")).toBe(true);
      expect(buttons[1].textContent).toBe("حفظ");
    });

    it("should call forceClose() on successful save to bypass discard prompt", async () => {
      const onSaveMock = vi.fn().mockResolvedValue("NoteFile.md");
      const popup = new HabitCommentPopup(mockApp, mockPlugin, mockHabit, mockDate, onSaveMock);
      popup.onOpen();
      popup.inputEl.value = "Saved successfully";

      const forceCloseSpy = vi.spyOn(popup, "forceClose");
      const saveBtn = popup.contentEl.querySelector(".dh-popup-actions-right .mod-cta");

      saveBtn.click();

      // Wait for save promise
      await new Promise((r) => setTimeout(r, 10));

      expect(onSaveMock).toHaveBeenCalledWith("Saved successfully");
      expect(forceCloseSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("ReflectionPopup", () => {
    it("should track dirty state for notes and type selection", () => {
      const popup = new ReflectionPopup(mockApp, mockPlugin, mockDate, vi.fn());
      popup.onOpen();

      expect(popup.isDirty()).toBe(false);

      popup.inputEl.value = "Today I learned something new";
      expect(popup.isDirty()).toBe(true);

      popup.inputEl.value = "";
      expect(popup.isDirty()).toBe(false);

      // Changing reflection type also marks dirty
      popup.selectedType = "Lesson";
      expect(popup.isDirty()).toBe(true);
    });

    it("should structure footer buttons in unified order: cancel first, save second", () => {
      const popup = new ReflectionPopup(mockApp, mockPlugin, mockDate, vi.fn());
      popup.onOpen();

      const actionsRight = popup.contentEl.querySelector(".dh-popup-actions-right");
      expect(actionsRight).not.toBeNull();

      const buttons = actionsRight.querySelectorAll("button");
      expect(buttons.length).toBe(2);

      // Child 0 must be Cancel button
      expect(buttons[0].classList.contains("mod-cancel")).toBe(true);
      expect(buttons[0].textContent).toBe("إلغاء");

      // Child 1 must be Save button (CTA)
      expect(buttons[1].classList.contains("mod-cta")).toBe(true);
      expect(buttons[1].textContent).toBe("حفظ التدوين");
    });
  });
});
