import { Utils } from '../utils/Utils.js';
import { getNoteByDate, TextUtils, findHabitEntry, buildHierarchyLabels } from '../utils/helpers.js';
import { inspectHabitContract, HABIT_SCHEMA_VERSION } from '../domain/HabitDataContract.js';
import { StreakCalculator } from './StreakCalculator.js';
import { Modal, Notice } from 'obsidian';
import { RenameProgressModal } from '../modals/RenameProgressModal.js';
import { TRANSLATIONS } from '../constants.js';

export class HabitManager {
  constructor(plugin) {
    this.plugin = plugin;
    this.habitsMap = new Map();
    this.isInitialized = false;
  }

  t(key, params = {}) {
    if (this.plugin.translationManager) {
      return this.plugin.translationManager.t(key, params);
    }
    const lang = this.plugin.settings?.language || "en";
    const dict = TRANSLATIONS[lang] || TRANSLATIONS["en"];
    let text = dict[key] || TRANSLATIONS["en"][key] || key;
    Object.keys(params).forEach((param) => {
      text = text.replace(`{${param}}`, params[param]);
    });
    return text;
  }

  async runWithLock(callback) {
    if (this.plugin && typeof this.plugin.runWithLock === 'function') {
      return await this.plugin.runWithLock(callback);
    }
    return await callback();
  }

  /**
   * Initializes the HabitManager by reading all habit files from the vault.
   */
  async initialize() {
    this.habitsMap.clear();
    if (this.plugin.habitRepository) {
      const habits = await this.plugin.habitRepository.loadAll();
      for (const habit of habits) {
        if (habit && habit.id) {
          const contractErrors = inspectHabitContract(habit);
          if (contractErrors.length > 0) {
            console.warn(`[Core Habits] Habit contract validation failed for loaded habit "${habit.name}":`, contractErrors);
          }
          this.habitsMap.set(habit.id, habit);
        }
      }
    }
    this.isInitialized = true;
    Utils.debugLog(this.plugin, `HabitManager initialized with ${this.habitsMap.size} habits.`);
  }

  async syncFile(file) {
    const activeFolder = this.plugin.habitNoteManager.getActiveFolder();
    const archiveFolder = this.plugin.habitNoteManager.getArchiveFolder();
    
    const isInsideActive = file.path.startsWith(activeFolder);
    const isInsideArchive = file.path.startsWith(archiveFolder);

    if (isInsideActive || isInsideArchive) {
      const props = await this.plugin.habitNoteManager.readHabitNoteProps(file.path);
      if (props) {
        const content = await this.plugin.app.vault.cachedRead(file);
        const habit = this.plugin.habitNoteManager.propsToHabit(file, props, content);
        if (habit && habit.id) {
          
          if (habit.archived && isInsideActive) {
            setTimeout(async () => {
              try {
                await this.runWithLock(async () => {
                  const currentFile = this.plugin.app.vault.getAbstractFileByPath(file.path);
                  if (currentFile) {
                    const destPath = this.plugin.habitNoteManager.getHabitFilePath(habit.name, true);
                    await this.plugin.app.fileManager.renameFile(currentFile, destPath);
                  }
                });
              } catch (e) {
                console.warn("[Core Habits] Auto-archive rename failed:", e);
              }
            }, 500);
          } else if (!habit.archived && isInsideArchive) {
            setTimeout(async () => {
              try {
                await this.runWithLock(async () => {
                  const currentFile = this.plugin.app.vault.getAbstractFileByPath(file.path);
                  if (currentFile) {
                    const destPath = this.plugin.habitNoteManager.getHabitFilePath(habit.name, false);
                    await this.plugin.app.fileManager.renameFile(currentFile, destPath);
                  }
                });
              } catch (e) {
                console.warn("[Core Habits] Auto-restore rename failed:", e);
              }
            }, 500);
          }

          this.habitsMap.set(habit.id, habit);
        }
      }
    }
  }

