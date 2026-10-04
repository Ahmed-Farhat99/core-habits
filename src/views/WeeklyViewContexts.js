/**
 * Keep each renderer's callbacks limited to the state and actions it uses.
 * All mutable values are read from the owning view when invoked.
 * @param {import('./WeeklyGridView.js').WeeklyGridView} view
 */
export function createWeeklyViewContexts(view) {
  const shared = { app: view.app, plugin: view.plugin };

  const grid = {
    ...shared,
    isAr: () => view.isAr,
    getWeekStart: () => view.currentWeekStart,
    getReflectionDays: () => view.dailyReflectionDays,
    getDailyStats: () => view.dailyStats,
    getWeekContentCache: () => view.weekContentCache,
    isClosed: () => view._isClosed,
    getWeeklyContentContainer: () => view.getWeeklyContentContainer(),
    getRenderToken: () => view.renderToken,
    getWeekDayInfos: () => view.getWeekDayInfos(),
    queueStreakCalculation: (habit, row) => view.queueStreakCalculation(habit, row),
    getHabitNotesHeading: () => view.getHabitNotesHeading(),
    extractSectionLines: (content, heading) => view.extractSectionLines(content, heading),
    isCompactMode: () => view.isCompactMode,
    getFocusedDayIndex: () => view.focusedDayIndex,
    setFocusedDayIndex: (index) => { view.focusedDayIndex = index; },
    goToCurrentWeek: () => view.goToCurrentWeek(),
    getStreakCalculator: () => view.streakCalculator,
    getRefreshTimer: () => view._refreshTimer,
    setRefreshTimer: (timer) => { view._refreshTimer = timer; },
    getLastWeekRatesCache: () => view.lastWeekRatesCache,
    toggleHabitCompletion: (habit, date, state) => view.toggleHabitCompletion(habit, date, state),
    checkMilestone: (dateKey) => view.checkMilestone(dateKey),
    openEditHabitModal: (habit) => view.openEditHabitModal(habit),
    openCommentPopup: (habit, date) => view.openCommentPopup(habit, date),
    openHabitPage: (habit) => view.openHabitPage(habit),
    openDailyNote: (date) => view.openDailyNote(date),
    openReflectionPopup: (date) => view.openReflectionPopup(date),
    toggleGroupCollapse: (id, collapsed) => view.toggleGroupCollapse(id, collapsed),
    toggleAllGroupsCollapse: (ids, collapsed) => view.toggleAllGroupsCollapse(ids, collapsed),
    dismissGridHint: () => view.dismissGridHint(),
    renderWeeklyGrid: () => view.renderWeeklyGrid(),
  };

  const diary = {
    ...shared,
    diaryService: view.plugin.diaryService,
    getComponent: () => view,
    getDiaryViewMode: () => view.diaryViewMode,
    setDiaryViewMode: async (mode) => {
      view.diaryViewMode = mode;
      view.plugin.settings.diaryViewMode = mode;
      await view.plugin.saveSettings({ silent: true });
      await view.renderWeeklyGrid();
    },
    getReflectionTypeMeta: (type) => view.getReflectionTypeMeta(type),
    openReflectionPopup: (date) => view.openReflectionPopup(date),
    openDailyNote: (date) => view.openDailyNote(date),
  };

  const statistics = {
    ...shared,
    isAr: () => view.isAr,
    openEditHabitModal: (habit) => view.openEditHabitModal(habit),
  };

  return { grid, diary, statistics };
}
