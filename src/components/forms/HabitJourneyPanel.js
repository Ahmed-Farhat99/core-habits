/**
 * HabitJourneyPanel.js
 * Chronological habit reflections, daily notes, and embedded voice recordings.
 * Groups entries into monthly collapsibles for maximum performance,
 * provides audio playback with Chromium duration fixes and mutual pause exclusion,
 * and allows instant note/voice recording via HabitCommentPopup.
 */
import { setIcon } from 'obsidian';
import { HabitCommentPopup } from '../../modals/HabitCommentPopup.js';
import { Utils } from '../../utils/Utils.js';
import { getNoteByDate } from '../../utils/helpers.js';
import { TooltipHelper } from '../../utils/TooltipHelper.js';

export class HabitJourneyPanel {
  /**
   * @param {HTMLElement} containerEl
   * @param {Object} options
   * @param {import('obsidian').App} options.app
   * @param {Object} options.plugin
   * @param {Object} options.habit
   * @param {Object} options.formState
   * @param {Function} options.t
   */
  constructor(containerEl, { app, plugin, habit, formState, initiallyOpen = false, t }) {
    this.containerEl = containerEl;
    this.app = app;
    this.plugin = plugin;
    this.habit = habit;
    this.formState = formState;
    this.initiallyOpen = initiallyOpen;
    this.t = t || ((k) => k);

    this.rootEl = null;
    this.entriesContainer = null;
    this.summaryBadge = null;
    this.audioElements = [];

    this.render();
  }

  render() {
    const wasOpen = this.detailsEl ? this.detailsEl.open : this.initiallyOpen;
    this.containerEl.empty();
    this.rootEl = this.containerEl.createDiv({ cls: "dh-journey-panel-wrap" });

    const isAr = !this.t || (this.t("direction") === "rtl");

    this.detailsEl = this.rootEl.createEl("details", { cls: "dh-journey-details" });
    this.detailsEl.open = wasOpen;

    const summaryEl = this.detailsEl.createEl("summary", { cls: "dh-journey-summary" });
    const titleSpan = summaryEl.createSpan({ cls: "dh-journey-summary-title" });
    titleSpan.createSpan({
      text: this.t("tab_reflections_diary") || (isAr ? "سجل الخواطر" : "Reflections Journal")
    });

    this.summaryBadge = summaryEl.createSpan({ cls: "dh-journey-summary-badge" });

    const contentWrapper = this.detailsEl.createDiv({ cls: "dh-journey-content-wrapper" });

    // 1. Streamlined Header Row with Compact Action Button
    const headerRow = contentWrapper.createDiv({ cls: "dh-journey-header-row" });
    const headerInfo = headerRow.createDiv({ cls: "dh-journey-header-info" });
    headerInfo.createSpan({
      cls: "dh-journey-header-desc",
      text: isAr ? "التدوينات والخواطر الصوتية" : "Reflections & Voice Notes"
    });

    const addNoteBtn = headerRow.createEl("button", {
      cls: "dh-btn mod-cta dh-journey-add-btn",
      type: "button"
    });
    addNoteBtn.createSpan({ text: "+ " });
    addNoteBtn.createSpan({ text: this.t("log_add_note_btn") || (isAr ? "تدوين خاطرة لليوم" : "Record reflection") });
    const micIcon = addNoteBtn.createSpan({ cls: "dh-btn-icon-suffix" });
    try { setIcon(micIcon, "mic"); } catch { micIcon.textContent = "🎙"; }

    addNoteBtn.onclick = () => {
      new HabitCommentPopup(
        this.app,
        this.plugin,
        this.habit || this.formState,
        window.moment(),
        async (text) => {
          if (this.plugin?.habitJournalService) {
            await this.plugin.habitJournalService.saveHabitComment(
              this.habit || this.formState,
              window.moment(),
              text
            );
          }
          await this.loadAndRenderEntries();
        }
      ).open();
    };

    // 2. Entries Container
    this.entriesContainer = contentWrapper.createDiv({ cls: "dh-journey-entries-container" });
    this.loadAndRenderEntries();
  }

