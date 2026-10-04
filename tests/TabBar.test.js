import { describe, expect, it, vi } from 'vitest';
import { bindTabKeys, selectTab } from '../src/components/ui/TabBar.js';

function fixture(direction) {
  const root = document.body.appendChild(document.createElement('div'));
  root.dir = direction;
  const list = root.appendChild(document.createElement('div'));
  const first = list.appendChild(document.createElement('button'));
  const second = list.appendChild(document.createElement('button'));
  const third = list.appendChild(document.createElement('button'));
  const panels = {
    first: root.appendChild(document.createElement('div')),
    second: root.appendChild(document.createElement('div')),
    third: root.appendChild(document.createElement('div')),
  };
  return { list, tabs: { first, second, third }, panels };
}

describe('shared tab contract', () => {
  it('keeps visible panels, ARIA selection, and focus order aligned', () => {
    const { tabs, panels } = fixture('ltr');
    selectTab(tabs, 'second', panels);
    expect(tabs.first.getAttribute('aria-selected')).toBe('false');
    expect(tabs.first.tabIndex).toBe(-1);
    expect(panels.first.hidden).toBe(true);
    expect(tabs.second.getAttribute('aria-selected')).toBe('true');
    expect(tabs.second.tabIndex).toBe(0);
    expect(panels.second.hidden).toBe(false);
  });

  it.each([
    ['ltr', 'ArrowRight', 'second'],
    ['rtl', 'ArrowRight', 'third'],
    ['ltr', 'Home', 'first'],
    ['rtl', 'End', 'third'],
  ])('moves from the first tab in %s with %s', (direction, key, expected) => {
    const { list, tabs } = fixture(direction);
    const select = vi.fn();
    bindTabKeys(list, tabs, select);
    tabs.first.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    expect(select).toHaveBeenCalledWith(expected);
    expect(document.activeElement).toBe(tabs[expected]);
  });
});
