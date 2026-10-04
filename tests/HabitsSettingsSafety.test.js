import { describe, it, expect, vi } from "vitest";
import { HabitsPanel } from "../src/views/settings/HabitsPanel.js";

function makePanel(overrides = {}) {
  const plugin = {
    app: {},
    settings: { language: "ar", collapsedGroups: [] },
    translationManager: { t: (key) => ({
      empty_state_title: "لا توجد عادات بعد",
      settings_no_search_results: "لا توجد عادات مطابقة",
      settings_no_search_results_desc: "جرّب كلمة بحث أخرى",
      settings_archived_habits: "العادات المؤرشفة"
    })[key] || key },
    habitManager: {
      getActiveHabits: vi.fn(() => []),
      getArchivedHabits: vi.fn(() => []),
      getRemovedHabits: vi.fn(() => []),
      addHabit: vi.fn(),
      getEffectiveParentId: vi.fn(() => null),
      isParent: vi.fn(() => false)
    },
    saveSettings: vi.fn(),
    refreshWeeklyViews: vi.fn(),
    ...overrides
  };
  const settingsTab = { switchTab: vi.fn(), refreshUI: vi.fn() };
  return { panel: new HabitsPanel(plugin, settingsTab), plugin, settingsTab };
}

describe("habits settings safety", () => {
  it("propagates a failed create so the form can keep its unsaved fields", async () => {
    const { panel, plugin, settingsTab } = makePanel();
    plugin.habitManager.addHabit.mockRejectedValue(new Error("disk full"));
    await expect(panel.submitNewHabit({ name: "قراءة" })).rejects.toThrow("disk full");
    expect(settingsTab.refreshUI).not.toHaveBeenCalled();
    expect(plugin.refreshWeeklyViews).not.toHaveBeenCalled();
  });

  it("treats the create as successful when only the view refresh fails", async () => {
    const { panel, plugin, settingsTab } = makePanel();
    settingsTab.refreshUI.mockImplementation(() => { throw new Error("render failed"); });
    await expect(panel.submitNewHabit({ name: "قراءة" })).resolves.toBeUndefined();
    expect(plugin.habitManager.addHabit).toHaveBeenCalledTimes(1);
  });

  it("does not write habit files while rendering archived habits", () => {
    const { panel, plugin } = makePanel();
    plugin.habitManager.getArchivedHabits.mockReturnValue([{
      id: "archived-1", name: "قراءة", order: 0, savedLongestStreak: 8, archivedDate: Date.now()
    }]);
    plugin.streakCalculator = { calculate: vi.fn().mockResolvedValue({ longestStreak: 9 }) };
    plugin.habitManager.updateHabit = vi.fn();
    const container = document.createElement("div");
    panel.renderArchivedHabitsList(container);
    expect(container.textContent).toContain("8");
    expect(plugin.streakCalculator.calculate).not.toHaveBeenCalled();
    expect(plugin.habitManager.updateHabit).not.toHaveBeenCalled();
  });

  it("distinguishes a search miss from an empty vault", () => {
    const { panel, plugin } = makePanel();
    plugin.habitManager.getActiveHabits.mockReturnValue([{ id: "one", name: "قراءة" }]);
    const container = document.createElement("div");
    panel.renderHabitsList(container, "صلاة");
    expect(container.textContent).toContain("لا توجد عادات مطابقة");
    expect(container.textContent).not.toContain("لا توجد عادات بعد");
  });

  it("keeps the habit name, level, schedule, and actions available in compact settings rows", () => {
    const { panel, plugin } = makePanel();
    plugin.habitManager.getActiveHabits.mockReturnValue([{
      id: "one", name: "قراءة كتاب طويل", currentLevel: 3,
      schedule: { type: "all-days", days: [0, 1, 2, 3, 4, 5, 6] }
    }]);
    const container = document.createElement("div");
    panel.renderHabitsList(container);
    const row = container.querySelector(".dh-habit-row:not(.dh-list-header)");
    expect(row.querySelector(".dh-habit-name").textContent).toBe("قراءة كتاب طويل");
    expect(row.querySelector(".dh-level-label")).not.toBeNull();
    expect(row.querySelector(".dh-level-badge").getAttribute("aria-label")).toContain("3");
    expect(row.querySelector(".dh-col-schedule").textContent).toBeTruthy();
    expect(row.querySelectorAll(".dh-col-actions button")).toHaveLength(2);
  });

  it("offers a way to recover removed habits from settings", () => {
    const { panel, plugin } = makePanel();
    plugin.habitManager.getRemovedHabits.mockReturnValue([{ id: "removed-1", name: "قراءة" }]);
    plugin.habitManager.restoreRemovedHabit = vi.fn().mockResolvedValue({});
    const container = document.createElement("div");
    panel.renderRemovedHabits(container, (key) => ({ settings_removed_habits: "العادات المُزالة", action_restore: "استعادة" })[key] || key);
    expect(container.textContent).toContain("قراءة");
    expect(container.textContent).toContain("استعادة");
  });

  it("derives live milestone level from savedLongestStreak in settings rows", () => {
    const { panel, plugin } = makePanel();
    plugin.habitManager.getActiveHabits.mockReturnValue([{
      id: "streak-habit", name: "رياضة يومية", currentLevel: 1, savedLongestStreak: 25,
      schedule: { type: "all-days", days: [0, 1, 2, 3, 4, 5, 6] }
    }]);
    const container = document.createElement("div");
    panel.renderHabitsList(container);
    const row = container.querySelector(".dh-habit-row:not(.dh-list-header)");
    const badge = row.querySelector(".dh-level-badge");
    expect(badge.textContent).toBe("4");
    expect(badge.getAttribute("aria-label")).toContain("4");
  });

  describe("HabitsPanel Header Toolbar & Capacity Meter", () => {
    const mockT = (k, params = {}) => {
      const dict = {
        add_habit_btn: "Add Habit",
        settings_capacity_badge: "{current} / {max} active habits",
        settings_capacity_warning: "Approaching active habits limit ({max})",
        settings_max_habits_reached: "Maximum limit reached ({max} active habits)."
      };
      let val = dict[k] || k;
      Object.keys(params).forEach(p => { val = val.replace(`{${p}}`, params[p]); });
      return val;
    };

    it("should render action toolbar separating primary button and capacity indicator", () => {
      const { panel, plugin } = makePanel({ translationManager: { t: mockT } });
      plugin.habitManager.getActiveHabits.mockReturnValue([
        { id: "h1", name: "Habit 1" },
        { id: "h2", name: "Habit 2" }
      ]);
      const container = document.createElement("div");
      panel.render(container, mockT);

      const toolbar = container.querySelector(".dh-habits-header-toolbar");
      expect(toolbar).not.toBeNull();

      const addBtn = toolbar.querySelector(".dh-add-habit-btn-primary");
      expect(addBtn).not.toBeNull();
      expect(addBtn.textContent).toContain("Add Habit");
      expect(addBtn.textContent).not.toContain("2/50");

      const badge = toolbar.querySelector(".dh-capacity-badge");
      expect(badge).not.toBeNull();
      expect(badge.textContent).toBe("2 / 50 active habits");
      expect(badge.classList.contains("is-warning")).toBe(false);
      expect(badge.classList.contains("is-limit-reached")).toBe(false);
    });

    it("should show warning state on capacity badge when habits count reaches 45+", () => {
      const habits46 = Array.from({ length: 46 }, (_, i) => ({ id: `h${i}`, name: `Habit ${i}` }));
      const { panel, plugin } = makePanel({ translationManager: { t: mockT } });
      plugin.habitManager.getActiveHabits.mockReturnValue(habits46);
      const container = document.createElement("div");

      panel.render(container, mockT);

      const badge = container.querySelector(".dh-capacity-badge");
      expect(badge.textContent).toBe("46 / 50 active habits");
      expect(badge.classList.contains("is-warning")).toBe(true);
      expect(badge.classList.contains("is-limit-reached")).toBe(false);

      const addBtn = container.querySelector(".dh-add-habit-btn-primary");
      expect(addBtn.disabled).toBe(false);
    });

    it("should disable add button and mark capacity as limit-reached when count is 50", () => {
      const habits50 = Array.from({ length: 50 }, (_, i) => ({ id: `h${i}`, name: `Habit ${i}` }));
      const { panel, plugin } = makePanel({ translationManager: { t: mockT } });
      plugin.habitManager.getActiveHabits.mockReturnValue(habits50);
      const container = document.createElement("div");

      panel.render(container, mockT);

      const badge = container.querySelector(".dh-capacity-badge");
      expect(badge.textContent).toBe("50 / 50 active habits");
      expect(badge.classList.contains("is-limit-reached")).toBe(true);

      const addBtn = container.querySelector(".dh-add-habit-btn-primary");
      expect(addBtn.disabled).toBe(true);
      expect(addBtn.classList.contains("is-limit-reached")).toBe(true);
    });
  });
});

