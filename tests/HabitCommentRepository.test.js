import { describe, it, expect, beforeEach, vi } from "vitest";
import { HabitCommentRepository } from "../src/repositories/HabitCommentRepository.js";
import { TFile } from "obsidian";
import * as helpers from "../src/utils/helpers.js";

vi.mock("../src/utils/helpers.js", async () => {
  const actual = await vi.importActual("../src/utils/helpers.js");
  return {
    ...actual,
    getNoteByDate: vi.fn()
  };
});

describe("HabitCommentRepository Tests", () => {
  let mockApp;
  let mockPlugin;
  let repository;

  beforeEach(() => {
    mockApp = {
      vault: {
        process: vi.fn(),
        cachedRead: vi.fn()
      }
    };
    mockPlugin = {
      settings: {
        habitLogHeading: "## 📖 Habit Log",
        dailyParentHeading: "",
        language: "en"
      }
    };
    repository = new HabitCommentRepository(mockApp, mockPlugin);
    vi.clearAllMocks();
  });

  it("should format and upsert comment with habit-id and habit-note tags", async () => {
    const habit = {
      id: "habit-abc",
      name: "Reading",
      linkText: "Reading",
      nameHistory: []
    };
    const targetDate = window.moment("2026-06-22");
    const mockFile = new TFile("Daily/2026-06-22.md");
    helpers.getNoteByDate.mockResolvedValue(mockFile);

    let processedContent = "";
    mockApp.vault.process.mockImplementation(async (file, callback) => {
      processedContent = callback("## 📖 Habit Log\n");
      return file;
    });

    const result = await repository.upsertCommentForHabitDate(habit, targetDate, "Read 20 pages");
    
    expect(helpers.getNoteByDate).toHaveBeenCalledWith(mockApp, targetDate, true, mockPlugin.settings);
    expect(result).toBe(mockFile.basename);
    expect(processedContent).toContain("[habit-id:: habit-abc]");
    expect(processedContent).toContain("[habit-note:: Reading]");
    expect(processedContent).toContain("Read 20 pages");
  });

  it("should update an existing comment instead of appending a duplicate line", async () => {
    const habit = {
      id: "habit-abc",
      name: "Reading",
      linkText: "Reading",
      nameHistory: []
    };
    const targetDate = window.moment("2026-06-22");
    const mockFile = new TFile("Daily/2026-06-22.md");
    helpers.getNoteByDate.mockResolvedValue(mockFile);

    const originalContent = `## 📖 Habit Log
- 08:30 [habit-id:: habit-abc] [habit-note:: Reading] Reading - Old Comment
`;

    let processedContent = "";
    mockApp.vault.process.mockImplementation(async (file, callback) => {
      processedContent = callback(originalContent);
      return file;
    });

    await repository.upsertCommentForHabitDate(habit, targetDate, "New Comment");

    expect(processedContent).toContain("New Comment");
    expect(processedContent).not.toContain("Old Comment");
    // Verify it replaced it in place and didn't add a new line
    const lines = processedContent.split("\n").filter(l => l.includes("habit-id:: habit-abc"));
    expect(lines.length).toBe(1);
  });

  it("should match by name history fallback if habit-id is missing", async () => {
    const habit = {
      id: "habit-abc",
      name: "Reading",
      linkText: "Reading",
      nameHistory: ["Old Reading", "Reading Books"]
    };
    const targetDate = window.moment("2026-06-22");
    const mockFile = new TFile("Daily/2026-06-22.md");
    helpers.getNoteByDate.mockResolvedValue(mockFile);

    const originalContent = `## 📖 Habit Log
- 08:30 [habit-note:: Reading Books] Reading Books - Old comment to update
`;

    let processedContent = "";
    mockApp.vault.process.mockImplementation(async (file, callback) => {
      processedContent = callback(originalContent);
      return file;
    });

    await repository.upsertCommentForHabitDate(habit, targetDate, "Updated comment");

    expect(processedContent).toContain("Updated comment");
    expect(processedContent).not.toContain("Old comment to update");
    const lines = processedContent.split("\n").filter(l => l.includes("habit-id:: habit-abc"));
    expect(lines.length).toBe(1);
  });

  it("should retrieve a comment matching habit-id", async () => {
    const habit = {
      id: "habit-abc",
      name: "Reading",
      linkText: "Reading",
      nameHistory: []
    };
    const targetDate = window.moment("2026-06-22");
    const mockFile = new TFile("Daily/2026-06-22.md");
    helpers.getNoteByDate.mockResolvedValue(mockFile);

    const fileContent = `## 📖 Habit Log
- 08:30 [habit-id:: habit-abc] [habit-note:: Reading] Reading - Read 15 pages
`;
    mockApp.vault.cachedRead.mockResolvedValue(fileContent);

    const comment = await repository.getCommentForHabitDate(habit, targetDate);
    expect(comment).toBe("Read 15 pages");
  });

  it("should retrieve a comment history for a habit", async () => {
    const habit = {
      id: "habit-abc",
      name: "Reading",
      linkText: "Reading",
      nameHistory: []
    };
    const mockFile = new TFile("Daily/2026-06-22.md");
    helpers.getNoteByDate.mockResolvedValue(mockFile);

    const fileContent = `## 📖 Habit Log
- 08:30 [habit-id:: habit-abc] [habit-note:: Reading] Reading - Read 25 pages
`;
    mockApp.vault.cachedRead.mockResolvedValue(fileContent);

    const history = await repository.getCommentHistoryForHabit(habit, 3);
    // Since getNoteByDate is mocked to return mockFile for any date in loop, it will read 3 days
    expect(history.length).toBe(3);
    expect(history[0].text).toBe("Read 25 pages");
  });
});
