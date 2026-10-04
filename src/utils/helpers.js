import { NoticeService } from '../services/NoticeService.js';
import { TRANSLATIONS } from '../locales/index.js';

async function getNoteByDate(app, dateMoment, createIfNeeded = false, pluginSettings = null) {
  const info = getDailyNotesInfo(app, pluginSettings);
  const format = info.format;
  const templatePath = info.template;

  // The previous call to .locale('ar') mutated the shared moment object, causing this to be Arabic.
  // We clone it and force english for the filename generation.
  const fileName = dateMoment.clone().locale("en").format(format);

  const normalizedPath = getDailyNotePath(dateMoment, info);

  let file = app.vault.getAbstractFileByPath(normalizedPath);
  if (!file && createIfNeeded) {
    try {
      // 1. Try internal daily-notes plugin
      const dnPlugin = info.source === "daily-notes" && typeof app.internalPlugins?.getPluginById === "function" 
        ? app.internalPlugins.getPluginById("daily-notes") 
        : null;
      if (dnPlugin && dnPlugin.enabled && dnPlugin.instance && typeof dnPlugin.instance.createDailyNote === "function") {
        const created = await dnPlugin.instance.createDailyNote(dateMoment);
        if (created?.path === normalizedPath) file = created;
        else if (created) console.warn("[Core Habits] Daily Notes returned an unexpected path:", created.path);
      }
    } catch (e) {
      console.warn("[Core Habits] Failed to create daily note using daily-notes plugin:", e);
    }

    if (!file) {
      // 2. Try periodic-notes plugin
      try {
        const pnPlugin = info.source === "periodic-notes" ? app.plugins?.getPlugin("periodic-notes") : null;
        if (pnPlugin && typeof pnPlugin.createDailyNote === "function") {
          const created = await pnPlugin.createDailyNote(dateMoment);
          if (created?.path === normalizedPath) file = created;
          else if (created) console.warn("[Core Habits] Periodic Notes returned an unexpected path:", created.path);
        }
      } catch (e) {
        console.warn("[Core Habits] Failed to create daily note using periodic-notes plugin:", e);
      }
    }

    if (!file) {
      // 3. Fallback: manual creation
      try {
        const parentPath = normalizedPath.includes("/") ? normalizedPath.slice(0, normalizedPath.lastIndexOf("/")) : "";
        if (parentPath) {
          let current = "";
          for (const part of parentPath.split("/")) {
            current = current ? `${current}/${part}` : part;
            if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
          }
        }

        let content = "";
        if (templatePath) {
          // Normalize template path
          let templateFilePath = templatePath;
          if (!templateFilePath.endsWith(".md")) {
            templateFilePath += ".md";
          }

          const templateFile = app.vault.getAbstractFileByPath(templateFilePath);
          if (templateFile) {
            try {
              content = await app.vault.read(templateFile);
              content = content.replace(/\{\{date\}\}/g, fileName);
              content = content.replace(/\{\{title\}\}/g, fileName);
              content = content.replace(/\{\{date:([^}]+)\}\}/g, (match, fmt) => {
                return dateMoment.clone().locale("en").format(fmt);
              });
            } catch (e) {
              console.warn("[Core Habits] Could not read template:", e);
            }
          }
        }

        file = await app.vault.create(normalizedPath, content);
      } catch (err) {
        console.error("[Core Habits] Failed to create daily note manually:", err);
        const lang = pluginSettings?.language || "ar";
        const msg = TRANSLATIONS[lang]?.notice_could_not_create_daily_note
          || (lang === "ar" ? "تعذر إنشاء الملاحظة اليومية" : "Could not create daily note");
        NoticeService.error(msg, { plugin: { settings: pluginSettings } });
        return null;
      }
    }
  }
  return file;
}

