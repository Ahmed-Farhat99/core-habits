import { setIcon } from 'obsidian';
import { DAY_KEYS, resolveHabitColorHex } from '../constants.js';
import { Utils } from '../utils/Utils.js';
import { DateUtils, buildHierarchyLabels } from '../utils/helpers.js';
import { StatusView } from './StatusView.js';
import { StreakCalculator } from '../services/StreakCalculator.js';
import { HabitCommentRepository } from '../repositories/HabitCommentRepository.js';

export class GridRenderer {
  constructor(context) {
    this.context = context;
    this.app = context.app;
    this.plugin = context.plugin;
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

    const isCompact = this.context.isCompactMode ? this.context.isCompactMode() : (container.clientWidth > 0 && container.clientWidth < 500);
    if (isCompact) {
      return this.renderCompactList(container, today, habits, weekContent);
    }

    const weekDayInfos = this.context.getWeekDayInfos();
    let todayIndex = 0;
    for (let i = 0; i < 7; i++) {
      if (weekDayInfos[i].isToday) {
        todayIndex = i;
        break;
      }
    }
    const rootContainer = container.closest(".weekly-grid-container") || container;
    rootContainer.setAttribute("data-today-index", String(todayIndex));

    const hasParentHabits = habits.some(h => this.plugin.habitManager.isParent(h.id));
    if (hasParentHabits) {
      const bulkActions = container.createDiv({ cls: "dh-bulk-actions-bar" });
      const collapsedCount = habits.filter(h => this.plugin.habitManager.isParent(h.id) && this.plugin.settings.collapsedGroups.includes(h.id)).length;
      const totalParents = habits.filter(h => this.plugin.habitManager.isParent(h.id)).length;
      const isAllCollapsed = collapsedCount === totalParents;

      const bulkBtn = bulkActions.createEl("button", {
        cls: "dh-btn dh-bulk-toggle-btn",
        text: isAllCollapsed
          ? this.plugin.translationManager.t("grid_expand_all")
          : this.plugin.translationManager.t("grid_collapse_all")
      });

      bulkBtn.onclick = async () => {
        const parentIds = habits.filter(h => this.plugin.habitManager.isParent(h.id)).map(h => h.id);
        if (isAllCollapsed) {
          this.plugin.settings.collapsedGroups = this.plugin.settings.collapsedGroups.filter(id => !parentIds.includes(id));
        } else {
          const currentCollapsed = new Set(this.plugin.settings.collapsedGroups);
          parentIds.forEach(id => currentCollapsed.add(id));
          this.plugin.settings.collapsedGroups = Array.from(currentCollapsed);
        }
        await this.plugin.saveSettings({ silent: true });
        await this.context.renderWeeklyGrid();
      };
    }

    // Create wrapper for sticky header functionality
    const tableWrapper = container.createDiv({ cls: "habits-grid-wrapper dh-desktop-scroll" });
    const table = tableWrapper.createDiv({ cls: "habits-grid" });

    // Render headers (without percentages initially)
    const thead = await this.renderDayHeaders(table, today);

    // Use DocumentFragment for batched DOM insertion
    const tbody = table.createDiv({ cls: "habits-tbody" });
    const fragment = document.createDocumentFragment();

    const { sorted: sortedHabits, labels: displayLabels } = buildHierarchyLabels(habits);
    const childRowsMap = new Map();

    // Color System — unified: --habit-color is the single source of truth
    const hexColorMap = new Map();
    for (const habit of sortedHabits) {
      if (!habit.parentId) {
        hexColorMap.set(habit.id, resolveHabitColorHex(habit.color));
      } else {
        // Child: always inherit parent's color
        hexColorMap.set(habit.id, hexColorMap.get(habit.parentId) ?? resolveHabitColorHex("teal"));
      }
    }

    // Render habit rows using pre-loaded content concurrently
    const rowPromises = sortedHabits.map(async (habit, habitIdx) => {
      try {
        const colorHex = hexColorMap.get(habit.id) || "#14b8a6";
        const dummyFrag = document.createElement("div");
        await this.renderHabitRow(dummyFrag, habit, weekContent, displayLabels[habitIdx], habits, colorHex);
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
        if (res.habit.parentId) {
          const pid = res.habit.parentId;
          if (!childRowsMap.has(pid)) childRowsMap.set(pid, []);
          childRowsMap.get(pid).push(res.row);
        }
      }
    }

    // Append all rows at once
    tbody.appendChild(fragment);

    // Now wire up collapse/expand buttons (after DOM insertion)
    childRowsMap.forEach((childRows, pid) => {
      const toggleBtn = tbody.querySelector(`[data-collapse-id="${pid}"]`);
      if (!toggleBtn) return;

      let collapsed = this.plugin.settings.collapsedGroups.includes(pid);

      // Apply initial DOM state immediately (no animation flash on render)
      childRows.forEach(row => { row.style.display = collapsed ? "none" : ""; });
      toggleBtn.classList.toggle("is-collapsed", collapsed);
      toggleBtn.title = collapsed
        ? this.plugin.translationManager.t("grid_expand_children")
        : this.plugin.translationManager.t("grid_collapse_children");

      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        collapsed = !collapsed;
        toggleBtn.classList.toggle("is-collapsed", collapsed);
        toggleBtn.title = collapsed
          ? this.plugin.translationManager.t("grid_expand_children")
          : this.plugin.translationManager.t("grid_collapse_children");
        childRows.forEach(row => { row.style.display = collapsed ? "none" : ""; });

        // Persist state via coordinator delegate
        this.context.toggleGroupCollapse(pid, collapsed);
      };
    });

    await this.updateHeaderPercentages(thead);
    await this.updateUnifiedProgressBar(container);

    if (this.plugin.settings.enableReflectionJournal) {
      const tfoot = table.createDiv({ cls: "habits-tfoot" });
      const footerRow = tfoot.createDiv({ cls: "dh-reflection-footer-row dh-grid-row diary-row" });
      
      // Index column placeholder
      footerRow.createDiv({ cls: "habit-index-header dh-grid-cell" });
      
      // Diary Title column
      const titleCell = footerRow.createDiv({ cls: "dh-footer-title dh-grid-cell" });
      const iconSpan = titleCell.createSpan();
      setIcon(iconSpan, "book-open");
      titleCell.createSpan({ text: this.plugin.translationManager.t("grid_diary_label") });
      
      const today = window.moment();
      for (let index = 0; index < 7; index++) {
        const dayCell = footerRow.createDiv({
          cls: "day-cell dh-grid-cell",
          attr: { "data-day-index": String(index) }
        });
        const dayDate = this.context.getWeekStart().clone().add(index, "days");
        const dateKey = DateUtils.formatDateKey(dayDate);
        
        if (!dayDate.isAfter(today, "day")) {
          const hasReflection = this.context.getReflectionDays()?.has(dateKey);
          const btn = dayCell.createEl("button", {
            cls: `dh-btn dh-footer-add-btn mod-icon ${hasReflection ? "has-reflection" : ""}`,
            title: hasReflection
              ? this.plugin.translationManager.t("grid_diary_exists_tooltip")
              : this.plugin.translationManager.t("grid_diary_add_tooltip")
          });
          btn.textContent = "📝";
          
          btn.onclick = (e) => {
            e.stopPropagation();
            this.context.openReflectionPopup(dayDate);
          };
        }
      }
    }

    if (this.plugin.settings.enableHabitContext) {
      this.populateCommentDots(tbody, sortedHabits, this.context.getWeekStart(), weekContent);
    }
    
    if (!this.plugin.settings.hasSeenGridHint) {
      const hint = container.createDiv({ cls: "dh-grid-hint" });
      hint.createDiv({ cls: "dh-grid-hint-text", text: this.plugin.translationManager.t("grid_hint_tip") });
      const closeBtn = hint.createEl("button", { cls: "dh-grid-hint-close", text: "×", title: this.plugin.translationManager.t("grid_hint_hide") });
      closeBtn.onclick = async () => {
        hint.remove();
        await this.context.dismissGridHint();
      };
    }
  }

