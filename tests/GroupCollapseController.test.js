import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupCollapseController } from '../src/components/ui/GroupCollapseController.js';
import { CollapseButton } from '../src/components/ui/CollapseButton.js';
import { GridInteractionHelper } from '../src/views/grid/GridInteractionHelper.js';

const t = key => key;
function scope(plugin, ids = ['parent']) {
  const container = document.createElement('div');
  container.className = 'daily-habits-plugin';
  document.body.append(container);
  const children = new Map();
  for (const id of ids) {
    CollapseButton.create(container, { habitId: id, isCollapsed: false, t });
    const row = container.createDiv({ cls: 'dh-habit habit-row habit-row-child', attr: { 'data-group-id': id } });
    children.set(id, [row]);
  }
  GroupCollapseController.wire(container, children, { plugin, collapsedGroups: plugin.settings.collapsedGroups, t });
  return { container, children, button: id => GroupCollapseController.findButton(container, id) };
}
function plugin() { return { settings: { collapsedGroups: [] }, saveSettings: vi.fn().mockResolvedValue(undefined) }; }

describe('shared collapse state and persistence', () => {
  beforeEach(() => document.body.replaceChildren());

  it('uses native hidden and uniquely relates disclosures to child rows in every view', () => {
    const p = plugin(); p.settings.collapsedGroups = ['parent'];
    const views = [scope(p), scope(p), scope(p)];
    const ids = views.map(view => view.children.get('parent')[0].id);
    expect(new Set(ids).size).toBe(3);
    for (const view of views) {
      const child = view.children.get('parent')[0];
      expect(child.hidden).toBe(true);
      expect(child.style.display).toBe('');
      expect(view.button('parent').getAttribute('aria-controls')).toBe(child.id);
      expect(view.button('parent').getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('synchronizes the pending state and save rollback across wide, compact and settings scopes', async () => {
    const p = plugin();
    let rejectSave;
    p.saveSettings.mockImplementation(() => new Promise((_, reject) => { rejectSave = reject; }));
    const views = [scope(p), scope(p), scope(p)];
    const clicked = views[0].button('parent');
    const operation = clicked.onclick(new MouseEvent('click'));
    for (const view of views) {
      expect(view.children.get('parent')[0].hidden).toBe(true);
      expect(view.button('parent').disabled).toBe(true);
    }
    await Promise.resolve();
    rejectSave(new Error('disk full'));
    await operation;
    expect(p.settings.collapsedGroups).toEqual([]);
    for (const view of views) {
      expect(view.children.get('parent')[0].hidden).toBe(false);
      expect(view.button('parent').getAttribute('aria-expanded')).toBe('true');
      expect(view.button('parent').disabled).toBe(false);
    }
  });

  it('does not lose an unrelated queued intent when the earlier save fails', async () => {
    const p = plugin(); let rejectFirst;
    p.saveSettings.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce(undefined);
    const view = scope(p, ['a', 'b']);
    const first = GroupCollapseController.persist(p, ['a'], true);
    const rejected = expect(first).rejects.toThrow('disk full');
    const second = GroupCollapseController.persist(p, ['b'], true);
    expect(view.children.get('a')[0].hidden).toBe(true);
    expect(view.children.get('b')[0].hidden).toBe(true);
    await Promise.resolve();
    expect(p.saveSettings).toHaveBeenCalledTimes(1);
    rejectFirst(new Error('disk full'));
    await rejected; await second;
    expect(p.settings.collapsedGroups).toEqual(['b']);
    expect(view.children.get('a')[0].hidden).toBe(false);
    expect(view.children.get('b')[0].hidden).toBe(true);
    expect(p.saveSettings).toHaveBeenCalledTimes(2);
  });

  it('keeps the bulk label immediate and rolls back the bulk DOM after a failed save', async () => {
    const p = plugin(); p.saveSettings.mockRejectedValue(new Error('disk full'));
    const view = scope(p, ['a', 'b']);
    const bulk = GridInteractionHelper.createBulkCollapseButton(view.container, view.container, ['a', 'b'], {
      settings: p.settings, t,
      onToggle: (ids, collapsed) => GroupCollapseController.persist(p, ids, collapsed),
    });
    const operation = bulk.onclick(new MouseEvent('click'));
    expect(bulk.getAttribute('aria-label')).toBe('grid_expand_groups');
    expect(view.children.get('a')[0].hidden).toBe(true);
    await operation;
    expect(bulk.getAttribute('aria-label')).toBe('grid_collapse_groups');
    expect(view.children.get('a')[0].hidden).toBe(false);
    expect(view.children.get('b')[0].hidden).toBe(false);
    expect(p.settings.collapsedGroups).toEqual([]);
  });

  it('does not derive disclosure state from an externally changed aria-expanded value', async () => {
    const p = plugin(); const view = scope(p);
    const button = view.button('parent');
    button.setAttribute('aria-expanded', 'false');
    await button.onclick(new MouseEvent('click'));
    expect(p.settings.collapsedGroups).toEqual(['parent']);
    expect(view.children.get('parent')[0].hidden).toBe(true);
  });
});
