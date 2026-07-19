import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  LEGACY_ARABIC_DAILY_NOTE_DEFAULTS,
  migrateLegacyLocalizedSettings,
} from "../src/constants.js";

describe("localized settings migration", () => {
  it("replaces legacy Arabic generated headings for non-Arabic settings", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      language: "fr",
      ...LEGACY_ARABIC_DAILY_NOTE_DEFAULTS,
    };

    const changed = migrateLegacyLocalizedSettings(settings, settings);

    expect(changed).toBe(true);
    expect(settings.dailyParentHeading).toBe("## Journal quotidien");
    expect(settings.habitHeading).toBe("### Suivi des habitudes");
    expect(settings.habitLogHeading).toBe("### Notes sur les habitudes");
    expect(settings.reflectionHeading).toBe("### Réflexions du jour");
  });

  it("keeps explicit custom headings", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      language: "fr",
      dailyParentHeading: "## Custom",
      habitHeading: "### Custom Habits",
      habitLogHeading: "### Custom Notes",
      reflectionHeading: "### Custom Reflections",
    };

    const changed = migrateLegacyLocalizedSettings(settings, settings);

    expect(changed).toBe(false);
    expect(settings.dailyParentHeading).toBe("## Custom");
    expect(settings.habitHeading).toBe("### Custom Habits");
  });
});
