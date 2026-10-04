export class PluginGuideComponent {
  constructor(plugin) {
    this.plugin = plugin;
  }

  render(panel, t) {
    panel.empty();
    panel.addClass("dh-guide-panel");

    // 1. Hero Header (Clean, spacious, dignified)
    const hero = panel.createDiv({ cls: "dh-guide-hero" });
    hero.createEl("h3", { text: t("guide_hero_title"), cls: "dh-guide-hero-title" });
    hero.createEl("p", { text: t("guide_hero_subtitle"), cls: "dh-guide-hero-subtitle" });

    // Detect RTL
    const isRtl = (document.documentElement.dir === "rtl" || this.plugin?.translationManager?.getLanguage?.() === "ar");

    // 2. Practical Quick Start (All vertical, one below the other)
    const qsSection = panel.createDiv({ cls: "dh-guide-section" });
    const qsHeader = qsSection.createDiv({ cls: "dh-guide-section-header" });
    qsHeader.createEl("h4", { text: t("guide_quickstart_title"), cls: "dh-guide-section-title" });
    if (t("guide_quickstart_subtitle")) {
      qsHeader.createEl("p", { text: t("guide_quickstart_subtitle"), cls: "dh-guide-section-subtitle" });
    }

    const qsList = qsSection.createDiv({ cls: "dh-guide-card-stack" });
    const quickSteps = [
      { num: "١", enNum: "1", titleKey: "guide_qs_step1_title", descKey: "guide_qs_step1_desc" },
      { num: "٢", enNum: "2", titleKey: "guide_qs_step2_title", descKey: "guide_qs_step2_desc" },
      { num: "٣", enNum: "3", titleKey: "guide_qs_step3_title", descKey: "guide_qs_step3_desc" },
      { num: "٤", enNum: "4", titleKey: "guide_qs_step4_title", descKey: "guide_qs_step4_desc" }
    ];

    quickSteps.forEach(stepItem => {
      const card = qsList.createDiv({ cls: "dh-card dh-guide-card dh-guide-qs-item" });
      card.createDiv({ cls: "dh-guide-step-badge", text: isRtl ? stepItem.num : stepItem.enNum });
      const body = card.createDiv({ cls: "dh-guide-card-body" });
      body.createEl("h5", { cls: "dh-guide-card-title", text: t(stepItem.titleKey) });
      body.createEl("p", { cls: "dh-guide-card-desc", text: t(stepItem.descKey) });
    });

    // 3. Status Marks & Meaning (All vertical, one below the other)
    const statusSection = panel.createDiv({ cls: "dh-guide-section" });
    const statusHeader = statusSection.createDiv({ cls: "dh-guide-section-header" });
    statusHeader.createEl("h4", { text: t("guide_step3_title"), cls: "dh-guide-section-title" });
    if (t("guide_step3_desc")) {
      statusHeader.createEl("p", { text: t("guide_step3_desc"), cls: "dh-guide-section-subtitle" });
    }

    const statusList = statusSection.createDiv({ cls: "dh-guide-card-stack" });
    const statusItems = [
      { cls: "completed", mark: "✓", titleKey: "guide_symbol_completed_title", descKey: "guide_symbol_completed_desc" },
      { cls: "skipped", mark: "⊘", titleKey: "guide_symbol_skipped_title", descKey: "guide_symbol_skipped_desc" },
      { cls: "pending", mark: "☐", titleKey: "guide_symbol_pending_title", descKey: "guide_symbol_pending_desc" },
      { cls: "missed", mark: "✕", titleKey: "guide_symbol_missed_title", descKey: "guide_symbol_missed_desc" },
      { cls: "not-scheduled", mark: "—", titleKey: "guide_symbol_not_scheduled_title", descKey: "guide_symbol_not_scheduled_desc" }
    ];

    statusItems.forEach(item => {
      const card = statusList.createDiv({ cls: `dh-card dh-guide-card dh-guide-status-item ${item.cls}` });
      card.createDiv({ cls: `dh-guide-status-badge ${item.cls}`, text: item.mark });
      const body = card.createDiv({ cls: "dh-guide-card-body" });
      body.createEl("h5", { cls: "dh-guide-card-title", text: t(item.titleKey) });
      body.createEl("p", { cls: "dh-guide-card-desc", text: t(item.descKey) });
    });

    // 4. Key Features (All vertical, one below the other)
    const featSection = panel.createDiv({ cls: "dh-guide-section" });
    const featHeader = featSection.createDiv({ cls: "dh-guide-section-header" });
    featHeader.createEl("h4", { text: t("guide_features_title"), cls: "dh-guide-section-title" });

    const featList = featSection.createDiv({ cls: "dh-guide-card-stack" });
    const features = [
      { titleKey: "guide_levels_title", descKey: "guide_levels_desc" },
      { titleKey: "guide_parent_title", descKey: "guide_parent_desc" },
      { titleKey: "guide_folders_title", descKey: "guide_folders_desc" }
    ];

    features.forEach(feat => {
      const card = featList.createDiv({ cls: "dh-card dh-guide-card dh-guide-feature-item" });
      const body = card.createDiv({ cls: "dh-guide-card-body" });
      body.createEl("h5", { cls: "dh-guide-card-title", text: t(feat.titleKey) });
      body.createEl("p", { cls: "dh-guide-card-desc", text: t(feat.descKey) });
    });

    // 5. Prophetic Wisdom Footer
    const footerQuote = panel.createDiv({ cls: "dh-guide-footer-quote" });
    const quoteBox = footerQuote.createDiv({ cls: "dh-guide-quote-box" });
    quoteBox.createEl("blockquote", {
      text: t("guide_footer_quote"),
      cls: "dh-guide-quote-text"
    });
  }
}
