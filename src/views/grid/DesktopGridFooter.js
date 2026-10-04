import { setIcon } from 'obsidian';
import { DateUtils } from '../../utils/helpers.js';
import { TooltipHelper } from '../../utils/TooltipHelper.js';

export class DesktopGridFooter {
  /**
   * @param {object} context - WeeklyGridView context
   */
  constructor(context) {
    this.context = context;
    this.plugin = context.plugin;
  }

  /**
   * Renders the desktop grid footer row for daily reflection journals if enabled.
   * @param {HTMLElement} table
   * @returns {HTMLElement|null} tfoot element or null if feature disabled
   */
  renderFooter(table) {
    if (!this.plugin.settings.enableReflectionJournal) {
      return null;
    }

    const tfoot = table.createDiv({ cls: "habits-tfoot", attr: { role: "rowgroup" } });
    const footerRow = tfoot.createDiv({ cls: "dh-reflection-footer-row dh-grid-row diary-row", attr: { role: "row" } });
    
    // Index column placeholder
    footerRow.createDiv({ cls: "habit-index-header dh-grid-cell", attr: { role: "gridcell" } });
    
    // Diary Title column
    const titleCell = footerRow.createDiv({ cls: "dh-footer-title dh-grid-cell", attr: { role: "rowheader" } });
    const iconSpan = titleCell.createSpan();
    setIcon(iconSpan, "book-open");
    titleCell.createSpan({ text: this.plugin.translationManager.t("grid_diary_label") });
    
    const today = window.moment();
    for (let index = 0; index < 7; index++) {
      const dayCell = footerRow.createDiv({
        cls: "day-cell dh-grid-cell",
        attr: { "data-day-index": String(index), role: "gridcell" }
      });
      const dayDate = this.context.getWeekStart().clone().add(index, "days");
      const dateKey = DateUtils.formatDateKey(dayDate);
      
      if (!dayDate.isAfter(today, "day")) {
        const hasReflection = this.context.getReflectionDays()?.has(dateKey);
        const reflectionLabel = hasReflection
          ? this.plugin.translationManager.t("grid_diary_exists_tooltip")
          : this.plugin.translationManager.t("grid_diary_add_tooltip");
        const btn = dayCell.createEl("button", {
          cls: `dh-btn dh-footer-add-btn mod-icon ${hasReflection ? "has-reflection" : ""}`
        });
        TooltipHelper.set(btn, reflectionLabel);
        btn.textContent = "📝";
        
        btn.onclick = (e) => {
          e.stopPropagation();
          this.context.openReflectionPopup(dayDate);
        };
      }
    }
    return tfoot;
  }
}