  async renderDayHeaders(table) {
    const thead = table.createDiv({ cls: "habits-thead" });

    // Row 1: Day Names & Dates
    const headerRow = thead.createDiv({ cls: "header-row-date dh-grid-row" });
    headerRow.createDiv({ cls: "habit-index-header dh-grid-cell", text: "#" });
    headerRow.createDiv({ cls: "corner-cell dh-grid-cell" });

    // Row 2: Daily Stats
    const statsRow = thead.createDiv({ cls: "header-row-stats dh-grid-row" });
    statsRow.createDiv({ cls: "habit-index-header dh-grid-cell" });
    statsRow.createDiv({ cls: "corner-cell stats-corner dh-grid-cell" });

    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const weekDayInfos = this.context.getWeekDayInfos();

    for (let i = 0; i < 7; i++) {
      const { dayDate, isToday, dayOfWeek } = weekDayInfos[i];

      const dayHeaderCell = headerRow.createDiv({
        cls: `day-header dh-grid-cell ${isToday ? "today" : ""} clickable`,
        attr: { "data-day-index": String(i) }
      });
      const name = t(DAY_KEYS[dayOfWeek]);

      dayHeaderCell.createDiv({ text: name, cls: "day-name" });

      const displayDate = dayDate.clone().locale(this.plugin.settings.language || "ar");
      dayHeaderCell.createDiv({
        text: displayDate.format(t("date_format_short")),
        cls: "day-date",
      });

      if (this.plugin.settings.showHijriDate) {
        try {
          const hijriDate = DateUtils.getHijriDate(dayDate, this.isAr);
          const hijriParts = hijriDate.replace(/\s+هـ$/, "").split(" ");
          const hijriShort = hijriParts.length >= 2 ? `${hijriParts[0]} ${hijriParts[1]}` : hijriDate;
          dayHeaderCell.createDiv({ text: hijriShort, cls: "day-date-hijri" });
        } catch (e) {
          Utils.debugLog(this.plugin, "Error displaying Hijri date:", e);
        }
      }

      dayHeaderCell.onclick = () => {
        this.context.openDailyNote(dayDate);
      };
      dayHeaderCell.title = t("grid_click_open_note_tooltip");

      statsRow.createDiv({
        cls: `day-stat-cell dh-grid-cell ${isToday ? "today" : ""}`,
        attr: { "data-day-index": String(i) }
      });
    }
    return thead;
  }

