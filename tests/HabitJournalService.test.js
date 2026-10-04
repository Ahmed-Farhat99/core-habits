import { describe, it, expect, vi } from "vitest";
import { HabitJournalService } from "../src/services/HabitJournalService.js";

describe("HabitJournalService", () => {
  it("routes a comment write through the repository and invalidates diary data after success", async () => {
    const repository = { upsertCommentForHabitDate: vi.fn().mockResolvedValue("2026-09-17") };
    const clearCache = vi.fn();
    const service = new HabitJournalService({ habitCommentRepository: repository, diaryService: { clearCache } });
    const habit = { id: "h1" };
    const date = { date: "2026-09-17" };

    await expect(service.saveHabitComment(habit, date, "note")).resolves.toBe("2026-09-17");
    expect(repository.upsertCommentForHabitDate).toHaveBeenCalledWith(habit, date, "note");
    expect(clearCache).toHaveBeenCalledOnce();
  });

  it("keeps the existing cache when a reflection write fails", async () => {
    const failure = new Error("write failed");
    const clearCache = vi.fn();
    const service = new HabitJournalService({
      habitCommentRepository: { injectReflection: vi.fn().mockRejectedValue(failure) },
      diaryService: { clearCache },
    });

    await expect(service.saveReflection({}, "note", "reflection")).rejects.toBe(failure);
    expect(clearCache).not.toHaveBeenCalled();
  });
});
