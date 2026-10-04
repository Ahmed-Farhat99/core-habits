/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { HabitSchedulePicker } from "../src/components/forms/HabitSchedulePicker.js";
import { HabitColorPicker } from "../src/components/forms/HabitColorPicker.js";
import { AddHabitModal } from "../src/modals/AddHabitModal.js";
import { EditHabitModal } from "../src/modals/EditHabitModal.js";
import { HabitEditorComponent } from "../src/components/forms/HabitEditorComponent.js";
import { HabitEditView } from "../src/views/HabitEditView.js";
import { VIEW_TYPE_HABIT_EDIT } from "../src/config/headings.js";
import { Platform } from "obsidian";

// Mock Obsidian helpers for JSDOM
const dict = {
  color_inherited_from_parent: "Inherited from parent ({parent})",
  add_habit_title: "Add New Habit",
  edit_habit_title: "Edit Habit",
  habit_name: "Habit name",
  save_btn: "Save",
  cancel: "Cancel",
  tab_basics_schedule: "Basics & Schedule",
  tab_levels_progression: "Levels & Milestones",
  tab_logs_reflections: "Log & Reflections",
};
const mockTranslation = (key, params = {}) => {
  let str = dict[key] || key;
  Object.keys(params).forEach(p => { str = str.replace(`{${p}}`, params[p]); });
  return str;
};

