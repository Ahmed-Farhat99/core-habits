import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { DiaryViewController } from "../src/views/diary/DiaryViewController.js";
import { DiaryParser } from "../src/services/DiaryParser.js";
import { DiaryService, DIARY_PERIODS } from "../src/services/DiaryService.js";
import { DiaryHeader } from "../src/views/diary/DiaryHeader.js";
import { Menu } from "obsidian";

describe("Diary UI & Architecture Audit", () => {
  let mockApp;
  let mockPlugin;
  let diaryService;
  let mockContext;

  beforeEach(() => {
    mockApp = {
      vault: {
        getMarkdownFiles: vi.fn(() => []),
        getAbstractFileByPath: vi.fn(() => null),
        cachedRead: vi.fn(async (file) => file.content || ""),
        getResourcePath: vi.fn((f) => "app://local/" + f.path)
      },
      metadataCache: {
        getFirstLinkpathDest: vi.fn(() => null)
      }
    };

    mockPlugin = {
      settings: {
        language: "ar",
        weekStartDay: 6,
        showHijriDate: true,
        reflectionHeading: "## 💡 أفكار وملاحظات"
      },
      translationManager: {
        t: (k, params = {}) => {
          const dict = {
            direction: "rtl",
            diary_count_one: "تدوينة",
            diary_count_two: "تدوينتان",
            diary_count_few: `${params.count || ""} تدوينات`,
            diary_count_many: `${params.count || ""} تدوينة`,
            diary_add_entry_btn: "+ تدوينة",
            diary_add_today_btn: "تدوينة اليوم",
            diary_section_good: "جيد",
            diary_section_bad: "سيء",
            diary_section_lesson: "درس",
            diary_section_notes: "خواطر وأفكار",
            diary_no_entries_short: "لا توجد تدوينات",
            today: "اليوم",
            date_format_diary_header: "dddd، D MMMM",
            period_week: "أسبوع",
            period_two_weeks: "أسبوعان",
            period_month: "شهر",
            period_quarter: "3 أشهر",
            period_all: "كل الملاحظات"
          };
          return dict[k] || k;
        }
      }
    };

    diaryService = new DiaryService(mockApp, mockPlugin);

    mockContext = {
      app: mockApp,
      plugin: mockPlugin,
      diaryService,
      openDailyNote: vi.fn(),
      openReflectionPopup: vi.fn(),
      getReflectionTypeMeta: vi.fn((type) => ({ label: type, cls: type ? type.toLowerCase() : "idea" })),
      getDiaryViewMode: vi.fn(() => "grouped"),
      getComponent: vi.fn(() => null)
    };
  });

  it("keeps the search label in a text-sized button and closes its tray once with Escape", async () => {
    diaryService.loadEntries = vi.fn(async () => []);
    const controller = new DiaryViewController(mockContext);
    const container = document.createElement("div");
    await controller.render(container);

    const searchButton = container.querySelector(".dh-search-toggle-btn");
    expect(searchButton.classList.contains("mod-icon")).toBe(false);
    expect(searchButton.querySelector(".dh-diary-search-label").textContent).toBe("diary_search_filters");
    searchButton.click();
    expect(searchButton.getAttribute("aria-expanded")).toBe("true");

    const closeSpy = vi.spyOn(controller, "closeFilterTray");
    const searchInput = container.querySelector(".dh-diary-search-input");
    searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(closeSpy).toHaveBeenCalledOnce();
    expect(container.querySelector(".dh-diary-filter-drawer")).toBeNull();
    expect(searchButton.getAttribute("aria-expanded")).toBe("false");
    controller.destroy();
  });

  it("should render real vault note 2025-11-11.md inside DaySection without duplicating date in cards", async () => {
    const rawVaultNote = `
## 💡 أفكار وملاحظات 
### 🗃️ صندوق التقاط الرؤى
- Good:: اشتريت اللاب الحمد الله 7550 يارب يطلع كويس
- Bad:: فضلت اسمع اغاني مع خيال ديني وبكاء سبحان الله على تقلب المشاعر وفي نفس الوقت 
- Lesson::صحيت مسكت الفون شوية وقلبت في امازون ونون لازم لما أصحى أقوم حمام
----
`;
    const targetDate = window.moment("2025-11-11");
    const entries = DiaryParser.parse(rawVaultNote, targetDate, "2025-11-11.md");
    expect(entries.length).toBe(3);

    // Mock diaryService to return these entries
    diaryService.loadEntries = vi.fn(async () => entries);

    const controller = new DiaryViewController(mockContext);
    const container = document.createElement("div");
    await controller.render(container);

    // Verify Day Header
    const daySection = container.querySelector(".dh-diary-day-section");
    expect(daySection).not.toBeNull();

    const dayName = daySection.querySelector(".day-name-text");
    expect(dayName.textContent).toBe("الثلاثاء");

    const dayDate = daySection.querySelector(".day-date-text");
    expect(dayDate.textContent).toContain("نوفمبر");

    // Verify Categories: Good, Bad, Lesson exist, Notes omitted
    const goodCat = daySection.querySelector(".dh-diary-category-group.type-good");
    const badCat = daySection.querySelector(".dh-diary-category-group.type-bad");
    const lessonCat = daySection.querySelector(".dh-diary-category-group.type-lesson");
    const notesCat = daySection.querySelector(".dh-diary-category-group.type-notes");

    expect(goodCat).not.toBeNull();
    expect(badCat).not.toBeNull();
    expect(lessonCat).not.toBeNull();
    expect(notesCat).toBeNull();

    // Verify that individual cards do NOT redundantly display the day name
    const cards = daySection.querySelectorAll(".dh-diary-entry-card");
    expect(cards.length).toBe(3);

    cards.forEach(card => {
      // In grouped view, showDateHeader is false, so .entry-date-part should NOT exist
      const cardDatePart = card.querySelector(".entry-date-part");
      expect(cardDatePart).toBeNull();
    });

    // Verify add button has clean text "+ تدوينة"
    const addBtn = daySection.querySelector(".dh-day-add-btn");
    expect(addBtn.textContent.trim()).toBe("+ تدوينة");
  });

  it("should render empty days as slim compact rows when hideEmptyDays is false", async () => {
    diaryService.setHideEmptyDays(false);
    diaryService.setPeriodType(DIARY_PERIODS.WEEK);
    diaryService.anchorMoment = window.moment("2026-09-06");

    // Only 1 day has an entry, remaining 6 days are empty
    const singleEntry = {
      id: "2026-09-06-1",
      dateKey: "2026-09-06",
      moment: window.moment("2026-09-06"),
      type: "Good",
      cleanText: "إنجاز اليوم",
      hasAudio: false
    };

    diaryService.loadEntries = vi.fn(async () => [singleEntry]);

    const controller = new DiaryViewController(mockContext);
    const container = document.createElement("div");
    await controller.render(container);

    // 1 DaySection (with content)
    const daySections = container.querySelectorAll(".dh-diary-day-section");
    expect(daySections.length).toBe(1);

    // 6 EmptyDayRows
    const emptyRows = container.querySelectorAll(".dh-diary-empty-day-row");
    expect(emptyRows.length).toBe(6);

    emptyRows.forEach(row => {
      const notice = row.querySelector(".empty-day-notice");
      expect(notice.textContent).toBe("لا توجد تدوينات");

      const btn = row.querySelector(".dh-empty-add-btn");
      expect(btn.textContent).toBe("+ تدوينة");
    });

    const dates = Array.from(container.querySelectorAll(".dh-diary-empty-day-row .empty-day-date"), el => el.textContent);
    expect(dates[0]).toBe(window.moment("2026-09-11").locale("ar").format("dddd، D MMMM"));
    expect(dates.at(-1)).toBe(window.moment("2026-09-05").locale("ar").format("dddd، D MMMM"));
  });

  it("does not pad type-filtered results with empty days", async () => {
    diaryService.setHideEmptyDays(false);
    diaryService.setSelectedType("Good");
    diaryService.anchorMoment = window.moment("2026-09-06");
    diaryService.loadEntries = vi.fn(async () => [{
      id: "1", dateKey: "2026-09-06", date: "2026-09-06",
      moment: window.moment("2026-09-06"), type: "Good", text: "إنجاز", timestamp: 1
    }]);
    const container = document.createElement("div");
    await new DiaryViewController(mockContext).render(container);
    expect(container.querySelectorAll(".dh-diary-day-section")).toHaveLength(1);
    expect(container.querySelectorAll(".dh-diary-empty-day-row")).toHaveLength(0);
  });

  it("anchors the period menu inside the viewport in RTL", async () => {
    diaryService.loadEntries = vi.fn(async () => []);
    const container = document.createElement("div");
    await new DiaryViewController(mockContext).render(container);
    const button = container.querySelector(".dh-period-menu-trigger");
    button.getBoundingClientRect = () => ({ left: window.innerWidth - 150, right: window.innerWidth - 8, bottom: 80 });
    const menuSpy = vi.spyOn(Menu.prototype, "showAtPosition");
    try {
      button.click();
      expect(menuSpy).toHaveBeenCalledOnce();
      const position = menuSpy.mock.calls[0][0];
      expect(position.x).toBeGreaterThanOrEqual(8);
      expect(position.x).toBeLessThanOrEqual(window.innerWidth - 220 - 8);
    } finally {
      menuSpy.mockRestore();
    }
  });

  it("does not render the detached diary again after changing its view mode", async () => {
    mockContext.setDiaryViewMode = vi.fn(async () => {});
    const onLocalRender = vi.fn();
    const header = new DiaryHeader(mockContext, mockApp, mockPlugin, diaryService);
    const button = document.createElement("button");
    let menu;
    const menuSpy = vi.spyOn(Menu.prototype, "showAtPosition").mockImplementation(function() {
      menu = this;
      return this;
    });
    try {
      header.openViewOptionsMenu(button, onLocalRender);
      await menu.items[1].onClickHandler();
      expect(mockContext.setDiaryViewMode).toHaveBeenCalledOnce();
      expect(mockContext.setDiaryViewMode).toHaveBeenCalledWith("timeline");
      expect(onLocalRender).not.toHaveBeenCalled();
      menu.items[3].onClickHandler();
      expect(onLocalRender).toHaveBeenCalledOnce();
    } finally {
      menuSpy.mockRestore();
    }
  });

  it("returns directly from all notes to the current week", async () => {
    diaryService.setPeriodType(DIARY_PERIODS.ALL);
    diaryService.loadEntries = vi.fn(async () => []);
    const container = document.createElement("div");
    await new DiaryViewController(mockContext).render(container);
    const todayButton = container.querySelector(".dh-today-jump-btn");
    expect(todayButton).not.toBeNull();
    todayButton.click();
    expect(diaryService.getPeriodType()).toBe(DIARY_PERIODS.WEEK);
    expect(diaryService.isCurrentRangeContainingToday()).toBe(true);
  });

  it("renders an older month's entries only when that month is opened", async () => {
    diaryService.setPeriodType(DIARY_PERIODS.ALL);
    const entries = ["2026-09-06", "2026-08-06"].map((date, index) => ({
      id: String(index), date, dateKey: date, moment: window.moment(date),
      timestamp: window.moment(date).valueOf(), type: "Good", text: `Entry ${index}`
    }));
    diaryService.loadEntries = vi.fn(async () => entries);
    const container = document.createElement("div");
    await new DiaryViewController(mockContext).render(container);
    const months = container.querySelectorAll(".dh-diary-month-section");
    expect(months).toHaveLength(2);
    expect(months[0].querySelectorAll(".dh-diary-entry-card")).toHaveLength(1);
    expect(months[1].querySelectorAll(".dh-diary-entry-card")).toHaveLength(0);
    months[1].open = true;
    months[1].ontoggle();
    expect(months[1].querySelectorAll(".dh-diary-entry-card")).toHaveLength(1);
  });

  it("opens only the newest three days in a long period", async () => {
    diaryService.setPeriodType(DIARY_PERIODS.ALL);
    const entries = [1, 2, 3, 4, 5].map(day => {
      const date = `2026-09-${String(day).padStart(2, "0")}`;
      return { id: date, date, dateKey: date, moment: window.moment(date), timestamp: window.moment(date).valueOf(), type: "Idea", text: date };
    });
    diaryService.loadEntries = vi.fn(async () => entries);
    const container = document.createElement("div");
    await new DiaryViewController(mockContext).render(container);
    const days = container.querySelectorAll(".dh-diary-day-section");
    expect(days).toHaveLength(5);
    expect(Array.from(days, day => day.open)).toEqual([true, true, true, false, false]);
    expect(container.querySelectorAll(".dh-diary-entry-card")).toHaveLength(3);
  });

  it("should hide all empty days when hideEmptyDays is true", async () => {
    diaryService.setHideEmptyDays(true);
    diaryService.setPeriodType(DIARY_PERIODS.WEEK);
    diaryService.anchorMoment = window.moment("2026-09-06");

    const singleEntry = {
      id: "2026-09-06-1",
      dateKey: "2026-09-06",
      moment: window.moment("2026-09-06"),
      type: "Good",
      cleanText: "إنجاز اليوم",
      hasAudio: false
    };

    diaryService.loadEntries = vi.fn(async () => [singleEntry]);

    const controller = new DiaryViewController(mockContext);
    const container = document.createElement("div");
    await controller.render(container);

    const emptyRows = container.querySelectorAll(".dh-diary-empty-day-row");
    expect(emptyRows.length).toBe(0);

    const daySections = container.querySelectorAll(".dh-diary-day-section");
    expect(daySections.length).toBe(1);
  });

  it("should render By Type view mode with proper headers, category dots, and days inside types", async () => {
    mockContext.getDiaryViewMode = vi.fn(() => "types");

    const entries = [
      {
        id: "1",
        dateKey: "2026-09-06",
        moment: window.moment("2026-09-06"),
        type: "Good",
        cleanText: "عمل متقن",
        timestamp: 1000
      },
      {
        id: "2",
        dateKey: "2026-09-05",
        moment: window.moment("2026-09-05"),
        type: "Good",
        cleanText: "إنجاز رائع آخر",
        timestamp: 900
      },
      {
        id: "3",
        dateKey: "2026-09-06",
        moment: window.moment("2026-09-06"),
        type: "Lesson",
        cleanText: "التعلم من الخطأ",
        timestamp: 1050
      }
    ];

    diaryService.loadEntries = vi.fn(async () => entries);

    const controller = new DiaryViewController(mockContext);
    const container = document.createElement("div");
    await controller.render(container);

    // Verify type sections rendered for Good and Lesson (Bad and Notes omitted)
    const typeSections = container.querySelectorAll(".dh-diary-type-section");
    expect(typeSections.length).toBe(2);

    const goodSection = container.querySelector(".dh-diary-type-section.type-good");
    expect(goodSection).not.toBeNull();

    const goodHeader = goodSection.querySelector(".dh-diary-type-header");
    expect(goodHeader).not.toBeNull();

    // Verify chevron and dot in header
    const chevron = goodHeader.querySelector(".dh-category-chevron");
    expect(chevron).not.toBeNull();

    const dot = goodHeader.querySelector(".dh-category-dot.type-good");
    expect(dot).not.toBeNull();

    // Verify days are rendered inside the type section
    const daySectionsInsideGood = goodSection.querySelectorAll(".dh-diary-day-section");
    expect(daySectionsInsideGood.length).toBe(2);
  });

  it("should preserve DaySection as root and only show matching type when type filter is active", async () => {
    mockContext.getDiaryViewMode = vi.fn(() => "grouped");
    diaryService.setSelectedType("Good");

    const entries = [
      {
        id: "1",
        dateKey: "2026-09-06",
        moment: window.moment("2026-09-06"),
        type: "Good",
        cleanText: "تدوينة جيدة 1",
        timestamp: 1000
      },
      {
        id: "2",
        dateKey: "2026-09-06",
        moment: window.moment("2026-09-06"),
        type: "Good",
        cleanText: "تدوينة جيدة 2",
        timestamp: 980
      },
      {
        id: "3",
        dateKey: "2026-09-06",
        moment: window.moment("2026-09-06"),
        type: "Bad",
        cleanText: "تدوينة سيئة",
        timestamp: 950
      }
    ];

    // Filter service only returns matching Good entries
    diaryService.loadEntries = vi.fn(async () => entries);

    const controller = new DiaryViewController(mockContext);
    const container = document.createElement("div");
    await controller.render(container);

    const daySections = container.querySelectorAll(".dh-diary-day-section");
    expect(daySections.length).toBe(1);

    const daySection = daySections[0];
    const goodCat = daySection.querySelector(".dh-diary-category-group.type-good");
    const badCat = daySection.querySelector(".dh-diary-category-group.type-bad");

    // Good should be present, Bad must be absent
    expect(goodCat).not.toBeNull();
    expect(badCat).toBeNull();
  });

  it("should enforce ZERO !important across all css stylesheets in src/styles", () => {
    const stylesDir = path.resolve(__dirname, "../src/styles");
    const files = fs.readdirSync(stylesDir).filter(f => f.endsWith(".css"));
    expect(files.length).toBeGreaterThan(0);

    files.forEach(file => {
      const content = fs.readFileSync(path.join(stylesDir, file), "utf-8");
      // Strip comments so we only check actual CSS rules
      const stripped = content.replace(/\/\*[\s\S]*?\*\//g, "");
      const matches = stripped.match(/!important/g);
      expect(matches, `Found !important in ${file}`).toBeNull();
    });
  });

  it("should render Timeline mode unified under DiaryDaySection with Gregorian, Hijri, and + تدوينة", async () => {
    mockContext.getDiaryViewMode = vi.fn(() => "timeline");

    const entries = [
      {
        id: "t1",
        dateKey: "2026-09-06",
        moment: window.moment("2026-09-06"),
        time: "14:30",
        type: "Good",
        cleanText: "جلسة برمجة مركزة",
        timestamp: window.moment("2026-09-06 14:30").valueOf()
      },
      {
        id: "t2",
        dateKey: "2026-09-06",
        moment: window.moment("2026-09-06"),
        time: "10:15",
        type: "Bad",
        cleanText: "تشتت في تصفح الأخبار",
        timestamp: window.moment("2026-09-06 10:15").valueOf()
      }
    ];

    diaryService.loadEntries = vi.fn(async () => entries);

    const controller = new DiaryViewController(mockContext);
    const container = document.createElement("div");
    await controller.render(container);

    // Timeline mode should use DiaryDaySection as the day anchor
    const daySection = container.querySelector(".dh-diary-day-section");
    expect(daySection).not.toBeNull();
    expect(daySection.classList.contains("is-timeline")).toBe(true);

    // Header has day name, date, hijri, and + تدوينة
    const dayName = daySection.querySelector(".day-name-text");
    expect(dayName.textContent).toBe("الأحد");

    const addBtn = daySection.querySelector(".dh-day-add-btn");
    expect(addBtn).not.toBeNull();
    expect(addBtn.textContent.trim()).toBe("+ تدوينة");

    // Inside body, cards flow directly with their times and type badges without nested category boxes
    const categoryBoxes = daySection.querySelectorAll(".dh-diary-category-group");
    expect(categoryBoxes.length).toBe(0);

    const cards = daySection.querySelectorAll(".dh-diary-entry-card");
    expect(cards.length).toBe(2);

    // First card should be newest (14:30)
    const firstCardTime = cards[0].querySelector(".entry-time-badge");
    expect(firstCardTime.textContent).toBe("14:30");

    const secondCardTime = cards[1].querySelector(".entry-time-badge");
    expect(secondCardTime.textContent).toBe("10:15");

    // Cards should NOT have duplicated date headers
    cards.forEach(card => {
      expect(card.querySelector(".entry-date-part")).toBeNull();
    });
  });
});
