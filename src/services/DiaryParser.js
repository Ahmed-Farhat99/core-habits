import { normalizeReflectionType } from '../constants.js';
import { DateUtils, TextUtils } from '../utils/helpers.js';

export class DiaryParser {
  /**
   * Recognized reflection headings across different versions and languages
   */
  static KNOWN_HEADINGS = [
    "أفكار وملاحظات",
    "صندوق التقاط الرؤى",
    "Daily Reflection",
    "تدوينات اليوم",
    "تدوينات وتأملات",
    "يومياتي"
  ];

  /**
   * Cleans raw text from inline Dataview markers, type tags, and unfilled template tags
   * @param {string} text
   * @returns {string}
   */
  static cleanEntryText(text) {
    if (!text) return "";
    let clean = text;

    // Remove Dataview bracketed type like [type:: Good]
    clean = clean.replace(/\[type::\s*[^\]]+\]/gi, "");

    // Remove Habit comment tags e.g. [habit-id:: xxx] [habit-note:: yyy]
    clean = clean.replace(/\[habit-id::\s*[^\]]+\]\s*/gi, "");
    clean = clean.replace(/\[habit-note::\s*[^\]]+\]\s*/gi, "");

    // Remove Dataview inline field key at start e.g. "Good::" or "• Good::"
    clean = clean.replace(/^[-•*]?\s*(?:Good|Bad|Lesson|Idea|Note|خواطر|إيجابيات|سلبيات|دروس)::\s*/i, "");

    // Remove trailing theme tags like #theme/planning, #theme/focus, #theme/systems
    clean = clean.replace(/\s*#theme\/[\w-]+(?:\s*#theme\/[\w-]+)*\s*$/gi, "");

    // Remove any leftover leading dash, bullet, or separator
    clean = clean.trim().replace(/^[-•*–—:]\s*/, "");

    return clean.trim();
  }

  /**
   * Checks if an entry line is just an unfilled template placeholder (e.g. "- Good:: #theme/planning" or "- Bad::")
   * @param {string} text
   * @returns {boolean}
   */
  static isUnfilledTemplatePlaceholder(text) {
    if (!text) return true;
    const cleaned = this.cleanEntryText(text);
    // If after cleaning away keys and #theme tags nothing is left, it's an unfilled placeholder
    return cleaned.length === 0;
  }

  /**
   * Extracts embedded audio file paths/links from text
   * @param {string} text
   * @returns {{ audioFiles: string[], remainingText: string }}
   */
  static extractAudio(text) {
    if (!text) return { audioFiles: [], remainingText: "" };
    const audioRegex = /!\[\[([^\]]+\.(?:webm|mp4|m4a|ogg|wav|mp3))\]\]/gi;
    const audioFiles = [];
    let remainingText = text;

    let match;
    while ((match = audioRegex.exec(text)) !== null) {
      audioFiles.push(match[1].trim());
    }

    remainingText = remainingText.replace(audioRegex, "").trim();
    return { audioFiles, remainingText };
  }

  /**
   * Parses raw markdown content into normalized entries
   * Tolerant of:
   * 1. Dataview inline fields: "- Good:: text", "• Bad:: text", "Lesson:: text"
   * 2. Core Habits bracketed entries: "- 23:41 [type:: Good] text", "- [type:: Note] text"
   * 3. Free thoughts under thoughts/reflection headings: "- bullet text"
   * 4. Audio recordings
   *
   * @param {string} content - Markdown content of the daily note
   * @param {moment.Moment} dateMoment - Moment object of the note date
   * @param {string} [filePath=""] - Vault path of the note
   * @param {string} [customHeading=""] - User configured reflection heading
   * @returns {Array<object>} List of NormalizedJournalEntry
   */
  static parse(content, dateMoment, filePath = "", customHeading = "") {
    if (!content || typeof content !== "string") return [];

    const entries = [];
    const dateKey = DateUtils.formatDateKey(dateMoment);
    const lines = content.split(/\r?\n/);
    const seenTextSignatures = new Set();

    let currentHeading = "";
    let isInsideKnownSection = false;
    let isInsideCodeBlock = false;

    // Build heading check list
    const activeHeadings = [...this.KNOWN_HEADINGS];
    const headingsToCheck = Array.isArray(customHeading) ? customHeading : [customHeading];
    for (const h of headingsToCheck) {
      if (!h || typeof h !== "string") continue;
      const cleanCustom = h.replace(/^#+\s*/, "").trim();
      if (cleanCustom && !activeHeadings.includes(cleanCustom)) {
        activeHeadings.push(cleanCustom);
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const trimmed = rawLine.trim();

      // Track code blocks (ignore dataviewjs blocks, etc.)
      if (trimmed.startsWith("```")) {
        isInsideCodeBlock = !isInsideCodeBlock;
        continue;
      }
      if (isInsideCodeBlock) continue;

      // Track headings
      const headingMatch = rawLine.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        currentHeading = headingMatch[2].trim();
        // Check if this heading matches known reflection headings
        isInsideKnownSection = activeHeadings.some(h => {
          const hFolded = TextUtils.foldArabic(h);
          const currentFolded = TextUtils.foldArabic(currentHeading);
          return currentFolded.includes(hFolded);
        });
        continue;
      }

      // Ignore tasks / checkboxes: "- [ ]", "- [x]", etc.
      if (/^[-*•]\s*\[[ xX/]\]/.test(trimmed)) {
        continue;
      }

      // ── Pattern 1: Dataview Inline Fields (e.g. "- Good:: text", "• Bad:: text") ──
      const inlineMatch = trimmed.match(/^[-*•]?\s*(Good|Bad|Lesson|Idea|Note|خواطر|إيجابيات|سلبيات|دروس)::(.*)$/i);
      if (inlineMatch) {
        const rawKey = inlineMatch[1].trim();
        const rawVal = inlineMatch[2].trim();

        // Discard unfilled template placeholders like "- Good:: #theme/planning" or "- Bad::"
        if (this.isUnfilledTemplatePlaceholder(rawVal)) {
          continue;
        }

        const cleanVal = this.cleanEntryText(rawVal);
        const { audioFiles, remainingText } = this.extractAudio(cleanVal);

        const normalizedType = normalizeReflectionType(rawKey);
        const sig = `${normalizedType}:${remainingText}`;
        if (seenTextSignatures.has(sig)) continue;
        seenTextSignatures.add(sig);

        entries.push({
          id: `${dateKey}-inline-${i}`,
          date: dateKey,
          dateKey,
          moment: dateMoment.clone(),
          timestamp: dateMoment.clone().startOf("day").valueOf() + i,
          time: "", // Dataview inline fields have no time
          type: normalizedType,
          rawText: rawVal,
          cleanText: remainingText,
          text: remainingText,
          audioFiles,
          hasAudio: audioFiles.length > 0,
          path: filePath,
          source: "inline"
        });
        continue;
      }

      // ── Pattern 2: Core Habits Bracketed Type (e.g. "- 23:41 [type:: Good] text" or "- 23:41 - [type:: Good] text") ──
      const bracketMatch = trimmed.match(/^[-*•]\s+(?:(\d{1,2}:\d{2})\s*(?:[-–—:]\s*)?)?\[type::\s*([^\]]+)\]\s*(.*)$/i);
      if (bracketMatch) {
        const time = bracketMatch[1] || "";
        const rawType = bracketMatch[2].trim();
        const rawVal = bracketMatch[3].trim();

        if (this.isUnfilledTemplatePlaceholder(rawVal)) {
          continue;
        }

        const cleanVal = this.cleanEntryText(rawVal);
        const { audioFiles, remainingText } = this.extractAudio(cleanVal);

        const normalizedType = normalizeReflectionType(rawType);
        const sig = `${normalizedType}:${time}:${remainingText}`;
        if (seenTextSignatures.has(sig)) continue;
        seenTextSignatures.add(sig);

        entries.push({
          id: `${dateKey}-bracket-${i}`,
          date: dateKey,
          dateKey,
          moment: dateMoment.clone(),
          timestamp: time
            ? dateMoment.clone().startOf("day").add(parseInt(time.split(":")[0], 10), "hours").add(parseInt(time.split(":")[1], 10), "minutes").valueOf()
            : dateMoment.clone().startOf("day").valueOf() + i,
          time,
          type: normalizedType,
          rawText: rawVal,
          cleanText: remainingText,
          text: remainingText,
          audioFiles,
          hasAudio: audioFiles.length > 0,
          path: filePath,
          source: "bracket"
        });
        continue;
      }

      // ── Pattern 3: Bullet points with standalone [type:: ...] anywhere in line ──
      if (trimmed.startsWith("-") || trimmed.startsWith("•") || trimmed.startsWith("*")) {
        const embeddedTypeMatch = trimmed.match(/\[type::\s*([^\]]+)\]/i);
        if (embeddedTypeMatch) {
          const rawType = embeddedTypeMatch[1].trim();
          const timeMatch = trimmed.match(/(?:^|\s)(\d{1,2}:\d{2})(?:\s|$)/);
          const time = timeMatch ? timeMatch[1] : "";

          let rawAfterBullet = trimmed.replace(/^[-*•]\s+/, "");
          if (time && rawAfterBullet.startsWith(time)) {
            rawAfterBullet = rawAfterBullet.substring(time.length).trim();
          }
          const cleanVal = this.cleanEntryText(rawAfterBullet);
          if (this.isUnfilledTemplatePlaceholder(cleanVal)) continue;

          const { audioFiles, remainingText } = this.extractAudio(cleanVal);
          const normalizedType = normalizeReflectionType(rawType);
          const sig = `${normalizedType}:${time}:${remainingText}`;
          if (seenTextSignatures.has(sig)) continue;
          seenTextSignatures.add(sig);

          const timestamp = time
            ? dateMoment.clone().startOf("day").add(parseInt(time.split(":")[0], 10), "hours").add(parseInt(time.split(":")[1], 10), "minutes").valueOf()
            : dateMoment.clone().startOf("day").valueOf() + i;

          entries.push({
            id: `${dateKey}-embedded-${i}`,
            date: dateKey,
            dateKey,
            moment: dateMoment.clone(),
            timestamp,
            time,
            type: normalizedType,
            rawText: trimmed,
            cleanText: remainingText,
            text: remainingText,
            audioFiles,
            hasAudio: audioFiles.length > 0,
            path: filePath,
            source: "bracket"
          });
          continue;
        }

        // ── Pattern 4: Free-form bulleted thoughts inside known reflection/thoughts section ──
        if (isInsideKnownSection) {
          const bulletContent = trimmed.replace(/^[-*•]\s+/, "").trim();
          // Filter out dividers, empty bullets, or lines containing Dataview syntax like [Project:: ...]
          if (
            bulletContent.length >= 2 &&
            !bulletContent.startsWith("---") &&
            !bulletContent.includes("[Project::") &&
            !bulletContent.includes("[Time::") &&
            !bulletContent.includes("[habit::") &&
            !bulletContent.includes("[habit-id::") &&
            !bulletContent.includes("[habit-note::") &&
            !bulletContent.includes("dv.")
          ) {
            // Extract leading time if present (e.g. "15:52 ...")
            const timeMatch = bulletContent.match(/^(\d{1,2}:\d{2})\s+(.*)$/);
            const time = timeMatch ? timeMatch[1] : "";
            const contentAfterTime = timeMatch ? timeMatch[2] : bulletContent;

            const { audioFiles, remainingText } = this.extractAudio(contentAfterTime);
            const cleanText = this.cleanEntryText(remainingText);
            if (cleanText || audioFiles.length > 0) {
              const sig = `Idea:${time}:${cleanText}`;
              if (!seenTextSignatures.has(sig)) {
                seenTextSignatures.add(sig);
                const timestamp = time
                  ? dateMoment.clone().startOf("day").add(parseInt(time.split(":")[0], 10), "hours").add(parseInt(time.split(":")[1], 10), "minutes").valueOf()
                  : dateMoment.clone().startOf("day").valueOf() + i;

                entries.push({
                  id: `${dateKey}-thought-${i}`,
                  date: dateKey,
                  dateKey,
                  moment: dateMoment.clone(),
                  timestamp,
                  time,
                  type: "Idea",
                  rawText: bulletContent,
                  cleanText,
                  text: cleanText,
                  audioFiles,
                  hasAudio: audioFiles.length > 0,
                  path: filePath,
                  source: "thought"
                });
              }
            }
          }
        }
      }
    }

    return entries;
  }

  /**
   * Groups a list of normalized entries for a single day into structured sections
   * @param {Array<object>} dayEntries
   * @param {moment.Moment} dayMoment
   * @param {boolean} isToday
   * @returns {object} NormalizedDailyJournal
   */
  static structureDailyJournal(dayEntries, dayMoment, isToday = false) {
    const dateKey = DateUtils.formatDateKey(dayMoment);
    const entries = Array.isArray(dayEntries) ? dayEntries : [];

    const sections = {
      good: [],
      bad: [],
      lesson: [],
      notes: []
    };

    entries.forEach(entry => {
      const type = normalizeReflectionType(entry.type);
      if (type === "Good") {
        sections.good.push(entry);
      } else if (type === "Bad") {
        sections.bad.push(entry);
      } else if (type === "Lesson") {
        sections.lesson.push(entry);
      } else {
        // Idea, Note, or other
        sections.notes.push(entry);
      }
    });

    const hasAudio = entries.some(e => e.hasAudio);
    const totalCount = entries.length;

    return {
      dateKey,
      moment: dayMoment.clone(),
      isToday,
      isEmpty: totalCount === 0,
      totalCount,
      entries,
      sections,
      hasAudio
    };
  }
}
