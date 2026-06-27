import { Setting, Notice, setIcon } from 'obsidian';
import { VIEW_TYPE_WEEKLY, DAY_KEYS, resolveHabitColorHex } from '../../constants.js';
import { AddHabitModal } from '../../modals/AddHabitModal.js';
import { FileSuggestModal } from '../../modals/FileSuggestModal.js';
import { getNoteByDate, buildHierarchyLabels, calculateCurrentLevel } from '../../utils/helpers.js';
import { Utils } from '../../utils/Utils.js';
import { StatusView } from '../StatusView.js';

export class HabitsPanel {
  constructor(plugin, settingsTab) {
    this.plugin = plugin;
    this.settingsTab = settingsTab;
    this.app = plugin.app;
    this.habitsContainer = null;
    this.archivedContainer = null;
  }

  get isAr() {
    return this.plugin.settings.language === "ar";
  }

  render(container, t) {
    container.empty();


    const btnContainer = container.createDiv();
    const addBtn = btnContainer.createEl("button", {
      text: t("add_habit_btn"),
      cls: "dh-add-habit-btn-hero",
    });
    addBtn.onclick = () => {
      new AddHabitModal(this.app, this.plugin, async (habitData) => {
        try {
          await this.plugin.habitManager.addHabit(habitData);
          await this.plugin.saveSettings();
          new Notice(t("success_added", { habit: habitData.name }));
          this.settingsTab.switchTab("habits");
          this.settingsTab.refreshUI();
        } catch (e) {
          new Notice(`Error: ${e.message}`);
        }
      }).open();
    };

    const importContainer = container.createDiv({ cls: "dh-import-section" });
    new Setting(importContainer)
      .setName(t("import_habits"))
      .setDesc(t("import_desc"))
      .addButton((btn) => btn.setButtonText(t("settings_import_today")).onClick(async () => {
        try {
          const today = window.moment();
          const dailyNote = await getNoteByDate(this.app, today, false);
          if (!dailyNote) {
            new Notice(t("settings_no_today_note"));
            return;
          }
          const content = await this.app.vault.read(dailyNote);
          const count = await this.plugin.habitManager.importHabitsFromContent(content, true);
          if (count > 0) {
            new Notice(t("settings_imported_count", { count }));
            this.settingsTab.refreshUI();
          } else {
            new Notice(t("settings_no_new_habits"));
          }
        } catch (e) {
          new Notice(t("settings_import_failed", { message: e.message }));
        }
      }))
      .addButton((btn) => btn.setButtonText(t("settings_choose_file")).onClick(() => {
        new FileSuggestModal(this.app, async (file) => {
          try {
            const content = await this.app.vault.read(file);
            const count = await this.plugin.habitManager.importHabitsFromContent(content, true);
            if (count > 0) {
              new Notice(t("settings_imported_from_file", { count, name: file.basename }));
              this.settingsTab.refreshUI();
            } else {
              new Notice(t("settings_no_new_habits"));
            }
          } catch (e) {
            new Notice(t("settings_import_failed", { message: e.message }));
          }
        }).open();
      }));

    const searchContainer = container.createDiv({ cls: "dh-search-container" });
    const searchInput = searchContainer.createEl("input", {
      type: "text",
      placeholder: t("settings_search_habits"),
      cls: "dh-search-input",
    });
    searchInput.oninput = () => {
      this.renderHabitsList(this.habitsContainer, searchInput.value.trim().toLowerCase());
    };

    this.habitsContainer = container.createDiv({ cls: "dh-habits-grid-settings" });
    this.renderHabitsList(this.habitsContainer);

    const archivedHabits = this.plugin.habitManager.getArchivedHabits();
    if (archivedHabits.length > 0) {
      container.createDiv({
        cls: "dh-settings-section-header",
        text: t("settings_archived_habits"),
      });
      this.archivedContainer = container.createDiv({ cls: "dh-habits-grid-settings" });
      this.renderArchivedHabitsList(this.archivedContainer);
    }

    if (this.plugin.habitManager.getActiveHabits().length > 0) {
      const dangerHeader = container.createDiv({ cls: "dh-settings-section-header dh-danger-zone" });
      dangerHeader.createSpan({ text: t("settings_danger_zone") });
      const dangerSetting = new Setting(container)
        .setName(t("settings_delete_all"))
        .setDesc(t("settings_delete_all_desc"));
      dangerSetting.addButton((btn) => btn.setButtonText(t("settings_delete_all_btn")).setWarning().onClick(async () => {
        const habitsCount = this.plugin.habitManager.getActiveHabits().length;
        Utils.showConfirmNotice(this.app, this.plugin, t("settings_delete_all_confirm", { count: habitsCount }), {
          confirmText: t("yes_sure"),
          cancelText: t("cancel"),
          onConfirm: async () => {
            const activeHabits = [...this.plugin.habitManager.getActiveHabits()];
            for (const h of activeHabits) {
              await this.plugin.habitManager.deleteHabit(h.id);
            }
            this.settingsTab.refreshUI();
            new Notice(t("settings_all_deleted_success"));
          }
        });
      }));
    }
  }

