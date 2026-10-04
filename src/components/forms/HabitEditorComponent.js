/**
 * HabitEditorComponent.js
 * Decoupled, single-responsibility habit life and management orchestrator.
 * Powers both Desktop Popout Window (HabitEditView) and Mobile Modal (EditHabitModal)
 * with zero code duplication, clean state management, and unified lifecycle.
 */
import { Platform, setIcon } from 'obsidian';
import { NoticeService } from '../../services/NoticeService.js';
import { ConfirmModal } from '../../modals/ConfirmModal.js';
import { StreakCalculator } from '../../services/StreakCalculator.js';
import { ProgressionEngine } from '../../services/ProgressionEngine.js';
import { HabitHeaderComponent } from './HabitHeaderComponent.js';
import { HabitOverviewPanel } from './HabitOverviewPanel.js';
import { HabitProgressionPanel } from './HabitProgressionPanel.js';
import { HabitBlueprintCard } from './HabitBlueprintCard.js';
import { HabitJourneyPanel } from './HabitJourneyPanel.js';
import { HabitManagementPanel } from './HabitManagementPanel.js';
import { bindTabKeys, selectTab } from '../ui/TabBar.js';

export class HabitEditorComponent {
  /**
   * @param {HTMLElement} containerEl - DOM container to render into
   * @param {Object} options
   * @param {import('obsidian').App} options.app
   * @param {Object} options.plugin
   * @param {Object} options.habit - Habit object
   * @param {Function} options.onSubmit - (updatedData) => Promise<void>
   * @param {Function} [options.onClose] - () => void
   * @param {Function} [options.onHabitArchived] - () => void
   * @param {boolean} [options.isModal=false] - Whether running inside a modal wrapper
   */
  constructor(containerEl, options) {
    this.containerEl = containerEl;
    this.app = options.app;
    this.plugin = options.plugin;
    this.habit = options.habit;
    this.onSubmit = options.onSubmit;
    this.onClose = options.onClose || (() => {});
    this.onHabitArchived = options.onHabitArchived || (() => {});
    this.isModal = Boolean(options.isModal);

    this.activeTab = "pulse"; // 'pulse' | 'settings'
    this.isSaving = false;
    
    // Seed initial stats from saved habit values to prevent flashing zero/pending state
    const savedCurrent = this.habit?.savedCurrentStreak || 0;
    const savedLongest = Math.max(this.habit?.savedLongestStreak || 0, savedCurrent);
    this.calculatedStats = (savedCurrent > 0 || savedLongest > 0) ? {
      currentStreak: savedCurrent,
      longestStreak: savedLongest,
      consistencyScore: null,
      consistencyLabel: null,
      consistencyCompleted: null,
      consistencyScheduled: null,
      recoveryScore: null,
      trendDelta: null
    } : null;

    this.headerComponent = null;
    this.overviewPanel = null;
    this.progressionPanel = null;
    this.journeyPanel = null;
    this.managementPanel = null;

    this.initFormState();
    this.render();
  }

  initFormState() {
    const habit = this.habit;
    this.formState = {
      name: habit.name || "",
      selectedColor: habit.color || "teal",
      selectedParentId: habit.parentId || null,
      selectedDays: habit.schedule?.type === "weekly" && Array.isArray(habit.schedule.days)
        ? [...habit.schedule.days]
        : [0, 1, 2, 3, 4, 5, 6],
      scheduleType: habit.schedule?.type || "daily",
      habitType: habit.habitType || "build",
      atomicDescription: habit.atomicDescription ? { ...habit.atomicDescription } : {},
      notes: habit.notes || "",
      levelData: habit.levelData && Array.isArray(habit.levelData) && habit.levelData.length === 5
        ? JSON.parse(JSON.stringify(habit.levelData))
        : Array(5).fill().map(() => ({ goal: "", condition: "", achieved: false })),
      renameOldNotes: false
    };

    this.initialSnapshot = JSON.stringify(this.getComparableState());
  }

