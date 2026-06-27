import { PluginSettingTab } from 'obsidian';
import { BasicsPanel } from './settings/BasicsPanel.js';
import { HabitsPanel } from './settings/HabitsPanel.js';
import { AdvancedPanel } from './settings/AdvancedPanel.js';
import { PluginGuideComponent } from './PluginGuideComponent.js';

class DailyHabitsSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.activeTab = "habits";
    
    // Instantiate panels
    this.basicsPanelInstance = new BasicsPanel(plugin, this);
    this.habitsPanelInstance = new HabitsPanel(plugin, this);
    this.advancedPanelInstance = new AdvancedPanel(plugin, this);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("daily-habits-settings-container");
    containerEl.addClass("daily-habits-plugin");

    const t = (k, p) => this.plugin.translationManager.t(k, p);
    
    if (t("direction") === "rtl") containerEl.addClass("is-rtl");
    else containerEl.removeClass("is-rtl");
    containerEl.setAttribute("dir", t("direction"));

    containerEl.createEl("h1", { text: t("settings_title") });

    // 1. Render Tab Navigation
    this.renderTabBar(containerEl, t);

    // 2. Create Panel Containers
    this.basicsPanel = containerEl.createDiv({ cls: "dh-settings-panel", attr: { id: "panel-basics" } });
    this.habitsPanel = containerEl.createDiv({ cls: "dh-settings-panel", attr: { id: "panel-habits" } });
    this.advancedPanel = containerEl.createDiv({ cls: "dh-settings-panel", attr: { id: "panel-advanced" } });
    this.guidePanel = containerEl.createDiv({ cls: "dh-settings-panel", attr: { id: "panel-guide" } });

    // 3. Render Panel Contents
    this.basicsPanelInstance.render(this.basicsPanel, t);
    this.habitsPanelInstance.render(this.habitsPanel, t);
    this.advancedPanelInstance.render(this.advancedPanel, t);
    new PluginGuideComponent(this.plugin).render(this.guidePanel, t);

    // 4. Initialize Active Tab
    this.switchTab(this.activeTab);
  }

  renderTabBar(containerEl, t) {
    const tabsContainer = containerEl.createDiv({ cls: "dh-settings-tabs-container" });

    this.tabs = {
      basics: tabsContainer.createEl("button", { cls: "dh-tab-btn", text: t("tab_basics") }),
      habits: tabsContainer.createEl("button", { cls: "dh-tab-btn", text: t("tab_habits") }),
      advanced: tabsContainer.createEl("button", { cls: "dh-tab-btn", text: t("tab_advanced") }),
      guide: tabsContainer.createEl("button", { cls: "dh-tab-btn", text: t("tab_guide") })
    };

    // Add Habit count badge to Habits tab
    const activeHabitsCount = this.plugin.habitManager.getActiveHabits().length;
    if (activeHabitsCount > 0) {
      this.tabs.habits.textContent += ` (${activeHabitsCount})`;
    }

    Object.keys(this.tabs).forEach(tabId => {
      this.tabs[tabId].onclick = () => this.switchTab(tabId);
    });
  }

  switchTab(tabId) {
    this.activeTab = tabId;

    // Update button states
    if (this.tabs) {
      Object.keys(this.tabs).forEach(id => {
        this.tabs[id].toggleClass("is-active", id === tabId);
      });
    }

    // Update panel visibility
    const panels = {
      basics: this.basicsPanel,
      habits: this.habitsPanel,
      advanced: this.advancedPanel,
      guide: this.guidePanel
    };

    Object.keys(panels).forEach(id => {
      if (panels[id]) {
        panels[id].toggleClass("is-active", id === tabId);
      }
    });

    // Refresh child panels dynamically if needed to fix heights
    if (tabId === "habits" && this.habitsPanelInstance.habitsContainer) {
      const searchInput = this.containerEl.querySelector('.dh-search-input');
      const filter = searchInput ? searchInput.value.trim().toLowerCase() : "";
      this.habitsPanelInstance.renderHabitsList(this.habitsPanelInstance.habitsContainer, filter);
    }
  }

  refreshUI() {
    const st = this.containerEl.scrollTop;
    const hasActive = this.plugin.habitManager.getActiveHabits().length > 0;
    const hasArchived = this.plugin.habitManager.getArchivedHabits().length > 0;
    const currentlyHasActive = !!this.containerEl.querySelector('.dh-danger-zone');
    const currentlyHasArchived = !!this.habitsPanelInstance.archivedContainer;

    if (hasActive !== currentlyHasActive || hasArchived !== currentlyHasArchived) {
      const searchInput = this.containerEl.querySelector('.dh-search-input');
      const filter = searchInput ? searchInput.value : "";
      this.display();
      this.containerEl.scrollTop = st;
      if (filter) {
        const newSearch = this.containerEl.querySelector('.dh-search-input');
        if (newSearch) {
          newSearch.value = filter;
          newSearch.focus();
        }
      }
    } else {
      if (this.habitsPanelInstance.habitsContainer) {
        const searchInput = this.containerEl.querySelector('.dh-search-input');
        const filter = searchInput ? searchInput.value.trim().toLowerCase() : "";
        this.habitsPanelInstance.renderHabitsList(this.habitsPanelInstance.habitsContainer, filter);
      }
      if (this.habitsPanelInstance.archivedContainer) {
        this.habitsPanelInstance.renderArchivedHabitsList(this.habitsPanelInstance.archivedContainer);
      }
    }
  }
}

export { DailyHabitsSettingTab };