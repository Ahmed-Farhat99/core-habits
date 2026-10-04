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
  }

  get habitNoteManager() {
    return this.plugin.habitNoteManager;
  }

  /**
   * Loads all habits from the Active/ and Archive/ folders.
   * @returns {Promise<Array<HabitEntity>>}
   */
  async loadAll() {
    const habits = [];
    const pathsById = new Map();
    const files = Utils.getHabitNoteFiles(this.app.vault, this.habitNoteManager);

    for (const file of files) {
      const props = await this.habitNoteManager.readHabitNoteProps(file.path);
      if (props) {
        const content = await this.app.vault.cachedRead(file);
        const habit = this.habitNoteManager.propsToHabit(file, props, content);
        if (habit) {
          if (habit.id && pathsById.has(habit.id)) {
            throw new Error(`Duplicate habit ID ${habit.id} in ${pathsById.get(habit.id)} and ${file.path}`);
          }
          if (habit.id) {
            pathsById.set(habit.id, file.path);
            this.habitNoteManager.indexHabitFile(habit.id, file.path);
          }
          habits.push(habit);
        }
      }
    }
    return habits;
  }

  async loadFile(file) {
    const props = await this.habitNoteManager.readHabitNoteProps(file.path);
    if (!props) return null;
    const content = await this.app.vault.cachedRead(file);
    const habit = this.habitNoteManager.propsToHabit(file, props, content);
    if (habit && habit.id) {
      this.habitNoteManager.indexHabitFile(habit.id, file.path);
    }
    return habit;
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
