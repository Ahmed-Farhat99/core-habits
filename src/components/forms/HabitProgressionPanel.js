/**
 * HabitProgressionPanel.js
 * Interactive Habit Progression & 5-Stage Milestone Journey.
 * Provides a single-view, unified 5-stage horizontal timeline stepper (Levels 1 to 5),
 * prominent current milestone focus with auto-level countdown & progress track,
 * and collapsible details for customizing goals across all milestones.
 */
import { setIcon } from 'obsidian';
import { ProgressionEngine } from '../../services/ProgressionEngine.js';
import { getDaysUnit } from '../../utils/helpers.js';
import { TooltipHelper } from '../../utils/TooltipHelper.js';

export class HabitProgressionPanel {
  /**
   * @param {HTMLElement} containerEl
   * @param {Object} options
   * @param {Object} options.habit
   * @param {Object|null} [options.stats=null]
   * @param {Array} options.levelData - 5-element array { goal, condition, achieved }
   * @param {Function} options.onChange - (updatedLevelData) => void
   * @param {Function} options.t - Translation function
   */
  constructor(containerEl, { habit, stats = null, levelData = null, onChange = null, t }) {
    this.containerEl = containerEl;
    this.habit = habit;
    this.stats = stats;
    this.levelData = levelData && Array.isArray(levelData) && levelData.length === 5
      ? JSON.parse(JSON.stringify(levelData))
      : Array(5).fill().map(() => ({ goal: "", condition: "", achieved: false }));
    this.onChange = onChange;
    this.t = t || ((k) => k);

    this.editingLevelIdx = null;
    this.selectedMilestoneIdx = null;
    this.rootEl = null;

    this.render();
  }

  updateStats(newStats) {
    this.stats = newStats;
    this.render();
  }

  render() {
    this.containerEl.empty();
    this.rootEl = this.containerEl.createDiv({ cls: "dh-progression-panel-wrap" });

    const isAr = !this.t || (this.t("direction") === "rtl");
    const progress = ProgressionEngine.getProgressDetails(this.habit, this.stats, this.t);
    const selectedIdx = this.selectedMilestoneIdx !== null ? this.selectedMilestoneIdx : (progress.currentLevel - 1);

    // ─── 1. Main Card Container ────────────────────────────────────────────────
    const mainCard = this.rootEl.createDiv({ cls: "dh-progression-main-card" });

    // Header Row
    const headerRow = mainCard.createDiv({ cls: "dh-progression-card-header" });
    const titleCol = headerRow.createDiv({ cls: "dh-progression-title-col" });
    titleCol.createEl("span", {
      text: this.t("tab_progression_journey") || (isAr ? "مسار التدرج" : "Progression Track"),
      cls: "dh-progression-title-text"
    });

    headerRow.createSpan({
      cls: `dh-progression-stage-badge level-${progress.currentLevel}`,
      text: isAr ? `المحطة ${progress.currentLevel} من 5` : `Milestone ${progress.currentLevel} of 5`
    });

    // ─── 2. Unified 5-Stage Visual Stepper Track (100% visible, no scroll) ───────
    this.renderVisualStepperTrack(mainCard, progress, isAr, selectedIdx);

    // ─── 3. Current/Selected Level Focus Card ─────────────────────────────────
    this.renderFocusHero(mainCard, progress, isAr, selectedIdx);
  }

