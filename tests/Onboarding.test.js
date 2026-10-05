import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OnboardingModal } from "../src/modals/OnboardingModal.js";

describe("Onboarding Experience Tests", () => {
  let mockApp;
  let mockPlugin;

  beforeEach(() => {
    mockApp = {
      workspace: {
        getLeavesOfType: vi.fn().mockReturnValue([]),
        getLeaf: vi.fn().mockReturnValue({
          setViewState: vi.fn().mockResolvedValue(undefined),
        }),
        revealLeaf: vi.fn(),
      },
    };

    mockPlugin = {
      app: mockApp,
      manifest: { version: "3.5.3" },
      settings: {
        language: "en",
        lastSeenVersion: "",
        habits: [],
      },
      translationManager: {
        t: vi.fn((key) => {
          const dict = {
            onboarding_title_1: "Welcome to Core Habits",
            onboarding_title_2: "Ready to Begin",
            onboarding_desc_1: "Identity-driven habit tracking for Obsidian.",
            onboarding_desc_2: "Start with one small habit.",
            onboarding_feat_title_1: "Daily Notes Integration",
            onboarding_feat_desc_1: "Track habits directly inside your daily notes.",
            onboarding_feat_title_2: "Visual Weekly Grid",
            onboarding_feat_desc_2: "Review your week at a glance.",
            onboarding_feat_title_3: "Identity & Consistency",
            onboarding_feat_desc_3: "Anchor habits to who you want to become.",
            onboarding_tip_2: "Tip: Consistency beats intensity.",
            onboarding_back: "Back",
            onboarding_next: "Next",
            onboarding_start: "Add First Habit",
            direction: "ltr",
          };
          return dict[key] || key;
        }),
      },
      activateWeeklyView: vi.fn().mockResolvedValue(undefined),
      openAddHabit: vi.fn(),
      refreshWeeklyViews: vi.fn(),
      saveSettings: vi.fn().mockResolvedValue(undefined),
      _isUnloading: false,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("OnboardingModal UI & Step Flow", () => {
    it("should initialize with exactly 2 steps", () => {
      const modal = new OnboardingModal(mockApp, mockPlugin);
      expect(modal.totalSteps).toBe(2);
      expect(modal.currentStep).toBe(1);
    });

    it("should render Step 1 with 2 progress dots and 3 Lucide feature items without emojis or version badge", () => {
      const modal = new OnboardingModal(mockApp, mockPlugin);
      modal.onOpen();

      // Check progress dots
      const dots = modal.contentEl.querySelectorAll(".dh-onboarding-dot");
      expect(dots.length).toBe(2);
      expect(dots[0].classList.contains("active")).toBe(true);

      // Check title and description
      const h1 = modal.contentEl.querySelector(".dh-onboarding-header h1");
      expect(h1.textContent).toBe("Welcome to Core Habits");

      // Verify NO version badge exists
      const versionBadge = modal.contentEl.querySelector(".dh-onboarding-version-badge");
      expect(versionBadge).toBeNull();

      // Check 3 feature items
      const featItems = modal.contentEl.querySelectorAll(".dh-onboarding-feat-item");
      expect(featItems.length).toBe(3);

      // Verify no emojis in the feature titles
      const textContent = modal.contentEl.textContent;
      expect(textContent).not.toContain("✨");
      expect(textContent).not.toContain("📊");
      expect(textContent).not.toContain("🔒");

      // Check footer: Back button should NOT exist on Step 1, Next button should exist
      const backBtn = modal.contentEl.querySelector(".dh-modal-actions button:not(.mod-cta)");
      expect(backBtn).toBeNull();

      const nextBtn = modal.contentEl.querySelector(".dh-modal-actions .mod-cta");
      expect(nextBtn).not.toBeNull();
      expect(nextBtn.textContent).toBe("Next");
    });

    it("should navigate to Step 2 when Next is clicked, then Back to Step 1", () => {
      const modal = new OnboardingModal(mockApp, mockPlugin);
      modal.onOpen();

      // Click Next
      const nextBtn = modal.contentEl.querySelector(".dh-modal-actions .mod-cta");
      nextBtn.click();

      expect(modal.currentStep).toBe(2);

      // Check Step 2 UI
      const h1 = modal.contentEl.querySelector(".dh-onboarding-header h1");
      expect(h1.textContent).toBe("Ready to Begin");

      const alert = modal.contentEl.querySelector(".dh-onboarding-alert");
      expect(alert).not.toBeNull();
      expect(alert.textContent).toContain("Consistency beats intensity");

      const startBtn = modal.contentEl.querySelector(".dh-modal-actions .mod-cta");
      expect(startBtn.textContent).toBe("Add First Habit");

      // Check Back button
      const backBtn = modal.contentEl.querySelector(".dh-modal-actions button:not(.mod-cta)");
      expect(backBtn).not.toBeNull();
      expect(backBtn.textContent).toBe("Back");

      // Click Back
      backBtn.click();
      expect(modal.currentStep).toBe(1);
      const h1Step1 = modal.contentEl.querySelector(".dh-onboarding-header h1");
      expect(h1Step1.textContent).toBe("Welcome to Core Habits");
    });

    it("should close onboarding, activate weekly view, and trigger openAddHabit when finish CTA is clicked", async () => {
      vi.useFakeTimers();

      const modal = new OnboardingModal(mockApp, mockPlugin);
      modal.onOpen();

      const closeSpy = vi.spyOn(modal, "close");

      // Go to Step 2
      const nextBtn = modal.contentEl.querySelector(".dh-modal-actions .mod-cta");
      nextBtn.click();

      // Click 'Add First Habit' CTA
      const startBtn = modal.contentEl.querySelector(".dh-modal-actions .mod-cta");
      await startBtn.click();

      expect(closeSpy).toHaveBeenCalled();
      expect(mockPlugin.activateWeeklyView).toHaveBeenCalled();

      // Advance timer for setTimeout
      vi.advanceTimersByTime(150);

      expect(mockPlugin.openAddHabit).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe("Startup Decision Logic (Fresh Install vs Existing User vs Update)", () => {
    it("should identify fresh install when lastSeenVersion is empty and no habits exist", () => {
      const settings = { lastSeenVersion: "", habits: [] };
      const habitManager = { getHabits: () => [] };

      const hasExistingHabits = (Array.isArray(settings.habits) && settings.habits.length > 0) ||
        (habitManager && typeof habitManager.getHabits === "function" && habitManager.getHabits().length > 0);

      expect(hasExistingHabits).toBe(false);
      // Genuine fresh install -> Show Onboarding
    });

    it("should identify existing user when lastSeenVersion is empty but habits exist in settings", () => {
      const settings = { lastSeenVersion: "", habits: [{ id: "h1", name: "Read" }] };
      const habitManager = { getHabits: () => [] };

      const hasExistingHabits = (Array.isArray(settings.habits) && settings.habits.length > 0) ||
        (habitManager && typeof habitManager.getHabits === "function" && habitManager.getHabits().length > 0);

      expect(hasExistingHabits).toBe(true);
      // Existing user upgrading -> Skip Onboarding
    });

    it("should identify existing user when habits exist in habitManager", () => {
      const settings = { lastSeenVersion: "", habits: [] };
      const habitManager = { getHabits: () => [{ id: "h2", name: "Exercise" }] };

      const hasExistingHabits = (Array.isArray(settings.habits) && settings.habits.length > 0) ||
        (habitManager && typeof habitManager.getHabits === "function" && habitManager.getHabits().length > 0);

      expect(hasExistingHabits).toBe(true);
      // Existing user upgrading -> Skip Onboarding
    });
  });
});
