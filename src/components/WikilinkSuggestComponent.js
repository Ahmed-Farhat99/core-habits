import { prepareFuzzySearch, sortSearchResults, setIcon } from 'obsidian';

/**
 * Lightweight, accessible Wikilink autocomplete component for Core Habits modal textareas.
 * Detects `[[` tokens inline, presents vault markdown files filtered by native fuzzy search,
 * supports keyboard/mouse navigation, respects active sourcePath, and handles mobile & RTL.
 */
export class WikilinkSuggestComponent {
  /**
   * @param {Object} options
   * @param {import('obsidian').App} options.app
   * @param {Object} [options.plugin]
   * @param {HTMLTextAreaElement} options.inputEl
   * @param {HTMLElement} options.containerEl
   * @param {Function} [options.getSourcePath]
   * @param {Function} [options.onSelect]
   */
  constructor({ app, plugin = null, inputEl, containerEl, getSourcePath = () => "", onSelect = null }) {
    this.app = app;
    this.plugin = plugin;
    this.inputEl = inputEl;
    this.containerEl = containerEl;
    this.getSourcePath = getSourcePath;
    this.onSelect = onSelect;

    this.isOpen = false;
    this.selectedIndex = 0;
    this.suggestions = [];
    this.cachedFiles = null;
    this.activeTrigger = null;
    this.suggestEl = null;

    this.boundOnInput = this.onInput.bind(this);
    this.boundOnKeyUp = this.onKeyUp.bind(this);
    this.boundOnClick = this.onClick.bind(this);
    this.boundOnKeyDown = this.onKeyDown.bind(this);
    this.boundOnClickOutside = this.onClickOutside.bind(this);

    this.init();
  }

  init() {
    if (!this.inputEl) return;

    this.inputEl.addEventListener("input", this.boundOnInput);
    this.inputEl.addEventListener("keyup", this.boundOnKeyUp);
    this.inputEl.addEventListener("click", this.boundOnClick);
    // Use capture phase so we intercept Enter, Escape, Arrow keys before modal handlers
    this.inputEl.addEventListener("keydown", this.boundOnKeyDown, { capture: true });

    if (typeof document !== "undefined") {
      document.addEventListener("pointerdown", this.boundOnClickOutside);
    }
  }

  destroy() {
    if (this.inputEl) {
      this.inputEl.removeEventListener("input", this.boundOnInput);
      this.inputEl.removeEventListener("keyup", this.boundOnKeyUp);
      this.inputEl.removeEventListener("click", this.boundOnClick);
      this.inputEl.removeEventListener("keydown", this.boundOnKeyDown, { capture: true });
    }

    if (typeof document !== "undefined") {
      document.removeEventListener("pointerdown", this.boundOnClickOutside);
    }

    this.close();

    if (this.suggestEl && this.suggestEl.parentNode) {
      this.suggestEl.parentNode.removeChild(this.suggestEl);
    }
    this.suggestEl = null;
    this.cachedFiles = null;
  }

  t(key, params = {}) {
    if (this.plugin?.translationManager?.t) {
      return this.plugin.translationManager.t(key, params);
    }
    return key;
  }

  /**
   * Lazily loads and caches vault markdown files once per component lifecycle.
   * Avoids scanning the vault on every keypress.
   * @returns {Array<{ file: import('obsidian').TFile, basename: string, path: string, aliases: string[] }>}
   */
  getCachedVaultEntries() {
    if (!this.cachedFiles) {
      const files = this.app?.vault?.getMarkdownFiles?.() || [];
      this.cachedFiles = files.map((file) => {
        let aliases = [];
        const cache = this.app?.metadataCache?.getFileCache?.(file);
        if (cache?.frontmatter) {
          const raw = cache.frontmatter.aliases ?? cache.frontmatter.alias;
          if (Array.isArray(raw)) {
            aliases = raw.map((a) => String(a).trim()).filter(Boolean);
          } else if (typeof raw === "string") {
            aliases = raw.split(",").map((a) => a.trim()).filter(Boolean);
          }
        }
        return {
          file,
          basename: file.basename || (file.name ? file.name.replace(/\.md$/i, "") : ""),
          path: file.path || "",
          aliases
        };
      });
    }
    return this.cachedFiles;
  }

  onInput() {
    this.checkTrigger();
  }

