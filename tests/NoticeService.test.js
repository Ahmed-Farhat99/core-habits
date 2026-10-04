import { describe, it, expect, vi } from "vitest";
import { NoticeService } from "../src/services/NoticeService.js";

describe("NoticeService", () => {
  it("wraps count in bdi tags", () => {
    const wrapped = NoticeService.wrapCount(5);
    expect(wrapped).toBe('<bdi class="dh-notice-count">5</bdi>');
  });

  it("handles string count in wrapCount", () => {
    const wrapped = NoticeService.wrapCount("12");
    expect(wrapped).toBe('<bdi class="dh-notice-count">12</bdi>');
  });

  it("creates standard info notice with daily-habits-plugin class and direction", () => {
    const fakePlugin = { translationManager: { isRTL: () => true } };
    const notice = NoticeService.info("Hello world", { plugin: fakePlugin });
    expect(notice.noticeEl.classList.contains("daily-habits-plugin")).toBe(true);
    expect(notice.noticeEl.getAttribute("dir")).toBe("rtl");
  });

  it("creates success and error notices", () => {
    const successNotice = NoticeService.success("Saved!");
    expect(successNotice.noticeEl.classList.contains("daily-habits-plugin")).toBe(true);

    const errorNotice = NoticeService.error("Failed!");
    expect(errorNotice.noticeEl.classList.contains("daily-habits-plugin")).toBe(true);
  });

  it("creates action notice and triggers onAction callback", () => {
    const onAction = vi.fn();
    const onClose = vi.fn();

    const notice = NoticeService.action({
      message: "Test action message",
      actionText: "Run Action",
      onAction,
      onClose
    });

    expect(notice.noticeEl.classList.contains("daily-habits-plugin")).toBe(true);
    const actionBtn = notice.noticeEl.querySelector(".dh-notice-action-btn");
    expect(actionBtn).not.toBeNull();
    expect(actionBtn.textContent).toBe("Run Action");

    actionBtn.click();
    expect(onAction).toHaveBeenCalledTimes(1);

    const closeBtn = notice.noticeEl.querySelector(".dh-notice-close-btn");
    expect(closeBtn).not.toBeNull();
    closeBtn.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("creates undo notice and triggers onUndo callback", () => {
    const onUndo = vi.fn();
    const notice = NoticeService.undo({
      message: "Habit archived",
      undoText: "Undo",
      onUndo
    });

    expect(notice.noticeEl.classList.contains("daily-habits-plugin")).toBe(true);
    const undoBtn = notice.noticeEl.querySelector(".dh-notice-undo-btn");
    expect(undoBtn).not.toBeNull();
    expect(undoBtn.textContent).toBe("Undo");

    undoBtn.click();
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("normalizes options object across warning, success, and error methods", () => {
    const fakePlugin = { translationManager: { isRTL: () => true } };

    // warning with options object
    const warnNotice = NoticeService.warning("Stop first!", { plugin: fakePlugin });
    expect(typeof warnNotice.duration).toBe("number");
    expect(warnNotice.duration).toBe(6000);
    expect(warnNotice.noticeEl.classList.contains("dh-notice-warning")).toBe(true);
    expect(warnNotice.noticeEl.classList.contains("daily-habits-plugin")).toBe(true);
    expect(warnNotice.noticeEl.getAttribute("dir")).toBe("rtl");

    // success with options object
    const succNotice = NoticeService.success("Done!", { plugin: fakePlugin });
    expect(typeof succNotice.duration).toBe("number");
    expect(succNotice.duration).toBe(4000);
    expect(succNotice.noticeEl.classList.contains("dh-notice-success")).toBe(true);
    expect(succNotice.noticeEl.getAttribute("dir")).toBe("rtl");

    // error with options object
    const errNotice = NoticeService.error("Failed!", { plugin: fakePlugin });
    expect(typeof errNotice.duration).toBe("number");
    expect(errNotice.duration).toBe(8000);
    expect(errNotice.noticeEl.classList.contains("dh-notice-error")).toBe(true);
    expect(errNotice.noticeEl.getAttribute("dir")).toBe("rtl");

    // direct plugin instance as second argument
    const directNotice = NoticeService.show("Notice text", fakePlugin);
    expect(typeof directNotice.duration).toBe("number");
    expect(directNotice.duration).toBe(4000);
    expect(directNotice.noticeEl.getAttribute("dir")).toBe("rtl");

    // explicit numeric duration + plugin
    const customNotice = NoticeService.warning("Warning custom", 3000, fakePlugin);
    expect(customNotice.duration).toBe(3000);
    expect(customNotice.noticeEl.classList.contains("dh-notice-warning")).toBe(true);
  });
});
