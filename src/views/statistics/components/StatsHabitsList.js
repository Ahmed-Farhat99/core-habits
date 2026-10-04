import { setIcon } from 'obsidian';
import { getDaysUnit } from '../../../utils/helpers.js';
import { TooltipHelper } from '../../../utils/TooltipHelper.js';

/**
 * StatsHabitsList — Habits details view with native Obsidian collapsible accordion.
 *
 * Information Architecture:
 * 1. Collapsible details with a habit count.
 * 2. Un-truncated 2-line habit cards with sorting (Highest, Lowest, Alphabetical).
 * 3. Zero redundancy — removed duplicate diagnostics section.
 */
export class StatsHabitsList {
  constructor(context) {
    this.context = context;
    this.plugin = context.plugin;
    this.sortMode = "rate_desc";
    this.isExpanded = false;
  }

  render(container, metrics) {
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const isAr = this.context.isAr ? this.context.isAr() : (this.plugin.settings?.language === "ar");
    const habits = metrics.allHabits || [];

    if (habits.length === 0) {
      return null;
    }

    const section = container.createDiv({ cls: "dh-stats-habits-section" });

    // ── 1. Native Obsidian Collapsible Accordion Header ───────────────────────
    const headerBtn = section.createEl("button", {
      cls: `dh-btn dh-habits-collapsible-header ${this.isExpanded ? "is-expanded" : "is-collapsed"}`,
    });
    headerBtn.setAttribute("aria-expanded", String(this.isExpanded));

    const titleGroup = headerBtn.createDiv({ cls: "dh-habits-header-title-group" });
    const chevronIcon = titleGroup.createSpan({ cls: "dh-habits-header-chevron" });
    setIcon(chevronIcon, this.isExpanded ? "chevron-down" : (isAr ? "chevron-left" : "chevron-right"));

    titleGroup.createSpan({
      cls: "dh-habits-header-title",
      text: t("stats_all_habits_title") || (isAr ? "تفاصيل العادات" : "Habits Details"),
    });

    titleGroup.createSpan({
      cls: "dh-habits-count-badge",
      text: `${habits.length}`,
    });

    // ── 2. Collapsible Body ──────────────────────────────────────────────────
    const bodyEl = section.createDiv({
      cls: `dh-habits-collapsible-body ${this.isExpanded ? "is-expanded" : "is-collapsed"}`,
    });
    if (!this.isExpanded) {
      bodyEl.style.display = "none";
    }

    headerBtn.onclick = () => {
      this.isExpanded = !this.isExpanded;
      headerBtn.classList.toggle("is-expanded", this.isExpanded);
      headerBtn.classList.toggle("is-collapsed", !this.isExpanded);
      bodyEl.classList.toggle("is-expanded", this.isExpanded);
      bodyEl.classList.toggle("is-collapsed", !this.isExpanded);
      bodyEl.style.display = this.isExpanded ? "flex" : "none";
      headerBtn.setAttribute("aria-expanded", String(this.isExpanded));
      chevronIcon.empty();
      setIcon(chevronIcon, this.isExpanded ? "chevron-down" : (isAr ? "chevron-left" : "chevron-right"));
    };

    // Sort toolbar
    const toolbar = bodyEl.createDiv({ cls: "dh-habits-sort-bar" });
    const sorts = [
      { id: "rate_desc", label: t("stats_sort_rate_desc") || (isAr ? "الأعلى إنجازاً" : "Highest Rate") },
      { id: "rate_asc", label: t("stats_sort_rate_asc") || (isAr ? "الأقل إنجازاً" : "Lowest Rate") },
      { id: "name", label: t("stats_sort_name") || (isAr ? "أبجدياً" : "By Name") },
    ];

    const listContentEl = bodyEl.createDiv({ cls: "dh-habits-list-content" });

    const renderList = () => {
      listContentEl.empty();

      const sorted = [...habits].sort((a, b) => {
        if (this.sortMode === "rate_desc") {
          return (b.rate ?? -1) - (a.rate ?? -1) || (b.scheduledCount || 0) - (a.scheduledCount || 0);
        }
        if (this.sortMode === "rate_asc") {
          return (a.rate ?? 101) - (b.rate ?? 101) || (a.scheduledCount || 0) - (b.scheduledCount || 0);
        }
        return (a.name || "").localeCompare(b.name || "");
      });

      sorted.forEach(habit => {
        this._renderHabitCard(listContentEl, habit, isAr);
      });
    };

    sorts.forEach(s => {
      const btn = toolbar.createEl("button", {
        cls: `dh-sort-pill ${this.sortMode === s.id ? "is-active" : ""}`,
        text: s.label,
      });
      btn.onclick = (e) => {
        e.stopPropagation();
        if (this.sortMode !== s.id) {
          this.sortMode = s.id;
          toolbar.querySelectorAll(".dh-sort-pill").forEach(b => b.classList.remove("is-active"));
          btn.classList.add("is-active");
          renderList();
        }
      };
    });

    renderList();

    // Lifetime footer
    const lifetimeCount = this.plugin.settings?.lifetimeCompleted;
    if (typeof lifetimeCount === "number" && lifetimeCount > 0) {
      const footerEl = section.createDiv({ cls: "dh-stats-lifetime-footer" });
      footerEl.createSpan({
        cls: "dh-lifetime-text",
        text: t("stats_lifetime_total", { count: lifetimeCount.toLocaleString() }) || `${lifetimeCount} check-ins total`,
      });
    }

    return section;
  }

