const { Modal, setIcon } = require("obsidian");

export class OnboardingModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.currentStep = 1;
    this.isAr = this.plugin.settings.language === "ar";
    
    // Add custom class for styling
    this.modalEl.addClass("dh-onboarding-modal");
  }

  onOpen() {
    this.renderStep();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  renderStep() {
    const { contentEl } = this;
    contentEl.empty();

    const container = contentEl.createDiv({ cls: "dh-onboarding-container" });

    // Step Indicator
    const progressRow = container.createDiv({ cls: "dh-onboarding-progress" });
    for (let i = 1; i <= 3; i++) {
      const dot = progressRow.createDiv({ cls: `dh-onboarding-dot ${this.currentStep === i ? "active" : ""}` });
      if (this.currentStep > i) dot.addClass("completed");
    }

    // Header
    const header = container.createDiv({ cls: "dh-onboarding-header" });
    header.createEl("h1", { text: this.getHeaderTitle() });

    // Body
    const body = container.createDiv({ cls: "dh-onboarding-body" });
    this.renderBodyContent(body);

    // Footer
    const footer = container.createDiv({ cls: "dh-onboarding-footer" });
    
    if (this.currentStep > 1) {
      const btnBack = footer.createEl("button", { cls: "dh-btn-secondary" });
      btnBack.textContent = this.isAr ? "السابق" : "Back";
      btnBack.onclick = () => {
        this.currentStep--;
        this.renderStep();
      };
    } else {
      footer.createDiv(); // Empty spacer
    }

    const btnNext = footer.createEl("button", { cls: "mod-cta" });
    if (this.currentStep < 3) {
      btnNext.textContent = this.isAr ? "التالي" : "Next";
      btnNext.onclick = () => {
        this.currentStep++;
        this.renderStep();
      };
    } else {
      btnNext.textContent = this.isAr ? "ابدأ الآن 🚀" : "Start Now 🚀";
      btnNext.onclick = () => {
        this.close();
      };
    }
  }

  getHeaderTitle() {
    if (this.currentStep === 1) return this.isAr ? "🎉 مرحباً بك في Core Habits 3.0" : "🎉 Welcome to Core Habits 3.0";
    if (this.currentStep === 2) return this.isAr ? "🧠 هندسة العادات (Habit Engineering)" : "🧠 Habit Engineering";
    if (this.currentStep === 3) return this.isAr ? "⚡ محرك البيانات الجديد" : "⚡ The New Data Engine";
    return "";
  }

  renderBodyContent(body) {
    if (this.currentStep === 1) {
      body.createEl("p", {
        cls: "dh-onboarding-desc",
        text: this.isAr 
          ? "لقد قمنا بإعادة بناء الإضافة بالكامل لتكون أسرع، أجمل، وأكثر ذكاءً. هذه ليست مجرد إضافة لتتبع العادات، إنها أداة لبناء 'هويتك الأساسية'." 
          : "We have completely rebuilt the plugin to be faster, more beautiful, and smarter. This is not just a habit tracker; it's a tool to build your 'Core Identity'."
      });
      const feats = body.createDiv({ cls: "dh-onboarding-features" });
      this.addFeatureItem(feats, "✨", this.isAr ? "واجهة عصرية بالكامل" : "Completely modernized UI");
      this.addFeatureItem(feats, "📊", this.isAr ? "تحليل قوي للأنماط والتعافي" : "Powerful pattern & recovery analytics");
      this.addFeatureItem(feats, "🔒", this.isAr ? "أمان تام للبيانات (لا تضيع أبداً)" : "Absolute data safety (never lost)");
    } 
    else if (this.currentStep === 2) {
      body.createEl("p", {
        cls: "dh-onboarding-desc",
        text: this.isAr
          ? "العادة لا تُبنى بالضغط، بل بالهندسة الذكية. في الإصدار الجديد، يمكنك هندسة كل عادة بدقة:"
          : "Habits are not built with pressure, but with smart engineering. In the new version, you can engineer every habit:"
      });
      const feats = body.createDiv({ cls: "dh-onboarding-features" });
      this.addFeatureItem(feats, "👤", this.isAr ? "حدد هويتك (من أريد أن أكون؟)" : "Define Identity (Who do I want to be?)");
      this.addFeatureItem(feats, "⏰", this.isAr ? "اربطها بمحفز (زمان/مكان)" : "Link to a Cue (Time/Location)");
      this.addFeatureItem(feats, "🛤️", this.isAr ? "قلل الاحتكاك (اجعلها سهلة)" : "Reduce Friction (Make it easy)");
      this.addFeatureItem(feats, "🎁", this.isAr ? "حدد مكافأتك الفورية" : "Set an immediate Reward");
    }
    else if (this.currentStep === 3) {
      body.createEl("p", {
        cls: "dh-onboarding-desc",
        text: this.isAr
          ? "البيانات الآن لا مركزية! إنجازاتك (علامات الصح) تحفظ بداخل اليوميات نفسها. حتى لو قمت بحذف العادة من الإعدادات، إنجازاتك التاريخية ستظل محفورة في يومياتك للأبد في 'إجمالي الإنجازات'."
          : "Data is now decentralized! Your completions (checkmarks) are saved directly in your daily notes. Even if you delete a habit, your historical achievements are saved forever."
      });
      body.createDiv({
        cls: "dh-onboarding-alert",
        text: this.isAr 
          ? "💡 نصيحة: اكتب أفكارك ويومياتك عن العادة وسيقوم 'سجل التدوينات' بجمعها لك تلقائياً."
          : "💡 Tip: Write your thoughts about the habit, and the 'Reflection Log' will collect them automatically."
      });
    }
  }

  addFeatureItem(parent, icon, text) {
    const item = parent.createDiv({ cls: "dh-onboarding-feat-item" });
    item.createDiv({ cls: "dh-feat-icon", text: icon });
    item.createDiv({ cls: "dh-feat-text", text: text });
  }
}
