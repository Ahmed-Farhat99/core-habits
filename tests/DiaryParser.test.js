import { describe, it, expect } from "vitest";
import { DiaryParser } from "../src/services/DiaryParser.js";

describe("DiaryParser Tests", () => {
  const dummyDate = window.moment("2025-11-11");

  it("should parse Dataview inline fields (Good::, Bad::, Lesson::) without timestamp", () => {
    const content = `
## 💡 أفكار وملاحظات 
- 
### 🗃️ صندوق التقاط الرؤى
- Good:: اشتريت اللاب الحمد الله 7550 يارب يطلع كويس
- Bad:: فضلت اسمع اغاني مع خيال ديني وبكاء سبحان الله على تقلب المشاعر وفي نفس الوقت 
- Lesson::صحيت مسكت الفون شوية وقلبت في امازون ونون لازم لما أصحى أقوم حمام
----
`;
    const entries = DiaryParser.parse(content, dummyDate, "Daily Notes/2025-11-11.md");
    expect(entries.length).toBe(3);

    const [good, bad, lesson] = entries;
    expect(good.type).toBe("Good");
    expect(good.cleanText).toBe("اشتريت اللاب الحمد الله 7550 يارب يطلع كويس");
    expect(good.time).toBe("");
    expect(good.source).toBe("inline");

    expect(bad.type).toBe("Bad");
    expect(bad.cleanText).toContain("فضلت اسمع اغاني");

    expect(lesson.type).toBe("Lesson");
    expect(lesson.cleanText).toContain("صحيت مسكت الفون");
  });

  it("should discard unfilled template placeholders like - Good:: #theme/planning or - Bad::", () => {
    const content = `
## 💡 أفكار وملاحظات
- Good:: #theme/planning
- Bad:: #theme/focus
- Lesson:: #theme/systems
- Good::   
- Bad::
`;
    const entries = DiaryParser.parse(content, dummyDate);
    expect(entries.length).toBe(0);
  });

  it("should strip trailing theme tags from filled entries", () => {
    const content = `
### 🗃️ صندوق التقاط الرؤى
- Good:: إن اليوم عدى على خير رغم البداية السيئة #theme/planning
- Bad:: نمت بعد ما وقعت في الذنب صحيت افوق لا طبعا #theme/focus
`;
    const entries = DiaryParser.parse(content, dummyDate);
    expect(entries.length).toBe(2);
    expect(entries[0].cleanText).toBe("إن اليوم عدى على خير رغم البداية السيئة");
    expect(entries[1].cleanText).toBe("نمت بعد ما وقعت في الذنب صحيت افوق لا طبعا");
  });

  it("should parse Core Habits bracketed types with timestamp and audio", () => {
    const content = `
## 🌟 يومياتي
### 🧠 Daily Reflection
- 23:41 [type:: Good] ![[Voice-Comment-20260425-234144.webm]] ملخص اليوم
- 12:30 [type:: Note] فكرة لتطوير الإضافة
- [type:: Lesson] درس مستفاد بدون وقت
`;
    const entries = DiaryParser.parse(content, dummyDate);
    expect(entries.length).toBe(3);

    const [voiceEntry, noteEntry, lessonEntry] = entries;
    expect(voiceEntry.type).toBe("Good");
    expect(voiceEntry.time).toBe("23:41");
    expect(voiceEntry.hasAudio).toBe(true);
    expect(voiceEntry.audioFiles).toContain("Voice-Comment-20260425-234144.webm");
    expect(voiceEntry.cleanText).toBe("ملخص اليوم");

    expect(noteEntry.type).toBe("Idea"); // Note normalizes to Idea/Note
    expect(noteEntry.time).toBe("12:30");
    expect(noteEntry.cleanText).toBe("فكرة لتطوير الإضافة");

    expect(lessonEntry.type).toBe("Lesson");
    expect(lessonEntry.time).toBe("");
    expect(lessonEntry.cleanText).toBe("درس مستفاد بدون وقت");
  });

  it("keeps an audio-only thought inside a diary heading", () => {
    const entries = DiaryParser.parse("## يومياتي\n- 12:30 ![[Voice-20250901.webm]]", dummyDate);
    expect(entries).toHaveLength(1);
    expect(entries[0].hasAudio).toBe(true);
    expect(entries[0].audioFiles).toEqual(["Voice-20250901.webm"]);
    expect(entries[0].cleanText).toBe("");
  });

  it("should parse free-form thought bullets under known thoughts headings", () => {
    const content = `
## 💡 أفكار وملاحظات 
- اشتغلت 5 ساعات رغم اني ضيعت 3 الصبح
- يوم صفري وقعت جامد جدا ودفعت 100 جنية كمان
`;
    const entries = DiaryParser.parse(content, dummyDate);
    expect(entries.length).toBe(2);
    expect(entries[0].cleanText).toBe("اشتغلت 5 ساعات رغم اني ضيعت 3 الصبح");
    expect(entries[0].type).toBe("Idea");
    expect(entries[1].cleanText).toBe("يوم صفري وقعت جامد جدا ودفعت 100 جنية كمان");
  });

  it("should structure daily journal into categorized sections", () => {
    const entries = [
      { type: "Good", cleanText: "إنجاز 1", hasAudio: false },
      { type: "Good", cleanText: "إنجاز 2", hasAudio: true },
      { type: "Bad", cleanText: "سلوك سيء", hasAudio: false },
      { type: "Lesson", cleanText: "درس اليوم", hasAudio: false },
      { type: "Idea", cleanText: "خاطرة", hasAudio: false }
    ];

    const structured = DiaryParser.structureDailyJournal(entries, dummyDate, false);
    expect(structured.isEmpty).toBe(false);
    expect(structured.totalCount).toBe(5);
    expect(structured.hasAudio).toBe(true);
    expect(structured.sections.good.length).toBe(2);
    expect(structured.sections.bad.length).toBe(1);
    expect(structured.sections.lesson.length).toBe(1);
    expect(structured.sections.notes.length).toBe(1);
  });

  it("should strip [habit-id::] and [habit-note::] metadata and extract time in DiaryParser", () => {
    const rawContent = `
## 💡 أفكار وملاحظات
- 15:52 [habit-id:: habit-1780996536739] [habit-note:: 2026-09-06] [type:: Good] فكرة مشروع ممتازة جدا
- 09:30 - [type:: Lesson] تعلمت درسا رائعا اليوم [habit-id:: h-999]
- 18:45 مراجعة عامة بدون نوع مخصص
`;
    const targetDate = window.moment("2026-09-06");
    const parsed = DiaryParser.parse(rawContent, targetDate, "2026-09-06.md");

    expect(parsed.length).toBe(3);

    const first = parsed[0];
    expect(first.time).toBe("15:52");
    expect(first.cleanText).toBe("فكرة مشروع ممتازة جدا");
    expect(first.cleanText).not.toContain("habit-id");
    expect(first.cleanText).not.toContain("habit-note");
    expect(first.type).toBe("Good");

    const second = parsed[1];
    expect(second.time).toBe("09:30");
    expect(second.cleanText).toBe("تعلمت درسا رائعا اليوم");
    expect(second.cleanText).not.toContain("habit-id");
    expect(second.type).toBe("Lesson");

    const third = parsed[2];
    expect(third.time).toBe("18:45");
    expect(third.cleanText).toBe("مراجعة عامة بدون نوع مخصص");
    expect(third.type).toBe("Idea");
  });

  it("should not parse habit comments under ### 💬 ملاحظات العادات or lines with habit metadata", () => {
    const content = `
### 💬 ملاحظات العادات
- 21:05 [habit-id:: habit-123] [habit-note:: قراءة] [[قراءة]] - قرأت 10 صفحات اليوم
- 22:15 [habit-id:: habit-456] [habit-note:: رياضة] رياضة - تمارين إطالة

## 💡 أفكار وملاحظات
- خاطرة حقيقية لليوم
- 23:00 [habit-id:: habit-789] [habit-note:: برمجة] برمجة - كتبت 50 سطر كود
`;
    const entries = DiaryParser.parse(content, dummyDate);
    // Should ONLY contain the real thought ("خاطرة حقيقية لليوم")
    expect(entries.length).toBe(1);
    expect(entries[0].cleanText).toBe("خاطرة حقيقية لليوم");
    expect(entries[0].type).toBe("Idea");
  });
});

