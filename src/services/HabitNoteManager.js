/**
 * HabitNoteManager.js
 * ═══════════════════════════════════════════════════════════════════════════════
 * Manages the "Obsidian-Native" habit file system for Core Habits plugin.
 *
 * ARCHITECTURE:
 * - Every habit has its own Markdown note stored in `{habitNotesFolder}/Active/`
 * - Archived habits are moved to `{habitNotesFolder}/Archive/`
 * - All habit metadata is stored in YAML Frontmatter (Properties) of the note
 * - The note body contains the habit blueprint and user-authored notes section
 * - Comments and reflections are stored in Daily Notes via HabitCommentRepository
 *
 * DATA FLOW:
 * addHabit()     → createHabitNote()   → writes Frontmatter + Blueprint Template
 * updateHabit()  → updateHabitNoteProps() → patches managed Frontmatter keys
 * archiveHabit() → moveHabitNote(Active → Archive) + updates archived: true
 * restoreHabit() → moveHabitNote(Archive → Active) + updates archived: false
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { normalizePath, TFile } from "obsidian";
import { Utils } from "../utils/Utils.js";
import { TRANSLATIONS } from "../constants.js";
import { HabitEntity } from "../domain/HabitEntity.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

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
    this._habitIdToPath = new Map();
    this._pathToHabitId = new Map();
    this._indexInitialized = false;
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
    let folder = (this.plugin.settings?.habitNotesFolder || "").trim();
    if (!folder) {
      folder = DEFAULT_HABIT_NOTES_FOLDER;
    }
    
    // Gracefully strip absolute vault path if provided on desktop
    const adapter = this.app?.vault?.adapter;
    if (adapter) {
      const basePath = typeof adapter.getBasePath === 'function' 
        ? adapter.getBasePath() 
        : adapter.basePath;
      if (basePath) {
        const normFolder = normalizePath(folder);
        const normBase = normalizePath(basePath);
        if (normFolder.startsWith(normBase)) {
          folder = normFolder.substring(normBase.length);
        }
      }
    }
    
    return normalizePath(folder).replace(/^\/+|\/+$/g, "");
  }

  /** Moves the configured habit folder and commits the setting as one recoverable operation. */
  async moveRootFolder(requestedRoot) {
    const move = () => this._moveRootFolder(requestedRoot);
    const oldRoot = this.getRootFolder();
    const rawRoot = (requestedRoot || DEFAULT_HABIT_NOTES_FOLDER).trim();
    const newRoot = normalizePath(rawRoot).replace(/^\/+|\/+$/g, "");
    return typeof this.plugin.runWithLock === "function"
      ? this.plugin.runWithLock(move, [oldRoot, newRoot])
      : move();
  }

  async _moveRootFolder(requestedRoot) {
    const oldRoot = this.getRootFolder();
    const rawRoot = (requestedRoot || DEFAULT_HABIT_NOTES_FOLDER).trim();
    if (rawRoot.replace(/\\/gu, "/").split("/").includes("..")
      || rawRoot.startsWith("/") || rawRoot.startsWith("\\") || /^[a-zA-Z]:[\\/]/u.test(rawRoot)) {
      throw new Error("Habit folder must be a relative vault path without parent traversal");
    }
    const newRoot = normalizePath(rawRoot).replace(/^\/+|\/+$/g, "");
    if (!newRoot || Utils.isPathTraversal(newRoot)) throw new Error("Invalid habit folder path");
    if (newRoot === oldRoot) return false;
    if (newRoot.startsWith(`${oldRoot}/`) || oldRoot.startsWith(`${newRoot}/`)) {
      throw new Error("Habit folder cannot be moved inside itself or to a parent folder");
    }
    if (this.app.vault.getAbstractFileByPath(newRoot)) {
      throw new Error(`Habit folder destination already exists: ${newRoot}`);
    }

    const oldSetting = this.plugin.settings.habitNotesFolder;
    const oldFolder = this.app.vault.getAbstractFileByPath(oldRoot);
    if (oldFolder) await this.app.fileManager.renameFile(oldFolder, newRoot);
    this.plugin.settings.habitNotesFolder = newRoot;
    this.invalidateIndex();
    try {
      if (!oldFolder) await this.ensureFolders();
      await this.plugin.saveSettings({ silent: true });
    } catch (error) {
      this.plugin.settings.habitNotesFolder = oldSetting;
      this.invalidateIndex();
      if (oldFolder) {
        try { await this.app.fileManager.renameFile(oldFolder, oldRoot); }
        catch (rollbackError) { throw new AggregateError([error, rollbackError], "Habit folder move rollback failed", { cause: rollbackError }); }
      }
      throw error;
    }
    return true;
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
            throw e;
          }
        }
      }
    }
  }

  // ─── Frontmatter Helpers ─────────────────────────────────────────────────



  /**
   * Reads the raw Frontmatter from a habit note file.
   * Uses metadataCache for O(1) performance when available, with a resilient
   * direct file parser fallback for cold start / mobile indexing scenarios.
   * @param {string} filePath
   * @returns {Promise<object|null>} Parsed properties or null if file missing
   */
  async readHabitNoteProps(filePath) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return null;

    const metadata = this.app.metadataCache?.getFileCache?.(file);
    if (metadata?.frontmatter) {
      return metadata.frontmatter;
    }

    // Safe fallback from file content when metadataCache is not yet ready (e.g. mobile startup)
    try {
      const content = typeof this.app.vault.cachedRead === "function"
        ? await this.app.vault.cachedRead(file)
        : await this.app.vault.read(file);
      const parsed = HabitNoteManager.parseFrontmatterFromContent(content);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch (err) {
      console.warn(`[Core Habits] Failed to fallback-read habit note frontmatter for "${filePath}":`, err);
    }

    return null;
  }

  /**
   * Parses YAML frontmatter directly from file content without metadataCache dependency.
   * Safe for cold starts and environments where metadataCache hasn't indexed yet.
   * @param {string} content
   * @returns {object|null}
   */
  static parseFrontmatterFromContent(content) {
    if (!content || typeof content !== "string") return null;
    const clean = content.replace(/^\uFEFF/, "").trimStart();
    if (!clean.startsWith("---")) return null;

    const endIdx = clean.indexOf("\n---", 3);
    if (endIdx === -1) return null;

    const fmText = clean.slice(3, endIdx).trim();
    if (!fmText) return {};

    // 1. Try Obsidian native YAML parser if available in runtime
    if (typeof window !== "undefined" && typeof window.parseYaml === "function") {
      try {
        const parsed = window.parseYaml(fmText);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        // Fall back to custom parser below
      }
    }

    // 2. Resilient fallback parser
    const result = {};
    const lines = fmText.split(/\r?\n/);
    let currentKey = null;
    let inList = false;

    for (let rawLine of lines) {
      const commentIdx = rawLine.indexOf("#");
      let line = rawLine;
      if (commentIdx !== -1) {
        const beforeHash = rawLine.slice(0, commentIdx);
        const singleQuotes = (beforeHash.match(/'/g) || []).length;
        const doubleQuotes = (beforeHash.match(/"/g) || []).length;
        if (singleQuotes % 2 === 0 && doubleQuotes % 2 === 0) {
          line = beforeHash;
        }
      }

      const trimmed = line.trim();
      if (!trimmed) continue;

      if (inList && currentKey && trimmed.startsWith("-")) {
        let itemVal = trimmed.replace(/^-\s*/, "").trim();
        if ((itemVal.startsWith('"') && itemVal.endsWith('"')) || (itemVal.startsWith("'") && itemVal.endsWith("'"))) {
          itemVal = itemVal.slice(1, -1);
        } else if (!isNaN(itemVal) && itemVal !== "") {
          itemVal = Number(itemVal);
        } else if (itemVal.toLowerCase() === "true") {
          itemVal = true;
        } else if (itemVal.toLowerCase() === "false") {
          itemVal = false;
        }
        if (Array.isArray(result[currentKey])) {
          result[currentKey].push(itemVal);
        }
        continue;
      }

      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) {
        inList = false;
        continue;
      }

      const key = line.slice(0, colonIdx).trim();
      if (!key) continue;

      let rawVal = line.slice(colonIdx + 1).trim();

      if (!rawVal) {
        currentKey = key;
        inList = true;
        result[key] = [];
        continue;
      }

      inList = false;
      currentKey = key;

      if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
        const inner = rawVal.slice(1, -1).trim();
        if (!inner) {
          result[key] = [];
        } else {
          result[key] = inner.split(",").map((s) => {
            let item = s.trim();
            if ((item.startsWith('"') && item.endsWith('"')) || (item.startsWith("'") && item.endsWith("'"))) {
              return item.slice(1, -1);
            }
            if (!isNaN(item) && item !== "") return Number(item);
            if (item.toLowerCase() === "true") return true;
            if (item.toLowerCase() === "false") return false;
            return item;
          });
        }
        continue;
      }

      if ((rawVal.startsWith('"') && rawVal.endsWith('"')) || (rawVal.startsWith("'") && rawVal.endsWith("'"))) {
        result[key] = rawVal.slice(1, -1);
        continue;
      }

      if (rawVal.toLowerCase() === "true") {
        result[key] = true;
        continue;
      }
      if (rawVal.toLowerCase() === "false") {
        result[key] = false;
        continue;
      }

      if (rawVal.toLowerCase() === "null" || rawVal === "~") {
        result[key] = null;
        continue;
      }

      if (!isNaN(rawVal) && rawVal !== "") {
        result[key] = Number(rawVal);
        continue;
      }

      result[key] = rawVal;
    }

    for (const [k, v] of Object.entries(result)) {
      if (Array.isArray(v) && v.length === 0 && !["name_history", "days"].includes(k)) {
        result[k] = "";
      }
    }

    return result;
  }

  /**
   * Updates specific Frontmatter keys in a habit note without touching the body.
   * Uses app.fileManager.processFrontMatter() for safe native YAML read-modify-write.
   * Preserves custom frontmatter. Full writes clear only omitted optional habit keys.
   * @param {string} filePath
   * @param {object} propsToUpdate - Key-value pairs to update
   * @param {{full?: boolean}} options - Full managed-field update or narrow patch
   */
  async updateHabitNoteProps(filePath, propsToUpdate, { full = false } = {}) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) throw new Error(`Habit note not found: ${filePath}`);
    if (!this.app.fileManager?.processFrontMatter) throw new Error("Obsidian frontmatter writer is unavailable");

    // Only keys explicitly included in the patch belong to this write.
    const OPTIONAL_HABIT_KEYS = [
      "parent_id", "identity", "cue", "friction", "reward", "notes",
      "archived_at", "restored_at", "saved_longest_streak",
      "level_1_goal", "level_2_goal", "level_3_goal", "level_4_goal", "level_5_goal",
      "deleted", "name_history"
    ];

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (full) {
        for (const key of OPTIONAL_HABIT_KEYS) {
          if (!(key in propsToUpdate)) delete frontmatter[key];
        }
      }
      if (propsToUpdate.schema_version >= 3) {
        delete frontmatter.order;
        delete frontmatter.current_level;
        delete frontmatter.goal;
        delete frontmatter.days;
      }
      // Apply only the supplied managed properties; preserve user properties.
      for (const [key, value] of Object.entries(propsToUpdate)) {
        if (value === null || value === undefined || value === "") {
          if (OPTIONAL_HABIT_KEYS.includes(key)) {
            delete frontmatter[key];
            continue;
          }
          frontmatter[key] = "";
          continue;
        }

        if (key === "name_history") {
          if (Array.isArray(value)) {
            frontmatter[key] = value;
          } else if (typeof value === "string" && value.includes("|||")) {
            frontmatter[key] = value.split("|||").filter(Boolean);
          } else if (typeof value === "string" && value.trim()) {
            frontmatter[key] = [value.trim()];
          } else {
            delete frontmatter[key];
          }
        } else if (value === "true" || value === true) {
          frontmatter[key] = true;
        } else if (value === "false" || value === false) {
          frontmatter[key] = false;
        } else if (typeof value === "string" && !isNaN(value) && value.trim() !== "") {
          if (key === "current_level" || key === "order" || key === "schema_version") {
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
    return HabitEntity.extractNotesFromBody(content);
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

    return `\`\`\`core-habits\n\`\`\`\n\n${engineeringSection}${notesBlock}`.trimEnd() + "\n";
  }

  // ─── CRUD Operations ──────────────────────────────────────────────────────

  /**
   * Creates a new habit note file with Frontmatter + Template.
   * Called automatically by HabitManager.addHabit().
   * @param {object} habit - The newly created habit object
   * @returns {Promise<TFile>} The created file; throws on failure
   */
  async createHabitNote(habit) {
      await this.ensureFolders();
      const filePath = this.getHabitFilePath(habit.name, Boolean(habit.archived));
      this.validatePathSafety(filePath);

      // Check if file already exists — don't overwrite
      const existing = this.app.vault.getAbstractFileByPath(filePath);
      if (existing) {
        throw new Error(`Habit note path already exists: ${filePath}`);
      }

      const template = this.buildHabitTemplate(habit);
      // Obsidian-native flow: create note with empty frontmatter and populate properties via processFrontMatter
      const file = await this.app.vault.create(filePath, `---\n---\n\n${template}`);
      if (file) {
        try {
          await this.updateHabitNoteProps(filePath, this._habitToProps(habit), { full: true });
          if (habit.id) this.indexHabitFile(habit.id, file.path);
        } catch (error) {
          // Keep the new file as recoverable evidence; callers must not publish it in memory.
          throw new Error(`Habit note created but frontmatter write failed: ${filePath}`, { cause: error });
        }
      }

      return file;
  }

  /**
   * Updates the Frontmatter of a habit note to reflect changed properties.
   * @param {object} habit - The updated habit object
   */
  async updateHabitNote(habit) {
    let file = this._resolveHabitFile(habit);

    if (!file) throw new Error(`Habit note not found for: ${habit.id}`);
    const originalPath = file.path;

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
      await this.app.vault.rename(file, newPath);
      if (habit.id) this.indexHabitFile(habit.id, newPath);
    }

    // Existing note bodies belong to the user; metadata is stored in frontmatter.

    // Safely update frontmatter properties via Obsidian's processFrontMatter without corrupting custom properties
    try {
      await this.updateHabitNoteProps(file.path, this._habitToProps(habit), { full: true });
    } catch (error) {
      if (file.path !== originalPath) {
        try {
          await this.app.vault.rename(file, originalPath);
          if (habit.id) this.indexHabitFile(habit.id, originalPath);
        }
        catch (rollbackError) { throw new AggregateError([error, rollbackError], "Habit update and path rollback failed", { cause: rollbackError }); }
      }
      throw error;
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
   * Extracts habits from the vault that were detected as moved to Archive/ manually.
   * Called from handleVaultRename to detect manual folder moves.
   * @param {string} newPath - New file path after rename/move
   * @param {string} oldPath - Old file path before rename/move
   * @returns {'archived'|'restored'|null}
   */
  detectManualMove(newPath, oldPath) {
    const archiveFolder = this.getArchiveFolder().toLowerCase();
    const activeFolder = this.getActiveFolder().toLowerCase();

    const wasInActive = oldPath.toLowerCase().startsWith(`${activeFolder}/`);
    const wasInArchive = oldPath.toLowerCase().startsWith(`${archiveFolder}/`);
    const nowInArchive = newPath.toLowerCase().startsWith(`${archiveFolder}/`);
    const nowInActive = newPath.toLowerCase().startsWith(`${activeFolder}/`);

    if (wasInActive && nowInArchive) return "archived";
    if (wasInArchive && nowInActive) return "restored";
    return null;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Resolves a habit file by checking Active/ then Archive/ paths.
   * Public API delegating to _resolveHabitFile.
   * @param {object} habit
   * @returns {import('obsidian').TFile|null}
   */
  resolveHabitFile(habit) {
    return this._resolveHabitFile(habit);
  }

  /**
   * Converts a habit object to a flat props map for frontmatter writing.
   * Public API delegating to _habitToProps.
   * @param {object} habit
   * @returns {object}
   */
  habitToProps(habit) {
    return this._habitToProps(habit);
  }

  // ─── Scoped Index Management (O(1) lookups & scoped to Active/Archive) ───

  buildIndex() {
    this._habitIdToPath.clear();
    this._pathToHabitId.clear();

    const files = Utils.getHabitNoteFiles(this.app.vault, this);
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const habitId = cache?.frontmatter?.habit_id;
      if (habitId) {
        this._habitIdToPath.set(habitId, file.path);
        this._pathToHabitId.set(file.path, habitId);
      }
    }
    this._indexInitialized = true;
  }

  indexHabitFile(habitId, filePath) {
    if (!habitId || !filePath) return;
    const oldPath = this._habitIdToPath.get(habitId);
    if (oldPath && oldPath !== filePath) {
      this._pathToHabitId.delete(oldPath);
    }
    const oldId = this._pathToHabitId.get(filePath);
    if (oldId && oldId !== habitId) {
      this._habitIdToPath.delete(oldId);
    }
    this._habitIdToPath.set(habitId, filePath);
    this._pathToHabitId.set(filePath, habitId);
    this._indexInitialized = true;
  }

  unindexHabitFile(filePathOrHabitId) {
    if (!filePathOrHabitId) return;
    if (this._habitIdToPath.has(filePathOrHabitId)) {
      const habitId = filePathOrHabitId;
      const path = this._habitIdToPath.get(habitId);
      if (path) this._pathToHabitId.delete(path);
      this._habitIdToPath.delete(habitId);
      return;
    }
    const path = filePathOrHabitId;
    const habitId = this._pathToHabitId.get(path);
    if (habitId) this._habitIdToPath.delete(habitId);
    this._pathToHabitId.delete(path);
  }

  invalidateIndex() {
    this._habitIdToPath.clear();
    this._pathToHabitId.clear();
    this._indexInitialized = false;
  }

  getFilePathByHabitId(habitId) {
    if (!habitId) return null;
    if (!this._indexInitialized) this.buildIndex();
    return this._habitIdToPath.get(habitId) || null;
  }

  getHabitIdByPath(filePath) {
    if (!filePath) return null;
    if (!this._indexInitialized) this.buildIndex();
    return this._pathToHabitId.get(filePath) || null;
  }

  /**
   * Resolves a habit file by checking index first, then Active/Archive paths.
   * Scoped strictly to the habit notes directory without full vault scanning.
   */
  _resolveHabitFile(habit) {
    if (!habit) return null;

    // 1. Fast-path: Index lookup by habit_id (O(1))
    if (habit.id) {
      const indexedPath = this.getFilePathByHabitId(habit.id);
      if (indexedPath) {
        const file = this.app.vault.getAbstractFileByPath(indexedPath);
        if (file && file instanceof TFile) {
          const fileId = this.app.metadataCache?.getFileCache?.(file)?.frontmatter?.habit_id;
          if (fileId === habit.id || (!fileId && this.getHabitIdByPath(file.path) === habit.id)) return file;
        }
      }
    }

    // 2. Current name in Active then Archive
    const names = [habit.name];
    
    // 3. Historical names
    for (const oldLink of (habit.nameHistory || [])) {
      names.push(oldLink.replace(/\[\[|\]\]/g, ""));
    }
    
    // 4. Try each name in Active and Archive
    for (const name of names) {
      for (const archived of [false, true]) {
        const path = this.getHabitFilePath(name, archived);
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file && file instanceof TFile) {
          const fileId = this.app.metadataCache?.getFileCache?.(file)?.frontmatter?.habit_id;
          if (!habit.id || fileId === habit.id || !fileId) {
            if (habit.id) this.indexHabitFile(habit.id, file.path);
            return file;
          }
        }
      }
    }
    
    // 5. Scoped fallback: Search strictly inside habit folders
    return this._findFileByHabitId(habit.id);
  }

  /**
   * Searches exclusively within Active/ and Archive/ folders for a matching habit_id.
   * Never scans the entire vault.
   */
  _findFileByHabitId(habitId) {
    if (!habitId) return null;

    // Try index first
    const indexedPath = this.getFilePathByHabitId(habitId);
    if (indexedPath) {
      const file = this.app.vault.getAbstractFileByPath(indexedPath);
      if (file && file instanceof TFile) {
        const cache = this.app.metadataCache?.getFileCache?.(file);
        const fileId = cache?.frontmatter?.habit_id;
        if (fileId === habitId || (!fileId && this.getHabitIdByPath(file.path) === habitId)) return file;
      }
    }

    // Scoped search in Active and Archive only
    const files = Utils.getHabitNoteFiles(this.app.vault, this);
    for (const file of files) {
      const cache = this.app.metadataCache?.getFileCache?.(file);
      if (cache?.frontmatter?.habit_id === habitId) {
        this.indexHabitFile(habitId, file.path);
        return file;
      }
    }
    return null;
  }

  /**
   * Converts a habit object to a flat props map for frontmatter writing.
   */
  _habitToProps(habit) {
    if (habit instanceof HabitEntity) {
      return habit.toFrontmatterProps();
    }
    return new HabitEntity(habit).toFrontmatterProps();
  }

  /**
   * Converts a frontmatter props object back into a Habit object.
   * @param {TFile} file 
   * @param {object} props 
   * @param {string|null} [content=null]
   */
  propsToHabit(file, props, content = null) {
    return HabitEntity.fromFrontmatterProps(file, props, content);
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
      const cachedHabitId = this.app.metadataCache?.getFileCache?.(file)?.frontmatter?.habit_id;
      if (file && cachedHabitId && cachedHabitId !== habit.id) file = null;

      // Fallback: find by id if name-based lookup fails
      if (!file) file = this._findFileByHabitId(habit.id);
      if (!file) throw new Error(`Habit note not found for: ${habit.id}`);

      const collision = this.app.vault.getAbstractFileByPath(destPath);
      if (collision && collision !== file) throw new Error(`Habit note path already exists: ${destPath}`);
      if (file.path === destPath) {
        // Already in correct location — just update props
        await this.updateHabitNoteProps(file.path, this._habitToProps(habit), { full: true });
        return;
      }

      await this.ensureFolders();

      // Vault rename moves only this file; user backlinks are left untouched.
      const originalPath = file.path;
      await this.app.vault.rename(file, destPath);
      if (habit.id) this.indexHabitFile(habit.id, destPath);

      // Update the archived flag in frontmatter
      try {
        await this.updateHabitNoteProps(destPath, this._habitToProps(habit), { full: true });
      } catch (error) {
        try {
          await this.app.vault.rename(file, originalPath);
          if (habit.id) this.indexHabitFile(habit.id, originalPath);
        }
        catch (rollbackError) { throw new AggregateError([error, rollbackError], "Habit move and path rollback failed", { cause: rollbackError }); }
        throw error;
      }
    } catch (e) {
      console.error(`[Core Habits] Failed to move habit note for "${habit.name}":`, e);
      throw e;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
export { DEFAULT_HABIT_NOTES_FOLDER };
