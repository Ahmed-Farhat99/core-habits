import { Setting, setIcon, Menu } from 'obsidian';
import { DAY_KEYS } from '../../constants.js';
import { GroupCollapseController } from '../../components/ui/GroupCollapseController.js';
import { HabitRowFactory } from '../renderers/HabitRowFactory.js';
import { AddHabitModal } from '../../modals/AddHabitModal.js';
import { RemoveAllHabitsModal } from '../../modals/RemoveAllHabitsModal.js';
import { buildHierarchyLabels } from '../../utils/helpers.js';
import { TooltipHelper } from '../../utils/TooltipHelper.js';
import { ProgressionEngine, MILESTONES } from '../../services/ProgressionEngine.js';
import { StreakCalculator } from '../../services/StreakCalculator.js';
import { Utils } from '../../utils/Utils.js';
import { StatusView } from '../StatusView.js';
import { NoticeService } from '../../services/NoticeService.js';

export class HabitsPanel {
  constructor(plugin, settingsTab) {
    this.plugin = plugin;
    this.settingsTab = settingsTab;
    this.app = plugin.app;
    this.habitsContainer = null;
    this.archivedContainer = null;
    this.removedContainer = null;
    this.removedSection = null;
    this.dangerSection = null;
    this.archiveDetails = null;
    this.archiveCountBadge = null;
    this.isArchiveOpen = false;
    this.isRemovedOpen = false;
    this.addBtn = null;
    this.capacityBadge = null;
    this.searchDebounceTimer = null;
  }

  render(container, t) {
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
    container.empty();

    // ─── 1. Header Toolbar (Primary CTA + Decoupled Capacity Indicator) ───
    const toolbar = container.createDiv({ cls: "dh-habits-header-toolbar" });
    this.addBtn = toolbar.createEl("button", {
      cls: "dh-btn mod-cta dh-btn-hero dh-add-habit-btn-primary",
      type: "button"
    });
    this.capacityBadge = toolbar.createDiv({
      cls: "dh-capacity-badge"
    });
    this.updateAddBtnState();

    this.addBtn.onclick = () => this.openAddHabit();

    // ─── 2. Search Bar with Debounce & Clear ───
    const searchContainer = container.createDiv({ cls: "dh-search-container" });
    const searchWrapper = searchContainer.createDiv({ cls: "dh-search-input-wrapper" });
    
    const searchIcon = searchWrapper.createSpan({ cls: "dh-search-icon" });
    setIcon(searchIcon, "search");

    const rawPlaceholder = t("settings_search_habits");
    const cleanPlaceholder = rawPlaceholder.replace(/^[🔍\s]+/u, "").trim();

    const searchInput = searchWrapper.createEl("input", {
      type: "text",
      placeholder: cleanPlaceholder,
      cls: "dh-search-input",
    });

    const clearBtn = searchWrapper.createEl("button", {
      text: "✕",
      cls: "dh-settings-search-clear-btn"
    });
    TooltipHelper.set(clearBtn, t("settings_clear_search"));
    clearBtn.style.display = "none";

    searchInput.onkeydown = (e) => {
      if (e.key === "Escape" && searchInput.value) {
        e.stopPropagation();
        searchInput.value = "";
        clearBtn.style.display = "none";
        if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
        this.renderHabitsList(this.habitsContainer, "");
      }
    };

    searchInput.oninput = () => {
      const val = searchInput.value;
      clearBtn.style.display = val ? "flex" : "none";

      if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = setTimeout(() => {
        if (this.habitsContainer === listContainer) {
          this.renderHabitsList(listContainer, val.trim().toLowerCase());
        }
      }, 250);
    };

    clearBtn.onclick = () => {
      searchInput.value = "";
      clearBtn.style.display = "none";
      if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
      this.renderHabitsList(this.habitsContainer, "");
      searchInput.focus();
    };

    // ─── 4. Habits List Container ───
    this.habitsContainer = container.createDiv({ cls: "dh-habits-grid-settings" });
    const listContainer = this.habitsContainer;
    this.renderHabitsList(this.habitsContainer);

    // ─── 5. Archived Habits Section (Archive Manager) ───
    this.renderArchiveManager(container, t);
    this.removedSection = container.createDiv();
    this.renderRemovedHabits(this.removedSection, t);

    // ─── 6. Recoverable bulk removal ───
    this.dangerSection = container.createDiv();
    this.renderDangerZone(this.dangerSection, t);
  }

