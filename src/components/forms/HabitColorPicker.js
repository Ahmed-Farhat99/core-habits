/**
 * HabitColorPicker.js
 * Modular component for selecting habit color with clear parent inheritance feedback.
 */
import { HABIT_COLORS_PALETTE } from '../../constants.js';
import { buildHabitColorMap } from '../../utils/HabitColor.js';
import { TooltipHelper } from '../../utils/TooltipHelper.js';

export class HabitColorPicker {
  /**
   * @param {HTMLElement} container
   * @param {Object} options
   * @param {string} options.selectedColor - color id (e.g. 'teal')
   * @param {Object|null} options.parentHabit - parent habit object if child
   * @param {Function} options.onChange - (colorId: string) => void
   * @param {Function} options.t - Translation function
   */
  constructor(container, { selectedColor = "teal", parentHabit = null, onChange, t, habitManager = null }) {
    this.container = container;
    this.selectedColor = selectedColor || "teal";
    this.parentHabit = parentHabit;
    this.habitManager = habitManager;
    this.onChange = onChange;
    this.t = t;
    this.render();
  }

  setParentHabit(parentHabit) {
    this.parentHabit = parentHabit;
    this.render();
  }

  setSelectedColor(colorId) {
    this.selectedColor = colorId;
    this.render();
  }

  render() {
    this.container.empty();
    const group = this.container.createDiv({ cls: "form-group-clean dh-color-picker-group" });

    group.createEl("label", { text: this.t("color") || "Color", cls: "form-label-clean" });

    if (this.parentHabit) {
      // Inherited state
      const parentColorHex = buildHabitColorMap([this.parentHabit], this.habitManager).get(this.parentHabit.id);
      const inheritedCard = group.createDiv({ cls: "dh-color-inherited-card" });
      
      const swatch = inheritedCard.createDiv({ cls: "dh-color-swatch is-inherited" });
      swatch.style.setProperty("--swatch-color", parentColorHex);

      const textWrap = inheritedCard.createDiv({ cls: "dh-color-inherited-text" });
      const labelText = this.t("color_inherited_from_parent", { parent: this.parentHabit.name }) 
        || `Inherited from parent habit (${this.parentHabit.name})`;
      textWrap.createSpan({ text: labelText, cls: "dh-inherited-label" });
      return;
    }

    // Normal palette selection
    const colorRow = group.createDiv({ cls: "dh-color-swatches" });

    HABIT_COLORS_PALETTE.forEach(c => {
      const isSelected = this.selectedColor === c.id;
      const colorLabel = this.t(`color_${c.id}`) || c.id;
      
      const swatch = colorRow.createDiv({
        cls: `dh-color-swatch ${isSelected ? "is-active" : ""}`,
        attr: {
          "role": "button",
          "tabindex": "0",
          "aria-pressed": isSelected ? "true" : "false"
        }
      });
      TooltipHelper.set(swatch, colorLabel);

      swatch.style.setProperty("--swatch-color", c.hex);

      const selectColor = () => {
        this.selectedColor = c.id;
        colorRow.querySelectorAll(".dh-color-swatch").forEach(s => s.removeClass("is-active"));
        swatch.addClass("is-active");
        if (this.onChange) {
          this.onChange(this.selectedColor);
        }
      };

      swatch.onclick = selectColor;
      swatch.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectColor();
        }
      };
    });
  }

  getSelectedColor() {
    return this.selectedColor;
  }
}
