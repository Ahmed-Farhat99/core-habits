import { describe, it, expect, vi, beforeEach } from "vitest";
import { getNoteByDate, getDailyNotesInfo, getDailyNoteDate, formatDaysCount, getDaysUnit, formatHabitAge } from "../src/utils/helpers.js";
import moment from "moment";

describe("Daily Note Helper Tests", () => {
  let mockApp;

  beforeEach(() => {
    mockApp = {
      vault: {
        getAbstractFileByPath: vi.fn(),
        createFolder: vi.fn(),
        create: vi.fn(),
        read: vi.fn(),
      },
      internalPlugins: {
        getPluginById: vi.fn(),
      },
      plugins: {
        getPlugin: vi.fn(),
      },
    };
  });

  describe("getDailyNotesInfo", () => {
    it("should return manual info if dailyNotesSource is manual", () => {
      const settings = {
        dailyNotesSource: "manual",
        dateFormat: "YYYY-MM-DD",
        dailyNotesFolder: "Daily",
      };
      const info = getDailyNotesInfo(mockApp, settings);
      expect(info.source).toBe("manual");
      expect(info.format).toBe("YYYY-MM-DD");
    });

    it("should return internal daily-notes info if plugin is enabled", () => {
      const mockPlugin = {
        enabled: true,
        instance: {
          options: {
            format: "YYYY/MM/DD",
            folder: "DailyNotes",
            template: "Templates/Daily",
          },
        },
      };
      mockApp.internalPlugins.getPluginById.mockReturnValue(mockPlugin);

      const info = getDailyNotesInfo(mockApp, null);
      expect(info.source).toBe("daily-notes");
      expect(info.format).toBe("YYYY/MM/DD");
      expect(info.folder).toBe("DailyNotes");
      expect(info.template).toBe("Templates/Daily");
    });

    it("should return periodic-notes info if daily-notes is disabled and periodic-notes is enabled", () => {
      mockApp.internalPlugins.getPluginById.mockReturnValue({ enabled: false });
      const mockPeriodicPlugin = {
        settings: {
          daily: {
            enabled: true,
            format: "YYYY-MM-DD-dddd",
            folder: "Periodic",
            template: "Templates/Periodic",
          },
        },
      };
      mockApp.plugins.getPlugin.mockReturnValue(mockPeriodicPlugin);

      const info = getDailyNotesInfo(mockApp, null);
      expect(info.source).toBe("periodic-notes");
      expect(info.format).toBe("YYYY-MM-DD-dddd");
      expect(info.folder).toBe("Periodic");
      expect(info.template).toBe("Templates/Periodic");
    });

    it("should gracefully handle getDailyNotesInfo when app.internalPlugins is undefined", () => {
      const appWithoutInternal = { ...mockApp, internalPlugins: undefined };
      const info = getDailyNotesInfo(appWithoutInternal, null);
      expect(info).toBeDefined();
      expect(info.source).toBe("defaults");
    });
  });

  describe("getNoteByDate", () => {
    const testDate = moment("2026-06-27");

    it("should return existing file if it is found in vault", async () => {
      const mockFile = { path: "Daily/2026-06-27.md" };
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      const file = await getNoteByDate(mockApp, testDate, false, { dailyNotesFolder: "Daily" });
      expect(file).toBe(mockFile);
      expect(mockApp.vault.getAbstractFileByPath).toHaveBeenCalledWith("Daily/2026-06-27.md");
    });

    it("should delegate to internal daily-notes if file is missing and createIfNeeded is true", async () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);
      const mockCreatedFile = { path: "Daily/2026-06-27.md" };
      const mockDailyPlugin = {
        enabled: true,
        instance: {
          createDailyNote: vi.fn().mockResolvedValue(mockCreatedFile),
          options: { folder: "Daily", format: "YYYY-MM-DD" },
        },
      };
      mockApp.internalPlugins.getPluginById.mockReturnValue(mockDailyPlugin);

      const file = await getNoteByDate(mockApp, testDate, true, null);
      expect(file).toBe(mockCreatedFile);
      expect(mockDailyPlugin.instance.createDailyNote).toHaveBeenCalledWith(testDate);
    });

    it("should return created file from daily-notes even if its path differs from primaryPath without calling manual create", async () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);
      mockApp.vault.create.mockClear();
      const mockCustomPathFile = { path: "Custom/Subfolder/2026-06-27.md" };
      const mockDailyPlugin = {
        enabled: true,
        instance: {
          createDailyNote: vi.fn().mockResolvedValue(mockCustomPathFile),
          options: { folder: "Daily", format: "YYYY-MM-DD" },
        },
      };
      mockApp.internalPlugins.getPluginById.mockReturnValue(mockDailyPlugin);

      const file = await getNoteByDate(mockApp, testDate, true, null);
      expect(file).toBe(mockCustomPathFile);
      expect(mockDailyPlugin.instance.createDailyNote).toHaveBeenCalledWith(testDate);
      expect(mockApp.vault.create).not.toHaveBeenCalled();
    });

    it("should return existing file during manual fallback if it already exists without throwing duplicate error", async () => {
      // First call in getAllNotesByDate returns null, but by step 3 it exists
      const existingFile = { path: "Daily/2026-06-27.md" };
      let callCount = 0;
      mockApp.vault.getAbstractFileByPath.mockImplementation((path) => {
        callCount++;
        if (callCount > 1 && path === "Daily/2026-06-27.md") return existingFile;
        return null;
      });
      mockApp.vault.create.mockClear();
      mockApp.internalPlugins.getPluginById.mockReturnValue(null);
      mockApp.plugins.getPlugin.mockReturnValue(null);

      const file = await getNoteByDate(mockApp, testDate, true, { dailyNotesFolder: "Daily" });
      expect(file).toBe(existingFile);
      expect(mockApp.vault.create).not.toHaveBeenCalled();
    });

    it("should fallback to manual creation if daily-notes creation fails", async () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);
      
      // daily-notes fails
      const mockDailyPlugin = {
        enabled: true,
        instance: {
          createDailyNote: vi.fn().mockRejectedValue(new Error("Plugin error")),
          options: { folder: "Daily", format: "YYYY-MM-DD", template: "Templates/Daily" },
        },
      };
      mockApp.internalPlugins.getPluginById.mockReturnValue(mockDailyPlugin);
      
      // periodic-notes fails/absent
      mockApp.plugins.getPlugin.mockReturnValue(null);

      // fallback manual creation mock
      const mockCreatedFile = { path: "Daily/2026-06-27.md" };
      mockApp.vault.create.mockResolvedValue(mockCreatedFile);
      mockApp.vault.read.mockResolvedValue("{{date}} {{title}}");

      const file = await getNoteByDate(mockApp, testDate, true, null);
      expect(file).toBe(mockCreatedFile);
      expect(mockApp.vault.create).toHaveBeenCalled();
    });

    it("should gracefully handle getNoteByDate when app.internalPlugins is undefined", async () => {
      const appWithoutInternal = {
        vault: {
          getAbstractFileByPath: vi.fn().mockReturnValue(null),
          createFolder: vi.fn().mockResolvedValue(true),
          create: vi.fn().mockResolvedValue({ path: "Daily/2026-06-27.md" }),
          read: vi.fn().mockResolvedValue(""),
        },
        internalPlugins: undefined,
        plugins: { getPlugin: vi.fn().mockReturnValue(null) }
      };
      const file = await getNoteByDate(appWithoutInternal, testDate, true, null);
      expect(file).toBeDefined();
      expect(appWithoutInternal.vault.create).toHaveBeenCalled();
    });
  });

  it("recognizes only the configured Daily Notes path, including nested date formats", () => {
    const settings = { dailyNotesSource: "manual", dailyNotesFolder: "Daily", dateFormat: "YYYY/MM/DD" };
    expect(getDailyNoteDate({ path: "Daily/2026/09/09.md" }, mockApp, settings)?.format("YYYY-MM-DD")).toBe("2026-09-09");
    expect(getDailyNoteDate({ path: "Archive/2026/09/09.md" }, mockApp, settings)).toBeNull();
    expect(getDailyNoteDate({ path: "DailyOther/2026/09/09.md" }, mockApp, settings)).toBeNull();
    expect(getDailyNoteDate({ path: "Daily/2026/99/09.md" }, mockApp, settings)).toBeNull();
  });

  describe("formatDaysCount and getDaysUnit", () => {
    it("should format Arabic days counts correctly according to grammatical rules", () => {
      expect(formatDaysCount(0, "ar")).toBe("0 يوم");
      expect(formatDaysCount(1, "ar")).toBe("يوم واحد");
      expect(formatDaysCount(2, "ar")).toBe("يومان");
      expect(formatDaysCount(3, "ar")).toBe("3 أيام");
      expect(formatDaysCount(7, "ar")).toBe("7 أيام");
      expect(formatDaysCount(10, "ar")).toBe("10 أيام");
      expect(formatDaysCount(11, "ar")).toBe("11 يوماً");
      expect(formatDaysCount(30, "ar")).toBe("30 يوماً");
      expect(formatDaysCount(339, "ar")).toBe("339 يوماً");
    });

    it("should format English days counts correctly", () => {
      expect(formatDaysCount(0, "en")).toBe("0 days");
      expect(formatDaysCount(1, "en")).toBe("1 day");
      expect(formatDaysCount(2, "en")).toBe("2 days");
      expect(formatDaysCount(15, "en")).toBe("15 days");
    });

    it("should return the correct grammatical day unit for Arabic and English", () => {
      expect(getDaysUnit(1, "ar")).toBe("يوم");
      expect(getDaysUnit(2, "ar")).toBe("يومان");
      expect(getDaysUnit(5, "ar")).toBe("أيام");
      expect(getDaysUnit(12, "ar")).toBe("يوماً");

      expect(getDaysUnit(1, "en")).toBe("day");
      expect(getDaysUnit(2, "en")).toBe("days");
      expect(getDaysUnit(20, "en")).toBe("days");
    });
  });

  describe("formatHabitAge", () => {
    it("should return null for null or invalid inputs", () => {
      expect(formatHabitAge(null)).toBeNull();
      expect(formatHabitAge("invalid-date")).toBeNull();
    });

    it("should format created today", () => {
      const today = moment().valueOf();
      const resAr = formatHabitAge(today, "ar");
      expect(resAr.ageText).toBe("أنشئت اليوم ✨");
      expect(resAr.daysCount).toBe(0);

      const resEn = formatHabitAge(today, "en");
      expect(resEn.ageText).toBe("Created today ✨");
      expect(resEn.daysCount).toBe(0);
    });

    it("should format recent habit (days ago)", () => {
      const fiveDaysAgo = moment().subtract(5, "days").valueOf();
      const resAr = formatHabitAge(fiveDaysAgo, "ar");
      expect(resAr.ageText).toBe("منذ 5 أيام");
      expect(resAr.daysCount).toBe(5);

      const resEn = formatHabitAge(fiveDaysAgo, "en");
      expect(resEn.ageText).toBe("5 days ago");
    });

    it("should format months ago with dual and plural forms", () => {
      const twoMonthsAgo = moment().subtract(65, "days").valueOf();
      const resAr = formatHabitAge(twoMonthsAgo, "ar");
      expect(resAr.ageText).toContain("شهران");
      expect(resAr.ageText).toContain("65 يوماً");

      const sixMonthsAgo = moment().subtract(182, "days").valueOf();
      const resAr6 = formatHabitAge(sixMonthsAgo, "ar");
      expect(resAr6.ageText).toContain("6 أشهر");
      expect(resAr6.ageText).toContain("182 يوماً");
    });

    it("should format years ago", () => {
      const yearAgo = moment().subtract(400, "days").valueOf();
      const resAr = formatHabitAge(yearAgo, "ar");
      expect(resAr.ageText).toContain("سنة");
      expect(resAr.ageText).toContain("400 يوماً");
    });
  });
});
