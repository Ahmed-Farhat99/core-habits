export class HabitPostProcessor {
  constructor(plugin) {
    this.plugin = plugin;
  }

  t(key, params = {}) {
    if (this.plugin.translationManager) {
      return this.plugin.translationManager.t(key, params);
    }
    return key;
  }

  async process(source, el, ctx) {
    el.empty();
    
    // Get file cache to find habit_id
    const cache = this.plugin.app.metadataCache.getCache(ctx.sourcePath);
    if (!cache || !cache.frontmatter || !cache.frontmatter.habit_id) {
      el.createEl("div", { text: this.t("habit_postprocessor_invalid_note"), cls: "core-habits-error" });
      return;
    }

    const habitId = cache.frontmatter.habit_id;
    const habit = this.plugin.habitManager.getHabitById(habitId);

    if (!habit) {
      el.createEl("div", { text: this.t("habit_postprocessor_not_found"), cls: "core-habits-error" });
      return;
    }

    // Render the Habit UI
    const container = el.createEl("div", { cls: "core-habits-post-processor daily-habits-plugin" });

    // Header section: Type and Color
    const header = container.createEl("div", { cls: "ch-pp-header" });
    const typeLabel = habit.habitType === "break" ? this.t("habit_postprocessor_type_break") : this.t("habit_postprocessor_type_build");
    const typeClass = habit.habitType === "break" ? "break" : "build";
    
    header.createEl("span", { cls: `ch-pp-badge ${typeClass}`, text: typeLabel });

    // 🧠 Identity / Why Section
    if (habit.atomicDescription && habit.atomicDescription.identity) {
      const whyBox = container.createEl("div", { cls: "ch-pp-section" });
      whyBox.createEl("h3", { text: this.t("habit_postprocessor_identity_heading") });
      whyBox.createEl("blockquote", { text: habit.atomicDescription.identity });
    }

    // ⚙️ Environment / Details Section
    const detailsBox = container.createEl("div", { cls: "ch-pp-section" });
    detailsBox.createEl("h3", { text: this.t("habit_postprocessor_details_heading") });
    const ul = detailsBox.createEl("ul");
    
    if (habit.atomicDescription && habit.atomicDescription.cue) {
      ul.createEl("li", { text: `${this.t("habit_postprocessor_cue_prefix")} ${habit.atomicDescription.cue}` });
    }
    if (habit.atomicDescription && habit.atomicDescription.friction) {
      ul.createEl("li", { text: `${this.t("habit_postprocessor_friction_prefix")} ${habit.atomicDescription.friction}` });
    }
    if (habit.atomicDescription && habit.atomicDescription.reward) {
      ul.createEl("li", { text: `${this.t("habit_postprocessor_reward_prefix")} ${habit.atomicDescription.reward}` });
    }

    // 📈 Levels / Progression Section
    if (habit.levelData && habit.levelData.length > 0) {
      const levelsBox = container.createEl("div", { cls: "ch-pp-section" });
      levelsBox.createEl("h3", { text: this.t("habit_postprocessor_levels_heading") });
      
      const levelsList = levelsBox.createEl("ul", { cls: "ch-pp-levels" });
      habit.levelData.forEach((level, idx) => {
        const isCurrent = (habit.currentLevel || 1) === (idx + 1);
        const liCls = (isCurrent && !level.achieved) ? "ch-pp-level-item is-current" : "ch-pp-level-item";
        const li = levelsList.createEl("li", { cls: liCls });
        
        // Status checkbox mock
        const statusIcon = level.achieved ? "✅" : (isCurrent ? "🔄" : "⬜");
        
        li.createEl("span", { text: `${statusIcon} ${this.t("habit_postprocessor_level_prefix")} ${idx + 1}: ${level.goal}` });
        
        if (level.condition) {
          li.createEl("div", { text: `${this.t("habit_postprocessor_condition_prefix")} ${level.condition}`, cls: "ch-pp-condition" });
        }
      });
    }
  }
}
