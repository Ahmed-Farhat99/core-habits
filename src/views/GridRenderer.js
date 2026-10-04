import { BREAKPOINTS } from '../constants.js';
import { DateUtils, buildHierarchyLabels } from '../utils/helpers.js';
import { TooltipHelper } from '../utils/TooltipHelper.js';
import { HabitRowFactory } from './renderers/HabitRowFactory.js';
import { StatusView } from './StatusView.js';
import { StreakCalculator } from '../services/StreakCalculator.js';
import { CompactGridRenderer } from './grid/CompactGridRenderer.js';
import { DesktopGridHeader } from './grid/DesktopGridHeader.js';
import { DesktopGridFooter } from './grid/DesktopGridFooter.js';
import { GridInteractionHelper } from './grid/GridInteractionHelper.js';

export class GridRenderer {
  constructor(context) {
    this.context = context;
    this.plugin = context.plugin;
    this.compactRenderer = new CompactGridRenderer(this.context, this);
    this.headerRenderer = new DesktopGridHeader(this.context);
    this.footerRenderer = new DesktopGridFooter(this.context);
  }

  get isAr() {
    return this.context.isAr();
  }

  async renderGridTable(container, today, habits, weekContent) {
    if (habits.length === 0) {
      StatusView.renderEmptyState(container, {
        icon: "🌱",
        title: this.plugin.translationManager.t("empty_state_title"),
        description: this.plugin.translationManager.t("empty_state_desc")
      });
      return;
    }

    const isCompact = this.context.isCompactMode ? this.context.isCompactMode() : (container.clientWidth > 0 && container.clientWidth < BREAKPOINTS.COMPACT);
    if (isCompact) {
      return this.renderCompactList(container, today, habits, weekContent);
    }

    // Create wrapper for sticky header functionality
    const tableWrapper = container.createDiv({
      cls: "habits-grid-wrapper dh-desktop-scroll",
      attr: { role: "region", "aria-label": this.plugin.translationManager.t("tab_weekly_grid") || "Weekly Habits Grid" }
    });
    const table = tableWrapper.createDiv({
      cls: "habits-grid",
      attr: { role: "grid", "aria-label": this.plugin.translationManager.t("tab_weekly_grid") || "Habits Grid" }
    });

    // Render headers (without percentages initially)
    const thead = await this.headerRenderer.renderDayHeaders(table, habits);

    // Use DocumentFragment for batched DOM insertion
    const tbody = table.createDiv({ cls: "habits-tbody", attr: { role: "rowgroup" } });
    const fragment = document.createDocumentFragment();

    const { sorted: sortedHabits, labels: displayLabels } = buildHierarchyLabels(habits);
    const childRowsMap = new Map();
    const statusContent = this.prepareWeekStatusContent(weekContent);

    // Color System — unified: --habit-color is the single source of truth
    const hexColorMap = HabitRowFactory.buildColorMap(sortedHabits, this.plugin.habitManager);

    // Render habit rows using pre-loaded content concurrently
    const rowPromises = sortedHabits.map(async (habit, habitIdx) => {
      try {
        const colorHex = hexColorMap.get(habit.id);
        const dummyFrag = document.createElement("div");
        await this.renderHabitRow(dummyFrag, habit, statusContent, displayLabels[habitIdx], habits, colorHex);
        return { habit, row: dummyFrag.firstElementChild, error: false };
      } catch {
        return { habit, row: null, error: true, errorName: habit.name };
      }
    });

    const renderedResults = await Promise.all(rowPromises);

    for (const res of renderedResults) {
      if (res.error) {
        const errorRow = document.createElement("div");
        errorRow.className = "habit-error-row dh-grid-row";
        const errorCell = document.createElement("div");
        errorCell.className = "dh-grid-cell error-cell";
        errorCell.textContent = `⚠️ Error loading ${res.errorName}`;
        errorRow.appendChild(errorCell);
        fragment.appendChild(errorRow);
      } else if (res.row) {
        fragment.appendChild(res.row);
        if (res.row.classList.contains("habit-row-child")) {
          const pid = res.row.getAttribute("data-group-id");
          if (!childRowsMap.has(pid)) childRowsMap.set(pid, []);
          childRowsMap.get(pid).push(res.row);
        }
      }
    }

    // Append all rows at once
    tbody.appendChild(fragment);

    // Now wire up collapse/expand buttons (after DOM insertion)
    GridInteractionHelper.wireGroupCollapseButtons(tbody, childRowsMap, {
      plugin: this.plugin,
      collapsedGroups: this.plugin.settings.collapsedGroups,
      t: this.plugin.translationManager.t.bind(this.plugin.translationManager),
      onToggle: (pid, collapsed) => this.context.toggleGroupCollapse(pid, collapsed)
    });

    await this.headerRenderer.updateHeaderPercentages(thead);
    await this.headerRenderer.updateUnifiedProgressBar(container);

    this.footerRenderer.renderFooter(table);

    if (this.plugin.settings.enableHabitContext) {
      this.populateCommentDots(tbody, sortedHabits, this.context.getWeekStart(), weekContent);
    }
    
    if (!this.plugin.settings.hasSeenGridHint) {
      const hint = container.createDiv({ cls: "dh-grid-hint" });
      hint.createDiv({ cls: "dh-grid-hint-text", text: this.plugin.translationManager.t("grid_hint_tip") });
      const closeBtn = hint.createEl("button", { cls: "dh-grid-hint-close", text: "×" });
      TooltipHelper.set(closeBtn, this.plugin.translationManager.t("grid_hint_hide"));
      closeBtn.onclick = async () => {
        hint.remove();
        await this.context.dismissGridHint();
      };
    }
  }

