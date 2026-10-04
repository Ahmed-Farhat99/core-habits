import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GridInteractionHelper } from "../src/views/grid/GridInteractionHelper.js";
import moment from "moment";

describe("GridInteractionHelper Unit Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getNextStatus", () => {
    it("should cycle correctly: completed -> skipped -> uncompleted -> completed", () => {
      expect(GridInteractionHelper.getNextStatus("completed")).toBe("skipped");
      expect(GridInteractionHelper.getNextStatus("skipped")).toBe("uncompleted");
      expect(GridInteractionHelper.getNextStatus("uncompleted")).toBe("completed");
      expect(GridInteractionHelper.getNextStatus("missed")).toBe("completed");
      expect(GridInteractionHelper.getNextStatus(null)).toBe("completed");
    });
  });

  it("keeps day availability separate from a missing daily note", () => {
    const today = moment("2026-09-06");
    const habit = { id: "habit-1" };
    const manager = { isHabitScheduledForDay: () => true };
    expect(GridInteractionHelper.getDayAvailability(habit, today, today, manager)).toBe("available");
    expect(GridInteractionHelper.getVisibleStatus("ignored", { hasNote: false }, today, today)).toBe("uncompleted");
    expect(GridInteractionHelper.getVisibleStatus("ignored", { hasNote: false }, today.clone().subtract(1, "day"), today)).toBe("missed");
    expect(GridInteractionHelper.getDayAvailability({ ...habit, restoredDate: today.valueOf() }, today.clone().subtract(1, "day"), today, manager)).toBe("ignored");
  });

  describe("getStatusIcon", () => {
    it("should return correct symbol for every status", () => {
      expect(GridInteractionHelper.getStatusIcon("completed")).toBe("✓");
      expect(GridInteractionHelper.getStatusIcon("skipped")).toBe("⊘");
      expect(GridInteractionHelper.getStatusIcon("missed")).toBe("x");
      expect(GridInteractionHelper.getStatusIcon("uncompleted")).toBe("☐");
      expect(GridInteractionHelper.getStatusIcon("pending")).toBe("☐");
      expect(GridInteractionHelper.getStatusIcon(null)).toBe("☐");
    });
  });

  describe("triggerPulseAnimation", () => {
    it("should add habit-pulse and remove it after specified duration", () => {
      const el = document.createElement("div");
      GridInteractionHelper.triggerPulseAnimation(el, 400);

      expect(el.classList.contains("habit-pulse")).toBe(true);

      vi.advanceTimersByTime(399);
      expect(el.classList.contains("habit-pulse")).toBe(true);

      vi.advanceTimersByTime(2);
      expect(el.classList.contains("habit-pulse")).toBe(false);
    });

    it("should handle null or invalid element gracefully", () => {
      expect(() => GridInteractionHelper.triggerPulseAnimation(null)).not.toThrow();
    });
  });

  describe("attachCommentPopupListeners", () => {
    it("should open popup on contextmenu and prevent default", () => {
      const el = document.createElement("button");
      const onOpen = vi.fn();
      GridInteractionHelper.attachCommentPopupListeners(el, onOpen);

      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      el.dispatchEvent(event);

      expect(onOpen).toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });

    it("should trigger popup after 500ms touchstart", () => {
      const el = document.createElement("button");
      const onOpen = vi.fn();
      GridInteractionHelper.attachCommentPopupListeners(el, onOpen);

      el.dispatchEvent(new Event("touchstart"));
      expect(onOpen).not.toHaveBeenCalled();

      vi.advanceTimersByTime(499);
      expect(onOpen).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2);
      expect(onOpen).toHaveBeenCalled();
    });

    it("should cancel touch timer on touchend before 500ms", () => {
      const el = document.createElement("button");
      const onOpen = vi.fn();
      GridInteractionHelper.attachCommentPopupListeners(el, onOpen);

      el.dispatchEvent(new Event("touchstart"));
      vi.advanceTimersByTime(200);
      el.dispatchEvent(new Event("touchend"));

      vi.advanceTimersByTime(400);
      expect(onOpen).not.toHaveBeenCalled();
    });

    it("should cancel touch timer on touchmove before 500ms", () => {
      const el = document.createElement("button");
      const onOpen = vi.fn();
      GridInteractionHelper.attachCommentPopupListeners(el, onOpen);

      el.dispatchEvent(new Event("touchstart"));
      vi.advanceTimersByTime(200);
      el.dispatchEvent(new Event("touchmove"));

      vi.advanceTimersByTime(400);
      expect(onOpen).not.toHaveBeenCalled();
    });

    it("does not toggle a habit after a long press opens its comment", () => {
      const el = document.createElement("button");
      const onOpen = vi.fn();
      const onClick = vi.fn();
      el.onclick = onClick;
      GridInteractionHelper.attachCommentPopupListeners(el, onOpen);

      el.dispatchEvent(new Event("touchstart"));
      vi.advanceTimersByTime(500);
      el.dispatchEvent(new Event("touchend"));
      el.click();

      expect(onOpen).toHaveBeenCalledOnce();
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe("wireGroupCollapseButtons", () => {
    it("should set initial collapse state and wire click toggle with onToggle callback", async () => {
      const container = document.createElement("div");
      const btn = document.createElement("button");
      btn.setAttribute("data-collapse-id", "parent-1");
      container.appendChild(btn);

      const childRow = document.createElement("div");
      const childRowsMap = new Map([["parent-1", [childRow]]]);

      const onToggle = vi.fn();
      const t = (k) => k;

      GridInteractionHelper.wireGroupCollapseButtons(container, childRowsMap, {
        collapsedGroups: ["parent-1"],
        t,
        onToggle
      });

      // Initial state is collapsed
      expect(childRow.hidden).toBe(true);
      expect(btn.classList.contains("is-collapsed")).toBe(true);

      // Click toggles to expanded
      btn.click();
      expect(childRow.hidden).toBe(false);
      expect(btn.classList.contains("is-collapsed")).toBe(false);
      expect(onToggle).toHaveBeenCalledWith("parent-1", false);

      // Click again toggles to collapsed
      await Promise.resolve();
      btn.click();
      expect(childRow.hidden).toBe(true);
      expect(btn.classList.contains("is-collapsed")).toBe(true);
      expect(onToggle).toHaveBeenCalledWith("parent-1", true);
    });

    it("opens a group on the first click after the bulk control collapses it", () => {
      const container = document.createElement("div");
      const button = container.createEl("button", { attr: { "data-collapse-id": "parent-1" } });
      const child = container.createDiv({ cls: "habit-row-child", attr: { "data-group-id": "parent-1" } });
      const onToggle = vi.fn();
      const t = key => key;
      GridInteractionHelper.wireGroupCollapseButtons(container, new Map([["parent-1", [child]]]), {
        collapsedGroups: [], t, onToggle
      });

      GridInteractionHelper.setAllGroupsCollapsed(container, ["parent-1"], true, t);
      expect(child.hidden).toBe(true);
      button.click();

      expect(child.hidden).toBe(false);
      expect(button.getAttribute("aria-expanded")).toBe("true");
      expect(onToggle).toHaveBeenCalledExactlyOnceWith("parent-1", false);
    });
  });

  describe("updateChildProgressSlot", () => {
    it("should format all completed children with checkmark and complete class", () => {
      const slot = document.createElement("span");
      GridInteractionHelper.updateChildProgressSlot(slot, ["completed", "completed"], 2);

      expect(slot.textContent).toBe("(2/2 ✓)");
      expect(slot.classList.contains("complete")).toBe(true);
    });

    it("should format partial progress without checkmark or complete class", () => {
      const slot = document.createElement("span");
      slot.classList.add("complete");
      GridInteractionHelper.updateChildProgressSlot(slot, ["completed", "uncompleted"], 2);

      expect(slot.textContent).toBe("(1/2)");
      expect(slot.classList.contains("complete")).toBe(false);
    });

    it("should clear text when totalScheduled is 0", () => {
      const slot = document.createElement("span");
      slot.textContent = "(0/0)";
      GridInteractionHelper.updateChildProgressSlot(slot, [], 0);

      expect(slot.textContent).toBe("");
      expect(slot.classList.contains("complete")).toBe(false);
    });

    it("keeps the row terse while exposing the meaning to assistive technology", () => {
      const slot = document.createElement("span");
      const t = (key, params) => key === "grid_child_progress_short"
        ? `${params.done}/${params.total}`
        : `إنجاز العادات الفرعية: ${params.done} من ${params.total}`;
      GridInteractionHelper.updateChildProgressSlot(slot, ["completed", "uncompleted"], 2, t);
      expect(slot.textContent).toBe("1/2");
      expect(slot.getAttribute("aria-label")).toBe("إنجاز العادات الفرعية: 1 من 2");
      GridInteractionHelper.updateChildProgressSlot(slot, [], 0, t);
      expect(slot.getAttribute("aria-label")).toBeNull();
    });
  });

  describe("hasHabitComment", () => {
    it("should not treat an unmarked user line as a habit comment", () => {
      const habit = { id: "h1", linkText: "[[Reading]]", name: "Reading" };
      const content = "### Notes\n- 📝 [[Reading]]: Great progress today!";
      const context = {
        getHabitNotesHeading: () => "Notes",
        extractSectionLines: () => ["- 📝 [[Reading]]: Great progress today!"]
      };

      const result = GridInteractionHelper.hasHabitComment(content, habit, context);
      expect(result).toBe(false);
    });

    it("should return false when no comment exists or content is null", () => {
      const habit = { id: "h1", linkText: "[[Reading]]", name: "Reading" };
      const context = {
        getHabitNotesHeading: () => "Notes",
        extractSectionLines: () => ["- Just a normal line"]
      };

      expect(GridInteractionHelper.hasHabitComment(null, habit, context)).toBe(false);
      expect(GridInteractionHelper.hasHabitComment("### Notes\n- Just a normal line", habit, context)).toBe(false);
    });
  });
});
