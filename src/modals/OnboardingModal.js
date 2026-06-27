import { BaseHabitModal } from "./BaseHabitModal.js";

export class OnboardingModal extends BaseHabitModal {
  constructor(app, plugin) {
    super(app, plugin);
    this.currentStep = 1;
    
    // Add custom class for styling
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

    const t = (key) => this.plugin.translationManager.t(key);

    const container = contentEl.createDiv({ cls: "dh-onboarding-container" });

    // Step Indicator
    const progressRow = container.createDiv({ cls: "dh-onboarding-progress" });
    for (let i = 1; i <= 3; i++) {
      const dot = progressRow.createDiv({ cls: `dh-onboarding-dot ${this.currentStep === i ? "active" : ""}` });
      if (this.currentStep > i) dot.addClass("completed");
    }

    // Header
    const header = container.createDiv({ cls: "dh-onboarding-header" });
    header.createEl("h1", { text: this.getHeaderTitle(t) });

    // Body
    const body = container.createDiv({ cls: "dh-onboarding-body" });
    this.renderBodyContent(body, t);

    // Footer
    const footer = container.createDiv({ cls: "dh-modal-actions" });
    
    if (this.currentStep > 1) {
      const btnBack = footer.createEl("button", { cls: "dh-btn dh-btn-secondary" });
      btnBack.textContent = t("onboarding_back");
      btnBack.onclick = () => {
        this.currentStep--;
        this.renderStep();
      };
    } else {
      footer.createDiv(); // Empty spacer
    }

    const btnNext = footer.createEl("button", { cls: "dh-btn mod-cta" });
    if (this.currentStep < 3) {
      btnNext.textContent = t("onboarding_next");
      btnNext.onclick = () => {
        this.currentStep++;
        this.renderStep();
      };
    } else {
      btnNext.textContent = t("onboarding_start");
      btnNext.onclick = () => {
        this.close();
      };
    }
  }

  getHeaderTitle(t) {
    if (this.currentStep === 1) return t("onboarding_title_1");
    if (this.currentStep === 2) return t("onboarding_title_2");
    if (this.currentStep === 3) return t("onboarding_title_3");
    return "";
  }

  renderBodyContent(body, t) {
    if (this.currentStep === 1) {
      body.createEl("p", {
        cls: "dh-onboarding-desc",
        text: t("onboarding_desc_1")
      });
      const feats = body.createDiv({ cls: "dh-onboarding-features" });
      this.addFeatureItem(feats, "✨", t("onboarding_feat_1"));
      this.addFeatureItem(feats, "📊", t("onboarding_feat_2"));
      this.addFeatureItem(feats, "🔒", t("onboarding_feat_3"));
    } 
    else if (this.currentStep === 2) {
      body.createEl("p", {
        cls: "dh-onboarding-desc",
        text: t("onboarding_desc_2")
      });
      const feats = body.createDiv({ cls: "dh-onboarding-features" });
      this.addFeatureItem(feats, "👤", t("onboarding_feat_4"));
      this.addFeatureItem(feats, "⏰", t("onboarding_feat_5"));
      this.addFeatureItem(feats, "🛤️", t("onboarding_feat_6"));
      this.addFeatureItem(feats, "🎁", t("onboarding_feat_7"));
    }
    else if (this.currentStep === 3) {
      body.createEl("p", {
        cls: "dh-onboarding-desc",
        text: t("onboarding_desc_3")
      });
      body.createDiv({
        cls: "dh-onboarding-alert",
        text: t("onboarding_tip_3")
      });
    }
  }

  addFeatureItem(parent, icon, text) {
    const item = parent.createDiv({ cls: "dh-onboarding-feat-item" });
    item.createDiv({ cls: "dh-feat-icon", text: icon });
    item.createDiv({ cls: "dh-feat-text", text: text });
  }
}
