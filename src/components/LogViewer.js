import { HabitCommentPopup } from '../modals/HabitCommentPopup.js';
import { injectHabitCommentIntoDailyNote, extractHabitHistoryFromDailyNotes, fixAudioDuration } from '../utils/helpers.js';

export class LogViewer {
  constructor(app, plugin, existingHabit, formState) {
    this.app = app;
    this.plugin = plugin;
    this.existingHabit = existingHabit;
    this.formState = formState;
  }

  async render(panel) {
    const isAr = this.plugin.settings.language === "ar";
    const logSection = panel.createDiv({ cls: "form-section dh-log-section" });

    // Compact Header with Action Button
    const headerRow = logSection.createDiv({ cls: "dh-log-section-header-row" });
    headerRow.createEl("h3", {
      text: isAr ? "سجل المتابعة والتعليقات" : "Habit Context Log",
      cls: "dh-log-section-title"
    });

    const container = logSection.createDiv({ cls: "dh-log-entries-container" });

    const addNoteBtn = headerRow.createEl("button", {
      text: isAr ? "🎙️ أضف ملاحظة لليوم" : "🎙️ Add Note Today",
      cls: "dh-log-add-note-btn dh-brand-btn"
    });
    
    addNoteBtn.onclick = () => {
      new HabitCommentPopup(
        this.app,
        this.plugin,
        this.existingHabit || this.formState,
        window.moment(),
        async (text) => {
          if (this.plugin.habitNoteManager) {
            const dateStr = window.moment().format("YYYY-MM-DD");
            await this.plugin.habitNoteManager.appendToHabitNoteLog(this.existingHabit || this.formState, dateStr, text);
          } else {
            await injectHabitCommentIntoDailyNote(this.app, this.plugin, this.existingHabit || this.formState, window.moment(), text);
          }
          this.renderLogSectionOnly(container, isAr);
        }
      ).open();
    };

    container.textContent = isAr ? "جاري تحميل السجل..." : "Loading log...";
    this.renderLogSectionOnly(container, isAr);
  }

  async renderLogSectionOnly(container, isAr) {
    try {
      const habitName = this.existingHabit?.linkText || this.existingHabit?.name || this.formState.name;
      if (!habitName) {
        container.empty();
        return;
      }
      
      let entries = [];
      if (this.plugin.habitNoteManager && this.existingHabit) {
        entries = await this.plugin.habitNoteManager.readHabitNoteLog(this.existingHabit);
      } else {
        entries = await extractHabitHistoryFromDailyNotes(this.app, this.plugin, habitName, 90);
      }

      container.empty();

      if (entries.length === 0) {
        container.createDiv({
          cls: "dh-log-empty-state",
          text: isAr ? "السجل فارغ. استمر في العادة ووثق تقدمك يوماً بيوم!" : "Log is empty. Keep tracking and document your progress day by day!"
        });
        return;
      }

      // Group entries by Month
      const grouped = {};
      entries.forEach(entry => {
        const monthKey = entry.date.locale(isAr ? 'ar' : 'en').format("MMMM YYYY");
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

          const dateFormatted = entry.date.locale(isAr ? 'ar' : 'en').format("DD MMM");
          let temp = `**${dateFormatted}** | ${entry.text}`;

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
              if (token.type === 'link') entryDiv.createSpan({ cls: "dh-log-link", text: token.text });
              else if (token.type === 'audio') {
                const audioFile = this.app.metadataCache.getFirstLinkpathDest(token.text, "");
                if (audioFile) {
                  const src = this.app.vault.getResourcePath(audioFile);
                  const audioEl = entryDiv.createEl("audio", { attr: { controls: true, src: src } });
                  fixAudioDuration(audioEl);

                  audioEl.style.width = "100%";
                  audioEl.style.height = "36px";
                  audioEl.style.marginTop = "8px";
                  audioEl.style.borderRadius = "8px";
                  audioEl.onclick = (e) => e.stopPropagation();
                  
                  // Mutual exclusion for audio playback
                  audioEl.addEventListener('play', () => {
                    document.querySelectorAll('audio').forEach(a => {
                      if (a !== audioEl && !a.paused) a.pause();
                    });
                  });
                } else {
                  entryDiv.createSpan({ text: token.text });
                }
              }
              else if (token.type === 'rate') entryDiv.createSpan({ cls: "dh-log-rate-badge", text: token.text });
              else if (token.type === 'bold') entryDiv.createEl("strong", { text: token.text });
            } else if (part) {
              entryDiv.appendChild(document.createTextNode(part));
            }
          });
        });
      });

    } catch (e) {
      console.error("[Core Habits] Error loading log:", e);
      container.textContent = isAr ? "خطأ في تحميل السجل" : "Error loading log";
    }
  }
}
