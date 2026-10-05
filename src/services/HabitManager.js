import { Utils } from '../utils/Utils.js';
import { getNoteByDate, TextUtils, findHabitEntry, buildHierarchyLabels, getDailyNotesInfo, getDailyNotePath } from '../utils/helpers.js';
import { inspectHabitContract, HABIT_SCHEMA_VERSION } from '../domain/HabitDataContract.js';
import { HabitEntity } from '../domain/HabitEntity.js';
import { ProgressionEngine } from './ProgressionEngine.js';
import { StreakCalculator } from './StreakCalculator.js';
import { NoticeService } from './NoticeService.js';
import { RenameProgressModal } from '../modals/RenameProgressModal.js';
import { TranslationManager } from './TranslationManager.js';
import { VaultOrderStore } from './VaultOrderStore.js';
import {
  KNOWN_HABIT_HEADINGS,
  DEFAULT_PARENT_HEADING,
  DEFAULT_PARENT_HEADING_EN,
  DEFAULT_HABIT_HEADING
} from '../constants.js';

export class HabitManager {
  constructor(plugin) {
    this.plugin = plugin;
    this.vaultOrderStore = new VaultOrderStore(plugin?.app, plugin);
    this.habitsMap = new Map();
    this._pendingMoveTimeouts = new Map();
    this.isInitialized = false;
  }

  get repository() {
    return this.plugin?.habitRepository || null;
  }

  t(key, params = {}) {
    if (this.plugin?.translationManager?.t) {
      return this.plugin.translationManager.t(key, params);
    }
    return new TranslationManager(this.plugin).t(key, params);
  }

  async runWithLock(callback, targetPaths = []) {
    if (this.plugin && typeof this.plugin.runWithLock === 'function') {
      return await this.plugin.runWithLock(callback, targetPaths);
    }
    return await callback();
  }

  /**
   * Initializes the HabitManager by reading all habit files from the vault.
   */
  async initialize() {
    const loaded = new Map();
    const repo = this.repository;
    if (!repo) throw new Error("Habit repository is unavailable");
    const habits = await repo.loadAll();
    for (const habit of habits) {
      if (habit && habit.id) {
        const contractErrors = inspectHabitContract(habit);
        if (contractErrors.length > 0) {
          console.warn(`[Core Habits] Habit contract validation failed for loaded habit "${habit.name}":`, contractErrors);
        }
        loaded.set(habit.id, habit);
      }
    }
    this.habitsMap = loaded;
    await this.reconcileHabitOrder();
    this.isInitialized = true;
    Utils.debugLog(this.plugin, `HabitManager initialized with ${this.habitsMap.size} habits.`);
  }

  /**
   * Returns list of currently quarantined conflicting habits.
   * @returns {Array<object>}
   */
  getConflicts() {
    return this.repository?.getConflicts?.() || [];
  }

  /**
   * Returns list of notes skipped due to malformed metadata or errors.
   * @returns {Array<object>}
   */
  getMalformedNotes() {
    return this.repository?.getMalformedNotes?.() || [];
  }

  /**
   * Checks whether a habit ID is quarantined due to conflict.
   * @param {string} habitId
   * @returns {boolean}
   */
  isHabitQuarantined(habitId) {
    return this.repository?.isQuarantined?.(habitId) || false;
  }

  /**
   * Reconciles habit ordering using VaultOrderStore (_order.md) as the Single Source of Truth,
   * with data.json as a fast runtime cache and deterministic fallback reconstruction.
   */
  async reconcileHabitOrder() {
    if (!this.plugin?.settings) return;

    const loadedHabits = Array.from(this.habitsMap.values());
    const validIds = new Set(loadedHabits.map((h) => h.id));
    const conflictedIds = new Set((this.getConflicts() || []).map((c) => c.habitId));

    // 1. Read portable persistent source of truth from Vault (_order.md)
    let vaultOrderData = null;
    if (this.vaultOrderStore) {
      try {
        vaultOrderData = await this.vaultOrderStore.readOrder();
      } catch (err) {
        console.error("[Core Habits] Failed to read order from VaultOrderStore:", err);
      }
    }

    // 2. Read fast cache from data.json
    const cachedOrder = Array.isArray(this.plugin.settings.habitOrder)
      ? [...this.plugin.settings.habitOrder]
      : [];
    const cachedVersion = this.plugin.settings.habitOrderVersion || 0;

    let baseOrder;
    let currentVersion;
    let mustWriteVault = false;

    if (vaultOrderData && Array.isArray(vaultOrderData.habitOrder) && vaultOrderData.habitOrder.length > 0) {
      currentVersion = vaultOrderData.orderVersion || 0;
      // Vault order strictly WINS over cache
      baseOrder = [...vaultOrderData.habitOrder];
    } else if (cachedOrder.length > 0) {
      // Vault file missing, but local cache exists: use cache as bridge to populate Vault
      baseOrder = [...cachedOrder];
      currentVersion = cachedVersion;
      mustWriteVault = true;
    } else {
      // Both Vault file and cache are missing (cold start / fresh recovery):
      // Deterministically reconstruct from actual habit notes
      const sorted = VaultOrderStore.sortHabitsDeterministically(loadedHabits);
      baseOrder = sorted.map((h) => h.id);
      currentVersion = 0;
      mustWriteVault = true;
    }

    // 3. Prune IDs that no longer exist in loaded habit files (protecting quarantined habits from destructive pruning)
    let reconciled = baseOrder.filter((id) => validIds.has(id) || conflictedIds.has(id));
    if (reconciled.length !== baseOrder.length) {
      mustWriteVault = true;
    }

    // 4. Append any newly loaded habits not present in order (deterministic sort)
    const unlisted = loadedHabits.filter((h) => !reconciled.includes(h.id));
    if (unlisted.length > 0) {
      const sortedUnlisted = VaultOrderStore.sortHabitsDeterministically(unlisted);
      for (const h of sortedUnlisted) {
        reconciled.push(h.id);
      }
      mustWriteVault = true;
    }

    // 5. If Vault file was missing or modified during reconciliation, write it back
    if (mustWriteVault && loadedHabits.length > 0 && this.vaultOrderStore) {
      try {
        const written = await this.vaultOrderStore.writeOrder(reconciled, currentVersion);
        currentVersion = written.orderVersion;
      } catch (err) {
        console.error("[Core Habits] Failed to write reconciled order to VaultOrderStore:", err);
      }
    }

    // 6. Update local fast cache (data.json) only if changed
    const prevOrder = Array.isArray(this.plugin.settings.habitOrder) ? this.plugin.settings.habitOrder : [];
    const prevVersion = this.plugin.settings.habitOrderVersion || 0;
    const orderChanged = JSON.stringify(prevOrder) !== JSON.stringify(reconciled)
      || (reconciled.length > 0 && prevVersion !== currentVersion);
    if (orderChanged) {
      this.plugin.settings.habitOrder = reconciled;
      this.plugin.settings.habitOrderVersion = currentVersion;
      if (typeof this.plugin.saveSettings === "function") {
        await this.plugin.saveSettings({ silent: true });
      }
    }

    // 7. Apply resolved order index to all loaded habits in memory
    for (const habit of loadedHabits) {
      const idx = reconciled.indexOf(habit.id);
      habit.order = idx !== -1 ? idx : 0;
    }
  }

