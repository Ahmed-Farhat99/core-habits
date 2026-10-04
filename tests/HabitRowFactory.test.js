import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HabitRowFactory } from '../src/views/renderers/HabitRowFactory.js';

describe('HabitRowFactory Unit Tests', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
  });

  describe('buildColorMap', () => {
    it('correctly maps colors and inherits parent colors for children', () => {
      const habits = [
        { id: 'parent1', color: 'rose' },
        { id: 'child1', parentId: 'parent1', color: 'blue' },
        { id: 'standalone', color: 'green' }
      ];

      const colorMap = HabitRowFactory.buildColorMap(habits);
      expect(colorMap.get('parent1')).toBe('#f43f5e'); // rose
      expect(colorMap.get('child1')).toBe('#f43f5e');  // inherited from parent
      expect(colorMap.get('standalone')).toBe('#10b981'); // green
    });
  });

  describe('resolveHierarchy', () => {
    it('identifies parent, child, and root habits accurately', () => {
      const fakeHabitManager = {
        getEffectiveParentId: (id) => (id === 'child1' ? 'parent1' : null),
        isParent: (id) => id === 'parent1'
      };

      const habits = [
        { id: 'parent1' },
        { id: 'child1', parentId: 'parent1' },
        { id: 'other' }
      ];

      const parentRes = HabitRowFactory.resolveHierarchy(habits[0], habits, fakeHabitManager);
      expect(parentRes.isParentHabit).toBe(true);
      expect(parentRes.isChild).toBe(false);
      expect(parentRes.effectiveParentId).toBeNull();

      const childRes = HabitRowFactory.resolveHierarchy(habits[1], habits, fakeHabitManager);
      expect(childRes.isParentHabit).toBe(false);
      expect(childRes.isChild).toBe(true);
      expect(childRes.effectiveParentId).toBe('parent1');
    });
  });

  describe('createRowShell', () => {
    it('sets standard classes, data attributes and CSS variable', () => {
      const row = HabitRowFactory.createRowShell({
        container,
        habit: { id: 'h1' },
        effectiveParentId: null,
        isChild: false,
        colorHex: '#14b8a6',
        role: 'row',
        extraClasses: ['custom-class']
      });

      expect(row.classList.contains('dh-habit')).toBe(true);
      expect(row.classList.contains('habit-row')).toBe(true);
      expect(row.classList.contains('custom-class')).toBe(true);
      expect(row.getAttribute('role')).toBe('row');
      expect(row.getAttribute('data-habit-id')).toBe('h1');
      expect(row.getAttribute('data-group-id')).toBe('h1');
      expect(row.style.getPropertyValue('--habit-color')).toBe('#14b8a6');
      expect(row.classList.contains('dh-habit-color-scope')).toBe(true);
      expect(row.style.color).toBe('');
      expect(row.style.backgroundColor).toBe('');
    });

    it('adds habit-row-child class and group-id when isChild is true', () => {
      const row = HabitRowFactory.createRowShell({
        container,
        habit: { id: 'c1' },
        effectiveParentId: 'p1',
        isChild: true,
        colorHex: '#f43f5e',
        role: 'listitem'
      });

      expect(row.classList.contains('habit-row-child')).toBe(true);
      expect(row.getAttribute('data-group-id')).toBe('p1');
      expect(row.getAttribute('role')).toBe('listitem');
    });
  });

  describe('createTypeDot', () => {
    it('creates break and build type dots with tooltips', () => {
      const t = vi.fn((k) => (k === 'grid_type_break' ? 'Break habit' : 'Build habit'));

      const breakDot = HabitRowFactory.createTypeDot(container, 'break', t);
      expect(breakDot.classList.contains('dh-type-dot')).toBe(true);
      expect(breakDot.classList.contains('break')).toBe(true);

      const buildDot = HabitRowFactory.createTypeDot(container, 'build', t);
      expect(buildDot.classList.contains('dh-type-dot')).toBe(true);
      expect(buildDot.classList.contains('build')).toBe(true);
    });
  });

  describe('createCollapseButton', () => {
    it('creates accessible button with toggle handler', () => {
      const t = vi.fn((k) => k);
      const onToggle = vi.fn();

      const btn = HabitRowFactory.createCollapseButton(container, {
        habitId: 'p1',
        isCollapsed: false,
        t,
        attrName: 'data-collapse-id',
        onToggle
      });

      expect(btn.getAttribute('data-collapse-id')).toBe('p1');
      expect(btn.getAttribute('aria-expanded')).toBe('true');
      expect(btn.classList.contains('dh-collapse-btn')).toBe(true);
      expect(btn.classList.contains('is-collapsed')).toBe(false);

      btn.click();
      expect(onToggle).toHaveBeenCalledTimes(1);
    });
  });

  describe('createNameLink', () => {
    it('creates keyboard and click accessible name element', () => {
      const t = vi.fn(() => 'Tooltip text');
      const onOpenEdit = vi.fn();

      const link = HabitRowFactory.createNameLink(container, {
        habit: { name: 'Read Book' },
        t,
        isAr: false,
        onOpenEdit
      });

      expect(link.textContent).toBe('Read Book');
      expect(link.getAttribute('role')).toBe('button');
      expect(link.getAttribute('tabindex')).toBe('0');

      link.click();
      expect(onOpenEdit).toHaveBeenCalledTimes(1);

      link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(onOpenEdit).toHaveBeenCalledTimes(2);
    });
  });

  describe('createStreakBadgeSlot', () => {
    it('creates badge slot and triggers context streak calculation queue', () => {
      const queueStreakCalculation = vi.fn();
      const habit = { id: 'h1' };
      const row = document.createElement('div');

      const slot = HabitRowFactory.createStreakBadgeSlot(container, {
        habit,
        row,
        context: { queueStreakCalculation }
      });

      expect(slot.classList.contains('dh-streak-badge-slot')).toBe(true);
      expect(queueStreakCalculation).toHaveBeenCalledWith(habit, row);
    });
  });

  describe('createOpenPageIcon', () => {
    it('handles open habit page click and keydown', () => {
      const onOpenPage = vi.fn();
      const t = vi.fn(() => 'Open page');

      const icon = HabitRowFactory.createOpenPageIcon(container, {
        t,
        onOpenPage,
        tagName: 'button',
        extraAttrs: { type: 'button' }
      });

      expect(icon.tagName.toLowerCase()).toBe('button');
      expect(icon.classList.contains('habit-open-page-icon')).toBe(true);

      icon.click();
      expect(onOpenPage).toHaveBeenCalledTimes(1);

      icon.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
      expect(onOpenPage).toHaveBeenCalledTimes(2);
    });
  });

  describe('renderCompactHabitRow hierarchy', () => {
    it('renders dh-child-indent element for child habits in compact row', async () => {
      const parent = { id: 'parent1', name: 'Parent Habit', habitType: 'build' };
      const child = { id: 'child1', name: 'Child Habit', parentId: 'parent1', habitType: 'build' };
      const habits = [parent, child];

      const fakePlugin = {
        settings: { collapsedGroups: [] },
        habitManager: {
          getEffectiveParentId: (id) => (id === 'child1' ? 'parent1' : null),
          isParent: (id) => id === 'parent1',
          isHabitScheduledForDay: () => true
        }
      };

      const fakeContext = {
        openEditHabitModal: vi.fn(),
        queueStreakCalculation: vi.fn(),
        getHabitStreak: vi.fn(() => 0)
      };

      const t = vi.fn((k) => k);

      await HabitRowFactory.renderCompactRow({
        container,
        habit: child,
        sortedHabits: habits,
        colorHex: '#14b8a6',
        dayDate: { format: () => '2026-09-30', day: () => 3, isAfter: () => false },
        dayOfWeek: 3,
        dateKey: '2026-09-30',
        today: { format: () => '2026-09-30', isAfter: () => false },
        statusContent: new Map(),
        context: fakeContext,
        plugin: fakePlugin,
        isAr: false,
        t,
        getHabitStatusForDay: vi.fn(() => ({ status: 'none' })),
        updateHeaderAndProgress: vi.fn(),
        refreshRowMeta: vi.fn()
      });

      const childIndent = container.querySelector('.dh-compact-row .dh-child-indent');
      expect(childIndent).not.toBeNull();
      expect(childIndent.classList.contains('is-child')).toBe(true);
    });
  });
});
