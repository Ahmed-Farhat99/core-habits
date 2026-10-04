import { NoticeService } from '../../services/NoticeService.js';
import { CollapseButton } from './CollapseButton.js';

const stores = new WeakMap();
let nextRowId = 0;

function storeFor(plugin) {
  if (!stores.has(plugin)) stores.set(plugin, { queue: Promise.resolve(), scopes: new Set(), pending: [] });
  return stores.get(plugin);
}

/** Shared disclosure behavior for wide, compact and settings rows. */
export class GroupCollapseController {
  static findButton(container, id) {
    return Array.from(container.querySelectorAll("[data-collapse-id]"))
      .find(button => button.getAttribute("data-collapse-id") === id);
  }

  static setGroup(container, id, collapsed, t, childRows = null) {
    const rows = childRows || Array.from(container.querySelectorAll(".habit-row-child[data-group-id]"))
      .filter(row => row.getAttribute("data-group-id") === id);
    for (const row of rows) {
      if (!row.id) row.id = `dh-child-row-${++nextRowId}`;
      row.hidden = collapsed;
    }
    const button = this.findButton(container, id);
    if (button) CollapseButton.update(button, collapsed, t, rows);
  }

  static setAll(container, ids, collapsed, t) {
    for (const id of ids) this.setGroup(container, id, collapsed, t);
  }

  static sync(plugin) {
    const store = storeFor(plugin);
    for (const entry of store.scopes) {
      const scope = entry.ref.deref();
      if (!scope) { store.scopes.delete(entry); continue; }
      for (const button of scope.querySelectorAll("[data-collapse-id]")) {
        const id = button.getAttribute("data-collapse-id");
        let collapsed = (plugin.settings.collapsedGroups || []).includes(id);
        for (const intent of store.pending) if (intent.ids.includes(id)) collapsed = intent.collapsed;
        this.setGroup(scope, id, collapsed, entry.t);
        const busy = store.pending.some(intent => intent.ids.includes(id));
        button.disabled = busy;
        if (busy) button.setAttribute("aria-busy", "true");
        else button.removeAttribute("aria-busy");
      }
      scope.dispatchEvent(new Event("dh-group-state-changed", { bubbles: true }));
    }
  }

  /** Serializes writes, keeps other views in sync, and rolls back failed saves. */
  static persist(plugin, ids, collapsed) {
    const store = storeFor(plugin);
    const intent = { ids: [...ids], collapsed };
    store.pending.push(intent);
    this.sync(plugin);
    const operation = store.queue.then(async () => {
      const previous = [...(plugin.settings.collapsedGroups || [])];
      const groups = new Set(previous);
      for (const id of ids) { if (collapsed) groups.add(id); else groups.delete(id); }
      plugin.settings.collapsedGroups = [...groups];
      this.sync(plugin);
      try { await plugin.saveSettings({ silent: true }); }
      catch (error) {
        plugin.settings.collapsedGroups = previous;
        throw error;
      } finally {
        store.pending = store.pending.filter(pending => pending !== intent);
        this.sync(plugin);
      }
    });
    store.queue = operation.catch(() => {});
    return operation;
  }

  static wire(container, childRowsMap, { collapsedGroups = [], t, onToggle, plugin = null }) {
    if (!container || !childRowsMap) return;
    if (plugin) storeFor(plugin).scopes.add({ ref: new WeakRef(container), t });
    childRowsMap.forEach((rows, id) => {
      const button = this.findButton(container, id);
      if (!button) return;
      this.setGroup(container, id, collapsedGroups.includes(id), t, rows);
      button.onclick = async event => {
        event.stopPropagation();
        const previous = CollapseButton.isCollapsed(button);
        this.setGroup(container, id, !previous, t, rows);
        container.dispatchEvent(new Event("dh-group-state-changed", { bubbles: true }));
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        try {
          if (onToggle) await onToggle(id, !previous);
          else if (plugin) await this.persist(plugin, [id], !previous);
        } catch (error) {
          if (plugin) this.sync(plugin);
          else this.setGroup(container, id, previous, t, rows);
          NoticeService.error(t?.("notice_error_prefix", { message: error.message }) || error.message, plugin);
        } finally {
          if (plugin) this.sync(plugin);
          else {
            button.disabled = false;
            button.removeAttribute("aria-busy");
          }
          container.dispatchEvent(new Event("dh-group-state-changed", { bubbles: true }));
        }
      };
    });
  }
}