  prepareWeekStatusContent(weekContent) {
    const parsed = new Map();
    if (!weekContent) return parsed;
    for (const [dateKey, content] of weekContent) {
      parsed.set(dateKey, typeof content === "string"
        ? { hasNote: true, scanned: this.plugin.habitScanner.scan(content, this.plugin.settings.marker) }
        : content === null
          ? { hasNote: false, scanned: [] }
          : content);
    }
    return parsed;
  }

  async renderHabitRow(container, habit, weekContent, displayLabel = "?", allHabits = [], colorHex) {
    return HabitRowFactory.renderDesktopRow({
      container,
      habit,
      weekContent,
      displayLabel,
      allHabits,
      colorHex,
      context: this.context,
      plugin: this.plugin,
      isAr: this.isAr,
      getHabitStatusForDay: this.getHabitStatusForDay.bind(this),
      updateHeaderAndProgress: this.updateHeaderAndProgress.bind(this),
      refreshRowMeta: this.refreshRowMeta.bind(this)
    });
  }

  async getHabitStatusForDay(habit, date, preloadedContent = null) {
    try {
      if (!this.plugin.statsService) return "uncompleted";
      const status = await this.plugin.statsService.getHabitStatus(habit, date, preloadedContent);
      if (status === "uncompleted") {
        if (date.isBefore(window.moment(), "day")) {
          return "missed";
        }
        return "uncompleted";
      }
      return status;
    } catch (error) {
      console.error("[Core Habits] getHabitStatusForDay error:", error);
      return "uncompleted";
    }
  }

  populateCommentDots(tbody, habits, weekStart, weekContent) {
    const commentLinesByIndex = new Map();
    const heading = this.context.getHabitNotesHeading();

    for (let i = 0; i < 7; i++) {
      const dayDate = weekStart.clone().add(i, "days");
      const dateKey = DateUtils.formatDateKey(dayDate);
      const content = weekContent ? weekContent.get(dateKey) || null : null;
      if (content) commentLinesByIndex.set(i, this.context.extractSectionLines(content, heading));
    }

    const rowsByHabitId = new Map(Array.from(tbody.querySelectorAll(".habit-row[data-habit-id]"), row => [row.getAttribute("data-habit-id"), row]));
    for (const habit of habits) {
      if (this.context.isClosed()) return;
      const row = rowsByHabitId.get(habit.id);
      if (!row) continue;
      for (const [i, lines] of commentLinesByIndex) {
        if (GridInteractionHelper.hasHabitCommentLines(lines, habit)) {
          const cell = row.querySelector(`[data-day-index="${i}"]`);
          if (cell && !cell.querySelector(".dh-has-comment-dot")) cell.createDiv({ cls: "dh-has-comment-dot" });
        }
      }
    }
  }