  renderHabitsList(container, searchFilter = "") {
    if (!container) return;
    container.empty();
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    let habits = this.plugin.habitManager.getActiveHabits();

    if (searchFilter) {
      habits = habits.filter(h =>
        h.name.toLowerCase().includes(searchFilter) ||
        (h.linkText && h.linkText.toLowerCase().includes(searchFilter))
      );
    }

    if (habits.length === 0) {
      StatusView.renderEmptyState(container, {
        icon: "🌱",
        title: t("empty_state_title"),
        description: t("empty_state_desc"),
        button: {
          text: t("empty_state_btn"),
          onClick: () => {
            new AddHabitModal(this.app, this.plugin, async (habitData) => {
              try {
                await this.plugin.habitManager.addHabit(habitData);
                await this.plugin.saveSettings();
                new Notice(t("success_added", { habit: habitData.name }));
                this.settingsTab.switchTab("habits");
                this.settingsTab.display();
              } catch (e) {
                new Notice(`❌ ${e.message}`);
              }
            }).open();
          }
        }
      });
      return;
    }

    const list = container.createDiv({ cls: "dh-habits-list" });

    // Add Header Row for better clarity
    const headerRow = list.createDiv({ cls: "dh-habit-row dh-list-header" });
    headerRow.createDiv({ cls: "dh-col-id", text: "#" });
    headerRow.createDiv({
      cls: "dh-col-name",
      text: t("habit_name") || "Habit Name",
    });
    headerRow.createDiv({ cls: "dh-col-level", text: t("level") || "Level" });
    headerRow.createDiv({
      cls: "dh-col-schedule",
      text: "",
    });
    headerRow.createDiv({ cls: "dh-col-actions", text: "" });

    const { sorted: sortedHabits, labels: displayLabels } = buildHierarchyLabels(habits);
    const settingsChildRowsMap = new Map();

    sortedHabits.forEach((habit, index) => {
      const effectiveParentId = this.plugin.habitManager.getEffectiveParentId(habit.id);
      const isChild = effectiveParentId !== null;
      const isParent = this.plugin.habitManager.isParent(habit.id);

      let colorId = habit.color || "teal";
      if (isChild) {
        const parentHabit = habits.find(h => h.id === effectiveParentId);
        if (parentHabit) colorId = parentHabit.color || "teal";
      }
      const colorHex = resolveHabitColorHex(colorId);

      const rowCls = isChild ? "dh-habit-row dh-habit-row-child" : "dh-habit-row";
      const row = list.createDiv({ cls: rowCls });
      row.style.setProperty("--habit-color", colorHex);

      if (isChild) {
        const pid = effectiveParentId;
        if (!settingsChildRowsMap.has(pid)) settingsChildRowsMap.set(pid, []);
        settingsChildRowsMap.get(pid).push(row);
      }

      const idCell = row.createDiv({ cls: isChild ? "dh-col-id dh-child-indent-cell" : "dh-col-id" });
      idCell.createSpan({ text: displayLabels[index], cls: "dh-label-num" });

      const nameCol = row.createDiv({ cls: "dh-col-name" });
      const nameRow = nameCol.createDiv({ cls: "dh-habit-name-row" });
      nameRow.createSpan({
        cls: `dh-type-dot ${habit.habitType === "break" ? "break" : "build"}`,
        title: habit.habitType === "break" ? t("break_habit") : t("build_habit"),
      });

      if (isParent) {
        const btn = nameRow.createSpan({
          cls: "dh-collapse-btn",
          title: t("settings_collapse_expand_tooltip"),
          attr: { "data-settings-collapse-id": habit.id },
        });
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="dh-chevron-icon"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
      }

      nameRow.createSpan({ cls: "dh-habit-name", text: habit.name });

      const expectedLink = `[[${habit.name}]]`;
      if (
        habit.linkText &&
        habit.linkText !== expectedLink &&
        habit.linkText !== habit.name
      ) {
        nameCol.createDiv({ cls: "dh-habit-link", text: habit.linkText });
      }

      const level = habit.currentLevel || 1;
      const levelCol = row.createDiv({ cls: "dh-col-level" });
      levelCol.createSpan({
        text: level.toLocaleString(),
        cls: `dh-level-badge level-${level}`,
      });

      const scheduleCol = row.createDiv({ cls: "dh-col-schedule" });
      const isDaily =
        habit.schedule?.type === "all-days" || (habit.schedule?.days?.length ?? 0) === 7;

      if (isDaily) {
        scheduleCol.createSpan({
          text: t("schedule_daily"),
          cls: "dh-schedule-tag daily",
        });
      } else {
        const count = habit.schedule.days.length;
        const dayNames = DAY_KEYS.map((k) => this.plugin.translationManager.t(k));
        const comma = t("comma_separator");
        const selectedDays = [...(habit.schedule?.days || [])]
          .sort((a, b) => a - b)
          .map((d) => dayNames[d])
          .join(comma);

        scheduleCol.createSpan({
          text: t("schedule_days_count", { count }),
          cls: "dh-schedule-tag specific",
          title: selectedDays,
        });
      }

      const actionsCol = row.createDiv({ cls: "dh-col-actions" });
      const siblings = sortedHabits.filter(h => this.plugin.habitManager.getEffectiveParentId(h.id) === effectiveParentId);
      const posInGroup = siblings.findIndex(h => h.id === habit.id);
      const isFirstInGroup = posInGroup === 0;
      const isLastInGroup = posInGroup === siblings.length - 1;

      // Move Up
      const moveUpBtn = actionsCol.createEl("button", { cls: "dh-icon-btn" });
      setIcon(moveUpBtn, "arrow-up");
      moveUpBtn.setAttribute("aria-label", t("action_move_up"));
      if (isFirstInGroup) {
        moveUpBtn.addClass("is-disabled");
        moveUpBtn.disabled = true;
      }
      moveUpBtn.onclick = async () => {
        if (isFirstInGroup) return;
        try {
          await this.plugin.habitManager.moveHabitUp(habit.id);
          this.renderHabitsList(this.habitsContainer);
          this.app.workspace.getLeavesOfType(VIEW_TYPE_WEEKLY).forEach((leaf) => {
            if (leaf.view && typeof leaf.view.refresh === "function") leaf.view.refresh();
          });
          new Notice(t("action_moved_up_success"));
        } catch (e) {
          console.error('[Core Habits] Move Up Error:', e);
          new Notice(`❌ Error: ${e.message}`);
        }
      };

      // Move Down
      const moveDownBtn = actionsCol.createEl("button", { cls: "dh-icon-btn" });
      setIcon(moveDownBtn, "arrow-down");
      moveDownBtn.setAttribute("aria-label", t("action_move_down"));
      if (isLastInGroup) {
        moveDownBtn.addClass("is-disabled");
        moveDownBtn.disabled = true;
      }
      moveDownBtn.onclick = async () => {
        if (isLastInGroup) return;
        try {
          await this.plugin.habitManager.moveHabitDown(habit.id);
          this.renderHabitsList(this.habitsContainer);
          this.app.workspace.getLeavesOfType(VIEW_TYPE_WEEKLY).forEach((leaf) => {
            if (leaf.view && typeof leaf.view.refresh === "function") leaf.view.refresh();
          });
          new Notice(t("action_moved_down_success"));
        } catch (e) {
          console.error('[Core Habits] Move Down Error:', e);
          new Notice(`❌ Error: ${e.message}`);
        }
      };

      // Edit
      const editBtn = actionsCol.createEl("button", { cls: "dh-icon-btn" });
      setIcon(editBtn, "pencil");
      editBtn.setAttribute("aria-label", t("edit_habit"));
      editBtn.onclick = () => {
        new AddHabitModal(
          this.app,
          this.plugin,
          async (updatedData) => {
              if (updatedData.levelData) {
                updatedData.currentLevel = calculateCurrentLevel(updatedData.levelData);
              }
              await this.plugin.habitManager.updateHabit(habit.id, updatedData);
              this.settingsTab.refreshUI();
              new Notice(`✅ ${updatedData.name}`);
          },
          habit,
        ).open();
      };

      // Delete
      const delBtn = actionsCol.createEl("button", { cls: "dh-icon-btn mod-warning" });
      setIcon(delBtn, "trash");
      delBtn.setAttribute("aria-label", t("delete"));
      delBtn.onclick = async () => {
        Utils.showConfirmNotice(
          this.app,
          this.plugin,
          t("action_delete_confirm", { name: habit.name }),
          {
            confirmText: t("yes_sure"),
            cancelText: t("cancel"),
            onConfirm: async () => {
              try {
                const deletedHabit = { ...habit };
                await this.plugin.habitManager.deleteHabit(habit.id);
                this.settingsTab.refreshUI();
                this.showUndoDeleteNotice(deletedHabit);
              } catch (e) {
                console.error('[Core Habits] Delete Error:', e);
                new Notice(`❌ Error: ${e.message}`);
              }
            },
          }
        );
      };

      // Archive
      const archiveBtn = actionsCol.createEl("button", { cls: "dh-icon-btn" });
      setIcon(archiveBtn, "archive");
      archiveBtn.setAttribute("aria-label", t("action_archive"));
      archiveBtn.onclick = async () => {
        try {
          await this.plugin.habitManager.archiveHabit(habit.id);
          this.settingsTab.refreshUI();
          new Notice(t("action_archived_success"));
        } catch (e) {
          console.error('[Core Habits] Archive Error:', e);
          new Notice(`❌ Error: ${e.message}`);
        }
      };
    });

    settingsChildRowsMap.forEach((childRows, pid) => {
      const toggleBtn = list.querySelector(`[data-settings-collapse-id="${pid}"]`);
      if (!toggleBtn) return;

      const parentHabit = habits.find(h => h.id === pid);
      if (!parentHabit) return;

      let collapsed = this.plugin.settings.collapsedGroups.includes(pid);

      const updateUI = () => {
        toggleBtn.classList.toggle("is-collapsed", collapsed);
        toggleBtn.title = collapsed
          ? t("settings_expand_children")
          : t("settings_collapse_children");
        childRows.forEach(row => {
          row.classList.toggle("is-hidden", collapsed);
        });
      };

      updateUI();

      toggleBtn.onclick = async (e) => {
        e.stopPropagation();
        collapsed = !collapsed;

        if (collapsed) {
          if (!this.plugin.settings.collapsedGroups.includes(pid)) {
            this.plugin.settings.collapsedGroups.push(pid);
          }
        } else {
          this.plugin.settings.collapsedGroups = this.plugin.settings.collapsedGroups.filter(id => id !== pid);
        }
        await this.plugin.saveSettings({ silent: true });

        updateUI();
      };
    });
  }

