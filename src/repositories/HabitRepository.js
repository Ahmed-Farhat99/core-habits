import { HabitEntity } from "../domain/HabitEntity.js";
import { Utils } from "../utils/Utils.js";

export class HabitRepository {
  /**
   * @param {import('obsidian').App} app
   * @param {object} plugin
   */
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.conflicts = new Map();
    this.malformedNotes = [];
  }

  get habitNoteManager() {
    return this.plugin.habitNoteManager;
  }

  /**
   * Loads all habits from the Active/ and Archive/ folders.
   * Isolates conflicting habit IDs and skips malformed notes without crashing.
   * @returns {Promise<Array<HabitEntity>>}
   */
  async loadAll() {
    this.conflicts = new Map();
    this.malformedNotes = [];

    const files = Utils.getHabitNoteFiles(this.app.vault, this.habitNoteManager);
    const byHabitId = new Map();

    for (const file of files) {
      let props;
      try {
        props = await this.habitNoteManager.readHabitNoteProps(file.path);
      } catch (err) {
        this.malformedNotes.push({
          path: file.path,
          file,
          reason: "read_error",
          message: `Failed to read habit note properties: ${err?.message || String(err)}`
        });
        continue;
      }

      if (!props || typeof props !== "object" || Object.keys(props).length === 0) {
        this.malformedNotes.push({
          path: file.path,
          file,
          reason: "missing_frontmatter",
          message: "Note has missing or invalid YAML frontmatter."
        });
        continue;
      }

      const habitId = props.habit_id != null ? String(props.habit_id).trim() : "";
      if (!habitId) {
        this.malformedNotes.push({
          path: file.path,
          file,
          reason: "missing_habit_id",
          message: "Note frontmatter is missing a non-empty 'habit_id'."
        });
        continue;
      }

      let content;
      try {
        content = typeof this.app.vault.cachedRead === "function"
          ? await this.app.vault.cachedRead(file)
          : await this.app.vault.read(file);
      } catch (err) {
        this.malformedNotes.push({
          path: file.path,
          file,
          reason: "read_error",
          message: `Failed to read note body: ${err?.message || String(err)}`
        });
        continue;
      }

      let habit;
      try {
        habit = this.habitNoteManager.propsToHabit(file, props, content);
      } catch (err) {
        this.malformedNotes.push({
          path: file.path,
          file,
          reason: "invalid_habit_data",
          message: `Failed to create habit entity: ${err?.message || String(err)}`
        });
        continue;
      }

      if (!habit || !habit.id) {
        this.malformedNotes.push({
          path: file.path,
          file,
          reason: "invalid_habit_data",
          message: "Habit could not be parsed or has empty ID."
        });
        continue;
      }

      if (!byHabitId.has(habit.id)) {
        byHabitId.set(habit.id, []);
      }
      byHabitId.get(habit.id).push({ file, habit, path: file.path });
    }

    const healthyHabits = [];

    for (const [habitId, entries] of byHabitId.entries()) {
      if (entries.length === 1) {
        // Safe, unique habit
        const entry = entries[0];
        healthyHabits.push(entry.habit);
        this.habitNoteManager.indexHabitFile(habitId, entry.path);
      } else {
        // Conflict detected! Multiple notes share this habit ID
        // Quarantine all instances — do not select one arbitrarily, do not modify files
        this.habitNoteManager.unindexHabitFile(habitId);
        for (const entry of entries) {
          this.habitNoteManager.unindexHabitFile(entry.path);
        }

        const conflictingPaths = entries.map((e) => e.path);
        const conflictType = this.classifyConflict(conflictingPaths);
        const conflictRecord = {
          habitId,
          habitNames: entries.map((e) => e.file.basename),
          paths: conflictingPaths,
          files: entries.map((e) => e.file),
          type: conflictType,
          details: this.formatConflictDetails(habitId, conflictType, conflictingPaths)
        };

        this.conflicts.set(habitId, conflictRecord);
        console.warn(`[Core Habits] Quarantined conflicting habit ID "${habitId}" across ${entries.length} files:`, conflictingPaths);
      }
    }

    if (this.malformedNotes.length > 0) {
      console.warn(`[Core Habits] Skipped ${this.malformedNotes.length} malformed note(s):`, this.malformedNotes);
    }

    return healthyHabits;
  }

  async loadFile(file) {
    if (!file) return null;
    let props;
    try {
      props = await this.habitNoteManager.readHabitNoteProps(file.path);
    } catch {
      return null;
    }
    if (!props) return null;

    try {
      const content = typeof this.app.vault.cachedRead === "function"
        ? await this.app.vault.cachedRead(file)
        : await this.app.vault.read(file);
      const habit = this.habitNoteManager.propsToHabit(file, props, content);
      if (habit && habit.id) {
        if (this.isQuarantined(habit.id)) {
          return null;
        }

        const existingPath = this.habitNoteManager?.getFilePathByHabitId?.(habit.id);
        if (existingPath && existingPath !== file.path) {
          console.warn(`[Core Habits] Runtime duplicate conflict detected for habit "${habit.id}" between "${existingPath}" and "${file.path}". Quarantining.`);
          this.registerConflict(habit.id, [existingPath, file.path]);
          this.habitNoteManager.unindexHabitFile(habit.id);
          this.habitNoteManager.unindexHabitFile(existingPath);
          this.habitNoteManager.unindexHabitFile(file.path);
          return null;
        }

        this.habitNoteManager.indexHabitFile(habit.id, file.path);
      }
      return habit;
    } catch {
      return null;
    }
  }

  /**
   * Classifies conflict type based on file paths and locations.
   * @param {string[]} paths
   * @returns {"active_archive_duplicate"|"sync_conflict"|"duplicate_id"}
   */
  classifyConflict(paths) {
    if (!Array.isArray(paths) || paths.length < 2) return "duplicate_id";

    // 1. Sync conflict signatures (Obsidian Sync, iCloud, Dropbox, Syncthing, OneDrive, Google Drive)
    const syncConflictRegex = /(\.sync-conflict-|\s*\(\d+\)\.md$|\s+\d+\.md$|\(conflicted copy|\.conflict)/i;
    const hasSyncConflictName = paths.some((p) => syncConflictRegex.test(p));
    if (hasSyncConflictName) {
      return "sync_conflict";
    }

    // 2. Active vs Archive folder split
    const activeFolder = (this.habitNoteManager?.getActiveFolder?.() || "").toLowerCase();
    const archiveFolder = (this.habitNoteManager?.getArchiveFolder?.() || "").toLowerCase();

    if (activeFolder && archiveFolder) {
      const inActive = paths.some((p) => {
        const lower = p.toLowerCase();
        return lower.startsWith(`${activeFolder}/`) || lower.startsWith(activeFolder);
      });
      const inArchive = paths.some((p) => {
        const lower = p.toLowerCase();
        return lower.startsWith(`${archiveFolder}/`) || lower.startsWith(archiveFolder);
      });
      if (inActive && inArchive) {
        return "active_archive_duplicate";
      }
    }

    return "duplicate_id";
  }

  /**
   * Generates a descriptive, actionable conflict message for diagnostics.
   * @param {string} habitId
   * @param {string} type
   * @param {string[]} paths
   * @returns {string}
   */
  formatConflictDetails(habitId, type, paths) {
    const fileList = paths.join(", ");
    switch (type) {
      case "active_archive_duplicate":
        return `Habit ID "${habitId}" exists simultaneously in Active and Archive folders (${fileList}). Both copies are quarantined to prevent state collisions. Please keep the intended version and remove the duplicate.`;
      case "sync_conflict":
        return `Cloud sync conflict detected for habit ID "${habitId}" (${fileList}). Both copies are preserved intact and quarantined. Please resolve the sync conflict in your file manager.`;
      case "duplicate_id":
      default:
        return `Multiple notes share duplicate habit ID "${habitId}" (${fileList}). Quarantined to prevent data overwriting. Please ensure each habit has a unique habit_id.`;
    }
  }

  /**
   * Returns list of all active quarantined conflicts.
   * @returns {Array<object>}
   */
  getConflicts() {
    return Array.from((this.conflicts || new Map()).values());
  }

  /**
   * Gets specific conflict record by habit ID.
   * @param {string} habitId
   * @returns {object|null}
   */
  getConflict(habitId) {
    return this.conflicts?.get(habitId) || null;
  }

  /**
   * Checks whether a habit ID is quarantined due to conflict.
   * @param {string} habitId
   * @returns {boolean}
   */
  isQuarantined(habitId) {
    return Boolean(this.conflicts?.has(habitId));
  }

  /**
   * Returns list of notes skipped due to malformed metadata or errors.
   * @returns {Array<object>}
   */
  getMalformedNotes() {
    return [...(this.malformedNotes || [])];
  }

  /**
   * Registers a conflict dynamically at runtime.
   * @param {string} habitId
   * @param {string[]} paths
   */
  registerConflict(habitId, paths) {
    if (!this.conflicts) this.conflicts = new Map();
    const existing = this.conflicts.get(habitId);
    const combinedPaths = existing
      ? Array.from(new Set([...existing.paths, ...paths]))
      : paths;
    const type = this.classifyConflict(combinedPaths);
    this.conflicts.set(habitId, {
      habitId,
      habitNames: combinedPaths.map((p) => p.split("/").pop().replace(/\.md$/, "")),
      paths: combinedPaths,
      files: [],
      type,
      details: this.formatConflictDetails(habitId, type, combinedPaths)
    });
  }

  /**
   * Saves a new habit note on disk.
   * Throws on failure or validation error.
   * @param {object|HabitEntity} habit
   */
  async create(habit) {
    const entity = habit instanceof HabitEntity ? habit : new HabitEntity(habit);
    const errors = entity.validate();
    if (errors.length > 0) {
      throw new Error(`Contract validation failed: ${errors.join(", ")}`);
    }
    const file = await this.habitNoteManager.createHabitNote(entity);
    if (!file) {
      throw new Error(`Failed to create habit note file for: ${entity.name}`);
    }
    return file;
  }

  /**
   * Updates an existing habit note on disk.
   * @param {object|HabitEntity} habit
   */
  async update(habit) {
    const entity = habit instanceof HabitEntity ? habit : new HabitEntity(habit);
    const errors = entity.validate();
    if (errors.length > 0) {
      throw new Error(`Contract validation failed: ${errors.join(", ")}`);
    }
    await this.habitNoteManager.updateHabitNote(entity);
  }

  async updateFileProps(file, habit) {
    const props = this.habitNoteManager.habitToProps(habit);
    await this.habitNoteManager.updateHabitNoteProps(file.path, props, { full: true });
  }

  /**
   * Moves a habit note to the Archive folder and updates its state.
   * @param {object} habit
   */
  async archive(habit) {
    await this.habitNoteManager.archiveHabitNote(habit);
  }

  /**
   * Moves a habit note to the Active folder and updates its state.
   * @param {object} habit
   */
  async restore(habit) {
    await this.habitNoteManager.restoreHabitNote(habit);
  }

  /**
   * Resolves a habit note file from disk.
   * @param {object} habit
   * @returns {import('obsidian').TFile|null}
   */
  resolveHabitFile(habit) {
    return this.habitNoteManager ? this.habitNoteManager.resolveHabitFile(habit) : null;
  }

  /**
   * Gets the expected file path for a habit note.
   * @param {string} name
   * @param {boolean} archived
   * @returns {string}
   */
  getHabitFilePath(name, archived) {
    return this.habitNoteManager ? this.habitNoteManager.getHabitFilePath(name, archived) : "";
  }
}
