/**
 * Application boundary for habit comments and daily reflections.
 * The repository owns note edits; callers only request the use case.
 */
export class HabitJournalService {
  /** @param {import('../types/contracts').HabitJournalPluginPort} plugin */
  constructor(plugin) {
    this.plugin = plugin;
  }

  /**
   * @param {import('../types/contracts').HabitReference} habit
   * @param {import('moment').Moment} date
   * @param {string} text
   */
  async saveHabitComment(habit, date, text) {
    const result = await this.plugin.habitCommentRepository.upsertCommentForHabitDate(habit, date, text);
    this.plugin.diaryService?.clearCache();
    return result;
  }

  /**
   * @param {import('moment').Moment} date
   * @param {string} text
   * @param {string} type
   */
  async saveReflection(date, text, type) {
    const file = await this.plugin.habitCommentRepository.injectReflection(date, text, type);
    this.plugin.diaryService?.clearCache();
    return file;
  }

  /** @param {string} habitName @param {number} [limit] */
  async getHabitCommentHistory(habitName, limit = 365) {
    return this.plugin.habitCommentRepository.getCommentHistoryByName(habitName, limit);
  }
}
