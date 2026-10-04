/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { HabitEditorComponent } from "../src/components/forms/HabitEditorComponent.js";
import { HabitHeaderComponent } from "../src/components/forms/HabitHeaderComponent.js";
import { HabitOverviewPanel } from "../src/components/forms/HabitOverviewPanel.js";
import { HabitProgressionPanel } from "../src/components/forms/HabitProgressionPanel.js";
import { HabitJourneyPanel } from "../src/components/forms/HabitJourneyPanel.js";
import { HabitBlueprintCard } from "../src/components/forms/HabitBlueprintCard.js";
import { HabitManagementPanel } from "../src/components/forms/HabitManagementPanel.js";
import { EditHabitModal } from "../src/modals/EditHabitModal.js";
import { HabitEditView } from "../src/views/HabitEditView.js";
import { HabitRowFactory } from "../src/views/renderers/HabitRowFactory.js";

const mockApp = {
  vault: {
    getAbstractFileByPath: vi.fn(),
    read: vi.fn().mockResolvedValue(""),
    cachedRead: vi.fn().mockResolvedValue(""),
    getResourcePath: vi.fn().mockReturnValue("app://local/audio.webm")
  },
  metadataCache: {
    getFirstLinkpathDest: vi.fn().mockReturnValue({ path: "Habits/Morning Run.md" })
  },
  workspace: {
    openLinkText: vi.fn()
  }
};

const mockTranslation = (key, params = {}) => {
  const dict = {
    direction: "rtl",
    habit_name: "اسم العادة",
    tab_pulse: "النبض",
    tab_settings: "الإعدادات",
    tab_progression_journey: "مسار التدرج",
    tab_reflections_diary: "سجل الرحلة",
    build_habit: "بناء عادة",
    break_habit: "كسر عادة",
    level: "المحطة",
    days: "أيام",
    stats_current_label: "السلسلة النشطة",
    stats_longest_label: "الرقم القياسي",
    stats_consistency: "معدل الالتزام",
    stats_recovery_speed: "سرعة التعافي",
    save_changes_btn: "حفظ التغييرات",
    cancel: "إلغاء",
    confirm_discard_changes_desc: "لديك تعديلات غير محفوظة. هل تريد تجاهلها؟"
  };
  let str = dict[key] || key;
  Object.keys(params).forEach(p => { str = str.replace(`{${p}}`, params[p]); });
  return str;
};

const mockPlugin = {
  app: mockApp,
  settings: {
    language: "ar",
    weekStartDay: 6,
    enableHabitContext: true
  },
  translationManager: {
    t: mockTranslation
  },
  habitManager: {
    getActiveHabits: vi.fn().mockReturnValue([
      { id: "habit-1", name: "Morning Run", color: "teal", parentId: null },
      { id: "habit-2", name: "Reading", color: "blue", parentId: null }
    ]),
    isHabitScheduledForDay: vi.fn().mockReturnValue(true),
    archiveHabit: vi.fn().mockResolvedValue(),
    restoreHabit: vi.fn().mockResolvedValue(),
    updateHabit: vi.fn().mockResolvedValue()
  },
  habitJournalService: {
    getHabitCommentHistory: vi.fn().mockResolvedValue([
      { date: window.moment("2026-09-17"), text: "Great session today! ![[voice-1.webm]]" },
      { date: window.moment("2026-09-16"), text: "Read 20 pages **consistently**" }
    ]),
    saveHabitComment: vi.fn().mockResolvedValue("2026-09-17")
  },
  streakCalculator: {
    calculate: vi.fn().mockResolvedValue({
      currentStreak: 5,
      longestStreak: 14,
      consistencyScore: 80,
      consistencyLabel: "جيدة",
      consistencyCompleted: 16,
      consistencyScheduled: 20,
      recoveryScore: 1.5,
      ongoingGapLength: 0
    })
  }
};

