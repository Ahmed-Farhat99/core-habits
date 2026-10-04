import type { Moment } from "moment";

export interface HabitReference {
  id: string;
  name: string;
  linkText?: string;
  nameHistory?: string[];
}

export interface HabitJournalRepositoryPort {
  upsertCommentForHabitDate(habit: HabitReference, date: Moment, text: string): Promise<string>;
  injectReflection(date: Moment, text: string, type: string): Promise<string>;
  getCommentHistoryByName(habitName: string, limit: number): Promise<unknown[]>;
}

export interface HabitJournalPluginPort {
  habitCommentRepository: HabitJournalRepositoryPort;
  diaryService?: { clearCache(): void };
}