  getComparableState() {
    return {
      name: (this.formState.name || "").trim(),
      color: this.formState.selectedColor,
      parentId: this.formState.selectedParentId,
      days: [...(this.formState.selectedDays || [])].sort(),
      habitType: this.formState.habitType,
      atomic: this.formState.atomicDescription,
      notes: (this.formState.notes || "").trim(),
      levels: this.formState.levelData
    };
  }

  checkDirty() {
    return JSON.stringify(this.getComparableState()) !== this.initialSnapshot;
  }

  render() {
    this.containerEl.empty();
    this.containerEl.addClass("daily-habits-plugin", "daily-habits-modal");
    this.t = (k, params = {}) => this.plugin?.translationManager?.t(k, params) || k;
    const t = this.t;
    const isAr = !t || (t("direction") === "rtl");

    this.rootEl = this.containerEl.createDiv({
      cls: `daily-habits-plugin daily-habits-modal dh-habit-editor-root ${this.isModal ? "is-modal is-modal-host" : "is-popout is-popout-host"}`
    });
    this.rootEl.setAttribute("dir", isAr ? "rtl" : "ltr");
    if (isAr) {
      this.rootEl.addClass("is-rtl");
    }

    // 1. Header Component with Habit Identity & Vital Badges
    const headerContainer = this.rootEl.createDiv({ cls: "dh-header-host-container" });
    this.headerComponent = new HabitHeaderComponent(headerContainer, {
      app: this.app,
      plugin: this.plugin,
      habit: this.habit,
      formState: this.formState,
      stats: this.calculatedStats,
      t
    });

    // 2. Form & Panels Container
    const formContainer = this.rootEl.createDiv({ cls: "habit-form-container" });

    // 3. Goal-Oriented 2 Tabs Bar (Pulse, Settings)
    this.renderTabBar(formContainer, t);

    // 4. Panels Container
    const panelsContainer = formContainer.createDiv({ cls: "dh-modal-panels-container" });

    this.panels = {
      pulse: panelsContainer.createDiv({
        cls: "dh-modal-panel dh-modal-pulse-panel is-active",
        attr: { id: "panel-pulse", role: "tabpanel", "aria-labelledby": "tab-pulse" }
      }),
      settings: panelsContainer.createDiv({
        cls: "dh-modal-panel dh-modal-settings-panel",
        attr: { id: "panel-settings", role: "tabpanel", "aria-labelledby": "tab-settings" }
      })
    };

    // 5. Mount Panel Subcomponents inside Pulse Tab sections
    const overviewContainer = this.panels.pulse.createDiv({ cls: "dh-pulse-section-overview" });
    const progressionContainer = this.panels.pulse.createDiv({ cls: "dh-pulse-section-progression" });
    const blueprintContainer = this.panels.pulse.createDiv({ cls: "dh-pulse-section-blueprint" });
    const journeyContainer = this.panels.pulse.createDiv({ cls: "dh-pulse-section-journey" });

    this.overviewPanel = new HabitOverviewPanel(overviewContainer, {
      plugin: this.plugin,
      habit: this.habit,
      formState: this.formState,
      stats: this.calculatedStats,
      t
    });

    this.progressionPanel = new HabitProgressionPanel(progressionContainer, {
      habit: this.habit,
      stats: this.calculatedStats,
      levelData: this.formState.levelData,
      onChange: (updatedLevels) => {
        this.formState.levelData = updatedLevels;
        this.updateFooterActions();
      },
      t
    });

    this.blueprintCard = new HabitBlueprintCard(blueprintContainer, {
      habitType: this.formState.habitType,
      atomicDescription: this.formState.atomicDescription,
      notes: this.formState.notes,
      onChange: (updatedAtomic, updatedNotes) => {
        this.formState.atomicDescription = updatedAtomic;
        if (updatedNotes !== undefined) {
          this.formState.notes = updatedNotes;
        }
        this.updateFooterActions();
      },
      t
    });

    this.journeyPanel = new HabitJourneyPanel(journeyContainer, {
      app: this.app,
      plugin: this.plugin,
      habit: this.habit,
      formState: this.formState,
      t
    });

    this.managementPanel = new HabitManagementPanel(this.panels.settings, {
      plugin: this.plugin,
      habit: this.habit,
      formState: this.formState,
      onFieldChange: () => this.updateFooterActions(),
      onNameChange: (newName) => {
        if (this.headerComponent) this.headerComponent.updateTitle(newName);
      },
      onColorChange: () => {
        if (this.headerComponent) this.headerComponent.updateColor();
        if (this.overviewPanel) this.overviewPanel.updateColor();
      },
      onHabitTypeChange: () => {
        if (this.headerComponent) this.headerComponent.updateStatusBar();
        if (this.blueprintCard) this.blueprintCard.setHabitType(this.formState.habitType);
      },
      onEnterSave: () => {
        const saveBtn = this.rootEl?.querySelector(".dh-save-btn") || this.saveBtn;
        if (saveBtn) this.saveHabit(saveBtn, t);
      },
      onLifecycleAction: async (btn, isArchived) => {
        await this.handleLifecycleAction(btn, isArchived, t);
      },
      t
    });

    // Activate current tab
    this.switchTab(this.activeTab);

    // 6. Fixed Actions Footer (Archive, Cancel, Save)
    this.renderFooter(this.rootEl, t);

    // 7. Calculate vital stats asynchronously in background
    this.loadBackgroundStats();

    // 8. Mobile focus scroll handling
    if (Platform.isMobile) {
      this.rootEl.querySelectorAll('input, textarea, select').forEach(el => {
        el.addEventListener('focus', () => {
          setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
        });
      });
    }
  }