  async syncFile(file) {
    if (this.vaultOrderStore && file.path === this.vaultOrderStore.getOrderFilePath()) {
      await this.reconcileHabitOrder();
      this.invalidateCaches();
      return;
    }

    const activeFolder = this.plugin.habitNoteManager.getActiveFolder();
    const archiveFolder = this.plugin.habitNoteManager.getArchiveFolder();
    
    const isInsideActive = file.path.startsWith(`${activeFolder}/`);
    const isInsideArchive = file.path.startsWith(`${archiveFolder}/`);

    if (isInsideActive || isInsideArchive) {
      const habit = await this.repository.loadFile(file);
      if (!habit) {
        for (const id of this.habitsMap.keys()) {
          if (this.isHabitQuarantined(id)) {
            this.habitsMap.delete(id);
            this.invalidateCaches();
          }
        }
        return;
      }
      if (habit && habit.id) {
          if (this.isHabitQuarantined(habit.id)) {
            this.habitsMap.delete(habit.id);
            this.invalidateCaches();
            return;
          }

          const existingPath = this.plugin.habitNoteManager?.getFilePathByHabitId?.(habit.id);
          if (existingPath && existingPath !== file.path) {
            console.warn(`[Core Habits] Runtime duplicate conflict detected for habit "${habit.id}" between "${existingPath}" and "${file.path}". Quarantining.`);
            this.habitsMap.delete(habit.id);
            this.plugin.habitNoteManager?.unindexHabitFile?.(habit.id);
            this.plugin.habitNoteManager?.unindexHabitFile?.(file.path);
            this.plugin.habitNoteManager?.unindexHabitFile?.(existingPath);
            this.repository.registerConflict?.(habit.id, [existingPath, file.path]);
            return;
          }

          const needsMoveToArchive = habit.archived && isInsideActive;
          const needsMoveToActive = !habit.archived && isInsideArchive;

          if (needsMoveToArchive || needsMoveToActive) {
            // Cancel any pending timer for this habit to debounce rapid changes
            if (this._pendingMoveTimeouts.has(habit.id)) {
              clearTimeout(this._pendingMoveTimeouts.get(habit.id));
              this._pendingMoveTimeouts.delete(habit.id);
            }

            const targetArchived = habit.archived;
            const timerId = setTimeout(async () => {
              this._pendingMoveTimeouts.delete(habit.id);
              try {
                const currentHabit = this.getHabitById(habit.id);
                if (!currentHabit || currentHabit.deleted) return;
                if (currentHabit.archived !== targetArchived) return;

                const currentFile = this.repository.resolveHabitFile(currentHabit)
                  || this.plugin.app.vault.getAbstractFileByPath(file.path);
                if (!currentFile) return;

                const destPath = this.plugin.habitNoteManager.getHabitFilePath(currentHabit.name, targetArchived);
                if (currentFile.path === destPath) return;

                await this.runWithLock(async () => {
                  await this.plugin.habitNoteManager.ensureFolders();
                  await this.plugin.app.vault.rename(currentFile, destPath);
                }, [currentFile.path, destPath]);
              } catch (e) {
                console.warn(`[Core Habits] Auto-sync move failed for habit "${habit.name}":`, e);
              }
            }, 500);

            this._pendingMoveTimeouts.set(habit.id, timerId);
          } else {
            // State does not need move (e.g. user quickly reverted changes) — cancel pending timer
            if (this._pendingMoveTimeouts.has(habit.id)) {
              clearTimeout(this._pendingMoveTimeouts.get(habit.id));
              this._pendingMoveTimeouts.delete(habit.id);
            }
          }

          this.habitsMap.set(habit.id, habit);
          this.plugin.habitNoteManager?.indexHabitFile?.(habit.id, file.path);
          if (this.plugin.settings?.habitOrder && Array.isArray(this.plugin.settings.habitOrder)) {
            if (!this.plugin.settings.habitOrder.includes(habit.id)) {
              await this.persistHabitOrder([...this.plugin.settings.habitOrder, habit.id]);
            } else {
              habit.order = this.plugin.settings.habitOrder.indexOf(habit.id);
            }
          }
      }
    }
  }

  invalidateCaches() {
    if (this.plugin?.statsService) this.plugin.statsService.invalidateCache();
    else {
      StreakCalculator.invalidateAll();
      this.plugin?.app?.workspace?.trigger?.("core-habits:cache-invalidated");
    }
  }