  invalidateCaches() {
    StreakCalculator.invalidateAll();
    if (this.plugin.app && this.plugin.app.workspace) {
      this.plugin.app.workspace.getLeavesOfType("weekly-habits-view").forEach((leaf) => {
        if (leaf.view) {
          leaf.view._lastFourWeeksCache = null;
          leaf.view.lastWeekRatesCache = null;
          if (leaf.view.streakContentCache) {
            leaf.view.streakContentCache.clear();
          }
        }
      });
    }
  }

  /**
   * Removes a file from the memory map. Called on file delete.
   * @param {import('obsidian').TAbstractFile} file 
   */
  async removeFile(file) {
    let changed = false;
    for (const [id, habit] of this.habitsMap.entries()) {
      const expectedPath = this.plugin.habitNoteManager.getHabitFilePath(habit.name, habit.archived);
      if (expectedPath === file.path || habit.name === file.basename) {
        this.habitsMap.delete(id);

        if (!this.plugin.settings.deletedHabits) {
          this.plugin.settings.deletedHabits = [];
        }
        if (!this.plugin.settings.deletedHabits.includes(habit.name)) {
          this.plugin.settings.deletedHabits.push(habit.name);
          changed = true;
        }
        if (habit.linkText && !this.plugin.settings.deletedHabits.includes(habit.linkText)) {
          this.plugin.settings.deletedHabits.push(habit.linkText);
          changed = true;
        }
      }
    }
    if (changed) {
      await this.plugin.saveSettings();
    }
  }

  getHabits() {
    return Array.from(this.habitsMap.values()).sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  // eslint-disable-next-line no-unused-vars
  getHabitsForTimeRange(rangeStartMs, rangeEndMs) {
    const allHabits = this.getHabits();
    return allHabits.filter((habit) => {
      if (habit.deleted) return false;
      // createdAt check removed to allow migrated habits to be evaluated historically
      if (habit.archived) {
        if (habit.archivedDate && habit.archivedDate < rangeStartMs) {
          return false;
        }
      }
      return true;
    });
  }

  getHabitById(id) {
    return this.habitsMap.get(id) || null;
  }

  async addHabit(habitData) {
    return await this.runWithLock(async () => {
      delete habitData._renameInFiles;
      delete habitData.isArchived;

      const errors = this.validateHabit(habitData);
      if (errors.length > 0) throw new Error(`Validation failed: ${errors.join(", ")}`);

      // Check all habits (active and archived) for duplicate names to prevent collisions
      const existingHabit = this.getHabits().find(
        (h) => h.name.trim().toLowerCase() === habitData.name.trim().toLowerCase()
      );
      if (existingHabit) {
        if (existingHabit.deleted) {
          // Restore the soft-deleted habit!
          existingHabit.deleted = false;
          existingHabit.archived = habitData.archived ?? false;
          existingHabit.schedule = habitData.schedule || existingHabit.schedule;
          existingHabit.color = habitData.color || existingHabit.color;
          existingHabit.parentId = habitData.parentId || existingHabit.parentId || null;
          existingHabit.habitType = habitData.habitType || existingHabit.habitType || "build";
          existingHabit.atomicDescription = habitData.atomicDescription || existingHabit.atomicDescription || null;
          existingHabit.notes = habitData.notes || existingHabit.notes || null;
          
          // Move the file to the correct location (Active or Archive)
          const currentFile = this.plugin.habitNoteManager._resolveHabitFile(existingHabit);
          const destPath = this.plugin.habitNoteManager.getHabitFilePath(existingHabit.name, existingHabit.archived);
          if (currentFile && currentFile.path !== destPath) {
            await this.plugin.app.fileManager.renameFile(currentFile, destPath);
          }
          
          // Update frontmatter
          const props = this.plugin.habitNoteManager._habitToProps(existingHabit);
          await this.plugin.habitNoteManager.updateHabitNoteProps(destPath, props);
          
          if (this.plugin.settings.deletedHabits) {
            const nameLower = existingHabit.name.toLowerCase();
            const linkLower = existingHabit.linkText.toLowerCase();
            this.plugin.settings.deletedHabits = this.plugin.settings.deletedHabits.filter(
              (n) => n.toLowerCase() !== nameLower && n.toLowerCase() !== linkLower
            );
            await this.plugin.saveSettings();
          }

          this.habitsMap.set(existingHabit.id, existingHabit);
          this.invalidateCaches();
          return existingHabit;
        } else {
          throw new Error(this.t("error_duplicate_habit_name", { name: habitData.name }));
        }
      }

      const linkText = habitData.linkText || `[[${habitData.name.trim()}]]`;
      const newHabit = {
        schemaVersion: HABIT_SCHEMA_VERSION,
        id: habitData.id || `habit-${Date.now()}`,
        createdAt: habitData.createdAt || Date.now(),
        name: habitData.name,
        linkText: linkText,
        schedule: habitData.schedule || { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] },
        levelData: habitData.levelData || null,
        currentLevel: habitData.currentLevel || 1,
        order: habitData.order ?? this.getActiveHabits().length,
        archived: habitData.archived ?? false,
        archivedDate: habitData.archivedDate || null,
        habitType: habitData.habitType || "build",
        atomicDescription: habitData.atomicDescription || null,
        parentId: habitData.parentId || null,
        color: habitData.color || "teal",
        notes: habitData.notes || null,
        savedLongestStreak: habitData.savedLongestStreak || 0,
        nameHistory: [],
      };

      const contractErrors = inspectHabitContract(newHabit);
      if (contractErrors.length > 0) {
        throw new Error(`Contract validation failed: ${contractErrors.join(", ")}`);
      }

      if (this.plugin.settings.deletedHabits) {
        const nameLower = newHabit.name.toLowerCase();
        const linkLower = newHabit.linkText.toLowerCase();
        this.plugin.settings.deletedHabits = this.plugin.settings.deletedHabits.filter(
          (n) => n.toLowerCase() !== nameLower && n.toLowerCase() !== linkLower
        );
        await this.plugin.saveSettings();
      }

      if (this.plugin.habitRepository) {
        await this.plugin.habitRepository.create(newHabit);
      }
      
      this.habitsMap.set(newHabit.id, newHabit);
      this.invalidateCaches();
      return newHabit;
    });
  }

