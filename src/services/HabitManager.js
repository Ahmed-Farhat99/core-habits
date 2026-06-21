import { Utils } from '../utils/Utils.js';
import { getNoteByDate } from '../utils/helpers.js';

export class HabitManager {
  constructor(plugin) {
    this.plugin = plugin;
    this.habitsMap = new Map();
    this.isInitialized = false;
  }

  /**
   * Initializes the HabitManager by reading all habit files from the vault.
   */
  async initialize() {
    this.habitsMap.clear();
    const activeFolder = this.plugin.habitNoteManager.getActiveFolder().toLowerCase();
    const archiveFolder = this.plugin.habitNoteManager.getArchiveFolder().toLowerCase();

    const files = this.plugin.app.vault.getMarkdownFiles();
    for (const file of files) {
      const lowerPath = file.path.toLowerCase();
      if (lowerPath.startsWith(activeFolder) || lowerPath.startsWith(archiveFolder)) {
        const props = await this.plugin.habitNoteManager.readHabitNoteProps(file.path);
        if (props) {
          const habit = this.plugin.habitNoteManager.propsToHabit(file, props);
          if (habit && habit.id) {
            this.habitsMap.set(habit.id, habit);
          }
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
        const habit = this.plugin.habitNoteManager.propsToHabit(file, props);
        if (habit && habit.id) {
          
          if (habit.archived && isInsideActive) {
            setTimeout(async () => {
              try {
                const currentFile = this.plugin.app.vault.getAbstractFileByPath(file.path);
                if (currentFile) {
                  const destPath = this.plugin.habitNoteManager.getHabitFilePath(habit.name, true);
                  await this.plugin.app.fileManager.renameFile(currentFile, destPath);
                }
              } catch (e) {
                console.warn("[Core Habits] Auto-archive rename failed:", e);
              }
            }, 500);
          } else if (!habit.archived && isInsideArchive) {
            setTimeout(async () => {
              try {
                const currentFile = this.plugin.app.vault.getAbstractFileByPath(file.path);
                if (currentFile) {
                  const destPath = this.plugin.habitNoteManager.getHabitFilePath(habit.name, false);
                  await this.plugin.app.fileManager.renameFile(currentFile, destPath);
                }
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

  /**
   * Removes a file from the memory map. Called on file delete.
   * @param {import('obsidian').TAbstractFile} file 
   */
  removeFile(file) {
    for (const [id, habit] of this.habitsMap.entries()) {
      const expectedPath = this.plugin.habitNoteManager.getHabitFilePath(habit.name, habit.archived);
      if (expectedPath === file.path || habit.name === file.basename) {
        this.habitsMap.delete(id);
      }
    }
  }

  getHabits() {
    return Array.from(this.habitsMap.values()).sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  getHabitsForTimeRange(rangeStartMs, rangeEndMs) {
    const allHabits = this.getHabits();
    return allHabits.filter((habit) => {
      const createdAt = habit.createdAt || 0;
      if (createdAt > rangeEndMs) return false;
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
    delete habitData._renameInFiles;
    delete habitData.isArchived;

    const errors = this.validateHabit(habitData);
    if (errors.length > 0) throw new Error(`Validation failed: ${errors.join(", ")}`);

    const isAr = this.plugin.settings.language === "ar";
    const existingHabit = this.getHabits().find(
      (h) => h.name.trim().toLowerCase() === habitData.name.trim().toLowerCase()
    );
    if (existingHabit) {
      throw new Error(isAr ? `عادة بنفس الاسم موجودة بالفعل: "${habitData.name}"` : `A habit with this name already exists: "${habitData.name}"`);
    }

    const linkText = habitData.linkText || `[[${habitData.name.trim()}]]`;
    const newHabit = {
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

    // Update map optimistically
    this.habitsMap.set(newHabit.id, newHabit);

    if (this.plugin.habitNoteManager) {
      await this.plugin.habitNoteManager.createHabitNote(newHabit);
    }
    
    return newHabit;
  }

  async updateHabit(id, habitData) {
    delete habitData._renameInFiles;
    delete habitData.isArchived;

    const currentHabit = this.getHabitById(id);
    if (!currentHabit) throw new Error(`Habit not found: ${id}`);

    const errors = this.validateHabit(habitData);
    if (errors.length > 0) throw new Error(`Validation failed: ${errors.join(", ")}`);

    if (habitData.name && habitData.name.trim().toLowerCase() !== currentHabit.name.trim().toLowerCase()) {
      const duplicate = this.getHabits().find(h => h.id !== id && h.name.trim().toLowerCase() === habitData.name.trim().toLowerCase());
      if (duplicate) {
        throw new Error(`A habit with this name already exists: "${habitData.name}"`);
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
      nameHistory: currentHabit.nameHistory || [],
    };

    if (nameChanged) {
      updated.linkText = `[[${habitData.name.trim()}]]`;
    }

    // Optimistic update
    this.habitsMap.set(updated.id, updated);

    if (this.plugin.habitNoteManager) {
      // If name changed, we need to rename the file!
      if (nameChanged) {
        const oldPath = this.plugin.habitNoteManager.getHabitFilePath(currentHabit.name, currentHabit.archived);
        const newPath = this.plugin.habitNoteManager.getHabitFilePath(updated.name, updated.archived);
        const file = this.plugin.app.vault.getAbstractFileByPath(oldPath);
        if (file) {
          await this.plugin.app.fileManager.renameFile(file, newPath);
        }
      }
      const props = this.plugin.habitNoteManager._habitToProps(updated);
      const activePath = this.plugin.habitNoteManager.getHabitFilePath(updated.name, updated.archived);
      await this.plugin.habitNoteManager.updateHabitNoteProps(activePath, props);
    }

    return updated;
  }

  async archiveHabit(id) {
    const habit = this.getHabitById(id);
    if (!habit) throw new Error(`Habit not found: ${id}`);

    if (this.plugin.habitNoteManager) {
      await this.plugin.habitNoteManager._moveHabitNote(habit, false, true);
    }

    habit.archived = true;
    habit.archivedDate = Date.now();
    habit.restoredDate = null;
    
    this.habitsMap.set(habit.id, habit);

    return habit;
  }

  async restoreHabit(id) {
    const habit = this.getHabitById(id);
    if (!habit) throw new Error(`Habit not found: ${id}`);

    if (this.plugin.habitNoteManager) {
      await this.plugin.habitNoteManager._moveHabitNote(habit, true, false);
    }

    habit.archived = false;
    habit.archivedDate = null;
    habit.restoredDate = Date.now();

    const siblings = this.getActiveHabits().filter(h => h.parentId === habit.parentId);
    let maxOrder = -1;
    siblings.forEach(h => { if (h.order > maxOrder) maxOrder = h.order; });
    habit.order = maxOrder + 1;

    this.habitsMap.set(habit.id, habit);

    if (this.plugin.habitNoteManager) {
      const activePath = this.plugin.habitNoteManager.getHabitFilePath(habit.name, habit.archived);
      const props = this.plugin.habitNoteManager._habitToProps(habit);
      await this.plugin.habitNoteManager.updateHabitNoteProps(activePath, props);
    }
    return habit;
  }

  async deleteHabit(id) {
    const habit = this.getHabitById(id);
    if (!habit) throw new Error(`Habit not found: ${id}`);

    this.habitsMap.delete(id);

    if (this.plugin.habitNoteManager) {
      const path = this.plugin.habitNoteManager.getHabitFilePath(habit.name, habit.archived);
      const file = this.plugin.app.vault.getAbstractFileByPath(path);
      if (file) {
        await this.plugin.app.vault.trash(file, true);
      }
    }
    return habit;
  }

  async deleteHabitPermanently(id) {
    const habit = this.getHabitById(id);
    if (!habit) throw new Error(`Habit not found: ${id}`);
    if (!habit.archived) throw new Error(`Cannot delete non-archived habit.`);

    this.habitsMap.delete(id);

    if (this.plugin.habitNoteManager) {
      const path = this.plugin.habitNoteManager.getHabitFilePath(habit.name, true);
      const file = this.plugin.app.vault.getAbstractFileByPath(path);
      if (file) {
        await this.plugin.app.vault.trash(file, true);
      }
    }
  }

  getActiveHabits() {
    return this.getHabits().filter((h) => !h.archived).sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  getArchivedHabits() {
    return this.getHabits().filter((h) => h.archived);
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
  }

  async _syncOrders(siblings) {
    for (const h of siblings) {
      const path = this.plugin.habitNoteManager.getHabitFilePath(h.name, h.archived);
      await this.plugin.habitNoteManager.updateHabitNoteProps(path, { order: h.order });
    }
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
    // Requires buildHierarchyLabels logic, but simply returning scheduled is fine for now
    const scheduled = this.getActiveHabits().filter((h) => this.isHabitScheduledForDay(h, dayOfWeek));
    // We can just return them since WeeklyGridView will handle hierarchy itself or we can export buildHierarchyLabels
    return scheduled;
  }

  async ensureHabitsInNote(date, forceHabit = null) {
    if (!this.plugin.settings.autoWriteHabits) return;

    // Use lock to prevent race with toggles
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

        if (scheduledHabits.length === 0) return originalContent;

        const existingHabits = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
        if (!existingHabits) return originalContent;

        let addedCount = 0;
        const habitsToAdd = [];
        for (const habit of scheduledHabits) {
          const allNames = [
            habit.linkText.replace(/\[\[|\]\]/g, ""),
            ...(habit.nameHistory || []).map(n => n.replace(/\[\[|\]\]/g, "")),
          ];
          const exists = existingHabits.some((h) => allNames.some(name => h.text.includes(name)));
          if (!exists) {
            habitsToAdd.push(`- [ ] ${habit.linkText} ${this.plugin.settings.marker}`);
            addedCount++;
          }
        }

        if (addedCount > 0) {
          const newContent = Utils.insertNestedContent(
            content,
            this.plugin.settings.dailyParentHeading,
            this.plugin.settings.habitHeading,
            habitsToAdd.join("\n")
          );
          if (newContent !== originalContent) {
            Utils.debugLog(this.plugin, `Added ${addedCount} habits to ${dailyNote.basename}`);
            return newContent;
          }
        }
        return originalContent;
      });
    } catch (error) {
      console.error("[Core Habits] Sync failed:", error);
    }
  }

  async importHabitsFromContent(content) {
    const foundHabits = this.plugin.habitScanner.scan(content, this.plugin.settings.marker);
    if (!foundHabits) return 0;
    let importedCount = 0;

    for (const habit of foundHabits) {
      const fullLink = habit.text;
      const exists = this.getHabits().some(
        (h) =>
          h.linkText.replace(/\s+/g, "").toLowerCase() === fullLink.replace(/\s+/g, "").toLowerCase() ||
          h.name.trim().toLowerCase() === fullLink.replace(/\[\[|\]\]/g, "").trim().toLowerCase(),
      );

      if (!exists) {
        const cleanName = fullLink.replace(/\[\[|\]\]/g, "").trim();
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
}
