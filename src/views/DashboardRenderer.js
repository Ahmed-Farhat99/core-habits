import { Notice } from 'obsidian';
import { DAY_KEYS } from '../constants.js';
import { Utils } from '../utils/Utils.js';
import { AddHabitModal } from '../modals/AddHabitModal.js';
import { getNoteByDate, findHabitEntry, calculateCurrentLevel } from '../utils/helpers.js';

export class DashboardRenderer {
  constructor(view) {
    this.view = view;
    this.app = view.app;
    this.plugin = view.plugin;
  }

  async syncLifetimeAchievements(containerEl, isAr) {
    if (typeof this.plugin.settings.lifetimeCompleted === "number") return;

    const loadingEl = containerEl.createDiv({ cls: "dh-loading-spinner text-center" });

    let totalCompleted = 0;
    try {
      let files = this.app.vault.getMarkdownFiles().filter(f => !f.path.startsWith(".obsidian") && f.stat.size < 500000);
      if (files.length > 2000) {
        files = files.slice(0, 2000);
        new Notice(isAr ? "⚠️ تمت معالجة أحدث 2000 ملف فقط لتجنب ضغط الذاكرة" : "⚠️ Processed limit 2000 files to save memory", 5000);
      }
      const BATCH_SIZE = 20;
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        loadingEl.textContent = isAr
          ? `جاري الحساب التراكمي... (${Math.min(i + BATCH_SIZE, files.length)}/${files.length} ملف) ⏳`
          : `Calculating... (${Math.min(i + BATCH_SIZE, files.length)}/${files.length} files) ⏳`;
        const batch = files.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(async (file) => {
          const content = await this.app.vault.cachedRead(file);
          if (!content.includes(this.plugin.settings.marker)) return 0;
          const habits = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
          return habits.reduce((sum, h) => sum + (h.completed ? 1 : 0), 0);
        }));
        totalCompleted += batchResults.reduce((sum, n) => sum + n, 0);
      }
      this.plugin.settings.lifetimeCompleted = totalCompleted;
      await this.plugin.saveSettings({ silent: true });
    } catch (e) {
      Utils.debugLog(this.plugin, "Failed to sync lifetime stats", e);
      this.plugin.settings.lifetimeCompleted = 0;
    }

    loadingEl.remove();
    await this.render(containerEl.parentElement);
  }

  async analyzeLastFourWeeks() {
    const now = Date.now();
    if (this.view._lastFourWeeksCache && (now - this.view._lastFourWeeksCache.timestamp < 120000)) {
      return this.view._lastFourWeeksCache.data;
    }

    const today = window.moment();
    const isAr = this.view.isAr;
    const weeksData = [];
    const dayStats = {};
    const habitStats = {};

    // Analyze over the last 4 weeks leading up to the current week
    const startOfAnalysisMs = this.view.currentWeekStart.clone().subtract(3, "weeks").startOf("day").valueOf();
    const endOfAnalysisMs = this.view.currentWeekStart.clone().add(6, "days").endOf("day").valueOf();
    const habits = this.plugin.habitManager.getHabitsForTimeRange(startOfAnalysisMs, endOfAnalysisMs);

    if (habits.length === 0) return { weeksData: [], dayStats: {}, bestHabit: null, worstHabit: null, isAr };

    for (const habit of habits) {
      habitStats[habit.id] = {
        id: habit.id,
        name: (habit.name || habit.linkText || "Unknown").replace(/\[\[|\]\]/g, ""),
        completed: 0,
        total: 0
      };
    }

    for (let w = 0; w < 4; w++) {
      const weekStart = this.view.currentWeekStart.clone().subtract(w * 7, "days");
      let weekCompleted = 0;
      let weekTotal = 0;

      const dayPromises = [];
      for (let i = 0; i < 7; i++) {
        const dayDate = weekStart.clone().add(i, "days");
        if (dayDate.isAfter(today, "day")) continue;

        const dayOfWeek = dayDate.day();
        if (!dayStats[dayOfWeek]) {
          dayStats[dayOfWeek] = { completed: 0, total: 0 };
        }

        dayPromises.push((async () => {
          const dailyNote = await getNoteByDate(this.app, dayDate, false, this.plugin.settings);
          if (!dailyNote) return null;

          const content = await this.app.vault.cachedRead(dailyNote);
          const scanned = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);

          const results = [];
          for (const habit of habits) {
            const entry = findHabitEntry(scanned, habit.linkText, habit.nameHistory);
            if (entry && !entry.skipped) {
              results.push({
                habitId: habit.id,
                dayOfWeek,
                completed: entry.completed ? 1 : 0
              });
            }
          }
          return results;
        })());
      }

      const daysResults = [];
      for (const promise of dayPromises) {
        daysResults.push(await promise);
      }

      for (const results of daysResults) {
        if (!results) continue;
        for (const res of results) {
          weekTotal++;
          dayStats[res.dayOfWeek].total++;
          habitStats[res.habitId].total++;
          if (res.completed) {
            weekCompleted++;
            dayStats[res.dayOfWeek].completed++;
            habitStats[res.habitId].completed++;
          }
        }
      }

      weeksData.push({
        weekStart: weekStart,
        rate: weekTotal > 0 ? Math.round((weekCompleted / weekTotal) * 100) : 0
      });
    }

    let bestHabit = null;
    let worstHabit = null;
    let maxHabitPct = -1;
    let minHabitPct = 101;

    for (const hId in habitStats) {
      const st = habitStats[hId];
      if (st.total > 0) {
        const pct = Math.round((st.completed / st.total) * 100);
        if (pct > maxHabitPct) { maxHabitPct = pct; bestHabit = Object.assign({}, st, { pct }); }
        if (pct < minHabitPct) { minHabitPct = pct; worstHabit = Object.assign({}, st, { pct }); }
      }
    }

    const result = { weeksData, dayStats, bestHabit, worstHabit, isAr };
    this.view._lastFourWeeksCache = { timestamp: now, data: result };
    return result;
  }

  async render(container) {
    container.addClass("decision-dashboard-container");
    const isAr = this.view.isAr;

    if (typeof this.plugin.settings.lifetimeCompleted !== "number") {
      const btnGroup = container.createDiv({ cls: "dh-pulse-card", style: "text-align: center; padding: 20px;" });
      btnGroup.createEl("h3", { text: isAr ? "حساب الإنجازات التراكمية" : "Calculate Lifetime Achievements" });
      btnGroup.createEl("p", { text: isAr ? "لحساب الإحصائيات الشاملة، نحتاج إلى فحص ملفاتك لمرة واحدة فقط." : "To calculate global stats, we need to scan your files once." });
      const btn = btnGroup.createEl("button", { cls: "mod-cta" });
      btn.textContent = isAr ? "بدء الحساب التراكمي الآن" : "Start Calculation Now";
      btn.onclick = async () => {
        btnGroup.empty();
        await this.syncLifetimeAchievements(container, isAr);
      };
      return;
    }

    // --- Section 1: Global Pulse Cards ---
    const cardsRow = container.createDiv({ cls: "dh-pulse-cards-row dh-grid-row" });

    const lifetimeCard = cardsRow.createDiv({ cls: "dh-pulse-card" });
    lifetimeCard.createDiv({ cls: "pulse-title", text: isAr ? "إجمالي الإنجازات" : "Lifetime Achievements" });
    lifetimeCard.createDiv({ cls: "pulse-value", text: (this.plugin.settings.lifetimeCompleted || 0).toString() });
    lifetimeCard.createDiv({ cls: "pulse-subtitle", text: isAr ? "🌟 علامة [x] مسطّرة في تاريخك" : "🌟 Total [x] in your vault" });

    const activeHabits = this.plugin.habitManager.getActiveHabits();
    const builds = activeHabits.filter(h => h.habitType === "build").length;
    const breaks = activeHabits.filter(h => h.habitType === "break").length;

    const identityCard = cardsRow.createDiv({ cls: "dh-pulse-card" });
    identityCard.createDiv({ cls: "pulse-title", text: isAr ? "توزيع الهوية" : "Identity Mix" });
    const identityVal = identityCard.createDiv({ cls: "pulse-value identity-value" });

    const buildWrap = identityVal.createDiv({ cls: "id-stat build-stat" });
    buildWrap.createSpan({ cls: "id-dot green-dot" });
    buildWrap.createSpan({ text: isAr ? `بناء: ${builds}` : `Build: ${builds}` });

    const breakWrap = identityVal.createDiv({ cls: "id-stat break-stat" });
    breakWrap.createSpan({ cls: "id-dot red-dot" });
    breakWrap.createSpan({ text: isAr ? `ترك: ${breaks}` : `Break: ${breaks}` });

    // Header notice based on user request (no textareas)
    const advisoryNote = container.createDiv({ cls: "dh-advisory-note" });
    advisoryNote.createSpan({ cls: "adv-icon", text: "💡" });
    advisoryNote.createSpan({
      cls: "adv-text", text: isAr
        ? "نصيحة: إذا اتخذت قراراً جديداً بناءً على هذه الأرقام، اكتبه فوراً في ملاحظة اليوم أو في ملف العادة لتثبيته."
        : "Tip: If you make a new decision based on these trends, write it immediately in today's note or the habit file."
    });

    // Render skeleton loader while data crunches (prevents UI freeze feeling)
    const loadingState = container.createDiv({ cls: "dh-skeleton-loader" });
    const skeletonCardsGrid = loadingState.createDiv({ cls: "dh-skeleton-cards-grid" });
    skeletonCardsGrid.createDiv({ cls: "dh-skeleton-card" });
    skeletonCardsGrid.createDiv({ cls: "dh-skeleton-card" });
    loadingState.createDiv({ cls: "dh-skeleton-row" });
    loadingState.createDiv({ cls: "dh-skeleton-row short" });
    loadingState.createDiv({ cls: "dh-skeleton-card" });
    loadingState.createDiv({ cls: "dh-skeleton-row" });
    loadingState.createDiv({ cls: "dh-skeleton-row short" });

    const { weeksData, dayStats, bestHabit, worstHabit } = await this.analyzeLastFourWeeks();
    loadingState.remove();

    if (weeksData.length === 0) return;

    // --- Section 2: Weekly Trends Table ---
    const trendsSection = container.createDiv({ cls: "dh-dashboard-section" });
    trendsSection.createEl("h3", { text: isAr ? "📈 اتجاهات الأسابيع الأخيرة" : "📈 Recent Weekly Trends" });
    trendsSection.createEl("p", {
      cls: "dh-section-desc",
      text: isAr ? "نظرة على آخر 4 أسابيع فقط (وليس كل تاريخك) لمعرفة مسارك الحالي واتخاذ قرارات تصحيحية فورية." : "A look at your last 4 weeks only to discover your current trajectory and make quick course corrections."
    });

    const tableTrends = trendsSection.createEl("table", { cls: "dh-dashboard-table" });
    const theadTrends = tableTrends.createEl("thead");
    const trThTrends = theadTrends.createEl("tr");
    trThTrends.createEl("th", { text: isAr ? "الأسبوع" : "Week" });
    trThTrends.createEl("th", { text: isAr ? "نسبة الإنجاز" : "Completion Rate" });
    trThTrends.createEl("th", { text: isAr ? "التغير (Trend)" : "Trend" });

    const tbodyTrends = tableTrends.createEl("tbody");

    // We show from Week 0 to Week -3
    for (let i = 0; i < weeksData.length; i++) {
      const tr = tbodyTrends.createEl("tr");
      let weekName;
      if (i === 0) weekName = isAr ? "هذا الأسبوع (مختار)" : "Current Week (Selected)";
      else if (i === 1) weekName = isAr ? "الأسبوع الماضي" : "Last Week (-1)";
      else weekName = isAr ? `الأسبوع -${i}` : `Week -${i}`;

      tr.createEl("td", { text: weekName });
      tr.createEl("td", { text: `${weeksData[i].rate}%` });

      // Trend cell (compared to prior week if exists)
      const trendCell = tr.createEl("td");
      if (i < weeksData.length - 1) {
        const diff = weeksData[i].rate - weeksData[i + 1].rate;
        if (diff > 0) {
          trendCell.textContent = isAr ? `🟢 تقدم بـ ${diff}%` : `🟢 +${diff}%`;
          trendCell.style.color = 'var(--dh-progress-excellent)';
        } else if (diff < 0) {
          const absDiff = Math.abs(diff);
          trendCell.textContent = isAr ? `🔴 تراجع بـ ${absDiff}%` : `🔴 -${absDiff}%`;
          trendCell.style.color = 'var(--dh-progress-critical)';
        } else {
          trendCell.textContent = isAr ? `➖ استقرار` : `➖ 0%`;
        }
      } else {
        trendCell.textContent = "—";
      }
    }

    // --- Best & Worst Habits Highlighter ---
    if (bestHabit && worstHabit && bestHabit.name !== worstHabit.name) {
      const habitsFocus = container.createDiv({ cls: "dh-habit-focus-box" });

      const bestEl = habitsFocus.createDiv({ cls: "focus-item best-focus clickable-card" });
      bestEl.createDiv({ cls: "focus-icon", text: "🎯" });
      const bText = bestEl.createDiv({ cls: "focus-text" });
      bText.createDiv({ cls: "focus-label", text: isAr ? "العادة الأقوى التزاماً" : "Most Consistent" });
      bText.createDiv({ cls: "focus-name", text: `${bestHabit.name} (${bestHabit.pct}%)` });

      bestEl.onclick = () => {
        const h = this.plugin.habitManager.getHabitById(bestHabit.id);
        if (h) {
          new AddHabitModal(
            this.app,
            this.plugin,
            async (updatedData) => {
              try {
                if (updatedData.levelData) updatedData.currentLevel = calculateCurrentLevel(updatedData.levelData);
                await this.plugin.habitManager.updateHabit(h.id, updatedData);
                await this.view.renderWeeklyGrid();
                new Notice(`✅ ${updatedData.name}`);
              } catch (e) {
                new Notice(`❌ Error: ${e.message}`);
              }
            },
            h
          ).open();
        }
      };

      const worstEl = habitsFocus.createDiv({ cls: "focus-item worst-focus clickable-card" });
      worstEl.createDiv({ cls: "focus-icon", text: "⚠️" });
      const wText = worstEl.createDiv({ cls: "focus-text" });
      wText.createDiv({ cls: "focus-label", text: isAr ? "العادة الأضعف (نقطة تسريب)" : "Needs Attention" });
      wText.createDiv({ cls: "focus-name", text: `${worstHabit.name} (${worstHabit.pct}%)` });

      worstEl.onclick = () => {
        const h = this.plugin.habitManager.getHabitById(worstHabit.id);
        if (h) {
          new AddHabitModal(
            this.app,
            this.plugin,
            async (updatedData) => {
              try {
                if (updatedData.levelData) updatedData.currentLevel = calculateCurrentLevel(updatedData.levelData);
                await this.plugin.habitManager.updateHabit(h.id, updatedData);
                await this.view.renderWeeklyGrid();
                new Notice(`✅ ${updatedData.name}`);
              } catch (e) {
                new Notice(`❌ Error: ${e.message}`);
              }
            },
            h
          ).open();
        }
      };
    }

    // --- Section 3: Day-by-Day Analysis ---
    const daySection = container.createDiv({ cls: "dh-dashboard-section" });
    daySection.createEl("h3", { text: isAr ? "📅 تحليل الأنماط اليومية (المتوسط)" : "📅 Day-by-Day Patterns (Average)" });
    daySection.createEl("p", {
      cls: "dh-section-desc",
      text: isAr ? "متوسط أداء كل يوم خلال الـ 28 يوماً الماضية. اكتشف يوم 'التسريب' وعالجه، ويوم ذروتك واستغله." : "Average performance over the last 28 days. Find your 'leaky' day to fix and your golden day to leverage."
    });

    const tableWrapperDays = daySection.createDiv({ cls: "dh-table-responsive-wrapper" });
    const tableDays = tableWrapperDays.createEl("table", { cls: "dh-dashboard-table day-patterns-table" });
    const theadDays = tableDays.createEl("thead");
    const trThDays = theadDays.createEl("tr");

    // Reorder days based on language settings
    const wsd = this.plugin.settings.weekStartDay;
    const dayOrder = Array.from({ length: 7 }, (_, i) => (wsd + i) % 7);

    for (const d of dayOrder) {
      trThDays.createEl("th", { text: this.plugin.translationManager.t(DAY_KEYS[d]) });
    }

    // Find min/max for highlighting
    let maxPct = -1;
    let minPct = 101;
    let validDaysCount = 0;

    const computedDays = {};
    for (const d of dayOrder) {
      const stats = dayStats[d];
      if (!stats || stats.total === 0) {
        computedDays[d] = NaN;
      } else {
        const pct = Math.round((stats.completed / stats.total) * 100);
        computedDays[d] = pct;
        validDaysCount++;
        if (pct > maxPct) maxPct = pct;
        if (pct < minPct) minPct = pct;
      }
    }

    if (maxPct === minPct) {
      minPct = -1;
      maxPct = -1;
    }

    const tbodyDays = tableDays.createEl("tbody");
    const trTbDays = tbodyDays.createEl("tr");

    for (const d of dayOrder) {
      const td = trTbDays.createEl("td");
      const v = computedDays[d];
      if (isNaN(v)) {
        td.textContent = "—";
      } else {
        let content = `${v}%`;
        if (v === maxPct) {
          content += " ✅";
          td.addClass("day-golden");
        } else if (v === minPct) {
          content += " 🔴";
          td.addClass("day-weakest");
        }
        td.textContent = content;
      }
    }

    if (validDaysCount > 0 && maxPct !== -1) {
      const diagnosis = daySection.createDiv({ cls: "day-diagnosis-text" });
      diagnosis.textContent = isAr
        ? "توجيه: أضعف أيامك باللون الأحمر، وهو 'نقطة التسريب'. أما أقوى أيامك بالأخضر، فحاول استنساخ ما تفعله فيه!"
        : "Guideline: Red indicates your weakest day that needs a routine fix, and Green is your strongest. Double down on what works!";
    }
  }
}