  async updateHeaderAndProgress() {
    if (this.context.isClosed?.()) return;
    const contentEl = this.context.getWeeklyContentContainer();
    if (contentEl) {
      await this.headerRenderer.updateUnifiedProgressBar(contentEl);
      const thead = contentEl.querySelector(".habits-thead");
      if (thead) await this.headerRenderer.updateHeaderPercentages(thead);
      this.updateCompactWeekStrip(contentEl);
    }
  }

  refreshRowMeta(habit, targetDate = null) {
    if (this.context.isClosed?.()) return;
    const container = this.context.getWeeklyContentContainer();
    if (!container) return;
    const currentToken = this.context.getRenderToken ? this.context.getRenderToken() : null;

    if (habit.parentId) {
      const parentRows = container.querySelectorAll(`.habit-row[data-group-id="${habit.parentId}"]`);
      for (const row of parentRows) {
        if (row.classList.contains('habit-row-child')) continue;
        const progressSlot = row.querySelector('.dh-child-progress');
        if (!progressSlot) break;
        const evalDate = this.context.isCompactMode?.()
          ? (targetDate || window.moment())
          : window.moment();
        const evalDow = evalDate.day();
        const allHabits = this.plugin.habitManager.getActiveHabits();
        const children = allHabits.filter(h => h.parentId === habit.parentId);
        const scheduled = children.filter(c =>
          this.plugin.habitManager.isHabitScheduledForDay(c, evalDow)
        );
        if (scheduled.length > 0) {
          const evalKey = DateUtils.formatDateKey(evalDate);
          const weekContent = this.context.getWeekContentCache ? this.context.getWeekContentCache() : null;
          const evalContent = weekContent ? weekContent.get(evalKey) || null : null;
          
          Promise.all(scheduled.map(c => this.getHabitStatusForDay(c, evalDate, evalContent)))
            .then(statuses => {
              if (this.context.getRenderToken && this.context.getRenderToken() !== currentToken) {
                return;
              }
              if (this.context.isClosed?.() || (this.context.getRenderToken && this.context.getRenderToken() !== currentToken) || !row.isConnected) return;
              GridInteractionHelper.updateChildProgressSlot(progressSlot, statuses, scheduled.length,
                this.plugin.translationManager.t.bind(this.plugin.translationManager));
            })
            .catch((err) => {
              console.error("[Core Habits] Failed to update parent progress dynamically:", err);
            });
        } else {
          progressSlot.textContent = "";
        }
        break;
      }
    }

    const refreshTimer = this.context.getRefreshTimer();
    if (refreshTimer) clearTimeout(refreshTimer);
    
    const newTimer = setTimeout(() => {
      const habitName = habit.name ?? "";
      const rows = container.querySelectorAll('.habit-row');
      for (const row of rows) {
        const nameEl = row.querySelector('.habit-pure-name');
        if (!nameEl || nameEl.textContent !== habitName) continue;
        const slot = row.querySelector('.dh-streak-badge-slot');
        if (!slot) break;
        while (slot.firstChild) slot.removeChild(slot.firstChild);
        const calc = this.context.getStreakCalculator();
        if (calc && calc.contentCache) calc.contentCache.clear();
        (calc || new StreakCalculator(this.plugin)).calculate(habit).then(({ currentStreak }) => {
          if (this.context.isClosed?.() || (this.context.getRenderToken && this.context.getRenderToken() !== currentToken) || !row.isConnected) return;
          while (slot.firstChild) slot.removeChild(slot.firstChild);
          if (currentStreak >= 2) {
            const badge = slot.createSpan({
              cls: "dh-streak-badge",
              text: `🔥${currentStreak}`,
            });
            TooltipHelper.set(badge, TooltipHelper.formatStreak(currentStreak, this.plugin.translationManager.t.bind(this.plugin.translationManager), this.isAr));
          }
        }).catch(() => { });
        break;
      }
    }, 500);

    this.context.setRefreshTimer(newTimer);
  }

  async updateUnifiedProgressBar(container) {
    return this.headerRenderer.updateUnifiedProgressBar(container);
  }

  updateCompactWeekStrip(container) {
    return this.compactRenderer.updateCompactWeekStrip(container);
  }

  async renderCompactList(container, today, habits, weekContent) {
    return this.compactRenderer.renderCompactList(container, today, habits, weekContent);
  }
}
