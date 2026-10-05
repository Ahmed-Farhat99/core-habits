import { describe, it, expect, vi } from "vitest";
import { NoticeService } from "../src/services/NoticeService.js";

describe("Startup Notice Safety", () => {
  it("executes NoticeService.warning and NoticeService.warn without throwing", () => {
    const fakePlugin = {
      translationManager: {
        t: vi.fn((key) => key),
        isRTL: () => false
      }
    };

    // Test conflict notice path
    expect(() => {
      const conflictMsg = "Core Habits: 2 conflicting habit(s) were quarantined to protect your data.";
      const notice = NoticeService.warning(conflictMsg, 10000, fakePlugin);
      expect(notice).toBeDefined();
      expect(notice.duration).toBe(10000);
    }).not.toThrow();

    // Test malformed note notice path
    expect(() => {
      const malformedMsg = "Core Habits: 1 habit note(s) are missing habit_id or unreadable and were skipped.";
      const notice = NoticeService.warning(malformedMsg, 8000, fakePlugin);
      expect(notice).toBeDefined();
      expect(notice.duration).toBe(8000);
    }).not.toThrow();

    // Test stats degraded notice path
    expect(() => {
      const degradedMsg = "Core Habits: Statistics are partial. 1 daily note(s) could not be read safely.";
      const notice = NoticeService.warning(degradedMsg, 7000, fakePlugin);
      expect(notice).toBeDefined();
      expect(notice.duration).toBe(7000);
    }).not.toThrow();

    // Test migration partial failure notice path
    expect(() => {
      const warnMsg = "Core Habits: 1 habit note(s) could not be migrated automatically. Safe backups preserved.";
      const notice = NoticeService.warning(warnMsg, 8000, fakePlugin);
      expect(notice).toBeDefined();
      expect(notice.duration).toBe(8000);
    }).not.toThrow();

    // Test defensive alias .warn calls
    expect(() => {
      const aliasNotice = NoticeService.warn("Defensive alias warning", 6000, fakePlugin);
      expect(aliasNotice).toBeDefined();
      expect(aliasNotice.duration).toBe(6000);
    }).not.toThrow();
  });
});
