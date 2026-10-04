import { describe, it, expect, vi } from "vitest";
import { Utils } from "../src/utils/Utils.js";
import { Utils as UtilsFromHelpers } from "../src/utils/helpers.js";

describe("Utils Comprehensive Unit Tests", () => {
  describe("Cross-export verification", () => {
    it("should export Utils from helpers.js and helpers functions from Utils.js", () => {
      expect(UtilsFromHelpers).toBe(Utils);
      expect(typeof Utils.formatDaysCount).toBe("function");
      expect(typeof Utils.TextUtils).toBe("function");
    });
  });

  describe("findSectionRange", () => {
    const markdown = `# Title
Intro text

## Habits
- [ ] Read Quran
- [ ] Exercise

### Notes
Some notes

## Reflections
Great day!`;

    it("should return null for falsy content or heading", () => {
      expect(Utils.findSectionRange(null, "## Habits")).toBeNull();
      expect(Utils.findSectionRange(markdown, "")).toBeNull();
      expect(Utils.findSectionRange(markdown, "   ")).toBeNull();
    });

    it("should return null if heading does not exist in content", () => {
      expect(Utils.findSectionRange(markdown, "## Nonexistent")).toBeNull();
    });

    it("should find the range of an existing section bounded by another heading of same level", () => {
      const range = Utils.findSectionRange(markdown, "## Habits");
      expect(range).not.toBeNull();
      expect(range.headingLevel).toBe(2);

      const sectionText = markdown.substring(range.start, range.end);
      expect(sectionText).toContain("## Habits");
      expect(sectionText).toContain("- [ ] Read Quran");
      expect(sectionText).toContain("### Notes");
      // Must NOT contain the next level-2 heading
      expect(sectionText).not.toContain("## Reflections");
    });

    it("should extend to EOF if no next heading of equal or higher level exists", () => {
      const range = Utils.findSectionRange(markdown, "## Reflections");
      expect(range).not.toBeNull();
      expect(range.end).toBe(markdown.length);

      const sectionContent = markdown.substring(range.contentStart, range.end).trim();
      expect(sectionContent).toBe("Great day!");
    });
  });

  describe("extractSectionLines", () => {
    const content = `## Daily
- Item 1
- Item 2

## Next
- Other`;

    it("should return array of trimmed non-empty lines under heading", () => {
      const lines = Utils.extractSectionLines(content, "## Daily");
      expect(lines).toEqual(["- Item 1", "- Item 2"]);
    });

    it("should return empty array if heading not found or inputs missing", () => {
      expect(Utils.extractSectionLines(content, "## Missing")).toEqual([]);
      expect(Utils.extractSectionLines("", "## Daily")).toEqual([]);
      expect(Utils.extractSectionLines(content, "")).toEqual([]);
    });
  });

  describe("getSectionContent", () => {
    const doc = `## Parent
Intro
### Child
Child text inside
## Sibling
Sibling text`;

    it("should get top-level section content when parentHeading is omitted", () => {
      const result = Utils.getSectionContent(doc, null, "## Sibling");
      expect(result.trim()).toBe("Sibling text");
    });

    it("should get nested section content when both parent and child exist", () => {
      const result = Utils.getSectionContent(doc, "## Parent", "### Child");
      expect(result.trim()).toBe("Child text inside");
    });

    it("should return null if parent or child is not found", () => {
      expect(Utils.getSectionContent(doc, "## NonExistent", "### Child")).toBeNull();
      expect(Utils.getSectionContent(doc, "## Parent", "### MissingChild")).toBeNull();
      expect(Utils.getSectionContent("", null, "## Parent")).toBeNull();
    });
  });

  describe("insertNestedContent", () => {
    it("should return content untouched if newText is empty", () => {
      const content = "## Section\nExisting";
      expect(Utils.insertNestedContent(content, null, "## Section", "")).toBe(content);
    });

    it("should append into existing top-level section when parent is null", () => {
      const content = "## Section\nExisting line";
      const result = Utils.insertNestedContent(content, null, "## Section", "New line");
      expect(result).toContain("Existing line\nNew line");
    });

    it("should create top-level section if it does not exist", () => {
      const content = "Initial content";
      const result = Utils.insertNestedContent(content, null, "## NewSection", "Brand new text");
      expect(result).toContain("## NewSection\nBrand new text");
    });

    it("should insert into existing sub-heading under parent heading", () => {
      const content = `## Parent
### Sub
First entry`;
      const result = Utils.insertNestedContent(content, "## Parent", "### Sub", "Second entry");
      expect(result).toContain("First entry\nSecond entry");
    });

    it("should append sub-heading to parent if parent exists but sub does not", () => {
      const content = `## Parent
Parent body`;
      const result = Utils.insertNestedContent(content, "## Parent", "### Sub", "New sub content");
      expect(result).toContain("## Parent");
      expect(result).toContain("### Sub\nNew sub content");
    });

    it("should append entire parent and sub hierarchy if parent does not exist", () => {
      const content = "Existing doc";
      const result = Utils.insertNestedContent(content, "## BrandNewParent", "### NewSub", "Content here");
      expect(result).toContain("## BrandNewParent\n### NewSub\nContent here");
    });
  });

  describe("replaceNestedContent", () => {
    it("should replace content of existing top-level section", () => {
      const content = `## Target
Old content
## Other
Keep this`;
      const result = Utils.replaceNestedContent(content, null, "## Target", "Replaced content");
      expect(result).toContain("Replaced content");
      expect(result).not.toContain("Old content");
      expect(result).toContain("## Other\nKeep this");
    });

    it("should replace content of existing nested sub-section", () => {
      const content = `## Parent
### TargetSub
Old nested body
## Sibling
Untouched`;
      const result = Utils.replaceNestedContent(content, "## Parent", "### TargetSub", "New nested body");
      expect(result).toContain("New nested body");
      expect(result).not.toContain("Old nested body");
      expect(result).toContain("## Sibling\nUntouched");
    });

    it("should fall back to insertNestedContent when section does not exist", () => {
      const content = "## Existing\nLine";
      const result = Utils.replaceNestedContent(content, null, "## NewSection", "Inserted text");
      expect(result).toContain("## NewSection\nInserted text");
    });
  });

  describe("lightenHex", () => {
    it("should lighten 6-character hex colors", () => {
      const original = "#000000";
      const lightened = Utils.lightenHex(original, 0.5);
      // 0 + 255 * 0.5 = 128 = 0x80
      expect(lightened.toLowerCase()).toBe("#808080");
    });

    it("should support 3-character hex colors", () => {
      const lightened = Utils.lightenHex("#000", 0.2);
      expect(lightened.startsWith("#")).toBe(true);
      expect(lightened.length).toBe(7);
    });

    it("should clamp values at #ffffff", () => {
      const result = Utils.lightenHex("#ffffff", 0.5);
      expect(result.toLowerCase()).toBe("#ffffff");
    });

    it("should return original if invalid hex string", () => {
      expect(Utils.lightenHex("invalid-color")).toBe("invalid-color");
    });
  });

  describe("Path safety utilities", () => {
    describe("normalizePath", () => {
      it("should normalize backslashes and redundant dots", () => {
        expect(Utils.normalizePath("folder\\sub/file.md")).toBe("folder/sub/file.md");
        expect(Utils.normalizePath("./folder/./sub/../target.md")).toBe("folder/target.md");
        expect(Utils.normalizePath("")).toBe("");
        expect(Utils.normalizePath(null)).toBe("");
      });
    });

    describe("isPathTraversal", () => {
      it("should detect path traversal attempts", () => {
        expect(Utils.isPathTraversal("../secret.md")).toBe(true);
        expect(Utils.isPathTraversal("folder/../../secret.md")).toBe(true);
        expect(Utils.isPathTraversal("folder/sub/file.md")).toBe(false);
        expect(Utils.isPathTraversal("folder/sub/../file.md")).toBe(false);
        expect(Utils.isPathTraversal("")).toBe(false);
      });
    });

    describe("isPathInsideFolder", () => {
      it("should return true if file is inside folder", () => {
        expect(Utils.isPathInsideFolder("habits/daily/run.md", "habits")).toBe(true);
        expect(Utils.isPathInsideFolder("habits/run.md", "habits")).toBe(true);
        expect(Utils.isPathInsideFolder("habits", "habits")).toBe(true);
      });

      it("should return false if file is outside folder", () => {
        expect(Utils.isPathInsideFolder("other/run.md", "habits")).toBe(false);
        expect(Utils.isPathInsideFolder("habits_fake/run.md", "habits")).toBe(false);
      });

      it("should return true if target folder is empty (vault root)", () => {
        expect(Utils.isPathInsideFolder("any/file.md", "")).toBe(true);
      });
    });
  });

  describe("getHabitNoteFiles", () => {
    it("should return empty array if vault or manager is missing", () => {
      expect(Utils.getHabitNoteFiles(null, null)).toEqual([]);
      expect(Utils.getHabitNoteFiles({}, null)).toEqual([]);
    });

    it("should filter vault markdown files belonging to active or archive folders", () => {
      const mockFiles = [
        { path: "Habits/Active/Exercise.md" },
        { path: "Habits/Archive/OldHabit.md" },
        { path: "Daily/2026-06-27.md" },
        { path: "Other/Notes.md" }
      ];
      const mockVault = {
        getMarkdownFiles: vi.fn().mockReturnValue(mockFiles)
      };
      const mockHabitNoteManager = {
        getActiveFolder: () => "Habits/Active",
        getArchiveFolder: () => "Habits/Archive"
      };

      const result = Utils.getHabitNoteFiles(mockVault, mockHabitNoteManager);
      expect(result).toHaveLength(2);
      expect(result.map(f => f.path)).toEqual([
        "Habits/Active/Exercise.md",
        "Habits/Archive/OldHabit.md"
      ]);
    });
  });

  describe("showConfirmNotice", () => {
    it("should log error and return null if app or plugin is missing", () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = Utils.showConfirmNotice(null, null, "Confirm?");
      expect(result).toBeNull();
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it("should open ConfirmModal when registered on Utils or BaseHabitModal", () => {
      const openMock = vi.fn();
      class MockConfirmModal {
        constructor(app, plugin, message, options) {
          this.app = app;
          this.plugin = plugin;
          this.message = message;
          this.options = options;
        }
        open() {
          openMock();
        }
      }

      const prevModal = Utils.ConfirmModal;
      Utils.ConfirmModal = MockConfirmModal;

      const mockApp = {};
      const mockPlugin = {};
      const onConfirm = vi.fn();

      const modalInstance = Utils.showConfirmNotice(mockApp, mockPlugin, "Are you sure?", {
        confirmText: "Yes",
        onConfirm
      });

      expect(modalInstance).toBeInstanceOf(MockConfirmModal);
      expect(openMock).toHaveBeenCalledTimes(1);

      Utils.ConfirmModal = prevModal;
    });

    it("should fall back to window.confirm when ModalClass is not available", () => {
      const prevModal = Utils.ConfirmModal;
      Utils.ConfirmModal = null;

      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      const onConfirm = vi.fn();

      Utils.showConfirmNotice({}, {}, "Fallback question?", { onConfirm });

      expect(confirmSpy).toHaveBeenCalledWith("Fallback question?");
      expect(onConfirm).toHaveBeenCalledTimes(1);

      confirmSpy.mockRestore();
      Utils.ConfirmModal = prevModal;
    });

    it("should alias confirmDialog to showConfirmNotice", () => {
      const showSpy = vi.spyOn(Utils, "showConfirmNotice").mockReturnValue({});
      const app = {};
      const plugin = {};
      const opts = { isDanger: true };

      Utils.confirmDialog(app, plugin, "Delete item?", opts);
      expect(showSpy).toHaveBeenCalledWith(app, plugin, "Delete item?", opts);
      showSpy.mockRestore();
    });
  });
});
