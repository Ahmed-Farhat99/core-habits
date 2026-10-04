import { TFile } from "obsidian";

/**
 * VaultOrderStore
 * The single, portable, persistent Source of Truth for habit ordering in the Vault.
 * Maintains `Core Habits/_order.md` with zero dependency on plugin internal storage.
 */
export class VaultOrderStore {
  /**
   * @param {import('obsidian').App} app
   * @param {object} plugin
   */
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }

  /**
   * Returns the normalized path to the order markdown file.
   * @returns {string}
   */
  getOrderFilePath() {
    const root = this.plugin?.settings?.habitNotesFolder || "Core Habits";
    return `${root}/_order.md`;
  }

  /**
   * Reads and parses the persistent habit order from `_order.md`.
   * @returns {Promise<{ habitOrder: string[], orderVersion: number, updatedAt: string|null }|null>}
   */
  async readOrder() {
    const path = this.getOrderFilePath();
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) return null;

    let fm = this.app.metadataCache.getFileCache(file)?.frontmatter;

    if (!fm || !Array.isArray(fm.habit_order) || fm.habit_order.length === 0) {
      try {
        const content = await this.app.vault.read(file);
        const parsed = this._parseFrontmatterFromContent(content);
        if (parsed && Array.isArray(parsed.habit_order) && parsed.habit_order.length > 0) {
          fm = parsed;
        }
      } catch (err) {
        console.error("[Core Habits] Failed to read _order.md content:", err);
      }
    }

    if (!fm) return null;

    let habitOrder = [];
    if (Array.isArray(fm.habit_order)) {
      habitOrder = fm.habit_order.map(String).filter(Boolean);
    }

    const orderVersion = Number.isInteger(fm.order_version)
      ? fm.order_version
      : parseInt(fm.order_version, 10) || 0;

    const updatedAt = typeof fm.updated_at === "string" ? fm.updated_at : null;

    return {
      habitOrder,
      orderVersion,
      updatedAt
    };
  }

  /**
   * Atomically writes the persistent habit order to `_order.md`.
   * @param {string[]} habitOrder - Array of valid habit IDs in desired order
   * @param {number} [currentVersion=0] - Previous revision version
   * @returns {Promise<{ habitOrder: string[], orderVersion: number, updatedAt: string }>}
   */
  async writeOrder(habitOrder, currentVersion = 0) {
    const nextVersion = (Number.isInteger(currentVersion) ? currentVersion : 0) + 1;
    const updatedAt = new Date().toISOString();
    const path = this.getOrderFilePath();

    const cleanOrder = Array.isArray(habitOrder)
      ? [...new Set(habitOrder.map(String).filter(Boolean))]
      : [];

    let file = this.app.vault.getAbstractFileByPath(path);

    if (file && file instanceof TFile && typeof this.app.fileManager?.processFrontMatter === "function") {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm.schema_version = 3;
        fm.order_version = nextVersion;
        fm.habit_order = cleanOrder;
        fm.updated_at = updatedAt;
      });
    } else {
      // Ensure parent root folder exists
      if (this.plugin?.habitNoteManager?.ensureFolders) {
        await this.plugin.habitNoteManager.ensureFolders();
      }

      const yamlLines = [
        "---",
        "schema_version: 3",
        `order_version: ${nextVersion}`,
        "habit_order:"
      ];

      for (const id of cleanOrder) {
        yamlLines.push(`  - "${id}"`);
      }

      yamlLines.push(`updated_at: "${updatedAt}"`);
      yamlLines.push("---");
      yamlLines.push("");
      yamlLines.push("This file maintains the display order of habits for Core Habits.");
      yamlLines.push("It is automatically managed by the plugin.");
      yamlLines.push("");

      const content = yamlLines.join("\n");
      await this.app.vault.create(path, content);
    }

    return {
      habitOrder: cleanOrder,
      orderVersion: nextVersion,
      updatedAt
    };
  }

  /**
   * Deterministic sorting rule for habits when reconstructing order.
   * Priority: created_at (ascending) -> name (localeCompare) -> habit_id.
   * @param {Array<object>} habits
   * @returns {Array<object>}
   */
  static sortHabitsDeterministically(habits) {
    if (!Array.isArray(habits)) return [];
    return [...habits].sort((a, b) => {
      const hasOrderA = typeof a.order === "number";
      const hasOrderB = typeof b.order === "number";
      if (hasOrderA && hasOrderB && a.order !== b.order) {
        return a.order - b.order;
      }

      const timeA = typeof a.createdAt === "number" ? a.createdAt : 0;
      const timeB = typeof b.createdAt === "number" ? b.createdAt : 0;
      if (timeA !== timeB) return timeA - timeB;

      const nameA = typeof a.name === "string" ? a.name : "";
      const nameB = typeof b.name === "string" ? b.name : "";
      const nameComp = nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
      if (nameComp !== 0) return nameComp;

      const idA = typeof a.id === "string" ? a.id : "";
      const idB = typeof b.id === "string" ? b.id : "";
      return idA.localeCompare(idB);
    });
  }

  /**
   * Basic frontmatter parser fallback for non-cached files.
   * @private
   */
  _parseFrontmatterFromContent(content) {
    if (!content || !content.startsWith("---")) return null;
    const endIdx = content.indexOf("\n---", 3);
    if (endIdx === -1) return null;

    const fmText = content.slice(3, endIdx).trim();
    const lines = fmText.split(/\r?\n/);
    const result = { habit_order: [] };

    let inOrderList = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.startsWith("order_version:")) {
        inOrderList = false;
        result.order_version = parseInt(line.split(":")[1].trim(), 10) || 0;
      } else if (line.startsWith("updated_at:")) {
        inOrderList = false;
        result.updated_at = line.replace(/^updated_at:\s*["']?/, "").replace(/["']?$/, "").trim();
      } else if (line.startsWith("schema_version:")) {
        inOrderList = false;
        result.schema_version = parseInt(line.split(":")[1].trim(), 10) || 3;
      } else if (line.startsWith("habit_order:")) {
        inOrderList = true;
      } else if (inOrderList && line.startsWith("-")) {
        const id = line.replace(/^-\s*["']?/, "").replace(/["']?$/, "").trim();
        if (id) result.habit_order.push(id);
      } else if (!line.startsWith("-")) {
        inOrderList = false;
      }
    }

    return result;
  }
}
