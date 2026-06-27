import { MarkdownRenderer } from 'obsidian';
import { normalizeReflectionType, REFLECTION_ENTRY_TYPES } from '../constants.js';
import { Utils } from '../utils/Utils.js';
import { StatusView } from './StatusView.js';
import { DateUtils } from '../utils/helpers.js';

export class DiaryRenderer {
  constructor(context) {
    this.context = context;
    this.app = context.app;
    this.plugin = context.plugin;
  }

  readWeeklyDiaryEntries() {
    return this.context.getWeeklyDiaryEntries();
  }

  openReflectionPopup(dayDate) {
    this.context.openReflectionPopup(dayDate);
  }

  getDiaryEntriesLabel(count) {
    const lang = this.plugin.settings.language || "ar";
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    if (lang !== "ar") {
      return count === 1 ? t("diary_count_one") : t("diary_count_other", { count });
    }
    if (count === 1) return t("diary_count_one");
    if (count === 2) return t("diary_count_two");
    if (count >= 3 && count <= 10) return t("diary_count_few", { count });
    return t("diary_count_many", { count });
  }

  renderDiaryEntryCard(parent, entry) {
    const lang = this.plugin.settings.language || "ar";
    const typeMeta = this.context.getReflectionTypeMeta(entry.type);
    const entryCard = parent.createDiv({ cls: `dh-card dh-diary-entry-card type-${typeMeta.cls}` });

    const cardHeader = entryCard.createDiv({ cls: "entry-card-header" });
    const datePart = cardHeader.createDiv({ cls: "entry-date-part" });
    datePart.createSpan({ cls: "entry-day", text: entry.moment.clone().locale(lang).format("dddd") });
    datePart.createSpan({ cls: "entry-date", text: entry.moment.clone().locale(lang).format(this.plugin.translationManager.t("date_format_medium")) });

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
          const audioEl = bodyEl.createEl("audio", {
            cls: "dh-diary-audio",
            attr: { controls: true, src: src }
          });
          Utils.fixAudioDuration(audioEl);
          audioEl.onclick = (e) => e.stopPropagation();
        }
      });
      remainingText = remainingText.trim();
      if (remainingText) {
        const actionTextEl = bodyEl.createDiv({ cls: "dh-diary-entry-action-text" });
        MarkdownRenderer.renderMarkdown(remainingText, actionTextEl, entry.path || "", this.context.getComponent());
      }
    } else {
      MarkdownRenderer.renderMarkdown(entry.text, bodyEl, entry.path || "", this.context.getComponent());
    }

    entryCard.onclick = () => {
      this.context.openDailyNote(entry.moment);
    };
  }

  renderDiaryTypeSections(container, entries) {
    REFLECTION_ENTRY_TYPES.forEach(type => {
      const typeMeta = this.context.getReflectionTypeMeta(type);
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
      metaWrap.createSpan({ cls: "entry-count", text: this.getDiaryEntriesLabel(typeEntries.length) });

      const entriesList = typeSection.createDiv({ cls: "dh-diary-entries-list" });
      typeEntries.forEach(entry => this.renderDiaryEntryCard(entriesList, entry));
    });
  }

  async render(container) {
    container.addClass("dh-diary-view-container");
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const lang = this.plugin.settings.language || "ar";
    const entries = this.readWeeklyDiaryEntries();

    const toolbar = container.createDiv({ cls: "dh-diary-toolbar" });
    const titleWrap = toolbar.createDiv({ cls: "dh-diary-title-wrap" });
    titleWrap.createDiv({
      cls: "dh-diary-title",
      text: t("diary_weekly_title"),
    });

    const actions = toolbar.createDiv({ cls: "dh-diary-actions" });
    const todayBtn = actions.createEl("button", {
      cls: "dh-btn dh-diary-add-btn mod-cta",
      text: t("diary_add_today_btn"),
    });
    todayBtn.onclick = () => this.openReflectionPopup(window.moment());

    const modeSwitch = actions.createEl("select", { cls: "dh-diary-mode-select dropdown" });
    [
      { id: "grouped", label: t("diary_mode_grouped") },
      { id: "timeline", label: t("diary_mode_timeline") },
      { id: "types", label: t("diary_mode_by_type") },
    ].forEach(mode => {
      const option = modeSwitch.createEl("option", {
        value: mode.id,
        text: mode.label,
      });
      if (this.context.getDiaryViewMode() === mode.id) option.selected = true;
    });
    modeSwitch.onchange = async (e) => {
      const newMode = e.target.value;
      if (this.context.getDiaryViewMode() === newMode) return;
      await this.context.setDiaryViewMode(newMode);
    };

    const bodyEl = container.createDiv({ cls: "dh-diary-body" });

    if (entries.length === 0) {
      StatusView.renderEmptyState(bodyEl, {
        icon: "📝",
        title: t("diary_empty_title"),
        description: t("diary_empty_desc")
      });
      return;
    }

    if (this.context.getDiaryViewMode() === "timeline") {
      const list = bodyEl.createDiv({ cls: "dh-diary-entries-list dh-diary-timeline-list" });
      entries.forEach(entry => this.renderDiaryEntryCard(list, entry));
      return;
    }

    if (this.context.getDiaryViewMode() === "types") {
      this.renderDiaryTypeSections(bodyEl, entries);
      return;
    }

    for (let i = 0; i < 7; i++) {
      const dayDate = this.context.getWeekStart().clone().add(i, "days");
      const dateKey = DateUtils.formatDateKey(dayDate);
      const dayEntries = entries
        .filter(entry => entry.dateKey === dateKey)
        .sort((a, b) => a.timestamp - b.timestamp);
      if (dayEntries.length === 0) continue;

      const isOpen = dayDate.isSame(window.moment(), "day");
      const daySection = bodyEl.createEl("details", {
        cls: "dh-diary-week-section",
        attr: isOpen ? { open: "true" } : {}
      });
      const dayHeader = daySection.createEl("summary", { cls: "dh-diary-week-header" });
      const titleWrap = dayHeader.createDiv({ cls: "week-title-wrap" });
      titleWrap.createSpan({ cls: "week-icon", text: "📅" });
      titleWrap.createSpan({
        cls: "week-title",
        text: dayDate.clone().locale(lang).format(t("date_format_diary_header")),
      });

      const metaWrap = dayHeader.createDiv({ cls: "week-meta-wrap" });
      metaWrap.createSpan({ cls: "entry-count", text: this.getDiaryEntriesLabel(dayEntries.length) });
      const addDayBtn = metaWrap.createEl("button", {
        cls: "dh-btn dh-diary-day-add-btn mod-icon",
        text: "+",
        title: t("diary_add_entry_tooltip"),
      });
      addDayBtn.onclick = (e) => {
        e.stopPropagation();
        this.openReflectionPopup(dayDate);
      };

      const entriesList = daySection.createDiv({ cls: "dh-diary-entries-list" });
      dayEntries.forEach(entry => this.renderDiaryEntryCard(entriesList, entry));
    }
  }
}