  async loadBackgroundStats() {
    try {
      if (!this.plugin) return;
      const calculator = this.plugin.streakCalculator || new StreakCalculator(this.plugin);
      const stats = await calculator.calculate(this.habit);
      if (stats) {
        this.calculatedStats = stats;
        if (this.headerComponent) this.headerComponent.updateStats(stats);
        if (this.overviewPanel) this.overviewPanel.updateStats(stats);
        if (this.progressionPanel) this.progressionPanel.updateStats(stats);
      }
    } catch (err) {
      console.warn("[Core Habits] Could not calculate background stats:", err);
    }
  }

  renderTabBar(container, t) {
    const isAr = !t || (t("direction") === "rtl");
    const tabsContainer = container.createDiv({
      cls: "dh-tabs dh-modal-tabs-container",
      attr: {
        role: "tablist",
        "aria-label": isAr ? "تبويبات العادة" : "Habit navigation tabs"
      }
    });

    const pulseBtn = tabsContainer.createEl("button", {
      cls: `dh-tab dh-modal-tab-btn ${this.activeTab === "pulse" ? "is-active" : ""}`,
      type: "button",
      attr: {
        id: "tab-pulse",
        role: "tab",
        "aria-selected": this.activeTab === "pulse" ? "true" : "false",
        "aria-controls": "panel-pulse"
      }
    });
    const pulseIcon = pulseBtn.createSpan({ cls: "dh-tab-icon" });
    try { setIcon(pulseIcon, "activity"); } catch { pulseIcon.textContent = "●"; }
    pulseBtn.createSpan({ cls: "dh-tab-text", text: t("tab_pulse") || (isAr ? "النبض" : "Pulse") });

    const settingsBtn = tabsContainer.createEl("button", {
      cls: `dh-tab dh-modal-tab-btn ${this.activeTab === "settings" ? "is-active" : ""}`,
      type: "button",
      attr: {
        id: "tab-settings",
        role: "tab",
        "aria-selected": this.activeTab === "settings" ? "true" : "false",
        "aria-controls": "panel-settings"
      }
    });
    const settingsIcon = settingsBtn.createSpan({ cls: "dh-tab-icon" });
    try { setIcon(settingsIcon, "sliders"); } catch { settingsIcon.textContent = "⚙"; }
    settingsBtn.createSpan({ cls: "dh-tab-text", text: t("tab_settings") || (isAr ? "الإعدادات" : "Settings") });

    this.tabs = {
      pulse: pulseBtn,
      settings: settingsBtn
    };

    Object.keys(this.tabs).forEach(tabId => {
      this.tabs[tabId].onclick = () => this.switchTab(tabId);
    });
    bindTabKeys(tabsContainer, this.tabs, (tabId) => this.switchTab(tabId));
  }

