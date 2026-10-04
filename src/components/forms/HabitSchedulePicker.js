/**
 * HabitSchedulePicker.js
 * Modular component for selecting habit repetition schedule (Daily or Specific Days).
 */
export class HabitSchedulePicker {
  /**
   * @param {HTMLElement} container
   * @param {Object} options
   * @param {number[]} options.initialDays - e.g. [0, 1, 2, 3, 4, 5, 6]
   * @param {number} options.weekStartDay - 0..6
   * @param {Function} options.onChange - ({ type: 'daily'|'weekly', days: number[] }) => void
   * @param {Function} options.t - Translation function
   */
  constructor(container, { initialDays = [0, 1, 2, 3, 4, 5, 6], weekStartDay = 0, onChange, t }) {
    this.container = container;
    this.selectedDays = Array.isArray(initialDays) && initialDays.length > 0 ? [...initialDays] : [0, 1, 2, 3, 4, 5, 6];
    this.weekStartDay = weekStartDay;
    this.onChange = onChange;
    this.t = t;
    this.render();
  }

  render() {
    this.container.empty();
    const isAllDays = this.selectedDays.length === 7;
    const group = this.container.createDiv({ 
      cls: `form-group-clean dh-schedule-picker-group ${isAllDays ? "is-daily" : "is-specific"}` 
    });
    
    // Header with label and mode toggle
    const headerRow = group.createDiv({ cls: "dh-schedule-header-row" });
    headerRow.createEl("label", { text: this.t("schedule_days") || "Frequency", cls: "form-label-clean" });

    const modeToggle = headerRow.createDiv({ cls: "dh-schedule-mode-toggle" });

    const dailyBtn = modeToggle.createEl("button", {
      cls: `dh-btn dh-btn-xs ${isAllDays ? "is-active" : ""}`,
      text: this.t("schedule_daily") || "Daily",
      type: "button"
    });

    const customBtn = modeToggle.createEl("button", {
      cls: `dh-btn dh-btn-xs ${!isAllDays ? "is-active" : ""}`,
      text: this.t("schedule_specific") || "Specific days",
      type: "button"
    });

    dailyBtn.onclick = () => {
      this.selectedDays = [0, 1, 2, 3, 4, 5, 6];
      this.notifyChange();
      this.render();
    };

    customBtn.onclick = () => {
      if (this.selectedDays.length === 7) {
        // Default to work days or keep existing
        this.selectedDays = [0, 1, 2, 3, 4];
      }
      this.notifyChange();
      this.render();
    };

    // Days grid
    const daysPicker = group.createDiv({ cls: "days-picker-clean" });
    const dayGrid = daysPicker.createDiv({ cls: "days-grid-clean" });

    const dayLabels = {
      0: this.t("sun_short"),
      1: this.t("mon_short"),
      2: this.t("tue_short"),
      3: this.t("wed_short"),
      4: this.t("thu_short"),
      5: this.t("fri_short"),
      6: this.t("sat_short")
    };

    const displayOrder = Array.from({ length: 7 }, (_, i) => (this.weekStartDay + i) % 7);

    displayOrder.forEach((dayIndex) => {
      const isSelected = this.selectedDays.includes(dayIndex);
      const chip = dayGrid.createDiv({
        cls: `day-chip-clean ${isSelected ? "is-selected" : ""}`,
        text: dayLabels[dayIndex] || String(dayIndex),
        attr: { "role": "button", "tabindex": "0", "aria-pressed": isSelected ? "true" : "false" }
      });

      const toggleDay = () => {
        if (this.selectedDays.includes(dayIndex)) {
          if (this.selectedDays.length > 1) {
            this.selectedDays = this.selectedDays.filter((d) => d !== dayIndex);
          }
        } else {
          this.selectedDays.push(dayIndex);
        }
        this.notifyChange();
        this.render();
      };

      chip.onclick = toggleDay;
      chip.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleDay();
        }
      };
    });
  }

  notifyChange() {
    const isDaily = this.selectedDays.length === 7;
    if (this.onChange) {
      this.onChange({
        type: isDaily ? "daily" : "weekly",
        days: [...this.selectedDays]
      });
    }
  }

  getSelectedDays() {
    return [...this.selectedDays];
  }
}
