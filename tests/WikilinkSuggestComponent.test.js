import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WikilinkSuggestComponent } from "../src/components/WikilinkSuggestComponent.js";
import { BaseNoteEntryModal } from "../src/modals/BaseNoteEntryModal.js";
import { TFile } from "obsidian";

describe("WikilinkSuggestComponent Tests", () => {
  let mockApp;
  let mockPlugin;
  let containerEl;
  let inputEl;
  let testFiles;

  beforeEach(() => {
    containerEl = document.createElement("div");
    inputEl = document.createElement("textarea");
    containerEl.appendChild(inputEl);
    document.body.appendChild(containerEl);

    testFiles = [
      new TFile("Habits/Deep Work.md"),
      new TFile("Projects/Core Habits.md"),
      new TFile("Daily Notes/2026-10-04.md"),
      new TFile("Reading List.md")
    ];
    testFiles[0].basename = "Deep Work";
    testFiles[1].basename = "Core Habits";
    testFiles[2].basename = "2026-10-04";
    testFiles[3].basename = "Reading List";

    mockApp = {
      vault: {
        getMarkdownFiles: vi.fn().mockReturnValue(testFiles)
      },
      metadataCache: {
        fileToLinktext: vi.fn().mockImplementation((file, sourcePath) => {
          if (file.path.startsWith("Projects/") && sourcePath.startsWith("Daily Notes/")) {
            return `Projects/${file.basename}`;
          }
          return file.basename;
        }),
        getFileCache: vi.fn().mockImplementation((file) => {
          if (file.basename === "Deep Work") {
            return { frontmatter: { aliases: ["Focus Session", "Flow"] } };
          }
          return null;
        })
      }
    };

    mockPlugin = {
      settings: { language: "ar" },
      translationManager: {
        t: vi.fn().mockImplementation((k) => (k === "wikilink_no_results" ? "لا توجد ملفات مطابقة" : k))
      }
    };
  });

  afterEach(() => {
    if (containerEl && containerEl.parentNode) {
      containerEl.parentNode.removeChild(containerEl);
    }
  });

  it("should initialize with suggestions closed and zero scans", () => {
    const suggest = new WikilinkSuggestComponent({
      app: mockApp,
      plugin: mockPlugin,
      inputEl,
      containerEl
    });

    expect(suggest.isOpen).toBe(false);
    expect(suggest.cachedFiles).toBeNull();
    expect(mockApp.vault.getMarkdownFiles).not.toHaveBeenCalled();

    suggest.destroy();
  });

  it("should lazily cache markdown files once upon first trigger and avoid full-vault scans on keystrokes", () => {
    const suggest = new WikilinkSuggestComponent({
      app: mockApp,
      plugin: mockPlugin,
      inputEl,
      containerEl
    });

    inputEl.value = "Starting [[";
    inputEl.selectionStart = 11;
    inputEl.selectionEnd = 11;
    inputEl.dispatchEvent(new Event("input"));

    expect(suggest.isOpen).toBe(true);
    expect(mockApp.vault.getMarkdownFiles).toHaveBeenCalledTimes(1);

    // Keystroke 1: "C"
    inputEl.value = "Starting [[C";
    inputEl.selectionStart = 12;
    inputEl.selectionEnd = 12;
    inputEl.dispatchEvent(new Event("input"));

    // Keystroke 2: "Co"
    inputEl.value = "Starting [[Co";
    inputEl.selectionStart = 13;
    inputEl.selectionEnd = 13;
    inputEl.dispatchEvent(new Event("input"));

    // Should NOT have scanned the vault again!
    expect(mockApp.vault.getMarkdownFiles).toHaveBeenCalledTimes(1);

    suggest.destroy();
  });

  it("should open suggestions when typing [[ and filter by fuzzy match", () => {
    const suggest = new WikilinkSuggestComponent({
      app: mockApp,
      plugin: mockPlugin,
      inputEl,
      containerEl
    });

    inputEl.value = "Reflecting on [[Deep";
    inputEl.selectionStart = 19;
    inputEl.selectionEnd = 19;
    inputEl.dispatchEvent(new Event("input"));

    expect(suggest.isOpen).toBe(true);
    expect(suggest.suggestions.length).toBe(1);
    expect(suggest.suggestions[0].basename).toBe("Deep Work");

    const items = containerEl.querySelectorAll(".dh-wikilink-suggest-item");
    expect(items.length).toBe(1);
    expect(items[0].classList.contains("is-selected")).toBe(true);

    suggest.destroy();
  });

  it("should match frontmatter aliases and indicate matched alias", () => {
    const suggest = new WikilinkSuggestComponent({
      app: mockApp,
      plugin: mockPlugin,
      inputEl,
      containerEl
    });

    inputEl.value = "Plan [[Flow";
    inputEl.selectionStart = 11;
    inputEl.selectionEnd = 11;
    inputEl.dispatchEvent(new Event("input"));

    expect(suggest.isOpen).toBe(true);
    expect(suggest.suggestions.length).toBe(1);
    expect(suggest.suggestions[0].basename).toBe("Deep Work");
    expect(suggest.suggestions[0].matchedAlias).toBe("Flow");

    suggest.destroy();
  });

  it("should close suggestions when backspacing past [[ or closing ]]", () => {
    const suggest = new WikilinkSuggestComponent({
      app: mockApp,
      plugin: mockPlugin,
      inputEl,
      containerEl
    });

    inputEl.value = "Note [[";
    inputEl.selectionStart = 7;
    inputEl.dispatchEvent(new Event("input"));
    expect(suggest.isOpen).toBe(true);

    // Backspace: removes one bracket
    inputEl.value = "Note [";
    inputEl.selectionStart = 6;
    inputEl.dispatchEvent(new Event("input"));
    expect(suggest.isOpen).toBe(false);

    // Re-open
    inputEl.value = "Note [[Read";
    inputEl.selectionStart = 11;
    inputEl.dispatchEvent(new Event("input"));
    expect(suggest.isOpen).toBe(true);

    // User closes bracket manually
    inputEl.value = "Note [[Read]]";
    inputEl.selectionStart = 13;
    inputEl.dispatchEvent(new Event("input"));
    expect(suggest.isOpen).toBe(false);

    suggest.destroy();
  });

  it("should navigate suggestions via ArrowDown and ArrowUp", () => {
    const suggest = new WikilinkSuggestComponent({
      app: mockApp,
      plugin: mockPlugin,
      inputEl,
      containerEl
    });

    inputEl.value = "[[";
    inputEl.selectionStart = 2;
    inputEl.dispatchEvent(new Event("input"));

    expect(suggest.isOpen).toBe(true);
    expect(suggest.selectedIndex).toBe(0);

    // ArrowDown
    const downEvent = new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true });
    inputEl.dispatchEvent(downEvent);
    expect(downEvent.defaultPrevented).toBe(true);
    expect(suggest.selectedIndex).toBe(1);

    // ArrowUp
    const upEvent = new KeyboardEvent("keydown", { key: "ArrowUp", cancelable: true });
    inputEl.dispatchEvent(upEvent);
    expect(upEvent.defaultPrevented).toBe(true);
    expect(suggest.selectedIndex).toBe(0);

    suggest.destroy();
  });

  it("should select item with Enter, insert link with sourcePath resolution, and prevent default", () => {
    const suggest = new WikilinkSuggestComponent({
      app: mockApp,
      plugin: mockPlugin,
      inputEl,
      containerEl,
      getSourcePath: () => "Daily Notes/2026-10-04.md"
    });

    inputEl.value = "Today working on [[Core";
    inputEl.selectionStart = 23;
    inputEl.selectionEnd = 23;
    inputEl.dispatchEvent(new Event("input"));

    expect(suggest.isOpen).toBe(true);

    const enterEvent = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    inputEl.dispatchEvent(enterEvent);

    expect(enterEvent.defaultPrevented).toBe(true);
    expect(suggest.isOpen).toBe(false);
    expect(mockApp.metadataCache.fileToLinktext).toHaveBeenCalledWith(testFiles[1], "Daily Notes/2026-10-04.md", true);
    expect(inputEl.value).toBe("Today working on [[Projects/Core Habits]]");
    expect(inputEl.selectionStart).toBe("Today working on [[Projects/Core Habits]]".length);

    suggest.destroy();
  });

  it("should replace existing trailing brackets without duplication", () => {
    const suggest = new WikilinkSuggestComponent({
      app: mockApp,
      plugin: mockPlugin,
      inputEl,
      containerEl,
      getSourcePath: () => "Daily Notes/2026-10-04.md"
    });

    // Emulate Obsidian auto-pairing `]]`
    inputEl.value = "Working on [[Core]] right now";
    inputEl.selectionStart = 17; // between 'e' and ']]'
    inputEl.selectionEnd = 17;
    inputEl.dispatchEvent(new Event("input"));

    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    inputEl.dispatchEvent(tabEvent);

    expect(inputEl.value).toBe("Working on [[Projects/Core Habits]] right now");
    expect(inputEl.value.includes("]]]]")).toBe(false);

    suggest.destroy();
  });

  it("should close suggestions with Escape without submitting or propagating", () => {
    const suggest = new WikilinkSuggestComponent({
      app: mockApp,
      plugin: mockPlugin,
      inputEl,
      containerEl
    });

    inputEl.value = "[[";
    inputEl.selectionStart = 2;
    inputEl.dispatchEvent(new Event("input"));
    expect(suggest.isOpen).toBe(true);

    const escEvent = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    inputEl.dispatchEvent(escEvent);

    expect(escEvent.defaultPrevented).toBe(true);
    expect(suggest.isOpen).toBe(false);

    suggest.destroy();
  });

  it("should select suggestion via mouse click without losing caret", () => {
    const suggest = new WikilinkSuggestComponent({
      app: mockApp,
      plugin: mockPlugin,
      inputEl,
      containerEl
    });

    inputEl.value = "Reviewing [[Deep";
    inputEl.selectionStart = 16;
    inputEl.dispatchEvent(new Event("input"));

    const itemEl = containerEl.querySelector(".dh-wikilink-suggest-item");
    expect(itemEl).not.toBeNull();

    const mousedownEvent = new MouseEvent("mousedown", { cancelable: true, bubbles: true });
    itemEl.dispatchEvent(mousedownEvent);

    expect(mousedownEvent.defaultPrevented).toBe(true);
    expect(inputEl.value).toBe("Reviewing [[Deep Work]]");
    expect(suggest.isOpen).toBe(false);

    suggest.destroy();
  });
});

