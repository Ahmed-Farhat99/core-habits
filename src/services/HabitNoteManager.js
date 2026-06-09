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

  // ─── Folder Paths ────────────────────────────────────────────────────────

  /** Returns the configured root folder for habit notes */
  getRootFolder() {
    return this.plugin.settings.habitNotesFolder || DEFAULT_HABIT_NOTES_FOLDER;
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
    const isAr = this.plugin.settings.language === "ar";
    const scheduleStr = habit.schedule?.type === "daily"
      ? "daily"
      : (habit.schedule?.days || []).join(",");

    // Format days array as YAML list
    const daysArr = habit.schedule?.days || [0, 1, 2, 3, 4, 5, 6];
    const daysYaml = `[${daysArr.join(", ")}]`;

    const createdAt = habit.createdAt
      ? window.moment(habit.createdAt).format("YYYY-MM-DD")
      : window.moment().format("YYYY-MM-DD");

    const ad = habit.atomicDescription || {};
    const identity = ad.identity ? `"${ad.identity.replace(/"/g, '\\"')}"` : '""';
    const cue = ad.cue ? `"${ad.cue.replace(/"/g, '\\"')}"` : '""';
    const friction = ad.friction ? `"${ad.friction.replace(/"/g, '\\"')}"` : '""';
    const reward = ad.reward ? `"${ad.reward.replace(/"/g, '\\"')}"` : '""';

    const lines = [
      "---",
      `habit_id: ${habit.id || ""}`,
      `habit_type: ${habit.habitType || "build"}`,
      `color: ${habit.color || "teal"}`,
      `schedule: ${scheduleStr}`,
      `days: ${daysYaml}`,
      `current_level: ${habit.currentLevel || 1}`,
      `archived: ${habit.archived ? "true" : "false"}`,
      `created_at: "${createdAt}"`,
      `parent_id: "${habit.parentId || ""}"`,
      `identity: ${identity}`,
      `cue: ${cue}`,
      `friction: ${friction}`,
      `reward: ${reward}`,
      `notes: "${(habit.notes || "").replace(/"/g, '\\"')}"`,
      ...(habit.levelData ? habit.levelData.map((l, i) => [
        `level_${i+1}_goal: "${(l.goal || "").replace(/"/g, '\\"')}"`,
        `level_${i+1}_condition: "${(l.condition || "").replace(/"/g, '\\"')}"`,
        `level_${i+1}_achieved: ${l.achieved ? "true" : "false"}`,
      ]).flat() : []),
      `goal: ""`,
      "---",
    ];

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

    await this.app.vault.process(file, (content) => {
      // Match existing YAML frontmatter block
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch) return content; // No frontmatter found — leave untouched

      let fmBlock = fmMatch[1];

      // Update each key
      for (const [key, value] of Object.entries(propsToUpdate)) {
        const formattedValue = typeof value === "boolean"
          ? String(value)
          : typeof value === "string" && value.includes("\n")
            ? `"${value.replace(/"/g, '\\"')}"`
            : String(value ?? "");

        const keyRegex = new RegExp(`^(${key}:\\s*).*$`, "m");
        if (keyRegex.test(fmBlock)) {
          fmBlock = fmBlock.replace(keyRegex, `$1${formattedValue}`);
        } else {
          // Key doesn't exist yet — append it before the end
          fmBlock = fmBlock.trimEnd() + `\n${key}: ${formattedValue}`;
        }
      }

      const afterFm = content.substring(fmMatch[0].length);
      return `---\n${fmBlock}\n---${afterFm}`;
    });
  }

  // ─── Template Builder ─────────────────────────────────────────────────────

  /**
   * Builds the full note body (template) for a habit.
   * The template guides users to deepen their understanding of the habit.
   * @param {object} habit
   * @returns {string} Markdown body content (without frontmatter)
   */
  buildHabitTemplate(habit) {
    const isAr = this.plugin.settings.language === "ar";
    const ad = habit.atomicDescription || {};

    let engineeringSectionAr = "";
    let engineeringSectionEn = "";

    if (ad.identity || ad.cue || ad.friction || ad.reward) {
      engineeringSectionAr = `> [!info] 🧠 هندسة العادة\n${ad.identity ? `> **الهوية التي أريدها:** ${ad.identity}\n` : ""}${ad.cue ? `> **المحفز (الوقت/المكان):** ${ad.cue}\n` : ""}${ad.friction ? `> **تقليل الاحتكاك:** ${ad.friction}\n` : ""}${ad.reward ? `> **المكافأة:** ${ad.reward}\n` : ""}\n`;
      engineeringSectionEn = `> [!info] 🧠 Habit Engineering\n${ad.identity ? `> **Desired Identity:** ${ad.identity}\n` : ""}${ad.cue ? `> **Cue (Time/Location):** ${ad.cue}\n` : ""}${ad.friction ? `> **Reduce Friction:** ${ad.friction}\n` : ""}${ad.reward ? `> **Reward:** ${ad.reward}\n` : ""}\n`;
    }

    if (isAr) {
      return `\`\`\`core-habits\n\`\`\`\n\n${engineeringSectionAr}\n> **مساحة حرة للتدوين:**\n> (اكتب هنا دوافعك العميقة أو أفكارك عن بناء هذه العادة...)\n\n---\n\n${HABIT_NOTE_LOG_HEADING}\n\n<!-- تُضاف التدوينات والملاحظات الصوتية تلقائياً أدناه بواسطة الإضافة -->\n`;
    } else {
      return `\`\`\`core-habits\n\`\`\`\n\n${engineeringSectionEn}\n> **Free Space for Notes:**\n> (Write your deep motivations or thoughts about this habit here...)\n\n---\n\n${HABIT_NOTE_LOG_HEADING}\n\n<!-- Voice memos and text logs are appended here automatically by the plugin -->\n`;
    }
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
    try {
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
        await this.ensureFolders();
        try {
          await this.app.fileManager.renameFile(file, newPath);
          file = this.app.vault.getAbstractFileByPath(newPath); // أعد ربط المرجع
        } catch (e) {
          console.warn("[Core Habits] Could not rename habit file:", e);
        }
      }

      await this.app.vault.process(file, (content) => {
        // 1. استخرج قسم السجل (LOG) المحفوظ
        const logHeadingIdx = content.indexOf(HABIT_NOTE_LOG_HEADING);
        const logSection = logHeadingIdx !== -1
          ? content.substring(logHeadingIdx)
          : `\n${HABIT_NOTE_LOG_HEADING}\n`;
        
        // 2. أعد بناء الـ frontmatter + القالب
        const newFrontmatter = this.buildFrontmatter(habit);
        const newTemplate = this.buildHabitTemplate(habit);
        
        // 3. أزل قسم السجل من القالب الجديد (لأنه محفوظ أعلاه)
        const logInTemplate = newTemplate.indexOf(HABIT_NOTE_LOG_HEADING);
        const templateBody = logInTemplate !== -1
          ? newTemplate.substring(0, logInTemplate)
          : newTemplate;
        
        // 4. أعد التركيب: frontmatter + body + log
        return `${newFrontmatter}\n${templateBody}${logSection}`;
      });
    } catch (e) {
      console.error(`[Core Habits] Failed to update habit note for "${habit.name}":`, e);
    }
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
   * Appends a timestamped log entry (text or voice memo link) to the habit note.
   * Entries are added under the HABIT_NOTE_LOG_HEADING section.
   * @param {object} habit - The habit to log against
   * @param {string} dateStr - Formatted date string (e.g. "2026-05-18")
   * @param {string} logText - The text content (may include [[voice.webm]] links)
   */
  async appendToHabitNoteLog(habit, dateStr, logText) {
    try {
      // Resolve file path (active or archive)
      let file = this._resolveHabitFile(habit);
      if (!file) {
        // Auto-create the note if missing (recovery path)
        await this.createHabitNote(habit);
        file = this._resolveHabitFile(habit);
      }
      if (!file) return;

      const logEntry = `\n**${dateStr}:** ${logText}`;

      await this.app.vault.process(file, (content) => {
        const headingIdx = content.indexOf(HABIT_NOTE_LOG_HEADING);
        if (headingIdx === -1) {
          // Section missing — append to end
          return content.trimEnd() + `\n\n${HABIT_NOTE_LOG_HEADING}\n${logEntry}\n`;
        }

        // Find insertion point: end of the section (before next ## heading or EOF)
        const afterHeading = content.substring(headingIdx + HABIT_NOTE_LOG_HEADING.length);
        const nextSectionMatch = afterHeading.match(/\n## /);
        const insertOffset = nextSectionMatch
          ? headingIdx + HABIT_NOTE_LOG_HEADING.length + nextSectionMatch.index
          : content.length;

        const before = content.substring(0, insertOffset).trimEnd();
        const after = content.substring(insertOffset).replace(/^\n+/, "");

        return `${before}\n${logEntry}\n\n${after}`;
      });
    } catch (e) {
      console.error(`[Core Habits] Failed to append to habit note log for "${habit.name}":`, e);
    }
  }

  /**
   * Reads log entries from the habit note within an optional date range.
   * This is faster than scanning all Daily Notes when the log exists in the habit file.
   * @param {object} habit
   * @param {object} [options] - { from?: moment, to?: moment }
   * @returns {Promise<Array<{date: moment, text: string}>>}
   */
  async readHabitNoteLog(habit, options = {}) {
    const { from, to } = options;
    const entries = [];

    const file = this._resolveHabitFile(habit);
    if (!file) return entries;

    const content = await this.app.vault.cachedRead(file);
    const headingIdx = content.indexOf(HABIT_NOTE_LOG_HEADING);
    if (headingIdx === -1) return entries;

    const afterHeading = content.substring(headingIdx + HABIT_NOTE_LOG_HEADING.length);
    const nextSectionMatch = afterHeading.match(/\n## /);
    const sectionContent = nextSectionMatch
      ? afterHeading.substring(0, nextSectionMatch.index)
      : afterHeading;

    // Parse entries: **YYYY-MM-DD:** text
    const entryRegex = /\*\*(\d{4}-\d{2}-\d{2})\*\*:\s*(.+)/g;
    let match;
    while ((match = entryRegex.exec(sectionContent)) !== null) {
      const dateMoment = window.moment(match[1], "YYYY-MM-DD");
      if (!dateMoment.isValid()) continue;

      if (from && dateMoment.isBefore(from, "day")) continue;
      if (to && dateMoment.isAfter(to, "day")) continue;

      entries.push({ date: dateMoment, text: match[2].trim() });
    }

    return entries;
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

    const ad = habit.atomicDescription || {};
    const props = {
      habit_id: habit.id || "",
      habit_type: habit.habitType || "build",
      color: habit.color || "teal",
      schedule: scheduleStr,
      days: `[${daysArr.join(", ")}]`,
      current_level: habit.currentLevel || 1,
      archived: habit.archived ? "true" : "false",
      parent_id: habit.parentId || "",
      created_at: habit.createdAt || Date.now(),
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
  propsToHabit(file, props) {
    if (!props) return null;
    
    const habit = {
      id: String(props.habit_id) || "",
      name: file.basename,
      linkText: `[[${file.basename}]]`,
      habitType: props.habit_type === "break" ? "break" : "build",
      color: props.color || "teal",
      schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] },
      currentLevel: parseInt(props.current_level, 10) || 1,
      archived: String(props.archived) === "true",
      parentId: props.parent_id || null,
      createdAt: parseInt(props.created_at, 10) || file.stat.ctime,
      order: parseInt(props.order, 10) || 0,
      nameHistory: props.name_history ? String(props.name_history).split("|||").filter(Boolean) : [],
      atomicDescription: {
        identity: props.identity || "",
        cue: props.cue || "",
        friction: props.friction || "",
        reward: props.reward || ""
      },
      notes: props.notes || "",
      levelData: []
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
        await this.updateHabitNoteProps(file.path, { archived: toArchived });
        return;
      }

      await this.ensureFolders();

      // Use Obsidian's rename which also updates all backlinks
      await this.app.fileManager.renameFile(file, destPath);

      // Update the archived flag in frontmatter
      await this.updateHabitNoteProps(destPath, { archived: toArchived });
    } catch (e) {
      console.error(`[Core Habits] Failed to move habit note for "${habit.name}":`, e);
      throw e;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
export { HABIT_NOTE_LOG_HEADING, DEFAULT_HABIT_NOTES_FOLDER };