  switchTab(tabId) {
    let target = tabId;
    if (tabId === "management") target = "settings";
    if (tabId === "overview" || tabId === "progression" || tabId === "journey") target = "pulse";

    if (!this.panels[target]) return;
    this.activeTab = target;

    if (this.tabs) selectTab(this.tabs, target, this.panels);

    if (tabId === "progression" && this.progressionPanel?.openDetails) {
      this.progressionPanel.openDetails();
    } else if (tabId === "journey" && this.journeyPanel?.openDetails) {
      this.journeyPanel.openDetails();
    }

    this.updateFooterActions();
  }

  renderFooter(container, t) {
    this.footerEl = container.createDiv({ cls: "dh-modal-actions" });

    const isAr = !t || (t("direction") === "rtl");

    // Action buttons on end side
    const endGroup = this.footerEl.createDiv({ cls: "dh-modal-actions-end" });

    this.cancelBtn = endGroup.createEl("button", {
      text: t("cancel") || (isAr ? "إلغاء" : "Cancel"),
      cls: "dh-btn dh-cancel-btn",
      type: "button"
    });
    this.cancelBtn.onclick = () => this.safeClose();

    this.saveBtn = endGroup.createEl("button", {
      text: t("save_changes_btn") || (isAr ? "حفظ التغييرات" : "Save changes"),
      cls: "dh-btn dh-save-btn is-disabled",
      type: "button",
      attr: { disabled: "true" }
    });
    this.saveBtn.onclick = async () => {
      if (!this.checkDirty()) return;
      await this.saveHabit(this.saveBtn, t);
    };

    this.updateFooterActions();
  }

  updateFooterActions() {
    const isDirty = this.checkDirty();
    const t = this.t || ((k, p = {}) => this.plugin?.translationManager?.t(k, p) || k);
    const isAr = !t || (t("direction") === "rtl");
    if (this.saveBtn) {
      this.saveBtn.disabled = !isDirty;
      this.saveBtn.toggleClass("is-dirty", isDirty);
      this.saveBtn.toggleClass("mod-cta", isDirty);
      this.saveBtn.toggleClass("is-disabled", !isDirty);
      this.saveBtn.toggleClass("is-hidden", !isDirty);
    }
    if (this.cancelBtn) {
      this.cancelBtn.textContent = isDirty
        ? (t("cancel") || (isAr ? "إلغاء" : "Cancel"))
        : (t("close") || (isAr ? "إغلاق" : "Close"));
    }
    if (this.footerEl) {
      this.footerEl.removeClass("is-hidden");
    }
  }

  async handleLifecycleAction(btn, isArchived, t) {
    const isAr = !t || (t("direction") === "rtl");
    if (isArchived) {
      btn.disabled = true;
      try {
        if (this.plugin?.habitManager?.restoreHabit) {
          await this.plugin.habitManager.restoreHabit(this.habit.id);
        }
        if (typeof this.plugin?.refreshWeeklyViews === "function") {
          this.plugin.refreshWeeklyViews();
        }
        NoticeService.success(t("action_restored_success") || (isAr ? "تم استعادة العادة" : "Habit restored"), this.plugin);
        this.onHabitArchived();
        this.onClose();
      } catch (e) {
        btn.disabled = false;
        NoticeService.error(e.message, this.plugin);
      }
    } else {
      const confirmMsg = t("confirm_archive_habit", { name: this.habit.name }) || (isAr
        ? `هل أنت متأكد من رغبتك في أرشفة عادة "${this.habit.name}"؟ سيتم إخفاؤها من الجدول اليومي والاحتفاظ بكافة السجلات والمستويات.`
        : `Are you sure you want to archive "${this.habit.name}"? It will be hidden from daily view while preserving all history.`);

      new ConfirmModal(
        this.app,
        this.plugin,
        confirmMsg,
        {
          confirmText: t("action_archive") || (isAr ? "أرشفة" : "Archive"),
          cancelText: t("cancel") || (isAr ? "إلغاء" : "Cancel"),
          onConfirm: async () => {
            btn.disabled = true;
            try {
              if (this.plugin?.habitManager?.archiveHabit) {
                await this.plugin.habitManager.archiveHabit(this.habit.id);
              }
              if (typeof this.plugin?.refreshWeeklyViews === "function") {
                this.plugin.refreshWeeklyViews();
              }
              NoticeService.success(t("action_archived_success") || (isAr ? "تم الأرشفة" : "Habit archived"), this.plugin);
              this.onHabitArchived();
              this.onClose();
            } catch (e) {
              btn.disabled = false;
              NoticeService.error(e.message, this.plugin);
            }
          }
        }
      ).open();
    }
  }