  /**
   * Removes a file from the memory map. Called on file delete.
   * @param {import('obsidian').TAbstractFile} file 
   */
  async removeFile(file) {
    if (this.vaultOrderStore && file.path === this.vaultOrderStore.getOrderFilePath()) {
      await this.reconcileHabitOrder();
      this.invalidateCaches();
      return;
    }

    let changed = false;
    const deletedFileId = this.plugin.app?.metadataCache?.getFileCache?.(file)?.frontmatter?.habit_id
      || this.plugin.habitNoteManager?.getHabitIdByPath?.(file.path);
    for (const [id, habit] of this.habitsMap.entries()) {
      const expectedPath = this.plugin.habitNoteManager.getHabitFilePath(habit.name, habit.archived);
      const insideHabitFolder = file.path.startsWith(`${this.plugin.habitNoteManager.getActiveFolder()}/`)
        || file.path.startsWith(`${this.plugin.habitNoteManager.getArchiveFolder()}/`);
      if (expectedPath === file.path || (insideHabitFolder && deletedFileId === id)) {
        if (this._pendingMoveTimeouts.has(id)) {
          clearTimeout(this._pendingMoveTimeouts.get(id));
          this._pendingMoveTimeouts.delete(id);
        }
        this.habitsMap.delete(id);
        this.plugin.habitNoteManager?.unindexHabitFile?.(file.path);
        this.plugin.habitNoteManager?.unindexHabitFile?.(id);
        if (this.plugin.settings?.habitOrder && Array.isArray(this.plugin.settings.habitOrder)) {
          const prevLen = this.plugin.settings.habitOrder.length;
          const filtered = this.plugin.settings.habitOrder.filter((hId) => hId !== id);
          if (filtered.length !== prevLen) {
            await this.persistHabitOrder(filtered);
          }
        }
        changed = true;
      }
    }
    if (changed) {
      this.invalidateCaches();
    }
  }

  /**
   * Cleans up all pending timers and internal maps on plugin unload.
   */
  destroy() {
    if (this._pendingMoveTimeouts) {
      for (const timerId of this._pendingMoveTimeouts.values()) {
        clearTimeout(timerId);
      }
      this._pendingMoveTimeouts.clear();
    }
    if (this._checkpointTimers) {
      for (const timer of this._checkpointTimers.values()) {
        clearTimeout(timer);
      }
      this._checkpointTimers.clear();
    }
    this.habitsMap?.clear();
  }

  getHabits() {
    const orderList = Array.isArray(this.plugin?.settings?.habitOrder) ? this.plugin.settings.habitOrder : null;
    return Array.from(this.habitsMap.values()).sort((a, b) => {
      if (orderList) {
        const idxA = orderList.indexOf(a.id);
        const idxB = orderList.indexOf(b.id);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
      }
      return (a.order || 0) - (b.order || 0);
    });
  }

