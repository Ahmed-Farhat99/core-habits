import { Modal } from 'obsidian';

export class BaseHabitModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("daily-habits-plugin");

    const t = (k, params = {}) => this.plugin.translationManager.t(k, params);
    const dir = t("direction");
    contentEl.setAttr("dir", dir);
    if (dir === "rtl") {
      contentEl.addClass("is-rtl");
    } else {
      contentEl.removeClass("is-rtl");
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
