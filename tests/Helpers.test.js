import { describe, it, expect, vi, beforeEach } from "vitest";
import { getNoteByDate, getDailyNotesInfo, resolveDailyNotesLocale } from "../src/utils/helpers.js";
import moment from "moment";
import "moment/locale/fr.js";

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

    it("should use the configured Daily Notes locale when formatting file paths", async () => {
      const mockFile = { path: "Daily/2026/06-juin/27-06-2026-samedi.md" };
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      const file = await getNoteByDate(mockApp, testDate, false, {
        dailyNotesFolder: "Daily",
        dateFormat: "YYYY/MM-MMMM/DD-MM-YYYY-dddd",
        dailyNotesLocale: "fr",
      });

      expect(file).toBe(mockFile);
      expect(mockApp.vault.getAbstractFileByPath).toHaveBeenCalledWith("Daily/2026/06-juin/27-06-2026-samedi.md");
    });

    it("should follow the moment locale when Daily Notes locale follows Obsidian", () => {
      const frenchDate = testDate.clone().locale("fr");

      expect(resolveDailyNotesLocale({ dailyNotesLocale: "obsidian" }, frenchDate)).toBe("fr");
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
  });
});
