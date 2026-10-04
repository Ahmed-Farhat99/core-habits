import { TFile } from "obsidian";
import { Utils } from "../utils/Utils.js";


export class MigrationManager {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }

  /**
   * Run all migrations on startup.
   */
  async runMigrations() {
    console.info("[Core Habits] Checking for data migrations...");

    // 1. Settings Migration: collapsedGroups semantic inversion
    if (!this.plugin.settings.collapsedGroupsSemanticMigrated) {
      console.info("[Core Habits] Migrating collapsedGroups semantic logic...");
      let groups = this.plugin.settings.collapsedGroups || [];
      if (Array.isArray(groups)) {
        // Find all expanded group IDs (those that end with :expanded or :settings_expanded)
        const expandedIds = new Set();
        groups.forEach(key => {
          if (key.endsWith(":expanded")) {
            expandedIds.add(key.replace(":expanded", ""));
          } else if (key.endsWith(":settings_expanded")) {
            expandedIds.add(key.replace(":settings_expanded", ""));
          }
        });

        // Get all active habits that are parents
        const activeHabits = this.plugin.habitManager ? this.plugin.habitManager.getActiveHabits() : [];
        const allParentIds = new Set();
        for (const h of activeHabits) {
          const effectiveParentId = this.plugin.habitManager.getEffectiveParentId(h.id);
          if (effectiveParentId) {
            allParentIds.add(effectiveParentId);
          }
        }

        // New collapsed list = all parents that are NOT expanded
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
    // 2. If any notes need migration, create a pre-migration backup before modifying any file
    if (filesToMigrate.length > 0) {
      didMigrateFiles = true;
      console.info(`[Core Habits] ${filesToMigrate.length} habit note(s) require migration. Creating backup...`);
      await this.createBackup(filesToMigrate.map(item => item.file));

      // 3. Migrate each file safely
      for (const { file, props, schemaVer } of filesToMigrate) {
        try {
          console.info(`[Core Habits] Migrating habit note "${file.basename}" from v${schemaVer} to v2`);
          await this.migrateHabitNote(file, props);
        } catch (e) {
          console.error(`[Core Habits] Failed to migrate file "${file.path}":`, e);
          failures.push(e);
        }
      }
    }

    if (failures.length > 0) throw new AggregateError(failures, "One or more habit migrations failed");

    console.info("[Core Habits] Migration check complete.");
    return didMigrateFiles;
  }

  /**
   * Migrate habit notes from Schema v2 to Schema v3.
   * - Chunked execution (batches of 25 with micro-yielding)
   * - Resumable (inspects schema_version < 3 on each run)
   * - Idempotent (no-op with 0 writes if all notes are v3)
   * - Preserves user custom frontmatter
   * - Removes order (migrated to data.json) and current_level (derived)
   * - Cleans legacy goal/condition/achieved properties
   * - Uses app.fileManager.processFrontMatter exclusively
   * @param {{ chunkSize?: number }} [options={}]
   * @returns {Promise<boolean>}
   */
  async runSchemaV3Migration({ chunkSize = 25 } = {}) {
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
        if (schemaVer < 3) {
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

    console.info(`[Core Habits] ${filesToMigrate.length} habit note(s) require Schema v3 migration. Creating pre-migration backup...`);
    await this.createBackup(filesToMigrate.map(item => item.file));

    let orderUpdated = false;
    const currentOrder = this.plugin.settings?.habitOrder ? [...this.plugin.settings.habitOrder] : [];
    const habitOrderSet = new Set(currentOrder);

    // Chunked processing
    for (let i = 0; i < filesToMigrate.length; i += chunkSize) {
      const chunk = filesToMigrate.slice(i, i + chunkSize);

      for (const { file, props } of chunk) {
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

        // 3. Atomically update frontmatter using processFrontMatter (leaving note body untouched)
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          fm.schema_version = 3;
          if (preservedStreak > 0) {
            fm.saved_longest_streak = Math.max(fm.saved_longest_streak || 0, preservedStreak);
          }

          // Clean legacy fields migrated to data.json or derived state
          delete fm.order;
          delete fm.current_level;
          delete fm.goal;
          delete fm.days;
          for (let m = 1; m <= 5; m++) {
            delete fm[`level_${m}_goal`];
            delete fm[`level_${m}_condition`];
            delete fm[`level_${m}_achieved`];
          }
        });
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

    console.info(`[Core Habits] Successfully migrated ${filesToMigrate.length} habit note(s) to Schema v3.`);
    return true;
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
   * Migrate a single habit note file.
   * @param {import('obsidian').TFile} file
   * @param {object} props
   */
  async migrateHabitNote(file, props) {
    const content = await this.app.vault.read(file);
    const habit = this.plugin.habitNoteManager.propsToHabit(file, props, content);

    // 1. Extract log entries
    const logEntries = await this.readHabitNoteLog(habit);
    // 2. Migrate each log entry to Daily Notes
    const failedEntries = [];
    if (logEntries.length > 0) {
      console.info(`[Core Habits] Migrating ${logEntries.length} comments for "${habit.name}" to Daily Notes...`);
      for (const entry of logEntries) {
        try {
          await this.plugin.habitCommentRepository.upsertCommentForHabitDate(habit, entry.date, entry.text);
        } catch (err) {
          console.error(`[Core Habits] Failed to migrate comment on ${entry.date.format("YYYY-MM-DD")} for "${habit.name}":`, err);
          failedEntries.push(entry);
        }
      }
    }

    if (failedEntries.length > 0) {
      throw new Error(`Failed to migrate ${failedEntries.length} log entries for "${habit.name}". Migration aborted to prevent data loss.`);
    }

    // 3. Rebuild the file: update frontmatter and remove log section from body
    habit.schemaVersion = 2;

    if (logEntries.length > 0) {
      await this.app.vault.process(file, (oldContent) => {
        const range = Utils.findSectionRange(oldContent, "## 📓 سجل التدوينات والصوتيات", 2);
        if (!range) throw new Error("Legacy log section changed during migration");
        return oldContent.slice(0, range.start) + oldContent.slice(range.end);
      });
    }

    // 4. Update frontmatter properties safely using processFrontMatter
    await this.plugin.habitNoteManager.updateHabitNoteProps(file.path, this.plugin.habitNoteManager._habitToProps(habit), { full: true });
  }

  async readHabitNoteLog(habit) {
    const entries = [];
    const file = this.plugin.habitNoteManager.resolveHabitFile(habit);
    if (!file || !(file instanceof TFile)) return entries;

    const content = await this.app.vault.read(file);
    const logHeading = "## 📓 سجل التدوينات والصوتيات";
    const headingIdx = content.indexOf(logHeading);
    if (headingIdx === -1) return entries;

    const afterHeading = content.substring(headingIdx + logHeading.length);
    const nextSectionMatch = afterHeading.match(/\n## /);
    const logSection = nextSectionMatch
      ? afterHeading.substring(0, nextSectionMatch.index)
      : afterHeading;

    const lines = logSection.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const logLineRegex = /^\*\*(.*?):\*\*\s*(.*)$/;
    lines.forEach(line => {
      const match = line.match(logLineRegex);
      if (match) {
        const dateStr = match[1].trim();
        const text = match[2].trim();
        const date = window.moment(dateStr, "YYYY-MM-DD");
        if (!date.isValid()) throw new Error(`Unrecognized date in legacy habit log: ${dateStr}`);
        entries.push({ date, text });
      } else {
        throw new Error(`Unrecognized line in legacy habit log; preserving source: ${line}`);
      }
    });

    return entries;
  }

  /**
   * Migrate old habits data to v3.0 format (Files as Source of Truth).
   * Converts settings.habits JSON array into habit markdown notes.
   * @returns {Promise<boolean>} True if migration was executed and modified/created files
   */
  async migrateV3Data() {
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
    try {
    if (this.plugin.settings.habits && Array.isArray(this.plugin.settings.habits) && this.plugin.settings.habits.length > 0) {
      didMigrate = true;
      Utils.debugLog(this.plugin, `Migrating ${this.plugin.settings.habits.length} habits to v3 (Files-based)`);
      
      for (const habit of this.plugin.settings.habits) {
        let file = this.plugin.habitNoteManager._findFileByHabitId(habit.id);
        if (!file) {
          const expectedPath = this.plugin.habitNoteManager.getHabitFilePath(habit.name, habit.archived);
          file = this.app.vault.getAbstractFileByPath(expectedPath);
        }

        if (file) {
          const existingId = this.app.metadataCache.getFileCache(file)?.frontmatter?.habit_id;
          if (existingId !== habit.id) throw new Error(`Migration path collision: ${file.path}`);
          const props = this.plugin.habitNoteManager._habitToProps(habit);
          await this.plugin.habitNoteManager.updateHabitNoteProps(file.path, props, { full: true });
        } else {
          await this.plugin.habitNoteManager.createHabitNote(habit);
        }
      }

      this.plugin.settings.habitsBackup = this.plugin.settings.habits;
      this.plugin.settings.habits = [];
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

    this.plugin.settings.v3Migrated = true;
    if (typeof this.plugin.saveSettings === "function") {
      await this.plugin.saveSettings();
    }
    Utils.debugLog(this.plugin, `V3 Migration complete!`);
    return didMigrate;
    } catch (error) {
      Object.assign(this.plugin.settings, previousSettings);
      throw error;
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
