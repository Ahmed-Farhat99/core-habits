import { TRANSLATIONS } from '../constants.js';

export class TranslationManager {
  constructor(plugin) {
    this.plugin = plugin;
  }

  t(key, params = {}, fallback = "") {
    const lang = this.plugin?.settings?.language || "ar";
    const dict = TRANSLATIONS[lang] || TRANSLATIONS["en"] || {};
    let text = dict[key] ?? TRANSLATIONS["en"]?.[key];

    if (text === undefined || text === null) {
      if (typeof params === "string") return params;
      if (typeof fallback === "string" && fallback) return fallback;
      return "";
    }

    if (typeof text === "string" && params && typeof params === "object") {
      Object.keys(params).forEach((param) => {
        text = text.replace(new RegExp(`\\{${param}\\}`, "g"), params[param]);
      });
    }

    return text;
  }
}