  openDetails() {
    if (this.detailsEl) {
      this.detailsEl.open = true;
      if (typeof this.detailsEl.scrollIntoView === "function") {
        this.detailsEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }

  async loadAndRenderEntries() {
    if (!this.entriesContainer) return;
    this.entriesContainer.empty();

    const isAr = !this.t || (this.t("direction") === "rtl");
    const lang = this.plugin?.settings?.language || "ar";

    if (!this.plugin?.settings?.enableHabitContext) {
      this.entriesContainer.createDiv({
        cls: "dh-log-empty-state",
        text: this.t("habit_log_disabled") || (isAr ? "ميزة ملاحظات العادات معطلة في الإعدادات." : "Habit notes are disabled in settings.")
      });
      return;
    }

    this.entriesContainer.createDiv({
      cls: "dh-journey-loading-state",
      text: this.t("log_loading") || (isAr ? "جاري تحميل سجل الرحلة..." : "Loading journey logs...")
    });

    try {
      const habitObj = this.habit || this.formState;
      const habitName = habitObj?.linkText || habitObj?.name || this.formState?.name;

      if (!habitName || !this.plugin?.habitJournalService) {
        this.entriesContainer.empty();
        return;
      }

      const entries = await this.plugin.habitJournalService.getHabitCommentHistory(habitName, 365);
      this.entriesContainer.empty();
      this.cleanupAudio();

      if (this.summaryBadge) {
        const totalCount = entries ? entries.length : 0;
        if (totalCount > 0) {
          this.summaryBadge.textContent = `${totalCount} ${isAr ? (totalCount === 1 ? "خاطرة" : totalCount === 2 ? "خاطرتان" : "خواطر") : (totalCount === 1 ? "reflection" : "reflections")}`;
          this.summaryBadge.style.display = "inline-block";
        } else {
          this.summaryBadge.style.display = "none";
        }
      }

      if (!entries || entries.length === 0) {
        const emptyState = this.entriesContainer.createDiv({ cls: "dh-journey-empty-card" });
        const emptyIcon = emptyState.createSpan({ cls: "dh-empty-icon" });
        try { setIcon(emptyIcon, "book-open"); } catch { emptyIcon.textContent = ""; }
        emptyState.createEl("h4", {
          text: isAr ? "لا توجد خواطر مسجلة لهذه العادة بعد" : "No reflections recorded yet",
          cls: "dh-empty-title"
        });
        emptyState.createEl("p", {
          text: isAr ? "سجل أول فكرة أو خاطرة صوتية لتوثيق انطباعاتك ومسار تقدمك." : "Log your first thought or voice note to capture your journey.",
          cls: "dh-empty-desc"
        });

        const quickTriggerBtn = emptyState.createEl("button", {
          cls: "dh-btn dh-btn-empty-trigger",
          type: "button"
        });
        const triggerIcon = quickTriggerBtn.createSpan({ cls: "dh-btn-icon" });
        try { setIcon(triggerIcon, "mic"); } catch { /* ignore */ }
        quickTriggerBtn.createSpan({ text: isAr ? " تسجيل أول خاطرة" : " Record first reflection" });
        quickTriggerBtn.onclick = () => {
          const addBtn = this.rootEl?.querySelector(".dh-journey-add-btn");
          if (addBtn) addBtn.click();
        };
        return;
      }

      // Group entries by Month
      const grouped = {};
      entries.forEach(entry => {
        const monthKey = entry.date.clone().locale(lang).format("MMMM YYYY");
        if (!grouped[monthKey]) grouped[monthKey] = [];
        grouped[monthKey].push(entry);
      });

      Object.keys(grouped).forEach((monthKey, idx) => {
        const monthDetails = this.entriesContainer.createEl("details", { cls: "dh-log-month-group" });
        if (idx === 0) monthDetails.open = true; // Current month open by default

        const summary = monthDetails.createEl("summary", { cls: "dh-log-month-summary" });
        const titleWrap = summary.createDiv({ cls: "dh-month-title-wrap" });
        titleWrap.createSpan({ text: monthKey, cls: "dh-month-title" });

        const count = grouped[monthKey].length;
        const countText = isAr
          ? (count === 1 ? "خاطرة واحدة" : count === 2 ? "خاطرتان" : count <= 10 ? `${count} خواطر` : `${count} خاطرة`)
          : (count === 1 ? "1 reflection" : `${count} reflections`);

        summary.createSpan({
          cls: "dh-month-count-badge",
          text: countText
        });

        const groupDiv = monthDetails.createDiv({ cls: "dh-log-month-content" });

        grouped[monthKey].forEach(entry => {
          this.renderTimelineEntry(groupDiv, entry, lang, isAr);
        });
      });
    } catch (err) {
      console.error("[Core Habits] Error loading journey:", err);
      if (this.entriesContainer) {
        this.entriesContainer.empty();
        this.entriesContainer.createDiv({
          cls: "dh-log-empty-state",
          text: this.t("log_error") || (isAr ? "حدث خطأ أثناء تحميل سجل الرحلة." : "Error loading journey log.")
        });
      }
    }
  }

  renderTimelineEntry(container, entry, lang, isAr) {
    const entryDiv = container.createDiv({ cls: "dh-journey-entry-card" });
    const contentWrapper = entryDiv.createDiv({ cls: "dh-journey-entry-content" });

    // Meta row: Date + Actions (Open Daily Note + Edit)
    const metaRow = contentWrapper.createDiv({ cls: "dh-journey-entry-meta-row" });

    const dateFormatted = entry.date.clone().locale(lang).format(this.t("date_format_log_day") || "DD MMMM");
    const dateBadge = metaRow.createDiv({ cls: "dh-journey-entry-date" });
    dateBadge.createSpan({ text: dateFormatted, cls: "dh-entry-date-text" });

    // Quick Action Buttons
    const actionsEl = metaRow.createDiv({ cls: "dh-journey-entry-actions" });

    // 1. Edit button
    const editBtn = actionsEl.createEl("button", {
      cls: "dh-btn-icon-subtle dh-journey-action-btn",
      type: "button"
    });
    TooltipHelper.set(editBtn, isAr ? "تعديل الخاطرة" : "Edit reflection");
    const editIcon = editBtn.createSpan({ cls: "dh-btn-icon" });
    try { setIcon(editIcon, "pencil"); } catch { editIcon.textContent = "✎"; }
    editBtn.onclick = (e) => {
      e.stopPropagation();
      new HabitCommentPopup(
        this.app,
        this.plugin,
        this.habit || this.formState,
        entry.date,
        async (text) => {
          if (this.plugin?.habitJournalService) {
            await this.plugin.habitJournalService.saveHabitComment(
              this.habit || this.formState,
              entry.date,
              text
            );
          }
          await this.loadAndRenderEntries();
        }
      ).open();
    };

    // 2. Open Daily Note button
    const openNoteBtn = actionsEl.createEl("button", {
      cls: "dh-btn-icon-subtle dh-journey-action-btn",
      type: "button"
    });
    TooltipHelper.set(openNoteBtn, isAr ? "فتح الملاحظة اليومية" : "Open daily note");
    const openIcon = openNoteBtn.createSpan({ cls: "dh-btn-icon" });
    try { setIcon(openIcon, "external-link"); } catch { openIcon.textContent = "↗"; }
    openNoteBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        const file = await getNoteByDate(this.app, entry.date, true, this.plugin?.settings);
        if (file && this.app?.workspace) {
          await this.app.workspace.openLinkText(file.path, "", false);
        }
      } catch (err) {
        console.warn("[Core Habits] Failed to open daily note:", err);
      }
    };

    // Comment body wrapper
    const commentBody = contentWrapper.createDiv({ cls: "dh-journey-entry-text" });

    let rawText = entry.text || "";
    const tokens = [];

    // Process audio voice notes first: ![[*.webm]]
    rawText = rawText.replace(/!\[\[([^\]]+\.webm)\]\]/gi, (match, filename) => {
      tokens.push({ type: 'audio', text: filename });
      return `__TOKEN_${tokens.length - 1}__`;
    });

