import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { ar } from "../src/locales/ar.js";
import { en } from "../src/locales/en.js";
import { TranslationManager } from "../src/services/TranslationManager.js";

describe("Localization System Hardening", () => {

  it("should have zero duplicate keys in ar.js raw file", () => {
    const content = fs.readFileSync(path.resolve("src/locales/ar.js"), "utf8");
    const lines = content.split("\n");
    const keyRegex = /^\s*(['"]?)([a-zA-Z0-9_-]+)\1\s*:/;
    const seen = new Set();
    const dupes = [];

    lines.forEach((line) => {
      const match = line.match(keyRegex);
      if (match) {
        const key = match[2];
        if (seen.has(key)) {
          dupes.push(key);
        }
        seen.add(key);
      }
    });

    expect(dupes).toEqual([]);
  });

  it("should have zero duplicate keys in en.js raw file", () => {
    const content = fs.readFileSync(path.resolve("src/locales/en.js"), "utf8");
    const lines = content.split("\n");
    const keyRegex = /^\s*(['"]?)([a-zA-Z0-9_-]+)\1\s*:/;
    const seen = new Set();
    const dupes = [];

    lines.forEach((line) => {
      const match = line.match(keyRegex);
      if (match) {
        const key = match[2];
        if (seen.has(key)) {
          dupes.push(key);
        }
        seen.add(key);
      }
    });

    expect(dupes).toEqual([]);
  });

  it("should have all t() keys used across src/ codebase present in both ar.js and en.js", () => {
    function getAllJsFiles(dir) {
      let files = [];
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          files = files.concat(getAllJsFiles(fullPath));
        } else if (item.name.endsWith(".js") && !fullPath.includes("locales")) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const jsFiles = getAllJsFiles(path.resolve("src"));
    const usedKeys = new Set();
    const tCallRegex = /(?:(?:\bthis\.translationManager|\bthis|\bplugin\.translationManager)?\.t|(?:\btranslationManager|\bt))\(\s*["']([a-zA-Z0-9_-]+)["']/g;

    for (const file of jsFiles) {
      const content = fs.readFileSync(file, "utf8");
      let match;
      while ((match = tCallRegex.exec(content)) !== null) {
        usedKeys.add(match[1]);
      }
    }

    const missingInAr = [];
    const missingInEn = [];

    for (const key of usedKeys) {
      if (!(key in ar)) missingInAr.push(key);
      if (!(key in en)) missingInEn.push(key);
    }

    expect(missingInAr, `Missing keys in ar.js: ${missingInAr.join(", ")}`).toEqual([]);
    expect(missingInEn, `Missing keys in en.js: ${missingInEn.join(", ")}`).toEqual([]);
  });

  it("should have zero unreferenced/dead keys in localization dictionaries", () => {
    function getAllJsFiles(dir) {
      let files = [];
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          files = files.concat(getAllJsFiles(fullPath));
        } else if (item.name.endsWith(".js") && !fullPath.includes("locales")) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const jsFiles = getAllJsFiles(path.resolve("src"));
    const srcCombined = jsFiles.map(f => fs.readFileSync(f, "utf8")).join("\n");

    const dynamicWhitelistedPrefixes = ["color_", "status_", "completion_msg_", "stats_trend_sub_"];
    const dynamicWhitelistedExact = new Set([
      "sun", "mon", "tue", "wed", "thu", "fri", "sat",
      "sun_short", "mon_short", "tue_short", "wed_short", "thu_short", "fri_short", "sat_short",
      "direction", "edit_habit_title", "custom_range_error_empty", "custom_range_error_invalid",
      "post_stages_progression"
    ]);

    const deadKeys = [];
    for (const key of Object.keys(ar)) {
      if (dynamicWhitelistedExact.has(key) || dynamicWhitelistedPrefixes.some(p => key.startsWith(p))) {
        continue;
      }
      if (!srcCombined.includes(`"${key}"`) && !srcCombined.includes(`'${key}'`) && !srcCombined.includes(`\`${key}\``)) {
        deadKeys.push(key);
      }
    }

    expect(deadKeys, `Found obsolete/dead translation keys in ar.js: ${deadKeys.join(", ")}`).toEqual([]);
  });


  it("should have 100% key symmetry between ar.js and en.js", () => {
    const arKeys = Object.keys(ar);
    const enKeys = Object.keys(en);

    const missingInAr = enKeys.filter(k => !(k in ar));
    const missingInEn = arKeys.filter(k => !(k in en));

    expect(missingInAr, `Keys in en.js but missing in ar.js: ${missingInAr.join(", ")}`).toEqual([]);
    expect(missingInEn, `Keys in ar.js but missing in en.js: ${missingInEn.join(", ")}`).toEqual([]);
  });

  it("should have matching interpolation parameters across all keys in ar.js and en.js", () => {
    const paramRegex = /\{([a-zA-Z0-9_]+)\}/g;
    const mismatches = [];

    for (const key of Object.keys(ar)) {
      if (!(key in en)) continue;
      const arParams = [...ar[key].matchAll(paramRegex)].map(m => m[1]).sort();
      const enParams = [...en[key].matchAll(paramRegex)].map(m => m[1]).sort();
      if (arParams.join(",") !== enParams.join(",")) {
        mismatches.push({ key, arParams, enParams });
      }
    }

    expect(mismatches, `Interpolation parameter mismatches found: ${JSON.stringify(mismatches)}`).toEqual([]);
  });

  it("should maintain unified status taxonomy in both languages", () => {
    expect(ar.status_completed).toBe("مُنجَز");
    expect(ar.status_skipped).toBe("معذور");
    expect(ar.status_missed).toBe("فائت");
    expect(ar.status_uncompleted).toBe("بانتظار الإنجاز");
    expect(ar.status_not_scheduled).toBe("غير مجدول");
    expect(ar.status_future).toBe("قادم");

    expect(en.status_completed).toBe("Completed");
    expect(en.status_skipped).toBe("Excused");
    expect(en.status_missed).toBe("Missed");
    expect(en.status_uncompleted).toBe("Pending");
    expect(en.status_not_scheduled).toBe("Not scheduled");
    expect(en.status_future).toBe("Upcoming");
  });

  describe("TranslationManager runtime behavior", () => {
    it("should translate keys correctly in Arabic", () => {
      const mockPlugin = { settings: { language: "ar" } };
      const tm = new TranslationManager(mockPlugin);

      expect(tm.t("edit_habit_title")).toBe("تعديل العادة");
      expect(tm.t("add_habit_title")).toBe("إضافة عادة جديدة");
    });

    it("should translate keys correctly in English", () => {
      const mockPlugin = { settings: { language: "en" } };
      const tm = new TranslationManager(mockPlugin);

      expect(tm.t("edit_habit_title")).toBe("Edit Habit");
      expect(tm.t("add_habit_title")).toBe("Add New Habit");
    });

    it("should replace interpolation parameters", () => {
      const mockPlugin = { settings: { language: "ar" } };
      const tm = new TranslationManager(mockPlugin);

      const res = tm.t("notice_habit_updated", { name: "القراءة" });
      expect(res).toBe("تم تحديث القراءة");
    });

    it("should safely return empty string on non-existent keys without exposing raw keys", () => {
      const mockPlugin = { settings: { language: "ar" } };
      const tm = new TranslationManager(mockPlugin);

      expect(tm.t("completely_non_existent_key")).toBe("");
    });

    it("should allow short-circuit fallback operators to work on missing keys", () => {
      const mockPlugin = { settings: { language: "ar" } };
      const tm = new TranslationManager(mockPlugin);

      const title = tm.t("non_existent_heading") || "عنوان افتراضي";
      expect(title).toBe("عنوان افتراضي");
    });
  });

  describe("detectInitialLanguage", () => {
    it("should return en by default without using localStorage", async () => {
      const { detectInitialLanguage } = await import("../src/config/defaultSettings.js");
      expect(detectInitialLanguage()).toBe("en");
    });
  });
});
