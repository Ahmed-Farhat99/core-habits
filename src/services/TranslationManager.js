import { TRANSLATIONS } from '../constants.js';

export class TranslationManager {
  constructor(plugin) {
    this.plugin = plugin;
  }

  t(key, params = {}) {
    const lang = this.plugin.settings.language || "ar";
    const dict = TRANSLATIONS[lang] || TRANSLATIONS["en"];
    let text = dict[key] || TRANSLATIONS["en"][key] || key;

    Object.keys(params).forEach((param) => {
      text = text.replace(`{${param}}`, params[param]);
    });

    return text;
  }
}
