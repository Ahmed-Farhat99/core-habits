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
export class Plugin {}
export class ItemView {}
export class PluginSettingTab {}
export class Modal {}
export class FuzzySuggestModal {}

export class Notice {
  constructor(message) {
    this.message = message;
  }
  hide() {}
}

export class Setting {
  constructor() {}
}

export const Platform = { isMobile: false };
export const normalizePath = (path) => String(path || "").replace(/\\/g, "/").replace(/\/+/g, "/");
export const debounce = (fn) => fn;
export const setIcon = () => {};