  async renderHabitRow(container, habit, weekContent, displayLabel = "?", allHabits = [], colorHex = "#14b8a6") {
    const effectiveParentId = this.plugin.habitManager.getEffectiveParentId(habit.id);
    const isChild = effectiveParentId !== null;
    const isParentHabit = allHabits.length > 0
      ? allHabits.some(h => this.plugin.habitManager.getEffectiveParentId(h.id) === habit.id)
      : this.plugin.habitManager.isParent(habit.id);
    const rowCls = isChild ? "habit-row habit-row-child" : "habit-row";
    const rowClsFinal = `${rowCls} group-${effectiveParentId || habit.id} dh-grid-row dh-mobile-card`;
    const row = container.createDiv({ cls: rowClsFinal });

    row.style.setProperty("--habit-color", colorHex);
    row.setAttribute("data-group-id", effectiveParentId || habit.id);
    const safeGroupId = (effectiveParentId || habit.id).replace(/["\\]/g, '\\$&');
    row.onmouseenter = () => {
      container.querySelectorAll(`[data-group-id="${safeGroupId}"]`).forEach(r => r.classList.add('dh-group-hover-active'));
    };
    row.onmouseleave = () => {
      container.querySelectorAll(`[data-group-id="${safeGroupId}"]`).forEach(r => r.classList.remove('dh-group-hover-active'));
    };

    row.createDiv({
      cls: "habit-index-cell dh-grid-cell",
      text: String(displayLabel),
    });

    const nameCell = row.createDiv({ cls: "habit-name-cell dh-grid-cell" });
    const contentWrapper = nameCell.createDiv({ cls: "dh-name-content" });
    const metaWrapper = nameCell.createDiv({ cls: "dh-name-meta" });

    contentWrapper.createSpan({
      cls: `dh-type-dot ${habit.habitType === "break" ? "break" : "build"}`,
      title: this.plugin.translationManager.t(habit.habitType === "break" ? "grid_type_break" : "grid_type_build"),
    });

    if (isChild) {
      contentWrapper.createSpan({ cls: "dh-child-indent", text: "└ " });
    }

    if (isParentHabit) {
      const btn = contentWrapper.createSpan({
        cls: "dh-collapse-btn",
        title: this.plugin.translationManager.t("grid_collapse_expand_tooltip"),
        attr: { "data-collapse-id": habit.id },
      });
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="dh-chevron-icon"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
    }

    const habitName = habit.name ?? "";
    const nameLink = contentWrapper.createEl("span", {
      text: habitName,
      cls: "habit-name-link habit-pure-name",
      title: habitName,
    });

    if (isParentHabit && allHabits.length > 0) {
      const allChildren = allHabits.filter(h => this.plugin.habitManager.getEffectiveParentId(h.id) === habit.id);
      if (allChildren.length > 0) {
        const today = window.moment();
        const todayDayOfWeek = today.day();
        const scheduledChildren = allChildren.filter(child =>
          this.plugin.habitManager.isHabitScheduledForDay(child, todayDayOfWeek)
        );
        if (scheduledChildren.length > 0) {
          const progressSlot = metaWrapper.createDiv({ cls: "dh-child-progress" });
          const todayKey = DateUtils.formatDateKey(today);
          const todayContent = weekContent ? weekContent.get(todayKey) || null : null;
          Promise.all(scheduledChildren.map(child => this.getHabitStatusForDay(child, today, todayContent)))
            .then(statuses => {
              const completedCount = statuses.filter(s => s === "completed").length;
              const total = scheduledChildren.length;
              const checkStr = completedCount === total ? " ✓" : "";
              progressSlot.textContent = `(${completedCount}/${total}${checkStr})`;
              if (completedCount === total) progressSlot.addClass("complete");
            })
            .catch(() => { progressSlot.remove(); });
        }
      }
    }

    metaWrapper.createSpan({ cls: "dh-streak-badge-slot" });
    this.context.queueStreakCalculation(habit, row);

    const openPageIcon = metaWrapper.createEl("span", {
      cls: "habit-open-page-icon",
      title: this.plugin.translationManager.t("grid_open_habit_page_tooltip"),
    });
    setIcon(openPageIcon, "external-link");

    openPageIcon.onclick = (e) => {
      e.stopPropagation();
      this.context.openHabitPage(habit);
    };

    nameLink.onclick = () => {
      this.context.openEditHabitModal(habit);
    };

    const today = window.moment();
    const weekDayInfos = this.context.getWeekDayInfos();

    for (let i = 0; i < 7; i++) {
      const { dayDate, dateKey, isToday, dayOfWeek } = weekDayInfos[i];
      const isScheduled = this.plugin.habitManager.isHabitScheduledForDay(
        habit,
        dayOfWeek,
      );
      const isFuture = dayDate.isAfter(today, "day");
      const isAfterArchive = habit.archived && habit.archivedDate && dayDate.clone().startOf("day").isAfter(window.moment(habit.archivedDate).startOf("day"));

      const cell = row.createDiv({
        cls: `day-cell dh-grid-cell ${isToday ? "is-today" : ""}`,
        attr: { "data-day-index": String(i) },
      });

      const tooltipDayName = this.plugin.translationManager.t(DAY_KEYS[dayOfWeek]);
      const lang = this.plugin.settings.language || "ar";
      const tooltipDate = dayDate.clone().locale(lang).format(this.plugin.translationManager.t("date_format_short"));
      const baseTitle = `#${displayLabel} ${habitName} — ${tooltipDayName} ${tooltipDate}`;

      let tooltipText = this.plugin.settings.enableHabitContext
        ? `${baseTitle}\n(${this.plugin.translationManager.t("grid_cell_right_click_hint")})`
        : baseTitle;

      if (isAfterArchive) {
        tooltipText = this.plugin.translationManager.t("grid_habit_archived_tooltip", { title: baseTitle });
      }
      cell.title = tooltipText;

      if (!isScheduled) {
        cell.textContent = "--";
        cell.addClass("not-scheduled");
      } else if (isAfterArchive) {
        cell.textContent = "🔒";
        cell.addClass("not-scheduled");
      } else if (isFuture) {
        cell.textContent = "☐";
        cell.addClass("future");
      } else {
        const preloaded = weekContent ? (weekContent.has(dateKey) ? weekContent.get(dateKey) : undefined) : null;
        const status = await this.getHabitStatusForDay(
          habit,
          dayDate,
          preloaded,
        );

        if (status === "ignored") {
          cell.textContent = "--";
          cell.addClass("not-scheduled");
        } else if (status === "uncompleted" && habit.restoredDate &&
          dayDate.isBefore(window.moment(habit.restoredDate), "day")) {
          cell.textContent = "--";
          cell.addClass("not-scheduled");
        } else {
          const cellKey = `${habit.id}:${dateKey}`;

          if (status === "completed") {
            cell.textContent = "✓";
            cell.addClass("completed");
          } else if (status === "skipped") {
            cell.textContent = "⊘";
            cell.addClass("skipped");
          } else if (status === "missed") {
            cell.textContent = "x";
            cell.addClass("missed");
          } else {
            cell.textContent = "☐";
            cell.addClass("pending");
          }

          cell.setAttribute("data-status", status === "missed" ? "uncompleted" : status);
          cell.setAttribute("tabindex", "0");
          cell.setAttribute("role", "button");
          cell.onclick = async () => {
            const current = cell.getAttribute("data-status");
            let next;
            if (current === "completed") next = "skipped";
            else if (current === "skipped") next = "uncompleted";
            else next = "completed";
            
            const success = await this.context.toggleHabitCompletion(habit, dayDate, next);
            if (success) {
              cell.className = `day-cell dh-grid-cell ${isToday ? "is-today" : ""}`;
              let newContent = "☐";
              if (next === "completed") {
                newContent = "✓";
                cell.addClass("completed");
                cell.addClass("habit-pulse");
                setTimeout(() => cell.removeClass("habit-pulse"), 400);
              } else if (next === "skipped") {
                newContent = "⊘";
                cell.addClass("skipped");
              } else {
                cell.addClass("pending");
              }
              
              const textNode = Array.from(cell.childNodes).find(n => n.nodeType === 3);
              if (textNode) {
                textNode.textContent = newContent;
              } else {
                cell.prepend(document.createTextNode(newContent));
              }
              cell.setAttribute("data-status", next);

              await this.updateHeaderAndProgress();
              
              await this.context.checkMilestone(dateKey);
              
              this.refreshRowMeta(habit);
            }
          };
          cell.onkeydown = (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              cell.click();
            }
          };
        }
      }

      if (this.plugin.settings.enableHabitContext && isScheduled && !isFuture) {
        const openCommentPopup = (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.context.openCommentPopup(habit, dayDate);
        };

        cell.oncontextmenu = openCommentPopup;

        let _touchTimer = null;
        cell.addEventListener('touchstart', (e) => {
          _touchTimer = setTimeout(() => {
            _touchTimer = null;
            openCommentPopup(e);
          }, 500);
        }, { passive: true });
        cell.addEventListener('touchend', () => {
          if (_touchTimer) { clearTimeout(_touchTimer); _touchTimer = null; }
        });
        cell.addEventListener('touchmove', () => {
          if (_touchTimer) { clearTimeout(_touchTimer); _touchTimer = null; }
        });
      }
    }
    return row;
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
    const dailyContentByIndex = new Map();

    for (let i = 0; i < 7; i++) {
      const dayDate = weekStart.clone().add(i, "days");
      const dateKey = DateUtils.formatDateKey(dayDate);
      const content = weekContent ? weekContent.get(dateKey) || null : null;
      if (content) {
        dailyContentByIndex.set(i, content);
      }
    }

    for (const habit of habits) {
      if (this.context.isClosed()) return;

      const rows = tbody.querySelectorAll(`.habit-row`);
      for (const row of rows) {
        const nameEl = row.querySelector(".habit-pure-name");
        if (!nameEl || nameEl.textContent !== habit.name) continue;

        for (let i = 0; i < 7; i++) {
          const content = dailyContentByIndex.get(i);
          if (!content) continue;

          const lines = this.context.extractSectionLines(content, this.context.getHabitNotesHeading());
          let hasComment = false;

          for (const line of lines) {
            if (HabitCommentRepository.isCommentLineForHabit(line, habit)) {
              hasComment = true;
              break;
            }
          }

          if (hasComment) {
            const cell = row.querySelector(`[data-day-index="${i}"]`);
            if (cell && !cell.querySelector(".dh-has-comment-dot")) {
              cell.createDiv({ cls: "dh-has-comment-dot" });
            }
          }
        }
        break;
      }
    }
  }

  async updateHeaderAndProgress() {
    const contentEl = this.context.getWeeklyContentContainer();
    if (contentEl) {
      await this.updateUnifiedProgressBar(contentEl);
      const thead = contentEl.querySelector(".habits-thead");
      if (thead) await this.updateHeaderPercentages(thead);
    }
  }

  refreshRowMeta(habit) {
    const container = this.context.getWeeklyContentContainer();
    if (!container) return;
    const currentToken = this.context.getRenderToken ? this.context.getRenderToken() : null;

    if (habit.parentId) {
      const parentRows = container.querySelectorAll(`.habit-row[data-group-id="${habit.parentId}"]`);
      for (const row of parentRows) {
        if (row.classList.contains('habit-row-child')) continue;
        const progressSlot = row.querySelector('.dh-child-progress');
        if (!progressSlot) break;
        const today = window.moment();
        const todayDow = today.day();
        const allHabits = this.plugin.habitManager.getActiveHabits();
        const children = allHabits.filter(h => h.parentId === habit.parentId);
        const scheduled = children.filter(c =>
          this.plugin.habitManager.isHabitScheduledForDay(c, todayDow)
        );
        if (scheduled.length > 0) {
          const todayKey = DateUtils.formatDateKey(today);
          const weekContent = this.context.getWeekContentCache ? this.context.getWeekContentCache() : null;
          const todayContent = weekContent ? weekContent.get(todayKey) || null : null;
          
          Promise.all(scheduled.map(c => this.getHabitStatusForDay(c, today, todayContent)))
            .then(statuses => {
              if (this.context.getRenderToken && this.context.getRenderToken() !== currentToken) {
                return;
              }
              const completedCount = statuses.filter(s => s === "completed").length;
              const total = scheduled.length;
              const checkStr = completedCount === total ? " \u2713" : "";
              progressSlot.textContent = `(${completedCount}/${total}${checkStr})`;
              if (completedCount === total) progressSlot.addClass("complete");
              else progressSlot.removeClass("complete");
            })
            .catch((err) => {
              console.error("[Core Habits] Failed to update parent progress dynamically:", err);
            });
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
          while (slot.firstChild) slot.removeChild(slot.firstChild);
          if (currentStreak >= 2) {
            const badge = slot.createSpan({
              cls: "dh-streak-badge",
              text: `🔥${currentStreak}`,
            });
            badge.title = this.plugin.translationManager.t("streak_title", { streak: currentStreak });
          }
        }).catch(() => { });
        break;
      }
    }, 500);

