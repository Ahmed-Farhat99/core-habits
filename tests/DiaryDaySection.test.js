import { describe, it, expect, beforeEach, vi } from "vitest";
import { DiaryDaySection } from "../src/views/diary/DiaryDaySection.js";
import { DiaryCardRenderer } from "../src/views/diary/DiaryCardRenderer.js";

describe("DiaryDaySection Tests", () => {
  let mockContext;
  let mockApp;
  let mockPlugin;
  let cardRenderer;
  let daySection;

  beforeEach(() => {
    mockApp = {
      vault: {
        getResourcePath: vi.fn((file) => "app://local/" + file.path),
        cachedRead: vi.fn(async () => "")
      },
      metadataCache: {
        getFirstLinkpathDest: vi.fn(() => null)
      }
    };

    mockPlugin = {
      settings: {
        language: "ar",
        showHijriDate: true
      },
      translationManager: {
        t: (k) => {
          const dict = {
            direction: "rtl",
            diary_count_one: "تدوينة",
            diary_count_two: "تدوينتان",
            diary_count_few: "تدوينات",
            diary_count_many: "تدوينة",
            diary_add_entry_btn: "+ تدوينة",
            diary_section_good: "جيد",
            diary_section_bad: "سيء",
            diary_section_lesson: "درس",
            diary_section_notes: "خواطر وأفكار",
            diary_no_entries_short: "لا توجد تدوينات",
            today: "اليوم"
          };
          return dict[k] || k;
        }
      }
    };

    mockContext = {
      app: mockApp,
      plugin: mockPlugin,
      openDailyNote: vi.fn(),
      openReflectionPopup: vi.fn(),
      getReflectionTypeMeta: vi.fn((type) => ({ label: type, cls: type.toLowerCase() }))
    };

    cardRenderer = new DiaryCardRenderer(mockContext, mockApp, mockPlugin);
    daySection = new DiaryDaySection(mockContext, mockPlugin, cardRenderer);
  });

  it("should render day section with primary date, separator and Hijri subtext", () => {
    const container = document.createElement("div");
    const testMoment = window.moment("2026-09-06");
    const entries = [
      { type: "Good", cleanText: "إنجاز ممتاز", moment: testMoment, hasAudio: false }
    ];

    const el = daySection.render(container, testMoment, entries);
    expect(el).toBeDefined();

    const dayName = el.querySelector(".day-name-text");
    expect(dayName).toBeDefined();
    expect(dayName.textContent).toBe("الأحد");

    const dateText = el.querySelector(".day-date-text");
    expect(dateText).toBeDefined();
    expect(dateText.textContent).toContain("سبتمبر");

    const sep = el.querySelector(".day-date-sep");
    expect(sep).not.toBeNull();
    expect(sep.textContent).toBe("·");

    const hijri = el.querySelector(".day-hijri-subtext");
    expect(hijri).toBeDefined();
  });

  it("uses plain category headings instead of nested accordions", () => {
    const container = document.createElement("div");
    const testMoment = window.moment("2026-09-06");
    const entries = [
      { type: "Good", cleanText: "إنجاز رائع", moment: testMoment },
      { type: "Bad", cleanText: "تأخير في النوم", moment: testMoment },
      { type: "Lesson", cleanText: "النوم المبكر بركة", moment: testMoment }
    ];

    const el = daySection.render(container, testMoment, entries);
    const goodCat = el.querySelector(".dh-diary-category-group.type-good");
    const badCat = el.querySelector(".dh-diary-category-group.type-bad");
    const lessonCat = el.querySelector(".dh-diary-category-group.type-lesson");
    const notesCat = el.querySelector(".dh-diary-category-group.type-notes");

    expect(goodCat).not.toBeNull();
    expect(badCat).not.toBeNull();
    expect(lessonCat).not.toBeNull();
    expect(goodCat.tagName).toBe("DIV");
    expect(el.querySelectorAll(".dh-diary-category-group summary")).toHaveLength(0);
    // Notes category should be omitted because it's empty
    expect(notesCat).toBeNull();

    // Verify category dots are rendered
    expect(goodCat.querySelector(".dh-category-dot.type-good")).not.toBeNull();
    expect(badCat.querySelector(".dh-category-dot.type-bad")).not.toBeNull();
    expect(lessonCat.querySelector(".dh-category-dot.type-lesson")).not.toBeNull();
  });

  it("defers older day entries until the day is opened", () => {
    const container = document.createElement("div");
    const day = window.moment("2026-08-20");
    const el = daySection.render(container, day, [{ type: "Good", text: "Older entry", moment: day }], true, false, false);
    expect(el.open).toBe(false);
    expect(el.querySelectorAll(".dh-diary-entry-card")).toHaveLength(0);
    el.open = true;
    el.ontoggle();
    expect(el.querySelectorAll(".dh-diary-entry-card")).toHaveLength(1);
    el.open = false;
    el.ontoggle();
    el.open = true;
    el.ontoggle();
    expect(el.querySelectorAll(".dh-diary-entry-card")).toHaveLength(1);
  });

  it("should trigger openReflectionPopup when clicking + تدوينة", () => {
    const container = document.createElement("div");
    const testMoment = window.moment("2026-08-20");
    const el = daySection.render(container, testMoment, []);

    const addBtn = el.querySelector(".dh-day-add-btn");
    expect(addBtn).toBeDefined();
    addBtn.click();

    expect(mockContext.openReflectionPopup).toHaveBeenCalledWith(testMoment);
  });

  it("ensures summary element contains no interactive controls (accessibility compliance)", () => {
    const container = document.createElement("div");
    const testMoment = window.moment("2026-08-20");
    const el = daySection.render(container, testMoment, []);

    const summaryEl = el.querySelector("summary");
    expect(summaryEl).not.toBeNull();

    // Summary must NOT have any buttons, links, or inputs (W3C / axe-core disallowed descendant rule)
    const interactiveInsideSummary = summaryEl.querySelectorAll("button, a, input, select, textarea");
    expect(interactiveInsideSummary.length).toBe(0);

    // The add button must be outside summary but inside day section
    const addBtn = el.querySelector(".dh-day-add-btn");
    expect(addBtn).not.toBeNull();
    expect(summaryEl.contains(addBtn)).toBe(false);
    expect(el.contains(addBtn)).toBe(true);

    // Clicking the add button must not toggle details open state
    const initialOpen = el.open;
    addBtn.click();
    expect(el.open).toBe(initialOpen);
  });

  it("should render compact empty day row with action button", () => {
    const container = document.createElement("div");
    const testMoment = window.moment("2026-08-20");

    const row = DiaryDaySection.renderEmptyDayRow(container, testMoment, mockContext, mockPlugin);
    expect(row).toBeDefined();
    expect(row.classList.contains("dh-diary-empty-day-row")).toBe(true);

    const notice = row.querySelector(".empty-day-notice");
    expect(notice.textContent).toBe("لا توجد تدوينات");

    const addBtn = row.querySelector(".dh-empty-add-btn");
    expect(addBtn).toBeDefined();
    addBtn.click();

    expect(mockContext.openReflectionPopup).toHaveBeenCalledWith(testMoment);
  });
});