  getHabitsForTimeRange(rangeStartMs) {
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

  /**
   * Resolves a habit by name, linkText, or nameHistory (case-insensitive and Arabic folding aware).
   * @param {string} habitName
   * @returns {object|null}
   */
  findHabitByNameOrAlias(habitName) {
    if (!habitName) return null;
    const cleanName = TextUtils.clean(habitName);
    const targetNameFolded = TextUtils.foldArabic(cleanName);
    return this.getHabits().find((h) =>
      TextUtils.foldArabic(h.name) === targetNameFolded ||
      TextUtils.foldArabic(h.linkText || "") === targetNameFolded ||
      (h.nameHistory || []).some(
        (n) => TextUtils.foldArabic(n.replace(/\[\[|\]\]/g, "")) === targetNameFolded
      )
    ) || null;
  }

  async addHabit(habitData) {
    const orderPath = this.vaultOrderStore?.getOrderFilePath?.() || "_order.md";
    const habitPath = habitData?.name ? this.plugin?.habitNoteManager?.getHabitFilePath?.(habitData.name, habitData.archived ?? false) : null;
    const targetPaths = [habitPath, orderPath].filter(Boolean);
    return await this.runWithLock(async () => {
      delete habitData._renameInFiles;
      delete habitData.isArchived;

      const errors = this.validateHabit(habitData);
      if (errors.length > 0) throw new Error(`Validation failed: ${errors.join(", ")}`);

      // Enforce 50 active habits hard cap
      if (!habitData.archived && this.getActiveHabits().length >= 50) {
        const isAr = this.plugin?.settings?.language === "ar";
        const msg = this.t("error_max_habits_reached")
          || (isAr
            ? "تم الوصول للحد الأقصى (50 عادة نشطة). لا يمكن إضافة المزيد من العادات."
            : "Maximum limit reached (50 active habits). Cannot add more habits.");
        throw new Error(msg);
      }

      // Check all habits (active and archived) for duplicate names to prevent collisions
      const existingHabit = this.getHabits().find(
        (h) => h.name.trim().toLowerCase() === habitData.name.trim().toLowerCase()
      );
      if (existingHabit) {
        if (existingHabit.deleted) {
          // Restore the soft-deleted habit!
          const restored = { ...existingHabit };
          restored.deleted = false;
          restored.archived = habitData.archived ?? false;
          restored.restoredDate = restored.archived ? existingHabit.restoredDate : Date.now();
          restored.schedule = habitData.schedule ?? existingHabit.schedule;
          restored.color = habitData.color ?? existingHabit.color;
          restored.parentId = habitData.parentId ?? existingHabit.parentId ?? null;
          restored.habitType = habitData.habitType ?? existingHabit.habitType ?? "build";
          if (habitData.atomicDescription && Object.keys(habitData.atomicDescription).length > 0) {
            restored.atomicDescription = habitData.atomicDescription;
          }
          if (habitData.notes != null) restored.notes = habitData.notes;

          try {
            if (restored.archived) await this.repository.archive(restored);
            else await this.repository.restore(restored);
          }
          catch (error) { await this.initialize(); throw error; }
          
          this.habitsMap.set(restored.id, restored);
          this.invalidateCaches();

          return restored;
        } else {
          throw new Error(this.t("error_duplicate_habit_name", { name: habitData.name }));
        }
      }

      const entity = new HabitEntity({
        ...habitData,
        id: habitData.id || `habit-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
        schemaVersion: habitData.schemaVersion ?? HABIT_SCHEMA_VERSION,
        createdAt: habitData.createdAt || Date.now(),
        name: habitData.name.trim(),
        linkText: habitData.linkText || `[[${habitData.name.trim()}]]`,
        color: habitData.color || "teal",
        order: habitData.order ?? this.getActiveHabits().length,
        savedLongestStreak: habitData.savedLongestStreak || 0
      });

      const contractErrors = entity.validate();
      if (contractErrors.length > 0) {
        throw new Error(`Contract validation failed: ${contractErrors.join(", ")}`);
      }

      const newHabit = entity.toJSON();
      if (this.habitsMap.has(newHabit.id)) throw new Error(`Habit ID already exists: ${newHabit.id}`);

      try { await this.repository.create(newHabit); }
      catch (error) { await this.initialize(); throw error; }
      
      this.habitsMap.set(newHabit.id, newHabit);

      // Maintain habitOrder in VaultOrderStore and settings cache
      if (this.plugin.settings) {
        const currentOrder = Array.isArray(this.plugin.settings.habitOrder)
          ? [...this.plugin.settings.habitOrder]
          : [];
        if (!currentOrder.includes(newHabit.id)) {
          currentOrder.push(newHabit.id);
          await this.persistHabitOrder(currentOrder);
        }
      }

      this.invalidateCaches();
      return newHabit;
    }, targetPaths);
  }

  async updateHabit(id, habitData, uiHandlers = {}) {
    const currentHabit = this.getHabitById(id);
    const orderPath = this.vaultOrderStore?.getOrderFilePath?.() || "_order.md";
    const currentPath = currentHabit ? this.repository?.resolveHabitFile?.(currentHabit)?.path : null;
    const newPath = (currentHabit && habitData?.name)
      ? this.plugin?.habitNoteManager?.getHabitFilePath?.(habitData.name, currentHabit.archived)
      : null;
    const targetPaths = [currentPath, newPath, orderPath].filter(Boolean);
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

      const oldLongest = currentHabit.savedLongestStreak || 0;
      const newLongest = Math.max(oldLongest, habitData.savedLongestStreak || 0);
      const nameChanged = habitData.name && habitData.name.trim() !== currentHabit.name.trim();

      const updated = {
        ...currentHabit,
        ...habitData,
        id,
        savedLongestStreak: newLongest,
        schemaVersion: Math.max(currentHabit.schemaVersion || 0, HABIT_SCHEMA_VERSION),
        nameHistory: nameChanged
          ? [...new Set([...(currentHabit.nameHistory || []), currentHabit.linkText].filter(Boolean))]
          : [...(currentHabit.nameHistory || [])],
      };

      if (nameChanged) {
        updated.linkText = `[[${habitData.name.trim()}]]`;
      }

      const effectiveLevel = habitData.currentLevel 
        || ProgressionEngine.calculateLevel(updated, null, updated.levelData);
      updated.currentLevel = Math.max(currentHabit.currentLevel || 1, effectiveLevel);

      const contractErrors = inspectHabitContract(updated);
      if (contractErrors.length > 0) {
        throw new Error(`Contract validation failed: ${contractErrors.join(", ")}`);
      }

      const oldName = currentHabit.name;
      const newName = habitData.name ? habitData.name.trim() : "";

      try { await this.repository.update(updated); }
      catch (error) { await this.initialize(); throw error; }

      this.habitsMap.set(updated.id, updated);
      this.invalidateCaches();

      if (shouldRenameAll && nameChanged) {
        // 2. Perform the batch renaming of daily notes habit references
        const prep = await this.prepareBatchRename(id, oldName);

        if (typeof uiHandlers.onBatchRename === "function") {
          await uiHandlers.onBatchRename({
            prep,
            oldName,
            newName,
            execute: (onProgress, isCancelled) =>
              this.executeBatchRename(newName, prep.uniqueOldNames, prep.filesToUpdate, onProgress, isCancelled, id)
          });
        } else {
          await RenameProgressModal.runBatchRenameWorkflow(this.plugin.app, this.plugin, {
            oldName,
            newName,
            prep,
            execute: (onProgress, isCancelled) =>
              this.executeBatchRename(newName, prep.uniqueOldNames, prep.filesToUpdate, onProgress, isCancelled, id)
          });
        }
      }

      return updated;
    }, targetPaths);
  }

  async archiveHabit(id) {
    const habit = this.getHabitById(id);
    const activePath = habit ? this.plugin?.habitNoteManager?.getHabitFilePath?.(habit.name, false) : null;
    const archivePath = habit ? this.plugin?.habitNoteManager?.getHabitFilePath?.(habit.name, true) : null;
    const orderPath = this.vaultOrderStore?.getOrderFilePath?.() || "_order.md";
    const targetPaths = [activePath, archivePath, orderPath].filter(Boolean);
    return await this.runWithLock(async () => {
      const habit = this.getHabitById(id);
      if (!habit) throw new Error(`Habit not found: ${id}`);

      let longestStreak = habit.savedLongestStreak || 0;
      const calculator = this.plugin.streakCalculator || new StreakCalculator(this.plugin);
      try {
        const stats = await calculator.calculate(habit);
        if (stats && typeof stats.longestStreak === "number") {
          longestStreak = Math.max(longestStreak, stats.longestStreak);
        }
      } catch (e) {
        console.warn("[Core Habits] Could not calculate streak before archiving:", e);
      }

      const currentLevel = ProgressionEngine.calculateLevel(habit, { longestStreak });
      const archivedHabit = {
        ...habit,
        archived: true,
        archivedDate: Date.now(),
        restoredDate: null,
        savedLongestStreak: longestStreak,
        currentLevel: Math.max(habit.currentLevel || 1, currentLevel)
      };

      try { await this.repository.archive(archivedHabit); }
      catch (error) { await this.initialize(); throw error; }

      this.habitsMap.set(archivedHabit.id, archivedHabit);
      this.invalidateCaches();
      return archivedHabit;
    }, targetPaths);
  }

  async restoreHabit(id) {
    const habit = this.getHabitById(id);
    const archivePath = habit ? this.plugin?.habitNoteManager?.getHabitFilePath?.(habit.name, true) : null;
    const activePath = habit ? this.plugin?.habitNoteManager?.getHabitFilePath?.(habit.name, false) : null;
    const orderPath = this.vaultOrderStore?.getOrderFilePath?.() || "_order.md";
    const targetPaths = [archivePath, activePath, orderPath].filter(Boolean);
    return await this.runWithLock(async () => {
      const habit = this.getHabitById(id);
      if (!habit) throw new Error(`Habit not found: ${id}`);
      if (this.getActiveHabits().length >= 50) {
        throw new Error(this.t("error_max_habits_reached"));
      }

      const collision = this.getActiveHabits().find(
        (h) => h.id !== id && h.name.trim().toLowerCase() === habit.name.trim().toLowerCase()
      );
      if (collision) {
        throw new Error(this.t("error_duplicate_habit_name", { name: habit.name }));
      }

      const currentLevel = ProgressionEngine.calculateLevel(habit);
      const restoredHabit = {
        ...habit,
        archived: false,
        archivedDate: habit.archivedDate || null,
        restoredDate: Date.now(),
        currentLevel: Math.max(habit.currentLevel || 1, currentLevel)
      };

      const siblings = this.getActiveHabits().filter(h => h.parentId === restoredHabit.parentId);
      let maxOrder = -1;
      siblings.forEach(h => { if (h.order > maxOrder) maxOrder = h.order; });
      restoredHabit.order = maxOrder + 1;

      try { await this.repository.restore(restoredHabit); }
      catch (error) { await this.initialize(); throw error; }

      this.habitsMap.set(restoredHabit.id, restoredHabit);

      // Maintain portable habitOrder in VaultOrderStore and settings cache
      if (this.plugin.settings) {
        let currentOrder = Array.isArray(this.plugin.settings.habitOrder)
          ? [...this.plugin.settings.habitOrder]
          : [];
        // Remove restoredHabit if already present to ensure clean repositioning
        currentOrder = currentOrder.filter((habitId) => habitId !== restoredHabit.id);

        if (siblings.length > 0) {
          const siblingIds = new Set(siblings.map((s) => s.id));
          let lastSiblingIdx = -1;
          for (let i = 0; i < currentOrder.length; i++) {
            if (siblingIds.has(currentOrder[i])) {
              lastSiblingIdx = i;
            }
          }
          if (lastSiblingIdx !== -1) {
            currentOrder.splice(lastSiblingIdx + 1, 0, restoredHabit.id);
          } else {
            currentOrder.push(restoredHabit.id);
          }
        } else {
          currentOrder.push(restoredHabit.id);
        }

        await this.persistHabitOrder(currentOrder);
      }

      this.invalidateCaches();
      return restoredHabit;
    }, targetPaths);
  }

  /**
   * Safely synchronizes high-water milestone checkpoint for a habit.
   * Updates in-memory habit immediately and schedules safe, debounced persistence to frontmatter.
   * @param {string} habitId
   * @param {number} peakStreak
   * @param {number} newLevel
   */
  async syncMilestoneCheckpoint(habitId, peakStreak, newLevel) {
    if (!habitId) return;
    const habit = this.getHabitById(habitId);
    if (!habit) return;

    const targetStreak = Math.max(habit.savedLongestStreak || 0, peakStreak || 0);
    const targetLevel = Math.max(habit.currentLevel || 1, newLevel || 1);

    const isStreakHigher = targetStreak > (habit.savedLongestStreak || 0);
    if (!isStreakHigher) return;

    habit.savedLongestStreak = targetStreak;
    habit.currentLevel = targetLevel;
    this.habitsMap.set(habit.id, habit);

    if (!this._checkpointTimers) this._checkpointTimers = new Map();
    if (this._checkpointTimers.has(habitId)) {
      clearTimeout(this._checkpointTimers.get(habitId));
    }

    const timer = setTimeout(async () => {
      this._checkpointTimers?.delete(habitId);
      try {
        const file = this.repository?.resolveHabitFile(habit);
        if (file && this.plugin?.habitNoteManager) {
          const propsToUpdate = { saved_longest_streak: targetStreak };
          if (!habit.schemaVersion || habit.schemaVersion < 3) {
            propsToUpdate.current_level = targetLevel;
          }
          await this.runWithLock(async () => {
            await this.plugin.habitNoteManager.updateHabitNoteProps(file.path, propsToUpdate, { full: false });
          }, file.path);
        }
      } catch (err) {
        console.warn(`[Core Habits] Could not persist milestone checkpoint for ${habit.name}:`, err);
      }
    }, 1000);

    this._checkpointTimers.set(habitId, timer);
  }

  /**
   * Flushes all pending milestone checkpoints immediately to disk.
   */
  async flushMilestoneCheckpoints() {
    if (!this._checkpointTimers || this._checkpointTimers.size === 0) return;
    for (const [habitId, timer] of this._checkpointTimers) {
      clearTimeout(timer);
      const habit = this.getHabitById(habitId);
      if (habit) {
        try {
          const file = this.repository?.resolveHabitFile(habit);
          if (file && this.plugin?.habitNoteManager) {
            const propsToUpdate = { saved_longest_streak: habit.savedLongestStreak };
            if (!habit.schemaVersion || habit.schemaVersion < 3) {
              propsToUpdate.current_level = habit.currentLevel;
            }
            await this.runWithLock(async () => {
              await this.plugin.habitNoteManager.updateHabitNoteProps(file.path, propsToUpdate, { full: false });
            }, file.path);
          }
        } catch (err) {
          console.warn(`[Core Habits] Could not flush checkpoint for ${habit.name}:`, err);
        }
      }
    }
    this._checkpointTimers.clear();
  }

  /**
   * Restores all archived habits to active status.
   * Skips any habit whose name collides with an existing active habit.
   * @returns {Promise<{ restoredCount: number, skippedCount: number }>}
   */
  async restoreAllArchivedHabits() {
    const archived = this.getArchivedHabits();
    let restoredCount = 0;
    let skippedCount = 0;

    for (const habit of archived) {
      try {
        await this.restoreHabit(habit.id);
        restoredCount++;
      } catch (e) {
        console.warn(`[Core Habits] Could not restore habit ${habit.name}:`, e);
        skippedCount++;
      }
    }
    return { restoredCount, skippedCount };
  }

  /** Removes archived habits from the visible archive while preserving their notes. */
  async removeArchivedHabits() {
    const archived = this.getArchivedHabits();
    let removedCount = 0;

    for (const habit of archived) {
      try {
        await this.removeHabit(habit.id);
        removedCount++;
      } catch (e) {
        console.error(`[Core Habits] Failed to remove archived habit ${habit.name}:`, e);
      }
    }
    return removedCount;
  }

  async removeHabit(id) {
    const habit = this.getHabitById(id);
    const activePath = habit ? this.plugin?.habitNoteManager?.getHabitFilePath?.(habit.name, false) : null;
    const archivePath = habit ? this.plugin?.habitNoteManager?.getHabitFilePath?.(habit.name, true) : null;
    const orderPath = this.vaultOrderStore?.getOrderFilePath?.() || "_order.md";
    const targetPaths = [activePath, archivePath, orderPath].filter(Boolean);
    return await this.runWithLock(async () => {
      const habit = this.getHabitById(id);
      if (!habit) throw new Error(`Habit not found: ${id}`);

      const deletedHabit = { ...habit, deleted: true, archived: true, archivedDate: Date.now() };
      try { await this.repository.archive(deletedHabit); }
      catch (error) { await this.initialize(); throw error; }
      this.habitsMap.set(id, deletedHabit);
      this.invalidateCaches();

      return deletedHabit;
    }, targetPaths);
  }

  getRemovedHabits() {
    return this.getHabits().filter((habit) => habit.deleted);
  }

  async restoreRemovedHabit(id) {
    const habit = this.getHabitById(id);
    const activePath = habit ? this.plugin?.habitNoteManager?.getHabitFilePath?.(habit.name, false) : null;
    const archivePath = habit ? this.plugin?.habitNoteManager?.getHabitFilePath?.(habit.name, true) : null;
    const orderPath = this.vaultOrderStore?.getOrderFilePath?.() || "_order.md";
    const targetPaths = [activePath, archivePath, orderPath].filter(Boolean);
    return await this.runWithLock(async () => {
      const habit = this.getHabitById(id);
      if (!habit?.deleted) throw new Error(`Removed habit not found: ${id}`);
      if (this.getActiveHabits().length >= 50) throw new Error(this.t("error_max_habits_reached"));
      if (this.getActiveHabits().some((active) => active.name.trim().toLowerCase() === habit.name.trim().toLowerCase())) {
        throw new Error(this.t("error_duplicate_habit_name", { name: habit.name }));
      }

      const restored = { ...habit, deleted: false, archived: false, restoredDate: Date.now() };
      try { await this.repository.restore(restored); }
      catch (error) { await this.initialize(); throw error; }

      this.habitsMap.set(id, restored);
      this.invalidateCaches();
      return restored;
    }, targetPaths);
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
    return this._moveHabit(id, -1);
  }

  async moveHabitDown(id) {
    return this._moveHabit(id, 1);
  }

  async _moveHabit(id, direction) {
    const habit = this.getHabitById(id);
    if (!habit) throw new Error(`Habit not found: ${id}`);
    const siblings = this.getEffectiveSiblings(habit);
    const index = siblings.findIndex((item) => item.id === id);
    if (index + direction < 0 || index + direction >= siblings.length) return;
    const ids = siblings.map((item) => item.id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    await this._persistOrders(ids, siblings.map((item) => item.id));
  }

  async updateHabitsOrder(orderedIds) {
    return this._persistOrders(orderedIds);
  }

  /**
   * Persists habit ordering to the Vault (_order.md) as the SSOT,
   * updates the fast cache (settings.habitOrder), and synchronizes in-memory order index.
   * @param {string[]} nextOrder
   * @returns {Promise<number>} Updated revision version
   */
  async persistHabitOrder(nextOrder) {
    const currentVer = this.plugin.settings?.habitOrderVersion || 0;
    let newVer = currentVer + 1;

    if (this.vaultOrderStore) {
      try {
        const written = await this.vaultOrderStore.writeOrder(nextOrder, currentVer);
        newVer = written.orderVersion;
      } catch (err) {
        console.error("[Core Habits] Failed to write order to VaultOrderStore:", err);
      }
    }

    if (this.plugin.settings) {
      this.plugin.settings.habitOrder = nextOrder;
      this.plugin.settings.habitOrderVersion = newVer;
      if (typeof this.plugin.saveSettings === "function") {
        await this.plugin.saveSettings({ silent: true });
      }
    }

    for (const habit of this.habitsMap.values()) {
      const idx = nextOrder.indexOf(habit.id);
      habit.order = idx !== -1 ? idx : 0;
    }

    return newVer;
  }

  async _persistOrders(orderedIds, siblingIds = orderedIds) {
    const orderPath = this.vaultOrderStore?.getOrderFilePath?.() || "_order.md";
    return await this.runWithLock(async () => {
      if (!Array.isArray(orderedIds)) return;
      const previousOrder = Array.isArray(this.plugin.settings?.habitOrder)
        ? [...this.plugin.settings.habitOrder]
        : Array.from(this.habitsMap.keys());
      const previousVersion = this.plugin.settings?.habitOrderVersion || 0;

      const siblingSet = new Set(siblingIds);
      // Map existing positions of siblings in the overall habitOrder array
      const positions = [];
      for (let i = 0; i < previousOrder.length; i++) {
        if (siblingSet.has(previousOrder[i])) {
          positions.push(i);
        }
      }

      const nextOrder = [...previousOrder];
      if (positions.length === orderedIds.length) {
        for (let i = 0; i < positions.length; i++) {
          nextOrder[positions[i]] = orderedIds[i];
        }
      } else {
        const remaining = previousOrder.filter((id) => !siblingSet.has(id));
        nextOrder.length = 0;
        nextOrder.push(...remaining, ...orderedIds);
      }

      // Rollback backup in case saveSettings fails
      const previousHabitOrders = new Map();
      for (const habit of this.habitsMap.values()) {
        previousHabitOrders.set(habit.id, habit.order);
      }

      try {
        await this.persistHabitOrder(nextOrder);
      } catch (error) {
        // Rollback on failure
        if (this.plugin.settings) {
          this.plugin.settings.habitOrder = previousOrder;
          this.plugin.settings.habitOrderVersion = previousVersion;
        }
        for (const [hId, prevOrder] of previousHabitOrders) {
          const h = this.habitsMap.get(hId);
          if (h) h.order = prevOrder;
        }
        throw error;
      }

      this.invalidateCaches();
    }, orderPath);
  }

  validateHabit(habitData) {
    const errors = [];
    if (!habitData.name || habitData.name.trim() === "") errors.push("Name is required");
    return errors;
  }

  isHabitScheduledForDay(habit, dayOfWeek) {
    return HabitEntity.isScheduledForDay(habit, dayOfWeek);
  }

  getHabitsForDay(dayOfWeek) {
    const active = this.getActiveHabits();
    const { sorted } = buildHierarchyLabels(active);
    return sorted.filter((h) => this.isHabitScheduledForDay(h, dayOfWeek));
  }

  async ensureHabitsInNote(date, forceHabit = null, forceWrite = false) {
    if (!this.plugin.settings.autoWriteHabits && !forceWrite) return;
    const info = getDailyNotesInfo(this.plugin.app, this.plugin.settings);
    const targetPath = getDailyNotePath(date, info) || [];

    return await this.runWithLock(async () => {
      try {
        const dailyNote = await getNoteByDate(this.plugin.app, date, true, this.plugin.settings);
        if (!dailyNote) return;

        let didModify = false;
        await this.plugin.app.vault.process(dailyNote, (content) => {
          const originalContent = content;
          const dayOfWeek = date.day();
          const scheduledHabits = this.getHabitsForDay(dayOfWeek);

          if (forceHabit && !scheduledHabits.some(h => h.id === forceHabit.id)) {
            scheduledHabits.push(forceHabit);
          }

          const currentParentHeading = this.plugin.settings.dailyParentHeading || "";
          const currentSubHeading = this.plugin.settings.habitHeading || DEFAULT_HABIT_HEADING;

          // Candidate headings: check current settings first, then user history, then known defaults
          const candidateSubHeadings = [
            currentSubHeading,
            ...(this.plugin.settings.habitHeadingHistory || []),
            ...KNOWN_HABIT_HEADINGS
          ].filter(Boolean);

          const candidateParentHeadings = [
            currentParentHeading,
            ...(this.plugin.settings.dailyParentHeadingHistory || []),
            DEFAULT_PARENT_HEADING,
            DEFAULT_PARENT_HEADING_EN,
            ""
          ];

          let sectionContent = null;
          let matchedParent = currentParentHeading;
          let matchedSub = currentSubHeading;

          for (const parentH of candidateParentHeadings) {
            for (const subH of candidateSubHeadings) {
              const res = Utils.getSectionContent(content, parentH, subH);
              if (res !== null) {
                sectionContent = res;
                matchedParent = parentH;
                matchedSub = subH;
                break;
              }
            }
            if (sectionContent !== null) break;
          }

          if (sectionContent === null) {
            for (const subH of candidateSubHeadings) {
              const res = Utils.getSectionContent(content, "", subH);
              if (res !== null) {
                sectionContent = res;
                matchedParent = "";
                matchedSub = subH;
                break;
              }
            }
          }

          const rawSection = sectionContent !== null ? sectionContent : "";
          const scanned = this.plugin.habitScanner.scan(rawSection, this.plugin.settings.marker);
          if (!Array.isArray(scanned)) throw new Error("Habit section could not be scanned safely");

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

          const habitsMissing = scheduledHabits.filter((habit) =>
            !findHabitEntry(scanned, habit.linkText, habit.nameHistory, habit.id)
          );
          if (habitsMissing.length === 0) return originalContent;
          const newLines = habitsMissing.map((habit) =>
            habitsToAdd[scheduledHabits.findIndex((item) => item.id === habit.id)]
          );
          const separator = content.includes("\r\n") ? "\r\n" : "\n";
          let newContent;
          if (sectionContent !== null) {
            const parentRange = matchedParent ? Utils.findSectionRange(content, matchedParent, 2) : null;
            const parentBlock = parentRange ? content.slice(parentRange.contentStart, parentRange.end) : content;
            const sectionRange = Utils.findSectionRange(parentBlock, matchedSub, matchedParent ? 3 : 2);
            if (sectionRange) {
              const end = (parentRange ? parentRange.contentStart : 0) + sectionRange.end;
              const before = content.slice(0, end);
              const prefix = before.endsWith(separator) ? "" : separator;
              newContent = before + prefix + newLines.join(separator) + separator + content.slice(end);
            } else {
              newContent = Utils.insertNestedContent(content, currentParentHeading, currentSubHeading, newLines.join(separator));
            }
          } else {
            newContent = Utils.insertNestedContent(content, currentParentHeading, currentSubHeading, newLines.join(separator));
          }

          if (newContent !== originalContent) {
            didModify = true;
            Utils.debugLog(this.plugin, `Updated daily note habits list for ${dailyNote.basename}`);
            return newContent;
          }
          return originalContent;
        });
        if (didModify) {
          await this.plugin.statsService?.rescanFile(dailyNote);
        }
      } catch (error) {
        console.error("[Core Habits] Sync failed:", error);
        throw error;
      }
    }, targetPath);
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
    // LEGITIMATE USE: Vault scanning is required to find all markdown files that refer to the old habit name in order to batch rename them safely.
    const markdownFiles = this.plugin.app.vault.getMarkdownFiles();
    const filesToUpdate = [];

    for (const file of markdownFiles) {
      const content = await this.plugin.app.vault.cachedRead(file);
      const hasOldName = content.split(/\r?\n/).some((line) =>
        (/^\s*-\s*\[[ x-]\]/i.test(line) && line.includes(`[habit:: ${habitId}]`)
          || /^\s*-\s/.test(line) && line.includes(`[habit-id:: ${habitId}]`))
        && oldNamesArr.some((oldName) => line.includes(oldName))
      );
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

  async executeBatchRename(newName, uniqueOldNames, filesToUpdate, onProgress, isCancelled, habitId = null) {
    let updated = 0;
    const total = filesToUpdate.length;
    const id = habitId || this.getHabits().find((habit) =>
      uniqueOldNames.includes(habit.linkText) || (habit.nameHistory || []).some((name) => uniqueOldNames.includes(name))
    )?.id;
    if (!id) throw new Error("Cannot rename habit references without a habit ID");

    for (let i = 0; i < total; i++) {
      if (isCancelled && isCancelled()) {
        break;
      }

      const file = filesToUpdate[i];
      await this.runWithLock(async () => {
        await this.plugin.app.vault.process(file, (content) => {
          return content.split(/(\r?\n)/).map((part) => {
            const checklist = /^\s*-\s*\[[ x-]\]/i.test(part) && part.includes(`[habit:: ${id}]`);
            const comment = /^\s*-\s/.test(part) && part.includes(`[habit-id:: ${id}]`);
            if (!checklist && !comment) return part;
            let line = part;
            for (const oldLink of uniqueOldNames) {
              line = line.replaceAll(oldLink, `[[${newName}]]`);
              if (comment) {
                const oldClean = TextUtils.clean(oldLink.replace(/\[\[|\]\]/g, ""));
                line = line.replace(`[habit-note:: ${oldClean}]`, `[habit-note:: ${TextUtils.clean(newName)}]`);
              }
            }
            return line;
          }).join("");
        });
      }, file?.path);

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
        let soundType = null;
        await app.vault.process(file, (data) => {
          const separator = data.includes("\r\n") ? "\r\n" : "\n";
          const lines = data.split(/\r?\n/);
          let targetLineIndex = -1;

          const scanned = this.plugin.habitScanner.scan(data, marker);
          const entry = findHabitEntry(scanned, habit.linkText, habit.nameHistory, habit.id);

          if (entry) {
            targetLineIndex = entry.lineIndex;
          }
          if (targetLineIndex === -1) throw new Error(`Habit entry not found: ${habit.id}`);

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
              if (nextChar === "x" && match[2].toLowerCase() !== "x") soundType = "check";
              else if (nextChar !== "x" && match[2].toLowerCase() === "x") soundType = "uncheck";

              lines[targetLineIndex] = `${match[1]}${nextChar}${match[3]}${match[4]}`;
            }
          }
          return lines.join(separator);
        });
        if (soundType) this.plugin.audioEngine?.playSound({ type: soundType });
        if (this.plugin.statsService) await this.plugin.statsService.rescanFile(file);
        else {
          StreakCalculator.invalidate(habit.id);
          this.plugin?.app?.workspace?.trigger?.("core-habits:cache-invalidated", { habitId: habit.id });
        }
      } catch (error) {
        console.error("[Core Habits] Failed to toggle habit:", error);
        NoticeService.error(this.t("error_modifying_note"), this.plugin);
        throw error;
      }
    }, file?.path);
  }

  /**
   * Completes the daily checklist use case without exposing note creation or
   * file lookup to the view.
   */
  async toggleHabitForDate(date, habit, targetState = null) {
    await this.ensureHabitsInNote(date, habit, true);
    const file = await getNoteByDate(this.plugin.app, date, true, this.plugin.settings);
    if (!file) return false;
    await this.toggleHabitInNote(file, habit, targetState);
    return true;
  }

  async handleVaultRename(file, oldPath) {
    return this.runWithLock(async () => {
    const activeFolder = `${this.plugin.habitNoteManager.getActiveFolder()}/`;
    const archiveFolder = `${this.plugin.habitNoteManager.getArchiveFolder()}/`;
    const insideHabitFolder = (path) => path.startsWith(activeFolder) || path.startsWith(archiveFolder);
    if (!insideHabitFolder(file.path) || !insideHabitFolder(oldPath)) return;
    let habitId = this.plugin.app.metadataCache?.getFileCache?.(file)?.frontmatter?.habit_id;
    if (!habitId) {
      habitId = this.plugin.habitNoteManager?.getHabitIdByPath?.(oldPath);
    }
    if (!habitId) {
      const props = await this.plugin.habitNoteManager?.readHabitNoteProps?.(file.path);
      habitId = props?.habit_id;
    }
    if (!habitId) return;
    // 1. Detect manual move between Active/ and Archive/
    const moveType = this.plugin.habitNoteManager.detectManualMove(file.path, oldPath);
    if (moveType) {
      if (habitId) {
        this.plugin.habitNoteManager?.indexHabitFile?.(habitId, file.path);
        const habit = this.getHabitById(habitId);
        if (habit) {
          const changed = {
            ...habit,
            archived: moveType === 'archived',
            archivedDate: moveType === 'archived' ? Date.now() : habit.archivedDate,
            restoredDate: moveType === 'restored' ? Date.now() : habit.restoredDate
          };
          await this.repository.updateFileProps(file, changed);
          this.habitsMap.set(changed.id, changed);
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

    this.plugin.habitNoteManager?.indexHabitFile?.(habitId, file.path);
    const oldLink = `[[${oldBasename}]]`;
    for (const habit of this.getHabits()) {
      if (habit.id !== habitId) continue;
      const changed = {
        ...habit,
        nameHistory: [...new Set([...(habit.nameHistory || []), habit.linkText, oldLink].filter(Boolean))],
        linkText: `[[${newBasename}]]`,
        name: newBasename
      };
      await this.repository.updateFileProps(file, changed);
      this.habitsMap.set(changed.id, changed);
      this.invalidateCaches();

      Utils.debugLog(this.plugin, `Vault rename synced: "${oldBasename}" → "${newBasename}"`);
    }
    }, [file?.path, oldPath].filter(Boolean));
  }
}
