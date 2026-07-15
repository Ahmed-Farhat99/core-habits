import { inspectHabitContract } from "../domain/HabitDataContract.js";

export class HabitRepository {
  /**
   * @param {import('obsidian').App} app
   * @param {object} plugin
   */
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }

  get habitNoteManager() {
    return this.plugin.habitNoteManager;
  }

  /**
   * Loads all habits from the Active/ and Archive/ folders.
   * @returns {Promise<Array<object>>}
   */
  async loadAll() {
    const habits = [];
    const activeFolder = this.habitNoteManager.getActiveFolder().toLowerCase();
    const archiveFolder = this.habitNoteManager.getArchiveFolder().toLowerCase();

    // LEGITIMATE USE: Vault scanning is required to list files in order to load habit notes from the designated Active/ and Archive/ folders.
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const lowerPath = file.path.toLowerCase();
      if (lowerPath.startsWith(activeFolder + '/') || lowerPath === activeFolder ||
          lowerPath.startsWith(archiveFolder + '/') || lowerPath === archiveFolder) {
        const props = await this.habitNoteManager.readHabitNoteProps(file.path);
        if (props) {
          const content = await this.app.vault.cachedRead(file);
          const habit = this.habitNoteManager.propsToHabit(file, props, content);
          if (habit) {
            habits.push(habit);
          }
        }
      }
    }
    return habits;
  }

  /**
   * Saves a new habit note on disk.
   * Throws on failure or validation error.
   * @param {object} habit
   */
  async create(habit) {
    const errors = inspectHabitContract(habit);
    if (errors.length > 0) {
      throw new Error(`Contract validation failed: ${errors.join(", ")}`);
    }
    const file = await this.habitNoteManager.createHabitNote(habit);
    if (!file) {
      throw new Error(`Failed to create habit note file for: ${habit.name}`);
    }
    return file;
  }

  /**
   * Updates an existing habit note on disk.
   * @param {object} habit
   */
  async update(habit) {
    const errors = inspectHabitContract(habit);
    if (errors.length > 0) {
      throw new Error(`Contract validation failed: ${errors.join(", ")}`);
    }
    await this.habitNoteManager.updateHabitNote(habit);
  }

  /**
   * Deletes (trashes) the habit note file from disk.
   * @param {object} habit
   */
  async delete(habit) {
    const file = this.habitNoteManager._resolveHabitFile(habit);
    if (file) {
      await this.app.vault.trash(file, true);
    }
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
}
