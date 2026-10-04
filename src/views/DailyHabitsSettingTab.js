import { PluginSettingTab } from 'obsidian';
import { BasicsPanel } from './settings/BasicsPanel.js';
import { HabitsPanel } from './settings/HabitsPanel.js';
import { DailyNotesPanel } from './settings/DailyNotesPanel.js';
import { PluginGuideComponent } from './PluginGuideComponent.js';
import { bindTabKeys, selectTab } from '../components/ui/TabBar.js';

class DailyHabitsSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.activeTab = "habits";
    
    // Instantiate panels once
    this.basicsPanelInstance = new BasicsPanel(plugin, this);
    this.habitsPanelInstance = new HabitsPanel(plugin, this);
    this.dailyNotesPanelInstance = new DailyNotesPanel(plugin, this);
    this.guidePanelInstance = new PluginGuideComponent(plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("daily-habits-settings-container");
    containerEl.addClass("daily-habits-plugin");

    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const dir = t("direction") || "rtl";
    
    if (dir === "rtl") containerEl.addClass("is-rtl");
    else containerEl.removeClass("is-rtl");
    containerEl.setAttribute("dir", dir);

    // 1. Render Tab Navigation with Accessibility attributes
    this.renderTabBar(containerEl, t);

    // 2. Create Panel Containers with ARIA attributes
    this.basicsPanel = containerEl.createDiv({ 
      cls: "dh-settings-panel", 
      attr: { 
        id: "panel-basics", 
        role: "tabpanel", 
        "aria-labelledby": "dh-tab-basics" 
      } 
    });
    this.habitsPanel = containerEl.createDiv({ 
      cls: "dh-settings-panel", 
      attr: { 
        id: "panel-habits", 
        role: "tabpanel", 
        "aria-labelledby": "dh-tab-habits" 
      } 
    });
    this.dailyNotesPanel = containerEl.createDiv({ 
      cls: "dh-settings-panel", 
      attr: { 
        id: "panel-advanced", 
        role: "tabpanel", 
        "aria-labelledby": "dh-tab-advanced" 
      } 
    });
    this.guidePanel = containerEl.createDiv({ 
      cls: "dh-settings-panel", 
      attr: { 
        id: "panel-guide", 
        role: "tabpanel", 
        "aria-labelledby": "dh-tab-guide" 
      } 
    });

    // 3. Render Panel Contents
    this.basicsPanelInstance.render(this.basicsPanel, t);
    this.habitsPanelInstance.render(this.habitsPanel, t);
    this.dailyNotesPanelInstance.render(this.dailyNotesPanel, t);
    this.guidePanelInstance.render(this.guidePanel, t);

    // 4. Initialize Active Tab
    this.switchTab(this.activeTab);
  }

  renderTabBar(containerEl, t) {
    const tabsContainer = containerEl.createDiv({ 
      cls: "dh-tabs dh-settings-tabs-container",
      attr: { role: "tablist", "aria-label": t("settings_title") || "Settings Tabs" }
    });

    this.tabs = {
      basics: tabsContainer.createEl("button", { 
        cls: "dh-tab dh-tab-btn", 
        text: t("tab_basics"),
        attr: { id: "dh-tab-basics", role: "tab", "aria-controls": "panel-basics", "aria-selected": "false" }
      }),
      habits: tabsContainer.createEl("button", { 
        cls: "dh-tab dh-tab-btn", 
        text: t("tab_habits"),
        attr: { id: "dh-tab-habits", role: "tab", "aria-controls": "panel-habits", "aria-selected": "false" }
      }),
      advanced: tabsContainer.createEl("button", { 
        cls: "dh-tab dh-tab-btn", 
        text: t("tab_advanced"),
        attr: { id: "dh-tab-advanced", role: "tab", "aria-controls": "panel-advanced", "aria-selected": "false" }
      }),
      guide: tabsContainer.createEl("button", { 
        cls: "dh-tab dh-tab-btn", 
        text: t("tab_guide"),
        attr: { id: "dh-tab-guide", role: "tab", "aria-controls": "panel-guide", "aria-selected": "false" }
      })
    };

    this.updateHabitCountBadge();

    Object.keys(this.tabs).forEach(tabId => {
      this.tabs[tabId].onclick = () => this.switchTab(tabId);
    });
    bindTabKeys(tabsContainer, this.tabs, (tabId) => this.switchTab(tabId));
  }

  updateHabitCountBadge() {
    if (!this.tabs || !this.tabs.habits) return;
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const activeCount = this.plugin.habitManager.getActiveHabits().length;
    this.tabs.habits.empty();
    this.tabs.habits.createSpan({ text: t("tab_habits") });
    if (activeCount > 0) {
      this.tabs.habits.createSpan({ text: String(activeCount), cls: "dh-tab-count-badge" });
    }
  }

  switchTab(tabId) {
    this.activeTab = tabId;

    const panels = {
      basics: this.basicsPanel,
      habits: this.habitsPanel,
      advanced: this.dailyNotesPanel,
      guide: this.guidePanel
    };

    if (this.tabs) selectTab(this.tabs, tabId, panels);
  }

  refreshUI() {
    const st = this.containerEl ? this.containerEl.scrollTop : 0;
    this.updateHabitCountBadge();

    // Preserve search filter and focus
    const searchInput = this.containerEl ? this.containerEl.querySelector('.dh-search-input') : null;
    const filter = searchInput ? searchInput.value.trim().toLowerCase() : "";
    const wasFocused = searchInput && document.activeElement === searchInput;
    const cursorStart = searchInput ? searchInput.selectionStart : null;
    const cursorEnd = searchInput ? searchInput.selectionEnd : null;

    if (this.habitsPanelInstance && this.habitsPanelInstance.habitsContainer) {
      this.habitsPanelInstance.renderHabitsList(this.habitsPanelInstance.habitsContainer, filter);
    }
    if (this.habitsPanelInstance?.archiveDetails?.open && this.habitsPanelInstance.archivedContainer) {
      this.habitsPanelInstance.renderArchivedHabitsList(this.habitsPanelInstance.archivedContainer);
    } else if (this.habitsPanelInstance?.archiveCountBadge) {
      this.habitsPanelInstance.archiveCountBadge.textContent = String(this.plugin.habitManager.getArchivedHabits().length);
    }
    if (this.habitsPanelInstance?.removedSection) {
      this.habitsPanelInstance.renderRemovedHabits(this.habitsPanelInstance.removedSection, (key, params) => this.plugin.translationManager.t(key, params));
    }
    if (this.habitsPanelInstance?.dangerSection) {
      this.habitsPanelInstance.renderDangerZone(this.habitsPanelInstance.dangerSection, (key, params) => this.plugin.translationManager.t(key, params));
    }

    if (this.habitsPanelInstance && typeof this.habitsPanelInstance.updateAddBtnState === "function") {
      this.habitsPanelInstance.updateAddBtnState();
    }

    if (this.containerEl) {
      this.containerEl.scrollTop = st;
    }

    if (wasFocused) {
      const newSearch = this.containerEl.querySelector('.dh-search-input');
      if (newSearch) {
        newSearch.focus();
        if (cursorStart !== null && cursorEnd !== null) {
          try {
            newSearch.setSelectionRange(cursorStart, cursorEnd);
          } catch {
            // Ignore cursor set error if not supported
          }
        }
      }
    }
  }
}

export { DailyHabitsSettingTab };