    this.context.setRefreshTimer(newTimer);
  }

  async updateHeaderPercentages(thead) {
    if (!thead) return;
    const today = window.moment();
    const statCells = thead.querySelectorAll(".day-stat-cell");
    const dayCount = 7;
    const dailyStats = this.context.getDailyStats();
    if (!statCells || statCells.length !== dayCount || !dailyStats) return;

    for (let index = 0; index < dayCount; index++) {
      const cell = statCells[index];
      if (!cell) continue;
      cell.empty();

      const dayDate = this.context.getWeekStart().clone().add(index, "days");
      const dateKey = DateUtils.formatDateKey(dayDate);
      const stats = dailyStats[dateKey];

      if (stats && !dayDate.isAfter(today, "day") && stats.total > 0) {
        const percent = Math.min(100, Math.round((stats.completed / stats.total) * 100));
        let colorClass = "percent-low";
        if (percent === 100) colorClass = "percent-complete";
        else if (percent >= 80) colorClass = "percent-high";
        else if (percent >= 50) colorClass = "percent-medium";

        const badge = cell.createDiv({ cls: `day-stat-badge ${colorClass}` });
        badge.textContent = percent === 100 ? "✓" : `${percent}%`;
        badge.title = `${stats.completed}/${stats.total} Completed`;
      }
    }
  }

  async calculateLastWeekRateAsync() {
    const prevWeekStartStr = DateUtils.formatDateKey(this.context.getWeekStart().clone().subtract(7, "days"));
    const lastWeekRatesCache = this.context.getLastWeekRatesCache();
    if (lastWeekRatesCache && lastWeekRatesCache.has(prevWeekStartStr)) {
      return lastWeekRatesCache.get(prevWeekStartStr);
    }

    const rate = await this.plugin.statsService.calculateLastWeekRate(this.context.getWeekStart());

    if (lastWeekRatesCache) {
      lastWeekRatesCache.set(prevWeekStartStr, rate);
    }

    return rate;
  }

  async updateUnifiedProgressBar(container) {
    const today = window.moment();
    const root = container.closest(".weekly-grid-container") || container;
    const progressContainer = root.querySelector(
      ".weekly-header-progress-container",
    );
    if (!progressContainer) return;

    progressContainer.empty();

    if (!this.plugin.settings.showCount) {
      return;
    }

    let weekTotal = 0;
    let weekCompleted = 0;
    const dailyStats = this.context.getDailyStats();

    for (const dateKey in dailyStats) {
      const stats = dailyStats[dateKey];
      const dayMoment = window.moment(dateKey, "YYYY-MM-DD", true);
      if (!dayMoment.isAfter(today, "day")) {
        weekTotal += stats.total;
        weekCompleted += stats.completed;
      }
    }

    const weekPercentage =
      weekTotal > 0 ? Math.round((weekCompleted / weekTotal) * 100) : 0;

    progressContainer.style.setProperty(
      "--total-count",
      weekTotal > 0 ? weekTotal : 10,
    );

    const internalWrapper = progressContainer.createDiv({
      cls: "unified-progress-wrapper",
    });

    const label = internalWrapper.createDiv({ cls: "progress-label" });
    label.textContent = this.plugin.translationManager.t("grid_completion_rate");

    const countBadge = internalWrapper.createDiv({ cls: "weekly-count-badge" });
    countBadge.textContent = `${weekCompleted}/${weekTotal}`;

    const barContainer = internalWrapper.createDiv({
      cls: "weekly-progress-bar unified-bar",
    });
    const barFill = barContainer.createDiv({ cls: "weekly-progress-fill" });
    barFill.style.width = `${weekPercentage}%`;

    if (weekPercentage >= 90) barFill.addClass("progress-excellent");
    else if (weekPercentage >= 70) barFill.addClass("progress-good");
    else if (weekPercentage >= 50) barFill.addClass("progress-medium");
    else barFill.addClass("progress-low");

    const percentText = internalWrapper.createDiv({
      cls: "unified-percent-text",
    });
    percentText.textContent = `${weekPercentage}%`;

    const lastWeekRate = await this.calculateLastWeekRateAsync();
    const captionEl = progressContainer.createDiv({ cls: "weekly-barrier-caption" });
    if (weekPercentage < lastWeekRate) {
      const gap = lastWeekRate - weekPercentage;
      captionEl.addClass("state-gap");
      captionEl.textContent = this.plugin.translationManager.t("grid_completion_gap", { gap, lastRate: lastWeekRate });
    } else if (weekPercentage === lastWeekRate) {
      if (lastWeekRate === 0) {
        captionEl.style.display = "none";
      } else {
        captionEl.addClass("state-match");
        captionEl.textContent = this.plugin.translationManager.t("grid_completion_match", { lastRate: lastWeekRate });
      }
    } else {
      const lead = weekPercentage - lastWeekRate;
      captionEl.addClass("state-break");
      captionEl.textContent = this.plugin.translationManager.t("grid_completion_break", { lead });
    }
  }

  async renderCompactList(container, today, habits, weekContent) {
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const isAr = this.isAr;
    const weekDayInfos = this.context.getWeekDayInfos();

    // Get or initialize focused day index
    let focusedIdx = this.context.getFocusedDayIndex();
    if (focusedIdx === null || focusedIdx < 0 || focusedIdx > 6) {
      focusedIdx = 0;
      for (let i = 0; i < 7; i++) {
        if (weekDayInfos[i].isToday) {
          focusedIdx = i;
          break;
        }
      }
      this.context.setFocusedDayIndex(focusedIdx);
    }

    const { dayDate, isToday, dayOfWeek } = weekDayInfos[focusedIdx];
    const dateKey = DateUtils.formatDateKey(dayDate);

    // Create wrapper for the compact view
    const compactWrapper = container.createDiv({ cls: "dh-compact-view-wrapper" });

    // 1. Day Navigator Header
    const navigator = compactWrapper.createDiv({ cls: "dh-compact-navigator" });

    const prevBtn = navigator.createEl("button", {
      cls: "dh-btn dh-compact-nav-btn mod-icon",
      title: t("grid_previous_day_tooltip") || "Previous Day"
    });
    setIcon(prevBtn, isAr ? "chevron-right" : "chevron-left");
    prevBtn.onclick = async () => {
      const nextIdx = (focusedIdx - 1 + 7) % 7;
      this.context.setFocusedDayIndex(nextIdx);
      await this.context.renderWeeklyGrid();
    };

    const titleWrap = navigator.createDiv({ cls: "dh-compact-nav-title-wrap" });
    titleWrap.createDiv({ cls: "dh-compact-nav-day-name", text: t(DAY_KEYS[dayOfWeek]) });
    
    const displayDate = dayDate.clone().locale(this.plugin.settings.language || "ar");
    const dateLabelStr = displayDate.format(t("date_format_short"));
    const hijriLabelStr = this.plugin.settings.showHijriDate ? DateUtils.getHijriDate(dayDate, isAr) : "";
    
    const dateLabelText = this.plugin.settings.showHijriDate 
      ? `${dateLabelStr} | ${hijriLabelStr.replace(/\s+هـ$/, "")}`
      : dateLabelStr;
      
    titleWrap.createDiv({ cls: "dh-compact-nav-date", text: dateLabelText });

    const nextBtn = navigator.createEl("button", {
      cls: "dh-btn dh-compact-nav-btn mod-icon",
      title: t("grid_next_day_tooltip") || "Next Day"
    });
    setIcon(nextBtn, isAr ? "chevron-left" : "chevron-right");
    nextBtn.onclick = async () => {
      const nextIdx = (focusedIdx + 1) % 7;
      this.context.setFocusedDayIndex(nextIdx);
      await this.context.renderWeeklyGrid();
    };

    // Quick "Today" jump button inside navigator
    const todayJumpBtn = navigator.createEl("button", {
      cls: `dh-btn dh-compact-today-btn ${isToday ? "is-hidden" : ""}`,
      text: t("today"),
      title: t("back_to_today")
    });
    todayJumpBtn.onclick = async () => {
      let todayIdx = 0;
      for (let i = 0; i < 7; i++) {
        if (weekDayInfos[i].isToday) {
          todayIdx = i;
          break;
        }
      }
      this.context.setFocusedDayIndex(todayIdx);
      await this.context.renderWeeklyGrid();
    };

    // 2. Compact List Body
    const hasParentHabits = habits.some(h => this.plugin.habitManager.isParent(h.id));
    if (hasParentHabits) {
      const bulkActions = compactWrapper.createDiv({ cls: "dh-bulk-actions-bar compact" });
      const collapsedCount = habits.filter(h => this.plugin.habitManager.isParent(h.id) && this.plugin.settings.collapsedGroups.includes(h.id)).length;
      const totalParents = habits.filter(h => this.plugin.habitManager.isParent(h.id)).length;
      const isAllCollapsed = collapsedCount === totalParents;

      const bulkBtn = bulkActions.createEl("button", {
        cls: "dh-btn dh-bulk-toggle-btn",
        text: isAllCollapsed
          ? this.plugin.translationManager.t("grid_expand_all")
          : this.plugin.translationManager.t("grid_collapse_all")
      });

      bulkBtn.onclick = async () => {
        const parentIds = habits.filter(h => this.plugin.habitManager.isParent(h.id)).map(h => h.id);
        if (isAllCollapsed) {
          this.plugin.settings.collapsedGroups = this.plugin.settings.collapsedGroups.filter(id => !parentIds.includes(id));
        } else {
          const currentCollapsed = new Set(this.plugin.settings.collapsedGroups);
          parentIds.forEach(id => currentCollapsed.add(id));
          this.plugin.settings.collapsedGroups = Array.from(currentCollapsed);
        }
        await this.plugin.saveSettings({ silent: true });
        await this.context.renderWeeklyGrid();
      };
    }

    const listBody = compactWrapper.createDiv({ cls: "dh-compact-list" });
    const { sorted: sortedHabits } = buildHierarchyLabels(habits);

    // Color mapping
    const hexColorMap = new Map();
    for (const habit of sortedHabits) {
      if (!habit.parentId) {
        hexColorMap.set(habit.id, resolveHabitColorHex(habit.color));
      } else {
        hexColorMap.set(habit.id, hexColorMap.get(habit.parentId) ?? resolveHabitColorHex("teal"));
      }
    }

    const rowPromises = sortedHabits.map(async (habit) => {
      const colorHex = hexColorMap.get(habit.id) || "#14b8a6";
      
      const effectiveParentId = this.plugin.habitManager.getEffectiveParentId(habit.id);
      const isChild = effectiveParentId !== null;
      const isParentHabit = sortedHabits.some(h => this.plugin.habitManager.getEffectiveParentId(h.id) === habit.id);
      
      const rowCls = isChild ? "habit-row habit-row-child dh-compact-row" : "habit-row dh-compact-row";
      const row = listBody.createDiv({ cls: rowCls });
      
      row.style.setProperty("--habit-color", colorHex);
      row.setAttribute("data-group-id", effectiveParentId || habit.id);

      // Left-side details (Name, Hierarchy level, Type Indicator)
      const nameSection = row.createDiv({ cls: "dh-compact-name-section" });
      
      // Type dot
      nameSection.createSpan({
        cls: `dh-type-dot ${habit.habitType === "break" ? "break" : "build"}`,
        title: t(habit.habitType === "break" ? "grid_type_break" : "grid_type_build"),
      });

      // Child indentation
      if (isChild) {
        nameSection.createSpan({ cls: "dh-child-indent", text: "└ " });
      }

      if (isParentHabit) {
        const btn = nameSection.createSpan({
          cls: "dh-collapse-btn",
          title: this.plugin.translationManager.t("grid_collapse_expand_tooltip"),
          attr: { "data-collapse-id": habit.id },
        });
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="dh-chevron-icon"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
      }

      // Habit Name Link
      const habitName = habit.name ?? "";
      const nameLink = nameSection.createEl("span", {
        text: habitName,
        cls: "habit-name-link habit-pure-name",
        title: habitName,
      });
      nameLink.onclick = () => {
        this.context.openEditHabitModal(habit);
      };

      // Streak slot and other metadata
      const metaWrapper = row.createDiv({ cls: "dh-compact-meta-section" });
      
      // For parents, calculate and display child progress
      if (isParentHabit) {
        const allChildren = sortedHabits.filter(h => this.plugin.habitManager.getEffectiveParentId(h.id) === habit.id);
        const scheduledChildren = allChildren.filter(child =>
          this.plugin.habitManager.isHabitScheduledForDay(child, dayOfWeek)
        );
        if (scheduledChildren.length > 0) {
          const progressSlot = metaWrapper.createDiv({ cls: "dh-child-progress" });
          const todayContent = weekContent ? weekContent.get(dateKey) || null : null;
          const statuses = await Promise.all(scheduledChildren.map(child => this.getHabitStatusForDay(child, dayDate, todayContent)));
          const completedCount = statuses.filter(s => s === "completed").length;
          const total = scheduledChildren.length;
          const checkStr = completedCount === total ? " ✓" : "";
          progressSlot.textContent = `(${completedCount}/${total}${checkStr})`;
          if (completedCount === total) progressSlot.addClass("complete");
        }
      }

      metaWrapper.createSpan({ cls: "dh-streak-badge-slot" });
      this.context.queueStreakCalculation(habit, row);

      // Open Page Icon
      const openPageIcon = metaWrapper.createEl("span", {
        cls: "habit-open-page-icon",
        title: t("grid_open_habit_page_tooltip"),
      });
      setIcon(openPageIcon, "external-link");
      openPageIcon.onclick = (e) => {
        e.stopPropagation();
        this.context.openHabitPage(habit);
      };

      // Right-side Status / Checkbox Action
      const actionSection = row.createDiv({ cls: "dh-compact-action-section" });

      const isScheduled = this.plugin.habitManager.isHabitScheduledForDay(habit, dayOfWeek);
      const isFuture = dayDate.isAfter(today, "day");
      const isAfterArchive = habit.archived && habit.archivedDate && dayDate.clone().startOf("day").isAfter(window.moment(habit.archivedDate).startOf("day"));

      if (!isScheduled) {
        const span = actionSection.createSpan({ cls: "dh-compact-status-text not-scheduled", text: "--" });
        span.title = t("grid_habit_not_scheduled_tooltip") || "Not Scheduled";
      } else if (isAfterArchive) {
        const span = actionSection.createSpan({ cls: "dh-compact-status-text archived", text: "🔒" });
        span.title = t("grid_habit_archived_tooltip", { title: habitName });
      } else if (isFuture) {
        const span = actionSection.createSpan({ cls: "dh-compact-status-text future", text: "☐" });
        span.title = t("future");
      } else {
        const preloaded = weekContent ? (weekContent.has(dateKey) ? weekContent.get(dateKey) : undefined) : null;
        const status = await this.getHabitStatusForDay(habit, dayDate, preloaded);

        if (status === "ignored") {
          actionSection.createSpan({ cls: "dh-compact-status-text ignored", text: "--" });
        } else if (status === "uncompleted" && habit.restoredDate && dayDate.isBefore(window.moment(habit.restoredDate), "day")) {
          actionSection.createSpan({ cls: "dh-compact-status-text ignored", text: "--" });
        } else {
          // Render interactive cell/checkbox
          const statusBtn = actionSection.createEl("button", {
            cls: `dh-compact-status-btn status-${status}`,
            attr: { "data-status": status === "missed" ? "uncompleted" : status }
          });
          
          if (status === "completed") statusBtn.textContent = "✓";
          else if (status === "skipped") statusBtn.textContent = "⊘";
          else if (status === "missed") statusBtn.textContent = "x";
          else statusBtn.textContent = "☐";

          statusBtn.onclick = async (e) => {
            e.stopPropagation();
            const current = statusBtn.getAttribute("data-status");
            let next;
            if (current === "completed") next = "skipped";
            else if (current === "skipped") next = "uncompleted";
            else next = "completed";

            const success = await this.context.toggleHabitCompletion(habit, dayDate, next);
            if (success) {
              statusBtn.className = `dh-compact-status-btn status-${next}`;
              statusBtn.setAttribute("data-status", next);

              if (next === "completed") {
                statusBtn.textContent = "✓";
                statusBtn.addClass("habit-pulse");
                setTimeout(() => statusBtn.removeClass("habit-pulse"), 400);
              } else if (next === "skipped") {
                statusBtn.textContent = "⊘";
              } else if (next === "missed") {
                statusBtn.textContent = "x";
              } else {
                statusBtn.textContent = "☐";
              }

              // Update the progress bars and details
              await this.updateHeaderAndProgress();
              await this.context.checkMilestone(dateKey);
              this.refreshRowMeta(habit);
            }
          };

          // Context menu comments support
          if (this.plugin.settings.enableHabitContext) {
            statusBtn.oncontextmenu = (e) => {
              e.preventDefault();
              e.stopPropagation();
              this.context.openCommentPopup(habit, dayDate);
            };

            // Touch events for mobile
            let _touchTimer = null;
            statusBtn.addEventListener('touchstart', (e) => {
              _touchTimer = setTimeout(() => {
                _touchTimer = null;
                e.preventDefault();
                e.stopPropagation();
                this.context.openCommentPopup(habit, dayDate);
              }, 500);
            }, { passive: true });
            statusBtn.addEventListener('touchend', () => {
              if (_touchTimer) { clearTimeout(_touchTimer); _touchTimer = null; }
            });
            statusBtn.addEventListener('touchmove', () => {
              if (_touchTimer) { clearTimeout(_touchTimer); _touchTimer = null; }
            });
          }
        }
      }
    });

    await Promise.all(rowPromises);

    // Wire up collapse/expand buttons for compact rows
    const compactChildRowsMap = new Map();
    const compactRows = listBody.querySelectorAll('.dh-compact-row');
    for (const row of compactRows) {
      const gid = row.getAttribute('data-group-id');
      if (row.classList.contains('habit-row-child')) {
        if (!compactChildRowsMap.has(gid)) compactChildRowsMap.set(gid, []);
        compactChildRowsMap.get(gid).push(row);
      }
    }

    compactChildRowsMap.forEach((childRows, pid) => {
      const toggleBtn = listBody.querySelector(`[data-collapse-id="${pid}"]`);
      if (!toggleBtn) return;

      let collapsed = this.plugin.settings.collapsedGroups.includes(pid);

      childRows.forEach(row => { row.style.display = collapsed ? "none" : ""; });
      toggleBtn.classList.toggle("is-collapsed", collapsed);
      toggleBtn.title = collapsed
        ? this.plugin.translationManager.t("grid_expand_children")
        : this.plugin.translationManager.t("grid_collapse_children");

      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        collapsed = !collapsed;
        toggleBtn.classList.toggle("is-collapsed", collapsed);
        toggleBtn.title = collapsed
          ? this.plugin.translationManager.t("grid_expand_children")
          : this.plugin.translationManager.t("grid_collapse_children");
        childRows.forEach(row => { row.style.display = collapsed ? "none" : ""; });

        this.context.toggleGroupCollapse(pid, collapsed);
      };
    });

    // Add comment dots to compact rows if enabled
    if (this.plugin.settings.enableHabitContext) {
      for (const habit of sortedHabits) {
        const content = weekContent ? weekContent.get(dateKey) || null : null;
        if (content) {
          const lines = this.context.extractSectionLines(content, this.context.getHabitNotesHeading());
          let hasComment = false;
          for (const line of lines) {
            if (HabitCommentRepository.isCommentLineForHabit(line, habit)) {
              hasComment = true;
              break;
            }
          }
          if (hasComment) {
            const row = listBody.querySelector(`.habit-row[data-group-id="${habit.parentId || habit.id}"]`);
            if (row) {
              const btn = row.querySelector(".dh-compact-status-btn");
              if (btn && !btn.querySelector(".dh-has-comment-dot")) {
                btn.createDiv({ cls: "dh-has-comment-dot" });
              }
            }
          }
        }
      }
    }

    // 3. Compact Reflection Footer
    if (this.plugin.settings.enableReflectionJournal) {
      const footer = compactWrapper.createDiv({ cls: "dh-compact-footer" });
      const diaryBtn = footer.createEl("button", {
        cls: `dh-btn dh-compact-diary-btn ${this.context.getReflectionDays()?.has(dateKey) ? "has-reflection" : ""}`,
        title: this.context.getReflectionDays()?.has(dateKey)
          ? t("grid_diary_exists_tooltip")
          : t("grid_diary_add_tooltip")
      });
      setIcon(diaryBtn, "book-open");
      diaryBtn.createSpan({ text: t("grid_diary_label") + (this.context.getReflectionDays()?.has(dateKey) ? " ✓" : " +") });
      
      diaryBtn.onclick = (e) => {
        e.stopPropagation();
        this.context.openReflectionPopup(dayDate);
      };
    }

    // Update the progress bar percentages
    await this.updateUnifiedProgressBar(container);
  }
}
