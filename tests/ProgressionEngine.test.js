import { describe, it, expect } from 'vitest';
import { ProgressionEngine, MILESTONES } from '../src/services/ProgressionEngine.js';

describe('ProgressionEngine Tests', () => {
  it('should define exactly 5 milestones with the user-defined thresholds: 3, 7, 21, 90, 180 days', () => {
    expect(MILESTONES).toHaveLength(5);
    expect(MILESTONES[0].targetDays).toBe(3);
    expect(MILESTONES[1].targetDays).toBe(7);
    expect(MILESTONES[2].targetDays).toBe(21);
    expect(MILESTONES[3].targetDays).toBe(90);
    expect(MILESTONES[4].targetDays).toBe(180);
  });

  describe('calculateLevel', () => {
    it('should return level 1 for streak < 3', () => {
      expect(ProgressionEngine.calculateLevel({}, { currentStreak: 0 })).toBe(1);
      expect(ProgressionEngine.calculateLevel({}, { currentStreak: 1 })).toBe(1);
      expect(ProgressionEngine.calculateLevel({}, { currentStreak: 2 })).toBe(1);
    });

    it('should return level 2 for streak between 3 and 6', () => {
      expect(ProgressionEngine.calculateLevel({}, { currentStreak: 3 })).toBe(2);
      expect(ProgressionEngine.calculateLevel({}, { currentStreak: 5 })).toBe(2);
      expect(ProgressionEngine.calculateLevel({}, { currentStreak: 6 })).toBe(2);
    });

    it('should return level 3 for streak between 7 and 20', () => {
      expect(ProgressionEngine.calculateLevel({}, { currentStreak: 7 })).toBe(3);
      expect(ProgressionEngine.calculateLevel({}, { currentStreak: 14 })).toBe(3);
      expect(ProgressionEngine.calculateLevel({}, { currentStreak: 20 })).toBe(3);
    });

    it('should return level 4 for streak between 21 and 89', () => {
      expect(ProgressionEngine.calculateLevel({}, { currentStreak: 21 })).toBe(4);
      expect(ProgressionEngine.calculateLevel({}, { currentStreak: 50 })).toBe(4);
      expect(ProgressionEngine.calculateLevel({}, { currentStreak: 89 })).toBe(4);
    });

    it('should return level 5 for streak >= 90', () => {
      expect(ProgressionEngine.calculateLevel({}, { currentStreak: 90 })).toBe(5);
      expect(ProgressionEngine.calculateLevel({}, { currentStreak: 150 })).toBe(5);
      expect(ProgressionEngine.calculateLevel({}, { currentStreak: 180 })).toBe(5);
      expect(ProgressionEngine.calculateLevel({}, { currentStreak: 365 })).toBe(5);
    });

    it('should use longestStreak or savedLongestStreak if higher than currentStreak', () => {
      expect(ProgressionEngine.calculateLevel({ savedLongestStreak: 25 }, { currentStreak: 1 })).toBe(4);
      expect(ProgressionEngine.calculateLevel({}, { currentStreak: 2, longestStreak: 100 })).toBe(5);
    });

    it('should preserve legacy levelData achievement and never downgrade', () => {
      const levelData = [
        { achieved: true },
        { achieved: true },
        { achieved: true },
        { achieved: false },
        { achieved: false }
      ];
      // Even with 0 streak, levelData with index 2 achieved (milestone 3) gives level 4
      expect(ProgressionEngine.calculateLevel({ levelData }, { currentStreak: 0 })).toBe(4);
    });
  });

  describe('getProgressDetails', () => {
    it('should calculate accurate progress towards milestone 2 at level 1', () => {
      const habit = {};
      const details = ProgressionEngine.getProgressDetails(habit, { currentStreak: 1 });
      expect(details.currentLevel).toBe(1);
      expect(details.daysToNext).toBe(2); // 3 - 1
      expect(details.progressPercent).toBe(33); // 1 / 3
      expect(details.isMaxLevel).toBe(false);
      expect(details.nextMilestone.level).toBe(2);
    });

    it('should calculate accurate progress towards milestone 3 at level 2', () => {
      const habit = {};
      const details = ProgressionEngine.getProgressDetails(habit, { currentStreak: 5 });
      expect(details.currentLevel).toBe(2);
      expect(details.daysToNext).toBe(2); // 7 - 5
      expect(details.progressPercent).toBe(71); // 5 / 7 = 71%
      expect(details.isMaxLevel).toBe(false);
      expect(details.nextMilestone.level).toBe(3);
    });

    it('should calculate accurate progress towards milestone 4 at level 3', () => {
      const habit = {};
      const details = ProgressionEngine.getProgressDetails(habit, { currentStreak: 14 });
      expect(details.currentLevel).toBe(3);
      expect(details.daysToNext).toBe(7); // 21 - 14
      expect(details.progressPercent).toBe(67); // 14 / 21 = 67%
      expect(details.isMaxLevel).toBe(false);
      expect(details.nextMilestone.level).toBe(4);
    });

    it('should calculate non-zero progress for streak 4 at level 3 (17 days remaining)', () => {
      const habit = { savedLongestStreak: 8 }; // achieved level 3
      const details = ProgressionEngine.getProgressDetails(habit, { currentStreak: 4 });
      expect(details.currentLevel).toBe(3);
      expect(details.daysToNext).toBe(17); // 21 - 4
      expect(details.progressPercent).toBe(19); // 4 / 21 = 19%
      expect(details.isMaxLevel).toBe(false);
      expect(details.statusText).toContain('17');
      expect(details.statusText).toContain('19%');
    });

    it('should calculate accurate progress towards milestone 5 at level 4', () => {
      const habit = {};
      const details = ProgressionEngine.getProgressDetails(habit, { currentStreak: 55 });
      expect(details.currentLevel).toBe(4);
      expect(details.daysToNext).toBe(35); // 90 - 55
      expect(details.progressPercent).toBe(61); // 55 / 90 = 61%
      expect(details.isMaxLevel).toBe(false);
      expect(details.nextMilestone.level).toBe(5);
    });

    it('should calculate progress towards 180 days at level 5 before mastery', () => {
      const habit = {};
      const details = ProgressionEngine.getProgressDetails(habit, { currentStreak: 135 });
      expect(details.currentLevel).toBe(5);
      expect(details.daysToNext).toBe(45); // 180 - 135
      expect(details.progressPercent).toBe(75); // 135 / 180 = 75%
      expect(details.isMaxLevel).toBe(false);
    });

    it('should mark max level when streak >= 180 days', () => {
      const habit = {};
      const details = ProgressionEngine.getProgressDetails(habit, { currentStreak: 180 });
      expect(details.currentLevel).toBe(5);
      expect(details.isMaxLevel).toBe(true);
      expect(details.progressPercent).toBe(100);
      expect(details.daysToNext).toBe(0);
      expect(details.statusText).toContain('السجية ونمط الحياة المستقر');
    });

    it('should handle broken streak (activeStreak = 0) with resume message and full requirement', () => {
      const habit = { savedLongestStreak: 25 }; // Level 4
      const details = ProgressionEngine.getProgressDetails(habit, { currentStreak: 0 });
      expect(details.currentLevel).toBe(4);
      expect(details.daysToNext).toBe(90);
      expect(details.progressPercent).toBe(0);
      expect(details.isMaxLevel).toBe(false);
      expect(details.statusText).toContain('استأنف السلسلة');
    });
  });
});
