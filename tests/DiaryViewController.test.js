import { describe, it, expect, beforeEach, vi } from "vitest";
import { DiaryViewController } from "../src/views/diary/DiaryViewController.js";
import { DiaryCardRenderer } from "../src/views/diary/DiaryCardRenderer.js";

describe("DiaryViewController & Card Event Handling", () => {
  let mockContext;
  let mockApp;
  let mockPlugin;
  let mockDiaryService;

  beforeEach(() => {
    mockApp = {
      vault: {
        getMarkdownFiles: vi.fn(() => []),
        getAbstractFileByPath: vi.fn(() => null),
        cachedRead: vi.fn(async () => "")
      }
    };

    mockPlugin = {
      settings: { language: "ar" },
      translationManager: { t: (k) => k }
    };

    mockDiaryService = {
      loadEntries: vi.fn(async () => []),
      filterEntries: vi.fn((entries) => entries),
      getRange: vi.fn(() => ({ startDate: null, endDate: null })),
      getPeriodType: vi.fn(() => "week"),
      getPeriodDisplayLabel: vi.fn(() => "أسبوع"),
      isCurrentRangeContainingToday: vi.fn(() => true),
      hasActiveFilters: vi.fn(() => false),
      getActiveFilterCount: vi.fn(() => 0),
      getTypeCounts: vi.fn(() => ({ ALL: 0, Idea: 0, Lesson: 0, Good: 0, Bad: 0, AUDIO: 0 })),
      getSearchQuery: vi.fn(() => ""),
      getSelectedType: vi.fn(() => "ALL"),
      getHideEmptyDays: vi.fn(() => false)
    };

    mockContext = {
      app: mockApp,
      plugin: mockPlugin,
      diaryService: mockDiaryService,
      openDailyNote: vi.fn(),
      openReflectionPopup: vi.fn(),
      getReflectionTypeMeta: vi.fn(() => ({ label: "فكرة", cls: "idea" })),
      getDiaryViewMode: vi.fn(() => "grouped"),
      getComponent: vi.fn(() => null)
    };
  });

  describe("Race Condition Handling", () => {
    it("shows a retryable error instead of an empty diary when loading fails", async () => {
      mockDiaryService.loadEntries.mockRejectedValueOnce(new Error("read failed"));
      const controller = new DiaryViewController(mockContext);
      const container = document.createElement("div");
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await controller.render(container);
        expect(container.querySelector(".error-state")).not.toBeNull();
        expect(container.querySelector(".dh-diary-retry-btn")).not.toBeNull();
        expect(container.querySelector(".dh-diary-day-section")).toBeNull();
        container.querySelector(".dh-diary-retry-btn").click();
        await vi.waitFor(() => expect(mockDiaryService.loadEntries).toHaveBeenCalledTimes(2));
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("should discard stale render results if a newer render request starts while loading", async () => {
      const controller = new DiaryViewController(mockContext);
      const container = document.createElement("div");

      // Slow first call
      let resolveFirst;
      const slowPromise = new Promise((resolve) => {
        resolveFirst = resolve;
      });

      // Fast second call
      const fastEntries = [{ text: "Newest entry", moment: window.moment(), type: "Good" }];

      mockDiaryService.loadEntries
        .mockImplementationOnce(() => slowPromise)
        .mockImplementationOnce(async () => fastEntries);

      // Start render 1 (slow)
      const render1 = controller.render(container);

      // Immediately start render 2 (fast)
      const render2 = controller.render(container);

      await render2;
      expect(controller._rawEntries).toBe(fastEntries);

      // Now finish the slow call 1
      resolveFirst([{ text: "Old stale entry", moment: window.moment(), type: "Bad" }]);
      await render1;

      // Stale entry must NOT overwrite the newer result!
      expect(controller._rawEntries).toBe(fastEntries);
    });

    it("should increment loadId and clean up on destroy()", () => {
      const controller = new DiaryViewController(mockContext);
      const initialId = controller._currentLoadId;

      controller.destroy();
      expect(controller._currentLoadId).toBe(initialId + 1);
    });
  });

  describe("DiaryCardRenderer click delegation", () => {
    it("collapses long text and preserves its expanded state after a rerender", () => {
      const renderer = new DiaryCardRenderer(mockContext, mockApp, mockPlugin);
      const entry = { id: "long-1", path: "Daily Notes/2026-09-02.md", type: "Idea", text: "A".repeat(300), moment: window.moment("2026-09-02") };
      const parent = document.createElement("div");
      const first = renderer.render(parent, entry);
      expect(first.querySelector(".dh-diary-entry-text").classList.contains("is-collapsed")).toBe(true);
      const button = first.querySelector(".dh-diary-expand-btn");
      button.click();
      expect(button.getAttribute("aria-expanded")).toBe("true");
      expect(mockContext.openDailyNote).not.toHaveBeenCalled();
      parent.empty();
      const second = renderer.render(parent, entry);
      expect(second.querySelector(".dh-diary-entry-text").classList.contains("is-collapsed")).toBe(false);
    });

    it("shows a missing-audio message instead of a blank entry", () => {
      mockApp.metadataCache = { getFirstLinkpathDest: vi.fn(() => null) };
      const renderer = new DiaryCardRenderer(mockContext, mockApp, mockPlugin);
      const card = renderer.render(document.createElement("div"), {
        type: "Idea", cleanText: "", audioFiles: ["voice.webm"], path: "Daily Notes/2026-09-02.md",
        moment: window.moment("2026-09-02")
      });
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith("voice.webm", "Daily Notes/2026-09-02.md");
      expect(card.querySelector(".dh-diary-audio-missing")).not.toBeNull();
    });

    it("should open daily note when clicking the card itself", () => {
      const cardRenderer = new DiaryCardRenderer(mockContext, mockApp, mockPlugin);
      const container = document.createElement("div");
      const entry = { text: "Card content", moment: window.moment("2026-09-02"), type: "Idea" };

      const cardEl = cardRenderer.render(container, entry);
      cardEl.click();

      expect(mockContext.openDailyNote).toHaveBeenCalledTimes(1);
    });

    it("should NOT open daily note when clicking internal or external links inside the card", () => {
      const cardRenderer = new DiaryCardRenderer(mockContext, mockApp, mockPlugin);
      const container = document.createElement("div");
      const entry = { text: "Card content", moment: window.moment("2026-09-02"), type: "Idea" };

      const cardEl = cardRenderer.render(container, entry);
      
      // Simulate internal link
      const internalLink = cardEl.createEl("a", { cls: "internal-link", text: "Link" });
      internalLink.click();
      expect(mockContext.openDailyNote).not.toHaveBeenCalled();

      // Simulate external link
      const externalLink = cardEl.createEl("a", { cls: "external-link", text: "Google" });
      externalLink.click();
      expect(mockContext.openDailyNote).not.toHaveBeenCalled();
    });
  });
});
