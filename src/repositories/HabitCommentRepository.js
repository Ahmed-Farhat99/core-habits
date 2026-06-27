import { getNoteByDate, TextUtils } from "../utils/helpers.js";
import { 
  DEFAULT_HABIT_NOTES_HEADING,
  DEFAULT_REFLECTION_HEADING,
  normalizeReflectionType
} from "../constants.js";
import { Utils } from "../utils/Utils.js";

export class HabitCommentRepository {
  static isCommentLineForHabit(line, habit) {
    if (!line || !habit) return false;

    const idMatch = line.match(/\[habit-id::\s*(.*?)\s*\]/i);
    if (idMatch) {
      return idMatch[1].trim() === habit.id;
    }

    const noteMatch = line.match(/\[habit-note::\s*(.*?)\s*\]/i);
    const targetNameFolded = TextUtils.foldArabic(habit.name);
    const targetHistoryFolded = (habit.nameHistory || []).map(n => TextUtils.foldArabic(n.replace(/\[\[|\]\]/g, "")));

    if (noteMatch) {
      const commentNameFolded = TextUtils.foldArabic(noteMatch[1]);
      return commentNameFolded === targetNameFolded || targetHistoryFolded.includes(commentNameFolded);
    }

    // Legacy name check fallback
    const cleanName = TextUtils.clean(habit.linkText || habit.name);
    const lineFolded = TextUtils.foldArabic(line);
    return (
      (habit.linkText && line.includes(habit.linkText)) ||
      line.includes(`[habit-note:: ${cleanName}]`) ||
      line.includes(`habit:: ${cleanName}`) ||
      lineFolded.includes(targetNameFolded) ||
      targetHistoryFolded.some(hist => lineFolded.includes(hist))
    );
  }

