/**
 * HabitNoteManager.js
 * ═══════════════════════════════════════════════════════════════════════════════
 * Manages the "Obsidian-Native" habit file system for Core Habits plugin.
 *
 * ARCHITECTURE:
 * - Every habit has its own Markdown note stored in `{habitNotesFolder}/Active/`
 * - Archived habits are moved to `{habitNotesFolder}/Archive/`
 * - All habit metadata is stored in YAML Frontmatter (Properties) of the note
 * - The note body contains a rich template that helps users improve habit quality
 * - Voice memos and text logs are appended to the note under a dedicated section
 *
 * DATA FLOW:
 * addHabit()    → createHabitNote()  → writes Frontmatter + Template
 * updateHabit() → updateHabitNoteProps() → patches Frontmatter keys only
 * archiveHabit() → moveHabitNote(Active → Archive) + update archived: true
 * restoreHabit() → moveHabitNote(Archive → Active) + update archived: false
 * addComment()  → appendToHabitNoteLog() → appends timestamped entry
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { normalizePath, TFile } from "obsidian";
import { Utils } from "../utils/Utils.js";
import { TRANSLATIONS } from "../constants.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Heading under which logs (voice/text) are injected inside the habit note */
const HABIT_NOTE_LOG_HEADING = "## 📓 سجل التدوينات والصوتيات";

/** Default root folder for all habit notes (overridable in settings) */
const DEFAULT_HABIT_NOTES_FOLDER = "Core Habits";

// ─────────────────────────────────────────────────────────────────────────────
// HabitNoteManager Class
// ─────────────────────────────────────────────────────────────────────────────

