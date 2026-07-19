import { HABIT_SCHEMA_VERSION } from "../domain/HabitDataContract.js";
import { TFile } from "obsidian";


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

    const activeFolder = this.plugin.habitNoteManager.getActiveFolder().toLowerCase();
    const archiveFolder = this.plugin.habitNoteManager.getArchiveFolder().toLowerCase();
    // LEGITIMATE USE: Vault scanning is required to load all active and archived habit notes for the schema migration check.
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const lowerPath = file.path.toLowerCase();
      if (lowerPath.startsWith(activeFolder + '/') || lowerPath === activeFolder ||
          lowerPath.startsWith(archiveFolder + '/') || lowerPath === archiveFolder) {
        
        try {
          const props = await this.plugin.habitNoteManager.readHabitNoteProps(file.path);
          if (!props) continue;

          const schemaVer = parseInt(props.schema_version, 10) || 0;
          if (schemaVer < HABIT_SCHEMA_VERSION) {
            console.info(`[Core Habits] Migrating habit note "${file.basename}" from v${schemaVer} to v${HABIT_SCHEMA_VERSION}`);
            await this.migrateHabitNote(file, props);
          }
        } catch (e) {
          console.error(`[Core Habits] Failed to migrate file "${file.path}":`, e);
        }
      }
    }
    console.info("[Core Habits] Migration check complete.");
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
    await this.app.vault.process(file, (oldContent) => {
      // Rebuild properties with schemaVersion = 1
      habit.schemaVersion = 1;
      
      const newFrontmatter = this.plugin.habitNoteManager.buildFrontmatter(habit);
      
      // Extract the body (everything after the frontmatter closing ---)
      const fmEnd = oldContent.indexOf("\n---", 3);
      let body = fmEnd !== -1 ? oldContent.substring(fmEnd + 4) : oldContent;

      // Discard the old log section from the file body entirely
      const { index: logIdx } = this.plugin.habitNoteManager.findKnownHabitNoteTemplateValue(body, "habit_note_log_heading");
      if (logIdx !== -1) {
        body = body.substring(0, logIdx);
      }

      return `${newFrontmatter}\n${body.trim()}`;
    });
  }

  async readHabitNoteLog(habit) {
    const entries = [];
    const path = this.plugin.habitNoteManager.getHabitFilePath(habit.name, habit.archived);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) return entries;

    const content = await this.app.vault.read(file);
    const { value: logHeading, index: headingIdx } = this.plugin.habitNoteManager.findKnownHabitNoteTemplateValue(content, "habit_note_log_heading");
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
        if (date.isValid()) {
          entries.push({ date, text });
        }
      }
    });

    return entries;
  }
}