  async saveHabit(saveBtn, t) {
    if (this.isSaving) return;
    try {
      this.isSaving = true;
      const btn = saveBtn || this.saveBtn;
      if (btn) btn.disabled = true;

      const { name, selectedDays, scheduleType, levelData, habitType, atomicDescription, selectedParentId, selectedColor, notes, renameOldNotes } = this.formState;

      if (!name || !name.trim()) {
        const errorMsg = t("error_name_required") || (t("direction") === "rtl" ? "اسم العادة مطلوب" : "Habit name is required");
        NoticeService.warning(errorMsg, this.plugin);
        this.switchTab("settings");

        if (this.managementPanel) {
          this.managementPanel.showNameError(errorMsg);
        }

        this.isSaving = false;
        if (btn) btn.disabled = false;
        return;
      }

      const calculatedLevel = ProgressionEngine.calculateLevel(this.habit, this.calculatedStats, levelData);
      const peakStreak = Math.max(
        this.habit?.savedLongestStreak || 0,
        this.calculatedStats?.longestStreak || 0,
        this.calculatedStats?.currentStreak || 0
      );

      await this.onSubmit({
        name: name.trim(),
        schedule: {
          type: scheduleType === "weekly" ? "weekly" : (selectedDays.length === 7 ? "daily" : "weekly"),
          days: selectedDays
        },
        levelData: levelData,
        currentLevel: calculatedLevel || 1,
        savedLongestStreak: peakStreak,
        habitType: habitType,
        atomicDescription: atomicDescription,
        parentId: selectedParentId || null,
        color: selectedColor || "teal",
        notes: notes || null,
        _renameInFiles: renameOldNotes
      });

      this.initialSnapshot = JSON.stringify(this.getComparableState());
      this.updateFooterActions();
      this.isSaving = false;
      this.onClose();
    } catch (e) {
      this.isSaving = false;
      const btn = saveBtn || this.saveBtn;
      if (btn) btn.disabled = false;
      NoticeService.error(e.message, this.plugin);
      console.error("[Core Habits] Save error:", e);
    }
  }

  safeClose() {
    if (this.checkDirty()) {
      const t = (k, params = {}) => this.plugin?.translationManager?.t(k, params) || k;
      const isAr = !t || (t("direction") === "rtl");
      new ConfirmModal(
        this.app,
        this.plugin,
        t("confirm_discard_changes_desc") || (isAr ? "لديك تعديلات غير محفوظة. هل تريد تجاهلها وإغلاق النافذة؟" : "You have unsaved changes. Do you want to discard them?"),
        {
          confirmText: t("discard_changes_btn") || (isAr ? "تجاهل التعديلات" : "Discard changes"),
          cancelText: t("keep_editing_btn") || (isAr ? "متابعة التعديل" : "Keep editing"),
          onConfirm: () => {
            this.onClose();
          }
        }
      ).open();
    } else {
      this.onClose();
    }
  }

  /**
   * Switch editor to a different habit cleanly without tearing down container
   */
  setHabit(newHabit, newOnSubmit) {
    this.habit = newHabit;
    if (newOnSubmit) this.onSubmit = newOnSubmit;
    this.initFormState();
    this.render();
  }

  destroy() {
    if (this.headerComponent) this.headerComponent.destroy();
    if (this.overviewPanel) this.overviewPanel.destroy();
    if (this.progressionPanel) this.progressionPanel.destroy();
    if (this.blueprintCard) this.blueprintCard.destroy();
    if (this.journeyPanel) this.journeyPanel.destroy();
    if (this.managementPanel) this.managementPanel.destroy();

    if (this.rootEl) {
      this.rootEl.empty();
      this.rootEl = null;
    }
  }
}
