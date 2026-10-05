import { TFile } from "obsidian";
import { Utils } from "../utils/Utils.js";
import { HabitEntity } from "../domain/HabitEntity.js";


export class MigrationManager {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.lastMigrationFailures = [];
    this.lastV3MigrationFailures = [];
    this.lastV3DataFailures = [];
  }

  /**
   * Run all migrations on startup.
   * @param {{ throwOnFailure?: boolean }} [options={}]
   */
  async runMigrations({ throwOnFailure = true } = {}) {
    console.info("[Core Habits] Checking for data migrations...");

    // 1. Settings Migration: collapsedGroups semantic inversion
    if (!this.plugin.settings.collapsedGroupsSemanticMigrated) {
      await this.migrateCollapsedGroupsSemantic();
    }

    // 1. Scan and collect all habit notes requiring v2 schema migration (e.g. log migration)
    const files = Utils.getHabitNoteFiles(this.app.vault, this.plugin.habitNoteManager);
    const filesToMigrate = [];
    for (const file of files) {
      try {
        const props = await this.plugin.habitNoteManager.readHabitNoteProps(file.path);
        if (!props) continue;

        const schemaVer = parseInt(props.schema_version, 10) || 0;
        if (schemaVer < 2) {
          filesToMigrate.push({ file, props, schemaVer });
        }
      } catch (e) {
        console.error(`[Core Habits] Failed to inspect file for migration "${file.path}":`, e);
      }
    }

    let didMigrateFiles = false;
    const failures = [];
    this.lastMigrationFailures = [];

    // 2. If any notes need migration, create a pre-migration backup before modifying any file
    if (filesToMigrate.length > 0) {
      console.info(`[Core Habits] ${filesToMigrate.length} habit note(s) require migration. Creating backup...`);
      await this.createBackup(filesToMigrate.map(item => item.file));

      // 3. Migrate each file safely in isolation
      for (const { file, props, schemaVer } of filesToMigrate) {
        try {
          console.info(`[Core Habits] Migrating habit note "${file.basename}" from v${schemaVer} to v2`);
          await this.migrateHabitNote(file, props);
          didMigrateFiles = true;
        } catch (e) {
          console.error(`[Core Habits] Failed to migrate file "${file.path}":`, e);
          failures.push(e);
        }
      }
    }

    this.lastMigrationFailures = failures;
    console.info("[Core Habits] Migration check complete.");

    if (failures.length > 0 && throwOnFailure) {
      throw new AggregateError(failures, "One or more habit migrations failed");
    }

    return didMigrateFiles;
  }

  /**
   * Settings Migration: collapsedGroups semantic inversion.
   * Inverts expanded list to collapsed list.
   * Can run safely during runMigrations or after habitManager is initialized.
   */
  async migrateCollapsedGroupsSemantic() {
    if (!this.plugin?.settings || this.plugin.settings.collapsedGroupsSemanticMigrated) {
      return false;
    }

    const activeHabits = this.plugin.habitManager ? this.plugin.habitManager.getActiveHabits() : [];
    // If habitManager has not been populated with habits yet and is not initialized, defer
    if (activeHabits.length === 0 && !this.plugin.habitManager?.isInitialized) {
      return false;
    }

    console.info("[Core Habits] Migrating collapsedGroups semantic logic...");
    let groups = this.plugin.settings.collapsedGroups || [];
    if (Array.isArray(groups)) {
      const expandedIds = new Set();
      groups.forEach((key) => {
        if (key.endsWith(":expanded")) {
          expandedIds.add(key.replace(":expanded", ""));
        } else if (key.endsWith(":settings_expanded")) {
          expandedIds.add(key.replace(":settings_expanded", ""));
        }
      });

      const allParentIds = new Set();
      for (const h of activeHabits) {
        const effectiveParentId = this.plugin.habitManager.getEffectiveParentId(h.id);
        if (effectiveParentId) {
          allParentIds.add(effectiveParentId);
        }
      }

      const migratedCollapsed = [];
      for (const pid of allParentIds) {
        if (!expandedIds.has(pid)) {
          migratedCollapsed.push(pid);
        }
      }

      this.plugin.settings.collapsedGroups = migratedCollapsed;
    }
    this.plugin.settings.collapsedGroupsSemanticMigrated = true;
    if (typeof this.plugin.saveSettings === "function") {
      await this.plugin.saveSettings({ silent: true });
    }
    console.info("[Core Habits] collapsedGroups semantic migration complete.");
    return true;
  }

  /**
   * Checks whether frontmatter contains obsolete legacy fields or empty optional fields
   * that violate the Schema v3 sparse contract.
   * @param {object} props
   * @returns {boolean}
   */
  static hasSchemaHygieneDefects(props) {
    if (!props || typeof props !== "object") return false;
    // 1. Confirmed legacy fields to remove
    if (props.order !== undefined || props.current_level !== undefined || props.goal !== undefined || props.days !== undefined) return true;
    for (let m = 1; m <= 5; m++) {
      if (props[`level_${m}_goal`] !== undefined || props[`level_${m}_condition`] !== undefined || props[`level_${m}_achieved`] !== undefined) return true;
    }
    // 2. Empty optional fields to prune under sparse contract
    if (props.notes === "") return true;
    if (props.archived_at === "" || props.archived_at === null) return true;
    if (props.restored_at === "" || props.restored_at === null) return true;
    if (props.parent_id === "" || props.parent_id === null) return true;
    if (props.identity === "" || props.cue === "" || props.friction === "" || props.reward === "") return true;
    if (props.saved_longest_streak === 0 || props.saved_longest_streak === "0") return true;
    if (props.deleted === "false" || props.deleted === false) return true;
    if (Array.isArray(props.name_history) && props.name_history.length === 0) return true;
    if (props.name_history === "") return true;
    return false;
  }

  /**
   * Migrate habit notes from Schema v2 to Schema v3.
   * - Chunked execution (batches of 25 with micro-yielding)
   * - Resumable (inspects schema_version < 3 or hygiene defects on each run)
   * - Idempotent (no-op with 0 writes if all notes are v3 and clean)
   * - Preserves user custom frontmatter
   * - Removes order (migrated to data.json) and current_level (derived)
   * - Cleans legacy goal/condition/achieved properties
   * - Preserves populated domain fields (saved_longest_streak, archived_at, parent_id, etc.)
   * - Prunes empty optional fields so old and new v3 notes follow the same sparse contract
   * - Migrates body notes into frontmatter if frontmatter was empty
   * - Uses app.fileManager.processFrontMatter exclusively
   * @param {{ chunkSize?: number, throwOnFailure?: boolean }} [options={}]
   * @returns {Promise<boolean>}
   */
  async runSchemaV3Migration({ chunkSize = 25, throwOnFailure = true } = {}) {
    if (!this.app.fileManager?.processFrontMatter) {
      throw new Error("Obsidian processFrontMatter writer is unavailable");
    }

    const files = Utils.getHabitNoteFiles(this.app.vault, this.plugin.habitNoteManager);
    const filesToMigrate = [];

    for (const file of files) {
      try {
        const props = await this.plugin.habitNoteManager.readHabitNoteProps(file.path);
        if (!props) continue;
        const schemaVer = parseInt(props.schema_version, 10) || 0;
        if (schemaVer < 3 || MigrationManager.hasSchemaHygieneDefects(props)) {
          filesToMigrate.push({ file, props, schemaVer });
        }
      } catch (e) {
        console.error(`[Core Habits] Failed to inspect file for v3 migration "${file.path}":`, e);
      }
    }

    // Idempotent: if 0 files need migration, do nothing, create 0 backups, 0 disk writes
    if (filesToMigrate.length === 0) {
      return false;
    }

    console.info(`[Core Habits] ${filesToMigrate.length} habit note(s) require Schema v3 migration / hygiene cleanup. Creating pre-migration backup...`);
    await this.createBackup(filesToMigrate.map(item => item.file));

    let orderUpdated = false;
    const currentOrder = this.plugin.settings?.habitOrder ? [...this.plugin.settings.habitOrder] : [];
    const habitOrderSet = new Set(currentOrder);
    const failures = [];
    let didMigrateAny = false;

    // Chunked processing with per-file isolation
    for (let i = 0; i < filesToMigrate.length; i += chunkSize) {
      const chunk = filesToMigrate.slice(i, i + chunkSize);

      for (const { file, props } of chunk) {
        try {
          // 1. Ensure habit order is preserved in settings.habitOrder before removal from file
          if (props.habit_id && props.order !== undefined && !habitOrderSet.has(props.habit_id)) {
            currentOrder.push(props.habit_id);
            habitOrderSet.add(props.habit_id);
            orderUpdated = true;
          }

          // 2. Ensure current_level >= 2 preserves milestone in saved_longest_streak
          let preservedStreak = parseInt(props.saved_longest_streak, 10) || 0;
          const lvl = parseInt(props.current_level, 10);
          if (lvl >= 2 && preservedStreak === 0) {
            const milestoneDays = [0, 0, 3, 7, 21, 90][lvl] || 0;
            preservedStreak = milestoneDays;
          }

          // 2b. Notes fallback: preserve user notes from body if frontmatter is empty
          let migratedNotes = null;
          if (props.notes && typeof props.notes === "string" && props.notes.trim()) {
            migratedNotes = props.notes.trim();
          } else {
            try {
              const fileContent = typeof this.app.vault.cachedRead === "function"
                ? await this.app.vault.cachedRead(file)
                : await this.app.vault.read(file);
              const bodyNotes = HabitEntity.extractNotesFromBody(fileContent);
              if (bodyNotes && bodyNotes.trim()) {
                migratedNotes = bodyNotes.trim();
              }
            } catch (readErr) {
              console.warn(`[Core Habits] Could not inspect file body for notes migration "${file.path}":`, readErr);
            }
          }

          // 3. Atomically update frontmatter using processFrontMatter (leaving note body untouched)
          await this.app.fileManager.processFrontMatter(file, (fm) => {
            fm.schema_version = 3;

            // Retain positive saved_longest_streak; prune 0 or empty
            if (preservedStreak > 0) {
              fm.saved_longest_streak = Math.max(fm.saved_longest_streak || 0, preservedStreak);
            } else if (!fm.saved_longest_streak || parseInt(fm.saved_longest_streak, 10) <= 0) {
              delete fm.saved_longest_streak;
            }

            // Clean confirmed legacy fields migrated to data.json or derived state
            delete fm.order;
            delete fm.current_level;
            delete fm.goal;
            delete fm.days;
            for (let m = 1; m <= 5; m++) {
              delete fm[`level_${m}_goal`];
              delete fm[`level_${m}_condition`];
              delete fm[`level_${m}_achieved`];
            }

            // Sparse contract hygiene: prune empty optional fields
            if (!fm.archived_at || String(fm.archived_at).trim() === "") delete fm.archived_at;
            if (!fm.restored_at || String(fm.restored_at).trim() === "") delete fm.restored_at;
            if (!fm.parent_id || String(fm.parent_id).trim() === "") delete fm.parent_id;
            if (!fm.identity || String(fm.identity).trim() === "") delete fm.identity;
            if (!fm.cue || String(fm.cue).trim() === "") delete fm.cue;
            if (!fm.friction || String(fm.friction).trim() === "") delete fm.friction;
            if (!fm.reward || String(fm.reward).trim() === "") delete fm.reward;
            if (!fm.deleted || fm.deleted === "false" || fm.deleted === false) delete fm.deleted;
            if (!fm.name_history || (Array.isArray(fm.name_history) && fm.name_history.length === 0) || String(fm.name_history).trim() === "") {
              delete fm.name_history;
            }

            // Notes sparse hygiene: preserve non-empty, prune empty
            if (migratedNotes) {
              fm.notes = migratedNotes;
            } else {
              delete fm.notes;
            }
          });
          didMigrateAny = true;
        } catch (err) {
          console.error(`[Core Habits] Failed to migrate file to Schema v3 "${file.path}":`, err);
          failures.push(err);
        }
      }

      // Yield control to Obsidian between chunks so large vaults never lock the UI
      if (i + chunkSize < filesToMigrate.length) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    if (orderUpdated) {
      this.plugin.settings.habitOrder = currentOrder;
      if (this.plugin.habitManager?.vaultOrderStore) {
        try {
          const written = await this.plugin.habitManager.vaultOrderStore.writeOrder(currentOrder, 0);
          this.plugin.settings.habitOrderVersion = written.orderVersion;
        } catch (e) {
          console.error("[Core Habits] Failed to write VaultOrderStore in v3 migration:", e);
        }
      }
      if (typeof this.plugin.saveSettings === "function") {
        await this.plugin.saveSettings({ silent: true });
      }
    }

    this.lastV3MigrationFailures = failures;
    if (failures.length > 0 && throwOnFailure) {
      throw new AggregateError(failures, "One or more habit v3 migrations failed");
    }

    console.info(`[Core Habits] Successfully migrated ${filesToMigrate.length - failures.length} habit note(s) to Schema v3.`);
    return didMigrateAny;
  }

  /**
   * Creates a backup of habit notes before migration.
   * @param {Array<import('obsidian').TFile>} filesToBackup
   * @returns {Promise<string|null>} Path to backup folder or null
   */
  async createBackup(filesToBackup) {
    if (!filesToBackup || filesToBackup.length === 0) return null;
    if (typeof this.app.vault.create !== "function") throw new Error("Vault backup writer is unavailable");

    try {
      const now = window.moment ? window.moment() : null;
      const timestamp = now ? now.format("YYYYMMDD-HHmmss") : new Date().toISOString().replace(/[:.]/g, "-");
      const rootFolder = this.plugin.habitNoteManager.getRootFolder();
      const backupRoot = `${rootFolder}/.backups`;
      const backupFolder = `${backupRoot}/backup-${timestamp}`;

      await this._ensureFolder(backupRoot);
      await this._ensureFolder(backupFolder);

      for (const file of filesToBackup) {
        const content = await this.app.vault.read(file);
        const relativePath = file.path.slice(rootFolder.length + 1).replaceAll("/", "__");
        const backupPath = `${backupFolder}/${relativePath}.bak`;
        await this.app.vault.create(backupPath, content);
      }

      console.info(`[Core Habits] Created pre-migration backup of ${filesToBackup.length} files at "${backupFolder}"`);
      return backupFolder;
    } catch (err) {
      console.error("[Core Habits] Failed to create pre-migration backup:", err);
      throw new Error(`Pre-migration backup failed: ${err.message}. Migration aborted to prevent data loss.`, { cause: err });
    }
  }

  /**
   * Helper to ensure a folder exists in the vault.
   * @param {string} folderPath 
   */
  async _ensureFolder(folderPath) {
    if (typeof this.app.vault.createFolder !== "function") throw new Error("Vault backup folder writer is unavailable");
    const existing = this.app.vault.getAbstractFileByPath(folderPath);
    if (!existing) {
      try {
        await this.app.vault.createFolder(folderPath);
      } catch (e) {
        if (!e.message?.includes("already exists")) {
          throw e;
        }
      }
    }
  }

  /**
   * Identifies any legacy log heading in note content.
   * @param {string} content
   * @returns {string|null}
   */
  static findLegacyLogHeading(content) {
    if (!content) return null;
    const candidates = [
      "## 📓 سجل التدوينات والصوتيات",
      "### 📓 سجل التدوينات والصوتيات",
      "## سجل التدوينات والصوتيات",
      "### سجل التدوينات والصوتيات",
      "## 📓 Habit Logs",
      "### 📓 Habit Logs",
      "## Habit Logs",
      "### Habit Logs",
      "## Habit Log",
      "### Habit Log"
    ];
    for (const h of candidates) {
      if (content.includes(h)) return h;
    }
    const match = content.match(/^#{2,3}\s+(?:📓\s*)?(?:سجل التدوينات والصوتيات|Habit Logs?)\s*$/m);
    return match ? match[0].trim() : null;
  }

  /**
   * Resilient date parser for legacy logs supporting various historical formats.
   * @param {string} dateStr
   * @returns {moment.Moment|object|null}
   */
  static parseLogDate(dateStr) {
    if (!dateStr || typeof dateStr !== "string") return null;
    const clean = dateStr.trim();
    if (typeof window !== "undefined" && window.moment) {
      const parsed = window.moment(clean, [
        "YYYY-MM-DD",
        "YYYY/MM/DD",
        "YYYY.MM.DD",
        "DD-MM-YYYY",
        "DD/MM/YYYY",
        "YYYY-MM-DD HH:mm",
        "YYYY-MM-DDTHH:mm:ss"
      ], true);
      if (parsed.isValid()) return parsed;
      const loose = window.moment(clean);
      if (loose.isValid()) return loose;
    } else {
      const d = new Date(clean);
      if (!isNaN(d.getTime())) {
        return {
          isValid: () => true,
          format: (f) => f === "YYYY-MM-DD" ? clean.replace(/[/.]/g, "-") : clean
        };
      }
    }
    return null;
  }

  /**
   * Migrate a single habit note file.
   * @param {import('obsidian').TFile} file
   * @param {object} props
   */
  async migrateHabitNote(file, props) {
    const content = await this.app.vault.read(file);
    const habit = this.plugin.habitNoteManager.propsToHabit(file, props, content);
    if (!habit || !habit.id) {
      throw new Error(`Cannot parse habit entity from file: ${file.path}`);
    }

    // 1. Extract log entries
    const logEntries = await this.readHabitNoteLog(habit, file, content);

    // If there were no dated log entries, but there were unrecognized lines in the section:
    if (logEntries.length === 0 && logEntries.unparsedLines && logEntries.unparsedLines.length > 0) {
      throw new Error(`Unrecognized line in legacy habit log; preserving source: ${logEntries.unparsedLines[0]}`);
    }

    // 2. Migrate each log entry to Daily Notes
    const failedEntries = [];
    if (logEntries.length > 0) {
      console.info(`[Core Habits] Migrating ${logEntries.length} comments for "${habit.name}" to Daily Notes...`);
      for (const entry of logEntries) {
        try {
          await this.plugin.habitCommentRepository.upsertCommentForHabitDate(habit, entry.date, entry.text);
        } catch (err) {
          console.error(`[Core Habits] Failed to migrate comment on ${entry.date.format ? entry.date.format("YYYY-MM-DD") : entry.date} for "${habit.name}":`, err);
          failedEntries.push(entry);
        }
      }
    }

    if (failedEntries.length > 0) {
      throw new Error(`Failed to migrate ${failedEntries.length} log entries for "${habit.name}". Migration aborted to prevent data loss.`);
    }

    // 3. Rebuild the file: update frontmatter and remove/preserve log section from body
    habit.schemaVersion = 2;

    if (logEntries.matchedHeading) {
      await this.app.vault.process(file, (oldContent) => {
        const range = Utils.findSectionRange(oldContent, logEntries.matchedHeading, 2);
        if (!range) throw new Error("Legacy log section changed during migration");

        if (!logEntries.unparsedLines || logEntries.unparsedLines.length === 0) {
          return oldContent.slice(0, range.start) + oldContent.slice(range.end);
        } else {
          // Preserve unparsed lines under the heading so user text is never lost
          const preserved = `${logEntries.matchedHeading}\n${logEntries.unparsedLines.join("\n")}\n\n`;
          return oldContent.slice(0, range.start) + preserved + oldContent.slice(range.end);
        }
      });
    }

    // 4. Update frontmatter properties safely using processFrontMatter
    await this.plugin.habitNoteManager.updateHabitNoteProps(file.path, this.plugin.habitNoteManager._habitToProps(habit), { full: true });
  }

  /**
   * Reads legacy log section from a habit note.
   * Returns an array of dated entries, plus unparsed lines and matched heading metadata.
   * @param {object} habit
   * @param {import('obsidian').TFile} [file]
   * @param {string} [content]
   * @returns {Promise<Array<{ date: moment.Moment, text: string }> & { unparsedLines: string[], matchedHeading: string|null, range: object|null }>}
   */
  async readHabitNoteLog(habit, file = null, content = null) {
    const targetFile = file || (this.plugin.habitNoteManager ? this.plugin.habitNoteManager.resolveHabitFile(habit) : null);
    const entries = [];
    entries.entries = entries;
    entries.unparsedLines = [];
    entries.matchedHeading = null;
    entries.range = null;

    if (!targetFile || !(targetFile instanceof TFile)) return entries;

    const noteContent = content !== null ? content : await this.app.vault.read(targetFile);
    const matchedHeading = MigrationManager.findLegacyLogHeading(noteContent);
    if (!matchedHeading) return entries;

    entries.matchedHeading = matchedHeading;
    const headingLevel = Utils.getHeadingLevel ? Utils.getHeadingLevel(matchedHeading, 2) : 2;
    const range = Utils.findSectionRange(noteContent, matchedHeading, headingLevel);
    if (!range) return entries;
    entries.range = range;

    const sectionContent = noteContent.substring(range.contentStart, range.end);
    const rawLines = sectionContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    let currentEntry = null;
    const dateLineRegex = /^(?:[-*]\s*)?(?:\*\*)?(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})(?::\*\*|\*\*:|:\s*|\*\*\s*|\s*)(.*)$/;

    for (const line of rawLines) {
      const match = line.match(dateLineRegex);
      if (match) {
        const date = MigrationManager.parseLogDate(match[1]);
        if (date && date.isValid()) {
          if (currentEntry) entries.push(currentEntry);
          currentEntry = { date, text: match[2].trim() };
          continue;
        }
      }

      // If we are currently inside a dated entry, subsequent non-date lines (freeform notes, audio embeds, etc.) belong to it
      if (currentEntry) {
        currentEntry.text = currentEntry.text ? `${currentEntry.text}\n${line}` : line;
        continue;
      }

      // Check if line is an audio embed with a date embedded in filename: ![[Audio 2024-05-18.m4a]]
      const audioDateMatch = line.match(/!\[\[.*?(?:Audio|Recording|Voice)?.*?(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}).*?\]\]/i);
      if (audioDateMatch) {
        const date = MigrationManager.parseLogDate(audioDateMatch[1]);
        if (date && date.isValid()) {
          currentEntry = { date, text: line };
          continue;
        }
      }

      // Standalone unparsed line without date context
      entries.unparsedLines.push(line);
    }

    if (currentEntry) {
      entries.push(currentEntry);
    }

    return entries;
  }

  /**
   * Migrate old habits data to v3.0 format (Files as Source of Truth).
   * Converts settings.habits JSON array into habit markdown notes.
   * @param {{ throwOnFailure?: boolean }} [options={}]
   * @returns {Promise<boolean>} True if migration was executed and modified/created files
   */
  async migrateV3Data({ throwOnFailure = true } = {}) {
    if (!this.plugin || !this.plugin.settings || this.plugin.settings.v3Migrated) {
      return false;
    }

    const previousSettings = {
      habits: this.plugin.settings.habits,
      habitsBackup: this.plugin.settings.habitsBackup,
      collapsedGroups: this.plugin.settings.collapsedGroups,
      v3Migrated: this.plugin.settings.v3Migrated
    };
    let didMigrate = false;
    const failures = [];

    try {
      if (this.plugin.settings.habits && Array.isArray(this.plugin.settings.habits) && this.plugin.settings.habits.length > 0) {
        didMigrate = true;
        Utils.debugLog(this.plugin, `Migrating ${this.plugin.settings.habits.length} habits to v3 (Files-based)`);
        
        const remainingHabits = [];
        for (const habit of this.plugin.settings.habits) {
          try {
            let file = this.plugin.habitNoteManager._findFileByHabitId(habit.id);
            if (!file) {
              const expectedPath = this.plugin.habitNoteManager.getHabitFilePath(habit.name, habit.archived);
              file = this.app.vault.getAbstractFileByPath(expectedPath);
            }

            if (file) {
              const existingProps = await this.plugin.habitNoteManager.readHabitNoteProps(file.path);
              const existingId = existingProps?.habit_id;
              if (existingId && existingId !== habit.id) throw new Error(`Migration path collision: ${file.path}`);
              const props = this.plugin.habitNoteManager._habitToProps(habit);
              await this.plugin.habitNoteManager.updateHabitNoteProps(file.path, props, { full: true });
            } else {
              await this.plugin.habitNoteManager.createHabitNote(habit);
            }
          } catch (habitErr) {
            console.error(`[Core Habits] Failed to migrate settings habit "${habit?.name}":`, habitErr);
            failures.push(habitErr);
            remainingHabits.push(habit);
          }
        }

        this.plugin.settings.habitsBackup = this.plugin.settings.habits;
        this.plugin.settings.habits = remainingHabits;
      }
      
      // Clean collapsedGroups from non-existent IDs
      if (Array.isArray(this.plugin.settings.collapsedGroups) && this.plugin.habitManager) {
        const habitIds = new Set([
          ...this.plugin.habitManager.getHabits().map(h => h.id),
          ...(this.plugin.settings.habitsBackup || []).map(h => h.id)
        ]);
        const cleaned = this.plugin.settings.collapsedGroups.filter(key => {
          const id = key.split(":")[0];
          return habitIds.has(id);
        });
        if (cleaned.length !== this.plugin.settings.collapsedGroups.length) {
          this.plugin.settings.collapsedGroups = cleaned;
        }
      }

      this.lastV3DataFailures = failures;
      if (failures.length > 0 && throwOnFailure) {
        Object.assign(this.plugin.settings, previousSettings);
        if (failures.length === 1) throw failures[0];
        throw new AggregateError(failures, "One or more v3 habit data migrations failed");
      }

      if (failures.length === 0) {
        this.plugin.settings.v3Migrated = true;
      }
      if (typeof this.plugin.saveSettings === "function") {
        await this.plugin.saveSettings();
      }
      Utils.debugLog(this.plugin, `V3 Migration complete!`);

      return didMigrate;
    } catch (error) {
      if (throwOnFailure) {
        Object.assign(this.plugin.settings, previousSettings);
        throw error;
      }
      return didMigrate;
    }
  }

  /**
   * Upgrades legacy H2 headings to H3 if dailyParentHeading was undefined in saved data.
   * @param {object} settings
   * @param {object} savedData
   * @returns {boolean} True if any headings were modified
   */
  static upgradeLegacyHeadings(settings, savedData) {
    if (!savedData || savedData.dailyParentHeading !== undefined || !settings) {
      return false;
    }
    let modified = false;
    if ((settings.habitHeading || "").startsWith("## ")) {
      settings.habitHeading = settings.habitHeading.replace(/^##\s+/, "### ");
      modified = true;
    }
    if ((settings.reflectionHeading || "").startsWith("## ")) {
      settings.reflectionHeading = settings.reflectionHeading.replace(/^##\s+/, "### ");
      modified = true;
    }
    if ((settings.habitLogHeading || "").startsWith("## ")) {
      settings.habitLogHeading = settings.habitLogHeading.replace(/^##\s+/, "### ");
      modified = true;
    }
    return modified;
  }
}
