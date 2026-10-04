/** Apply one selection contract to tab buttons and their optional panels. */
export function selectTab(tabs, activeId, panels = null) {
  for (const [id, button] of Object.entries(tabs)) {
    const active = id === activeId;
    button.toggleClass("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && typeof button.scrollIntoView === "function") {
      try {
        button.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      } catch {
        // Fallback for test runners/environments without scrollIntoView
      }
    }
    const panel = panels?.[id];
    if (panel) {
      panel.toggleClass("is-active", active);
      panel.hidden = !active;
    }
  }
}

/** Arrow keys follow reading direction; Home and End select the edge tabs. */
export function bindTabKeys(tabList, tabs, onSelect) {
  tabList.addEventListener("keydown", (event) => {
    const ids = Object.keys(tabs);
    const index = ids.findIndex((id) => tabs[id] === event.target);
    if (index < 0) return;

    const rtl = tabList.closest('[dir="rtl"]') !== null;
    let next;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ids.length - 1;
    else if (event.key === "ArrowRight") next = (index + (rtl ? -1 : 1) + ids.length) % ids.length;
    else if (event.key === "ArrowLeft") next = (index + (rtl ? 1 : -1) + ids.length) % ids.length;
    else return;

    event.preventDefault();
    tabs[ids[next]].focus();
    onSelect(ids[next]);
  });
}
