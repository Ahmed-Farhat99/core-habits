import { describe, it, expect, beforeEach, vi } from "vitest";
import { VaultSourceStore } from "../src/services/VaultSourceStore.js";
import { StatsService } from "../src/services/StatsService.js";
import { DiaryService } from "../src/services/DiaryService.js";
import { HabitCommentRepository } from "../src/repositories/HabitCommentRepository.js";
import { HabitScanner } from "../src/services/HabitScanner.js";
import { StreakCalculator } from "../src/services/StreakCalculator.js";
import { getNoteByDate, getDailyNoteDate } from "../src/utils/helpers.js";

describe("Daily Notes Source History & Conflict Resolution Integration Audit", () => {
  let mockApp;
  let mockPlugin;
  let vaultSourceStore;
  let statsService;
  let diaryService;
  let commentRepo;
  let mockFilesMap;

  beforeEach(() => {
    mockFilesMap = new Map();

    mockApp = {
      vault: {
        getAbstractFileByPath: vi.fn((path) => mockFilesMap.get(path) || null),
        getRoot: vi.fn(() => ({
          name: "",
          path: "",
          children: Array.from(mockFilesMap.values()).filter(f => !f.path.includes("/"))
        })),
        read: vi.fn(async (file) => file.content || ""),
        cachedRead: vi.fn(async (file) => file.content || ""),
        create: vi.fn(async (path, content) => {
          const newFile = { path, name: path.split("/").pop(), basename: path.split("/").pop().replace(".md", ""), content, extension: "md" };
          mockFilesMap.set(path, newFile);
          return newFile;
        }),
        modify: vi.fn(async (file, content) => {
          file.content = content;
          return file;
        }),
        getMarkdownFiles: vi.fn(() => Array.from(mockFilesMap.values()).filter(f => f.path.endsWith(".md")))
      },
      fileManager: {
        processFrontMatter: null
      },
      metadataCache: {
        getFileCache: vi.fn((file) => file.frontmatter ? { frontmatter: file.frontmatter } : null)
      },
      workspace: {
        trigger: vi.fn(),
        getLeavesOfType: vi.fn().mockReturnValue([])
      }
    };

    mockPlugin = {
      app: mockApp,
      settings: {
        dailyNotesSource: "auto",
        dailyNotesFolder: "Daily Notes",
        dateFormat: "YYYY-MM-DD",
        habitNotesFolder: "Core Habits",
        dailyNoteSourcesHistory: [],
        lifetimeCompleted: 0,
        marker: "[habit:: true]",
        streakBreakOnMissing: false,
        habitLogHeading: "## سجل العادات",
        reflectionHeading: "## تدوينات وتأملات"
      },
      habitScanner: new HabitScanner(),
      habitManager: {
        isHabitScheduledForDay: () => true,
        getHabitsForTimeRange: () => [
          { id: "habit-exercise", name: "Exercise", linkText: "[[Exercise]]" },
          { id: "habit-reading", name: "Reading", linkText: "[[Reading]]" }
        ],
        getHabitById: (id) => {
          if (id === "habit-exercise") return { id: "habit-exercise", name: "Exercise", linkText: "[[Exercise]]" };
          if (id === "habit-reading") return { id: "habit-reading", name: "Reading", linkText: "[[Reading]]" };
          return null;
        }
      },
      translationManager: {
        t: vi.fn((k) => k)
      },
      saveSettings: vi.fn().mockResolvedValue(true)
    };

    vaultSourceStore = new VaultSourceStore(mockApp, mockPlugin);
    mockPlugin.vaultSourceStore = vaultSourceStore;

    statsService = new StatsService(mockPlugin);
    mockPlugin.statsService = statsService;

    diaryService = new DiaryService(mockApp, mockPlugin);
    mockPlugin.diaryService = diaryService;

    commentRepo = new HabitCommentRepository(mockApp, mockPlugin);
    mockPlugin.habitCommentRepository = commentRepo;
  });

  describe("1. Auto → Manual → Auto Source Switching & History Preservation", () => {
    it("preserves historical daily notes when changing Auto to Manual and back to Auto", async () => {
      // 1. Initial state: Auto with Daily Notes folder
      await vaultSourceStore.initialize();
      expect(vaultSourceStore.getCandidateFolders()).toContain("Daily Notes");

      // Note exists in Auto folder
      const autoNote = {
        path: "Daily Notes/2026-09-01.md",
        name: "2026-09-01.md",
        basename: "2026-09-01",
        extension: "md",
        content: "- [x] [[Exercise]] [habit:: true]\n- [ ] [[Reading]] [habit:: true]"
      };
      mockFilesMap.set(autoNote.path, autoNote);

      // Verify date recognition
      const d1 = getDailyNoteDate(autoNote, mockApp, mockPlugin.settings, vaultSourceStore);
      expect(d1).not.toBeNull();
      expect(d1.format("YYYY-MM-DD")).toBe("2026-09-01");

      // 2. Switch to Manual: Folder "Journal"
      mockPlugin.settings.dailyNotesSource = "manual";
      mockPlugin.settings.dailyNotesFolder = "Journal";
      await vaultSourceStore.recordActiveSource();

      // Check candidate sources include both Journal and Daily Notes
      const candidateFolders = vaultSourceStore.getCandidateFolders();
      expect(candidateFolders).toContain("Journal");
      expect(candidateFolders).toContain("Daily Notes");

      // Old note in Daily Notes is STILL recognized as a daily note!
      const d2 = getDailyNoteDate(autoNote, mockApp, mockPlugin.settings, vaultSourceStore);
      expect(d2).not.toBeNull();
      expect(d2.format("YYYY-MM-DD")).toBe("2026-09-01");

      // Lookup for 2026-09-01 still finds the old auto note without creating a new one
      const foundNote = await getNoteByDate(mockApp, window.moment("2026-09-01"), false, mockPlugin.settings, vaultSourceStore);
      expect(foundNote).not.toBeNull();
      expect(foundNote.path).toBe("Daily Notes/2026-09-01.md");

      // 3. Switch back to Auto
      mockPlugin.settings.dailyNotesSource = "auto";
      mockPlugin.settings.dailyNotesFolder = "Daily Notes";
      await vaultSourceStore.recordActiveSource();

      const candidateFoldersBack = vaultSourceStore.getCandidateFolders();
      expect(candidateFoldersBack).toContain("Daily Notes");
      expect(candidateFoldersBack).toContain("Journal");
    });
  });

  describe("2. Prevent Duplicate Daily Note Creation", () => {
    it("never creates a duplicate note for today if a note already exists in any candidate source", async () => {
      // Historical note exists in "Archive/Daily"
      const existingNote = {
        path: "Archive/Daily/2026-09-05.md",
        name: "2026-09-05.md",
        basename: "2026-09-05",
        extension: "md",
        content: "- [x] [[Exercise]] [habit:: true]"
      };
      mockFilesMap.set(existingNote.path, existingNote);

      mockPlugin.settings.dailyNoteSourcesHistory = [
        { folder: "Archive/Daily", format: "YYYY-MM-DD", source: "manual" }
      ];
      mockPlugin.settings.dailyNotesFolder = "Daily Notes"; // Active folder is different!

      const targetMoment = window.moment("2026-09-05");

      // Request note with createIfNeeded = true
      const resolved = await getNoteByDate(mockApp, targetMoment, true, mockPlugin.settings, vaultSourceStore);

      // Must return the existing note from Archive/Daily
      expect(resolved).not.toBeNull();
      expect(resolved.path).toBe("Archive/Daily/2026-09-05.md");

      // Vault.create must NEVER have been called!
      expect(mockApp.vault.create).not.toHaveBeenCalled();
      expect(mockFilesMap.has("Daily Notes/2026-09-05.md")).toBe(false);
    });
  });

  describe("3. Reinstall Recovery via Portable SSOT (_sources.md)", () => {
    it("hydrates sources history from _sources.md when settings cache is empty", async () => {
      // Prepare _sources.md in Core Habits folder
      const sourcesMdContent = [
        "---",
        "schema_version: 1",
        "updated_at: '2026-10-01T00:00:00.000Z'",
        "daily_note_sources:",
        "  - folder: 'OldJournal'",
        "    format: 'YYYY-MM-DD'",
        "    source: 'manual'",
        "  - folder: 'Daily Notes'",
        "    format: 'YYYY/MM/DD'",
        "    source: 'periodic-notes'",
        "---",
        "# Registry"
      ].join("\n");

      const sourcesFile = {
        path: "Core Habits/_sources.md",
        name: "_sources.md",
        basename: "_sources",
        extension: "md",
        content: sourcesMdContent
      };
      sourcesFile instanceof (await import("obsidian")).TFile; // ensure instance check
      Object.setPrototypeOf(sourcesFile, (await import("obsidian")).TFile.prototype);
      mockFilesMap.set("Core Habits/_sources.md", sourcesFile);

      // Simulate clean reinstall / empty data.json cache
      mockPlugin.settings.dailyNoteSourcesHistory = [];
      mockPlugin.settings.dailyNotesFolder = "CurrentDaily";
      mockPlugin.settings.dateFormat = "YYYY-MM-DD";

      // Initialize VaultSourceStore
      await vaultSourceStore.initialize();

      // Settings cache is hydrated from Portable SSOT
      const history = mockPlugin.settings.dailyNoteSourcesHistory;
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(history.some(s => s.folder === "OldJournal")).toBe(true);
      expect(history.some(s => s.folder === "Daily Notes" && s.format === "YYYY/MM/DD")).toBe(true);
    });
  });

  describe("4. Conflict Handling for Grid, Stats, Streaks, Diary & Comments", () => {
    it("handles two files on the same day without zeroing stats or double-counting completions", async () => {
      mockPlugin.settings.dailyNoteSourcesHistory = [
        { folder: "Daily Notes", format: "YYYY-MM-DD", source: "auto" },
        { folder: "Journal", format: "YYYY-MM-DD", source: "manual" }
      ];

      // Note 1 in Daily Notes: Exercise completed, Reading uncompleted
      const note1 = {
        path: "Daily Notes/2026-09-10.md",
        name: "2026-09-10.md",
        basename: "2026-09-10",
        extension: "md",
        content: [
          "- [x] [[Exercise]] [habit:: true]",
          "- [ ] [[Reading]] [habit:: true]",
          "## سجل العادات",
          "- 08:30 [habit-id:: habit-exercise] [habit-note:: Exercise] [[Exercise]] - Morning run",
          "## تدوينات وتأملات",
          "- 08:35 [type:: Good] High energy morning"
        ].join("\n")
      };

      // Note 2 in Journal: Exercise uncompleted, Reading completed
      const note2 = {
        path: "Journal/2026-09-10.md",
        name: "2026-09-10.md",
        basename: "2026-09-10",
        extension: "md",
        content: [
          "- [ ] [[Exercise]] [habit:: true]",
          "- [x] [[Reading]] [habit:: true]",
          "## سجل العادات",
          "- 19:30 [habit-id:: habit-reading] [habit-note:: Reading] [[Reading]] - Evening chapter",
          "## تدوينات وتأملات",
          "- 08:35 [type:: Good] High energy morning", // duplicated reflection
          "- 20:00 [type:: Idea] New book recommendation"
        ].join("\n")
      };

      mockFilesMap.set(note1.path, note1);
      mockFilesMap.set(note2.path, note2);

      // A. Stats verification:
      // Exercise completed in Note 1, Reading completed in Note 2
      const habitExercise = { id: "habit-exercise", name: "Exercise", linkText: "[[Exercise]]" };
      const habitReading = { id: "habit-reading", name: "Reading", linkText: "[[Reading]]" };
      const dateMoment = window.moment("2026-09-10");

      const statusExercise = await statsService.getHabitStatus(habitExercise, dateMoment);
      const statusReading = await statsService.getHabitStatus(habitReading, dateMoment);

      // Both resolved as completed!
      expect(statusExercise).toBe("completed");
      expect(statusReading).toBe("completed");

      // Lifetime index recalculation
      const totalLifetime = await statsService.initLifetimeIndex(true);
      // For date 2026-09-10, exactly 2 completions (1 for Exercise, 1 for Reading). ZERO double counting!
      expect(statsService.dailyCompletions.get("2026-09-10")).toBe(2);
      expect(totalLifetime).toBe(2);

      // B. Streaks verification:
      const streakCalc = new StreakCalculator(mockPlugin);
      const streakResult = await streakCalc.calculate(habitExercise);
      expect(streakResult).toBeDefined();
      expect(streakResult.currentStreak).toBeGreaterThanOrEqual(1);

      // C. Comments verification:
      const directComment = await commentRepo.getCommentForHabitDate(habitExercise, dateMoment);
      expect(directComment).toContain("Morning run");

      const commentsEx = await commentRepo.getCommentHistoryForHabit(habitExercise, 60);
      expect(commentsEx.some(c => c.text.includes("Morning run"))).toBe(true);

      const commentsRead = await commentRepo.getCommentHistoryForHabit(habitReading, 60);
      expect(commentsRead.some(c => c.text.includes("Evening chapter"))).toBe(true);

      // D. Diary reflections deduplication:
      // "08:35 High energy morning" was in BOTH notes, but should only appear ONCE in diary entries
      diaryService.anchorMoment = window.moment("2026-09-10");
      diaryService.periodType = "week";
      const entries = await diaryService.loadEntries();

      const morningEntries = entries.filter(e => e.text.includes("High energy morning"));
      expect(morningEntries).toHaveLength(1); // Deduplicated confirmed identical event

      const eveningEntries = entries.filter(e => e.text.includes("New book recommendation"));
      expect(eveningEntries).toHaveLength(1);
    });
  });

  describe("5. No Full Vault Enumeration & Format-Directed Traversal", () => {
    it("collects candidate files by following format tokens (YYYY/MM/DD) without general recursion or vault scanning", () => {
      // Set up candidate source with multi-level format: YYYY/MM/DD
      vaultSourceStore.getActiveSource = () => ({
        folder: "Daily Notes",
        format: "YYYY/MM/DD",
        source: "manual"
      });

      // Mock folder tree:
      // Daily Notes/
      //   2026/ (matches YYYY)
      //     09/ (matches MM)
      //       09.md (valid daily note)
      //     Templates/ (DOES NOT match MM -> must never be entered)
      //       temp.md
      //   Archive/ (DOES NOT match YYYY -> must never be entered)
      //     2026/
      //       09.md

      const leafFile = {
        path: "Daily Notes/2026/09/09.md",
        name: "09.md",
        basename: "09",
        extension: "md",
        content: "- [x] [[Exercise]] [habit:: true]"
      };
      mockFilesMap.set(leafFile.path, leafFile);

      const monthFolder = {
        name: "09",
        path: "Daily Notes/2026/09",
        children: [leafFile]
      };

      const ignoredTemplateFolder = {
        name: "Templates",
        path: "Daily Notes/2026/Templates",
        children: [{ path: "Daily Notes/2026/Templates/temp.md", name: "temp.md", extension: "md" }]
      };

      const yearFolder = {
        name: "2026",
        path: "Daily Notes/2026",
        children: [monthFolder, ignoredTemplateFolder]
      };

      const ignoredArchiveFolder = {
        name: "Archive",
        path: "Daily Notes/Archive",
        children: [{ path: "Daily Notes/Archive/some.md", name: "some.md", extension: "md" }]
      };

      const rootDailyFolder = {
        name: "Daily Notes",
        path: "Daily Notes",
        children: [yearFolder, ignoredArchiveFolder]
      };
      mockFilesMap.set("Daily Notes", rootDailyFolder);

      // Collect files
      const collected = vaultSourceStore.collectCandidateFiles();

      // Only the valid leaf file should be collected
      expect(collected.map(f => f.path)).toContain("Daily Notes/2026/09/09.md");
      expect(collected.map(f => f.path)).not.toContain("Daily Notes/2026/Templates/temp.md");
      expect(collected.map(f => f.path)).not.toContain("Daily Notes/Archive/some.md");

      // Verify app.vault.getMarkdownFiles was NEVER called
      expect(mockApp.vault.getMarkdownFiles).not.toHaveBeenCalled();
    });
  });
});
