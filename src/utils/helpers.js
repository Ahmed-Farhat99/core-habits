import { Notice } from 'obsidian';
import { Utils } from './Utils.js';
import { 
  DEFAULT_REFLECTION_HEADING, 
  DEFAULT_HABIT_NOTES_HEADING, 
  normalizeReflectionType,
  DAY_KEYS
} from '../constants.js';
import { StreakCalculator } from '../services/StreakCalculator.js';

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
      if (folder) {
        const folderExists = app.vault.getAbstractFileByPath(folder);
        if (!folderExists) await app.vault.createFolder(folder);
      }

      // Template support: read template and apply variables
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
      console.error("[Core Habits] Failed to create daily note:", err);
      new Notice(pluginSettings?.language === "ar" ? "⚠️ تعذر إنشاء الملاحظة اليومية" : "⚠️ Could not create daily note");
      return null;
    }
  }
  return file;
}

/**
 * Superfast extraction of habit logs from exactly the X most recent Daily Notes.
 * Completely decouples the habit log from the habit's own file.
 */
async function extractHabitHistoryFromDailyNotes(app, plugin, habitName, daysToLookBack = 30) {
  const entries = [];
  const cleanHabitName = TextUtils.clean(habitName);
  const now = window.moment();
  
  for (let i = 0; i < daysToLookBack; i++) {
    const targetDate = now.clone().subtract(i, 'days');
    const file = await getNoteByDate(app, targetDate, false, plugin.settings);
    if (!file) continue;

    const content = await app.vault.cachedRead(file);
    const lines = content.split('\n');
    
    for (const line of lines) {
      if (line.includes(`[habit-note:: ${cleanHabitName}]`)) {
        let cleanLine = line.trim();
        if (cleanLine.startsWith('- ')) {
          cleanLine = cleanLine.substring(2).trim();
        }
        // Remove the habit label text the user already knows they're looking at
        cleanLine = cleanLine.replace(new RegExp(`\\[habit-note:: ${Utils.escapeRegExp(cleanHabitName)}\\] .*? - `, "i"), "");
        
        entries.push({ date: targetDate, text: cleanLine });
      }
    }
  }
  return entries;
}




async function toggleHabit(plugin, app, file, habit, marker, targetState = null) {
  try {
    await app.vault.process(file, (data) => {
      const separator = data.includes("\r\n") ? "\r\n" : "\n";
      const lines = data.split(/\r?\n/);
      let targetIndex = habit.lineIndex;

      if (targetIndex >= 0 && targetIndex < lines.length) {
        if (!lines[targetIndex].includes(habit.text)) {
          targetIndex = -1;
        }
      } else {
        targetIndex = -1;
      }

      if (targetIndex === -1) {
        const safeText = Utils.escapeRegExp(habit.text);
        targetIndex = lines.findIndex((line) => {
          return /^\s*-\s*\[([ x-])\]/i.test(line) &&
            new RegExp(`(\\[\\[)?${safeText}(\\]\\])?`, "i").test(line);
        });
      }

      if (targetIndex === -1) {
        new Notice(plugin.settings.language === "ar" ? "⚠️ تعذر العثور على العادة في الملف. يرجى التحديث." : "⚠️ Could not find habit in file. Please reload.");
        return data;
      }

      const line = lines[targetIndex];
      const checkboxRegex = /^(\s*-\s*\[)([ x-])(\].*)$/i;
      const match = line.match(checkboxRegex);

      if (match) {
        let newChar;
        if (targetState === "completed") {
          newChar = "x";
        } else if (targetState === "skipped") {
          newChar = "-";
        } else if (targetState === "uncompleted") {
          newChar = " ";
        } else {
          const current = match[2].toLowerCase();
          newChar = current === "x" ? " " : "x";
        }
        lines[targetIndex] = `${match[1]}${newChar}${match[3]}`;
      }

      return lines.join(separator);
    });
    StreakCalculator.invalidate(habit.id);
    if (plugin._sharedStreakCache) {
      plugin._sharedStreakCache.clear();
    }
  } catch (error) {
    console.error("[Core Habits] Failed to toggle habit:", error);
    const isAr = plugin.settings.language === "ar";
    new Notice(isAr ? "⚠️ حدث خطأ أثناء تعديل الملاحظة." : "⚠️ Error modifying note.");
  }
}



// ═══════════════════════════════════════════════════════════════════════════════
// 5–6. UI — Modals, Views, Settings
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Simple file suggester modal using Obsidian's built-in FuzzySuggestModal.
 * This provides a clean, native Obsidian experience for file selection.
 */

