import { setIcon } from 'obsidian';
import { ProgressionEngine } from '../services/ProgressionEngine.js';

export class HabitPostProcessor {
  constructor(plugin) {
    this.plugin = plugin;
  }

  async process(source, el, ctx) {
    el.empty();
    const t = (k) => this.plugin.translationManager?.t(k);
    
    // Get file cache to find habit_id
    const cache = this.plugin.app.metadataCache.getCache(ctx.sourcePath);
    if (!cache || !cache.frontmatter || !cache.frontmatter.habit_id) {
      el.createEl("div", { text: t("error_invalid_habit_note") || "⚠️ Not a valid habit note. Missing habit_id in properties.", cls: "core-habits-error" });
      return;
    }

    const habitId = cache.frontmatter.habit_id;
    const habit = this.plugin.habitManager.getHabitById(habitId);

    if (!habit) {
      el.createEl("div", { text: t("error_habit_not_found") || "⚠️ Habit not found in HabitManager.", cls: "core-habits-error" });
      return;
    }

    // Render the Habit UI
    const container = el.createEl("div", { cls: "core-habits-post-processor daily-habits-plugin" });

    // Header section: Type and Color
    const header = container.createEl("div", { cls: "ch-pp-header" });
    const isBreak = habit.habitType === "break";
    const typeLabel = isBreak
      ? (this.plugin.translationManager?.t("grid_type_break") || "ترك عادة")
      : (this.plugin.translationManager?.t("grid_type_build") || "بناء عادة");
    const typeClass = isBreak ? "break" : "build";
    
    header.createEl("span", { cls: `ch-pp-badge ${typeClass}`, text: typeLabel });

    // Target Identity Section
    if (habit.atomicDescription && habit.atomicDescription.identity) {
      const whyBox = container.createEl("div", { cls: "ch-pp-section" });
      const h3 = whyBox.createEl("h3");
      const icon = h3.createSpan({ cls: "ch-pp-icon" });
      try { setIcon(icon, "target"); } catch { /* ignore */ }
      h3.createSpan({ text: ` ${this.plugin.translationManager?.t("post_target_identity") || "الهوية المستهدفة"}` });
      whyBox.createEl("blockquote", { text: habit.atomicDescription.identity });
    }

    // Details Section
    const detailsBox = container.createEl("div", { cls: "ch-pp-section" });
    const h3Details = detailsBox.createEl("h3");
    const iconDetails = h3Details.createSpan({ cls: "ch-pp-icon" });
    try { setIcon(iconDetails, "sliders"); } catch { /* ignore */ }
    h3Details.createSpan({ text: ` ${this.plugin.translationManager?.t("post_habit_details") || "تفاصيل العادة"}` });
    const ul = detailsBox.createEl("ul");
    
    if (habit.atomicDescription && habit.atomicDescription.cue) {
      const cueLabel = this.plugin.translationManager?.t("cue_label_build") || "الإشارة";
      const li = ul.createEl("li");
      const liIcon = li.createSpan({ cls: "ch-pp-li-icon" });
      try { setIcon(liIcon, "clock"); } catch { /* ignore */ }
      li.createSpan({ text: ` ${cueLabel}: ${habit.atomicDescription.cue}` });
    }
    if (habit.atomicDescription && habit.atomicDescription.friction) {
      const frictionLabel = this.plugin.translationManager?.t("friction_label_build") || "السهولة";
      const li = ul.createEl("li");
      const liIcon = li.createSpan({ cls: "ch-pp-li-icon" });
      try { setIcon(liIcon, "zap"); } catch { /* ignore */ }
      li.createSpan({ text: ` ${frictionLabel}: ${habit.atomicDescription.friction}` });
    }
    if (habit.atomicDescription && habit.atomicDescription.reward) {
      const rewardLabel = this.plugin.translationManager?.t("reward_label_build") || "المكافأة";
      const li = ul.createEl("li");
      const liIcon = li.createSpan({ cls: "ch-pp-li-icon" });
      try { setIcon(liIcon, "gift"); } catch { /* ignore */ }
      li.createSpan({ text: ` ${rewardLabel}: ${habit.atomicDescription.reward}` });
    }

    // Automatic Levels / Progression Section
    const progress = ProgressionEngine.getProgressDetails(habit, null, t);
    const levelsBox = container.createEl("div", { cls: "ch-pp-section" });
    const h3Prog = levelsBox.createEl("h3");
    const iconProg = h3Prog.createSpan({ cls: "ch-pp-icon" });
    try { setIcon(iconProg, "trending-up"); } catch { /* ignore */ }
    h3Prog.createSpan({ text: ` ${t("post_stages_progression") || t("tab_progression_journey") || "مسار التدرج والمحطات"}` });
    
    const levelsList = levelsBox.createEl("ul", { cls: "ch-pp-levels" });
    progress.milestones.forEach((m, idx) => {
      const customGoal = habit.levelData && habit.levelData[idx]?.goal;
      const liCls = m.isCurrent ? "ch-pp-level-item is-current" : (m.isAchieved ? "ch-pp-level-item is-achieved" : "ch-pp-level-item");
      const li = levelsList.createEl("li", { cls: liCls });
      
      const statusIconSpan = li.createSpan({ cls: "ch-pp-status-icon" });
      const iconName = m.isAchieved ? "check" : (m.isCurrent ? "target" : "circle");
      try { setIcon(statusIconSpan, iconName); } catch { /* ignore */ }

      const goalText = customGoal && customGoal.trim() ? ` — ${customGoal.trim()}` : "";
      const levelWord = t("level") || "المحطة";
      const daysWord = t("days") || "يوماً";
      
      li.createEl("span", { text: ` ${levelWord} ${m.level}: ${m.name} (${m.targetDays} ${daysWord})${goalText}` });
      if (m.desc) {
        li.createEl("div", { text: m.desc, cls: "ch-pp-condition" });
      }
    });
  }
}