  async updateHabit(id, habitData) {
    return await this.runWithLock(async () => {
      const shouldRenameAll = habitData._renameInFiles;
      delete habitData._renameInFiles;
      delete habitData.isArchived;

      const currentHabit = this.getHabitById(id);
      if (!currentHabit) throw new Error(`Habit not found: ${id}`);

      const errors = this.validateHabit(habitData);
      if (errors.length > 0) throw new Error(`Validation failed: ${errors.join(", ")}`);

      if (habitData.name && habitData.name.trim().toLowerCase() !== currentHabit.name.trim().toLowerCase()) {
        // Check all habits (active and archived) for duplicate names to prevent collisions
        const duplicate = this.getHabits().find(h => h.id !== id && h.name.trim().toLowerCase() === habitData.name.trim().toLowerCase());
        if (duplicate) {
          throw new Error(this.t("error_duplicate_habit_name", { name: habitData.name }));
        }
      }

      const nameChanged = habitData.name && habitData.name.trim() !== currentHabit.name.trim();
      if (nameChanged) {
        if (!currentHabit.nameHistory) currentHabit.nameHistory = [];
        if (!currentHabit.nameHistory.includes(currentHabit.linkText)) {
          currentHabit.nameHistory.push(currentHabit.linkText);
        }
      }

      const updated = {
        ...currentHabit,
        ...habitData,
        id,
        schemaVersion: HABIT_SCHEMA_VERSION,
        nameHistory: currentHabit.nameHistory || [],
      };

      if (nameChanged) {
        updated.linkText = `[[${habitData.name.trim()}]]`;
      }

      const contractErrors = inspectHabitContract(updated);
      if (contractErrors.length > 0) {
        throw new Error(`Contract validation failed: ${contractErrors.join(", ")}`);
      }

      const oldName = currentHabit.name;
      const newName = habitData.name ? habitData.name.trim() : "";

      if (shouldRenameAll && nameChanged) {
        // 1. Rename the physical file first
        await this.renameHabitFile(currentHabit, newName);
      }

      if (this.plugin.habitRepository) {
        await this.plugin.habitRepository.update(updated);
      }

      this.habitsMap.set(updated.id, updated);
      this.invalidateCaches();

      if (shouldRenameAll && nameChanged) {
        // 2. Perform the batch renaming of daily notes habit references
        const t = (key, params) => this.t(key, params);
        const prep = await this.prepareBatchRename(id, oldName);

        if (prep.needsConfirmation) {
          const confirmModal = new Modal(this.plugin.app);
          const confirmed = confirmModal.contentEl
            ? await new Promise((resolve) => {
                const { contentEl } = confirmModal;
                contentEl.createEl("h2", { text: t("rename_confirm_title") });
                contentEl.createEl("p", { text: t("rename_confirm_desc", { oldName, newName, count: prep.fileCount }) });
                const footer = contentEl.createDiv({ cls: "modal-button-container" });
                footer.createEl("button", { text: t("cancel"), cls: "dh-btn" }).onclick = () => { confirmModal.close(); resolve(false); };
                footer.createEl("button", { text: t("rename_confirm_btn_all"), cls: "dh-btn mod-warning" }).onclick = () => { confirmModal.close(); resolve(true); };
                confirmModal.open();
              })
            : true;

          if (confirmed) {
            let cancelRequested = false;
            let progressModal = new RenameProgressModal(
              this.plugin.app, this.plugin, prep.fileCount, () => { cancelRequested = true; }
            );
            if (progressModal.contentEl) {
              progressModal.open();
            }

            try {
              const result = await this.executeBatchRename(
                newName, prep.uniqueOldNames, prep.filesToUpdate,
                (curr, total) => {
                  if (progressModal.updateProgress) progressModal.updateProgress(curr, total);
                },
                () => cancelRequested
              );
              if (progressModal.close) progressModal.close();
              if (cancelRequested) {
                new Notice(t("rename_cancelled_notice", { count: result.updated }));
              } else {
                new Notice(t("rename_success_notice", { count: result.updated }));
              }
            } catch (err) {
              if (progressModal.close) progressModal.close();
              console.error(err);
              new Notice(t("rename_error_notice"));
            }
          }
        } else {
          new Notice(t("rename_no_files_notice"));
        }
      }

      return updated;
    });
  }