export class HabitNoteManager {
  /**
   * @param {import('obsidian').App} app
   * @param {object} plugin - Core Habits plugin instance
   */
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }

  t(key, params = {}) {
    if (this.plugin.translationManager) {
      return this.plugin.translationManager.t(key, params);
    }
    const lang = this.plugin.settings?.language || "en";
    const dict = TRANSLATIONS[lang] || TRANSLATIONS["en"];
    let text = dict[key] || TRANSLATIONS["en"][key] || key;
    Object.keys(params).forEach((param) => {
      text = text.replace(`{${param}}`, params[param]);
    });
    return text;
  }

  // ─── Folder Paths ────────────────────────────────────────────────────────

  /** Returns the configured root folder for habit notes */
  getRootFolder() {
    let folder = this.plugin.settings.habitNotesFolder || DEFAULT_HABIT_NOTES_FOLDER;
    
    // Strip absolute vault path if user provided it
    const adapter = this.app.vault.adapter;
    if (adapter) {
      const basePath = typeof adapter.getBasePath === 'function' 
        ? adapter.getBasePath() 
        : adapter.basePath;
      if (basePath) {
        // Standardize slashes for comparison
        const normalizedFolder = folder.replace(/\\/g, "/");
        const normalizedBasePath = basePath.replace(/\\/g, "/");
        if (normalizedFolder.startsWith(normalizedBasePath)) {
          folder = normalizedFolder.substring(normalizedBasePath.length);
        }
      }
    }
    
    // Clean up leading/trailing slashes and backslashes
    return folder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  }

  /** Returns the full path to Active/ subfolder */
  getActiveFolder() {
    return normalizePath(`${this.getRootFolder()}/Active`);
  }

  /** Returns the full path to Archive/ subfolder */
  getArchiveFolder() {
    return normalizePath(`${this.getRootFolder()}/Archive`);
  }

  /** Returns the full path for a habit note file (active or archive based on flag) */
  getHabitFilePath(habitName, archived = false) {
    const folder = archived ? this.getArchiveFolder() : this.getActiveFolder();
    const safeName = habitName.replace(/[\\/:*?"<>|]/g, "-");
    return normalizePath(`${folder}/${safeName}.md`);
  }

  validatePathSafety(filePath) {
    const activeFolder = this.getActiveFolder();
    const archiveFolder = this.getArchiveFolder();

    if (Utils.isPathTraversal(filePath) || Utils.isPathTraversal(activeFolder) || Utils.isPathTraversal(archiveFolder)) {
      throw new Error(`Path security violation: path traversal attempt detected.`);
    }

    const insideActive = Utils.isPathInsideFolder(filePath, activeFolder);
    const insideArchive = Utils.isPathInsideFolder(filePath, archiveFolder);

    if (!insideActive && !insideArchive) {
      throw new Error(`Path security violation: target path "${filePath}" is outside permitted directories.`);
    }
  }

  // ─── Folder Initialization ───────────────────────────────────────────────

  /**
   * Ensures that Root/, Active/, and Archive/ folders all exist.
   * Safe to call multiple times (idempotent).
   */
  async ensureFolders() {
    const folders = [
      this.getRootFolder(),
      this.getActiveFolder(),
      this.getArchiveFolder(),
    ];

    for (const folder of folders) {
      const exists = this.app.vault.getAbstractFileByPath(folder);
      if (!exists) {
        try {
          await this.app.vault.createFolder(folder);
        } catch (e) {
          // Folder may have been created by a concurrent call — ignore
          if (!e.message?.includes("already exists")) {
            console.error(`[Core Habits] Failed to create folder "${folder}":`, e);
          }
        }
      }
    }
  }

  // ─── Frontmatter Helpers ─────────────────────────────────────────────────

  /**
   * Builds YAML frontmatter string from a habit object.
   * @param {object} habit
   * @returns {string} YAML block including opening/closing ---
   */
  buildFrontmatter(habit) {
    const props = this._habitToProps(habit);
    const lines = [
      "---",
      `schema_version: ${props.schema_version}`,
      `habit_id: ${props.habit_id}`,
      `habit_type: ${props.habit_type}`,
      `color: ${props.color}`,
      `schedule: ${props.schedule}`,
      `days: ${props.days}`,
      `current_level: ${props.current_level}`,
      `archived: ${props.archived}`,
      `deleted: ${props.deleted}`,
      `archived_at: "${props.archived_at}"`,
      `restored_at: "${props.restored_at}"`,
      `saved_longest_streak: ${props.saved_longest_streak}`,
      `created_at: "${props.created_at}"`,
      `parent_id: "${props.parent_id}"`,
      `order: ${props.order}`,
      `name_history: "${props.name_history.replace(/"/g, '\\"')}"`,
      `identity: "${props.identity.replace(/"/g, '\\"')}"`,
      `cue: "${props.cue.replace(/"/g, '\\"')}"`,
      `friction: "${props.friction.replace(/"/g, '\\"')}"`,
      `reward: "${props.reward.replace(/"/g, '\\"')}"`,
      `notes: "${props.notes.replace(/"/g, '\\"')}"`
    ];

    if (habit.levelData) {
      habit.levelData.forEach((l, i) => {
        lines.push(`level_${i+1}_goal: "${(l.goal || "").replace(/"/g, '\\"')}"`);
        lines.push(`level_${i+1}_condition: "${(l.condition || "").replace(/"/g, '\\"')}"`);
        lines.push(`level_${i+1}_achieved: ${l.achieved ? "true" : "false"}`);
      });
    }

    lines.push(`goal: ""`);
    lines.push("---");

    return lines.join("\n");
  }

  /**
   * Reads the raw Frontmatter from a habit note file.
   * @param {string} filePath
   * @returns {Promise<object|null>} Parsed properties or null if file missing
   */
  async readHabitNoteProps(filePath) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return null;

    const metadata = this.app.metadataCache.getFileCache(file);
    return metadata?.frontmatter || null;
  }

  /**
   * Updates specific Frontmatter keys in a habit note without touching the body.
   * Uses vault.process() for atomic read-modify-write.
   * @param {string} filePath
   * @param {object} propsToUpdate - Key-value pairs to update (only these keys change)
   */
  async updateHabitNoteProps(filePath, propsToUpdate) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      for (const [key, value] of Object.entries(propsToUpdate)) {
        if (key === "days") {
          if (typeof value === "string") {
            try {
              frontmatter[key] = JSON.parse(value);
            } catch {
              frontmatter[key] = value;
            }
          } else {
            frontmatter[key] = value;
          }
        } else if (value === "true" || value === true) {
          frontmatter[key] = true;
        } else if (value === "false" || value === false) {
          frontmatter[key] = false;
        } else if (value === null || value === undefined) {
          frontmatter[key] = "";
        } else if (typeof value === "string" && !isNaN(value) && value.trim() !== "") {
          if (key === "current_level" || key === "order") {
            frontmatter[key] = parseInt(value, 10);
          } else {
            frontmatter[key] = value;
          }
        } else {
          frontmatter[key] = value;
        }
      }
    });
  }

  /**
   * Extracts manual notes from the note body under the notes blockquote section.
   * @param {string} content
   * @returns {string}
   */
  extractNotesFromBody(content) {
    const markerAr = TRANSLATIONS.ar.habit_notes_free_space_marker;
    const markerEn = TRANSLATIONS.en.habit_notes_free_space_marker;
    let idx = content.indexOf(markerAr);
    let marker = markerAr;
    if (idx === -1) {
      idx = content.indexOf(markerEn);
      marker = markerEn;
    }
    if (idx === -1) return "";

    const after = content.substring(idx + marker.length);
    // Find next boundary: horizontal rule '---' or log heading
    const boundaryMatch = after.match(/\r?\n\r?\n---|## /);
    let notesContent = boundaryMatch ? after.substring(0, boundaryMatch.index) : after;

    // Clean up blockquote markers '>' and whitespace line by line
    notesContent = notesContent
      .split(/\r?\n/)
      .map(line => line.replace(/^\s*>\s?/, "")) // remove leading '>'
      .join("\n")
      .trim();

    // Check placeholders
    const placeholders = [
      TRANSLATIONS.ar.habit_notes_placeholder.replace(/^>\s*/, ""),
      TRANSLATIONS.en.habit_notes_placeholder.replace(/^>\s*/, "")
    ];
    if (placeholders.includes(notesContent)) return "";

    return notesContent;
  }

  /**
   * Formats notes text as blockquote markdown lines.
   * @param {string} notes
   * @returns {string}
   */
  formatNotesAsBlockquote(notes) {
    const heading = this.t("habit_notes_free_space_marker");
    const body = notes
      ? notes.split("\n").map(line => `> ${line}`).join("\n")
      : this.t("habit_notes_placeholder");
    return `${heading}\n${body}\n\n`;
  }

  // ─── Template Builder ─────────────────────────────────────────────────────

  /**
   * Builds the full note body (template) for a habit.
   * The template guides users to deepen their understanding of the habit.
   * @param {object} habit
   * @returns {string} Markdown body content (without frontmatter)
   */
  buildHabitTemplate(habit) {
    const t = (k) => this.t(k);
    const ad = habit.atomicDescription || {};

    let engineeringSection = "";

    if (ad.identity || ad.cue || ad.friction || ad.reward) {
      engineeringSection = `${t("habit_template_engineering_title")}\n` +
        (ad.identity ? `${t("habit_template_identity_prefix")} ${ad.identity}\n` : "") +
        (ad.cue ? `${t("habit_template_cue_prefix")} ${ad.cue}\n` : "") +
        (ad.friction ? `${t("habit_template_friction_prefix")} ${ad.friction}\n` : "") +
        (ad.reward ? `${t("habit_template_reward_prefix")} ${ad.reward}\n` : "") +
        "\n";
    }

    const notesBlock = this.formatNotesAsBlockquote(habit.notes);
    const appendComment = t("habit_template_append_marker_comment");

    return `\`\`\`core-habits\n\`\`\`\n\n${engineeringSection}${notesBlock}---\n\n${HABIT_NOTE_LOG_HEADING}\n\n${appendComment}\n`;
  }

  // ─── CRUD Operations ──────────────────────────────────────────────────────

  /**
   * Creates a new habit note file with Frontmatter + Template.
   * Called automatically by HabitManager.addHabit().
   * @param {object} habit - The newly created habit object
   * @returns {Promise<TFile|null>} The created file or null on failure
   */
  async createHabitNote(habit) {
    try {
      await this.ensureFolders();
      const filePath = this.getHabitFilePath(habit.name, false);
      this.validatePathSafety(filePath);

      // Check if file already exists — don't overwrite
      const existing = this.app.vault.getAbstractFileByPath(filePath);
      if (existing) {
        // File already exists (e.g. from a previous add). Update Frontmatter only.
        await this.updateHabitNoteProps(filePath, this._habitToProps(habit));
        return existing;
      }

      const frontmatter = this.buildFrontmatter(habit);
      const template = this.buildHabitTemplate(habit);
      const fullContent = `${frontmatter}\n${template}`;

      const file = await this.app.vault.create(filePath, fullContent);
      return file;
    } catch (e) {
      console.error(`[Core Habits] Failed to create habit note for "${habit.name}":`, e);
      return null;
    }
  }

  /**
   * Updates the Frontmatter of a habit note to reflect changed properties.
   * @param {object} habit - The updated habit object
   */
  async updateHabitNote(habit) {
    let file = this._resolveHabitFile(habit);

    if (!file) {
      // Note doesn't exist yet — create it
      await this.createHabitNote(habit);
      return;
    }

    // إذا تغيّر الاسم → أعد تسمية الملف أولاً
    const expectedName = habit.name.replace(/[\\/:*?"<>|]/g, "-");
    if (file.basename !== expectedName) {
      const newPath = this.getHabitFilePath(habit.name, habit.archived || false);
      this.validatePathSafety(newPath);

      const existingFile = this.app.vault.getAbstractFileByPath(newPath);
      if (existingFile && existingFile !== file) {
        throw new Error(this.t("error_file_exists", { path: newPath }));
      }

      await this.ensureFolders();
      await this.app.fileManager.renameFile(file, newPath);
      file = this.app.vault.getAbstractFileByPath(newPath); // أعد ربط المرجع
      if (!file) {
        throw new Error(`Failed to resolve renamed habit file at: ${newPath}`);
      }
    }

    await this.app.vault.process(file, (content) => {
      let body = content;
      // Split frontmatter and body
      const fmEnd = content.indexOf("\n---", 3);
      if (content.startsWith("---") && fmEnd !== -1) {
        body = content.substring(fmEnd + 4);
      }

      const t = (k) => this.t(k);

      const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const markerArEsc = escapeRegex(TRANSLATIONS.ar.habit_notes_free_space_marker);
      const markerEnEsc = escapeRegex(TRANSLATIONS.en.habit_notes_free_space_marker);
      const notesRegex = new RegExp(`(?:${markerArEsc}|${markerEnEsc})(?:\\r?\\n>.*)*`, "gi");

      const newNotesBlock = this.formatNotesAsBlockquote(habit.notes).trim();
      
      if (body.match(notesRegex)) {
        body = body.replace(notesRegex, newNotesBlock);
      } else {
        // If not found, we can append it before the log section
        const logHeading = HABIT_NOTE_LOG_HEADING;
        const logIdx = body.indexOf(logHeading);
        if (logIdx !== -1) {
          body = body.substring(0, logIdx) + newNotesBlock + "\n\n" + body.substring(logIdx);
        } else {
          body = body.trimEnd() + "\n\n" + newNotesBlock;
        }
      }

      // Surgical replacement for engineering blockquote in the body
      const engArEsc = escapeRegex(TRANSLATIONS.ar.habit_template_engineering_title);
      const engEnEsc = escapeRegex(TRANSLATIONS.en.habit_template_engineering_title);
      const engineeringRegex = new RegExp(`(?:${engArEsc}|${engEnEsc})(?:\\r?\\n>.*)*`, "gi");
      const ad = habit.atomicDescription || {};
      let newEngineeringBlock = "";
      if (ad.identity || ad.cue || ad.friction || ad.reward) {
        newEngineeringBlock = `${t("habit_template_engineering_title")}\n` +
          (ad.identity ? `${t("habit_template_identity_prefix")} ${ad.identity}\n` : "") +
          (ad.cue ? `${t("habit_template_cue_prefix")} ${ad.cue}\n` : "") +
          (ad.friction ? `${t("habit_template_friction_prefix")} ${ad.friction}\n` : "") +
          (ad.reward ? `${t("habit_template_reward_prefix")} ${ad.reward}\n` : "");
        newEngineeringBlock = newEngineeringBlock.trim();
      }

      if (newEngineeringBlock) {
        if (body.match(engineeringRegex)) {
          body = body.replace(engineeringRegex, newEngineeringBlock);
        } else {
          // Insert it before notes block
          const notesMatch = body.match(notesRegex);
          if (notesMatch) {
            const notesIdx = body.indexOf(notesMatch[0]);
            body = body.substring(0, notesIdx) + newEngineeringBlock + "\n\n" + body.substring(notesIdx);
          } else {
            const logHeading = HABIT_NOTE_LOG_HEADING;
            const logIdx = body.indexOf(logHeading);
            if (logIdx !== -1) {
              body = body.substring(0, logIdx) + newEngineeringBlock + "\n\n" + body.substring(logIdx);
            } else {
              body = body.trimEnd() + "\n\n" + newEngineeringBlock;
            }
          }
        }
      } else {
        body = body.replace(engineeringRegex, "").trim();
      }

      // Rebuild properties with updated values
      const newFrontmatter = this.buildFrontmatter(habit);
      return `${newFrontmatter}\n${body.trim()}`;
    });
  }

  /**
   * Moves a habit note from Active/ to Archive/ and updates its frontmatter.
   * @param {object} habit - The habit being archived
   */
  async archiveHabitNote(habit) {
    await this._moveHabitNote(habit, false, true);
  }

  /**
   * Moves a habit note from Archive/ to Active/ and updates its frontmatter.
   * @param {object} habit - The habit being restored
   */
  async restoreHabitNote(habit) {
    await this._moveHabitNote(habit, true, false);
  }


  /**
   * Extracts habits from the vault that were detected as moved to Archive/ manually.
   * Called from handleVaultRename to detect manual folder moves.
   * @param {string} newPath - New file path after rename/move
   * @param {string} oldPath - Old file path before rename/move
   * @returns {'archived'|'restored'|null}
   */
  detectManualMove(newPath, oldPath) {
    const archiveFolder = this.getArchiveFolder().toLowerCase();
    const activeFolder = this.getActiveFolder().toLowerCase();

    const wasInActive = oldPath.toLowerCase().startsWith(activeFolder);
    const wasInArchive = oldPath.toLowerCase().startsWith(archiveFolder);
    const nowInArchive = newPath.toLowerCase().startsWith(archiveFolder);
    const nowInActive = newPath.toLowerCase().startsWith(activeFolder);

    if (wasInActive && nowInArchive) return "archived";
    if (wasInArchive && nowInActive) return "restored";
    return null;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Resolves a habit file by checking Active/ then Archive/ paths.
   * Falls back to metadata cache scan by habit_id.
   */
  _resolveHabitFile(habit) {
    // 1. الاسم الحالي — Active ثم Archive
    const names = [habit.name];
    
    // 2. الأسماء التاريخية
    for (const oldLink of (habit.nameHistory || [])) {
      names.push(oldLink.replace(/\[\[|\]\]/g, ""));
    }
    
    // 3. جرّب كل اسم في كلا المجلدين
    for (const name of names) {
      for (const archived of [false, true]) {
        const path = this.getHabitFilePath(name, archived);
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file) return file;
      }
    }
    
    // 4. الملاذ الأخير: بحث بالـ habit_id
    return this._findFileByHabitId(habit.id);
  }

  /**
   * Searches all markdown files in the habit notes folder for a matching habit_id.
   */
  _findFileByHabitId(habitId) {
    if (!habitId) return null;
    const root = this.getRootFolder().toLowerCase();
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      if (!file.path.toLowerCase().startsWith(root)) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.frontmatter?.habit_id === habitId) return file;
    }
    return null;
  }

  /**
   * Converts a habit object to a flat props map for frontmatter writing.
   */
  _habitToProps(habit) {
    const daysArr = habit.schedule?.days || [0, 1, 2, 3, 4, 5, 6];
    const scheduleStr = habit.schedule?.type === "daily" ? "daily" : daysArr.join(",");

    const formatDate = (ts) => {
      if (!ts) return "";
      return window.moment(ts).locale("en").format("YYYY-MM-DD");
    };

    const ad = habit.atomicDescription || {};
    const props = {
      schema_version: habit.schemaVersion || 1,
      habit_id: habit.id || "",
      habit_type: habit.habitType || "build",
      color: habit.color || "teal",
      schedule: scheduleStr,
      days: `[${daysArr.join(", ")}]`,
      current_level: habit.currentLevel || 1,
      archived: habit.archived ? "true" : "false",
      deleted: habit.deleted ? "true" : "false",
      archived_at: formatDate(habit.archivedDate),
      restored_at: formatDate(habit.restoredDate),
      saved_longest_streak: habit.savedLongestStreak || 0,
      parent_id: habit.parentId || "",
      created_at: formatDate(habit.createdAt),
      order: habit.order || 0,
      name_history: habit.nameHistory ? habit.nameHistory.join("|||") : "",
      identity: ad.identity || "",
      cue: ad.cue || "",
      friction: ad.friction || "",
      reward: ad.reward || "",
      notes: habit.notes || "",
    };

    if (habit.levelData) {
      habit.levelData.forEach((l, i) => {
        props[`level_${i+1}_goal`] = l.goal || "";
        props[`level_${i+1}_condition`] = l.condition || "";
        props[`level_${i+1}_achieved`] = l.achieved ? "true" : "false";
      });
    }

    return props;
  }

  /**
   * Converts a frontmatter props object back into a Habit object.
   * @param {TFile} file 
   * @param {object} props 
   */
  propsToHabit(file, props, content = null) {
    if (!props) return null;
    
    let bodyNotes = "";
    if (content) {
      bodyNotes = this.extractNotesFromBody(content);
    }
    const notesValue = bodyNotes || props.notes || "";

    const parseDate = (val) => {
      if (!val) return null;
      if (typeof val === 'number') return val;
      const m = window.moment(val);
      return m.isValid() ? m.valueOf() : null;
    };

    let parsedCreated = file.stat.ctime;
    if (props.created_at) {
      parsedCreated = parseDate(props.created_at) || file.stat.ctime;
    }

    const habit = {
      schemaVersion: parseInt(props.schema_version, 10) || 1,
      id: String(props.habit_id) || "",
      name: file.basename,
      linkText: `[[${file.basename}]]`,
      habitType: props.habit_type === "break" ? "break" : "build",
      color: props.color || "teal",
      schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] },
      currentLevel: parseInt(props.current_level, 10) || 1,
      archived: String(props.archived) === "true",
      deleted: String(props.deleted) === "true",
      parentId: props.parent_id || null,
      createdAt: parsedCreated,
      order: parseInt(props.order, 10) || 0,
      nameHistory: props.name_history ? String(props.name_history).split("|||").filter(Boolean) : [],
      atomicDescription: {
        identity: props.identity || "",
        cue: props.cue || "",
        friction: props.friction || "",
        reward: props.reward || ""
      },
      notes: notesValue,
      levelData: [],
      archivedDate: parseDate(props.archived_at),
      restoredDate: parseDate(props.restored_at),
      savedLongestStreak: parseInt(props.saved_longest_streak, 10) || 0
    };

    // Parse schedule
    if (props.schedule === "daily") {
      habit.schedule = { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] };
    } else if (props.schedule) {
      const days = String(props.schedule).split(",").map(d => parseInt(d.trim(), 10)).filter(d => !isNaN(d));
      habit.schedule = { type: "weekly", days: days.length ? days : [0, 1, 2, 3, 4, 5, 6] };
    }

    // Parse levels dynamically based on keys present
    const levelKeys = Object.keys(props).filter(k => k.startsWith("level_") && k.endsWith("_goal"));
    let levelsCount = levelKeys.length;
    
    if (levelsCount > 0) {
      // Find the max level number
      levelsCount = Math.max(...levelKeys.map(k => parseInt(k.split("_")[1], 10)).filter(n => !isNaN(n)));
      for (let i = 1; i <= levelsCount; i++) {
        habit.levelData.push({
          goal: String(props[`level_${i}_goal`] || ""),
          condition: String(props[`level_${i}_condition`] || ""),
          achieved: String(props[`level_${i}_achieved`]) === "true"
        });
      }
    } else {
      habit.levelData = [
        { goal: "", condition: "", achieved: false },
        { goal: "", condition: "", achieved: false },
        { goal: "", condition: "", achieved: false },
        { goal: "", condition: "", achieved: false },
        { goal: "", condition: "", achieved: false }
      ];
    }

    return habit;
  }

  /**
   * Moves a habit note file between Active/ and Archive/ folders.
   * @param {object} habit
   * @param {boolean} fromArchived - true if current location is Archive/
   * @param {boolean} toArchived - true if destination is Archive/
   */
  async _moveHabitNote(habit, fromArchived, toArchived) {
    try {
      const sourcePath = this.getHabitFilePath(habit.name, fromArchived);
      const destPath = this.getHabitFilePath(habit.name, toArchived);

      let file = this.app.vault.getAbstractFileByPath(sourcePath);

      // Fallback: find by id if name-based lookup fails
      if (!file) file = this._findFileByHabitId(habit.id);
      if (!file) {
        // File doesn't exist at all — create it in correct location
        await this.createHabitNote({ ...habit, archived: toArchived });
        return;
      }

      if (file.path === destPath) {
        // Already in correct location — just update props
        await this.updateHabitNoteProps(file.path, this._habitToProps(habit));
        return;
      }

      await this.ensureFolders();

      // Use Obsidian's rename which also updates all backlinks
      await this.app.fileManager.renameFile(file, destPath);

      // Update the archived flag in frontmatter
      await this.updateHabitNoteProps(destPath, this._habitToProps(habit));
    } catch (e) {
      console.error(`[Core Habits] Failed to move habit note for "${habit.name}":`, e);
      throw e;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
export { HABIT_NOTE_LOG_HEADING, DEFAULT_HABIT_NOTES_FOLDER };
