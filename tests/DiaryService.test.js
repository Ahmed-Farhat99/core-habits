import { describe, it, expect, beforeEach, vi } from "vitest";
import { DiaryService, DIARY_PERIODS } from "../src/services/DiaryService.js";

describe("DiaryService Tests", () => {
  let mockApp;
  let mockPlugin;
  let diaryService;

  beforeEach(() => {
    mockApp = {
      vault: {
        getMarkdownFiles: vi.fn(() => []),
        getAbstractFileByPath: vi.fn(() => null),
        cachedRead: vi.fn(async (file) => file.content || "")
      }
    };

    mockPlugin = {
      settings: {
        weekStartDay: 6, // Saturday
        reflectionHeading: "## Daily Reflections",
        language: "ar",
        dateFormat: "YYYY-MM-DD"
      },
      translationManager: {
        t: (k) => k
      }
    };

    diaryService = new DiaryService(mockApp, mockPlugin);
  });

  describe("Period & Range Calculations", () => {
    it("should default to week period", () => {
      expect(diaryService.getPeriodType()).toBe(DIARY_PERIODS.WEEK);
    });

    it("should calculate correct 7-day range for week with Saturday start", () => {
      // Set anchor to a Wednesday (2026-09-02)
      diaryService.anchorMoment = window.moment("2026-09-02");
      const { startDate, endDate } = diaryService.getRange();

      expect(startDate.format("YYYY-MM-DD")).toBe("2026-08-29"); // Previous Saturday
      expect(endDate.format("YYYY-MM-DD")).toBe("2026-09-04"); // Friday
      expect(endDate.diff(startDate, "days") + 1).toBe(7);
    });

    it("should calculate correct 14-day range for two_weeks", () => {
      diaryService.setPeriodType(DIARY_PERIODS.TWO_WEEKS);
      diaryService.anchorMoment = window.moment("2026-09-02");
      const { startDate, endDate } = diaryService.getRange();

      expect(startDate.format("YYYY-MM-DD")).toBe("2026-08-29");
      expect(endDate.format("YYYY-MM-DD")).toBe("2026-09-11");
      expect(endDate.diff(startDate, "days") + 1).toBe(14);
    });

    it("should calculate correct month range", () => {
      diaryService.setPeriodType(DIARY_PERIODS.MONTH);
      diaryService.anchorMoment = window.moment("2026-09-15");
      const { startDate, endDate } = diaryService.getRange();

      expect(startDate.format("YYYY-MM-DD")).toBe("2026-09-01");
      expect(endDate.format("YYYY-MM-DD")).toBe("2026-09-30");
    });

    it("should calculate correct quarter range", () => {
      diaryService.setPeriodType(DIARY_PERIODS.QUARTER);
      diaryService.anchorMoment = window.moment("2026-08-15"); // Q3 (Jul, Aug, Sep)
      const { startDate, endDate } = diaryService.getRange();

      expect(startDate.format("YYYY-MM-DD")).toBe("2026-07-01");
      expect(endDate.format("YYYY-MM-DD")).toBe("2026-09-30");
    });

    it("should handle custom range correctly", () => {
      diaryService.setCustomRange(window.moment("2026-01-10"), window.moment("2026-01-25"));
      expect(diaryService.getPeriodType()).toBe(DIARY_PERIODS.CUSTOM);
      const { startDate, endDate } = diaryService.getRange();

      expect(startDate.format("YYYY-MM-DD")).toBe("2026-01-10");
      expect(endDate.format("YYYY-MM-DD")).toBe("2026-01-25");
    });

    it("should handle ALL range returning nulls", () => {
      diaryService.setPeriodType(DIARY_PERIODS.ALL);
      const { startDate, endDate } = diaryService.getRange();
      expect(startDate).toBeNull();
      expect(endDate).toBeNull();
    });
  });

  describe("Navigation", () => {
    it("should navigate forward and backward by 7 days for week", () => {
      diaryService.anchorMoment = window.moment("2026-09-02");
      diaryService.navigate(1);
      expect(diaryService.anchorMoment.format("YYYY-MM-DD")).toBe("2026-09-09");
      diaryService.navigate(-1);
      expect(diaryService.anchorMoment.format("YYYY-MM-DD")).toBe("2026-09-02");
    });

    it("should navigate forward and backward by 1 month for month", () => {
      diaryService.setPeriodType(DIARY_PERIODS.MONTH);
      diaryService.anchorMoment = window.moment("2026-09-15");
      diaryService.navigate(1);
      expect(diaryService.anchorMoment.format("YYYY-MM-DD")).toBe("2026-10-15");
      diaryService.navigate(-1);
      expect(diaryService.anchorMoment.format("YYYY-MM-DD")).toBe("2026-09-15");
    });

    it("should reset to today on goToToday()", () => {
      diaryService.anchorMoment = window.moment("2020-01-01");
      diaryService.goToToday();
      expect(diaryService.anchorMoment.isSame(window.moment(), "day")).toBe(true);
    });
  });

  describe("parseDailyReflectionEntries", () => {
    it("should parse reflections with type and time", () => {
      const content = `
## Daily Reflections
- 10:30 [type:: Idea] Write new architecture docs
- 14:15 [type:: Good] Had a productive focus session
- [type:: Lesson] Always test edge cases
`;
      const dateMoment = window.moment("2026-09-02");
      const entries = diaryService.parseDailyReflectionEntries(content, dateMoment, "Daily Notes/2026-09-02.md");

      expect(entries).toHaveLength(3);
      expect(entries[0].time).toBe("10:30");
      expect(entries[0].type).toBe("Idea");
      expect(entries[0].text).toBe("Write new architecture docs");
      expect(entries[0].dateKey).toBe("2026-09-02");

      expect(entries[1].time).toBe("14:15");
      expect(entries[1].type).toBe("Good");

      expect(entries[2].time).toBe("");
      expect(entries[2].type).toBe("Lesson");
    });

    it("should return empty array if heading not found or empty", () => {
      const content = "# Header\nSome regular notes";
      const entries = diaryService.parseDailyReflectionEntries(content, window.moment());
      expect(entries).toEqual([]);
    });
  });

  describe("filterEntries & Search", () => {
    const sampleEntries = [
      { type: "Idea", text: "فكرة رائعة لتطوير أوبسيديان", date: "2026-09-01", hasAudio: false, audioFiles: [] },
      { type: "Good", text: "إنجاز كبير في العمل اليوم", date: "2026-09-02", hasAudio: false, audioFiles: [] },
      { type: "Bad", text: "تأخرت في الاستيقاظ", date: "2026-09-03", hasAudio: false, audioFiles: [] },
      { type: "Lesson", text: "تعلمت درساً مهماً", date: "2026-09-04", hasAudio: true, audioFiles: ["audio-note.webm"] },
    ];

    it("should filter by type", () => {
      diaryService.setSelectedType("Idea");
      const filtered = diaryService.filterEntries(sampleEntries);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].type).toBe("Idea");
    });

    it("should filter by audio", () => {
      diaryService.setSelectedType("AUDIO");
      const filtered = diaryService.filterEntries(sampleEntries);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].hasAudio).toBe(true);
      expect(filtered[0].audioFiles).toContain("audio-note.webm");
    });

    it("should search with Arabic folding (إ vs ا, ة vs ه)", () => {
      diaryService.setSelectedType("ALL");
      diaryService.setSearchQuery("انجاز"); // user typed with plain alef
      const filtered = diaryService.filterEntries(sampleEntries);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].text).toContain("إنجاز"); // matched hamza alef
    });

    it("should compute correct type counts", () => {
      const counts = diaryService.getTypeCounts(sampleEntries);
      expect(counts.ALL).toBe(4);
      expect(counts.Idea).toBe(1);
      expect(counts.Good).toBe(1);
      expect(counts.Bad).toBe(1);
      expect(counts.Lesson).toBe(1);
      expect(counts.AUDIO).toBe(1);
    });

    it("should track active filters and filter counts accurately", () => {
      expect(diaryService.hasActiveFilters()).toBe(false);
      expect(diaryService.getActiveFilterCount()).toBe(0);

      diaryService.setSelectedType("Idea");
      expect(diaryService.hasActiveFilters()).toBe(true);
      expect(diaryService.getActiveFilterCount()).toBe(1);

      diaryService.setSearchQuery("test");
      expect(diaryService.hasActiveFilters()).toBe(true);
      expect(diaryService.getActiveFilterCount()).toBe(2);

      diaryService.resetFilters();
      expect(diaryService.hasActiveFilters()).toBe(false);
      expect(diaryService.getActiveFilterCount()).toBe(0);
      expect(diaryService.getSelectedType()).toBe("ALL");
      expect(diaryService.getSearchQuery()).toBe("");
    });
  });

  describe("Cache and Data Safety (Read-only operations)", () => {
    it("should never write to vault during read and navigation operations", async () => {
      mockApp.vault.modify = vi.fn();
      mockApp.vault.create = vi.fn();
      mockApp.vault.delete = vi.fn();

      diaryService.setPeriodType(DIARY_PERIODS.MONTH);
      diaryService.navigate(1);
      diaryService.setSelectedType("Good");
      diaryService.setSearchQuery("test");
      await diaryService.loadEntries();

      expect(mockApp.vault.modify).not.toHaveBeenCalled();
      expect(mockApp.vault.create).not.toHaveBeenCalled();
      expect(mockApp.vault.delete).not.toHaveBeenCalled();
    });

    it("should invalidate cache and reload properly", async () => {
      diaryService.anchorMoment = window.moment("2026-09-02");
      const mockFile = {
        name: "2026-09-02.md",
        path: "Daily Notes/2026-09-02.md",
        content: "## Daily Reflections\n- [type:: Good] Test note"
      };
      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.vault.getAbstractFileByPath.mockImplementation((path) => {
        if (path && path.includes("2026-09-02")) return mockFile;
        return null;
      });

      const entries1 = await diaryService.loadEntries();
      expect(entries1).toHaveLength(1);
      expect(mockApp.vault.cachedRead).toHaveBeenCalledTimes(1);

      // Second call should return cached entries
      const entries2 = await diaryService.loadEntries();
      expect(entries2).toHaveLength(1);
      expect(mockApp.vault.cachedRead).toHaveBeenCalledTimes(1);

      // Invalidate cache
      diaryService.invalidateCache();
      const entries3 = await diaryService.loadEntries();
      expect(entries3).toHaveLength(1);
      expect(mockApp.vault.cachedRead).toHaveBeenCalledTimes(2);
    });

    it("does not present an unreadable daily note as an empty diary", async () => {
      diaryService.discoverDailyNotes = vi.fn(async () => [{
        file: { path: "Daily Notes/2026-09-02.md" },
        dateMoment: window.moment("2026-09-02"),
        dateKey: "2026-09-02"
      }]);
      mockApp.vault.cachedRead.mockRejectedValueOnce(new Error("disk read failed"));
      await expect(diaryService.loadEntries()).rejects.toThrow("disk read failed");
      expect(diaryService.entriesCache.has("2026-09-02")).toBe(false);
      expect(diaryService._isLoading).toBe(false);
    });

    it("should correctly detect if today is within current range", () => {
      diaryService.goToToday();
      diaryService.setPeriodType(DIARY_PERIODS.WEEK);
      expect(diaryService.isCurrentRangeContainingToday()).toBe(true);

      diaryService.navigate(10);
      expect(diaryService.isCurrentRangeContainingToday()).toBe(false);

      diaryService.setPeriodType(DIARY_PERIODS.ALL);
      expect(diaryService.isCurrentRangeContainingToday()).toBe(true);
    });
  });
});