function fixAudioDuration(audioEl) {
  audioEl.addEventListener('loadedmetadata', () => {
    if (audioEl.duration === Infinity || isNaN(audioEl.duration)) {
      audioEl.currentTime = 1e101;
      audioEl.addEventListener('timeupdate', function f() {
        audioEl.currentTime = 0;
        audioEl.removeEventListener('timeupdate', f);
      });
    }
  });
}

class TextUtils {
  static clean(text) {
    if (!text) return "";
    return text.normalize("NFC").replace(/\[\[|\]\]/g, "").trim();
  }
}

function findHabitEntry(scannedHabits, linkText, nameHistory = []) {
  if (!scannedHabits) return null;
  const allNames = [
    TextUtils.clean(linkText),
    ...nameHistory.map(n => TextUtils.clean(n)),
  ];
  return scannedHabits.find(h => {
    const t = TextUtils.clean(h.text);
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

  static getHijriDate(date) {
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

      if (isNaN(nativeDate.getTime())) return "التاريخ الهجري غير متاح";

      const formatter = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });

      let formatted = formatter.format(nativeDate);
      const arabicToEnglish = {
        "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
        "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
      };

      return formatted.replace(/[٠-٩]/g, (digit) => arabicToEnglish[digit]);
    } catch (error) {
      console.warn("[Core Habits] Hijri date format error:", error);
      return "التاريخ الهجري غير متاح";
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
  } catch(e) { /* ignore */ }

  try {
    const pn = app.plugins?.getPlugin("periodic-notes");
    if (pn?.settings?.daily?.enabled) {
      info.source = "periodic-notes";
      info.format = pn.settings.daily.format || info.format;
      info.folder = pn.settings.daily.folder || info.folder;
      info.template = pn.settings.daily.template || "";
      return info;
    }
  } catch(e) { /* ignore */ }

  if (fallbackFolder || (pluginSettings?.dateFormat && pluginSettings.dateFormat !== "YYYY-MM-DD")) {
    info.source = "manual";
  }

  return info;
}

/**
 * Safely ensures a section (heading) exists in a file and appends a new line under it.
 * Uses vault.process for atomic read-write to prevent data loss.
 * @param {App} app - Obsidian App instance
 * @param {TFile} file - The file to modify
 * @param {string} heading - The markdown heading (e.g. "## 📖 سجل المتابعة")
 * @param {string} newLine - The line to append under the heading
 */
async function ensureNestedSectionInFile(app, file, parentHeading, subHeading, newLine) {
  await app.vault.process(file, (content) => {
    return Utils.insertNestedContent(content, parentHeading, subHeading, newLine);
  });
}

/**
 * Injects a timestamped habit comment into the matching Daily Note.
 */
async function injectHabitCommentIntoDailyNote(app, plugin, habit, targetDate, comment) {
  const file = await getNoteByDate(app, targetDate, true, plugin.settings);
  if (!file) {
    throw new Error(plugin.settings.language === "ar"
      ? "تعذر فتح ملف اليوم."
      : "Could not open the daily note.");
  }

  const timeStr = window.moment().format("HH:mm");
  const cleanName = TextUtils.clean(habit.linkText || habit.name);
  const habitLabel = habit.linkText || habit.name;
  const commentLine = `- ${timeStr} [habit-note:: ${cleanName}] ${habitLabel} - ${comment}`;
  const heading = plugin.settings.habitLogHeading || DEFAULT_HABIT_NOTES_HEADING;

  await ensureNestedSectionInFile(app, file, plugin.settings.dailyParentHeading, heading, commentLine);
  return file.basename;
}

/**
 * Injects a typed daily reflection into the matching Daily Note.
 */
async function injectReflectionIntoDailyNote(app, plugin, targetDate, text, type = "Idea") {
  const file = await getNoteByDate(app, targetDate, true, plugin.settings);
  if (!file) {
    throw new Error(plugin.settings.language === "ar"
      ? "تعذر فتح ملف اليوم."
      : "Could not open the daily note.");
  }

  const timeStr = window.moment().format("HH:mm");
  const reflectionType = normalizeReflectionType(type);
  const reflectionLine = `- ${timeStr} [type:: ${reflectionType}] ${text}`;
  const heading = plugin.settings.reflectionHeading || DEFAULT_REFLECTION_HEADING;

  await ensureNestedSectionInFile(app, file, plugin.settings.dailyParentHeading, heading, reflectionLine);
  return file.basename;
}



export { getNoteByDate, extractHabitHistoryFromDailyNotes, toggleHabit, fixAudioDuration, TextUtils, findHabitEntry, calculateCurrentLevel, buildHierarchyLabels, DateUtils, getDailyNotesInfo, ensureNestedSectionInFile, injectHabitCommentIntoDailyNote, injectReflectionIntoDailyNote };
