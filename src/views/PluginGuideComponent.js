import { setIcon } from 'obsidian';

class PluginGuideComponent {
  constructor(plugin) {
    this.plugin = plugin;
  }

  render(panel, t) {
    panel.empty();
    panel.addClass("dh-guide-panel");

    panel.createEl("h2", { text: t("tab_guide"), cls: "dh-guide-main-title" });

    // Helper for sections
    const createSection = (icon, titleKey) => {
      const section = panel.createDiv({ cls: "dh-guide-section" });
      const header = section.createDiv({ cls: "dh-guide-header" });
      const iconWrap = header.createDiv({ cls: "dh-guide-icon" });
      setIcon(iconWrap, icon);
      header.createEl("h3", { text: t(titleKey) });
      return section.createDiv({ cls: "dh-guide-content" });
    };

    // 1. How to Start
    const start = createSection("rocket", "guide_start_title");
    const startList = start.createEl("ol", { cls: "dh-guide-steps" });
    [
      t("guide_start_step1"),
      t("guide_start_step2"),
      t("guide_start_step3"),
      t("guide_start_step4")
    ].forEach(text => startList.createEl("li", { text }));

    // 2. Meaning of Symbols
    const symbols = createSection("info", "guide_symbols_title");
    const symbolsGrid = symbols.createDiv({ cls: "dh-guide-symbols-grid" });
    const createSymbol = (s, cls, descKey) => {
      const row = symbolsGrid.createDiv({ cls: "dh-guide-symbol-row" });
      row.createDiv({ cls: `day-cell dh-grid-cell ${cls}`, text: s });
      row.createDiv({ cls: "dh-guide-symbol-text", text: t(descKey) });
    };
    createSymbol("✓", "completed", "guide_symbols_completed");
    createSymbol("x", "missed", "guide_symbols_missed");
    createSymbol("⊘", "skipped", "guide_symbols_skipped");
    createSymbol("☐", "pending", "guide_symbols_pending");
    createSymbol("--", "not-scheduled", "guide_symbols_not_scheduled");

    // 3. Folders and Files
    const folders = createSection("folder-closed", "guide_folders_title");
    const foldersList = folders.createEl("ul", { cls: "dh-guide-steps" });
    [
      t("guide_folders_step1"),
      t("guide_folders_step2"),
      t("guide_folders_step3")
    ].forEach(text => foldersList.createEl("li", { text }));

    // 4. Gradation and Levels
    const levels = createSection("bar-chart", "guide_levels_title");
    const levelsList = levels.createEl("p", { cls: "dh-guide-text" });
    levelsList.textContent = t("guide_levels_desc");

    // 5. Parent and Child Habits
    const parentChild = createSection("network", "guide_parent_title");
    const parentList = parentChild.createEl("p", { cls: "dh-guide-text" });
    parentList.textContent = t("guide_parent_desc");

    // 6. Voice and Text Comments
    const comments = createSection("mic", "guide_comments_title");
    const commentsList = comments.createEl("p", { cls: "dh-guide-text" });
    commentsList.textContent = t("guide_comments_desc");

    // Footer Tip
    panel.createDiv({
      cls: "dh-guide-tip",
      text: t("guide_footer_tip")
    });
  }
}

export { PluginGuideComponent };