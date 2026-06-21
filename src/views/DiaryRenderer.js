import { MarkdownRenderer } from 'obsidian';
import { normalizeReflectionType, REFLECTION_ENTRY_TYPES } from '../constants.js';
import { Utils } from '../utils/Utils.js';
import { ReflectionPopup } from '../modals/ReflectionPopup.js';
import { getNoteByDate, injectReflectionIntoDailyNote, fixAudioDuration, DateUtils } from '../utils/helpers.js';

export class DiaryRenderer {
  constructor(view) {
    this.view = view;
    this.app = view.app;
    this.plugin = view.plugin;
  }

  async readWeeklyDiaryEntries() {
    const entries = [];
    this.view.dailyReflectionDays = this.view.dailyReflectionDays || new Set();
    this.view.dailyReflectionDays.clear();
    this.view.activeFilePaths = this.view.activeFilePaths || new Set();
    this.view.activeFilePaths.clear();

    for (let i = 0; i < 7; i++) {
      const dayDate = this.view.currentWeekStart.clone().add(i, "days");
      const dailyNote = await getNoteByDate(this.app, dayDate, false, this.plugin.settings);
      if (!dailyNote) continue;

      try {
        const content = await this.app.vault.cachedRead(dailyNote);
        this.view.activeFilePaths.add(dailyNote.path);
        const dayEntries = this.view.parseDailyReflectionEntries(content, dayDate, dailyNote.path);
        if (dayEntries.length > 0) {
          this.view.dailyReflectionDays.add(DateUtils.formatDateKey(dayDate));
          entries.push(...dayEntries);
        }
      } catch (e) {
        Utils.debugLog(this.plugin, "Failed to read diary daily note", dailyNote.path, e);
      }
    }

    return entries.sort((a, b) => b.timestamp - a.timestamp);
  }

  openReflectionPopup(dayDate) {
    const dateKey = DateUtils.formatDateKey(dayDate);
    new ReflectionPopup(this.app, this.plugin, dayDate, async (text, type) => {
      const savedFile = await injectReflectionIntoDailyNote(this.app, this.plugin, dayDate, text, type);
      this.view.dailyReflectionDays.add(dateKey);
      setTimeout(() => this.view.renderWeeklyGrid(), 0);
      return savedFile;
    }).open();
  }

  renderDiaryEntryCard(parent, entry, isAr) {
    const typeMeta = this.view.getReflectionTypeMeta(entry.type, isAr);
    const entryCard = parent.createDiv({ cls: `dh-diary-entry-card type-${typeMeta.cls}` });

    const cardHeader = entryCard.createDiv({ cls: "entry-card-header" });
    const datePart = cardHeader.createDiv({ cls: "entry-date-part" });
    datePart.createSpan({ cls: "entry-day", text: entry.moment.clone().locale(isAr ? "ar" : "en").format("dddd") });
    datePart.createSpan({ cls: "entry-date", text: entry.moment.clone().locale(isAr ? "ar" : "en").format("D MMMM") });

    const badgePart = cardHeader.createDiv({ cls: "entry-badge-part" });
    badgePart.createSpan({ cls: `entry-type-badge type-${typeMeta.cls}`, text: typeMeta.label });
    if (entry.time) {
      badgePart.createSpan({ cls: "entry-time-badge", text: entry.time });
    }

    const bodyEl = entryCard.createDiv({ cls: "entry-card-body" });
    const allWebmMatches = [...entry.text.matchAll(/!\[\[([^\]]+\.webm)\]\]/gi)];

    if (allWebmMatches.length > 0) {
      let remainingText = entry.text;
      allWebmMatches.forEach(webmMatch => {
        remainingText = remainingText.replace(webmMatch[0], "");
        const fileName = webmMatch[1];
        const audioFile = this.app.metadataCache.getFirstLinkpathDest(fileName, "");
        if (audioFile) {
          const src = this.app.vault.getResourcePath(audioFile);
          const audioEl = bodyEl.createEl("audio", { attr: { controls: true, src: src } });
          fixAudioDuration(audioEl);
          audioEl.style.width = "100%";
          audioEl.style.height = "36px";
          audioEl.style.marginTop = "4px";
          audioEl.style.borderRadius = "8px";
          audioEl.onclick = (e) => e.stopPropagation();
        }
      });
      remainingText = remainingText.trim();
      if (remainingText) {
        bodyEl.createDiv({ text: remainingText, cls: "entry-action-text", attr: { style: "margin-top: 6px;" } });
      }
    } else if (entry.text.includes("![[")) {
      MarkdownRenderer.renderMarkdown(entry.text, bodyEl, entry.path || "", this.view);
    } else {
      bodyEl.setText(entry.text);
    }