describe("Edit Habit Experience & Architecture Tests", () => {
  let container;
  let sampleHabit;

  beforeEach(() => {
    container = document.createElement("div");
    sampleHabit = {
      id: "habit-1",
      name: "Morning Run",
      color: "teal",
      habitType: "build",
      schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] },
      currentLevel: 2,
      levelData: [
        { goal: "Run 5 mins", condition: "", achieved: true },
        { goal: "Run 15 mins", condition: "", achieved: false },
        { goal: "", condition: "", achieved: false },
        { goal: "", condition: "", achieved: false },
        { goal: "", condition: "", achieved: false }
      ],
      atomicDescription: {
        identity: "Runner",
        cue: "After Fajr",
        friction: "Put shoes by bed",
        reward: "Cold shower"
      },
      notes: "High energy morning routine",
      createdAt: window.moment("2026-07-20").valueOf()
    };
  });

  describe("HabitHeaderComponent", () => {
    it("should render color dot, title, linked note, and status pills", () => {
      const header = new HabitHeaderComponent(container, {
        app: mockApp,
        plugin: mockPlugin,
        habit: sampleHabit,
        formState: { ...sampleHabit, selectedColor: "teal", selectedDays: [0,1,2,3,4,5,6] },
        stats: { currentStreak: 5 },
        t: mockTranslation
      });

      expect(container.querySelector(".dh-hub-title").textContent).toBe("Morning Run");
      expect(container.querySelector(".dh-hub-color-dot")).not.toBeNull();
      expect(container.querySelector(".dh-file-context-link")).not.toBeNull();

      const pills = container.querySelectorAll(".dh-hub-status-pill");
      expect(pills.length).toBeGreaterThanOrEqual(2);

      // Live title and color update
      header.updateTitle("Evening Run");
      expect(container.querySelector(".dh-hub-title").textContent).toBe("Evening Run");

      header.formState.selectedColor = "blue";
      header.updateColor();
      expect(header.rootEl.style.getPropertyValue("--habit-color")).toBe("#3b82f6");
      expect(container.querySelector(".dh-hub-color-dot").style.backgroundColor).toBe("");
      expect(container.querySelector(".dh-hub-color-dot").style.boxShadow).toBe("");
    });

    it("shares the initial inherited child color with overview and weekly rows", () => {
      const parent = { id: "parent", name: "Parent", color: "rose", parentId: null };
      const child = { ...sampleHabit, color: "blue", parentId: parent.id };
      const plugin = {
        ...mockPlugin,
        habitManager: { ...mockPlugin.habitManager, getActiveHabits: () => [child, parent] }
      };
      const formState = { ...child, selectedColor: "blue", selectedParentId: parent.id };
      const header = new HabitHeaderComponent(container.createDiv(), {
        app: mockApp, plugin, habit: child, formState, t: mockTranslation
      });
      const overview = new HabitOverviewPanel(container.createDiv(), {
        plugin, habit: child, formState, t: mockTranslation
      });
      const rowColor = HabitRowFactory.buildColorMap([child, parent]).get(child.id);

      expect(rowColor).toBe("#f43f5e");
      expect(header.rootEl.style.getPropertyValue("--habit-color")).toBe(rowColor);
      expect(overview.rootEl.style.getPropertyValue("--habit-color")).toBe(rowColor);
    });
  });

  describe("HabitOverviewPanel", () => {
    it("should render score bar, trend, streak hero, mini history (28 cells), compact milestone, and notes", () => {
      const dailyHistory = [];
      for (let i = 27; i >= 0; i--) {
        dailyHistory.push({
          date: `2026-06-${String(30 - i).padStart(2, '0')}`,
          status: i % 2 === 0 ? "completed" : "missed"
        });
      }

      new HabitOverviewPanel(container, {
        habit: sampleHabit,
        formState: sampleHabit,
        stats: {
          currentStreak: 5,
          longestStreak: 14,
          consistencyScore: 80,
          consistencyLabel: "جيدة",
          consistencyCompleted: 16,
          consistencyScheduled: 20,
          trendDelta: 12,
          trendDirection: "up",
          recoveryScore: 1.5,
          dailyHistory
        },
        onSwitchTab: vi.fn(),
        t: mockTranslation
      });

      // 1. Score Bar & Trend
      expect(container.querySelector(".dh-pulse-score-card")).not.toBeNull();
      expect(container.querySelector(".dh-pulse-score-bar")).not.toBeNull();
      expect(container.querySelector(".dh-pulse-score-value").textContent).toContain("80%");
      const trendBadge = container.querySelector(".dh-pulse-trend-badge.trend-up");
      expect(trendBadge).not.toBeNull();
      expect(trendBadge.textContent).toContain("+12%");

      // 2. Metrics Section (Streak Hero & Secondary Pills)
      const streakHero = container.querySelector(".dh-pulse-streak-hero");
      expect(streakHero).not.toBeNull();
      expect(streakHero.textContent).toContain("5");

      const longestPill = container.querySelector(".dh-pill-longest");
      expect(longestPill.textContent).toContain("14");

      const recoveryPill = container.querySelector(".dh-pill-recovery");
      expect(recoveryPill.textContent).toContain("1.5");

      // 3. Mini History Strip (28 cells)
      expect(container.querySelector(".dh-pulse-history-card")).not.toBeNull();
      const cells = container.querySelectorAll(".dh-pulse-history-cell");
      expect(cells.length).toBe(28);

      // 4. Duplicate milestones and notes removed from Overview
      expect(container.querySelector(".dh-pulse-recent-notes")).toBeNull();
    });

    it("should handle null stats gracefully with pending placeholders", () => {
      new HabitOverviewPanel(container, {
        habit: sampleHabit,
        formState: sampleHabit,
        stats: null,
        t: mockTranslation
      });

      expect(container.querySelector(".dh-pulse-score-card")).not.toBeNull();
      const pendingScore = container.querySelector(".dh-pulse-score-value.is-pending");
      expect(pendingScore).not.toBeNull();
      expect(pendingScore.textContent).toContain("—");

      // Fallback 28 cells still rendered
      const cells = container.querySelectorAll(".dh-pulse-history-cell");
      expect(cells.length).toBe(28);
    });
  });

  describe("HabitProgressionPanel", () => {
    it("should render 5-stage visual stepper track, focus card, collapsible details, and emit levelData changes", () => {
      const onChangeMock = vi.fn();
      new HabitProgressionPanel(container, {
        habit: sampleHabit,
        stats: { currentStreak: 5, longestStreak: 5 },
        levelData: sampleHabit.levelData,
        onChange: onChangeMock,
        t: mockTranslation
      });

      // 1. Unified 5-Stage Visual Stepper Track (visible in one view)
      const stepperTrack = container.querySelector(".dh-progression-stepper-track");
      expect(stepperTrack).not.toBeNull();
      const stepNodes = container.querySelectorAll(".dh-stepper-step");
      expect(stepNodes.length).toBe(5);
      expect(stepNodes[0].classList.contains("is-achieved")).toBe(true);
      expect(stepNodes[1].classList.contains("is-current")).toBe(true);
      expect(stepNodes[2].classList.contains("is-upcoming")).toBe(true);

      // 2. Focus Hero Card
      const focusCard = container.querySelector(".dh-progression-focus-card");
      expect(focusCard).not.toBeNull();
      expect(container.querySelector(".dh-pulse-milestone-bar")).not.toBeNull();

      // Hero banner and guide card removed, duplicate bottom accordion eliminated
      expect(container.querySelector(".dh-journey-hero-card")).toBeNull();
      expect(container.querySelector(".dh-journey-guide-card")).toBeNull();
      expect(container.querySelector(".dh-progression-details")).toBeNull();

      // Stepper node selection switches focus card to that milestone
      stepNodes[0].click();
      const updatedFocusCard = container.querySelector(".dh-progression-focus-card");
      expect(updatedFocusCard).not.toBeNull();
      expect(updatedFocusCard.textContent).toContain("Run 5 mins");

      // Edit goal trigger on focus card
      const editBtn = updatedFocusCard.querySelector(".dh-milestone-edit-goal-btn");
      expect(editBtn).not.toBeNull();
      editBtn.click();

      const input = container.querySelector(".dh-milestone-goal-input");
      expect(input).not.toBeNull();
      expect(input.value).toBe("Run 5 mins");

      // Update goal
      input.value = "Run 10 mins";
      const saveBtn = container.querySelector(".dh-milestone-goal-actions button.mod-cta");
      saveBtn.click();

      expect(onChangeMock).toHaveBeenCalled();
      expect(onChangeMock.mock.calls[0][0][0].goal).toBe("Run 10 mins");
    });
  });

  describe("HabitJourneyPanel", () => {
    it("should render collapsed details, load comment history, and render audio player", async () => {
      const panel = new HabitJourneyPanel(container, {
        app: mockApp,
        plugin: mockPlugin,
        habit: sampleHabit,
        formState: sampleHabit,
        initiallyOpen: false,
        t: mockTranslation
      });

      // Wrapped in details element, collapsed by default
      const details = container.querySelector(".dh-journey-details");
      expect(details).not.toBeNull();
      expect(details.open).toBe(false);

      // Large H3 removed
      expect(container.querySelector(".dh-journey-title")).toBeNull();

      // Add note button exists
      expect(container.querySelector(".dh-journey-add-btn")).not.toBeNull();

      // openDetails opens the accordion
      panel.openDetails();
      expect(details.open).toBe(true);

      await panel.loadAndRenderEntries();

      // Monthly group
      const monthGroups = container.querySelectorAll(".dh-log-month-group");
      expect(monthGroups.length).toBeGreaterThan(0);

      // Entries
      const entries = container.querySelectorAll(".dh-journey-entry-card");
      expect(entries.length).toBe(2);

      // Audio player rendered for voice note
      const audio = container.querySelector("audio");
      expect(audio).not.toBeNull();
      expect(audio.getAttribute("src")).toBe("app://local/audio.webm");

      // Formatted bold text
      expect(container.querySelector("strong")).not.toBeNull();
      expect(container.querySelector("strong").textContent).toBe("consistently");
    });
  });

  describe("HabitBlueprintCard", () => {
    it("should render 4 atomic blueprint items and notes in display mode with values and placeholders", () => {
      new HabitBlueprintCard(container, {
        habitType: "build",
        atomicDescription: sampleHabit.atomicDescription,
        notes: "Daily habit motivation",
        t: mockTranslation
      });

      expect(container.querySelector(".dh-blueprint-card.is-display")).not.toBeNull();
      const items = container.querySelectorAll(".dh-blueprint-item");
      expect(items.length).toBe(4);

      // Verify all items have value class and text
      expect(items[0].classList.contains("has-value")).toBe(true);
      expect(items[0].textContent).toContain("Runner");
      expect(items[1].textContent).toContain("After Fajr");
      expect(items[2].textContent).toContain("Put shoes by bed");
      expect(items[3].textContent).toContain("Cold shower");

      // Verify notes item exists in blueprint card
      const notesItem = container.querySelector(".dh-blueprint-notes-item");
      expect(notesItem).not.toBeNull();
      expect(notesItem.textContent).toContain("Daily habit motivation");
    });

    it("should toggle between display and edit mode, and emit changes", () => {
      const onChangeMock = vi.fn();
      new HabitBlueprintCard(container, {
        habitType: "build",
        atomicDescription: { identity: "", cue: "", friction: "", reward: "" },
        notes: "",
        onChange: onChangeMock,
        t: mockTranslation
      });

      // Initially empty items have placeholder and is-empty class
      const emptyItem = container.querySelector(".dh-blueprint-item.is-empty");
      expect(emptyItem).not.toBeNull();

      // Click toggle button to enter edit mode
      const toggleBtn = container.querySelector(".dh-blueprint-toggle-btn");
      toggleBtn.click();

      expect(container.querySelector(".dh-blueprint-card.is-editing")).not.toBeNull();
      const inputs = container.querySelectorAll(".dh-behavior-input");
      expect(inputs.length).toBe(4);

      // Notes textarea in edit mode
      const notesArea = container.querySelector(".dh-notes-input");
      expect(notesArea).not.toBeNull();

      // Type in identity
      inputs[0].value = "Avid Reader";
      inputs[0].dispatchEvent(new Event("input"));

      expect(onChangeMock).toHaveBeenCalled();
      expect(onChangeMock.mock.calls[0][0].identity).toBe("Avid Reader");

      // Click done button
      const doneBtn = container.querySelector(".dh-blueprint-done-btn");
      doneBtn.click();

      expect(container.querySelector(".dh-blueprint-card.is-display")).not.toBeNull();
      expect(container.querySelector(".dh-blueprint-value-text").textContent).toBe("Avid Reader");
    });
  });

  describe("HabitManagementPanel", () => {
    it("should render name input, rename warning, type switch, parent hierarchy, and lifecycle section", () => {
      const onFieldChangeMock = vi.fn();
      const onNameChangeMock = vi.fn();

      new HabitManagementPanel(container, {
        plugin: mockPlugin,
        habit: sampleHabit,
        formState: {
          name: "Morning Run",
          selectedColor: "teal",
          selectedParentId: null,
          selectedDays: [0, 1, 2, 3, 4, 5, 6],
          scheduleType: "daily",
          habitType: "build",
          atomicDescription: sampleHabit.atomicDescription,
          notes: "Sample note",
          renameOldNotes: false
        },
        onFieldChange: onFieldChangeMock,
        onNameChange: onNameChangeMock,
        t: mockTranslation
      });

      const nameInput = container.querySelector(".dh-name-input-wide");
      expect(nameInput.value).toBe("Morning Run");

      // Type in name input triggers rename warning
      nameInput.value = "Sunrise Jog";
      nameInput.dispatchEvent(new Event("input"));

      expect(onNameChangeMock).toHaveBeenCalledWith("Sunrise Jog");
      expect(container.querySelector(".dh-rename-warning-card").style.display).toBe("flex");

      // Notes removed from management panel (consolidated into blueprint card)
      expect(container.querySelector(".dh-notes-input")).toBeNull();

      // Lifecycle section and metadata grid present
      expect(container.querySelector(".dh-management-lifecycle-section")).not.toBeNull();
      expect(container.querySelector(".dh-lifecycle-meta-grid")).not.toBeNull();
      expect(container.querySelector(".dh-meta-age-item")).not.toBeNull();
      expect(container.querySelector(".dh-meta-date-item")).not.toBeNull();
      expect(container.querySelector(".dh-meta-file-item")).not.toBeNull();
    });
  });

  describe("HabitEditorComponent Orchestrator", () => {
    it("keeps header and overview synchronized across draft parent changes and color selection", () => {
      const parent = { id: "parent", name: "Parent", color: "rose", parentId: null };
      const secondParent = { id: "second-parent", name: "Second Parent", color: "green", parentId: null };
      const child = { ...sampleHabit, color: "blue", parentId: parent.id };
      const plugin = {
        ...mockPlugin,
        habitManager: { ...mockPlugin.habitManager, getActiveHabits: () => [child, parent, secondParent] }
      };
      const editor = new HabitEditorComponent(container, {
        app: mockApp, plugin, habit: child, onSubmit: vi.fn(), isModal: true
      });
      const expectColor = (hex) => {
        expect(editor.headerComponent.rootEl.style.getPropertyValue("--habit-color")).toBe(hex);
        expect(editor.overviewPanel.rootEl.style.getPropertyValue("--habit-color")).toBe(hex);
      };
      expectColor("#f43f5e");

      const parentSelect = container.querySelector(".dh-parent-select");
      parentSelect.value = secondParent.id;
      parentSelect.dispatchEvent(new Event("change"));
      expectColor("#10b981");

      parentSelect.value = "";
      parentSelect.dispatchEvent(new Event("change"));
      expectColor("#3b82f6");

      const pinkSwatch = [...container.querySelectorAll(".dh-color-swatch")]
        .find(swatch => swatch.style.getPropertyValue("--swatch-color") === "#ec4899");
      pinkSwatch.click();
      expect(editor.formState.selectedColor).toBe("pink");
      expectColor("#ec4899");
      expect(child.color).toBe("blue");
      expect(child.parentId).toBe(parent.id);
    });

    it("should initialize on pulse tab, preserve formState across tab switches, and detect dirty state", () => {
      const editor = new HabitEditorComponent(container, {
        app: mockApp,
        plugin: mockPlugin,
        habit: sampleHabit,
        onSubmit: vi.fn(),
        isModal: true
      });

      expect(editor.activeTab).toBe("pulse");
      expect(container.querySelector("#panel-pulse.is-active")).not.toBeNull();
      expect(editor.checkDirty()).toBe(false);
      // Footer always visible; Save disabled when not dirty
      const saveBtn = container.querySelector(".dh-save-btn");
      expect(saveBtn).not.toBeNull();
      expect(saveBtn.disabled).toBe(true);

      // Switch to settings tab
      editor.switchTab("settings");
      expect(container.querySelector("#panel-settings.is-active")).not.toBeNull();
      expect(saveBtn.disabled).toBe(true);

      // Mutate formState in settings
      editor.formState.name = "Trail Run";
      expect(editor.checkDirty()).toBe(true);
      editor.updateFooterActions();
      expect(saveBtn.disabled).toBe(false);
      expect(saveBtn.classList.contains("mod-cta")).toBe(true);

      // Switch to pulse tab and verify state preserved and Save stays active due to dirty
      editor.switchTab("pulse");
      expect(container.querySelector("#panel-pulse.is-active")).not.toBeNull();
      expect(editor.formState.name).toBe("Trail Run"); // State preserved!
      expect(editor.checkDirty()).toBe(true);
      expect(saveBtn.disabled).toBe(false);

      // Revert name
      editor.formState.name = "Morning Run";
      expect(editor.checkDirty()).toBe(false);
      editor.updateFooterActions();
      expect(saveBtn.disabled).toBe(true);
    });

    it("should mount blueprint card in pulse tab, update formState and reveal footer when edited", () => {
      const editor = new HabitEditorComponent(container, {
        app: mockApp,
        plugin: mockPlugin,
        habit: sampleHabit,
        onSubmit: vi.fn(),
        isModal: true
      });

      expect(container.querySelector(".dh-pulse-section-blueprint")).not.toBeNull();
      const blueprintCard = container.querySelector(".dh-blueprint-card");
      expect(blueprintCard).not.toBeNull();
      expect(editor.checkDirty()).toBe(false);

      // Switch to edit mode on blueprint card
      const toggleBtn = blueprintCard.querySelector(".dh-blueprint-toggle-btn");
      toggleBtn.click();

      // Change cue input
      const inputs = container.querySelectorAll(".dh-blueprint-card .dh-behavior-input");
      inputs[1].value = "Immediately after sunrise";
      inputs[1].dispatchEvent(new Event("input"));

      expect(editor.formState.atomicDescription.cue).toBe("Immediately after sunrise");
      expect(editor.checkDirty()).toBe(true);
      expect(container.querySelector(".dh-modal-actions.is-hidden")).toBeNull();
    });

    it("should prevent submission and show inline error when name is empty", async () => {
      const onSubmitMock = vi.fn();
      const editor = new HabitEditorComponent(container, {
        app: mockApp,
        plugin: mockPlugin,
        habit: sampleHabit,
        onSubmit: onSubmitMock,
        isModal: true
      });

      editor.formState.name = "";
      const saveBtn = container.querySelector(".dh-save-btn");
      await editor.saveHabit(saveBtn, mockTranslation);

      expect(onSubmitMock).not.toHaveBeenCalled();
      expect(editor.activeTab).toBe("settings");
    });

    it("should save habit and close when validation passes", async () => {
      const onSubmitMock = vi.fn().mockResolvedValue();
      const onCloseMock = vi.fn();

      const editor = new HabitEditorComponent(container, {
        app: mockApp,
        plugin: mockPlugin,
        habit: sampleHabit,
        onSubmit: onSubmitMock,
        onClose: onCloseMock,
        isModal: true
      });

      editor.formState.name = "Morning Run";
      const saveBtn = container.querySelector(".dh-save-btn");
      await editor.saveHabit(saveBtn, mockTranslation);

      expect(onSubmitMock).toHaveBeenCalled();
      expect(onSubmitMock.mock.calls[0][0].name).toBe("Morning Run");
      expect(onCloseMock).toHaveBeenCalled();
    });

    it("should consolidate Settings Tab, keep footer hidden until dirty, hide on save, and update header live", async () => {
      const onSubmitMock = vi.fn().mockResolvedValue();
      const editor = new HabitEditorComponent(container, {
        app: mockApp,
        plugin: mockPlugin,
        habit: sampleHabit,
        onSubmit: onSubmitMock,
        isModal: true
      });

      // 1. Initial State: Footer is always visible, Save button is disabled
      const footer = container.querySelector(".dh-modal-actions");
      expect(footer).not.toBeNull();
      const saveBtn = footer.querySelector(".dh-save-btn");
      expect(saveBtn).not.toBeNull();
      expect(saveBtn.disabled).toBe(true);

      // 2. Lifecycle section is in settings tab, not in footer
      editor.switchTab("settings");
      const lifecycleSection = container.querySelector(".dh-management-lifecycle-section");
      expect(lifecycleSection).not.toBeNull();
      const archiveBtn = lifecycleSection.querySelector(".dh-lifecycle-btn.mod-archive");
      expect(archiveBtn).not.toBeNull();
      expect(footer.querySelector(".dh-lifecycle-btn")).toBeNull();

      // 3. Modifying name input updates header live and enables Save button
      const nameInput = container.querySelector(".dh-name-input-wide");
      expect(nameInput).not.toBeNull();
      nameInput.value = "Updated Habit Name";
      nameInput.dispatchEvent(new Event("input"));

      // Header title updated live
      const headerTitle = container.querySelector(".dh-hub-title");
      expect(headerTitle.textContent).toBe("Updated Habit Name");
      // Save button now active
      expect(saveBtn.disabled).toBe(false);
      expect(saveBtn.classList.contains("mod-cta")).toBe(true);

      // 4. Color change updates header accent live
      const swatches = container.querySelectorAll(".dh-color-swatch");
      expect(swatches.length).toBeGreaterThan(1);
      swatches[1].click();
      expect(editor.formState.selectedColor).not.toBe("teal");

      // 5. Saving updates snapshot and re-disables Save button
      await editor.saveHabit(saveBtn, mockTranslation);
      expect(onSubmitMock).toHaveBeenCalled();
      expect(saveBtn.disabled).toBe(true);
      expect(editor.checkDirty()).toBe(false);
    });

    it("should provide full WAI-ARIA accessibility semantics for tabs, progressbar, and history grid", () => {
      const editor = new HabitEditorComponent(container, {
        app: mockApp,
        plugin: mockPlugin,
        habit: sampleHabit,
        onSubmit: vi.fn(),
        isModal: true
      });

      // 1. Tablist semantics
      const tablist = container.querySelector('.dh-modal-tabs-container[role="tablist"]');
      expect(tablist).not.toBeNull();

      const pulseTab = container.querySelector('#tab-pulse[role="tab"]');
      const settingsTab = container.querySelector('#tab-settings[role="tab"]');
      expect(pulseTab).not.toBeNull();
      expect(settingsTab).not.toBeNull();
      expect(pulseTab.getAttribute("aria-selected")).toBe("true");
      expect(settingsTab.getAttribute("aria-selected")).toBe("false");

      // 2. Tabpanel semantics
      const pulsePanel = container.querySelector('#panel-pulse[role="tabpanel"]');
      const settingsPanel = container.querySelector('#panel-settings[role="tabpanel"]');
      expect(pulsePanel).not.toBeNull();
      expect(settingsPanel).not.toBeNull();

      // 3. Tab switching updates aria-selected
      editor.switchTab("settings");
      expect(pulseTab.getAttribute("aria-selected")).toBe("false");
      expect(settingsTab.getAttribute("aria-selected")).toBe("true");

      // 4. Progressbar semantics in score bar
      const progressbar = container.querySelector('.dh-pulse-score-track[role="progressbar"]');
      expect(progressbar).not.toBeNull();
      expect(progressbar.getAttribute("aria-valuemin")).toBe("0");
      expect(progressbar.getAttribute("aria-valuemax")).toBe("100");

      // 5. Grid semantics in mini history
      const historyGrid = container.querySelector('.dh-pulse-history-grid[role="grid"]');
      expect(historyGrid).not.toBeNull();
      const gridcells = historyGrid.querySelectorAll('[role="gridcell"]');
      expect(gridcells.length).toBe(28);
      expect(gridcells[0].getAttribute("aria-label")).toBeTruthy();
    });
  });

  describe("Modal and Popout Integration", () => {
    it("should delegate isDirty in EditHabitModal to editorComponent", () => {
      const modal = new EditHabitModal(mockApp, mockPlugin, sampleHabit, vi.fn());
      modal.onOpen();

      expect(modal.isDirty()).toBe(false);
      modal.formState.name = "Modified Habit";
      expect(modal.isDirty()).toBe(true);
      modal.close();
    });

    it("should delegate isDirty in HabitEditView to editorComponent", () => {
      const mockLeaf = { detach: vi.fn(), updateHeader: vi.fn() };
      const view = new HabitEditView(mockLeaf, mockPlugin);
      view.containerEl = document.createElement("div");
      view.contentEl = document.createElement("div");

      view.setHabit(sampleHabit, vi.fn());
      expect(view.isDirty()).toBe(false);

      view.editorComponent.formState.name = "Modified Habit";
      expect(view.isDirty()).toBe(true);
      view.onClose();
    });
  });
});
