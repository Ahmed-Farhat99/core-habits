/**
 * HabitEntity.js
 *
 * Canonical domain model for a Habit in Core Habits.
 * Centralizes properties, validation, defaults, and frontmatter serialization/deserialization.
 */
import { inspectHabitContract, HABIT_SCHEMA_VERSION } from "./HabitDataContract.js";
import { ProgressionEngine } from "../services/ProgressionEngine.js";
import { TRANSLATIONS } from "../constants.js";

export class HabitEntity {
  /**
   * @param {Object} data
   */
  constructor(data = {}) {
    this.schemaVersion = Number.isInteger(data.schemaVersion) ? data.schemaVersion : HABIT_SCHEMA_VERSION;
    this.id = data.id ? String(data.id) : "";
    this.name = data.name ? String(data.name) : "";
    this.habitType = data.habitType === "break" ? "break" : "build";
    this.color = data.color ? String(data.color) : "teal";

    // Schedule
    if (data.schedule && typeof data.schedule === "object") {
      const days = Array.isArray(data.schedule.days)
        ? data.schedule.days.map((d) => parseInt(d, 10)).filter((d) => !isNaN(d) && d >= 0 && d <= 6)
        : [0, 1, 2, 3, 4, 5, 6];
      const type = data.schedule.type || (days.length === 7 ? "daily" : "custom");
      this.schedule = { type, days };
    } else {
      this.schedule = { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] };
    }
    const rawLevel = parseInt(data.currentLevel, 10);
    this.currentLevel = (!isNaN(rawLevel) && rawLevel >= 1 && rawLevel <= 5)
      ? rawLevel
      : Math.max(1, ProgressionEngine.calculateLevel(data));
    this.archived = Boolean(data.archived);
    this.deleted = Boolean(data.deleted);
    this.archivedDate = data.archivedDate ? Number(data.archivedDate) : null;
    this.restoredDate = data.restoredDate ? Number(data.restoredDate) : null;
    this.createdAt = data.createdAt ? Number(data.createdAt) : Date.now();
    this.order = Number.isInteger(data.order) ? data.order : 0;
    this.parentId = data.parentId ? String(data.parentId) : null;
    this.savedLongestStreak = Math.max(0, parseInt(data.savedLongestStreak, 10) || 0);

    // Name History
    if (Array.isArray(data.nameHistory)) {
      this.nameHistory = data.nameHistory.map(String).filter(Boolean);
    } else if (typeof data.nameHistory === "string" && data.nameHistory.trim()) {
      this.nameHistory = data.nameHistory.split("|||").map((s) => s.trim()).filter(Boolean);
    } else {
      this.nameHistory = [];
    }

    // Atomic Habits Description
    const ad = data.atomicDescription || {};
    this.atomicDescription = {
      identity: ad.identity ? String(ad.identity) : "",
      cue: ad.cue ? String(ad.cue) : "",
      friction: ad.friction ? String(ad.friction) : "",
      reward: ad.reward ? String(ad.reward) : ""
    };

    this.notes = data.notes ? String(data.notes) : "";