  async archiveHabit(id) {
    return await this.runWithLock(async () => {
      const habit = this.getHabitById(id);
      if (!habit) throw new Error(`Habit not found: ${id}`);

      const archivedHabit = {
        ...habit,
        archived: true,
        archivedDate: Date.now(),
        restoredDate: null
      };

      if (this.plugin.habitRepository) {
        await this.plugin.habitRepository.archive(archivedHabit);
      }

      this.habitsMap.set(archivedHabit.id, archivedHabit);
      this.invalidateCaches();
      return archivedHabit;
    });
  }

  async restoreHabit(id) {
    return await this.runWithLock(async () => {
      const habit = this.getHabitById(id);
      if (!habit) throw new Error(`Habit not found: ${id}`);

      const collision = this.getActiveHabits().find(
        (h) => h.id !== id && h.name.trim().toLowerCase() === habit.name.trim().toLowerCase()
      );
      if (collision) {
        throw new Error(this.t("error_duplicate_habit_name", { name: habit.name }));
      }

      const restoredHabit = {
        ...habit,
        archived: false,
        archivedDate: habit.archivedDate || null,
        restoredDate: Date.now()
      };

      const siblings = this.getActiveHabits().filter(h => h.parentId === restoredHabit.parentId);
      let maxOrder = -1;
      siblings.forEach(h => { if (h.order > maxOrder) maxOrder = h.order; });
      restoredHabit.order = maxOrder + 1;

      if (this.plugin.habitRepository) {
        await this.plugin.habitRepository.restore(restoredHabit);
      }

      this.habitsMap.set(restoredHabit.id, restoredHabit);
      this.invalidateCaches();
      return restoredHabit;
    });
  }

