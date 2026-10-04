import { REFLECTION_ENTRY_TYPES } from '../constants.js';
import { BaseNoteEntryModal } from './BaseNoteEntryModal.js';
import { NoticeService } from '../services/NoticeService.js';

class ReflectionPopup extends BaseNoteEntryModal {
  constructor(app, plugin, date, onSave) {
    super(app, plugin, { date, onSave });
    this.selectedType = REFLECTION_ENTRY_TYPES[0];
    this.initialType = this.selectedType;
  }

  isDirty() {
    if (!this.inputEl) return false;
    const hasText = (this.inputEl.value || "").trim().length > 0;
    const typeChanged = this.selectedType !== this.initialType;
    return hasText || typeChanged;
  }

  onOpen() {
    super.onOpen();
    const { contentEl } = this;
    const t = (k, params = {}) => this.t(k, params);

    const dateStr = this.getFormattedDate("date_format_long");

    // Unified header row with Lucide icon
    this.createPopupHeader(contentEl, {
      iconName: "book-open",
      titleText: t("reflection_modal_title"),
      metaText: dateStr
    });

    // Unified Segmented Category Control
    const typeLabels = {
      Good: t("reflection_good") || "جيد",
      Bad: t("reflection_bad") || "سيء",
      Lesson: t("reflection_lesson") || "درس",
      Idea: t("reflection_idea") || "فكرة",
    };

    const categories = REFLECTION_ENTRY_TYPES.map((type) => ({
      key: type,
      label: typeLabels[type] || type
    }));

    this.createCategoryPicker(contentEl, {
      categories,
      selectedKey: this.selectedType,
      onSelect: (type) => {
        this.selectedType = type;
      }
    });

    this.createNoteInput(contentEl, {
      placeholder: t("reflection_notes_placeholder"),
      rows: 4
    });

    this.createPopupFooter(contentEl, {
      placeholderDefault: t("reflection_notes_placeholder"),
      cancelText: t("cancel"),
      saveText: t("reflection_save")
    });

    this.focusInput(50);
  }

  async handleSave(sanitized) {
    const savedFile = await this.onSave(sanitized, this.selectedType);
    NoticeService.success(this.t("reflection_save_success", { file: savedFile || "" }), { plugin: this.plugin });
  }
}

export { ReflectionPopup };