  renderArchivedHabitsList(container) {
    if (!container) return;
    container.empty();
    const t = (k, p) => this.plugin.translationManager.t(k, p);

    const archivedHabits = this.plugin.habitManager.getArchivedHabits().sort((a, b) => a.order - b.order);

    if (archivedHabits.length === 0) {
      container.createEl("p", {
        text: t("settings_no_archived_habits"),
        cls: "dh-no-habits-message",
      });
      return;
    }

    const list = container.createDiv({ cls: "dh-habits-list" });
    const headerRow = list.createDiv({ cls: "dh-habit-row dh-list-header archived" });
    headerRow.createDiv({ cls: "dh-col-id", text: "#" });
    headerRow.createDiv({ cls: "dh-col-name", text: t("habit_name") });
    headerRow.createDiv({ cls: "dh-col-level", text: t("settings_archive_date") });
    headerRow.createDiv({ cls: "dh-col-streak", text: t("settings_longest_streak") });
    headerRow.createDiv({ cls: "dh-col-actions", text: "" });

    archivedHabits.forEach((habit, index) => {
      const row = list.createDiv({ cls: "dh-habit-row archived" });

      row.createDiv({ cls: "dh-col-id", text: (index + 1).toLocaleString() });

      const nameCol = row.createDiv({ cls: "dh-col-name" });
      nameCol.createEl("span", { text: habit.name, cls: "dh-habit-name" });

      const dateCol = row.createDiv({ cls: "dh-col-level" });
      if (habit.archivedDate) {
        const archivedDate = new Date(habit.archivedDate);
        dateCol.createEl("span", {
          text: archivedDate.toLocaleDateString(),
          cls: "dh-archived-date",
        });
      }

      const streakCol = row.createDiv({ cls: "dh-col-streak" });
      streakCol.createEl("span", {
        text: (habit.savedLongestStreak || 0).toString(),
        cls: "dh-archived-streak",
      });

      const actionsCol = row.createDiv({ cls: "dh-col-actions" });

      // Restore
      const restoreBtn = actionsCol.createEl("button", { cls: "dh-icon-btn" });
      setIcon(restoreBtn, "rotate-ccw");
      restoreBtn.setAttribute("aria-label", t("action_restore"));
      restoreBtn.onclick = async () => {
        try {
          await this.plugin.habitManager.restoreHabit(habit.id);
          this.settingsTab.refreshUI();
          new Notice(t("action_restored_success"));
        } catch (e) {
          console.error('[Core Habits] Restore Error:', e);
          new Notice(`❌ Error: ${e.message}`);
        }
      };

      // Permanent Delete
      const deleteBtn = actionsCol.createEl("button", { cls: "dh-icon-btn mod-warning" });
      setIcon(deleteBtn, "trash-2");
      deleteBtn.setAttribute("aria-label", t("action_delete_permanently"));
      deleteBtn.onclick = async () => {
        Utils.showConfirmNotice(
          this.app,
          this.plugin,
          t("action_delete_permanently_confirm", { name: habit.name }),
          {
            confirmText: t("yes_sure"),
            cancelText: t("cancel"),
            onConfirm: async () => {
              try {
                await this.plugin.habitManager.deleteHabitPermanently(habit.id);
                this.settingsTab.refreshUI();
                new Notice(t("action_deleted_permanently_success"));
              } catch (e) {
                console.error('[Core Habits] Permanent Delete Error:', e);
                new Notice(`❌ Error: ${e.message}`);
              }
            },
          }
        );
      };
    });
  }

  showUndoDeleteNotice(deletedHabit) {
    const t = (k, p) => this.plugin.translationManager.t(k, p);

    const fragment = document.createDocumentFragment();
    const container = document.createElement("div");
    container.className = "dh-undo-notice";

    container.createSpan({
      text: t("notice_deleted_habit", { name: deletedHabit.name })
    });

    const btnContainer = container.createDiv({ cls: "dh-undo-buttons" });

    const undoBtn = btnContainer.createEl("button", {
      text: t("action_undo"),
      cls: "dh-undo-btn"
    });

    const closeBtn = btnContainer.createEl("button", {
      text: "✕",
      cls: "dh-close-btn"
    });
    fragment.appendChild(container);

    const notice = new Notice(fragment, 0);

    undoBtn.onclick = async () => {
      delete deletedHabit.streakData;
      await this.plugin.habitManager.addHabit(deletedHabit);

      notice.hide();
      this.settingsTab.refreshUI();
      new Notice(t("action_restored_habit_success"));
    };

    closeBtn.onclick = () => {
      notice.hide();
    };
  }
}