    // Process wiki links: [[...]]
    rawText = rawText.replace(/\[\[(.*?)\]\]/g, (match, linkText) => {
      tokens.push({ type: 'link', text: linkText });
      return `__TOKEN_${tokens.length - 1}__`;
    });

    // Process ratings: [Rate:: ...]
    rawText = rawText.replace(/\[Rate:: (.*?)\]/g, (match, rate) => {
      tokens.push({ type: 'rate', text: rate });
      return `__TOKEN_${tokens.length - 1}__`;
    });

    // Process bold: **...**
    rawText = rawText.replace(/\*\*(.*?)\*\*/g, (match, bold) => {
      tokens.push({ type: 'bold', text: bold });
      return `__TOKEN_${tokens.length - 1}__`;
    });

    // Append structured nodes securely
    const parts = rawText.split(/(__TOKEN_\d+__)/);
    parts.forEach(part => {
      const tokenMatch = part.match(/__TOKEN_(\d+)__/);
      if (tokenMatch) {
        const token = tokens[parseInt(tokenMatch[1])];
        if (token.type === 'link') {
          commentBody.createSpan({ cls: "dh-log-link", text: token.text });
        } else if (token.type === 'audio') {
          const audioFile = this.app?.metadataCache?.getFirstLinkpathDest(token.text, "");
          if (audioFile && this.app?.vault) {
            const src = this.app.vault.getResourcePath(audioFile);
            const audioContainer = contentWrapper.createDiv({ cls: "dh-journey-audio-container" });
            const audioEl = audioContainer.createEl("audio", {
              cls: "dh-diary-audio",
              attr: { controls: true, src: src }
            });

            Utils.fixAudioDuration(audioEl);
            audioEl.onclick = (e) => e.stopPropagation();

            // Mutual pause listener: only 1 audio plays at a time
            audioEl.addEventListener('play', () => {
              this.audioElements.forEach(a => {
                if (a !== audioEl && !a.paused) a.pause();
              });
            });
            this.audioElements.push(audioEl);
          } else {
            const audioSpan = commentBody.createSpan({ cls: "dh-audio-token-wrap" });
            const micIcon = audioSpan.createSpan({ cls: "dh-audio-token-icon" });
            try { setIcon(micIcon, "mic"); } catch { /* ignore */ }
            audioSpan.createSpan({ text: ` ${token.text}` });
          }
        } else if (token.type === 'rate') {
          commentBody.createSpan({ cls: "dh-log-rate-badge", text: token.text });
        } else if (token.type === 'bold') {
          commentBody.createEl("strong", { text: token.text });
        }
      } else if (part && part.trim()) {
        commentBody.appendChild(document.createTextNode(part));
      }
    });

    if (!commentBody.textContent.trim() && !contentWrapper.querySelector("audio")) {
      commentBody.remove();
    }
  }

  cleanupAudio() {
    this.audioElements.forEach(a => {
      try {
        if (!a.paused) a.pause();
      } catch { /* ignore */ }
    });
    this.audioElements = [];
  }

  destroy() {
    this.cleanupAudio();
    if (this.rootEl) {
      this.rootEl.empty();
      this.rootEl = null;
    }
  }
}