  onKeyUp(e) {
    // If navigation keys were pressed without opening suggest, re-check trigger
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      this.checkTrigger();
    }
  }

  onClick() {
    this.checkTrigger();
  }

  onClickOutside(e) {
    if (!this.isOpen) return;
    if (this.suggestEl && !this.suggestEl.contains(e.target) && e.target !== this.inputEl) {
      this.close();
    }
  }

  /**
   * Inspects the textarea caret position to see if it immediately follows an active `[[` token.
   */
  checkTrigger() {
    if (!this.inputEl) return;

    const cursorPos = this.inputEl.selectionStart;
    if (typeof cursorPos !== "number") {
      if (this.isOpen) this.close();
      return;
    }

    const text = this.inputEl.value || "";
    const textBefore = text.slice(0, cursorPos);

    // Only examine current line
    const lineStart = textBefore.lastIndexOf("\n");
    const currentLine = lineStart === -1 ? textBefore : textBefore.slice(lineStart + 1);

    const lastOpenInLine = currentLine.lastIndexOf("[[");
    if (lastOpenInLine === -1) {
      if (this.isOpen) this.close();
      return;
    }

    const triggerStart = (lineStart === -1 ? 0 : lineStart + 1) + lastOpenInLine;
    const tokenSlice = text.slice(triggerStart, cursorPos);

    // If closing brackets occur between `[[` and cursor, autocomplete is closed
    if (tokenSlice.slice(2).includes("]]")) {
      if (this.isOpen) this.close();
      return;
    }

    const query = tokenSlice.slice(2);

    // Disallow multiline, pipe, or hash queries for standard note name autocomplete
    if (query.includes("\n") || query.includes("|") || query.includes("#")) {
      if (this.isOpen) this.close();
      return;
    }

    this.activeTrigger = {
      start: triggerStart,
      end: cursorPos,
      query
    };

    this.updateSuggestions(query);
  }

  /**
   * Evaluates query against cached vault files using Obsidian native fuzzy search.
   * Limits results to 15 items maximum for optimal rendering performance.
   * @param {string} query
   */
  updateSuggestions(query) {
    const entries = this.getCachedVaultEntries();
    const cleanQuery = (query || "").trim();
    let results = [];

    if (!cleanQuery) {
      // Empty query after `[[` -> display first 15 entries
      results = entries.slice(0, 15).map((entry) => ({
        file: entry.file,
        basename: entry.basename,
        path: entry.path,
        matchedAlias: null,
        matches: [],
        score: 0
      }));
    } else {
      let fuzzyFn = null;
      if (typeof prepareFuzzySearch === "function") {
        try {
          fuzzyFn = prepareFuzzySearch(cleanQuery);
        } catch {
          fuzzyFn = null;
        }
      }

      if (!fuzzyFn) {
        const lowerQ = cleanQuery.toLowerCase();
        fuzzyFn = (str) => {
          const lowerStr = (str || "").toLowerCase();
          const idx = lowerStr.indexOf(lowerQ);
          if (idx === -1) return null;
          return { score: -idx, matches: [[idx, idx + lowerQ.length]] };
        };
      }

      for (const entry of entries) {
        let match = fuzzyFn(entry.basename);
        let matchedAlias = null;
        let score = match ? match.score : -Infinity;

        // Check aliases
        if (entry.aliases && entry.aliases.length > 0) {
          for (const alias of entry.aliases) {
            const aliasMatch = fuzzyFn(alias);
            if (aliasMatch && aliasMatch.score > score) {
              match = aliasMatch;
              matchedAlias = alias;
              score = aliasMatch.score;
            }
          }
        }

        // Check path if basename/alias didn't match
        if (!match && entry.path.includes("/")) {
          const pathMatch = fuzzyFn(entry.path);
          if (pathMatch) {
            match = pathMatch;
            score = pathMatch.score - 5;
          }
        }

        if (match) {
          results.push({
            file: entry.file,
            basename: entry.basename,
            path: entry.path,
            matchedAlias,
            matches: match.matches || [],
            score
          });
        }
      }

      if (typeof sortSearchResults === "function") {
        try {
          sortSearchResults(results);
        } catch {
          results.sort((a, b) => b.score - a.score);
        }
      } else {
        results.sort((a, b) => b.score - a.score);
      }

      results = results.slice(0, 15);
    }

    this.suggestions = results;
    this.selectedIndex = 0;
    this.render();

    if (!this.isOpen) {
      this.open();
    }
  }

  ensureSuggestElement() {
    if (!this.suggestEl) {
      this.suggestEl = document.createElement("div");
      this.suggestEl.className = "dh-wikilink-suggest-container";
      this.suggestEl.setAttribute("role", "listbox");
      if (this.containerEl) {
        this.containerEl.appendChild(this.suggestEl);
      }
    }
    return this.suggestEl;
  }

  render() {
    const el = this.ensureSuggestElement();
    el.innerHTML = "";

    // Adjust position if close to bottom of screen
    if (this.inputEl && typeof window !== "undefined") {
      const rect = this.inputEl.getBoundingClientRect();
      const fitsBelow = rect.bottom + 200 <= window.innerHeight;
      el.classList.toggle("is-flipped", !fitsBelow && rect.top > 200);
    }

    if (this.suggestions.length === 0) {
      const empty = el.createDiv ? el.createDiv({ cls: "dh-wikilink-suggest-empty" }) : document.createElement("div");
      if (!el.createDiv) {
        empty.className = "dh-wikilink-suggest-empty";
        el.appendChild(empty);
      }
      empty.textContent = this.t("wikilink_no_results") || "لا توجد ملفات مطابقة";
      return;
    }

    this.suggestions.forEach((item, index) => {
      const itemEl = el.createDiv
        ? el.createDiv({ cls: `dh-wikilink-suggest-item ${index === this.selectedIndex ? "is-selected" : ""}` })
        : document.createElement("div");

      if (!el.createDiv) {
        itemEl.className = `dh-wikilink-suggest-item ${index === this.selectedIndex ? "is-selected" : ""}`;
        el.appendChild(itemEl);
      }

      itemEl.setAttribute("role", "option");
      itemEl.setAttribute("aria-selected", index === this.selectedIndex ? "true" : "false");

      const iconSpan = itemEl.createSpan ? itemEl.createSpan({ cls: "dh-wikilink-suggest-icon" }) : document.createElement("span");
      if (!itemEl.createSpan) {
        iconSpan.className = "dh-wikilink-suggest-icon";
        itemEl.appendChild(iconSpan);
      }

      if (typeof setIcon === "function") {
        try {
          setIcon(iconSpan, item.matchedAlias ? "forward" : "file-text");
        } catch {
          iconSpan.textContent = "📄";
        }
      } else {
        iconSpan.textContent = "📄";
      }

      const contentDiv = itemEl.createDiv ? itemEl.createDiv({ cls: "dh-wikilink-suggest-content" }) : document.createElement("div");
      if (!itemEl.createDiv) {
        contentDiv.className = "dh-wikilink-suggest-content";
        itemEl.appendChild(contentDiv);
      }

      const titleDiv = contentDiv.createDiv ? contentDiv.createDiv({ cls: "dh-wikilink-suggest-title" }) : document.createElement("div");
      if (!contentDiv.createDiv) {
        titleDiv.className = "dh-wikilink-suggest-title";
        contentDiv.appendChild(titleDiv);
      }

      const displayText = item.matchedAlias ? `${item.matchedAlias} → ${item.basename}` : item.basename;
      this.renderHighlightedText(titleDiv, displayText, item.matches);

      if (item.path && item.path.includes("/")) {
        const folder = item.path.slice(0, item.path.lastIndexOf("/"));
        if (folder) {
          const pathDiv = contentDiv.createDiv ? contentDiv.createDiv({ cls: "dh-wikilink-suggest-path" }) : document.createElement("div");
          if (!contentDiv.createDiv) {
            pathDiv.className = "dh-wikilink-suggest-path";
            contentDiv.appendChild(pathDiv);
          }
          pathDiv.textContent = folder;
        }
      }

      itemEl.addEventListener("mouseenter", () => {
        this.setSelectedIndex(index);
      });

      itemEl.addEventListener("mousedown", (e) => {
        // Prevent losing textarea focus/caret
        e.preventDefault();
        e.stopPropagation();
        this.selectItem(item);
      });
    });
  }

  renderHighlightedText(container, text, matches) {
    if (!matches || matches.length === 0) {
      container.textContent = text;
      return;
    }

    const sorted = matches.slice().sort((a, b) => a[0] - b[0]);
    let lastIndex = 0;

    for (const [start, end] of sorted) {
      if (start > lastIndex && start <= text.length) {
        container.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      }
      if (start < text.length) {
        const span = document.createElement("span");
        span.className = "dh-wikilink-suggest-highlight";
        span.textContent = text.slice(start, Math.min(end, text.length));
        container.appendChild(span);
      }
      lastIndex = Math.min(end, text.length);
    }

    if (lastIndex < text.length) {
      container.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }

  setSelectedIndex(index) {
    if (this.suggestions.length === 0) {
      this.selectedIndex = 0;
      return;
    }

    this.selectedIndex = Math.max(0, Math.min(index, this.suggestions.length - 1));

    if (!this.suggestEl) return;
    const items = this.suggestEl.querySelectorAll(".dh-wikilink-suggest-item");
    items.forEach((item, i) => {
      const isSel = i === this.selectedIndex;
      item.classList.toggle("is-selected", isSel);
      item.setAttribute("aria-selected", isSel ? "true" : "false");
      if (isSel && typeof item.scrollIntoView === "function") {
        item.scrollIntoView({ block: "nearest" });
      }
    });
  }

  open() {
    this.isOpen = true;
    if (this.suggestEl) {
      this.suggestEl.style.display = "flex";
    }
  }

  close() {
    this.isOpen = false;
    this.activeTrigger = null;
    this.selectedIndex = 0;
    if (this.suggestEl) {
      this.suggestEl.style.display = "none";
    }
  }

  /**
   * Resolves the exact linktext using Obsidian's native `fileToLinktext` with the active `sourcePath`.
   * @param {import('obsidian').TFile} file
   * @param {string} sourcePath
   * @returns {string}
   */
  getLinkText(file, sourcePath) {
    if (this.app?.metadataCache?.fileToLinktext) {
      try {
        return this.app.metadataCache.fileToLinktext(file, sourcePath || "", true);
      } catch (err) {
        console.warn("[Core Habits] fileToLinktext failed, falling back to basename:", err);
      }
    }
    return file?.basename || (file?.name ? file.name.replace(/\.md$/i, "") : "");
  }

  /**
   * Replaces the `[[query` range in the textarea with `[[linktext]]` and restores focus & caret.
   * @param {Object} item
   */
  selectItem(item) {
    if (!item || !this.inputEl) return;

    const sourcePath = typeof this.getSourcePath === "function" ? this.getSourcePath() : "";
    let linktext = this.getLinkText(item.file, sourcePath);

    if (item.matchedAlias) {
      linktext = `${linktext}|${item.matchedAlias}`;
    }

    const fullText = this.inputEl.value || "";
    const start = this.activeTrigger ? this.activeTrigger.start : 0;
    let end = this.activeTrigger ? this.activeTrigger.end : this.inputEl.selectionStart;

    // If closing `]]` was already immediately after the cursor, include it in replacement range
    if (fullText.slice(end, end + 2) === "]]") {
      end += 2;
    }

    const before = fullText.slice(0, start);
    const after = fullText.slice(end);
    const insertion = `[[${linktext}]]`;

    this.inputEl.value = before + insertion + after;

    const newCursorPos = start + insertion.length;
    this.inputEl.selectionStart = newCursorPos;
    this.inputEl.selectionEnd = newCursorPos;
    this.inputEl.focus();

    this.close();

    // Trigger synthetic input event to update dirty tracking and auto-resizing
    this.inputEl.dispatchEvent(new Event("input", { bubbles: true }));

    if (typeof this.onSelect === "function") {
      this.onSelect(item, linktext);
    }
  }

  onKeyDown(e) {
    if (!this.isOpen) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      if (this.suggestions.length > 0) {
        this.setSelectedIndex((this.selectedIndex + 1) % this.suggestions.length);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      if (this.suggestions.length > 0) {
        this.setSelectedIndex((this.selectedIndex - 1 + this.suggestions.length) % this.suggestions.length);
      }
      return;
    }

    if (e.key === "Enter" || e.key === "Tab") {
      if (this.suggestions.length > 0 && this.suggestions[this.selectedIndex]) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this.selectItem(this.suggestions[this.selectedIndex]);
        return;
      }
    }

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this.close();
      this.inputEl.focus();
      return;
    }
  }
}