  /**
   * @param {import('obsidian').App} app
   * @param {object} plugin
   */
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }

  async runWithLock(callback) {
    if (this.plugin && typeof this.plugin.runWithLock === 'function') {
      return await this.plugin.runWithLock(callback);
    }
    return await callback();
  }

  /**
   * Injects or updates a comment for a specific habit and date in the matching Daily Note.
   * Matches existing comments by habit_id first, then by name/history for legacy logs.
   * @param {object} habit - The habit object
   * @param {moment.Moment} date - The target date
   * @param {string} comment - The comment content
   * @returns {Promise<string>} Daily Note basename
   */
  async upsertCommentForHabitDate(habit, date, comment) {
    return await this.runWithLock(async () => {
      const file = await getNoteByDate(this.app, date, true, this.plugin.settings);
      if (!file) {
        throw new Error(
          this.plugin.settings.language === "ar"
            ? "تعذر فتح أو إنشاء ملف اليوم."
            : "Could not open or create the daily note."
        );
      }

      const timeStr = window.moment().format("HH:mm");
      const cleanName = TextUtils.clean(habit.linkText || habit.name);
      const habitLabel = habit.linkText || habit.name;

      // Schema: - HH:mm [habit-id:: habit_id] [habit-note:: display_name] linkText - comment
      const commentLine = `- ${timeStr} [habit-id:: ${habit.id}] [habit-note:: ${cleanName}] ${habitLabel} - ${comment}`;
      const parentHeading = this.plugin.settings.dailyParentHeading;
      const subHeading = this.plugin.settings.habitLogHeading || DEFAULT_HABIT_NOTES_HEADING;

      await this.app.vault.process(file, (content) => {
        const lines = content.split(/\r?\n/);
        const cleanParent = parentHeading ? parentHeading.trim() : null;
        const cleanSub = subHeading.trim();

        let inParent = !cleanParent;
        let inSub = false;
        let targetLineIdx = -1;

        const parentLevel = cleanParent ? (cleanParent.match(/^#+/)?.[0]?.length || 2) : 0;
        const subLevel = cleanSub.match(/^#+/)?.[0]?.length || 3;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          if (cleanParent && line.trim() === cleanParent) {
            inParent = true;
            continue;
          }

          if (cleanParent && inParent && line.startsWith("#") && (line.match(/^#+/)?.[0]?.length || 0) <= parentLevel && line.trim() !== cleanParent) {
            inParent = false;
            inSub = false;
            continue;
          }

          if (inParent && line.trim() === cleanSub) {
            inSub = true;
            continue;
          }

          if (inSub && line.startsWith("#") && (line.match(/^#+/)?.[0]?.length || 0) <= subLevel && line.trim() !== cleanSub) {
            inSub = false;
            continue;
          }

          if (inSub) {
            if (HabitCommentRepository.isCommentLineForHabit(line, habit)) {
              targetLineIdx = i;
              break;
            }
          }
        }

        if (targetLineIdx !== -1) {
          // Replace existing line
          lines[targetLineIdx] = commentLine;
          return lines.join(content.includes("\r\n") ? "\r\n" : "\n");
        } else {
          // Insert new line under section
          return Utils.insertNestedContent(content, parentHeading, subHeading, commentLine);
        }
      });

      return file.basename;
    });
  }

  /**
   * Retrieves the comment text for a habit on a specific date.
   * Checks habit_id first, then falls back to name/history.
   * @param {object} habit - The habit object
   * @param {moment.Moment} date - The date
   * @returns {Promise<string>} The comment content (with timestamp stripped) or empty string
   */
  async getCommentForHabitDate(habit, date) {
    const dailyNote = await getNoteByDate(this.app, date, false, this.plugin.settings);
    if (!dailyNote) return "";

    const content = await this.app.vault.cachedRead(dailyNote);
    const subHeading = this.plugin.settings.habitLogHeading || DEFAULT_HABIT_NOTES_HEADING;

    // Extract subheading section lines
    const lines = this._extractSectionLines(content, subHeading);

    for (const line of lines) {
      if (HabitCommentRepository.isCommentLineForHabit(line, habit)) {
        return this._cleanCommentText(line, habit.name, habit.nameHistory || []);
      }
    }

    return "";
  }

  /**
   * Reads comment history for a habit from the last X Daily Notes.
   * Checks habit_id first, falling back to name/history matching.
   * @param {object} habit - The habit object
   * @param {number} [daysToLookBack=30] - Number of days to check
   * @returns {Promise<Array<{date: moment.Moment, text: string}>>}
   */
  async getCommentHistoryForHabit(habit, daysToLookBack = 30) {
    const entries = [];
    const now = window.moment();
    const subHeading = this.plugin.settings.habitLogHeading || DEFAULT_HABIT_NOTES_HEADING;

    for (let i = 0; i < daysToLookBack; i++) {
      const targetDate = now.clone().subtract(i, "days");
      const file = await getNoteByDate(this.app, targetDate, false, this.plugin.settings);
      if (!file) continue;

      const content = await this.app.vault.cachedRead(file);
      const lines = this._extractSectionLines(content, subHeading);

      for (const line of lines) {
        if (HabitCommentRepository.isCommentLineForHabit(line, habit)) {
          const cleanText = this._cleanCommentText(line, habit.name, habit.nameHistory || []);
          entries.push({ date: targetDate, text: cleanText });
        }
      }
    }

    return entries;
  }

  /**
   * Resolves a habit by name/alias/history, and retrieves its comments history.
   * @param {string} habitName - The name of the habit to search for
   * @param {number} [daysToLookBack=30] - Number of days to check
   * @returns {Promise<Array<{date: moment.Moment, text: string}>>}
   */
  async getCommentHistoryByName(habitName, daysToLookBack = 30) {
    const cleanName = TextUtils.clean(habitName);
    const targetNameFolded = TextUtils.foldArabic(cleanName);
    let resolvedHabit = null;

    if (this.plugin.habitManager && this.plugin.habitManager.habitsMap) {
      for (const h of this.plugin.habitManager.habitsMap.values()) {
        if (
          TextUtils.foldArabic(h.name) === targetNameFolded ||
          TextUtils.foldArabic(h.linkText || "") === targetNameFolded ||
          (h.nameHistory || []).some(
            (n) => TextUtils.foldArabic(n.replace(/\[\[|\]\]/g, "")) === targetNameFolded
          )
        ) {
          resolvedHabit = h;
          break;
        }
      }
    }

    if (!resolvedHabit) {
      resolvedHabit = {
        id: cleanName,
        name: cleanName,
        linkText: habitName,
        nameHistory: []
      };
    }

    return await this.getCommentHistoryForHabit(resolvedHabit, daysToLookBack);
  }

  /**
   * Injects a typed daily reflection into the matching Daily Note.
   * @param {moment.Moment} targetDate - The date of the reflection
   * @param {string} text - The reflection text
   * @param {string} [type="Idea"] - The reflection type
   * @returns {Promise<string>} Daily Note basename
   */
  async injectReflection(targetDate, text, type = "Idea") {
    return await this.runWithLock(async () => {
      const file = await getNoteByDate(this.app, targetDate, true, this.plugin.settings);
      if (!file) {
        throw new Error(
          this.plugin.settings.language === "ar"
            ? "تعذر فتح ملف اليوم."
            : "Could not open the daily note."
        );
      }

      const timeStr = window.moment().format("HH:mm");
      const reflectionType = normalizeReflectionType(type);
      const reflectionLine = `- ${timeStr} [type:: ${reflectionType}] ${text}`;
      const heading = this.plugin.settings.reflectionHeading || DEFAULT_REFLECTION_HEADING;

      await this.app.vault.process(file, (content) => {
        return Utils.insertNestedContent(content, this.plugin.settings.dailyParentHeading, heading, reflectionLine);
      });

      return file.basename;
    });
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  _extractSectionLines(content, heading) {
    return Utils.extractSectionLines(content, heading);
  }

  _cleanCommentText(line, habitName, nameHistory = []) {
    let cleanLine = line.trim();

    // 1. Remove leading list marker "- " or "- [ ] "
    cleanLine = cleanLine.replace(/^-\s*(\[[ x-]\])?\s*/i, "");

    // 2. Remove leading timestamp like "12:30 " or "12:30:45 "
    cleanLine = cleanLine.replace(/^\d{1,2}:\d{2}(:\d{2})?\s*/, "");

    // 3. Remove inline keys
    cleanLine = cleanLine.replace(/\[habit-id::.*?\]\s*/gi, "");
    cleanLine = cleanLine.replace(/\[habit-note::.*?\]\s*/gi, "");

    // 4. Remove habit link/name label prefixes (e.g. "[[Reading]] - " or "Reading - ")
    const escapedName = Utils.escapeRegExp(habitName);
    const nameRegex = new RegExp(`^(?:\\[\\[)?${escapedName}(?:\\]\\])?\\s*-\\s*`, "i");
    cleanLine = cleanLine.replace(nameRegex, "");

    for (const hist of nameHistory) {
      const escHist = Utils.escapeRegExp(hist.replace(/\[\[|\]\]/g, ""));
      const histRegex = new RegExp(`^(?:\\[\\[)?${escHist}(?:\\]\\])?\\s*-\\s*`, "i");
      cleanLine = cleanLine.replace(histRegex, "");
    }

    return cleanLine.trim();
  }
}
