import { setIcon } from "obsidian";
import { BaseHabitModal } from "./BaseHabitModal.js";

export class OnboardingModal extends BaseHabitModal {
  constructor(app, plugin) {
    super(app, plugin);
    this.currentStep = 1;
    this.totalSteps = 2;

    this.modalEl.addClass("dh-onboarding-modal");
  }

  onOpen() {
    super.onOpen();
    this.renderStep();
  }

  onClose() {
    super.onClose();
  }

  renderStep() {
    const { contentEl } = this;
    contentEl.empty();

    const t = (key, params = {}) => this.plugin.translationManager.t(key, params);

    const container = contentEl.createDiv({ cls: "dh-onboarding-container" });

    // Step Indicator (2 steps)
    const progressRow = container.createDiv({ cls: "dh-onboarding-progress" });
    for (let i = 1; i <= this.totalSteps; i++) {
      const dot = progressRow.createDiv({
        cls: `dh-onboarding-dot ${this.currentStep === i ? "active" : ""}`
      });
      if (this.currentStep > i) dot.addClass("completed");
    }

    // Header
    const header = container.createDiv({ cls: "dh-onboarding-header" });
    header.createEl("h1", { text: this.getHeaderTitle(t) });

    // Body
    const body = container.createDiv({ cls: "dh-onboarding-body" });
    this.renderBodyContent(body, t);

    // Footer
    const footer = container.createDiv({ cls: "dh-modal-actions dh-popup-footer-split" });

    if (this.currentStep > 1) {
      const btnBack = footer.createEl("button", { cls: "dh-btn", type: "button" });
      btnBack.textContent = t("onboarding_back");
      btnBack.onclick = () => {
        this.currentStep--;
        this.renderStep();
      };
    } else {
      footer.createDiv(); // Empty spacer for flex spacing
    }

    const endGroup = footer.createDiv({ cls: "dh-modal-actions-end" });
    const btnNext = endGroup.createEl("button", { cls: "dh-btn mod-cta", type: "button" });

    if (this.currentStep < this.totalSteps) {
      btnNext.textContent = t("onboarding_next");
      btnNext.onclick = () => {
        this.currentStep++;
        this.renderStep();
      };
    } else {
      btnNext.textContent = t("onboarding_start");
      btnNext.onclick = async () => {
        this.close();
        try {
          await this.plugin.activateWeeklyView();
        } catch (e) {
          console.warn("[Core Habits] Could not activate weekly view:", e);
        }
        setTimeout(() => {
          if (!this.plugin._isUnloading && typeof this.plugin.openAddHabit === "function") {
            this.plugin.openAddHabit();
          }
        }, 100);
      };
    }
  }

  getHeaderTitle(t) {
    return this.currentStep === 1 ? t("onboarding_title_1") : t("onboarding_title_2");
  }

  renderBodyContent(body, t) {
    if (this.currentStep === 1) {
      body.createEl("p", {
        cls: "dh-onboarding-desc",
        text: t("onboarding_desc_1")
      });

      const feats = body.createDiv({ cls: "dh-onboarding-features" });
      this.addFeatureItem(feats, "calendar-days", t("onboarding_feat_title_1"), t("onboarding_feat_desc_1"));
      this.addFeatureItem(feats, "layout-grid", t("onboarding_feat_title_2"), t("onboarding_feat_desc_2"));
      this.addFeatureItem(feats, "target", t("onboarding_feat_title_3"), t("onboarding_feat_desc_3"));
    } else if (this.currentStep === 2) {
      body.createEl("p", {
        cls: "dh-onboarding-desc",
        text: t("onboarding_desc_2")
      });

      const alert = body.createDiv({ cls: "dh-onboarding-alert" });
      const alertIcon = alert.createDiv({ cls: "dh-onboarding-alert-icon" });
      setIcon(alertIcon, "lightbulb");
      alert.createDiv({
        cls: "dh-onboarding-alert-text",
        text: t("onboarding_tip_2")
      });
    }
  }

  addFeatureItem(parent, iconName, title, description) {
    const item = parent.createDiv({ cls: "dh-onboarding-feat-item" });
    const iconEl = item.createDiv({ cls: "dh-feat-icon" });
    setIcon(iconEl, iconName);

    const content = item.createDiv({ cls: "dh-feat-content" });
    content.createEl("strong", { cls: "dh-feat-title", text: title });
    content.createEl("span", { cls: "dh-feat-desc", text: description });
  }
}