describe("Habit Form Components & Modals Tests", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
  });

  describe("HabitSchedulePicker", () => {
    it("should initialize with all 7 days by default as daily", () => {
      const picker = new HabitSchedulePicker(container, {
        initialDays: [0, 1, 2, 3, 4, 5, 6],
        weekStartDay: 0,
        onChange: vi.fn(),
        t: mockTranslation
      });

      expect(picker.getSelectedDays()).toEqual([0, 1, 2, 3, 4, 5, 6]);
      const chips = container.querySelectorAll(".day-chip-clean");
      expect(chips.length).toBe(7);
      chips.forEach(chip => {
        expect(chip.classList.contains("is-selected")).toBe(true);
      });
    });

    it("should toggle a day and report weekly type when fewer than 7 days selected", () => {
      let result = null;
      new HabitSchedulePicker(container, {
        initialDays: [0, 1, 2, 3, 4, 5, 6],
        weekStartDay: 0,
        onChange: (data) => { result = data; },
        t: mockTranslation
      });

      const firstChip = container.querySelector(".day-chip-clean");
      firstChip.click();

      expect(result).not.toBeNull();
      expect(result.type).toBe("weekly");
      expect(result.days.length).toBe(6);
    });
  });

  describe("HabitColorPicker", () => {
    it("should render color swatches and select color", () => {
      let selected = "teal";
      new HabitColorPicker(container, {
        selectedColor: "teal",
        parentHabit: null,
        onChange: (c) => { selected = c; },
        t: mockTranslation
      });

      const swatches = container.querySelectorAll(".dh-color-swatch");
      expect(swatches.length).toBeGreaterThan(5);

      // Click blue swatch
      const blueSwatch = container.querySelector('.dh-color-swatch[title="color_blue"]') 
        || container.querySelector('.dh-color-swatch[aria-label="color_blue"]');
      expect(blueSwatch).not.toBeNull();
      blueSwatch.click();
      expect(selected).toBe("blue");
    });

    it("should display inherited feedback when parentHabit is present", () => {
      new HabitColorPicker(container, {
        selectedColor: "teal",
        parentHabit: { name: "الصلاة", color: "green" },
        onChange: vi.fn(),
        t: mockTranslation
      });

      expect(container.querySelector(".dh-color-inherited-card")).not.toBeNull();
      expect(container.textContent).toContain("الصلاة");
    });
  });

  describe("AddHabitModal and EditHabitModal Integration", () => {
    let mockPlugin;
    let mockApp;

    beforeEach(() => {
      mockApp = {
        vault: {
          getAbstractFileByPath: vi.fn().mockReturnValue(null)
        },
        metadataCache: {
          getFirstLinkpathDest: vi.fn().mockReturnValue({ path: "Morning Run.md" })
        },
        workspace: {
          openLinkText: vi.fn()
        }
      };

      mockPlugin = {
        app: mockApp,
        settings: {
          language: "en",
          weekStartDay: 0,
          enableHabitContext: false
        },
        translationManager: {
          t: mockTranslation
        },
        statsService: {
          getHabitStatus: vi.fn().mockResolvedValue("uncompleted")
        },
        fileManager: {
          getHabitStatus: vi.fn().mockReturnValue(false)
        },
        habitManager: {
          getActiveHabits: vi.fn().mockReturnValue([]),
          isHabitScheduledForDay: vi.fn().mockReturnValue(true)
        }
      };
    });

    it("should construct AddHabitModal cleanly without tabs or streak banner", () => {
      const modal = new AddHabitModal(mockApp, mockPlugin, vi.fn());
      modal.onOpen();

      expect(modal.contentEl.querySelector(".dh-modal-tabs-container")).toBeNull();
      expect(modal.contentEl.querySelector(".dh-pulse-card")).toBeNull();
      expect(modal.contentEl.querySelector(".dh-name-input-wide")).not.toBeNull();
      expect(modal.contentEl.querySelector(".dh-btn.mod-cta")).not.toBeNull();
    });

    it("should construct EditHabitModal with tabs, sleek status bar, permanent footer actions, and file row", () => {
      const existingHabit = {
        id: "habit-1",
        name: "Morning Run",
        color: "teal",
        schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] },
        currentLevel: 1,
        levelData: Array(5).fill().map(() => ({ goal: "", condition: "", achieved: false }))
      };

      const modal = new EditHabitModal(mockApp, mockPlugin, existingHabit, vi.fn());
      modal.onOpen();

      expect(modal.contentEl.querySelector(".dh-modal-tabs-container")).not.toBeNull();
      // Phase 3: No more pulse card bloat in header
      expect(modal.contentEl.querySelector(".dh-pulse-card")).toBeNull();
      expect(modal.contentEl.querySelector(".dh-hub-status-bar")).not.toBeNull();
      expect(modal.contentEl.querySelector(".dh-file-context-icon-btn")).not.toBeNull();
      // Phase 3: Permanently visible footer buttons
      expect(modal.contentEl.querySelector(".dh-save-btn")).not.toBeNull();
      expect(modal.contentEl.querySelector(".dh-cancel-btn")).not.toBeNull();
      expect(modal.contentEl.querySelector(".dh-lifecycle-btn")).not.toBeNull();
      expect(modal.checkDirty()).toBe(false);

      // Mutate name to test dirty state detection
      modal.formState.name = "Evening Run";
      expect(modal.checkDirty()).toBe(true);
    });

    it("should successfully execute saveHabit without ReferenceError", async () => {
      const existingHabit = {
        id: "habit-1",
        name: "Morning Run",
        color: "teal",
        schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] },
        currentLevel: 1,
        levelData: Array(5).fill().map(() => ({ goal: "", condition: "", achieved: false }))
      };

      const onSubmitMock = vi.fn().mockResolvedValue();
      const modal = new EditHabitModal(mockApp, mockPlugin, existingHabit, onSubmitMock);
      modal.close = vi.fn();
      modal.onOpen();

      const saveBtn = modal.contentEl.querySelector(".dh-save-btn");
      await modal.saveHabit(saveBtn, mockTranslation);

      expect(onSubmitMock).toHaveBeenCalled();
      expect(onSubmitMock.mock.calls[0][0].name).toBe("Morning Run");
      expect(onSubmitMock.mock.calls[0][0].currentLevel).toBe(1);
    });

    it("should handle restore lifecycle action from footer button when habit is archived", async () => {
      const archivedHabit = {
        id: "habit-1",
        name: "Morning Run",
        color: "teal",
        archived: true,
        schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] },
        currentLevel: 1,
        levelData: Array(5).fill().map(() => ({ goal: "", condition: "", achieved: false }))
      };

      mockPlugin.habitManager.restoreHabit = vi.fn().mockResolvedValue({ ...archivedHabit, archived: false });
      const modal = new EditHabitModal(mockApp, mockPlugin, archivedHabit, vi.fn());
      modal.close = vi.fn();
      modal.onOpen();

      const restoreBtn = modal.contentEl.querySelector(".dh-lifecycle-btn.mod-restore");
      expect(restoreBtn).not.toBeNull();

      await modal.handleLifecycleAction(restoreBtn, true, mockTranslation);
      expect(mockPlugin.habitManager.restoreHabit).toHaveBeenCalledWith("habit-1");
      expect(modal.close).toHaveBeenCalled();
    });

    it.each([
      {
        name: "EditHabitModal",
        createModal: () => {
          const m = new EditHabitModal(
            mockApp,
            mockPlugin,
            {
              id: "habit-1",
              name: "Morning Run",
              color: "teal",
              schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] },
              currentLevel: 1,
            },
            vi.fn()
          );
          m.onOpen();
          m.switchTab("management");
          return m;
        }
      },
      {
        name: "AddHabitModal",
        createModal: () => {
          const m = new AddHabitModal(mockApp, mockPlugin, vi.fn());
          m.onOpen();
          return m;
        }
      }
    ])("should show inline validation hint and dh-input-error on empty name submission in $name", async ({ createModal }) => {
      const modal = createModal();
      const nameInput = modal.contentEl.querySelector(".dh-name-input-wide");
      const hint = modal.contentEl.querySelector(".dh-inline-validation-hint");
      const saveBtn = modal.contentEl.querySelector(".dh-btn.mod-cta");

      modal.formState.name = "";
      nameInput.value = "";

      await modal.saveHabit(saveBtn, mockTranslation);

      expect(hint.style.display).toBe("block");
      expect(nameInput.classList.contains("dh-input-error")).toBe(true);

      // Typing in input should clear the error
      nameInput.value = "New Habit Name";
      nameInput.dispatchEvent(new Event("input"));

      expect(hint.style.display).toBe("none");
      expect(nameInput.classList.contains("dh-input-error")).toBe(false);
    });

    it("should render AddHabitModal with clean layout, type switch, and grouped footer actions", () => {
      const modal = new AddHabitModal(mockApp, mockPlugin, vi.fn());
      modal.onOpen();

      // No starter presets clutter
      expect(modal.contentEl.querySelector(".dh-presets-wrapper")).toBeNull();
      expect(modal.contentEl.querySelector(".dh-preset-chip")).toBeNull();

      // Type switch rendered with pill buttons
      const pillSwitch = modal.contentEl.querySelector(".dh-pill-switch");
      expect(pillSwitch).not.toBeNull();
      const buildBtn = pillSwitch.querySelector(".dh-pill-btn.build");
      const breakBtn = pillSwitch.querySelector(".dh-pill-btn.break");
      expect(buildBtn).not.toBeNull();
      expect(breakBtn).not.toBeNull();
      expect(buildBtn.classList.contains("is-active")).toBe(true);

      // Actions footer grouped side-by-side
      const actionsEnd = modal.contentEl.querySelector(".dh-modal-actions-end");
      expect(actionsEnd).not.toBeNull();
      expect(actionsEnd.querySelector(".dh-cancel-btn")).not.toBeNull();
      expect(actionsEnd.querySelector(".dh-create-btn")).not.toBeNull();
    });

    it("should allow switching habitType to break and submitting new habit cleanly", async () => {
      const onSubmitMock = vi.fn().mockResolvedValue();
      const modal = new AddHabitModal(mockApp, mockPlugin, onSubmitMock);
      modal.close = vi.fn();
      modal.onOpen();

      // Find break pill
      const breakBtn = modal.contentEl.querySelector(".dh-pill-btn.break");
      const buildBtn = modal.contentEl.querySelector(".dh-pill-btn.build");
      expect(breakBtn).not.toBeNull();

      breakBtn.click();
      expect(modal.formState.habitType).toBe("break");
      expect(breakBtn.classList.contains("is-active")).toBe(true);
      expect(buildBtn.classList.contains("is-active")).toBe(false);

      // Set name
      const nameInput = modal.contentEl.querySelector(".dh-name-input-wide");
      nameInput.value = "Quit Smoking";
      nameInput.dispatchEvent(new Event("input"));

      const saveBtn = modal.contentEl.querySelector(".dh-btn.mod-cta");
      await modal.saveHabit(saveBtn, mockTranslation);

      expect(onSubmitMock).toHaveBeenCalled();
      const submitted = onSubmitMock.mock.calls[0][0];
      expect(submitted.name).toBe("Quit Smoking");
      expect(submitted.habitType).toBe("break");
      expect(submitted.atomicDescription).toEqual({});
      expect(submitted.notes).toBeNull();
    });

    describe("AddHabitModal dirty state and lifecycle", () => {
      it("should be clean upon initial opening and remain clean with whitespace", () => {
        const modal = new AddHabitModal(mockApp, mockPlugin, vi.fn());
        expect(modal.isDirty()).toBe(false);

        modal.formState.name = "   ";
        expect(modal.isDirty()).toBe(false);
      });

      it("should be dirty when user mutates name, habitType, color, parentId, or schedule", () => {
        const modal = new AddHabitModal(mockApp, mockPlugin, vi.fn());
        
        modal.formState.name = "Morning Walk";
        expect(modal.isDirty()).toBe(true);

        modal.formState.name = "";
        expect(modal.isDirty()).toBe(false);

        modal.formState.habitType = "break";
        expect(modal.isDirty()).toBe(true);
        modal.formState.habitType = "build";

        modal.formState.selectedColor = "orange";
        expect(modal.isDirty()).toBe(true);
        modal.formState.selectedColor = "teal";

        modal.formState.selectedParentId = "parent-1";
        expect(modal.isDirty()).toBe(true);
        modal.formState.selectedParentId = null;

        modal.formState.selectedDays = [0, 1, 2, 3, 4];
        expect(modal.isDirty()).toBe(true);
      });

      it("should close directly without prompting when modal is clean", () => {
        const modal = new AddHabitModal(mockApp, mockPlugin, vi.fn());
        const promptSpy = vi.spyOn(modal, "promptDiscardConfirmation");

        expect(modal.isDirty()).toBe(false);
        modal.close();

        expect(promptSpy).not.toHaveBeenCalled();
      });

      it("should intercept close and prompt discard confirmation when dirty", () => {
        const modal = new AddHabitModal(mockApp, mockPlugin, vi.fn());
        modal.formState.name = "My Habit";

        let discardCallback = null;
        let keepCallback = null;

        vi.spyOn(modal, "promptDiscardConfirmation").mockImplementation((onDiscard, onKeepEditing) => {
          discardCallback = onDiscard;
          keepCallback = onKeepEditing;
        });
        const forceCloseSpy = vi.spyOn(modal, "forceClose");

        modal.close();

        expect(modal.promptDiscardConfirmation).toHaveBeenCalled();
        expect(forceCloseSpy).not.toHaveBeenCalled();

        if (typeof keepCallback === "function") keepCallback();
        expect(forceCloseSpy).not.toHaveBeenCalled();

        if (typeof discardCallback === "function") discardCallback();
        else modal.forceClose();
        expect(forceCloseSpy).toHaveBeenCalled();
      });

      it("should bypass discard confirmation on successful saveHabit", async () => {
        const onSubmit = vi.fn().mockResolvedValue();
        const modal = new AddHabitModal(mockApp, mockPlugin, onSubmit);
        modal.onOpen();

        modal.formState.name = "Read 10 Pages";
        expect(modal.isDirty()).toBe(true);

        const promptSpy = vi.spyOn(modal, "promptDiscardConfirmation");
        const forceCloseSpy = vi.spyOn(modal, "forceClose");

        await modal.saveHabit(null, mockTranslation);

        expect(onSubmit).toHaveBeenCalled();
        expect(promptSpy).not.toHaveBeenCalled();
        expect(forceCloseSpy).toHaveBeenCalled();
      });
    });
  });

  describe("Native Popout & HabitEditorComponent Architecture", () => {
    let mockPlugin;
    let mockApp;
    let sampleHabit;

    beforeEach(() => {
      sampleHabit = {
        id: "habit-popout-1",
        name: "Deep Focus",
        color: "teal",
        habitType: "build",
        schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] },
        currentLevel: 1,
        levelData: Array(5).fill().map(() => ({ goal: "", condition: "", achieved: false }))
      };

      mockApp = {
        vault: { getAbstractFileByPath: vi.fn().mockReturnValue(null) },
        metadataCache: { getFirstLinkpathDest: vi.fn().mockReturnValue(null) },
        workspace: {
          openLinkText: vi.fn(),
          getLeavesOfType: vi.fn().mockReturnValue([]),
          openPopoutLeaf: vi.fn(),
          setActiveLeaf: vi.fn()
        }
      };

      mockPlugin = {
        app: mockApp,
        settings: { language: "en", weekStartDay: 0, enableHabitContext: false },
        translationManager: { t: mockTranslation },
        statsService: { getHabitStatus: vi.fn().mockResolvedValue("uncompleted") },
        fileManager: { getHabitStatus: vi.fn().mockReturnValue(false) },
        habitManager: {
          getActiveHabits: vi.fn().mockReturnValue([]),
          isHabitScheduledForDay: vi.fn().mockReturnValue(true),
          updateHabit: vi.fn().mockResolvedValue()
        }
      };
    });

    it("should instantiate HabitEditorComponent independently into any container", async () => {
      const containerEl = document.createElement("div");
      const onSubmitMock = vi.fn().mockResolvedValue();
      const onCloseMock = vi.fn();

      const editor = new HabitEditorComponent(containerEl, {
        app: mockApp,
        plugin: mockPlugin,
        habit: sampleHabit,
        onSubmit: onSubmitMock,
        onClose: onCloseMock,
        isModal: false
      });

      expect(containerEl.querySelector(".dh-habit-editor-root.is-popout")).not.toBeNull();
      expect(editor.checkDirty()).toBe(false);

      // Tab navigation
      editor.switchTab("settings");
      expect(editor.activeTab).toBe("settings");
      expect(containerEl.querySelector(".dh-modal-tab-btn.is-active")).not.toBeNull();

      // Submit
      await editor.saveHabit(null, mockTranslation);
      expect(onSubmitMock).toHaveBeenCalled();
      expect(onCloseMock).toHaveBeenCalled();
    });

    it("should mount HabitEditView and detach leaf upon close", async () => {
      const mockDetach = vi.fn();
      const mockLeaf = {
        detach: mockDetach,
        view: null
      };

      const view = new HabitEditView(mockLeaf, mockPlugin);
      mockLeaf.view = view;

      const onSubmitMock = vi.fn().mockResolvedValue();
      await view.setHabit(sampleHabit, onSubmitMock);

      expect(view.getViewType()).toBe(VIEW_TYPE_HABIT_EDIT);
      expect(view.getDisplayText()).toContain("Deep Focus");
      expect(view.editorComponent).not.toBeNull();

      // Close should detach leaf
      view.editorComponent.onClose();
      expect(mockDetach).toHaveBeenCalled();
    });

    it("should route openEditHabit to popout on desktop and focus existing leaf when reopened", async () => {
      const { default: DailyHabitsPlugin } = await import("../src/main.js");
      const pluginInstance = new DailyHabitsPlugin(mockApp, {});
      pluginInstance.settings = mockPlugin.settings;
      pluginInstance.habitManager = mockPlugin.habitManager;
      pluginInstance.translationManager = mockPlugin.translationManager;

      // Mock popout leaf creation
      const mockDetach = vi.fn();
      const mockSetViewState = vi.fn().mockResolvedValue();
      const mockView = new HabitEditView({ detach: mockDetach }, pluginInstance);
      const mockLeaf = {
        detach: mockDetach,
        setViewState: mockSetViewState,
        view: mockView
      };
      mockApp.workspace.openPopoutLeaf = vi.fn().mockReturnValue(mockLeaf);

      // Desktop test (Platform.isMobile = false)
      Platform.isMobile = false;
      await pluginInstance.openEditHabit(sampleHabit);

      expect(mockApp.workspace.openPopoutLeaf).toHaveBeenCalledWith({
        size: { width: 720, height: 640 }
      });
      expect(mockSetViewState).toHaveBeenCalledWith({
        type: VIEW_TYPE_HABIT_EDIT,
        active: true
      });
      expect(mockView.habit.id).toBe(sampleHabit.id);

      // If called again for same habit while already open, focus leaf without opening new one
      mockApp.workspace.getLeavesOfType.mockReturnValue([mockLeaf]);
      mockApp.workspace.openPopoutLeaf.mockClear();

      const focusSpy = vi.fn();
      mockView.containerEl.win = { focus: focusSpy };

      await pluginInstance.openEditHabit(sampleHabit);
      expect(mockApp.workspace.openPopoutLeaf).not.toHaveBeenCalled();
      expect(mockApp.workspace.setActiveLeaf).toHaveBeenCalledWith(mockLeaf, { focus: true });
      expect(focusSpy).toHaveBeenCalled();
    });
  });
});
