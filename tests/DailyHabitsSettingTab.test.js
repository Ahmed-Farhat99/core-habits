import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DailyHabitsSettingTab } from '../src/views/DailyHabitsSettingTab.js';
import { DEFAULT_SETTINGS } from '../src/constants.js';

describe('DailyHabitsSettingTab Tests', () => {
  let mockPlugin;
  let mockApp;

  beforeEach(() => {
    mockApp = {
      vault: {
        adapter: {
          getBasePath: vi.fn().mockReturnValue("/vault/root"),
          basePath: "/vault/root",
        },
        getAbstractFileByPath: vi.fn().mockReturnValue(null),
        createFolder: vi.fn().mockResolvedValue(true),
        createBinary: vi.fn().mockResolvedValue(true),
        create: vi.fn().mockResolvedValue({ path: "test.md" }),
      },
      fileManager: {
        getAvailablePathForAttachment: vi.fn().mockImplementation(async (name) => `Attachments/${name}`),
      },
    };

    mockPlugin = {
      app: mockApp,
      settings: { ...DEFAULT_SETTINGS },
      translationManager: {
        t: vi.fn((k) => `translated_${k}`),
      },
      habitManager: {
        getActiveHabits: vi.fn().mockReturnValue([]),
        getArchivedHabits: vi.fn().mockReturnValue([]),
        getRemovedHabits: vi.fn().mockReturnValue([]),
        getHabits: vi.fn().mockReturnValue([]),
      },
      saveSettings: vi.fn().mockResolvedValue(true),
      refreshWeeklyViews: vi.fn(),
    };
  });

  it('should initialize setting tab with panel instances', () => {
    const tab = new DailyHabitsSettingTab(mockApp, mockPlugin);
    expect(tab.basicsPanelInstance).toBeDefined();
    expect(tab.habitsPanelInstance).toBeDefined();
    expect(tab.dailyNotesPanelInstance).toBeDefined();
    expect(tab.guidePanelInstance).toBeDefined();
    expect(typeof tab.display).toBe('function');
  });

  it('should render panels and switch tabs', () => {
    const tab = new DailyHabitsSettingTab(mockApp, mockPlugin);
    tab.containerEl = document.createElement('div');
    tab.display();

    expect(tab.activeTab).toBe('habits');
    expect(tab.habitsPanel.classList.contains('is-active')).toBe(true);
    expect(tab.basicsPanel.classList.contains('is-active')).toBe(false);

    // Switch to basics tab
    tab.tabs.basics.click();
    expect(tab.activeTab).toBe('basics');
    expect(tab.basicsPanel.classList.contains('is-active')).toBe(true);
    expect(tab.habitsPanel.classList.contains('is-active')).toBe(false);
    expect(tab.tabs.basics.getAttribute('aria-selected')).toBe('true');
    expect(tab.tabs.habits.getAttribute('aria-selected')).toBe('false');

    // Switch to advanced tab
    tab.tabs.advanced.click();
    expect(tab.activeTab).toBe('advanced');
    expect(tab.dailyNotesPanel.classList.contains('is-active')).toBe(true);
    expect(tab.basicsPanel.classList.contains('is-active')).toBe(false);
    expect(tab.guidePanel.classList.contains('is-active')).toBe(false);

    // Switch to guide tab
    tab.tabs.guide.click();
    expect(tab.activeTab).toBe('guide');
    expect(tab.guidePanel.classList.contains('is-active')).toBe(true);
    expect(tab.habitsPanel.classList.contains('is-active')).toBe(false);
    expect(tab.basicsPanel.classList.contains('is-active')).toBe(false);
    expect(tab.dailyNotesPanel.classList.contains('is-active')).toBe(false);
    expect(tab.tabs.guide.getAttribute('aria-selected')).toBe('true');
  });

  it('should include hasSeenGridHint: false in DEFAULT_SETTINGS schema', () => {
    expect(DEFAULT_SETTINGS).toHaveProperty('hasSeenGridHint');
    expect(DEFAULT_SETTINGS.hasSeenGridHint).toBe(false);
  });

  it('should correctly format localized capacity badge in HabitsPanel', () => {
    const tab = new DailyHabitsSettingTab(mockApp, mockPlugin);
    tab.containerEl = document.createElement('div');
    tab.display();

    const tCalls = [];
    mockPlugin.translationManager.t = vi.fn((k, params = {}) => {
      tCalls.push({ k, params });
      if (k === "settings_capacity_badge") return `${params.current} / ${params.max} active habits`;
      if (k === "settings_capacity_warning") return `Approaching limit (${params.max})`;
      return k;
    });

    mockPlugin.habitManager.getActiveHabits.mockReturnValue([
      { id: "h1", name: "Habit 1" },
      { id: "h2", name: "Habit 2" }
    ]);

    tab.habitsPanelInstance.updateAddBtnState();

    expect(tab.habitsPanelInstance.capacityBadge.textContent).toBe("2 / 50 active habits");
    expect(tCalls.some(c => c.k === "settings_capacity_badge" && c.params.current === 2 && c.params.max === 50)).toBe(true);
  });

  it('should initialize dailyNotesPanelInstance and render unified daily notes sections', () => {
    const tab = new DailyHabitsSettingTab(mockApp, mockPlugin);
    expect(tab.dailyNotesPanelInstance).toBeDefined();

    tab.containerEl = document.createElement('div');
    tab.display();

    expect(tab.dailyNotesPanel).toBeDefined();

    const headers = Array.from(tab.dailyNotesPanel.querySelectorAll('.dh-settings-section-header'))
      .map(el => el.textContent);

    expect(headers).toContain('translated_settings_other_heading');
    expect(headers).toContain('translated_settings_formatting_heading');
    expect(headers).toContain('translated_settings_sync_behavior_heading');
    expect(headers).toContain('translated_settings_maintenance_heading');
  });
});