  async deleteHabit(id) {
    return await this.runWithLock(async () => {
      const habit = this.getHabitById(id);
      if (!habit) throw new Error(`Habit not found: ${id}`);

      habit.deleted = true;
      habit.archived = true;
      habit.archivedDate = Date.now();

      // Move the file to the Archive folder
      const currentFile = this.plugin.habitNoteManager._resolveHabitFile(habit);
      const destPath = this.plugin.habitNoteManager.getHabitFilePath(habit.name, true);
      
      if (currentFile) {
        if (currentFile.path !== destPath) {
          await this.plugin.app.fileManager.renameFile(currentFile, destPath);
        }
        // Update frontmatter
        const props = this.plugin.habitNoteManager._habitToProps(habit);
        await this.plugin.habitNoteManager.updateHabitNoteProps(destPath, props);
      }

      this.habitsMap.set(id, habit);
      this.invalidateCaches();

      if (!this.plugin.settings.deletedHabits) {
        this.plugin.settings.deletedHabits = [];
      }
      if (!this.plugin.settings.deletedHabits.includes(habit.name)) {
        this.plugin.settings.deletedHabits.push(habit.name);
      }
      if (habit.linkText && !this.plugin.settings.deletedHabits.includes(habit.linkText)) {
        this.plugin.settings.deletedHabits.push(habit.linkText);
      }
      await this.plugin.saveSettings();

      return habit;
    });
  }

  async deleteHabitPermanently(id) {
    return await this.deleteHabit(id);
  }

