import { beforeEach, describe, expect, it } from "vitest";
import { HabitPostProcessor } from "../src/views/HabitPostProcessor.js";
import { TranslationManager } from "../src/services/TranslationManager.js";
import { canonicalHabit } from "./fixtures/habitFixtures.js";

function installElementHelpers() {
  if (!HTMLElement.prototype.empty) {
    HTMLElement.prototype.empty = function empty() {
      this.textContent = "";
    };
  }

  if (!HTMLElement.prototype.createEl) {
    HTMLElement.prototype.createEl = function createEl(tagName, options = {}) {
      const child = document.createElement(tagName);
      if (options.cls) child.className = options.cls;
      if (options.text) child.textContent = options.text;
      this.appendChild(child);
      return child;
    };
  }
}

describe("HabitPostProcessor", () => {
  beforeEach(() => {
    installElementHelpers();
  });

  it("renders generated habit details in French", async () => {
    const plugin = {
      settings: { language: "fr" },
      app: {
        metadataCache: {
          getCache: () => ({ frontmatter: { habit_id: canonicalHabit.id } }),
        },
      },
      habitManager: {
        getHabitById: () => ({
          ...canonicalHabit,
          habitType: "build",
          currentLevel: 2,
        }),
      },
    };
    plugin.translationManager = new TranslationManager(plugin);

    const container = document.createElement("div");
    await new HabitPostProcessor(plugin).process("", container, { sourcePath: "Core Habits/Active/Reading.md" });

    expect(container.textContent).toContain("Construire une habitude");
    expect(container.textContent).toContain("🧠 Identité souhaitée");
    expect(container.textContent).toContain("⚙️ Détails de l'habitude");
    expect(container.textContent).toContain("📍 Déclencheur (quand/où) :");
    expect(container.textContent).toContain("📈 Étapes et progression");
    expect(container.textContent).toContain("Condition de transition :");
    expect(container.textContent).not.toContain("بناء عادة");
    expect(container.textContent).not.toContain("الهوية المستهدفة");
  });
});
