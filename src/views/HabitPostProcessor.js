export class HabitPostProcessor {
  constructor(plugin) {
    this.plugin = plugin;
  }

  async process(source, el, ctx) {
    el.empty();
    
    // Get file cache to find habit_id
    const cache = this.plugin.app.metadataCache.getCache(ctx.sourcePath);
    if (!cache || !cache.frontmatter || !cache.frontmatter.habit_id) {
      el.createEl("div", { text: "⚠️ Not a valid habit note. Missing habit_id in properties.", cls: "core-habits-error" });
      return;
    }

    const habitId = cache.frontmatter.habit_id;
    const habit = this.plugin.habitManager.getHabitById(habitId);

    if (!habit) {
      el.createEl("div", { text: "⚠️ Habit not found in HabitManager.", cls: "core-habits-error" });
      return;
    }

    // Render the Habit UI
    const container = el.createEl("div", { cls: "core-habits-post-processor" });

    // Header section: Type and Color
    const header = container.createEl("div", { cls: "ch-pp-header" });
    const typeLabel = habit.habitType === "break" ? "ترك عادة" : "بناء عادة";
    const typeColor = habit.habitType === "break" ? "var(--color-red)" : "var(--color-teal)";
    
    const badge = header.createEl("span", { cls: "ch-pp-badge", text: typeLabel });
    badge.style.backgroundColor = typeColor;
    badge.style.color = "white";
    badge.style.padding = "4px 8px";
    badge.style.borderRadius = "4px";
    badge.style.fontSize = "0.85em";
    badge.style.fontWeight = "bold";

    // 🧠 Identity / Why Section
    if (habit.atomicDescription && habit.atomicDescription.identity) {
      const whyBox = container.createEl("div", { cls: "ch-pp-section" });
      whyBox.createEl("h3", { text: "🧠 الهوية المستهدفة" });
      whyBox.createEl("blockquote", { text: habit.atomicDescription.identity });
    }

    // ⚙️ Environment / Details Section
    const detailsBox = container.createEl("div", { cls: "ch-pp-section" });
    detailsBox.createEl("h3", { text: "⚙️ تفاصيل العادة" });
    const ul = detailsBox.createEl("ul");
    
    if (habit.atomicDescription && habit.atomicDescription.cue) {
      ul.createEl("li", { text: `📍 الإشارة (متى/أين): ${habit.atomicDescription.cue}` });
    }
    if (habit.atomicDescription && habit.atomicDescription.routine) {
      ul.createEl("li", { text: `⚡ السهولة (أصغر خطوة): ${habit.atomicDescription.routine}` });
    }
    if (habit.atomicDescription && habit.atomicDescription.reward) {
      ul.createEl("li", { text: `🎁 المكافأة الفورية: ${habit.atomicDescription.reward}` });
    }

    // 📈 Levels / Progression Section
    if (habit.levelData && habit.levelData.length > 0) {
      const levelsBox = container.createEl("div", { cls: "ch-pp-section" });
      levelsBox.createEl("h3", { text: "📈 المراحل والتدرج" });
      
      const levelsList = levelsBox.createEl("ul", { cls: "ch-pp-levels" });
      habit.levelData.forEach((level, idx) => {
        const isCurrent = (habit.currentLevel || 1) === (idx + 1);
        const li = levelsList.createEl("li");
        
        // Status checkbox mock
        const statusIcon = level.achieved ? "✅" : (isCurrent ? "🔄" : "⬜");
        
        li.createEl("span", { text: `${statusIcon} المرحلة ${idx + 1}: ${level.goal}` });
        
        if (level.condition) {
          const cond = li.createEl("div", { text: `شروط الانتقال: ${level.condition}`, cls: "ch-pp-condition" });
          cond.style.fontSize = "0.85em";
          cond.style.opacity = "0.8";
          cond.style.marginRight = "24px";
        }

        if (isCurrent && !level.achieved) {
          li.style.fontWeight = "bold";
          li.style.color = "var(--text-accent)";
        }
      });
    }

    // Basic styling inside the component to ensure it looks decent immediately
    container.style.border = "1px solid var(--background-modifier-border)";
    container.style.borderRadius = "8px";
    container.style.padding = "16px";
    container.style.marginTop = "16px";
    container.style.marginBottom = "16px";
    container.style.backgroundColor = "var(--background-secondary)";

    const sections = container.querySelectorAll('.ch-pp-section');
    sections.forEach(sec => {
      sec.style.marginTop = "16px";
    });
  }
}
