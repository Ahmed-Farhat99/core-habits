import { describe, expect, it } from 'vitest';
import {
  normalizeHabitColorHex,
  buildHabitColorMap,
  getFormHabitColorHex,
  applyHabitColor,
} from '../src/utils/HabitColor.js';

const parent = { id: 'parent', color: 'rose', parentId: null };
const child = { id: 'child', color: 'blue', parentId: parent.id };

describe('Habit color contract', () => {
  it.each([
    ['rose', '#f43f5e'],
    ['blue', '#3b82f6'],
    ['#F43F5E', '#f43f5e'],
    ['#3b82f6', '#3b82f6'],
    ['unknown-color', '#14b8a6'],
    [undefined, '#14b8a6'],
  ])('normalizes %s at the color boundary without resolving a hex as an ID', (input, expected) => {
    expect(normalizeHabitColorHex(input)).toBe(expected);
  });

  it.each([
    [[parent, child]],
    [[child, parent]],
  ])('inherits the same parent color regardless of display order', (habits) => {
    const colors = buildHabitColorMap(habits);
    expect(colors.get(parent.id)).toBe('#f43f5e');
    expect(colors.get(child.id)).toBe('#f43f5e');
  });

  it('keeps a missing-parent habit independent with its own color', () => {
    expect(buildHabitColorMap([child]).get(child.id)).toBe('#3b82f6');
  });

  it.each(['archived', 'deleted'])('does not inherit from a %s parent', (inactiveFlag) => {
    const inactiveParent = { ...parent, [inactiveFlag]: true };
    expect(buildHabitColorMap([inactiveParent, child]).get(child.id)).toBe('#3b82f6');
  });

  it('uses the full manager lookup when the view displays only a child', () => {
    const manager = {
      getHabits: () => [parent, child],
      getEffectiveParentId: id => id === child.id ? parent.id : null,
    };
    const colors = buildHabitColorMap([child], manager);
    expect(colors.get(child.id)).toBe('#f43f5e');
    expect([...colors.keys()]).toEqual([child.id]);
  });

  it('uses domain hierarchy rather than a stale raw parent ID', () => {
    const effectiveParent = { id: 'effective-parent', color: 'green' };
    const manager = {
      getHabits: () => [parent, effectiveParent, child],
      getEffectiveParentId: id => id === child.id ? effectiveParent.id : null,
    };
    expect(buildHabitColorMap([child], manager).get(child.id)).toBe('#10b981');
  });

  it('honors a null effective parent even when a raw parent is still present', () => {
    const manager = {
      getHabits: () => [parent, child],
      getEffectiveParentId: () => null,
    };
    expect(buildHabitColorMap([child], manager).get(child.id)).toBe('#3b82f6');
  });

  it('guards corrupt self-parent and cyclic records without unbounded recursion', () => {
    const selfParent = { id: 'self', color: 'green', parentId: 'self' };
    const cyclicA = { id: 'a', color: 'rose', parentId: 'b' };
    const cyclicB = { id: 'b', color: 'blue', parentId: 'a' };
    const colors = buildHabitColorMap([selfParent, cyclicA, cyclicB]);
    expect(colors.get(selfParent.id)).toBe('#10b981');
    expect(colors.size).toBe(3);
    expect(['#f43f5e', '#3b82f6']).toContain(colors.get(cyclicA.id));
    expect(['#f43f5e', '#3b82f6']).toContain(colors.get(cyclicB.id));
  });

  it('previews attaching, changing, and detaching a draft parent before persistence', () => {
    const greenParent = { id: 'green-parent', color: 'green', parentId: null };
    const manager = { getActiveHabits: () => [parent, child, greenParent] };
    const draft = { selectedColor: 'blue', selectedParentId: parent.id };
    expect(getFormHabitColorHex(draft, child, manager)).toBe('#f43f5e');

    draft.selectedParentId = greenParent.id;
    expect(getFormHabitColorHex(draft, child, manager)).toBe('#10b981');

    draft.selectedParentId = null;
    expect(getFormHabitColorHex(draft, child, manager)).toBe('#3b82f6');

    draft.selectedColor = 'pink';
    expect(getFormHabitColorHex(draft, child, manager)).toBe('#ec4899');
    expect(child.parentId).toBe(parent.id);
    expect(child.color).toBe('blue');
  });

  it('keeps an archived or absent draft parent from replacing the selected color', () => {
    const draft = { selectedColor: 'blue', selectedParentId: parent.id };
    const manager = { getActiveHabits: () => [child] };
    expect(getFormHabitColorHex(draft, child, manager)).toBe('#3b82f6');
  });

  it('passes identity through one CSS scope without painting inline properties', () => {
    const row = document.createElement('div');
    applyHabitColor(row, 'rose');
    expect(row.classList.contains('dh-habit-color-scope')).toBe(true);
    expect(row.style.getPropertyValue('--habit-color')).toBe('#f43f5e');
    expect(row.style.backgroundColor).toBe('');
    expect(row.style.color).toBe('');
    expect(row.style.borderColor).toBe('');
    expect(row.style.boxShadow).toBe('');
  });
});
