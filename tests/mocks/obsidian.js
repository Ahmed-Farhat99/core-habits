export class TAbstractFile {
  constructor(path = "") {
    this.path = path;
    this.name = path.split("/").pop() || "";
  }
}

export class TFile extends TAbstractFile {
  constructor(path = "", stat = {}) {
    super(path);
    this.basename = this.name.replace(/\.md$/i, "");
    this.extension = this.name.includes(".") ? this.name.split(".").pop() : "";
    this.stat = { ctime: 0, mtime: 0, size: 0, ...stat };
  }
}

export class TFolder extends TAbstractFile {}
export class App {}
export class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
  }
}
export class ItemView {
  constructor(leaf) {
    this.leaf = leaf;
    this.containerEl = document.createElement("div");
    this.contentEl = document.createElement("div");
    this.containerEl.appendChild(this.contentEl);
  }
  getViewType() { return ""; }
  getDisplayText() { return ""; }
  getIcon() { return ""; }
  async onOpen() {}
  async onClose() {}
}
export class PluginSettingTab {}
export class Modal {
  constructor(app) {
    this.app = app;
    this.contentEl = document.createElement("div");
    this.modalEl = document.createElement("div");
  }
  open() {
    if (typeof this.onOpen === "function") this.onOpen();
  }
  close() {
    if (typeof this.onClose === "function") this.onClose();
  }
}
export class FuzzySuggestModal {}
export class Menu {
  constructor() {
    this.items = [];
  }
  addItem(cb) {
    const item = {
      title: "",
      icon: "",
      checked: false,
      onClickHandler: null,
      setTitle(t) { this.title = t; return this; },
      setIcon(i) { this.icon = i; return this; },
      setChecked(c) { this.checked = c; return this; },
      onClick(fn) { this.onClickHandler = fn; return this; }
    };
    cb(item);
    this.items.push(item);
    return this;
  }
  addSeparator() { return this; }
  showAtMouseEvent() { return this; }
  showAtPosition() { return this; }
}

export class Notice {
  constructor(message, duration) {
    this.message = message;
    this.duration = duration;
    this.noticeEl = document.createElement("div");
    this.noticeEl.className = "notice";
    if (message) {
      this.noticeEl.textContent = message;
    }
  }
  hide() {}
}

export class Setting {
  constructor(containerEl) {
    this.settingEl = containerEl ? (containerEl.createDiv ? containerEl.createDiv({ cls: 'setting-item' }) : document.createElement('div')) : null;
  }
  setName() { return this; }
  setDesc() { return this; }
  setClass() { return this; }
  setTooltip() { return this; }
  setHeading() { return this; }
  then(cb) { if (cb) cb(this); return this; }
  addToggle(cb) {
    if (cb) {
      const toggle = { setValue: () => toggle, onChange: () => toggle };
      cb(toggle);
    }
    return this;
  }
  addDropdown(cb) {
    if (cb) {
      const dropdown = { addOption: () => dropdown, setValue: () => dropdown, onChange: () => dropdown };
      cb(dropdown);
    }
    return this;
  }
  addText(cb) {
    if (cb) {
      const inputEl = document.createElement('input');
      const text = { inputEl, setPlaceholder: () => text, setValue: () => text, onChange: () => text };
      cb(text);
    }
    return this;
  }
  addSlider(cb) {
    if (cb) {
      const slider = { setLimits: () => slider, setValue: () => slider, setDynamicTooltip: () => slider, onChange: () => slider };
      cb(slider);
    }
    return this;
  }
  addButton(cb) {
    if (cb) {
      const btn = { setButtonText: () => btn, setCta: () => btn, setWarning: () => btn, onClick: () => btn };
      cb(btn);
    }
    return this;
  }
  addSearch(cb) {
    if (cb) {
      const search = { setPlaceholder: () => search, setValue: () => search, onChange: () => search };
      cb(search);
    }
    return this;
  }
}

export const Platform = { isMobile: false };
export const normalizePath = (path) => String(path || "").replace(/\\/g, "/").replace(/\/+/g, "/");
export const debounce = (fn) => fn;
export const setIcon = () => {};

export class MarkdownRenderer {
  static async render(app, markdown, el) {
    if (el) el.textContent = markdown;
  }
  static async renderMarkdown(markdown, el) {
    if (el) el.textContent = markdown;
  }
}
