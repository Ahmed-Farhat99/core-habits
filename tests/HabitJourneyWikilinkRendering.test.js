/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { HabitJourneyPanel } from "../src/components/forms/HabitJourneyPanel.js";
import { DiaryCardRenderer } from "../src/views/diary/DiaryCardRenderer.js";
import { MarkdownRenderer } from "obsidian";

describe("HabitJourney Wikilink and Markdown Rendering Integration Tests", () => {
  let container;
  let mockApp;
  let mockPlugin;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);

    mockApp = {
      vault: {
        getAbstractFileByPath: vi.fn(),
        read: vi.fn().mockResolvedValue(""),
        cachedRead: vi.fn().mockResolvedValue(""),
        getResourcePath: vi.fn().mockReturnValue("app://local/audio.webm")
      },
      metadataCache: {
        getFirstLinkpathDest: vi.fn((link) => {
          return { path: `Vault/${link}` };
        })
      },
      workspace: {
        openLinkText: vi.fn(),
        trigger: vi.fn()
      }
    };

    mockPlugin = {
      app: mockApp,
      settings: {
        language: "ar",
        enableHabitContext: true
      },
      habitJournalService: {
        getHabitCommentHistory: vi.fn()
      }
    };
  });

  it("should render [[Note]] as clickable obsidian internal link", async () => {
    mockPlugin.habitJournalService.getHabitCommentHistory.mockResolvedValue([
      { date: window.moment("2026-10-04"), text: "Reviewed [[Atomic Habits]] note today", path: "Daily Notes/2026-10-04.md" }
    ]);

    const panel = new HabitJourneyPanel(container, {
      app: mockApp,
      plugin: mockPlugin,
      habit: { name: "Reading", linkText: "Reading" },
      formState: { name: "Reading" },
      initiallyOpen: true,
      t: (k) => k
    });

    await panel.loadAndRenderEntries();

    const linkEl = container.querySelector("a.internal-link");
    expect(linkEl).not.toBeNull();
    expect(linkEl.getAttribute("data-href")).toBe("Atomic Habits");
    expect(linkEl.textContent).toBe("Atomic Habits");
  });

  it("should render [[Note|Alias]] with alias text and target href", async () => {
    mockPlugin.habitJournalService.getHabitCommentHistory.mockResolvedValue([
      { date: window.moment("2026-10-04"), text: "Reflected on [[Personal Habits|My Habits]]", path: "Daily Notes/2026-10-04.md" }
    ]);

    const panel = new HabitJourneyPanel(container, {
      app: mockApp,
      plugin: mockPlugin,
      habit: { name: "Reading" },
      formState: { name: "Reading" },
      initiallyOpen: true,
      t: (k) => k
    });

    await panel.loadAndRenderEntries();

    const linkEl = container.querySelector("a.internal-link");
    expect(linkEl).not.toBeNull();
    expect(linkEl.getAttribute("data-href")).toBe("Personal Habits");
    expect(linkEl.textContent).toBe("My Habits");
  });

  it("should render Arabic wikilinks with long title and hyphens properly", async () => {
    const arabicLinkText = "سلوك - نافع - بعد الإستيقاظ - تلك عشرة نافعة 2 - إيقاظ الوعي";
    mockPlugin.habitJournalService.getHabitCommentHistory.mockResolvedValue([
      {
        date: window.moment("2026-10-04"),
        text: `المرجع: [[${arabicLinkText}]]`,
        path: "Daily Notes/2026-10-04.md"
      }
    ]);

    const panel = new HabitJourneyPanel(container, {
      app: mockApp,
      plugin: mockPlugin,
      habit: { name: "سلوك - نافع - بعد الإستيقاظ" },
      formState: { name: "سلوك - نافع - بعد الإستيقاظ" },
      initiallyOpen: true,
      t: (k) => k
    });

    await panel.loadAndRenderEntries();

    const linkEl = container.querySelector("a.internal-link");
    expect(linkEl).not.toBeNull();
    expect(linkEl.getAttribute("data-href")).toBe(arabicLinkText);
    expect(linkEl.textContent).toBe(arabicLinkText);
  });

  it("should render subpaths [[Folder/Subfolder/Note]] and headings [[Note#Heading]]", async () => {
    mockPlugin.habitJournalService.getHabitCommentHistory.mockResolvedValue([
      {
        date: window.moment("2026-10-04"),
        text: "See [[Areas/Health/Morning Routine#Key Steps|Routine Steps]]",
        path: "Daily Notes/2026-10-04.md"
      }
    ]);

    const panel = new HabitJourneyPanel(container, {
      app: mockApp,
      plugin: mockPlugin,
      habit: { name: "Morning Routine" },
      formState: { name: "Morning Routine" },
      initiallyOpen: true,
      t: (k) => k
    });

    await panel.loadAndRenderEntries();

    const linkEl = container.querySelector("a.internal-link");
    expect(linkEl).not.toBeNull();
    expect(linkEl.getAttribute("data-href")).toBe("Areas/Health/Morning Routine#Key Steps");
    expect(linkEl.textContent).toBe("Routine Steps");
  });

  it("should pass entry.path as sourcePath to MarkdownRenderer", async () => {
    const renderSpy = vi.spyOn(MarkdownRenderer, "render");

    mockPlugin.habitJournalService.getHabitCommentHistory.mockResolvedValue([
      {
        date: window.moment("2026-10-04"),
        text: "Note with link [[Reference]]",
        path: "Vault/Daily Notes/2026-10-04.md"
      }
    ]);

    const panel = new HabitJourneyPanel(container, {
      app: mockApp,
      plugin: mockPlugin,
      habit: { name: "Test Habit" },
      formState: { name: "Test Habit" },
      initiallyOpen: true,
      t: (k) => k
    });

    await panel.loadAndRenderEntries();

    expect(renderSpy).toHaveBeenCalled();
    const lastCall = renderSpy.mock.calls[renderSpy.mock.calls.length - 1];
    // Signature: (app, markdown, el, sourcePath, component)
    expect(lastCall[3]).toBe("Vault/Daily Notes/2026-10-04.md");
    renderSpy.mockRestore();
  });

  it("should preserve custom audio players without leaking ![[...]] into markdown", async () => {
    mockPlugin.habitJournalService.getHabitCommentHistory.mockResolvedValue([
      {
        date: window.moment("2026-10-04"),
        text: "Reflection text ![[voice_recording_123.webm]] and more comments",
        path: "Daily Notes/2026-10-04.md"
      }
    ]);

    const panel = new HabitJourneyPanel(container, {
      app: mockApp,
      plugin: mockPlugin,
      habit: { name: "Test Habit" },
      formState: { name: "Test Habit" },
      initiallyOpen: true,
      t: (k) => k
    });

    await panel.loadAndRenderEntries();

    const audioEl = container.querySelector("audio");
    expect(audioEl).not.toBeNull();
    expect(audioEl.getAttribute("src")).toBe("app://local/audio.webm");

    const textEl = container.querySelector(".dh-journey-entry-text");
    expect(textEl).not.toBeNull();
    expect(textEl.textContent).not.toContain("![[");
    expect(textEl.textContent).toContain("Reflection text");
    expect(textEl.textContent).toContain("and more comments");
  });

  it("should maintain text and link parity between HabitJourneyPanel and DiaryCardRenderer", async () => {
    const rawNote = "Good progress on [[Quran Memorization|سورة البقرة]] and [[Books/Tafseer#Ayah 5]]";
    const entryPath = "Daily Notes/2026-10-04.md";

    // 1. HabitJourneyPanel render
    mockPlugin.habitJournalService.getHabitCommentHistory.mockResolvedValue([
      { date: window.moment("2026-10-04"), text: rawNote, path: entryPath }
    ]);
    const panelContainer = document.createElement("div");
    const panel = new HabitJourneyPanel(panelContainer, {
      app: mockApp,
      plugin: mockPlugin,
      habit: { name: "Quran" },
      formState: { name: "Quran" },
      initiallyOpen: true,
      t: (k) => k
    });
    await panel.loadAndRenderEntries();
    const journeyLinks = Array.from(panelContainer.querySelectorAll("a.internal-link")).map(a => ({
      href: a.getAttribute("data-href"),
      text: a.textContent
    }));

    // 2. DiaryCardRenderer render
    const diaryContext = {
      openDailyNote: vi.fn(),
      getComponent: () => mockPlugin,
      getReflectionTypeMeta: vi.fn().mockReturnValue({ label: "Good", cls: "good" })
    };
    const diaryRenderer = new DiaryCardRenderer(diaryContext, mockApp, mockPlugin);
    const diaryParent = document.createElement("div");
    const diaryCard = diaryRenderer.render(diaryParent, {
      id: "entry-1",
      date: "2026-10-04",
      moment: window.moment("2026-10-04"),
      time: "10:00",
      type: "Good",
      text: rawNote,
      cleanText: rawNote,
      audioFiles: [],
      hasAudio: false,
      path: entryPath
    });
    const diaryLinks = Array.from(diaryCard.querySelectorAll("a.internal-link")).map(a => ({
      href: a.getAttribute("data-href"),
      text: a.textContent
    }));

    // Both renderers produce identical link structures and targets
    expect(journeyLinks).toEqual(diaryLinks);
    expect(journeyLinks.length).toBe(2);
    expect(journeyLinks[0]).toEqual({ href: "Quran Memorization", text: "سورة البقرة" });
    expect(journeyLinks[1]).toEqual({ href: "Books/Tafseer#Ayah 5", text: "Books/Tafseer#Ayah 5" });
  });

  it("should open link in new tab when clicked", async () => {
    mockPlugin.habitJournalService.getHabitCommentHistory.mockResolvedValue([
      { date: window.moment("2026-10-04"), text: "Check [[Atomic Habits]]", path: "Daily Notes/2026-10-04.md" }
    ]);

    const panel = new HabitJourneyPanel(container, {
      app: mockApp,
      plugin: mockPlugin,
      habit: { name: "Reading" },
      formState: { name: "Reading" },
      initiallyOpen: true,
      t: (k) => k
    });
    await panel.loadAndRenderEntries();

    const link = container.querySelector("a.internal-link");
    expect(link).not.toBeNull();

    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(mockApp.workspace.openLinkText).toHaveBeenCalledWith("Atomic Habits", "Daily Notes/2026-10-04.md", "tab");
  });

  it("should open link in new window when shift-clicked", async () => {
    mockPlugin.habitJournalService.getHabitCommentHistory.mockResolvedValue([
      { date: window.moment("2026-10-04"), text: "Check [[Atomic Habits]]", path: "Daily Notes/2026-10-04.md" }
    ]);

    const panel = new HabitJourneyPanel(container, {
      app: mockApp,
      plugin: mockPlugin,
      habit: { name: "Reading" },
      formState: { name: "Reading" },
      initiallyOpen: true,
      t: (k) => k
    });
    await panel.loadAndRenderEntries();

    const link = container.querySelector("a.internal-link");
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
    expect(mockApp.workspace.openLinkText).toHaveBeenCalledWith("Atomic Habits", "Daily Notes/2026-10-04.md", "window");
  });

  it("should open link in new tab when middle-clicked (auxclick)", async () => {
    mockPlugin.habitJournalService.getHabitCommentHistory.mockResolvedValue([
      { date: window.moment("2026-10-04"), text: "Check [[Atomic Habits]]", path: "Daily Notes/2026-10-04.md" }
    ]);

    const panel = new HabitJourneyPanel(container, {
      app: mockApp,
      plugin: mockPlugin,
      habit: { name: "Reading" },
      formState: { name: "Reading" },
      initiallyOpen: true,
      t: (k) => k
    });
    await panel.loadAndRenderEntries();

    const link = container.querySelector("a.internal-link");
    link.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    expect(mockApp.workspace.openLinkText).toHaveBeenCalledWith("Atomic Habits", "Daily Notes/2026-10-04.md", "tab");
  });

  it("should trigger hover-link on mouseover for page preview", async () => {
    mockPlugin.habitJournalService.getHabitCommentHistory.mockResolvedValue([
      { date: window.moment("2026-10-04"), text: "Check [[Atomic Habits]]", path: "Daily Notes/2026-10-04.md" }
    ]);

    const panel = new HabitJourneyPanel(container, {
      app: mockApp,
      plugin: mockPlugin,
      habit: { name: "Reading" },
      formState: { name: "Reading" },
      initiallyOpen: true,
      t: (k) => k
    });
    await panel.loadAndRenderEntries();

    const link = container.querySelector("a.internal-link");
    link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true }));
    expect(mockApp.workspace.trigger).toHaveBeenCalledWith(
      "hover-link",
      expect.objectContaining({
        linktext: "Atomic Habits",
        sourcePath: "Daily Notes/2026-10-04.md"
      })
    );
  });
});