describe("BaseNoteEntryModal Autocomplete Integration Tests", () => {
  let mockApp;
  let mockPlugin;
  let mockDate;

  beforeEach(() => {
    mockApp = {
      vault: {
        getMarkdownFiles: vi.fn().mockReturnValue([
          new TFile("Test Note.md")
        ])
      },
      metadataCache: {
        fileToLinktext: vi.fn().mockReturnValue("Test Note"),
        getFileCache: vi.fn().mockReturnValue(null)
      },
      workspace: {
        getActiveFile: vi.fn().mockReturnValue(null)
      }
    };

    mockDate = {
      clone: () => ({
        locale: () => ({
          format: () => "2026-10-04"
        })
      })
    };

    mockPlugin = {
      settings: { language: "ar" },
      translationManager: {
        t: vi.fn().mockImplementation((k) => k)
      }
    };
  });

  it("should initialize wikilinkSuggest in createNoteInput and guard submit on Enter", () => {
    const modal = new BaseNoteEntryModal(mockApp, mockPlugin, { date: mockDate });
    modal.onOpen();

    const input = modal.createNoteInput(modal.contentEl, { placeholder: "Note..." });
    expect(modal.wikilinkSuggest).not.toBeNull();

    const submitSpy = vi.spyOn(modal, "submit").mockImplementation(() => {});

    // Open autocomplete
    input.value = "[[";
    input.selectionStart = 2;
    input.dispatchEvent(new Event("input"));
    expect(modal.wikilinkSuggest.isOpen).toBe(true);

    // Press Enter while autocomplete is open
    const enterWhileOpen = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    input.dispatchEvent(enterWhileOpen);

    // Modal submit MUST NOT have been triggered
    expect(submitSpy).not.toHaveBeenCalled();

    modal.forceClose();
  });

  it("should clean up wikilinkSuggest upon modal onClose", () => {
    const modal = new BaseNoteEntryModal(mockApp, mockPlugin, { date: mockDate });
    modal.onOpen();
    modal.createNoteInput(modal.contentEl);

    expect(modal.wikilinkSuggest).not.toBeNull();
    const destroySpy = vi.spyOn(modal.wikilinkSuggest, "destroy");

    modal.onClose();

    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(modal.wikilinkSuggest).toBeNull();
  });
});