    // Level Data
    if (Array.isArray(data.levelData) && data.levelData.length > 0) {
      this.levelData = data.levelData.map((l) => ({
        goal: l?.goal ? String(l.goal) : "",
        condition: l?.condition ? String(l.condition) : "",
        achieved: Boolean(l?.achieved)
      }));
    } else {
      this.levelData = [];
    }
  }

  get linkText() {
    return this.name ? `[[${this.name}]]` : "";
  }

  /**
   * Validates the habit against the canonical schema.
   * @returns {string[]} List of validation error messages, or empty array if valid.
   */
  validate() {
    return inspectHabitContract(this);
  }

  /**
   * Checks whether a habit is scheduled for a given day of the week (0 = Sunday, 6 = Saturday).
   * @param {Object} habit - Habit entity or plain habit object
   * @param {number} dayOfWeek - Day of week (0-6)
   * @returns {boolean}
   */
  static isScheduledForDay(habit, dayOfWeek) {
    if (!habit) return false;
    if (Array.isArray(habit.schedule?.days)) {
      return habit.schedule.days.includes(dayOfWeek);
    }
    return false;
  }

  /**
   * Checks whether this habit instance is scheduled for a given day of the week.
   * @param {number} dayOfWeek - Day of week (0-6)
   * @returns {boolean}
   */
  isScheduledForDay(dayOfWeek) {
    return HabitEntity.isScheduledForDay(this, dayOfWeek);
  }

  /**
   * Converts habit instance to a flat properties object for Obsidian frontmatter.
   * @returns {Object}
   */
  toFrontmatterProps() {
    const daysArr = this.schedule?.days || [0, 1, 2, 3, 4, 5, 6];
    const scheduleStr = this.schedule?.type === "daily" ? "daily" : daysArr.join(",");

    const formatDate = (ts) => {
      if (!ts) return "";
      const m = typeof window !== "undefined" && window.moment ? window.moment(ts) : null;
      if (m && m.isValid()) {
        return m.locale("en").format("YYYY-MM-DD");
      }
      return new Date(ts).toISOString().split("T")[0];
    };

    const ad = this.atomicDescription || {};
    
    const isV3 = (this.schemaVersion >= 3);
    // Core essential properties (Always present)
    const props = {
      schema_version: this.schemaVersion || HABIT_SCHEMA_VERSION,
      habit_id: this.id || "",
      habit_type: this.habitType || "build",
      color: this.color || "teal",
      schedule: scheduleStr,
      archived: this.archived ? "true" : "false",
      created_at: formatDate(this.createdAt)
    };

    // In Schema v1 and v2, order and current_level were in frontmatter.
    // In Schema v3, order lives in settings.habitOrder and current_level is derived.
    if (!isV3) {
      props.current_level = this.currentLevel || 1;
      props.order = this.order;
    }

    // Sparse properties: only serialize when present / meaningful
    props.deleted = this.deleted ? "true" : "false";

    if (this.parentId && String(this.parentId).trim()) {
      props.parent_id = String(this.parentId).trim();
    }

    if (Array.isArray(this.nameHistory) && this.nameHistory.length > 0) {
      props.name_history = this.nameHistory;
    }

    if (this.archivedDate) {
      props.archived_at = formatDate(this.archivedDate);
    }
    if (this.savedLongestStreak > 0) {
      props.saved_longest_streak = this.savedLongestStreak;
    }

    if (this.restoredDate) {
      props.restored_at = formatDate(this.restoredDate);
    }

    // Atomic Habit Blueprint (sparse: only if filled)
    if (ad.identity && ad.identity.trim()) {
      props.identity = ad.identity.trim();
    }
    if (ad.cue && ad.cue.trim()) {
      props.cue = ad.cue.trim();
    }
    if (ad.friction && ad.friction.trim()) {
      props.friction = ad.friction.trim();
    }
    if (ad.reward && ad.reward.trim()) {
      props.reward = ad.reward.trim();
    }

    // General Notes
    props.notes = this.notes ? this.notes.trim() : "";

    // Legacy / Custom Level goals (sparse: only serialized for legacy schemas)
    if (!isV3 && this.levelData && this.levelData.length > 0) {
      this.levelData.forEach((l, i) => {
        if (l.goal && l.goal.trim()) {
          props[`level_${i + 1}_goal`] = l.goal.trim();
        }
      });
    }

    return props;
  }

  /**
   * Extracts manual notes from the note body under the notes blockquote section.
   * Handles Arabic and English free-space markers, strips placeholders, with callout fallback.
   * @param {string} content
   * @returns {string}
   */
  static extractNotesFromBody(content) {
    if (!content || typeof content !== "string") return "";
    const markerAr = TRANSLATIONS.ar?.habit_notes_free_space_marker || "> **مساحة حرة للتدوين:**";
    const markerEn = TRANSLATIONS.en?.habit_notes_free_space_marker || "> **Free Space for Notes:**";
    let idx = content.indexOf(markerAr);
    let marker = markerAr;
    if (idx === -1) {
      idx = content.indexOf(markerEn);
      marker = markerEn;
    }
    if (idx !== -1) {
      const after = content.substring(idx + marker.length);
      // Find next boundary: horizontal rule '---' or markdown heading
      const boundaryMatch = after.match(/\r?\n\s*---\s*|\r?\n\s*##\s/);
      let notesContent = boundaryMatch ? after.substring(0, boundaryMatch.index) : after;

      // Clean up blockquote markers '>' and whitespace line by line
      notesContent = notesContent
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*>\s?/, ""))
        .join("\n")
        .trim();

      const placeholders = [
        (TRANSLATIONS.ar?.habit_notes_placeholder || "").replace(/^>\s*/, "").trim(),
        (TRANSLATIONS.en?.habit_notes_placeholder || "").replace(/^>\s*/, "").trim(),
        "اكتب هنا أي ملاحظات أو أفكار حول هذه العادة...",
        "Write any notes or thoughts about this habit here..."
      ];
      if (placeholders.includes(notesContent.trim())) {
        return "";
      }
      return notesContent;
    }

    // Fallback: check for [!note] callout
    const notesMatch = content.match(/>\s*\[!note\][^\r\n]*\r?\n((?:>.*\r?\n?)*)/i);
    if (notesMatch && notesMatch[1]) {
      return notesMatch[1]
        .split(/\r?\n/)
        .map((line) => line.replace(/^>\s?/, ""))
        .join("\n")
        .trim();
    }

    return "";
  }

  /**
   * Constructs a HabitEntity from frontmatter properties and file metadata.
   * @param {import('obsidian').TFile} file
   * @param {Object} props
   * @param {string|null} [content=null]
   * @returns {HabitEntity|null}
   */
  static fromFrontmatterProps(file, props, content = null) {
    if (!props) return null;

    const parseDate = (val) => {
      if (!val) return null;
      if (typeof val === "number") return val;
      const m = typeof window !== "undefined" && window.moment ? window.moment(val) : null;
      if (m && m.isValid()) return m.valueOf();
      const parsed = Date.parse(val);
      return isNaN(parsed) ? null : parsed;
    };

    let parsedCreated = file?.stat?.ctime || Date.now();
    if (props.created_at) {
      parsedCreated = parseDate(props.created_at) || parsedCreated;
    }

    let parsedNameHistory = [];
    if (Array.isArray(props.name_history)) {
      parsedNameHistory = props.name_history.map(String).filter(Boolean);
    } else if (typeof props.name_history === "string" && props.name_history.trim()) {
      if (props.name_history.includes("|||")) {
        parsedNameHistory = props.name_history.split("|||").map((s) => s.trim()).filter(Boolean);
      } else {
        parsedNameHistory = [props.name_history.trim()];
      }
    }

    let notesValue = props.notes || "";
    if (content && !Object.hasOwn(props, "notes")) {
      notesValue = HabitEntity.extractNotesFromBody(content);
    }

    // Parse schedule
    let schedule = { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] };
    if (props.schedule === "daily") {
      schedule = { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] };
    } else if (props.schedule) {
      const days = String(props.schedule)
        .split(",")
        .map((d) => parseInt(d.trim(), 10))
        .filter((d) => !isNaN(d) && d >= 0 && d <= 6);
      schedule = { type: "weekly", days: days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6] };
    } else if (props.days) {
      try {
        const cleaned = String(props.days).replace(/[[\]]/g, "");
        const days = cleaned
          .split(",")
          .map((d) => parseInt(d.trim(), 10))
          .filter((d) => !isNaN(d) && d >= 0 && d <= 6);
        schedule = { type: "weekly", days: days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6] };
      } catch {
        schedule = { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] };
      }
    }

    // Parse levelData
    const levelData = [];
    for (let i = 1; i <= 5; i++) {
      if (props[`level_${i}_goal`] !== undefined || props[`level_${i}_condition`] !== undefined) {
        levelData.push({
          goal: props[`level_${i}_goal`] || "",
          condition: props[`level_${i}_condition`] || "",
          achieved: String(props[`level_${i}_achieved`]) === "true"
        });
      }
    }
    if (levelData.length === 0) {
      for (let i = 0; i < 5; i++) {
        levelData.push({ goal: "", condition: "", achieved: false });
      }
      if (props.goal && typeof props.goal === "string" && props.goal.trim()) {
        levelData[0].goal = props.goal.trim();
      }
    }

    return new HabitEntity({
      schemaVersion: parseInt(props.schema_version, 10) || 1,
      id: String(props.habit_id || ""),
      name: file?.basename || "",
      habitType: props.habit_type === "break" ? "break" : "build",
      color: props.color || "teal",
      schedule,
      currentLevel: (!isNaN(parseInt(props.current_level, 10)) && parseInt(props.current_level, 10) >= 1 && parseInt(props.current_level, 10) <= 5)
        ? parseInt(props.current_level, 10)
        : ProgressionEngine.calculateLevel({ savedLongestStreak: parseInt(props.saved_longest_streak, 10) || 0, levelData }),
      archived: String(props.archived) === "true",
      deleted: String(props.deleted) === "true",
      parentId: props.parent_id || null,
      createdAt: parsedCreated,
      order: parseInt(props.order, 10) || 0,
      nameHistory: parsedNameHistory,
      atomicDescription: {
        identity: props.identity || "",
        cue: props.cue || "",
        friction: props.friction || "",
        reward: props.reward || ""
      },
      notes: notesValue,
      levelData,
      archivedDate: parseDate(props.archived_at),
      restoredDate: parseDate(props.restored_at),
      savedLongestStreak: parseInt(props.saved_longest_streak, 10) || 0
    });
  }

  /**
   * Produces a plain JavaScript representation.
   * @returns {Object}
   */
  toJSON() {
    return {
      schemaVersion: this.schemaVersion,
      id: this.id,
      name: this.name,
      linkText: this.linkText,
      habitType: this.habitType,
      color: this.color,
      schedule: { ...this.schedule },
      currentLevel: this.currentLevel,
      archived: this.archived,
      deleted: this.deleted,
      archivedDate: this.archivedDate,
      restoredDate: this.restoredDate,
      savedLongestStreak: this.savedLongestStreak,
      parentId: this.parentId,
      createdAt: this.createdAt,
      order: this.order,
      nameHistory: [...this.nameHistory],
      atomicDescription: { ...this.atomicDescription },
      notes: this.notes,
      levelData: this.levelData.map((l) => ({ ...l }))
    };
  }

  /**
   * Creates a deep clone of the habit entity.
   * @returns {HabitEntity}
   */
  clone() {
    return new HabitEntity(this.toJSON());
  }
}
