const moment = window.moment || globalThis.moment;

export const PERIOD_TYPES = {
  LAST_7_DAYS: "last_7_days",
  LAST_28_DAYS: "last_28_days",
  LAST_12_WEEKS: "last_12_weeks",
  THIS_YEAR: "this_year",
  CUSTOM: "custom",
};

export class StatsPeriod {
  /**
   * @param {string} type - One of PERIOD_TYPES
   * @param {Object} options
   * @param {moment.Moment} [options.anchorDate] - Base anchor date (defaults to today)
   * @param {number} [options.weekStartDay] - 0 (Sun) to 6 (Sat)
   * @param {moment.Moment} [options.customStartDate]
   * @param {moment.Moment} [options.customEndDate]
   * @param {number} [options.offset] - Navigation offset (0 = current, -1 = previous, +1 = next)
   */
  constructor(type = PERIOD_TYPES.LAST_28_DAYS, options = {}) {
    this.type = type;
    this.anchorDate = (options.anchorDate ? options.anchorDate.clone() : moment()).startOf("day");
    this.weekStartDay = typeof options.weekStartDay === "number" ? options.weekStartDay : 6;
    this.offset = options.offset || 0;
    this.customStartDate = options.customStartDate ? options.customStartDate.clone().startOf("day") : null;
    this.customEndDate = options.customEndDate ? options.customEndDate.clone().startOf("day") : null;

    this.calculateBounds();
  }

  calculateBounds() {
    const today = moment().startOf("day");

    switch (this.type) {
      case PERIOD_TYPES.LAST_7_DAYS: {
        const end = this.anchorDate.clone().add(this.offset * 7, "days");
        this.isOngoing = (this.offset === 0);
        this.endDate = end.isAfter(today) ? today.clone() : end;
        this.startDate = end.clone().subtract(6, "days");
        this.nominalEndDate = end;
        break;
      }

      case PERIOD_TYPES.LAST_28_DAYS: {
        const end = this.anchorDate.clone().add(this.offset * 28, "days");
        this.isOngoing = (this.offset === 0);
        this.endDate = end.isAfter(today) ? today.clone() : end;
        this.startDate = end.clone().subtract(27, "days");
        this.nominalEndDate = end;
        break;
      }

      case PERIOD_TYPES.LAST_12_WEEKS: {
        const end = this.anchorDate.clone().add(this.offset * 84, "days");
        this.isOngoing = (this.offset === 0);
        this.endDate = end.isAfter(today) ? today.clone() : end;
        this.startDate = end.clone().subtract(83, "days");
        this.nominalEndDate = end;
        break;
      }

      case PERIOD_TYPES.THIS_YEAR: {
        let start = this.anchorDate.clone().startOf("year");
        if (this.offset !== 0) {
          start.add(this.offset, "years").startOf("year");
        }
        const fullEnd = start.clone().endOf("year").startOf("day");
        this.startDate = start;
        this.isOngoing = (this.offset === 0) && fullEnd.isSameOrAfter(today);
        this.endDate = this.isOngoing ? today.clone() : fullEnd;
        this.nominalEndDate = fullEnd;
        break;
      }

      case PERIOD_TYPES.CUSTOM: {
        if (!this.customStartDate || !this.customEndDate) {
          this.startDate = this.anchorDate.clone().subtract(27, "days");
          this.endDate = this.anchorDate.clone();
        } else {
          this.startDate = this.customStartDate.clone();
          this.endDate = this.customEndDate.clone();
        }
        if (this.offset !== 0) {
          const span = this.endDate.diff(this.startDate, "days") + 1;
          this.startDate.add(this.offset * span, "days");
          this.endDate.add(this.offset * span, "days");
        }
        this.isOngoing = this.endDate.isSame(today, "day");
        this.nominalEndDate = this.endDate.clone();
        break;
      }

      default:
        this.startDate = this.anchorDate.clone().subtract(27, "days");
        this.endDate = this.anchorDate.clone();
        this.nominalEndDate = this.endDate.clone();
        this.isOngoing = false;
    }
  }

