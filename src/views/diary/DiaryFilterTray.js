import { setIcon } from 'obsidian';

export class DiaryFilterTray {
  constructor(plugin, diaryService, callbacks = {}) {
    this.plugin = plugin;
    this.diaryService = diaryService;
    this.callbacks = callbacks;
    this._searchTimer = null;
    this._focusTimer = null;
    this._container = null;
    this._backdrop = null;
    this._chipCountEls = new Map();
    this._rawEntries = [];
  }

  /**
   * Cleans up existing tray and backdrop elements
   */
  destroy() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
    if (this._focusTimer) {
      clearTimeout(this._focusTimer);
      this._focusTimer = null;
    }
    if (this._backdrop) {
      this._backdrop.remove();
      this._backdrop = null;
    }
    if (this._container) {
      this._container.remove();
      this._container = null;
    }
    this._chipCountEls.clear();
  }

  /**
   * Updates the counter badges on all filter chips to match current search query results
   */
  updateCounters() {
    const counts = this.diaryService.getTypeCounts(
      this._rawEntries,
      this.diaryService.getSearchQuery()
    );

    for (const [id, el] of this._chipCountEls.entries()) {
      if (el) {
        el.textContent = `(${counts[id] || 0})`;
      }
    }

    if (this._resetBtn) {
      const hasFilters = this.diaryService.hasActiveFilters();
      this._resetBtn.style.display = hasFilters ? "inline-flex" : "none";
    }
  }

  /**
   * Renders the on-demand filter and search tray
   * @param {HTMLElement} parentContainer
   * @param {Array<object>} rawEntries
   * @param {boolean} isOpen
   */
  render(parentContainer, rawEntries, isOpen) {
    this.destroy();

    if (!isOpen) {
      return;
    }

    this._rawEntries = Array.isArray(rawEntries) ? rawEntries : [];
    const t = (k, p) => this.plugin.translationManager?.t(k, p) || k;
    const currentQuery = this.diaryService.getSearchQuery();
    const typeCounts = this.diaryService.getTypeCounts(this._rawEntries, currentQuery);

    // Render mobile backdrop if on mobile device
    if (document.body.classList.contains("is-mobile")) {
      this._backdrop = parentContainer.createDiv({ cls: "dh-filter-drawer-backdrop" });
      this._backdrop.onclick = () => {
        if (this.callbacks.onClose) {
          this.callbacks.onClose();
        }
      };
    }

    const tray = parentContainer.createDiv({ cls: "dh-diary-filter-drawer" });
    this._container = tray;

    // Listen for Escape key on tray container
    tray.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (this.callbacks.onClose) {
          this.callbacks.onClose();
        }
      }
    });

    // ── Row 1: Search Box + Close Drawer Button ─────────────────────────────
    const topBar = tray.createDiv({ cls: "dh-filter-tray-top-bar" });

    // 1. Search Box
    const searchBox = topBar.createDiv({ cls: "dh-diary-search-box" });
    const searchIcon = searchBox.createSpan({ cls: "dh-search-icon" });
    setIcon(searchIcon, "search");

    const searchInput = searchBox.createEl("input", {
      type: "text",
      cls: "dh-diary-search-input",
      placeholder: t("filter_search_placeholder") || "ابحث في التدوينات...",
      value: currentQuery,
      attr: { "aria-label": t("filter_search_placeholder") || "Search diary entries" }
    });

    // Search text clear (✕) button: always available in DOM, shown when input has text
    const clearSearchBtn = searchBox.createEl("button", {
      cls: "dh-diary-search-clear-btn mod-icon",
      text: "✕",
      attr: {
        "aria-label": t("filter_clear_search") || "Clear search text"
      }
    });
    clearSearchBtn.style.display = currentQuery ? "inline-flex" : "none";

    clearSearchBtn.onclick = () => {
      if (this._searchTimer) clearTimeout(this._searchTimer);
      this._searchTimer = null;
      searchInput.value = "";
      clearSearchBtn.style.display = "none";
      this.diaryService.setSearchQuery("");
      this.updateCounters();
      searchInput.focus();
      if (this.callbacks.onFilterChange) {
        this.callbacks.onFilterChange();
      }
    };

    searchInput.oninput = (e) => {
      const val = e.target.value;
      clearSearchBtn.style.display = val ? "inline-flex" : "none";

      if (this._searchTimer) clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        this.diaryService.setSearchQuery(val);
        this.updateCounters();
        if (this.callbacks.onFilterChange) {
          this.callbacks.onFilterChange();
        }
      }, 200);
    };

    // Top action group: Reset filters + Close drawer
    const topActions = topBar.createDiv({ cls: "dh-filter-tray-top-actions" });

    // Reset all filters button
    const resetBtn = topActions.createEl("button", {
      cls: "dh-btn dh-filter-reset-btn",
      text: t("filter_clear_btn") || "إلغاء التصفية",
      attr: { "aria-label": t("filter_clear_btn") || "Clear all filters" }
    });
    this._resetBtn = resetBtn;
    resetBtn.style.display = this.diaryService.hasActiveFilters() ? "inline-flex" : "none";

    resetBtn.onclick = () => {
      if (this._searchTimer) clearTimeout(this._searchTimer);
      this._searchTimer = null;
      searchInput.value = "";
      clearSearchBtn.style.display = "none";
      this.diaryService.resetFilters();
      chipsWrap.querySelectorAll(".dh-diary-type-chip").forEach(c => {
        c.toggleClass("is-active", c.dataset.typeId === "ALL");
        c.setAttribute("aria-pressed", c.dataset.typeId === "ALL" ? "true" : "false");
      });
      this.updateCounters();
      if (this.callbacks.onFilterChange) {
        this.callbacks.onFilterChange();
      }
    };

    // Close Drawer Button
    const closeBtn = topActions.createEl("button", {
      cls: "dh-btn dh-tray-close-btn mod-icon",
      text: "✕",
      attr: { "aria-label": `${t("close") || "إغلاق"} (Esc)` }
    });
    closeBtn.onclick = () => {
      if (this.callbacks.onClose) {
        this.callbacks.onClose();
      }
    };

    // Auto-focus input on open
    this._focusTimer = setTimeout(() => {
      if (this._container === tray && searchInput.isConnected) searchInput.focus();
      this._focusTimer = null;
    }, 60);

    // ── Row 2: Type Filter Chips ────────────────────────────────────────────
    const chipsWrap = tray.createDiv({ cls: "dh-diary-chips-wrap" });
    const selectedType = this.diaryService.getSelectedType() || "ALL";

    const typeChips = [
      { id: "ALL", label: t("filter_all") || "الجميع" },
      { id: "Good", label: t("reflection_good") || "إيجابي" },
      { id: "Bad", label: t("reflection_bad") || "سلبي" },
      { id: "Lesson", label: t("reflection_lesson") || "درس" },
      { id: "Idea", label: t("reflection_idea") || "فكرة" },
      { id: "AUDIO", label: t("filter_voice") || "صوتيات" }
    ];

    typeChips.forEach(chip => {
      const isSelected = selectedType === chip.id;
      const chipBtn = chipsWrap.createEl("button", {
        cls: `dh-diary-type-chip ${isSelected ? "is-active" : ""}`,
        attr: {
          "aria-pressed": isSelected ? "true" : "false",
          "data-type-id": chip.id
        }
      });
      chipBtn.dataset.typeId = chip.id;
      chipBtn.createSpan({ text: chip.label });

      const countSpan = chipBtn.createSpan({
        cls: "chip-count",
        text: `(${typeCounts[chip.id] || 0})`
      });
      this._chipCountEls.set(chip.id, countSpan);

      chipBtn.onclick = () => {
        const current = this.diaryService.getSelectedType();
        // Toggle behavior: clicking already-selected category (other than ALL) deselects back to ALL
        const nextType = (current === chip.id && chip.id !== "ALL") ? "ALL" : chip.id;
        this.diaryService.setSelectedType(nextType);

        chipsWrap.querySelectorAll(".dh-diary-type-chip").forEach(c => {
          const active = c.dataset.typeId === nextType;
          c.toggleClass("is-active", active);
          c.setAttribute("aria-pressed", active ? "true" : "false");
        });

        this.updateCounters();

        if (this.callbacks.onFilterChange) {
          this.callbacks.onFilterChange();
        }
      };
    });
  }
}