  renderDangerZone(container, t) {
    container.empty();
    if (this.plugin.habitManager.getActiveHabits().length > 0) {
      const dangerHeader = container.createDiv({ cls: "dh-settings-section-header dh-danger-zone" });
      dangerHeader.createSpan({ text: `⚠️ ${t("settings_danger_zone")}` });

      const dangerSetting = new Setting(container)
        .setName(t("settings_remove_all"))
        .setDesc(t("settings_remove_all_desc"));

      dangerSetting.addButton((btn) => btn.setButtonText(t("settings_remove_all_btn")).setWarning().onClick(() => {
        const habitsCount = this.plugin.habitManager.getActiveHabits().length;
        new RemoveAllHabitsModal(this.app, this.plugin, habitsCount, async () => {
          const activeHabits = [...this.plugin.habitManager.getActiveHabits()];
          let removedCount = 0;
          for (const h of activeHabits) {
            try {
              await this.plugin.habitManager.removeHabit(h.id);
              removedCount++;
            } catch (error) {
              console.error("[Core Habits] Could not remove habit:", error);
              break;
            }
          }
          this.settingsTab.refreshUI();
          this.plugin.refreshWeeklyViews();
          NoticeService.show(removedCount === activeHabits.length
            ? t("settings_all_removed_success")
            : t("settings_bulk_partial", { count: removedCount, total: activeHabits.length }), this.plugin);
        }).open();
      }));
    }
  }

  openAddHabit() {
    if (this.plugin.habitManager.getActiveHabits().length >= 50) {
      NoticeService.warning(this.plugin.translationManager.t("settings_max_habits_reached"), this.plugin);
      return;
    }
    new AddHabitModal(this.app, this.plugin, (habitData) => this.submitNewHabit(habitData)).open();
  }

  async submitNewHabit(habitData) {
    const t = (key, params) => this.plugin.translationManager.t(key, params);
    await this.plugin.habitManager.addHabit(habitData);
    try {
      this.settingsTab.refreshUI();
      this.plugin.refreshWeeklyViews();
    } catch (error) {
      console.warn("[Core Habits] Habit saved, but the view could not refresh:", error);
    }
    NoticeService.success(t("success_added", { habit: habitData.name }), this.plugin);
  }