  /**
   * Calculates the equivalent, fair previous comparison period (Period-over-Period).
   * @returns {{ startDate: moment.Moment, endDate: moment.Moment, isEquivalentSlice: boolean }}
   */
  getComparisonPeriod() {
    switch (this.type) {
      case PERIOD_TYPES.LAST_7_DAYS: {
        const compEnd = this.startDate.clone().subtract(1, "days");
        const compStart = compEnd.clone().subtract(6, "days");
        return { startDate: compStart, endDate: compEnd, isEquivalentSlice: false };
      }

      case PERIOD_TYPES.LAST_28_DAYS: {
        const compEnd = this.startDate.clone().subtract(1, "days");
        const compStart = compEnd.clone().subtract(27, "days");
        return { startDate: compStart, endDate: compEnd, isEquivalentSlice: false };
      }

      case PERIOD_TYPES.LAST_12_WEEKS: {
        const compEnd = this.startDate.clone().subtract(1, "days");
        const compStart = compEnd.clone().subtract(83, "days");
        return { startDate: compStart, endDate: compEnd, isEquivalentSlice: false };
      }

      case PERIOD_TYPES.THIS_YEAR: {
        const elapsedDays = Math.max(1, this.endDate.diff(this.startDate, "days") + 1);
        const compStart = this.startDate.clone().subtract(1, "year").startOf("year");
        const compEnd = compStart.clone().add(elapsedDays - 1, "days");
        return { startDate: compStart, endDate: compEnd, isEquivalentSlice: this.isOngoing };
      }

      case PERIOD_TYPES.CUSTOM:
      default: {
        const elapsedDays = Math.max(1, this.endDate.diff(this.startDate, "days") + 1);
        const compEnd = this.startDate.clone().subtract(1, "days");
        const compStart = compEnd.clone().subtract(elapsedDays - 1, "days");
        return { startDate: compStart, endDate: compEnd, isEquivalentSlice: false };
      }
    }
  }

  /**
   * Whether this period type supports backward/forward calendar stepping.
   * All predefined periods support cyclical stepping.
   */
  supportsStepping() {
    return this.type !== PERIOD_TYPES.CUSTOM;
  }

