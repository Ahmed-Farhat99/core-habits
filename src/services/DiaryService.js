import { normalizeReflectionType, DEFAULT_REFLECTION_HEADING, KNOWN_REFLECTION_HEADINGS } from '../constants.js';
import { DateUtils, TextUtils, getNoteByDate, getDailyNoteDate } from '../utils/helpers.js';

import { DiaryParser } from './DiaryParser.js';

export const DIARY_PERIODS = {
  WEEK: 'week',
  TWO_WEEKS: 'two_weeks',
  MONTH: 'month',
  QUARTER: 'quarter',
  CUSTOM: 'custom',
  ALL: 'all'
};

export class DiaryService {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;

    this.periodType = DIARY_PERIODS.WEEK;
    this.anchorMoment = window.moment();
    this.customStartDate = null;
    this.customEndDate = null;

    this.searchQuery = "";
    this.selectedType = "ALL";
    this.hideEmptyDays = true;

    // Cache: Map<dateKey, Array<entry>>
    this.entriesCache = new Map();
    this.dirtyFiles = new Set();
    this._isLoading = false;
  }

  getPeriodType() {
    return this.periodType;
  }

  setPeriodType(type) {
    if (Object.values(DIARY_PERIODS).includes(type)) {
      this.periodType = type;
    }
  }

  getHideEmptyDays() {
    return this.hideEmptyDays;
  }

  setHideEmptyDays(val) {
    this.hideEmptyDays = Boolean(val);
  }

  getSearchQuery() {
    return this.searchQuery;
  }

  setSearchQuery(query) {
    this.searchQuery = String(query || "").trim();
  }

  getSelectedType() {
    return this.selectedType;
  }

  setSelectedType(type) {
    this.selectedType = type || "ALL";
  }

  hasActiveFilters() {
    return Boolean(this.searchQuery || (this.selectedType && this.selectedType !== "ALL"));
  }

  getActiveFilterCount() {
    let count = 0;
    if (this.searchQuery) count++;
    if (this.selectedType && this.selectedType !== "ALL") count++;
    return count;
  }

  resetFilters() {
    this.searchQuery = "";
    this.selectedType = "ALL";
  }

  isCurrentRangeContainingToday() {
    if (this.periodType === DIARY_PERIODS.ALL) return true;
    const { startDate, endDate } = this.getRange();
    if (!startDate || !endDate) return true;
    const today = window.moment();
    return today.isBetween(startDate, endDate, "day", "[]");
  }

  getReflectionHeading() {
    return this.plugin?.settings?.reflectionHeading || DEFAULT_REFLECTION_HEADING;
  }

  /**
   * Resets navigation to include today
   */
  goToToday() {
    this.anchorMoment = window.moment();
    if (this.periodType === DIARY_PERIODS.CUSTOM) {
      this.periodType = DIARY_PERIODS.WEEK;
    }
  }

  /**
   * Sets custom date range
   */
  setCustomRange(startDate, endDate) {
    this.periodType = DIARY_PERIODS.CUSTOM;
    this.customStartDate = startDate ? startDate.clone().startOf("day") : window.moment().startOf("day");
    this.customEndDate = endDate ? endDate.clone().endOf("day") : window.moment().endOf("day");
    if (this.customEndDate.isBefore(this.customStartDate)) {
      const temp = this.customStartDate;
      this.customStartDate = this.customEndDate.clone().startOf("day");
      this.customEndDate = temp.clone().endOf("day");
    }
  }

  /**
   * Navigates forward or backward based on active period type
   * @param {number} direction 1 for forward, -1 for backward
   */
  navigate(direction) {
    if (this.periodType === DIARY_PERIODS.ALL) {
      return; // "All notes" has no pagination direction
    }

    const step = direction > 0 ? 1 : -1;

    switch (this.periodType) {
      case DIARY_PERIODS.WEEK:
        this.anchorMoment.add(step * 7, "days");
        break;
      case DIARY_PERIODS.TWO_WEEKS:
        this.anchorMoment.add(step * 14, "days");
        break;
      case DIARY_PERIODS.MONTH:
        this.anchorMoment.add(step, "months");
        break;
      case DIARY_PERIODS.QUARTER:
        this.anchorMoment.add(step * 3, "months");
        break;
      case DIARY_PERIODS.CUSTOM:
        if (this.customStartDate && this.customEndDate) {
          const daysDiff = this.customEndDate.diff(this.customStartDate, "days") + 1;
          this.customStartDate.add(step * daysDiff, "days");
          this.customEndDate.add(step * daysDiff, "days");
        }
        break;
    }
  }

  /**
   * Computes the [startDate, endDate] moment boundaries for the current period
   * @returns {{ startDate: moment.Moment|null, endDate: moment.Moment|null }}
   */
  getRange() {
    if (this.periodType === DIARY_PERIODS.ALL) {
      return { startDate: null, endDate: null };
    }

    if (this.periodType === DIARY_PERIODS.CUSTOM && this.customStartDate && this.customEndDate) {
      return {
        startDate: this.customStartDate.clone().startOf("day"),
        endDate: this.customEndDate.clone().endOf("day")
      };
    }

    const weekStartDay = this.plugin?.settings?.weekStartDay ?? 6; // Default Saturday (6) or configured

    if (this.periodType === DIARY_PERIODS.WEEK) {
      const currentDay = this.anchorMoment.day();
      const daysFromStart = (currentDay - weekStartDay + 7) % 7;
      const startDate = this.anchorMoment.clone().subtract(daysFromStart, "days").startOf("day");
      const endDate = startDate.clone().add(6, "days").endOf("day");
      return { startDate, endDate };
    }

    if (this.periodType === DIARY_PERIODS.TWO_WEEKS) {
      const currentDay = this.anchorMoment.day();
      const daysFromStart = (currentDay - weekStartDay + 7) % 7;
      const startDate = this.anchorMoment.clone().subtract(daysFromStart, "days").startOf("day");
      const endDate = startDate.clone().add(13, "days").endOf("day");
      return { startDate, endDate };
    }

    if (this.periodType === DIARY_PERIODS.MONTH) {
      const startDate = this.anchorMoment.clone().startOf("month");
      const endDate = this.anchorMoment.clone().endOf("month");
      return { startDate, endDate };
    }

    if (this.periodType === DIARY_PERIODS.QUARTER) {
      const startDate = this.anchorMoment.clone().startOf("quarter");
      const endDate = this.anchorMoment.clone().endOf("quarter");
      return { startDate, endDate };
    }

    // Default fallback
    return {
      startDate: this.anchorMoment.clone().startOf("day"),
      endDate: this.anchorMoment.clone().endOf("day")
    };
  }

  /**
   * Formats a human-readable title for the current period
   */
  getPeriodDisplayLabel() {
    const { startDate, endDate } = this.getRange();
    const lang = this.plugin?.settings?.language || "ar";
    const isAr = lang === "ar";
    const t = (k, p) => this.plugin?.translationManager?.t(k, p) || k;

    if (this.periodType === DIARY_PERIODS.ALL) {
      return t("period_all");
    }

    if (!startDate || !endDate) return "";

    const s = startDate.clone().locale(lang);
    const e = endDate.clone().locale(lang);

    if (this.periodType === DIARY_PERIODS.MONTH) {
      return s.format("MMMM YYYY");
    }

    if (this.periodType === DIARY_PERIODS.QUARTER) {
      const qNum = s.quarter();
      const year = s.format("YYYY");
      return isAr ? `الربع ${qNum} (${year})` : `Q${qNum} (${year})`;
    }

    if (s.isSame(e, "month")) {
      return `${s.format("D")} - ${e.format("D MMMM YYYY")}`;
    }

    if (s.isSame(e, "year")) {
      return `${s.format("D MMMM")} - ${e.format("D MMMM YYYY")}`;
    }

    return `${s.format("D MMM YYYY")} - ${e.format("D MMM YYYY")}`;
  }

  /**
   * Parses reflections lines out of note content using tolerant DiaryParser
   * @param {string} content
   * @param {moment.Moment} dateMoment
   * @param {string} path
   * @returns {Array<object>}
   */
  parseDailyReflectionEntries(content, dateMoment, path = "") {
    if (!content) return [];
    const headings = [
      this.getReflectionHeading(),
      ...(this.plugin?.settings?.reflectionHeadingHistory || []),
      ...KNOWN_REFLECTION_HEADINGS
    ];
    return DiaryParser.parse(content, dateMoment, path, headings);
  }

  /**
   * Fast discovery of Daily Notes within vault
   * Returns list of { file, dateMoment, dateKey }
   */
  async discoverDailyNotes(startDate, endDate) {

    // 1. If range is small (<= 14 days) and not "ALL", direct lookup is fast and accurate
    if (startDate && endDate && endDate.diff(startDate, "days") <= 14 && this.periodType !== DIARY_PERIODS.ALL) {
      const daysCount = endDate.diff(startDate, "days") + 1;
      const discovered = [];
      for (let i = 0; i < daysCount; i++) {
        const d = startDate.clone().add(i, "days");
        const file = await getNoteByDate(this.app, d, false, this.plugin?.settings);
        if (file) {
          discovered.push({
            file,
            dateMoment: d,
            dateKey: DateUtils.formatDateKey(d)
          });
        }
      }
      return discovered;
    }

    // 2. For longer ranges or ALL notes, scan Markdown files in vault/folder
    const allFiles = this.app.vault.getMarkdownFiles ? this.app.vault.getMarkdownFiles() : [];
    const discovered = [];

    for (const file of allFiles) {
      const d = getDailyNoteDate(file, this.app, this.plugin?.settings);
      if (!d) continue;

      if (startDate && endDate) {
        if (!d.isBetween(startDate, endDate, "day", "[]")) {
          continue;
        }
      }

      discovered.push({
        file,
        dateMoment: d,
        dateKey: DateUtils.formatDateKey(d)
      });
    }

    // Sort by date descending (newest first)
    discovered.sort((a, b) => b.dateMoment.valueOf() - a.dateMoment.valueOf());
    return discovered;
  }

  /**
   * Loads diary entries across the current range in non-blocking batches
   * @param {Function} [onProgress] Optional callback (loadedCount, totalCount)
   * @returns {Promise<Array<object>>}
   */
  async loadEntries(onProgress = null) {
    this._isLoading = true;
    const { startDate, endDate } = this.getRange();

    try {
      const notes = await this.discoverDailyNotes(startDate, endDate);
      const allEntries = [];
      const batchSize = 25;

      for (let i = 0; i < notes.length; i += batchSize) {
        const chunk = notes.slice(i, i + batchSize);

        await Promise.all(chunk.map(async ({ file, dateMoment, dateKey }) => {
          // Check session cache if file is clean
          if (this.entriesCache.has(dateKey) && !this.dirtyFiles.has(file.path)) {
            const cached = this.entriesCache.get(dateKey);
            allEntries.push(...cached);
            return;
          }

          const content = await this.app.vault.cachedRead(file);

          const parsed = this.parseDailyReflectionEntries(content, dateMoment, file.path);
          this.entriesCache.set(dateKey, parsed);
          this.dirtyFiles.delete(file.path);
          allEntries.push(...parsed);
        }));

        if (onProgress && typeof onProgress === "function") {
          onProgress(Math.min(i + batchSize, notes.length), notes.length);
        }

        // Yield to browser event loop so UI never freezes
        if (i + batchSize < notes.length) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      // Sort entries descending by timestamp
      allEntries.sort((a, b) => b.timestamp - a.timestamp);
      return allEntries;
    } finally {
      this._isLoading = false;
    }
  }

  /**
   * Filters entries according to active search query and reflection type
   * @param {Array<object>} entries
   * @returns {Array<object>}
   */
  filterEntries(entries) {
    if (!Array.isArray(entries)) return [];

    let filtered = entries;

    // 1. Type Filter
    if (this.selectedType && this.selectedType !== "ALL") {
      if (this.selectedType === "AUDIO") {
        filtered = filtered.filter(e => e.hasAudio);
      } else {
        const targetType = normalizeReflectionType(this.selectedType);
        filtered = filtered.filter(e => normalizeReflectionType(e.type) === targetType);
      }
    }

    // 2. Text Search
    if (this.searchQuery) {
      filtered = this.filterBySearch(filtered, this.searchQuery);
    }

    return filtered;
  }

  /**
   * Filters entries matching a specific text query using Arabic normalization
   * @param {Array<object>} entries
   * @param {string} [query]
   * @returns {Array<object>}
   */
  filterBySearch(entries, query = this.searchQuery) {
    if (!Array.isArray(entries)) return [];
    if (!query || !query.trim()) return entries;
    const queryFolded = TextUtils.foldArabic(query.trim());
    return entries.filter(e => {
      const textFolded = TextUtils.foldArabic(e.text);
      const dateFolded = TextUtils.foldArabic(e.date);
      return textFolded.includes(queryFolded) || dateFolded.includes(queryFolded);
    });
  }

  /**
   * Counts entries categorized by reflection type, respecting active search query
   * @param {Array<object>} entries
   * @param {string} [query]
   * @returns {Record<string, number>}
   */
  getTypeCounts(entries, query = "") {
    if (!Array.isArray(entries)) {
      return { ALL: 0, Good: 0, Bad: 0, Lesson: 0, Idea: 0, AUDIO: 0 };
    }

    const matching = query ? this.filterBySearch(entries, query) : entries;
    const counts = {
      ALL: matching.length,
      Good: 0,
      Bad: 0,
      Lesson: 0,
      Idea: 0,
      AUDIO: 0
    };

    matching.forEach(e => {
      const type = normalizeReflectionType(e.type);
      if (counts[type] !== undefined) {
        counts[type]++;
      }
      if (e.hasAudio) {
        counts.AUDIO++;
      }
    });

    return counts;
  }

  /**
   * Invalidate specific file cache on vault modify event
   * @param {string} filePath
   */
  invalidateFile(filePath) {
    this.dirtyFiles.add(filePath);
  }

  /**
   * Clear all cache
   */
  clearCache() {
    this.entriesCache.clear();
    this.dirtyFiles.clear();
  }

  /**
   * Invalidates either all entries cache or a specific key/file
   * @param {string} [key]
   */
  invalidateCache(key = null) {
    if (key) {
      this.entriesCache.delete(key);
      this.dirtyFiles.add(key);
    } else {
      this.clearCache();
    }
  }
}