  /**
   * Renders a habit using a robust 2-line layout that ensures the habit name
   * is ALWAYS completely readable even in narrow sidebars and mobile screens.
   */
  _renderHabitCard(container, habit, isAr) {
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const card = container.createDiv({ cls: "dh-card dh-habit-card-row" });

    // ── Line 1: Full Habit Name + Type Badge + Rate Badge ────────────────────
    const headerRow = card.createDiv({ cls: "dh-habit-card-header" });

    const nameGroup = headerRow.createDiv({ cls: "dh-habit-card-name-group" });
    const nameEl = nameGroup.createSpan({
      cls: "dh-habit-card-name clickable",
      text: habit.name || "",
    });
    TooltipHelper.set(nameEl, TooltipHelper.formatHabitEdit(habit.name || "", t, isAr));
    nameEl.onclick = (e) => {
      e.stopPropagation();
      const h = this.plugin.habitManager.getHabitById(habit.id);
      if (h && typeof this.context.openEditHabitModal === "function") {
        this.context.openEditHabitModal(h);
      }
    };

    const isBreak = habit.habitType === "break";
    const badgeLabel = isBreak
      ? (t("habit_type_break") || (isAr ? "ترك" : "Break"))
      : (t("habit_type_build") || (isAr ? "بناء" : "Build"));
    nameGroup.createSpan({
      cls: `dh-habit-type-badge ${isBreak ? "is-break" : "is-build"}`,
      text: badgeLabel,
    });

    const rate = habit.rate ?? null;
    headerRow.createDiv({
      cls: `dh-habit-rate-pill ${this._getHabitFillClass(rate)}`,
      text: rate !== null ? `${rate}%` : "—",
    });

    // ── Line 2: Progress Track + Completion Count ───────────────────────────
    const progressRow = card.createDiv({ cls: "dh-habit-card-progress-row" });

    const track = progressRow.createDiv({ cls: "dh-habit-track" });
    const fill = track.createDiv({
      cls: `dh-habit-fill ${this._getHabitFillClass(rate)}`,
    });
    fill.style.width = `${Math.min(100, Math.max(0, rate ?? 0))}%`;

    const countText = this._formatHabitCount(habit.completedCount, habit.scheduledCount, isAr, t);

    progressRow.createSpan({
      cls: "dh-habit-card-counts",
      text: countText,
    });
  }

  _formatHabitCount(completed, scheduled, isAr, t) {
    if (!scheduled || scheduled <= 0) {
      return (t ? t("status_not_scheduled") : null) || (isAr ? "غير مجدول" : "Not scheduled");
    }
    const unit = getDaysUnit(scheduled, isAr ? "ar" : "en");
    if (!isAr) {
      return `${completed} / ${scheduled} ${unit}`;
    }
    return `${completed} من ${scheduled} ${unit}`;
  }

  _getHabitFillClass(rate) {
    if (rate === null || rate === undefined) return "is-empty";
    if (rate >= 70) return "is-green";
    if (rate >= 40) return "is-mid";
    return "is-orange";
  }
}
