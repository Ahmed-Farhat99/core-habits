import { setIcon } from 'obsidian';
import { TooltipHelper } from '../../utils/TooltipHelper.js';

const states = new WeakMap();

/** Owns the disclosure's DOM, icon, accessible name and expanded state. */
export class CollapseButton {
  static create(container, { habitId, isCollapsed, t, onToggle = null }) {
    const button = container.createEl("button", {
      cls: "dh-collapse-btn",
      attr: { type: "button", "data-collapse-id": habitId },
    });
    setIcon(button, "chevron-down");
    this.update(button, isCollapsed, t);
    if (onToggle) button.onclick = event => {
      event.stopPropagation();
      onToggle(event);
    };
    return button;
  }

  static isCollapsed(button) { return states.get(button) === true; }

  static update(button, collapsed, t, rows = []) {
    states.set(button, collapsed);
    button.classList.toggle("is-collapsed", collapsed);
    button.setAttribute("aria-expanded", String(!collapsed));
    if (rows.length) button.setAttribute("aria-controls", rows.map(row => row.id).join(" "));
    const key = collapsed ? "grid_expand_children" : "grid_collapse_children";
    TooltipHelper.set(button, t?.(key) || (collapsed ? "Expand children" : "Collapse children"));
  }
}
