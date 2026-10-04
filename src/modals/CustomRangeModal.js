import { BaseHabitModal } from './BaseHabitModal.js';
import { DateUtils } from '../utils/helpers.js';

export class CustomRangeModal extends BaseHabitModal {
  constructor(app, plugin, initialStart, initialEnd, onApply) {
    super(app, plugin);
    this.initialStart = initialStart ? initialStart.clone() : window.moment().subtract(27, "days");
    this.initialEnd = initialEnd ? initialEnd.clone() : window.moment();
    this.onApply = onApply;
  }

  onOpen() {
    super.onOpen();
    const { contentEl, modalEl } = this;
    const t = (k, params = {}) => this.plugin.translationManager.t(k, params);

    contentEl.addClass("daily-habits-modal");
    contentEl.addClass("dh-popup-compact");
    contentEl.addClass("dh-custom-range-modal");
    modalEl.addClass("dh-popup-modal-parent");

    // Header
    const header = contentEl.createDiv({ cls: "dh-popup-header" });
    header.createSpan({ cls: "dh-popup-header-icon", text: "📅" });
    const headerText = header.createDiv({ cls: "dh-popup-header-text" });
    headerText.createDiv({ cls: "dh-popup-title", text: t("custom_range_title") });

    // Quick Shortcuts Row
    const shortcutsWrap = contentEl.createDiv({ cls: "dh-range-shortcuts" });
    const shortcuts = [
      {
        label: t("quick_this_month"),
        getRange: () => [window.moment().startOf("month"), window.moment().endOf("month")]
      },
      {
        label: t("quick_last_month"),
        getRange: () => [
          window.moment().subtract(1, "month").startOf("month"),
          window.moment().subtract(1, "month").endOf("month")
        ]
      },
      {
        label: t("quick_last_28_days") || (t("direction") === "rtl" ? "آخر 28 يوماً (4 أسابيع)" : "Last 28 Days (4 Weeks)"),
        getRange: () => [window.moment().subtract(27, "days"), window.moment()]
      },
      {
        label: t("quick_this_year"),
        getRange: () => [window.moment().startOf("year"), window.moment().endOf("year")]
      }
    ];

    // Inputs Row
    const inputsRow = contentEl.createDiv({ cls: "dh-range-inputs-row" });

    // Start Date
    const startGroup = inputsRow.createDiv({ cls: "dh-range-input-group" });
    startGroup.createEl("label", { text: t("custom_range_start") });
    const startInput = startGroup.createEl("input", {
      type: "date",
      cls: "dh-range-date-input",
      value: DateUtils.formatDateKey(this.initialStart)
    });

    // End Date
    const endGroup = inputsRow.createDiv({ cls: "dh-range-input-group" });
    endGroup.createEl("label", { text: t("custom_range_end") });
    const endInput = endGroup.createEl("input", {
      type: "date",
      cls: "dh-range-date-input",
      value: DateUtils.formatDateKey(this.initialEnd)
    });

    // Wire up quick shortcuts
    shortcuts.forEach(sc => {
      const btn = shortcutsWrap.createEl("button", {
        cls: "dh-btn dh-range-shortcut-btn",
        text: sc.label
      });
      btn.onclick = () => {
        const [s, e] = sc.getRange();
        startInput.value = DateUtils.formatDateKey(s);
        endInput.value = DateUtils.formatDateKey(e);
      };
    });

    // Validation Error container
    const errorEl = contentEl.createDiv({ cls: "dh-range-error-msg" });
    errorEl.style.display = "none";

    // Footer Actions
    const footer = contentEl.createDiv({ cls: "dh-modal-actions dh-popup-footer-right" });

    const cancelBtn = footer.createEl("button", {
      text: t("custom_range_cancel"),
      cls: "dh-btn mod-cancel",
      type: "button"
    });

    const applyBtn = footer.createEl("button", {
      text: t("custom_range_apply"),
      cls: "dh-btn mod-cta",
      type: "button"
    });

    contentEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        applyBtn.click();
      }
    });

    applyBtn.onclick = () => {
      const sVal = startInput.value;
      const eVal = endInput.value;

      const isAr = t("direction") === "rtl";
      if (!sVal || !eVal) {
        errorEl.textContent = t("custom_range_error_empty") || (isAr ? "يرجى تحديد كلا التاريخين" : "Please choose both dates");
        errorEl.style.display = "block";
        return;
      }

      let sMoment = window.moment(sVal, "YYYY-MM-DD");
      let eMoment = window.moment(eVal, "YYYY-MM-DD");

      if (!sMoment.isValid() || !eMoment.isValid()) {
        errorEl.textContent = t("custom_range_error_invalid") || (isAr ? "التواريخ المحددة غير صالحة" : "Invalid dates selected");
        errorEl.style.display = "block";
        return;
      }

      if (eMoment.isBefore(sMoment, "day")) {
        const temp = sMoment;
        sMoment = eMoment;
        eMoment = temp;
      }

      this.close();
      if (this.onApply) {
        this.onApply(sMoment, eMoment);
      }
    };

    cancelBtn.onclick = () => {
      this.close();
    };
  }
}
