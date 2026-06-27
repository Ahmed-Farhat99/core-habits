import { Utils } from '../utils/Utils.js';

export class HabitScanner {
  constructor() {
    // No state needed — scan() is stateless and creates regexes per call
  }

  scan(content, marker) {
    if (!content || content.length > 1_000_000) return null;

    const lines = content.split(/\r?\n/);
    const habits = [];

    const escapedMarker = marker ? Utils.escapeRegExp(marker) : "";
    const markerRegex = escapedMarker ? new RegExp(`\\s*${escapedMarker}\\s*`, "i") : null;
    const dataviewRegex = /\[habit::\s*(.*?)\s*\]/i;

    lines.forEach((line, i) => {
      if (line.length > 2000) return;
      
      const match = line.match(/^\s*-\s*\[([ x-])\]\s*(.*)$/i);
      if (match) {
        const char = match[1];
        const rawText = match[2];

        const hasConfiguredMarker = markerRegex && markerRegex.test(rawText);
        const dataviewMatch = rawText.match(dataviewRegex);

        if (hasConfiguredMarker || dataviewMatch) {
          let text = rawText.trim();
          let habitId = null;

          if (dataviewMatch) {
            const val = dataviewMatch[1].trim();
            if (val && val.toLowerCase() !== "true" && val.toLowerCase() !== "false") {
              habitId = val;
            }
          }

          // Remove the configured marker if present
          if (markerRegex) {
            text = text.replace(markerRegex, "").trim();
          }
          // Remove any inline dataview field [habit:: ...] if present
          text = text.replace(/\[habit::.*?\]/gi, "").trim();

          habits.push({
            lineIndex: i,
            text: text,
            completed: char.toLowerCase() === "x",
            skipped: char === "-",
            habitId: habitId,
          });
        }
      }
    });

    return habits;
  }
}
