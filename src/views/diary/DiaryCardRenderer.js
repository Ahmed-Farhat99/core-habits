import { MarkdownRenderer } from 'obsidian';
import { Utils } from '../../utils/Utils.js';
import { DateUtils } from '../../utils/helpers.js';

export class DiaryCardRenderer {
  constructor(context, app, plugin) {
    this.context = context;
    this.app = app;
    this.plugin = plugin;
    this.expandedEntries = new Set();
  }

  /**
   * Renders a single reflection entry card
   * @param {HTMLElement} parent
   * @param {object} entry
   * @param {boolean} [showDateHeader=false] - If true, displays the day/date (e.g. in standalone card mode)
   * @param {boolean} [hideTypeBadge=false] - If true, hides the type badge when already under a category section
   */
  render(parent, entry, showDateHeader = false, hideTypeBadge = false) {
    const lang = this.plugin.settings?.language || "ar";
    const typeMeta = this.context.getReflectionTypeMeta(entry.type);
    const entryCard = parent.createDiv({ cls: `dh-diary-entry-card type-${typeMeta.cls}` });

    // Card Header (only if we have date, time, or visible type badge)
    const hasTime = Boolean(entry.time && String(entry.time).trim());
    const needsHeader = showDateHeader || hasTime || !hideTypeBadge;

    if (needsHeader) {
      const cardHeader = entryCard.createDiv({ cls: "entry-card-header" });

      if (showDateHeader && entry.moment) {
        const isToday = entry.moment.isSame(window.moment(), "day");
        const isRTL = this.plugin.translationManager?.t("direction") === "rtl";
        const datePart = cardHeader.createDiv({ cls: "entry-date-part" });

        datePart.createSpan({
          cls: "day-name-text",
          text: entry.moment.clone().locale(lang).format("dddd")
        });
        datePart.createSpan({
          cls: "day-date-text",
          text: entry.moment.clone().locale(lang).format("D MMMM")
        });

        if (this.plugin.settings?.showHijriDate) {
          const hijriDateStr = DateUtils.getHijriDate(entry.moment, isRTL);
          if (hijriDateStr) {
            datePart.createSpan({ cls: "day-date-sep", text: "·" });
            datePart.createSpan({ cls: "day-hijri-subtext", text: hijriDateStr });
          }
        }

        if (isToday) {
          datePart.createSpan({
            cls: "dh-today-badge",
            text: this.plugin.translationManager?.t("today") || "اليوم"
          });
        }
      }

      const badgePart = cardHeader.createDiv({ cls: "entry-badge-part" });

      if (!hideTypeBadge) {
        badgePart.createSpan({ cls: `entry-type-badge type-${typeMeta.cls}`, text: typeMeta.label });
      }

      if (hasTime) {
        badgePart.createSpan({ cls: "entry-time-badge", text: entry.time, attr: { dir: "ltr" } });
      }
    }

    // Text is the primary content; recordings are supporting material.
    const bodyEl = entryCard.createDiv({ cls: "entry-card-body" });
    const audioRegex = /!\[\[([^\]]+\.(?:webm|mp4|m4a|ogg|wav|mp3))\]\]/gi;
    const textContent = entry.cleanText || entry.text || "";
    const allAudioMatches = [...textContent.matchAll(audioRegex)];
    const remainingText = textContent.replace(audioRegex, "").trim();
    const audioList = entry.audioFiles?.length ? entry.audioFiles : allAudioMatches.map(match => match[1]);

    if (remainingText) {
      const textEl = bodyEl.createDiv({ cls: "dh-diary-entry-text" });
      this.renderMarkdownContent(remainingText, textEl, entry.path);

      if (remainingText.length > 260 || remainingText.split("\n").length > 4) {
        const entryKey = `${entry.path || ""}:${entry.id || entry.timestamp || remainingText}`;
        const expanded = this.expandedEntries.has(entryKey);
        textEl.toggleClass("is-collapsed", !expanded);
        const moreBtn = bodyEl.createEl("button", {
          cls: "dh-diary-expand-btn",
          text: this.plugin.translationManager?.t(expanded ? "diary_show_less" : "diary_show_more"),
          attr: { "aria-expanded": expanded ? "true" : "false" }
        });
        moreBtn.onclick = (event) => {
          event.stopPropagation();
          const isExpanded = textEl.classList.contains("is-collapsed");
          textEl.toggleClass("is-collapsed", !isExpanded);
          moreBtn.setAttribute("aria-expanded", isExpanded ? "true" : "false");
          moreBtn.textContent = this.plugin.translationManager?.t(isExpanded ? "diary_show_less" : "diary_show_more");
          if (isExpanded) this.expandedEntries.add(entryKey);
          else this.expandedEntries.delete(entryKey);
        };
      }
    }

    audioList.forEach(fileName => {
      const audioFile = this.app.metadataCache.getFirstLinkpathDest(fileName, entry.path || "");
      if (audioFile) {
        const src = this.app.vault.getResourcePath(audioFile);
        const audioEl = bodyEl.createEl("audio", {
          cls: "dh-diary-audio",
          attr: { controls: "true", src, preload: "metadata", dir: "ltr" }
        });
        Utils.fixAudioDuration(audioEl);
        audioEl.onclick = (event) => event.stopPropagation();
      } else {
        bodyEl.createDiv({
          cls: "dh-diary-audio-missing",
          text: this.plugin.translationManager?.t("diary_audio_missing") || "Audio file unavailable"
        });
      }
    });

    // Click on card opens Daily Note
    entryCard.onclick = (e) => {
      if (e.target.closest('a, audio, button, input, .internal-link, .external-link, .dh-diary-audio')) {
        return;
      }
      this.context.openDailyNote(entry.moment);
    };
    entryCard.setAttribute("tabindex", "0");
    entryCard.setAttribute("role", "link");
    entryCard.setAttribute("aria-label", this.plugin.translationManager?.t("diary_open_day_note") || "Open daily note");
    entryCard.onkeydown = (event) => {
      if (event.target !== entryCard || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      this.context.openDailyNote(entry.moment);
    };

    return entryCard;
  }

  /**
   * Renders Markdown safely using Obsidian modern API with backwards-compatible fallback
   */
  renderMarkdownContent(markdown, container, sourcePath) {
    if (!markdown) return;
    const comp = this.context.getComponent ? this.context.getComponent() : null;
    if (MarkdownRenderer.render) {
      MarkdownRenderer.render(this.app, markdown, container, sourcePath || "", comp);
    } else if (MarkdownRenderer.renderMarkdown) {
      MarkdownRenderer.renderMarkdown(markdown, container, sourcePath || "", comp);
    }
  }
}
