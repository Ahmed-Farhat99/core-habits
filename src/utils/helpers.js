import { Notice } from 'obsidian';

async function getNoteByDate(app, dateMoment, createIfNeeded = false, pluginSettings = null) {
  const info = getDailyNotesInfo(app, pluginSettings);
  let format = info.format;
  let folder = info.folder;
  let templatePath = info.template;

  // The previous call to .locale('ar') mutated the shared moment object, causing this to be Arabic.
  // We clone it and force english for the filename generation.
  let fileName = dateMoment.clone().locale("en").format(format);

  let normalizedPath = folder ? `${folder}/${fileName}.md` : `${fileName}.md`;
  normalizedPath = normalizedPath.replace(/\/+/g, "/");

  let file = app.vault.getAbstractFileByPath(normalizedPath);
  if (!file && createIfNeeded) {
    try {
      // 1. Try internal daily-notes plugin
      const dnPlugin = app.internalPlugins.getPluginById("daily-notes");
      if (dnPlugin && dnPlugin.enabled && dnPlugin.instance && typeof dnPlugin.instance.createDailyNote === "function") {
        file = await dnPlugin.instance.createDailyNote(dateMoment);
      }
    } catch (e) {
      console.warn("[Core Habits] Failed to create daily note using daily-notes plugin:", e);
    }

    if (!file) {
      // 2. Try periodic-notes plugin
      try {
        const pnPlugin = app.plugins?.getPlugin("periodic-notes");
        if (pnPlugin && typeof pnPlugin.createDailyNote === "function") {
          file = await pnPlugin.createDailyNote(dateMoment);
        }
      } catch (e) {
        console.warn("[Core Habits] Failed to create daily note using periodic-notes plugin:", e);
      }
    }

    if (!file) {
      // 3. Fallback: manual creation
      try {
        if (folder) {
          const folderExists = app.vault.getAbstractFileByPath(folder);
          if (!folderExists) await app.vault.createFolder(folder);
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
        new Notice(pluginSettings?.language === "ar" ? "⚠️ تعذر إنشاء الملاحظة اليومية" : "⚠️ Could not create daily note");
        return null;
      }
    }
  }
  return file;
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
    const t = TextUtils.foldArabic(h.text);
    return allNames.some(name => t === name || t.startsWith(name + " "));
  });
}

function calculateCurrentLevel(levelData) {
  if (!levelData) return null;
  let maxAchieved = -1;
  for (let i = 0; i < 5; i++) {
    if (levelData[i]?.achieved) maxAchieved = i;
  }
  return maxAchieved === -1 ? 1 : Math.min(maxAchieved + 2, 5);
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
      
      // Convert Eastern Arabic numerals to Western Arabic numerals if present
      const arabicToEnglish = {
        "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
        "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
      };

      return formatted.replace(/[٠-٩]/g, (digit) => arabicToEnglish[digit]);
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
    const dnPlugin = app.internalPlugins.getPluginById("daily-notes");
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

export { getNoteByDate, TextUtils, findHabitEntry, calculateCurrentLevel, buildHierarchyLabels, DateUtils, getDailyNotesInfo, autoResizeTextarea };
