import { describe, it, expect, beforeEach, vi } from "vitest";
import { HabitNoteManager } from "../src/services/HabitNoteManager.js";
import { canonicalHabit } from "./fixtures/habitFixtures.js";
import { TFile } from "obsidian";

import { TRANSLATIONS } from "../src/constants.js";

describe("HabitNoteManager Tests", () => {
  let mockApp;
  let mockPlugin;
  let habitNoteManager;
  let filesMap;

  beforeEach(() => {
    filesMap = new Map();

    mockApp = {
      vault: {
        adapter: {
          getBasePath: () => "C:/Vault",
        },
        getAbstractFileByPath: vi.fn((path) => filesMap.get(path) || null),
        getMarkdownFiles: vi.fn(() => Array.from(filesMap.values())),
        createFolder: vi.fn(async (folder) => {
          filesMap.set(folder, { path: folder });
          return filesMap.get(folder);
        }),
        create: vi.fn(async (path, content) => {
          const file = new TFile(path);
          file.content = content;
          filesMap.set(path, file);
          return file;
        }),
        read: vi.fn(async (file) => file.content || ""),
        modify: vi.fn(async (file, content) => {
          file.content = content;
        }),
        process: vi.fn(async (file, fn) => {
          file.content = fn(file.content || "");
          return file.content;
        }),
        rename: vi.fn(async (file, newPath) => {
          filesMap.delete(file.path);
          file.path = newPath;
          file.name = newPath.split("/").pop();
          file.basename = file.name.replace(/\.md$/i, "");
          filesMap.set(newPath, file);
        }),
      },
      fileManager: {
        renameFile: vi.fn(async (file, newPath) => {
          filesMap.delete(file.path);
          file.path = newPath;
          file.name = newPath.split("/").pop();
          file.basename = file.name.replace(/\.md$/i, "");
          filesMap.set(newPath, file);
        }),
        processFrontMatter: vi.fn(async (file, fn) => {
          if (!file.frontmatter) file.frontmatter = {};
          fn(file.frontmatter);
        }),
      },
      metadataCache: {
        getFileCache: vi.fn((file) => ({
          frontmatter: file.frontmatter || {},
        })),
      },
    };

    mockPlugin = {
      settings: {
        habitNotesFolder: "Core Habits",
        language: "en",
      },
      translationManager: {
        t: (k, p = {}) => {
          let str = TRANSLATIONS.en[k] || TRANSLATIONS.ar[k] || k;
          Object.keys(p).forEach(param => { str = str.replace(`{${param}}`, p[param]); });
          return str;
        },
      },
    };

    habitNoteManager = new HabitNoteManager(mockApp, mockPlugin);
  });

  describe("Folder and Path Resolutions", () => {
    it("should return clean root folder and strip vault basePath if included", () => {
      expect(habitNoteManager.getRootFolder()).toBe("Core Habits");

      mockPlugin.settings.habitNotesFolder = "C:/Vault/MyHabits";
      expect(habitNoteManager.getRootFolder()).toBe("MyHabits");

      mockPlugin.settings.habitNotesFolder = "Nested/Folder//";
      expect(habitNoteManager.getRootFolder()).toBe("Nested/Folder");
    });

    it("should return correct Active and Archive folders", () => {
      mockPlugin.settings.habitNotesFolder = "Habits";
      expect(habitNoteManager.getActiveFolder()).toBe("Habits/Active");
      expect(habitNoteManager.getArchiveFolder()).toBe("Habits/Archive");
    });

    it("should sanitize file name and place in correct folder based on archived flag", () => {
      mockPlugin.settings.habitNotesFolder = "Habits";
      const activePath = habitNoteManager.getHabitFilePath("Read: A Book?", false);
      expect(activePath).toBe("Habits/Active/Read- A Book-.md");

      const archivePath = habitNoteManager.getHabitFilePath("Read: A Book?", true);
      expect(archivePath).toBe("Habits/Archive/Read- A Book-.md");
    });

    it("should ensure all folders exist idempotently", async () => {
      await habitNoteManager.ensureFolders();
      expect(mockApp.vault.createFolder).toHaveBeenCalledWith("Core Habits");
      expect(mockApp.vault.createFolder).toHaveBeenCalledWith("Core Habits/Active");
      expect(mockApp.vault.createFolder).toHaveBeenCalledWith("Core Habits/Archive");
    });
  });

  describe("Template Building and Notes Extraction", () => {
    it("should build template containing core-habits codeblock and atomic engineering section", () => {
      const habit = {
        ...canonicalHabit,
        atomicDescription: {
          identity: "Reader",
          cue: "Evening tea",
          friction: "Keep book on pillow",
          reward: "Feel accomplished",
        },
        notes: "My notes here",
      };

      const template = habitNoteManager.buildHabitTemplate(habit);
      expect(template).toContain("```core-habits");
      expect(template).toContain("Reader");
      expect(template).toContain("Evening tea");
      expect(template).toContain("Keep book on pillow");
      expect(template).toContain("Feel accomplished");
      expect(template).toContain("> My notes here");
      expect(template).not.toContain("## 📓 سجل التدوينات والصوتيات");
    });

    it("should format notes as blockquotes and extract them back", () => {
      const rawNotes = "Line 1\nLine 2";
      const bq = habitNoteManager.formatNotesAsBlockquote(rawNotes);
      expect(bq).toContain("> Line 1\n> Line 2");

      const bodyContent = `Intro\n${bq}\n---\nFooter`;
      const extracted = habitNoteManager.extractNotesFromBody(bodyContent);
      expect(extracted).toBe("Line 1\nLine 2");
    });
  });

  describe("File Resolution Heuristics (_resolveHabitFile)", () => {
    it("should resolve file by current name in Active folder", () => {
      const activeFile = new TFile("Core Habits/Active/Reading Books.md");
      activeFile.frontmatter = { habit_id: "habit-123" };
      filesMap.set("Core Habits/Active/Reading Books.md", activeFile);

      const resolved = habitNoteManager._resolveHabitFile({
        name: "Reading Books",
        id: "habit-123",
      });
      expect(resolved).toBe(activeFile);
    });

    it("should resolve file by current name in Archive folder if archived", () => {
      const archiveFile = new TFile("Core Habits/Archive/Reading Books.md");
      archiveFile.frontmatter = { habit_id: "habit-123" };
      filesMap.set("Core Habits/Archive/Reading Books.md", archiveFile);

      const resolved = habitNoteManager._resolveHabitFile({
        name: "Reading Books",
        id: "habit-123",
      });
      expect(resolved).toBe(archiveFile);
    });

    it("should resolve file by historical name if renamed", () => {
      const oldNamedFile = new TFile("Core Habits/Active/Old Reading Name.md");
      oldNamedFile.frontmatter = { habit_id: "habit-123" };
      filesMap.set("Core Habits/Active/Old Reading Name.md", oldNamedFile);

      const resolved = habitNoteManager._resolveHabitFile({
        name: "New Reading Name",
        id: "habit-123",
        nameHistory: ["Old Reading Name"],
      });
      expect(resolved).toBe(oldNamedFile);
    });

    it("should fallback to metadataCache search by habit_id if filenames differ completely", () => {
      const customNamedFile = new TFile("Core Habits/Active/Totally Different.md");
      customNamedFile.frontmatter = { habit_id: "habit-xyz-789" };
      filesMap.set("Core Habits/Active/Totally Different.md", customNamedFile);

      const resolved = habitNoteManager._resolveHabitFile({
        name: "Nonexistent Name",
        id: "habit-xyz-789",
      });
      expect(resolved).toBe(customNamedFile);
    });

    it("should return null if file cannot be found anywhere", () => {
      const resolved = habitNoteManager._resolveHabitFile({
        name: "Does Not Exist",
        id: "not-found-id",
      });
      expect(resolved).toBeNull();
    });
  });

  describe("Manual Move Detection (detectManualMove)", () => {
    it("should detect when a file is manually moved from Active to Archive", () => {
      const result = habitNoteManager.detectManualMove(
        "Core Habits/Archive/Habit.md",
        "Core Habits/Active/Habit.md"
      );
      expect(result).toBe("archived");
    });

    it("should detect when a file is manually moved from Archive to Active", () => {
      const result = habitNoteManager.detectManualMove(
        "Core Habits/Active/Habit.md",
        "Core Habits/Archive/Habit.md"
      );
      expect(result).toBe("restored");
    });

    it("should return null for moves within the same folder or outside habits", () => {
      const sameFolder = habitNoteManager.detectManualMove(
        "Core Habits/Active/NewHabit.md",
        "Core Habits/Active/OldHabit.md"
      );
      expect(sameFolder).toBeNull();

      const outsideFolder = habitNoteManager.detectManualMove(
        "Notes/Habit.md",
        "Core Habits/Active/Habit.md"
      );
      expect(outsideFolder).toBeNull();
    });
  });

  describe("Archive and Restore Operations", () => {
    it("should archive active habit note by moving it to Archive folder", async () => {
      const file = new TFile("Core Habits/Active/Reading.md");
      file.frontmatter = { habit_id: canonicalHabit.id };
      filesMap.set("Core Habits/Active/Reading.md", file);

      const habit = { ...canonicalHabit, name: "Reading", archived: false };
      await habitNoteManager.archiveHabitNote(habit);

      expect(mockApp.vault.rename).toHaveBeenCalledWith(
        file,
        "Core Habits/Archive/Reading.md"
      );
    });

    it("should restore archived habit note by moving it to Active folder", async () => {
      const file = new TFile("Core Habits/Archive/Reading.md");
      file.frontmatter = { habit_id: canonicalHabit.id };
      filesMap.set("Core Habits/Archive/Reading.md", file);

      const habit = { ...canonicalHabit, name: "Reading", archived: true };
      await habitNoteManager.restoreHabitNote(habit);

      expect(mockApp.vault.rename).toHaveBeenCalledWith(
        file,
        "Core Habits/Active/Reading.md"
      );
    });
  });

  describe("Update Habit Note Content and Frontmatter", () => {
    it("should preserve the entire user body and update frontmatter only", async () => {
      const file = new TFile("Core Habits/Active/Reading.md");
      const template = habitNoteManager.buildHabitTemplate({ ...canonicalHabit, name: "Reading", notes: "Old notes" });
      file.content = `---\nhabit_id: ${canonicalHabit.id}\n---\n\n${template}`;
      file.frontmatter = { habit_id: canonicalHabit.id };
      const originalContent = file.content;
      filesMap.set("Core Habits/Active/Reading.md", file);

      const updatedHabit = {
        ...canonicalHabit,
        name: "Reading",
        notes: "Updated rich notes",
        atomicDescription: { identity: "Consistent Learner" },
      };

      await habitNoteManager.updateHabitNote(updatedHabit);

      expect(file.content).toBe(originalContent);
      expect(file.frontmatter.notes).toBe("Updated rich notes");
      expect(file.frontmatter.identity).toBe("Consistent Learner");
    });

    it("refuses to overwrite a note at the desired habit path", async () => {
      const file = new TFile("Core Habits/Active/Reading.md");
      file.frontmatter = { habit_id: "someone-else" };
      file.content = "User text";
      filesMap.set(file.path, file);
      await expect(habitNoteManager.createHabitNote({ ...canonicalHabit, name: "Reading", archived: false })).rejects.toThrow("already exists");
      expect(file.content).toBe("User text");
      expect(file.frontmatter.habit_id).toBe("someone-else");
    });

    it("restores the original path if frontmatter writing fails after rename", async () => {
      const file = new TFile("Core Habits/Active/Old.md");
      file.frontmatter = { habit_id: canonicalHabit.id };
      file.content = "Personal notes";
      filesMap.set(file.path, file);
      mockApp.fileManager.processFrontMatter.mockRejectedValueOnce(new Error("disk full"));
      await expect(habitNoteManager.updateHabitNote({ ...canonicalHabit, name: "New", archived: false })).rejects.toThrow("disk full");
      expect(file.path).toBe("Core Habits/Active/Old.md");
      expect(file.content).toBe("Personal notes");
    });
  });
});