  updateAddBtnState() {
    if (!this.addBtn) return;
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const activeHabitsCount = this.plugin.habitManager.getActiveHabits().length;
    const maxHabits = 50;
    const isAtLimit = activeHabitsCount >= maxHabits;
    const isNearLimit = activeHabitsCount >= 45 && !isAtLimit;

    const rawText = t("add_habit_btn");
    const cleanText = rawText.replace(/^[\s+＋]+/u, "").trim();

    this.addBtn.textContent = `+ ${cleanText}`;
    this.addBtn.disabled = isAtLimit;
    this.addBtn.classList.toggle("is-limit-reached", isAtLimit);
    TooltipHelper.set(this.addBtn, isAtLimit ? t("settings_max_habits_reached") : null);

    if (this.capacityBadge) {
      this.capacityBadge.textContent = t("settings_capacity_badge", { current: activeHabitsCount, max: maxHabits });
      this.capacityBadge.classList.toggle("is-warning", isNearLimit);
      this.capacityBadge.classList.toggle("is-limit-reached", isAtLimit);
      TooltipHelper.set(
        this.capacityBadge,
        isAtLimit
          ? t("settings_max_habits_reached")
          : (isNearLimit ? t("settings_capacity_warning", { max: maxHabits }) : null)
      );
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
      if (searchFilter) {
        StatusView.renderEmptyState(container, {
          icon: "🔎",
          title: t("settings_no_search_results"),
          description: t("settings_no_search_results_desc")
        });
        return;
      }
      StatusView.renderEmptyState(container, {
        icon: "🌱",
        title: t("empty_state_title"),
        description: t("empty_state_desc"),
        button: {
          text: t("empty_state_btn"),
          onClick: () => this.openAddHabit()
        }
      });
      return;
    }

    const list = container.createDiv({ cls: "dh-habits-list" });

    // Header Row
    const headerRow = list.createDiv({ cls: "dh-habit dh-habit-row dh-list-header" });
    headerRow.createDiv({ cls: "dh-col-id", text: "#" });
    headerRow.createDiv({ cls: "dh-col-name", text: t("habit_name") });
    headerRow.createDiv({ cls: "dh-col-level", text: t("level") });
    headerRow.createDiv({ cls: "dh-col-schedule", text: t("frequency") });
    headerRow.createDiv({ cls: "dh-col-actions", text: "" });

    const { sorted: sortedHabits, labels: displayLabels } = buildHierarchyLabels(habits);
    const settingsChildRowsMap = new Map();
    const hexColorMap = HabitRowFactory.buildColorMap(sortedHabits, this.plugin.habitManager);
    const pendingMilestones = new Map();

    sortedHabits.forEach((habit, index) => {
      const { effectiveParentId, isChild, isParentHabit: isParent } = HabitRowFactory.resolveHierarchy(habit, sortedHabits, this.plugin.habitManager);
      const colorHex = hexColorMap.get(habit.id);

      const row = HabitRowFactory.createRowShell({
        container: list,
        habit,
        effectiveParentId,
        isChild,
        colorHex,
        role: "row",
        extraClasses: ["dh-habit-row", ...(isChild ? ["dh-habit-row-child"] : [])]
      });

      if (isChild) {
        const pid = effectiveParentId;
        if (!settingsChildRowsMap.has(pid)) settingsChildRowsMap.set(pid, []);
        settingsChildRowsMap.get(pid).push(row);
      }

      // ID / Hierarchy number cell
      const idCell = row.createDiv({ cls: isChild ? "dh-col-id dh-child-indent-cell" : "dh-col-id" });
      idCell.createSpan({ text: displayLabels[index], cls: "dh-label-num" });

      // Habit Name Cell
      const nameCol = row.createDiv({ cls: "dh-col-name" });
      const nameRow = nameCol.createDiv({ cls: "dh-habit-name-row" });

      HabitRowFactory.createTypeDot(nameRow, habit.habitType, t, isChild);

      if (isParent) {
        const isCollapsed = this.plugin.settings.collapsedGroups.includes(habit.id);
        HabitRowFactory.createCollapseButton(nameRow, {
          habitId: habit.id,
          isCollapsed,
          t
        });
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

      // Level Column
      const cachedStats = StreakCalculator.getCachedStats(habit.id);
      const level = ProgressionEngine.calculateLevel(habit, cachedStats);
      const levelCol = row.createDiv({ cls: "dh-col-level" });
      levelCol.createSpan({ cls: "dh-level-label", text: t("level") });
      const levelBadge = levelCol.createSpan({
        text: level.toLocaleString(),
        cls: `dh-level-badge level-${level}`,
      });
      const milestone = MILESTONES.find(m => m.level === level) || MILESTONES[0];
      const isAr = (t("direction") === "rtl" || this.plugin.settings?.language === "ar");
      const milestoneName = isAr ? milestone.nameAr : milestone.nameEn;
      const milestoneDesc = isAr ? milestone.descAr : milestone.descEn;
      TooltipHelper.set(levelBadge, `${t("level")} ${level}: ${milestoneName} (${milestoneDesc})`);

      if (!cachedStats && this.plugin.streakCalculator) {
        pendingMilestones.set(habit.id, { badgeEl: levelBadge, habit });
      }

      // Schedule Column
      const scheduleCol = row.createDiv({ cls: "dh-col-schedule" });
      const isDaily =
        habit.schedule?.type === "all-days" || (habit.schedule?.days?.length ?? 0) === 7;

      if (isDaily) {
        scheduleCol.createSpan({
          text: t("schedule_daily"),
          cls: "dh-schedule-tag daily",
        });
      } else {
        const count = habit.schedule?.days?.length || 0;
        const dayNames = DAY_KEYS.map((k) => this.plugin.translationManager.t(k));
        const comma = t("comma_separator") || "، ";
        const selectedDays = [...(habit.schedule?.days || [])]
          .sort((a, b) => a - b)
          .map((d) => dayNames[d])
          .join(comma);

        const schedSpan = scheduleCol.createSpan({
          text: t("schedule_days_count", { count }),
          cls: "dh-schedule-tag specific"
        });
        TooltipHelper.set(schedSpan, selectedDays);
      }

      // ─── Actions Column: Edit visible, More (⋯) context menu ───
      const actionsCol = row.createDiv({ cls: "dh-col-actions" });
      const siblings = sortedHabits.filter(h => this.plugin.habitManager.getEffectiveParentId(h.id) === effectiveParentId);
      const posInGroup = siblings.findIndex(h => h.id === habit.id);
      const isFirstInGroup = posInGroup === 0;
      const isLastInGroup = posInGroup === siblings.length - 1;

      // 1. Edit Button (Visible)
      const editBtn = actionsCol.createEl("button", { 
        cls: "dh-icon-btn"
      });
      TooltipHelper.set(editBtn, t("edit_habit"));
      setIcon(editBtn, "pencil");
      editBtn.onclick = () => {
        this.plugin.openEditHabit(
          habit,
          async (updatedData) => {
            const merged = { ...habit, ...updatedData };
            const effectiveLevel = updatedData.currentLevel
              || ProgressionEngine.calculateLevel(merged, null, updatedData.levelData);
            updatedData.currentLevel = effectiveLevel;
            await this.plugin.habitManager.updateHabit(habit.id, updatedData);
            try {
              this.settingsTab.refreshUI();
              this.plugin.refreshWeeklyViews();
            } catch (error) {
              console.warn("[Core Habits] Habit updated, but the view could not refresh:", error);
            }
            NoticeService.success(t("notice_habit_updated", { name: updatedData.name }) || updatedData.name, this.plugin);
          }
        );
      };

      // 2. More Options Menu (⋯ Context Menu)
      const moreBtn = actionsCol.createEl("button", { 
        cls: "dh-icon-btn dh-more-menu-btn"
      });
      TooltipHelper.set(moreBtn, t("settings_action_more"));
      setIcon(moreBtn, "more-vertical");

      const showOptionsMenu = (evt) => {
        const menu = new Menu();

        // Move Up
        menu.addItem((item) => {
          item
            .setTitle(t("action_move_up"))
            .setIcon("arrow-up")
            .setDisabled(isFirstInGroup)
            .onClick(async () => {
              if (isFirstInGroup) return;
              try {
                await this.plugin.habitManager.moveHabitUp(habit.id);
                this.renderHabitsList(this.habitsContainer);
                this.plugin.refreshWeeklyViews();
                NoticeService.success(t("action_moved_up_success"), this.plugin);
              } catch (e) {
                console.error('[Core Habits] Move Up Error:', e);
                NoticeService.error(t("notice_error_prefix", { message: e.message }) || e.message, this.plugin);
              }
            });
        });

        // Move Down
        menu.addItem((item) => {
          item
            .setTitle(t("action_move_down"))
            .setIcon("arrow-down")
            .setDisabled(isLastInGroup)
            .onClick(async () => {
              if (isLastInGroup) return;
              try {
                await this.plugin.habitManager.moveHabitDown(habit.id);
                this.renderHabitsList(this.habitsContainer);
                this.plugin.refreshWeeklyViews();
                NoticeService.success(t("action_moved_down_success"), this.plugin);
              } catch (e) {
                console.error('[Core Habits] Move Down Error:', e);
                NoticeService.error(t("notice_error_prefix", { message: e.message }) || e.message, this.plugin);
              }
            });
        });

        menu.addSeparator();

        // Archive
        menu.addItem((item) => {
          item
            .setTitle(t("action_archive"))
            .setIcon("archive")
            .onClick(async () => {
              try {
                await this.plugin.habitManager.archiveHabit(habit.id);
                this.settingsTab.refreshUI();
                this.plugin.refreshWeeklyViews();
                NoticeService.success(t("action_archived_success"), this.plugin);
              } catch (e) {
                console.error('[Core Habits] Archive Error:', e);
                NoticeService.error(t("notice_error_prefix", { message: e.message }) || e.message, this.plugin);
              }
            });
        });

        menu.addSeparator();

        // Recoverable removal
        menu.addItem((item) => {
          item
            .setTitle(t("action_remove_habit"))
            .setIcon("trash")
            .setWarning(true)
            .onClick(() => {
              Utils.showConfirmNotice(
                this.app,
                this.plugin,
                t("action_remove_confirm", { name: habit.name }),
                {
                  confirmText: t("yes_sure"),
                  cancelText: t("cancel"),
                  onConfirm: async () => {
                    try {
                      const removedHabit = { ...habit };
                      await this.plugin.habitManager.removeHabit(habit.id);
                      this.settingsTab.refreshUI();
                      this.plugin.refreshWeeklyViews();
                      this.showUndoRemoveNotice(removedHabit);
                    } catch (e) {
                console.error('[Core Habits] Remove Error:', e);
                      NoticeService.error(t("notice_error_prefix", { message: e.message }) || e.message, this.plugin);
                    }
                  },
                }
              );
            });
        });

        if (evt instanceof MouseEvent) {
          menu.showAtMouseEvent(evt);
        } else {
          const rect = moreBtn.getBoundingClientRect();
          menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
        }
      };

      moreBtn.onclick = (e) => {
        e.stopPropagation();
        showOptionsMenu(e);
      };
    });

    if (pendingMilestones.size > 0) {
      this.warmupHabitsMilestones(pendingMilestones, t);
    }

    GroupCollapseController.wire(list, settingsChildRowsMap, {
      plugin: this.plugin,
      collapsedGroups: this.plugin.settings.collapsedGroups,
      t,
    });
  }

  async warmupHabitsMilestones(pendingBadges, t) {
    if (!this.plugin?.streakCalculator || pendingBadges.size === 0) return;
    for (const [, { badgeEl, habit }] of pendingBadges) {
      if (!badgeEl.isConnected) continue;
      try {
        const stats = await this.plugin.streakCalculator.calculate(habit);
        if (stats && badgeEl.isConnected) {
          const freshLevel = ProgressionEngine.calculateLevel(habit, stats);
          badgeEl.className = `dh-level-badge level-${freshLevel}`;
          badgeEl.textContent = freshLevel.toLocaleString();
          const milestone = MILESTONES.find(m => m.level === freshLevel) || MILESTONES[0];
          const isAr = (t("direction") === "rtl" || this.plugin.settings?.language === "ar");
          const milestoneName = isAr ? milestone.nameAr : milestone.nameEn;
          const milestoneDesc = isAr ? milestone.descAr : milestone.descEn;
          TooltipHelper.set(badgeEl, `${t("level")} ${freshLevel}: ${milestoneName} (${milestoneDesc})`);
        }
      } catch {
        // Silent catch for background warm-up
      }
    }
  }

  renderArchiveManager(container, t) {
    const archivedHabits = this.plugin.habitManager.getArchivedHabits();

    const details = container.createEl("details", { cls: "dh-settings-collapse dh-archive-manager-collapse" });
    this.archiveDetails = details;
    if (this.isArchiveOpen) {
      details.setAttribute("open", "");
    }

    details.ontoggle = () => {
      this.isArchiveOpen = details.open;
      if (details.open) this.renderArchivedHabitsList(this.archivedContainer);
    };

    const summary = details.createEl("summary", { cls: "dh-settings-collapse-summary" });
    const titleWrap = summary.createDiv({ cls: "dh-collapse-summary-title" });
    titleWrap.createSpan({ text: t("settings_archived_habits") });
    this.archiveCountBadge = titleWrap.createSpan({
      cls: "dh-archive-count-badge",
      text: archivedHabits.length.toString()
    });

    summary.createSpan({ cls: "dh-collapse-arrow", text: "▼" });

    this.archivedContainer = details.createDiv({ cls: "dh-settings-collapse-content dh-archive-content" });
    if (details.open) this.renderArchivedHabitsList(this.archivedContainer);
  }

  renderArchivedHabitsList(container) {
    if (!container) return;
    container.empty();
    const t = (k, p) => this.plugin.translationManager.t(k, p);

    const archivedHabits = this.plugin.habitManager.getArchivedHabits().sort((a, b) => a.order - b.order);

    if (this.archiveCountBadge) {
      this.archiveCountBadge.textContent = archivedHabits.length.toString();
    }

    if (archivedHabits.length === 0) {
      const banner = container.createDiv({ cls: "dh-archive-empty-banner" });
      banner.createSpan({ cls: "dh-archive-empty-icon", text: "📦" });
      banner.createEl("p", {
        text: t("settings_no_archived_habits_desc") || t("settings_no_archived_habits"),
        cls: "dh-archive-empty-text",
      });
      return;
    }

    // Bulk actions toolbar
    const toolbar = container.createDiv({ cls: "dh-archive-toolbar" });

    const restoreAllBtn = toolbar.createEl("button", {
      cls: "dh-btn dh-btn-sm",
      text: `🔄 ${t("action_restore_all")}`
    });
    restoreAllBtn.onclick = () => {
      Utils.showConfirmNotice(
        this.app,
        this.plugin,
        t("action_restore_all_confirm"),
        {
          confirmText: t("yes_sure"),
          cancelText: t("cancel"),
          onConfirm: async () => {
            const { restoredCount, skippedCount } = await this.plugin.habitManager.restoreAllArchivedHabits();
            this.settingsTab.refreshUI();
            this.plugin.refreshWeeklyViews();
            NoticeService.show(skippedCount
              ? t("settings_bulk_partial", { count: restoredCount, total: restoredCount + skippedCount })
              : t("action_restored_all_success"), this.plugin);
          }
        }
      );
    };

    const clearArchiveBtn = toolbar.createEl("button", {
      cls: "dh-btn dh-btn-sm mod-warning",
      text: t("action_remove_archived")
    });
    clearArchiveBtn.onclick = () => {
      Utils.showConfirmNotice(
        this.app,
        this.plugin,
        t("action_remove_archived_confirm"),
        {
          confirmText: t("yes_sure"),
          cancelText: t("cancel"),
          onConfirm: async () => {
            const removedCount = await this.plugin.habitManager.removeArchivedHabits();
            this.settingsTab.refreshUI();
            this.plugin.refreshWeeklyViews();
            NoticeService.show(removedCount === archivedHabits.length
              ? t("action_removed_archived_success")
              : t("settings_bulk_partial", { count: removedCount, total: archivedHabits.length }), this.plugin);
          }
        }
      );
    };

    const list = container.createDiv({ cls: "dh-habits-list" });
    const headerRow = list.createDiv({ cls: "dh-habit dh-habit-row dh-list-header archived" });
    headerRow.createDiv({ cls: "dh-col-id", text: "#" });
    headerRow.createDiv({ cls: "dh-col-name", text: t("habit_name") });
    headerRow.createDiv({ cls: "dh-col-level", text: t("settings_archive_date") });
    headerRow.createDiv({ cls: "dh-col-streak", text: t("settings_longest_streak") });
    headerRow.createDiv({ cls: "dh-col-actions", text: "" });

    archivedHabits.forEach((habit, index) => {
      const row = list.createDiv({ cls: "dh-habit dh-habit-row archived" });

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
      const restoreBtn = actionsCol.createEl("button", { 
        cls: "dh-icon-btn"
      });
      TooltipHelper.set(restoreBtn, t("action_restore"));
      setIcon(restoreBtn, "rotate-ccw");
      restoreBtn.onclick = async () => {
        try {
          await this.plugin.habitManager.restoreHabit(habit.id);
          this.settingsTab.refreshUI();
          this.plugin.refreshWeeklyViews();
          NoticeService.success(t("action_restored_success"), this.plugin);
        } catch (e) {
          console.error('[Core Habits] Restore Error:', e);
          NoticeService.error(t("notice_error_prefix", { message: e.message }) || e.message, this.plugin);
        }
      };

      // Recoverable removal: the habit note remains in the vault archive.
      const removeBtn = actionsCol.createEl("button", { 
        cls: "dh-icon-btn mod-warning"
      });
      TooltipHelper.set(removeBtn, t("action_remove_from_archive"));
      setIcon(removeBtn, "trash-2");
      removeBtn.onclick = async () => {
        Utils.showConfirmNotice(
          this.app,
          this.plugin,
          t("action_remove_from_archive_confirm", { name: habit.name }),
          {
            confirmText: t("yes_sure"),
            cancelText: t("cancel"),
            onConfirm: async () => {
              try {
                await this.plugin.habitManager.removeHabit(habit.id);
                this.settingsTab.refreshUI();
                this.plugin.refreshWeeklyViews();
                NoticeService.success(t("action_removed_from_archive_success"), this.plugin);
              } catch (e) {
                console.error('[Core Habits] Remove From Archive Error:', e);
                NoticeService.error(t("notice_error_prefix", { message: e.message }) || e.message, this.plugin);
              }
            },
          }
        );
      };
    });
  }

  renderRemovedHabits(container, t) {
    container.empty();
    const removed = this.plugin.habitManager.getRemovedHabits();
    if (removed.length === 0) return;
    const details = container.createEl("details", { cls: "dh-settings-collapse" });
    if (this.isRemovedOpen) details.open = true;
    details.ontoggle = () => { this.isRemovedOpen = details.open; };
    const summary = details.createEl("summary", { cls: "dh-settings-collapse-summary" });
    summary.createSpan({ text: `${t("settings_removed_habits")} (${removed.length})` });
    this.removedContainer = details.createDiv({ cls: "dh-settings-collapse-content" });
    for (const habit of removed) {
      const row = this.removedContainer.createDiv({ cls: "dh-removed-habit-row" });
      row.createSpan({ text: habit.name });
      const restore = row.createEl("button", { cls: "dh-btn dh-btn-sm", text: t("action_restore") });
      restore.onclick = async () => {
        restore.disabled = true;
        try {
          await this.plugin.habitManager.restoreRemovedHabit(habit.id);
          this.settingsTab.refreshUI();
          this.plugin.refreshWeeklyViews();
          NoticeService.success(t("action_restored_success"), this.plugin);
        } catch (error) {
          restore.disabled = false;
          NoticeService.error(t("notice_error_prefix", { message: error.message }), this.plugin);
        }
      };
    }
  }

  showUndoRemoveNotice(removedHabit) {
    const t = (k, p) => this.plugin.translationManager.t(k, p);

    NoticeService.undo({
      message: t("notice_removed_habit", { name: removedHabit.name }),
      undoText: t("action_undo"),
      duration: 10000,
      plugin: this.plugin,
      onUndo: async () => {
        try {
          await this.plugin.habitManager.restoreRemovedHabit(removedHabit.id);
          this.settingsTab.refreshUI();
          this.plugin.refreshWeeklyViews();
          NoticeService.success(t("action_restored_habit_success"), 4000, this.plugin);
        } catch (error) {
          NoticeService.error(t("notice_error_prefix", { message: error.message }), 6000, this.plugin);
        }
      }
    });
  }
}
