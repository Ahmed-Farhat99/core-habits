import { describe, it, expect } from "vitest";
import { HabitScanner } from "../src/services/HabitScanner.js";

describe("HabitScanner Tests", () => {
  const scanner = new HabitScanner();

  it("should match only checklists with the configured marker or inline habit field", () => {
    const content = `
- [ ] Non-habit task without marker
- [ ] Habit task with default marker [habit:: true]
- [x] Habit task with specific habit ID [habit:: habit-12345]
- [-] Skipped habit task [habit:: true]
- [ ] Another non-habit task
    `;

    const scanned = scanner.scan(content, "[habit:: true]");
    expect(scanned).toHaveLength(3);

    expect(scanned[0].text).toBe("Habit task with default marker");
    expect(scanned[0].completed).toBe(false);
    expect(scanned[0].skipped).toBe(false);
    expect(scanned[0].habitId).toBeNull(); // "true" is not a custom ID

    expect(scanned[1].text).toBe("Habit task with specific habit ID");
    expect(scanned[1].completed).toBe(true);
    expect(scanned[1].skipped).toBe(false);
    expect(scanned[1].habitId).toBe("habit-12345");

    expect(scanned[2].text).toBe("Skipped habit task");
    expect(scanned[2].completed).toBe(false);
    expect(scanned[2].skipped).toBe(true);
    expect(scanned[2].habitId).toBeNull();
  });

  it("should match custom configured markers and still capture inline habit IDs", () => {
    const content = `
- [ ] Task with custom marker #my-marker
- [ ] Task with custom marker and ID #my-marker [habit:: habit-abc]
- [ ] Task with just habit ID [habit:: habit-xyz]
- [ ] Task with no marker
    `;

    const scanned = scanner.scan(content, "#my-marker");
    expect(scanned).toHaveLength(3);

    expect(scanned[0].text).toBe("Task with custom marker");
    expect(scanned[0].habitId).toBeNull();

    expect(scanned[1].text).toBe("Task with custom marker and ID");
    expect(scanned[1].habitId).toBe("habit-abc");

    expect(scanned[2].text).toBe("Task with just habit ID");
    expect(scanned[2].habitId).toBe("habit-xyz");
  });

  it("should match successive lines with the custom marker without skipping due to global regex state", () => {
    const content = `
- [ ] Task 1 #my-marker
- [ ] Task 2 #my-marker
- [ ] Task 3 #my-marker
- [ ] Task 4 #my-marker
    `;

    const scanned = scanner.scan(content, "#my-marker");
    expect(scanned).toHaveLength(4);
    expect(scanned.map(h => h.text)).toEqual([
      "Task 1",
      "Task 2",
      "Task 3",
      "Task 4"
    ]);
  });
});