  /**
   * Return the clean preset label for the dropdown button.
   */
  getPeriodName(isAr = true, t = null) {
    const tr = (k) => {
      if (typeof t === "function") {
        const res = t(k);
        if (typeof res === "string" && res !== k) return res;
      }
      return null;
    };

    if (isAr) {
      switch (this.type) {
        case PERIOD_TYPES.LAST_7_DAYS:
          if (this.offset === 0) return tr("stats_preset_last_7_days") || "آخر 7 أيام";
          if (this.offset === -1) return tr("stats_prev_week") || "الأسبوع السابق";
          return `${Math.abs(this.offset)} أسابيع سابقة`;

        case PERIOD_TYPES.LAST_28_DAYS:
          if (this.offset === 0) return tr("stats_preset_last_28_days") || "آخر 28 يوماً (4 أسابيع)";
          if (this.offset === -1) return tr("stats_prev_cycle") || "الدورة السابقة (4 أسابيع)";
          return `قبل ${Math.abs(this.offset)} دورات (28 يوماً)`;

        case PERIOD_TYPES.LAST_12_WEEKS:
          if (this.offset === 0) return tr("stats_preset_last_12_weeks") || "آخر 12 أسبوعاً (84 يوماً)";
          if (this.offset === -1) return tr("stats_prev_quarter") || "الفترة السابقة (12 أسبوعاً)";
          return `قبل ${Math.abs(this.offset)} ربع سنوي`;

        case PERIOD_TYPES.THIS_YEAR:
          if (this.offset === 0) return tr("stats_preset_this_year") || "هذا العام";
          if (this.offset === -1) return tr("stats_prev_year") || "العام الماضي";
          return `عام ${this.startDate.format("YYYY")}`;

        case PERIOD_TYPES.CUSTOM:
        default:
          return tr("stats_preset_custom") || tr("stats_period_custom") || "فترة مخصصة...";
      }
    } else {
      switch (this.type) {
        case PERIOD_TYPES.LAST_7_DAYS:
          if (this.offset === 0) return tr("stats_preset_last_7_days") || "Last 7 Days";
          if (this.offset === -1) return tr("stats_prev_week") || "Previous Week";
          return `${Math.abs(this.offset)} Weeks Ago`;

        case PERIOD_TYPES.LAST_28_DAYS:
          if (this.offset === 0) return tr("stats_preset_last_28_days") || "Last 28 Days (4 Weeks)";
          if (this.offset === -1) return tr("stats_prev_cycle") || "Previous Cycle (4 Weeks)";
          return `${Math.abs(this.offset)} Cycles Ago (28 Days)`;

        case PERIOD_TYPES.LAST_12_WEEKS:
          if (this.offset === 0) return tr("stats_preset_last_12_weeks") || "Last 12 Weeks (84 Days)";
          if (this.offset === -1) return tr("stats_prev_quarter") || "Previous 12 Weeks";
          return `${Math.abs(this.offset)} Quarters Ago`;

        case PERIOD_TYPES.THIS_YEAR:
          if (this.offset === 0) return tr("stats_preset_this_year") || "This Year";
          if (this.offset === -1) return tr("stats_prev_year") || "Last Year";
          return `Year ${this.startDate.format("YYYY")}`;

        case PERIOD_TYPES.CUSTOM:
        default:
          return tr("stats_preset_custom") || tr("stats_period_custom") || "Custom Range...";
      }
    }
  }

  /**
   * Return the formatted date range string.
   */
  getDateRangeString(isAr = true) {
    const loc = isAr ? "ar" : "en";
    const startM = this.startDate.clone().locale(loc);
    const endM = (this.nominalEndDate || this.endDate).clone().locale(loc);
    const yearM = this.startDate.format("YYYY");

    if (this.type === PERIOD_TYPES.THIS_YEAR) {
      return isAr ? `عام ${yearM}` : `Year ${yearM}`;
    }

    if (startM.month() === endM.month() && startM.year() === endM.year()) {
      return `${startM.format("D")} – ${endM.format("D MMMM YYYY")}`;
    }
    if (startM.year() === endM.year()) {
      return `${startM.format("D MMMM")} – ${endM.format("D MMMM YYYY")}`;
    }
    return `${startM.format("D MMMM YYYY")} – ${endM.format("D MMMM YYYY")}`;
  }

  /**
   * Return human-friendly description in natural Arabic or English.
   */
  getDisplayLabel(isAr = true) {
    const name = this.getPeriodName(isAr);
    const range = this.getDateRangeString(isAr);
    if (this.type === PERIOD_TYPES.THIS_YEAR) {
      return this.offset === 0 ? `${name} · ${range}` : range;
    }
    return `${name} · ${range}`;
  }

  /**
   * Create a new StatsPeriod shifted by offset delta.
   */
  shift(delta) {
    return new StatsPeriod(this.type, {
      anchorDate: this.anchorDate,
      weekStartDay: this.weekStartDay,
      customStartDate: this.customStartDate,
      customEndDate: this.customEndDate,
      offset: this.offset + delta,
    });
  }

  /**
   * Reset offset back to current date.
   */
  resetToCurrent() {
    return new StatsPeriod(this.type, {
      anchorDate: moment().startOf("day"),
      weekStartDay: this.weekStartDay,
      customStartDate: this.customStartDate,
      customEndDate: this.customEndDate,
      offset: 0,
    });
  }
}