    entryCard.onclick = async () => {
      const dailyNote = await getNoteByDate(this.app, entry.moment, false, this.plugin.settings);
      if (dailyNote) {
        await this.app.workspace.getLeaf(false).openFile(dailyNote);
      }
    };
  }

  renderDiaryTypeSections(container, entries, isAr) {
    REFLECTION_ENTRY_TYPES.forEach(type => {
      const typeMeta = this.view.getReflectionTypeMeta(type, isAr);
      const typeEntries = entries
        .filter(entry => normalizeReflectionType(entry.type) === type)
        .sort((a, b) => b.timestamp - a.timestamp);

      if (typeEntries.length === 0) return;

      const typeSection = container.createEl("details", {
        cls: `dh-diary-week-section dh-diary-type-section type-${typeMeta.cls}`,
        attr: { open: "true" }
      });
      const typeHeader = typeSection.createEl("summary", { cls: `dh-diary-week-header dh-diary-type-header type-${typeMeta.cls}` });

      const titleWrap = typeHeader.createDiv({ cls: "week-title-wrap" });
      titleWrap.createSpan({ cls: `dh-type-dot type-${typeMeta.cls}` });
      titleWrap.createSpan({ cls: "week-title", text: typeMeta.label });

      const metaWrap = typeHeader.createDiv({ cls: "week-meta-wrap" });
      metaWrap.createSpan({ cls: "entry-count", text: isAr ? `${typeEntries.length} تدوينة` : `${typeEntries.length} entries` });

      const entriesList = typeSection.createDiv({ cls: "dh-diary-entries-list" });
      typeEntries.forEach(entry => this.renderDiaryEntryCard(entriesList, entry, isAr));
    });
  }

  async render(container) {
    container.addClass("dh-diary-view-container");
    const isAr = this.plugin.settings.language === "ar";
    const weekEnd = this.view.currentWeekStart.clone().add(6, "days");
    const entries = await this.readWeeklyDiaryEntries();

    const toolbar = container.createDiv({ cls: "dh-diary-toolbar" });
    const titleWrap = toolbar.createDiv({ cls: "dh-diary-title-wrap" });
    titleWrap.createDiv({
      cls: "dh-diary-title",
      text: isAr ? "يوميات الأسبوع" : "Weekly diary",
    });
    titleWrap.createDiv({
      cls: "dh-diary-range",
      text: isAr
        ? `${this.view.currentWeekStart.clone().locale("ar").format("D MMMM")} - ${weekEnd.clone().locale("ar").format("D MMMM")}`
        : `${this.view.currentWeekStart.clone().locale("en").format("D MMM")} - ${weekEnd.clone().locale("en").format("D MMM")}`,
    });

    const actions = toolbar.createDiv({ cls: "dh-diary-actions" });
    const todayBtn = actions.createEl("button", {
      cls: "dh-diary-add-btn",
      text: isAr ? "تدوينة اليوم" : "Today entry",
    });
    todayBtn.onclick = () => this.openReflectionPopup(window.moment());

    const modeSwitch = actions.createEl("select", { cls: "dh-diary-mode-select dropdown" });
    [
      { id: "grouped", label: isAr ? "حسب الأيام" : "Grouped" },
      { id: "timeline", label: isAr ? "خط زمني" : "Timeline" },
      { id: "types", label: isAr ? "حسب النوع" : "By type" },
    ].forEach(mode => {
      const option = modeSwitch.createEl("option", {
        value: mode.id,
        text: mode.label,
      });
      if (this.view.diaryViewMode === mode.id) option.selected = true;
    });
    modeSwitch.onchange = async (e) => {
      const newMode = e.target.value;
      if (this.view.diaryViewMode === newMode) return;
      this.view.diaryViewMode = newMode;
      this.plugin.settings.diaryViewMode = newMode;
      await this.plugin.saveSettings({ silent: true });
      await this.view.renderWeeklyGrid();
    };

    if (entries.length === 0) {
      const emptyState = container.createDiv({ cls: "dh-diary-empty-state" });
      emptyState.createEl("h3", { text: isAr ? "لا توجد تدوينات في هذا الأسبوع" : "No entries this week" });
      emptyState.createEl("p", { text: isAr ? "اكتب تدوينة اليوم من الزر بالأعلى. سيتم حفظها داخل ملف اليوم نفسه." : "Use the button above. Entries are saved inside the matching Daily Note." });
      return;
    }

    if (this.view.diaryViewMode === "timeline") {
      const list = container.createDiv({ cls: "dh-diary-entries-list dh-diary-timeline-list" });
      entries.forEach(entry => this.renderDiaryEntryCard(list, entry, isAr));
      return;
    }

    if (this.view.diaryViewMode === "types") {
      this.renderDiaryTypeSections(container, entries, isAr);
      return;
    }

    for (let i = 0; i < 7; i++) {
      const dayDate = this.view.currentWeekStart.clone().add(i, "days");
      const dateKey = DateUtils.formatDateKey(dayDate);
      const dayEntries = entries
        .filter(entry => entry.dateKey === dateKey)
        .sort((a, b) => a.timestamp - b.timestamp);
      if (dayEntries.length === 0) continue;

      const isOpen = dayDate.isSame(window.moment(), "day");
      const daySection = container.createEl("details", {
        cls: "dh-diary-week-section",
        attr: isOpen ? { open: "true" } : {}
      });
      const dayHeader = daySection.createEl("summary", { cls: "dh-diary-week-header" });
      const titleWrap = dayHeader.createDiv({ cls: "week-title-wrap" });
      titleWrap.createSpan({ cls: "week-icon", text: "📅" });
      titleWrap.createSpan({
        cls: "week-title",
        text: dayDate.clone().locale(isAr ? "ar" : "en").format(isAr ? "dddd، D MMMM" : "dddd, D MMMM"),
      });

      const metaWrap = dayHeader.createDiv({ cls: "week-meta-wrap" });
      metaWrap.createSpan({ cls: "entry-count", text: isAr ? `${dayEntries.length} تدوينة` : `${dayEntries.length} entries` });
      const addDayBtn = metaWrap.createEl("button", {
        cls: "dh-diary-day-add-btn",
        text: "+",
        title: isAr ? "إضافة تدوينة لهذا اليوم" : "Add entry for this day",
      });
      addDayBtn.onclick = (e) => {
        e.stopPropagation();
        this.openReflectionPopup(dayDate);
      };

      const entriesList = daySection.createDiv({ cls: "dh-diary-entries-list" });
      dayEntries.forEach(entry => this.renderDiaryEntryCard(entriesList, entry, isAr));
    }
  }
}
