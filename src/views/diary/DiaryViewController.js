import { StatusView } from '../StatusView.js';
import { DiaryCardRenderer } from './DiaryCardRenderer.js';
import { DiaryContentRenderer } from './DiaryContentRenderer.js';
import { DiaryHeader } from './DiaryHeader.js';
import { DiaryFilterTray } from './DiaryFilterTray.js';

export class DiaryViewController {
  constructor(context) {
    this.context = context;
    this.app = context.app;
    this.plugin = context.plugin;
    this.diaryService = context.diaryService || this.plugin.diaryService;

    this._rawEntries = [];
    this._bodyEl = null;
    this._toolbarEl = null;
    this._isSearchOpen = false;
    this._currentLoadId = 0;
    this._isDestroyed = false;

    // Sub-renderers
    this.cardRenderer = new DiaryCardRenderer(context, this.app, this.plugin);
    this.contentRenderer = new DiaryContentRenderer(
      context, this.plugin, this.diaryService, this.cardRenderer, () => this.resetFiltersInView()
    );

    this.header = new DiaryHeader(context, this.app, this.plugin, this.diaryService, {
      onToggleFilterTray: () => this.toggleFilterTray(),
      onViewModeChange: () => this.reRenderBody()
    });

    this.filterTray = new DiaryFilterTray(this.plugin, this.diaryService, {
      onFilterChange: () => {
        this.header.updateFilterBadge();
        this.reRenderBody();
      },
      onClose: () => {
        this.closeFilterTray();
      }
    });

  }

  resetFiltersInView() {
    if (this._isDestroyed) return;
    this.header.updateFilterBadge();
    if (this._toolbarEl) this.filterTray.render(this._toolbarEl, this._rawEntries, this._isSearchOpen);
    this.reRenderBody();
  }

  toggleFilterTray() {
    if (this._isDestroyed) return;
    this._isSearchOpen = !this._isSearchOpen;
    this.header.updateSearchExpanded(this._isSearchOpen);
    if (this._toolbarEl) {
      this.filterTray.render(this._toolbarEl, this._rawEntries, this._isSearchOpen);
    }
  }

  closeFilterTray() {
    if (this._isDestroyed) return;
    this._isSearchOpen = false;
    this.header.updateSearchExpanded(false);
    if (this._toolbarEl) {
      this.filterTray.render(this._toolbarEl, this._rawEntries, false);
    }
  }

  reRenderBody() {
    if (this._isDestroyed || !this._bodyEl) return;
    const scrollContainer = this._bodyEl.closest(".dh-diary-view-container") || this._bodyEl.parentElement || this._bodyEl;
    const prevScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

    const filtered = this.diaryService.filterEntries(this._rawEntries);
    this.contentRenderer.render(this._bodyEl, filtered);

    if (scrollContainer && prevScrollTop > 0) {
      scrollContainer.scrollTop = prevScrollTop;
    }
  }

  async render(container) {
    if (this._isDestroyed) return;
    container.empty();
    container.addClass("dh-diary-view-container");
    const dir = this.plugin.translationManager?.t("direction") || "rtl";
    container.setAttribute("dir", dir);
    if (container.classList) {
      container.classList.toggle("is-rtl", dir === "rtl");
    } else if (container.toggleClass) {
      container.toggleClass("is-rtl", dir === "rtl");
    }
    this.contentRenderer.resetLimit();

    const loadId = ++this._currentLoadId;
    const t = (k, p) => this.plugin.translationManager?.t(k, p) || k;
    const loader = StatusView.renderLoading(
      container,
      t("diary_loading")
    );

    let entries;
    let loadError = null;
    try {
      entries = await this.diaryService.loadEntries();
    } catch (e) {
      console.error("[Core Habits] Failed to load diary entries:", e);
      loadError = e;
    } finally {
      if (loader && loader.element) loader.element.remove();
    }

    // Discard stale load results if a newer render request arrived while loading
    if (this._isDestroyed || this._currentLoadId !== loadId) {
      return;
    }

    if (loadError) {
      container.empty();
      StatusView.renderError(container, t("diary_load_error"));
      const retryBtn = container.createEl("button", {
        cls: "dh-btn mod-cta dh-diary-retry-btn",
        text: t("refresh")
      });
      retryBtn.onclick = () => { void this.render(container); };
      return;
    }

    this._rawEntries = entries;

    container.empty();

    // 1. Render Toolbar Container
    this._toolbarEl = container.createDiv({ cls: "dh-diary-smart-toolbar" });

    // 1.1 Header (Navigation + Period Selector)
    this.header.render(this._toolbarEl, async () => {
      await this.render(container);
    });
    this.header.updateSearchExpanded(this._isSearchOpen);

    // 1.2 Filter Tray (Search + Type Chips + Mobile Drawer)
    this.filterTray.render(this._toolbarEl, this._rawEntries, this._isSearchOpen);

    // 2. Render Main Body Container
    this._bodyEl = container.createDiv({ cls: "dh-diary-body" });
    const filtered = this.diaryService.filterEntries(this._rawEntries);
    this.contentRenderer.render(this._bodyEl, filtered);
  }

  /**
   * Cleanup lifecycle method to cancel pending operations and detach listeners
   */
  destroy() {
    this._isDestroyed = true;
    this._currentLoadId++;
    if (this.filterTray) {
      this.filterTray.destroy();
    }
    this._bodyEl = null;
    this._toolbarEl = null;
    this._rawEntries = [];
    this.cardRenderer.expandedEntries.clear();
  }
}