function normalizeDailyFolder(folder) {
  return String(folder || "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}

function getDailyNotePath(dateMoment, info) {
  if (!dateMoment) return "";
  const folder = normalizeDailyFolder(info?.folder);
  const momentFactory = window.moment || globalThis.moment;
  const momentObj = typeof dateMoment.clone === "function"
    ? dateMoment.clone()
    : (typeof momentFactory === "function" ? momentFactory(dateMoment) : null);
  const name = momentObj && typeof momentObj.locale === "function" && typeof momentObj.format === "function" && (!momentObj.isValid || momentObj.isValid())
    ? momentObj.locale("en").format(info?.format || "YYYY-MM-DD")
    : "";
  if (!name) return "";
  return `${folder ? `${folder}/` : ""}${name}.md`.replace(/\/+/g, "/");
}

function getDailyNoteDate(file, app, pluginSettings = null) {
  if (!file?.path?.endsWith(".md")) return null;
  const info = getDailyNotesInfo(app, pluginSettings);
  const folder = normalizeDailyFolder(info.folder);
  const prefix = folder ? `${folder}/` : "";
  if (!file.path.startsWith(prefix)) return null;
  const relative = file.path.slice(prefix.length, -3);
  if (!folder && relative.includes("/") && !(info.format || "").includes("/")) return null;
  const momentFactory = window.moment || globalThis.moment;
  const date = momentFactory(relative, info.format || "YYYY-MM-DD", true);
  return date.isValid() && getDailyNotePath(date, info) === file.path ? date : null;
}



class TextUtils {
  static clean(text) {
    if (!text) return "";
    return text.normalize("NFC").replace(/\[\[|\]\]/g, "").trim();
  }

  static foldArabic(text) {
    if (!text) return "";
    return text.normalize("NFC")
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .toLowerCase()
      .trim();
  }

  static normalizeNumerals(str, toArabic = false) {
    if (!str) return "";
    const arabicDigits = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
    const englishDigits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    if (toArabic) {
      return str.replace(/[0-9]/g, (w) => arabicDigits[parseInt(w)]);
    } else {
      return str.replace(/[٠-٩]/g, (w) => englishDigits[arabicDigits.indexOf(w)]);
    }
  }
}

function findHabitEntry(scannedHabits, linkText, nameHistory = [], habitId = null) {
  if (!scannedHabits) return null;
  if (habitId) {
    const match = scannedHabits.find(h => h.habitId === habitId);
    if (match) return match;
  }
  const allNames = [
    TextUtils.foldArabic(linkText),
    ...nameHistory.map(n => TextUtils.foldArabic(n)),
  ];
  return scannedHabits.find(h => {
    // A different explicit ID is never an alias of this habit.
    if (habitId && h.habitId && h.habitId !== habitId) return false;
    const t = TextUtils.foldArabic(h.text);
    return allNames.some(name => t === name || t.startsWith(name + " "));
  });
}


/**
 * Builds a flat sorted list (parents then children) and display labels (e.g. "1", "2.1").
 * Orphan habits automatically act as top-level habits to gracefully handle archiving/deletion.
 */
function buildHierarchyLabels(habits) {
  if (!Array.isArray(habits) || habits.length === 0) return { sorted: [], labels: [] };

  const activeIds = new Set(habits.map(h => h.id));
  const getEffectiveParentId = (h) => {
    if (!h.parentId) return null;
    return activeIds.has(h.parentId) ? h.parentId : null;
  };

  const topLevel = habits.filter(h => getEffectiveParentId(h) === null)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const sorted = [];
  const labels = [];
  let pCounter = 0;
  const cMap = new Map();

  for (const parent of topLevel) {
    sorted.push(parent);

    pCounter++;
    labels.push(String(pCounter));

    const children = habits.filter(h => getEffectiveParentId(h) === parent.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    for (const child of children) {
      sorted.push(child);
      const cc = (cMap.get(parent.id) || 0) + 1;
      cMap.set(parent.id, cc);
      labels.push(`${pCounter}.${cc}`);
    }
  }

  return { sorted, labels };
}

class DateUtils {
  /** @param {moment.Moment} date - Moment instance. Returns YYYY-MM-DD in en locale for stable keys. */
  static formatDateKey(date) {
    return date && typeof date.clone === "function"
      ? date.clone().locale("en").format("YYYY-MM-DD")
      : "";
  }

  static getHijriDate(date, isAr = true) {
    if (!date) return "-";
    try {
      let nativeDate;
      if (date instanceof Date) {
        nativeDate = date;
      } else if (date && typeof date.toDate === "function") {
        nativeDate = date.toDate();
      } else if (date && typeof date === "object" && date._d) {
        nativeDate = date._d;
      } else {
        nativeDate = new Date(date);
      }

      if (isNaN(nativeDate.getTime())) return isAr ? "التاريخ الهجري غير متاح" : "Hijri date unavailable";

      const localeString = isAr ? "ar-SA-u-ca-islamic-umalqura" : "en-u-ca-islamic-umalqura";
      const formatter = new Intl.DateTimeFormat(localeString, {
        day: "numeric",
        month: "long",
        year: "numeric",
      });

      let formatted = formatter.format(nativeDate);
      
      // Normalize Eastern Arabic numerals to Western Arabic numerals
      return TextUtils.normalizeNumerals(formatted, false);
    } catch (error) {
      console.warn("[Core Habits] Hijri date format error:", error);
      return isAr ? "التاريخ الهجري غير متاح" : "Hijri date unavailable";
    }
  }
}

function getDailyNotesInfo(app, pluginSettings = null) {
  const fallbackFormat = pluginSettings?.dateFormat || "YYYY-MM-DD";
  const fallbackFolder = pluginSettings?.dailyNotesFolder || "";
  let info = { source: "defaults", enabled: true, format: fallbackFormat, folder: fallbackFolder, template: "" };

  if (pluginSettings?.dailyNotesSource === "manual") {
    info.source = "manual";
    return info;
  }

  try {
    const dnPlugin = typeof app.internalPlugins?.getPluginById === "function" 
      ? app.internalPlugins.getPluginById("daily-notes") 
      : null;
    if (dnPlugin && dnPlugin.enabled) {
      info.source = "daily-notes";
      if (dnPlugin.instance?.options) {
        info.format = dnPlugin.instance.options.format || info.format;
        info.folder = dnPlugin.instance.options.folder || info.folder;
        info.template = dnPlugin.instance.options.template || "";
      }
      return info;
    }
  } catch { /* ignore */ }

  try {
    const pn = app.plugins?.getPlugin("periodic-notes");
    if (pn?.settings?.daily?.enabled) {
      info.source = "periodic-notes";
      info.format = pn.settings.daily.format || info.format;
      info.folder = pn.settings.daily.folder || info.folder;
      info.template = pn.settings.daily.template || "";
      return info;
    }
  } catch { /* ignore */ }

  if (fallbackFolder || (pluginSettings?.dateFormat && pluginSettings.dateFormat !== "YYYY-MM-DD")) {
    info.source = "manual";
  }

  return info;
}

function autoResizeTextarea(textarea) {
  if (!textarea) return;
  if (textarea.offsetWidth > 0) {
    // 1. Temporarily hide scrollbar to get accurate scrollHeight calculation
    textarea.style.overflowY = "hidden";
    textarea.style.height = "auto";
    
    const scrollHeight = textarea.scrollHeight;
    
    // 2. Set height to scrollHeight
    textarea.style.height = `${scrollHeight}px`;
    
    // 3. If offsetHeight is less than scrollHeight, it reached max-height constraint
    if (textarea.offsetHeight < scrollHeight) {
      textarea.style.overflowY = "auto";
    } else {
      textarea.style.overflowY = "hidden";
    }
  } else {
    textarea.style.height = "auto";
    textarea.style.overflowY = "hidden";
  }
}

/**
 * Unifies count and pluralization rules for days across Arabic and English.
 * Eliminates conflicting "يومان" vs "يومين" and formats duals/plurals accurately.
 *
 * @param {number} count - Number of days
 * @param {string} [lang="ar"] - Language code ("ar" or "en")
 * @param {Object} [options={}] - Options { standalone: boolean, includeNumber: boolean }
 * @returns {string} Formatted string, e.g. "يوم واحد", "يومان", "3 أيام", "14 يوماً", "1 day", "14 days"
 */
function formatDaysCount(count, lang = "ar", options = {}) {
  const num = Math.max(0, Math.floor(Number(count) || 0));
  if (lang !== "ar") {
    return num === 1 ? "1 day" : `${num} days`;
  }
  if (num === 0) return "0 يوم";
  if (num === 1) return options.standalone ? "يوم واحد" : (options.includeNumber ? "1 يوم" : "يوم واحد");
  if (num === 2) return "يومان";
  if (num >= 3 && num <= 10) return `${num} أيام`;
  return `${num} يوماً`;
}

/**
 * Returns just the grammatical unit for days given a count.
 * @param {number} count - Number of days
 * @param {string} [lang="ar"] - Language code ("ar" or "en")
 * @returns {string} e.g. "يوم", "يومان", "أيام", "يوماً", "day", "days"
 */
function getDaysUnit(count, lang = "ar") {
  const num = Math.max(0, Math.floor(Number(count) || 0));
  if (lang !== "ar") {
    return num === 1 ? "day" : "days";
  }
  if (num === 1) return "يوم";
  if (num === 2) return "يومان";
  if (num >= 3 && num <= 10) return "أيام";
  return "يوماً";
}

/**
 * Formats habit age and creation date into a humanized string.
 * @param {number|string|Date} createdAt - Habit creation timestamp or ISO date
 * @param {string} [lang="ar"] - Language ("ar" or "en")
 * @returns {{ formattedDate: string, ageText: string, daysCount: number }|null}
 */
function formatHabitAge(createdAt, lang = "ar") {
  if (!createdAt) return null;
  const isAr = lang === "ar";
  if (typeof createdAt === "string" && isNaN(Date.parse(createdAt))) return null;
  const m = typeof window !== "undefined" && window.moment ? window.moment(createdAt) : null;
  if (!m || !m.isValid()) return null;

  const now = typeof window !== "undefined" && window.moment ? window.moment() : null;
  if (!now) return null;

  const startOfCreation = m.clone().startOf("day");
  const startOfToday = now.clone().startOf("day");
  const diffDays = Math.max(0, startOfToday.diff(startOfCreation, "days"));

  const formattedDate = m.clone().locale(isAr ? "ar" : "en").format("D MMMM YYYY");

  if (diffDays === 0) {
    return {
      formattedDate,
      ageText: isAr ? "أنشئت اليوم ✨" : "Created today ✨",
      daysCount: 0
    };
  }

  if (diffDays < 30) {
    const daysStr = formatDaysCount(diffDays, isAr ? "ar" : "en");
    return {
      formattedDate,
      ageText: isAr ? `منذ ${daysStr}` : `${daysStr} ago`,
      daysCount: diffDays
    };
  }

  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    let monthLabel;
    if (isAr) {
      if (months === 1) monthLabel = "شهر واحد";
      else if (months === 2) monthLabel = "شهران";
      else if (months >= 3 && months <= 10) monthLabel = `${months} أشهر`;
      else monthLabel = `${months} شهراً`;
    } else {
      monthLabel = months === 1 ? "1 month" : `${months} months`;
    }
    const daysStr = formatDaysCount(diffDays, isAr ? "ar" : "en");
    return {
      formattedDate,
      ageText: isAr ? `منذ ${monthLabel} (${daysStr})` : `${monthLabel} ago (${daysStr})`,
      daysCount: diffDays
    };
  }

  const years = Math.floor(diffDays / 365);
  const remainingMonths = Math.floor((diffDays % 365) / 30);
  let yearLabel;
  if (isAr) {
    if (years === 1) yearLabel = "سنة واحدة";
    else if (years === 2) yearLabel = "سنتان";
    else if (years >= 3 && years <= 10) yearLabel = `${years} سنوات`;
    else yearLabel = `${years} سنة`;

    if (remainingMonths > 0) {
      const mStr = remainingMonths === 1 ? "وشهر" : remainingMonths === 2 ? "وشهران" : (remainingMonths <= 10 ? `و${remainingMonths} أشهر` : `و${remainingMonths} شهراً`);
      yearLabel += ` ${mStr}`;
    }
  } else {
    yearLabel = years === 1 ? "1 year" : `${years} years`;
    if (remainingMonths > 0) {
      yearLabel += ` ${remainingMonths} mo`;
    }
  }

  const daysStr = formatDaysCount(diffDays, isAr ? "ar" : "en");
  return {
    formattedDate,
    ageText: isAr ? `منذ ${yearLabel} (${daysStr})` : `${yearLabel} ago (${daysStr})`,
    daysCount: diffDays
  };
}

/**
 * Shows an Obsidian Menu anchored to a trigger element with proper Multi-Window (Popout) support and RTL positioning.
 * @param {import('obsidian').Menu} menu
 * @param {HTMLElement} triggerEl
 * @param {boolean} [isRTL=false]
 * @param {object} [options]
 * @param {number} [options.menuWidth=220]
 * @param {number} [options.offsetY=4]
 */
function showAnchoredMenu(menu, triggerEl, isRTL = false, options = {}) {
  if (!menu || !triggerEl) return;
  const rect = triggerEl.getBoundingClientRect();
  const doc = triggerEl.ownerDocument || document;
  const viewportWidth = doc.documentElement?.clientWidth || window.innerWidth;
  const menuWidth = options.menuWidth || 220;
  const offsetY = options.offsetY !== undefined ? options.offsetY : 4;
  const x = isRTL
    ? rect.right - menuWidth
    : rect.left;
  menu.showAtPosition({
    x: Math.max(8, Math.min(x, viewportWidth - menuWidth - 8)),
    y: rect.bottom + offsetY
  }, doc);
}

export {
  getNoteByDate,
  TextUtils,
  findHabitEntry,
  buildHierarchyLabels,
  DateUtils,
  getDailyNotesInfo,
  getDailyNoteDate,
  getDailyNotePath,
  autoResizeTextarea,
  formatDaysCount,
  getDaysUnit,
  formatHabitAge,
  showAnchoredMenu
};

export { Utils } from './Utils.js';