  getActiveHabits() {
    return this.getHabits().filter((h) => !h.archived && !h.deleted).sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  getArchivedHabits() {
    return this.getHabits().filter((h) => h.archived && !h.deleted);
  }

  getEffectiveParentId(id) {
    const habit = this.getHabitById(id);
    if (!habit || !habit.parentId) return null;
    const parentIsActive = this.getActiveHabits().some((h) => h.id === habit.parentId);
    return parentIsActive ? habit.parentId : null;
  }

  isParent(id) {
    return this.getActiveHabits().some((h) => this.getEffectiveParentId(h.id) === id);
  }

  getEffectiveSiblings(habitToMove) {
    const active = this.getActiveHabits();
    const targetParentId = this.getEffectiveParentId(habitToMove.id);
    return active.filter((h) => this.getEffectiveParentId(h.id) === targetParentId).sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  async moveHabitUp(id) {
    const habitToMove = this.getHabitById(id);
    if (!habitToMove) throw new Error(`Habit not found: ${id}`);

    const siblings = this.getEffectiveSiblings(habitToMove);
    siblings.forEach((h, i) => { h.order = i; });

    const index = siblings.findIndex((h) => h.id === id);
    if (index <= 0) return;

    const currentHabit = siblings[index];
    const previousHabit = siblings[index - 1];

    const temp = currentHabit.order;
    currentHabit.order = previousHabit.order;
    previousHabit.order = temp;

    this.habitsMap.set(currentHabit.id, currentHabit);
    this.habitsMap.set(previousHabit.id, previousHabit);

    await this._syncOrders(siblings);
  }

  async moveHabitDown(id) {
    const habitToMove = this.getHabitById(id);
    if (!habitToMove) throw new Error(`Habit not found: ${id}`);

    const siblings = this.getEffectiveSiblings(habitToMove);
    siblings.forEach((h, i) => { h.order = i; });

    const index = siblings.findIndex((h) => h.id === id);
    if (index === -1 || index === siblings.length - 1) return;

    const currentHabit = siblings[index];
    const nextHabit = siblings[index + 1];

    const temp = currentHabit.order;
    currentHabit.order = nextHabit.order;
    nextHabit.order = temp;

    this.habitsMap.set(currentHabit.id, currentHabit);
    this.habitsMap.set(nextHabit.id, nextHabit);

    await this._syncOrders(siblings);
  }

  async updateHabitsOrder(orderedIds) {
    return await this.runWithLock(async () => {
      for (let i = 0; i < orderedIds.length; i++) {
        const id = orderedIds[i];
        const habit = this.getHabitById(id);
        if (habit) {
          habit.order = i;
          this.habitsMap.set(id, habit);
          
          // Update frontmatter
          const path = this.plugin.habitNoteManager.getHabitFilePath(habit.name, habit.archived);
          await this.plugin.habitNoteManager.updateHabitNoteProps(path, { order: i });
        }
      }
    });
  }

  async _syncOrders(siblings) {
    return await this.runWithLock(async () => {
      for (const h of siblings) {
        const path = this.plugin.habitNoteManager.getHabitFilePath(h.name, h.archived);
        await this.plugin.habitNoteManager.updateHabitNoteProps(path, { order: h.order });
      }
    });
  }

  validateHabit(habitData) {
    const errors = [];
    if (!habitData.name || habitData.name.trim() === "") errors.push("Name is required");
    return errors;
  }

  isHabitScheduledForDay(habit, dayOfWeek) {
    return Array.isArray(habit.schedule?.days) && habit.schedule.days.includes(dayOfWeek);
  }

  getHabitsForDay(dayOfWeek) {
    const active = this.getActiveHabits();
    const { sorted } = buildHierarchyLabels(active);
    return sorted.filter((h) => this.isHabitScheduledForDay(h, dayOfWeek));
  }

  async ensureHabitsInNote(date, forceHabit = null, forceWrite = false) {
    if (!this.plugin.settings.autoWriteHabits && !forceWrite) return;

    return await this.runWithLock(async () => {
      try {
        const dailyNote = await getNoteByDate(this.plugin.app, date, true, this.plugin.settings);
        if (!dailyNote) return;

        await this.plugin.app.vault.process(dailyNote, (content) => {
          const originalContent = content;
          const dayOfWeek = date.day();
          const scheduledHabits = this.getHabitsForDay(dayOfWeek);

          if (forceHabit && !scheduledHabits.some(h => h.id === forceHabit.id)) {
            scheduledHabits.push(forceHabit);
          }

          const parentHeading = this.plugin.settings.dailyParentHeading;
          const subHeading = this.plugin.settings.habitHeading;
          const sectionContent = Utils.getSectionContent(content, parentHeading, subHeading) || "";

          const scanned = this.plugin.habitScanner.scan(sectionContent, this.plugin.settings.marker) || [];

          const habitsToAdd = [];
          for (const habit of scheduledHabits) {
            const entry = findHabitEntry(scanned, habit.linkText, habit.nameHistory, habit.id);
            let stateChar = " ";
            if (entry) {
              if (entry.completed) stateChar = "x";
              else if (entry.skipped) stateChar = "-";
            }
            const markerStr = this.plugin.settings.marker === "[habit:: true]"
              ? `[habit:: ${habit.id}]`
              : `${this.plugin.settings.marker} [habit:: ${habit.id}]`;
            habitsToAdd.push(`- [${stateChar}] ${habit.linkText} ${markerStr}`);
          }

          const lines = sectionContent.split(/\r?\n/);
          let firstChecklistIdx = -1;
          let lastChecklistIdx = -1;

          lines.forEach((line, idx) => {
            if (/^\s*-\s*\[([ x-])\]/i.test(line)) {
              if (firstChecklistIdx === -1) firstChecklistIdx = idx;
              lastChecklistIdx = idx;
            }
          });

          let newSectionLines;
          if (firstChecklistIdx !== -1) {
            newSectionLines = [
              ...lines.slice(0, firstChecklistIdx),
              ...habitsToAdd,
              ...lines.slice(lastChecklistIdx + 1)
            ];
          } else {
            newSectionLines = [...lines];
            if (habitsToAdd.length > 0) {
              newSectionLines.push(...habitsToAdd);
            }
          }

          const newSectionContent = newSectionLines.join("\n");
          const newContent = Utils.replaceNestedContent(content, parentHeading, subHeading, newSectionContent);

          if (newContent !== originalContent) {
            Utils.debugLog(this.plugin, `Updated daily note habits list for ${dailyNote.basename}`);
            return newContent;
          }
          return originalContent;
        });
      } catch (error) {
        console.error("[Core Habits] Sync failed:", error);
      }
    });
  }

  async importHabitsFromContent(content, force = false) {
    const foundHabits = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
    if (!foundHabits) return 0;
    let importedCount = 0;

    for (const habit of foundHabits) {
      const fullLink = habit.text;
      const cleanName = fullLink.replace(/\[\[|\]\]/g, "").trim();

      if (!force && this.plugin.settings.deletedHabits) {
        const nameLower = cleanName.toLowerCase();
        const linkLower = fullLink.toLowerCase();
        const isDeleted = this.plugin.settings.deletedHabits.some(
          (n) => n.toLowerCase() === nameLower || n.toLowerCase() === linkLower
        );
        if (isDeleted) continue;
      }

      const exists = this.getHabits().some(
        (h) =>
          h.linkText.replace(/\s+/g, "").toLowerCase() === fullLink.replace(/\s+/g, "").toLowerCase() ||
          h.name.trim().toLowerCase() === fullLink.replace(/\[\[|\]\]/g, "").trim().toLowerCase(),
      );

      if (!exists) {
        await this.addHabit({
          name: cleanName,
          linkText: fullLink,
          schedule: { type: "daily", days: [0, 1, 2, 3, 4, 5, 6] },
        });
        importedCount++;
      }
    }
    return importedCount;
  }

  async renameHabitFile(habit, newName) {
    const file = this.plugin.habitNoteManager._resolveHabitFile(habit);
    if (!file) {
      throw new Error(`Could not find habit file for "${habit.name}"`);
    }
    const newPath = this.plugin.habitNoteManager.getHabitFilePath(newName, habit.archived);
    this.plugin.habitNoteManager.validatePathSafety(newPath);

    const existingFile = this.plugin.app.vault.getAbstractFileByPath(newPath);
    if (existingFile && existingFile !== file) {
      throw new Error(this.t("error_file_exists", { path: newPath }));
    }
    await this.plugin.app.fileManager.renameFile(file, newPath);
  }

  async prepareBatchRename(habitId, oldName) {
    const habit = this.getHabitById(habitId);
    if (!habit) {
      return { needsConfirmation: false, fileCount: 0, uniqueOldNames: [], filesToUpdate: [] };
    }

    const uniqueOldNames = new Set();
    uniqueOldNames.add(`[[${oldName}]]`);
    if (habit.nameHistory) {
      for (const hist of habit.nameHistory) {
        uniqueOldNames.add(hist);
      }
    }

    const oldNamesArr = Array.from(uniqueOldNames);
    const markdownFiles = this.plugin.app.vault.getMarkdownFiles();
    const filesToUpdate = [];

    for (const file of markdownFiles) {
      const content = await this.plugin.app.vault.cachedRead(file);
      const hasOldName = oldNamesArr.some(oldName => content.includes(oldName));
      if (hasOldName) {
        filesToUpdate.push(file);
      }
    }

    return {
      needsConfirmation: filesToUpdate.length > 0,
      fileCount: filesToUpdate.length,
      uniqueOldNames: oldNamesArr,
      filesToUpdate: filesToUpdate
    };
  }

  async executeBatchRename(newName, uniqueOldNames, filesToUpdate, onProgress, isCancelled) {
    let updated = 0;
    const total = filesToUpdate.length;

    const newCleanName = TextUtils.clean(newName);

    for (let i = 0; i < total; i++) {
      if (isCancelled && isCancelled()) {
        break;
      }

      const file = filesToUpdate[i];
      await this.plugin.app.vault.process(file, (content) => {
        let newContent = content;

        for (const oldLinkText of uniqueOldNames) {
          const oldPlainName = oldLinkText.replace(/\[\[|\]\]/g, "");
          const oldCleanName = TextUtils.clean(oldPlainName);

          newContent = newContent.replaceAll(oldLinkText, `[[${newName}]]`);
          newContent = newContent.replaceAll(`[habit-note:: ${oldCleanName}]`, `[habit-note:: ${newCleanName}]`);
          newContent = newContent.replaceAll(`habit:: ${oldCleanName}`, `habit:: ${newCleanName}`);
        }

        return newContent;
      });

      updated++;
      if (onProgress) {
        onProgress(updated, total);
      }
    }

    return { updated };
  }

  async toggleHabitInNote(file, habit, targetState = null) {
    const app = this.plugin.app;
    const marker = this.plugin.settings.marker;
    return await this.runWithLock(async () => {
      try {
        await app.vault.process(file, (data) => {
          const separator = data.includes("\r\n") ? "\r\n" : "\n";
          const lines = data.split(/\r?\n/);
          let targetLineIndex = -1;

          const scanned = this.plugin.habitScanner.scan(data, marker);
          const entry = findHabitEntry(scanned, habit.linkText, habit.nameHistory, habit.id);

          if (entry) {
            targetLineIndex = entry.lineIndex;
          }

          if (targetLineIndex !== -1) {
            let line = lines[targetLineIndex];
            const match = line.match(/^(\s*-\s*\[)([ x-])(\]\s*)(.*)$/i);
            if (match) {
              let nextChar;
              if (targetState !== null) {
                if (targetState === "completed") nextChar = "x";
                else if (targetState === "skipped") nextChar = "-";
                else if (targetState === "uncompleted") nextChar = " ";
                else nextChar = targetState;
              } else {
                const currentChar = match[2].toLowerCase();
                if (currentChar === " ") nextChar = "x";
                else if (currentChar === "x") nextChar = "-";
                else nextChar = " ";
              }

              // Play auditory milestone beeps for completions
              if (nextChar === "x" && match[2].toLowerCase() !== "x") {
                this.plugin.audioEngine.playSound({ type: "check" });
              } else if (nextChar !== "x" && match[2].toLowerCase() === "x") {
                this.plugin.audioEngine.playSound({ type: "uncheck" });
              }

              lines[targetLineIndex] = `${match[1]}${nextChar}${match[3]}${match[4]}`;
            }
          }
          return lines.join(separator);
        });

        // Invalidate specific caches
        StreakCalculator.invalidate(habit.id);
        app.workspace.getLeavesOfType("weekly-habits-view").forEach((leaf) => {
          if (leaf.view) {
            leaf.view._lastFourWeeksCache = null;
            leaf.view.lastWeekRatesCache = null;
          }
        });
        if (this.plugin._sharedStreakCache) {
          this.plugin._sharedStreakCache.clear();
        }
      } catch (error) {
        console.error("[Core Habits] Failed to toggle habit:", error);
        new Notice(this.t("error_modifying_note"));
      }
    });
  }

  async handleVaultRename(file, oldPath) {
    // 1. Detect manual move between Active/ and Archive/
    const moveType = this.plugin.habitNoteManager.detectManualMove(file.path, oldPath);
    if (moveType) {
      const cache = this.plugin.app.metadataCache.getFileCache(file);
      const habitId = cache?.frontmatter?.habit_id;
      if (habitId) {
        const habit = this.getHabitById(habitId);
        if (habit) {
          habit.archived = moveType === 'archived';
          habit.archivedDate = moveType === 'archived' ? Date.now() : null;
          habit.restoredDate = moveType === 'restored' ? Date.now() : null;

          const props = this.plugin.habitNoteManager._habitToProps(habit);
          await this.plugin.habitNoteManager.updateHabitNoteProps(file.path, props);

          this.habitsMap.set(habit.id, habit);
          this.invalidateCaches();

          Utils.debugLog(this.plugin, `Manual move detected: ${habit.name} → ${moveType}`);
          return; // Do not treat as name rename
        }
      }
    }

    // 2. Physical renaming on disk
    const oldBasename = oldPath.replace(/^.*\//, '').replace(/\.md$/, '');
    const newBasename = file.basename;
    if (oldBasename === newBasename) return;

    const oldLink = `[[${oldBasename}]]`;
    for (const habit of this.getHabits()) {
      if (habit.linkText !== oldLink) continue;

      if (!habit.nameHistory) habit.nameHistory = [];
      if (!habit.nameHistory.includes(oldLink)) {
        habit.nameHistory.push(oldLink);
      }

      habit.linkText = `[[${newBasename}]]`;
      habit.name = newBasename;

      const props = this.plugin.habitNoteManager._habitToProps(habit);
      await this.plugin.habitNoteManager.updateHabitNoteProps(file.path, props);

      this.habitsMap.set(habit.id, habit);
      this.invalidateCaches();

      Utils.debugLog(this.plugin, `Vault rename synced: "${oldBasename}" → "${newBasename}"`);
    }
  }
}
