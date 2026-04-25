import { Utils } from '../utils/Utils.js';

export class HabitScanner {
  constructor() {
    this.reset();
  }

  reset() {
    this._cachedRegexMarker = null;
    this._cachedMarkerString = null;
    this._cachedRegexDataview = null;
    this._cachedSafeMarker = null;
  }

  scan(content, marker) {
    if (!content || content.length > 1_000_000) return [];
    
    // Fast path: check if content contains any habit markers before splitting lines
    const lowerContent = content.toLowerCase();
    const lowerMarker = marker ? marker.toLowerCase() : "";
    
    if ((lowerMarker && !lowerContent.includes(lowerMarker)) && !lowerContent.includes('[habit::')) {
      return [];
    }

    const safeMarkerStr = (marker && marker.length > 100) ? marker.substring(0, 100) : marker;

    if (safeMarkerStr !== this._cachedMarkerString) {
      this._cachedSafeMarker = Utils.escapeRegExp(safeMarkerStr);
      this._cachedMarkerString = safeMarkerStr;

      // Optimized Regex: avoiding excessive backtracking
      // We look for "- [ ] " or "- [x] " or "- [-] " at the start
      this._cachedRegexMarker = new RegExp(
        `^\\s*-\\s*\\[([ x\\-])\\]\\s*(.*?)\\s*${this._cachedSafeMarker}`,
        "i",
      );

      this._cachedRegexDataview = new RegExp(
        `^\\s*-\\s*\\[([ x\\-])\\]\\s*(.*?)\\s*\\[habit::`,
        "i",
      );
    }

    const lines = content.split(/\r?\n/);
    const habits = [];

    lines.forEach((line, i) => {
      // ReDoS protection: skip excessively long lines
      if (line.length > 2000) return;
      
      // Fast path string check per line
      const lowerLine = line.toLowerCase();
      if (!lowerLine.includes(lowerMarker) && !lowerLine.includes('[habit::')) return;

      let match = line.match(this._cachedRegexMarker);
      if (!match) {
        match = line.match(this._cachedRegexDataview);
      }

      if (match) {
        let text = match[2].trim();
        text = text.replace(new RegExp(`${this._cachedSafeMarker}$`, "i"), "").trim();
        text = text.replace(/\[habit::.*?\]$/, "").trim();

        const char = match[1];
        habits.push({
          lineIndex: i,
          text: text,
          completed: char.toLowerCase() === "x",
          skipped: char === "-",
        });
      }
    });

    return habits;
  }
}