  renderVisualStepperTrack(parent, progress, isAr, selectedIdx) {
    const track = parent.createDiv({ cls: "dh-progression-stepper-track", attr: { role: "list" } });

    progress.milestones.forEach((m, idx) => {
      // Connecting line before this step (except first)
      if (idx > 0) {
        const isPrevAchieved = progress.milestones[idx - 1].isAchieved;
        let lineCls = "is-upcoming";
        if (isPrevAchieved && (m.isAchieved || m.isCurrent)) {
          lineCls = "is-achieved";
        } else if (progress.milestones[idx - 1].isCurrent) {
          lineCls = "is-current";
        }
        track.createDiv({ cls: `dh-stepper-connector ${lineCls}` });
      }

      // Step Node
      let statusClass = "is-upcoming";
      if (m.isAchieved) statusClass = "is-achieved";
      else if (m.isCurrent) statusClass = "is-current";

      const isSelected = selectedIdx === idx;
      const step = track.createDiv({
        cls: `dh-stepper-step ${statusClass} ${isSelected ? "is-selected" : ""}`,
        attr: {
          role: "listitem",
          tabindex: "0"
        }
      });

      step.style.cursor = "pointer";
      step.onclick = () => {
        this.selectedMilestoneIdx = idx;
        this.render();
      };
      step.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.selectedMilestoneIdx = idx;
          this.render();
        }
      };

      // Node Circle
      const circle = step.createDiv({ cls: `dh-stepper-node ${statusClass}` });
      if (m.isAchieved) {
        try { setIcon(circle, "check"); } catch { circle.textContent = "✓"; }
      } else {
        circle.textContent = String(m.level);
      }

      // Node Label (Concise and Punchy)
      step.createDiv({
        cls: "dh-stepper-label",
        text: m.shortName || m.name
      });

      // Target days pill
      step.createDiv({
        cls: "dh-stepper-days",
        text: `${m.targetDays} ${getDaysUnit(m.targetDays, isAr ? "ar" : "en")}`
      });

      if (m.isCurrent) {
        step.createDiv({
          cls: "dh-stepper-current-pill",
          text: isAr ? "أنت هنا" : "You are here"
        });
      }
    });
  }

  renderFocusHero(parent, progress, isAr, selectedIdx) {
    const hero = parent.createDiv({ cls: "dh-progression-focus-card" });
    const isCurrentMilestone = selectedIdx === (progress.currentLevel - 1);
    const targetM = progress.milestones[selectedIdx] || progress.currentMilestone;

    // Top Header: Level tag + Name (Short & Clear)
    const topRow = hero.createDiv({ cls: "dh-focus-top-row" });
    const titleWrap = topRow.createDiv({ cls: "dh-focus-title-wrap" });
    
    titleWrap.createSpan({
      cls: "dh-focus-level-tag",
      text: `${this.t("level") || (isAr ? "المحطة" : "Milestone")} ${targetM.level}:`
    });
    titleWrap.createEl("span", {
      cls: "dh-focus-level-name",
      text: targetM.shortName || targetM.name
    });

    topRow.createSpan({
      cls: `dh-milestone-badge ${targetM.isAchieved ? "is-achieved" : (targetM.isCurrent ? "is-current" : "is-upcoming")}`,
      text: targetM.statusBadge
    });

    if (targetM.desc) {
      hero.createDiv({
        cls: "dh-focus-desc",
        text: targetM.desc
      });
    }

    if (isCurrentMilestone) {
      // Countdown row & progress bar to next milestone
      const countdownRow = hero.createDiv({ cls: "dh-focus-countdown-row" });
      countdownRow.createSpan({
        cls: "dh-focus-status-text",
        text: progress.statusText
      });
      countdownRow.createSpan({
        cls: "dh-focus-percent-text",
        text: `${progress.progressPercent}%`
      });

      const track = hero.createDiv({ cls: "dh-pulse-milestone-track" });
      const bar = track.createDiv({ cls: "dh-pulse-milestone-bar" });
      const percent = progress.progressPercent > 0 ? Math.max(3, Math.min(progress.progressPercent, 100)) : 0;
      bar.style.width = `${percent}%`;
    } else if (targetM.isAchieved) {
      const achievedRow = hero.createDiv({ cls: "dh-focus-countdown-row is-achieved" });
      const checkIcon = achievedRow.createSpan({ cls: "dh-achieved-icon" });
      try { setIcon(checkIcon, "check"); } catch { checkIcon.textContent = "✓"; }
      achievedRow.createSpan({
        cls: "dh-focus-status-text",
        text: isAr
          ? ` تم إنجاز وتثبيت هذه المحطة (${targetM.targetDays} ${getDaysUnit(targetM.targetDays, "ar")}) بنجاح`
          : ` Achieved and solidified this milestone (${targetM.targetDays} ${getDaysUnit(targetM.targetDays, "en")})`
      });
    } else {
      const upcomingRow = hero.createDiv({ cls: "dh-focus-countdown-row is-upcoming" });
      upcomingRow.createSpan({
        cls: "dh-focus-status-text",
        text: isAr
          ? `محطة قادمة — تتطلب الحفاظ على السلسلة لبلوغ ${targetM.targetDays} ${getDaysUnit(targetM.targetDays, "ar")} متتالية`
          : `Upcoming milestone — requires maintaining a streak of ${targetM.targetDays} consecutive ${getDaysUnit(targetM.targetDays, "en")}`
      });
    }

    // Goal area for the selected milestone
    const targetIdx = targetM.level - 1;
    const currentGoal = this.levelData[targetIdx]?.goal || "";
    const goalArea = hero.createDiv({ cls: "dh-focus-goal-area" });
    
    if (this.editingLevelIdx === targetIdx) {
      this.renderGoalEditInput(goalArea, targetIdx, isAr);
    } else {
      const goalDisplay = goalArea.createDiv({ cls: `dh-milestone-goal-display ${currentGoal.trim() ? "has-goal" : "is-empty"}` });
      if (currentGoal.trim()) {
        const goalPill = goalDisplay.createDiv({ cls: "dh-milestone-goal-pill" });
        const goalText = goalPill.createSpan({ cls: "dh-milestone-saved-goal" });
        goalText.createSpan({ cls: "dh-goal-label", text: `${this.t("milestone_goal_label") || (isAr ? "هدف المحطة:" : "Milestone Goal:")} ` });
        goalText.createSpan({ cls: "dh-goal-val", text: currentGoal.trim() });

        const editBtn = goalPill.createEl("button", {
          cls: "dh-btn-icon-subtle dh-milestone-edit-goal-btn",
          type: "button"
        });
        TooltipHelper.set(editBtn, isAr ? "تعديل الهدف" : "Edit goal");
        const editIcon = editBtn.createSpan({ cls: "dh-btn-icon" });
        try { setIcon(editIcon, "pencil"); } catch { editIcon.textContent = "✏"; }
        editBtn.onclick = () => {
          this.editingLevelIdx = targetIdx;
          this.render();
        };
      } else {
        const addBtn = goalDisplay.createEl("button", {
          cls: "dh-btn-text-subtle dh-milestone-add-goal-btn",
          type: "button"
        });
        addBtn.createSpan({ text: this.t("milestone_goal_add") || (isAr ? "+ تحديد هدف المحطة" : "+ Set milestone goal") });
        addBtn.onclick = () => {
          this.editingLevelIdx = targetIdx;
          this.render();
        };
      }
    }
  }

  renderGoalEditInput(container, idx, isAr) {
    const currentGoal = this.levelData[idx]?.goal || "";
    const editWrap = container.createDiv({ cls: "dh-milestone-goal-edit-wrap" });
    const input = editWrap.createEl("input", {
      type: "text",
      cls: "form-input-clean dh-milestone-goal-input",
      attr: { placeholder: this.getPlaceholderForLevel(idx + 1, isAr) }
    });
    input.value = currentGoal;

    const actionBtns = editWrap.createDiv({ cls: "dh-milestone-goal-actions" });
    const saveBtn = actionBtns.createEl("button", {
      text: this.t("save_btn") || (isAr ? "حفظ" : "Save"),
      cls: "dh-btn mod-cta dh-btn-xs",
      type: "button"
    });
    const cancelBtn = actionBtns.createEl("button", {
      text: this.t("cancel") || (isAr ? "إلغاء" : "Cancel"),
      cls: "dh-btn dh-btn-xs",
      type: "button"
    });

    saveBtn.onclick = () => {
      this.levelData[idx].goal = input.value.trim();
      this.editingLevelIdx = null;
      this.notifyChange();
      this.render();
    };

    cancelBtn.onclick = () => {
      this.editingLevelIdx = null;
      this.render();
    };

    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveBtn.click();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelBtn.click();
      }
    };

    setTimeout(() => input.focus(), 50);
  }

  openDetails() {
    if (this.rootEl && typeof this.rootEl.scrollIntoView === "function") {
      this.rootEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  getPlaceholderForLevel(level, isAr) {
    const placeholdersAr = {
      1: "مثال: دقيقتان أو صفحتان يومياً لتثبيت البداية",
      2: "مثال: 5 دقائق أو 5 صفحات يومياً للتعود على الوقت",
      3: "مثال: 15 دقيقة أو 10 صفحات يومياً لتحقيق الأربعينية",
      4: "مثال: 25 دقيقة أو جزء كامل لرسوخ العادة وثباتها",
      5: "مثال: نمط حياة دائم وسجية أصيلة"
    };
    const placeholdersEn = {
      1: "e.g. 2 minutes or 2 pages daily to anchor starting",
      2: "e.g. 5 minutes or 5 pages to habituate time",
      3: "e.g. 15 minutes or 10 pages for routine mastery",
      4: "e.g. 25 minutes for deep-rooted permanence",
      5: "e.g. Second nature lifestyle"
    };
    return (isAr ? placeholdersAr[level] : placeholdersEn[level]) || "";
  }

  notifyChange() {
    if (this.onChange) {
      this.onChange(JSON.parse(JSON.stringify(this.levelData)));
    }
  }

  destroy() {
    if (this.rootEl) {
      this.rootEl.empty();
      this.rootEl = null;
    }
  }
}
