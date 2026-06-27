import { HabitCommentPopup } from '../modals/HabitCommentPopup.js';
import { Utils } from '../utils/Utils.js';

export class LogViewer {
  constructor(app, plugin, existingHabit, formState) {
    this.app = app;
    this.plugin = plugin;
    this.existingHabit = existingHabit;
    this.formState = formState;
  }

  async render(panel) {
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const logSection = panel.createDiv({ cls: "form-section dh-log-section" });

    // Compact Header with Action Button
    const headerRow = logSection.createDiv({ cls: "dh-log-section-header-row" });
    headerRow.createEl("h3", {
      text: t("log_header_title"),
      cls: "dh-log-section-title"
    });

    const container = logSection.createDiv({ cls: "dh-log-entries-container" });

    const addNoteBtn = headerRow.createEl("button", {
      text: t("log_add_note_btn"),
      cls: "dh-log-add-note-btn dh-brand-btn"
    });
    
    addNoteBtn.onclick = () => {
      new HabitCommentPopup(
        this.app,
        this.plugin,
        this.existingHabit || this.formState,
        window.moment(),
        async (text) => {
          await this.plugin.habitCommentRepository.upsertCommentForHabitDate(this.existingHabit || this.formState, window.moment(), text);
          this.renderLogSectionOnly(container);
        }
      ).open();
    };

    container.textContent = t("log_loading");
    this.renderLogSectionOnly(container);
  }

  async renderLogSectionOnly(container) {
    const t = (k, p) => this.plugin.translationManager.t(k, p);
    const lang = this.plugin.settings.language || "ar";
    try {
      const habit = this.existingHabit || this.formState;
      const habitName = habit?.linkText || habit?.name || this.formState.name;
      if (!habitName) {
        container.empty();
        return;
      }
      const entries = await this.plugin.habitCommentRepository.getCommentHistoryByName(habitName, 365);

      container.empty();

      if (entries.length === 0) {
        container.createDiv({
          cls: "dh-log-empty-state",
          text: t("log_empty_state")
        });
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
        const details = container.createEl("details", { cls: "dh-log-month-group" });
        if (idx === 0) details.open = true;
        
        details.createEl("summary", { text: monthKey, cls: "dh-log-month-summary" });
        const groupDiv = details.createDiv({ cls: "dh-log-month-content" });

        grouped[monthKey].forEach(entry => {
          const entryDiv = groupDiv.createDiv({ cls: "dh-log-entry" });

          // Content Wrapper
          const contentWrapper = entryDiv.createDiv({ cls: "dh-log-entry-content" });

          // Render Date
          const dateFormatted = entry.date.clone().locale(lang).format(t("date_format_log_day"));
          contentWrapper.createDiv({ cls: "dh-log-entry-date", text: dateFormatted });

          // Comment body wrapper
          const commentBody = contentWrapper.createDiv({ cls: "dh-log-entry-text" });

          let temp = entry.text;
          const tokens = [];

          // Process audio voice notes first
          temp = temp.replace(/!\[\[([^\]]+\.webm)\]\]/gi, (match, p1) => {
            tokens.push({ type: 'audio', text: p1 });
            return `__TOKEN_${tokens.length - 1}__`;
          });

          // Replace links
          temp = temp.replace(/\[\[(.*?)\]\]/g, (match, p1) => {
            tokens.push({ type: 'link', text: p1 });
            return `__TOKEN_${tokens.length - 1}__`;
          });
          // Replace rates
          temp = temp.replace(/\[Rate:: (.*?)\]/g, (match, p1) => {
            tokens.push({ type: 'rate', text: p1 });
            return `__TOKEN_${tokens.length - 1}__`;
          });
          // Replace bold
          temp = temp.replace(/\*\*(.*?)\*\*/g, (match, p1) => {
            tokens.push({ type: 'bold', text: p1 });
            return `__TOKEN_${tokens.length - 1}__`;
          });

          // Append nodes securely
          const parts = temp.split(/(__TOKEN_\d+__)/);
          parts.forEach(part => {
            const tokenMatch = part.match(/__TOKEN_(\d+)__/);
            if (tokenMatch) {
              const token = tokens[parseInt(tokenMatch[1])];
              if (token.type === 'link') {
                commentBody.createSpan({ cls: "dh-log-link", text: token.text });
              } else if (token.type === 'audio') {
                const audioFile = this.app.metadataCache.getFirstLinkpathDest(token.text, "");
                if (audioFile) {
                  const src = this.app.vault.getResourcePath(audioFile);
                  const audioContainer = contentWrapper.createDiv({ cls: "dh-log-entry-audio-container" });
                  const audioEl = audioContainer.createEl("audio", {
                    cls: "dh-diary-audio",
                    attr: { controls: true, src: src }
                  });
                  Utils.fixAudioDuration(audioEl);

                  audioEl.onclick = (e) => e.stopPropagation();
                  audioEl.addEventListener('play', () => {
                    document.querySelectorAll('audio').forEach(a => {
                      if (a !== audioEl && !a.paused) a.pause();
                    });
                  });
                } else {
                  commentBody.createSpan({ text: token.text });
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

          // If the text body ended up completely empty, clean it up to prevent an empty bubble
          if (!commentBody.textContent.trim()) {
            commentBody.remove();
          }
        });
      });

    } catch (e) {
      console.error("[Core Habits] Error loading log:", e);
      container.textContent = t("log_error");
    }
  }
}
