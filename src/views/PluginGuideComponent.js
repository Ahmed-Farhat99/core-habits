import { setIcon } from 'obsidian';

class PluginGuideComponent {
  constructor(plugin) {
    this.plugin = plugin;
  }

  render(panel, t, isAr) {
    panel.empty();
    panel.addClass("dh-guide-panel");

    panel.createEl("h2", { text: t("tab_guide"), cls: "dh-guide-main-title" });

    // Helper for sections
    const createSection = (icon, titleAr, titleEn) => {
      const section = panel.createDiv({ cls: "dh-guide-section" });
      const header = section.createDiv({ cls: "dh-guide-header" });
      const iconWrap = header.createDiv({ cls: "dh-guide-icon" });
      setIcon(iconWrap, icon);
      header.createEl("h3", { text: isAr ? titleAr : titleEn });
      return section.createDiv({ cls: "dh-guide-content" });
    };

    // 1. How to Start
    const start = createSection("rocket", "كيف تبدأ", "Getting Started");
    const startList = start.createEl("ol", { cls: "dh-guide-steps" });
    [
      isAr ? "اذهب إلى تبويب 'العادات' وأضف عاداتك." : "Go to the 'Habits' tab and add your habits.",
      isAr ? "افتح 'الجدول الأسبوعي' من أيقونة التقويم في الشريط الجانبي." : "Open 'Weekly Grid' from the calendar icon in the sidebar.",
      isAr ? "اضغط على الخلية لتعليم العادة ✓ أو تخطيها ⊘ أو إلغائها ☐." : "Click a cell to mark it ✓, skip ⊘, or unmark ☐.",
      isAr ? "تابع إحصائياتك من تبويب 'الإحصائيات'." : "Track your stats from the 'Statistics' tab."
    ].forEach(text => startList.createEl("li", { text }));

    // 2. Meaning of Symbols
    const symbols = createSection("info", "معاني الرموز", "Symbols Meaning");
    const symbolsGrid = symbols.createDiv({ cls: "dh-guide-symbols-grid" });
    const createSymbol = (s, cls, dAr, dEn) => {
      const row = symbolsGrid.createDiv({ cls: "dh-guide-symbol-row" });
      row.createDiv({ cls: `day-cell dh-grid-cell ${cls}`, text: s });
      row.createDiv({ cls: "dh-guide-symbol-text", text: isAr ? dAr : dEn });
    };
    createSymbol("✓", "completed", "مكتمل بنجاح", "Successfully completed");
    createSymbol("x", "missed", "فائت (يوم مضى)", "Missed (Past day)");
    createSymbol("⊘", "skipped", "تم التخطي (السلسلة لا تنكسر)", "Skipped (Streak preserved)");
    createSymbol("☐", "pending", "بانتظار الإنجاز", "Pending today");
    createSymbol("--", "not-scheduled", "غير مجدول لهذا اليوم", "Not scheduled for this day");

    // 3. Folders and Files
    const folders = createSection("folder-closed", "نظام الملفات والمجلدات", "Files and Folders");
    const foldersList = folders.createEl("ul", { cls: "dh-guide-steps" });
    [
      isAr ? "يتم حفظ ملف لكل عادة داخل مجلد 'Core Habits/Active'." : "Each habit has a file saved in 'Core Habits/Active'.",
      isAr ? "يحتوي الملف على خصائص العادة (Frontmatter) وملاحظات وسجل يومي." : "The file contains the habit properties (Frontmatter), notes, and a daily log.",
      isAr ? "عند أرشفة العادة، ينتقل ملفها تلقائياً إلى مجلد 'Archive'." : "When archiving a habit, its file automatically moves to the 'Archive' folder."
    ].forEach(text => foldersList.createEl("li", { text }));

    // 4. Gradation and Levels
    const levels = createSection("bar-chart", "التدرج والمراحل", "Gradation & Levels");
    const levelsList = levels.createEl("p", { cls: "dh-guide-text" });
    levelsList.textContent = isAr 
      ? "تتيح لك الإضافة تقسيم العادة الكبيرة إلى 5 مستويات (مثلاً: قراءة صفحة -> قراءة فصل -> كتاب). لا يمكنك الانتقال للمستوى التالي إلا بعد إنجاز شرط المستوى الحالي."
      : "The plugin allows breaking down a big habit into 5 levels (e.g., read a page -> read a chapter). You can't move to the next level without meeting the current level's condition.";

    // 5. Parent and Child Habits
    const parentChild = createSection("network", "العادات المرتبطة (أب وأبناء)", "Parent & Child Habits");
    const parentList = parentChild.createEl("p", { cls: "dh-guide-text" });
    parentList.textContent = isAr
      ? "يمكنك ربط عادات صغيرة (أبناء) بعادة رئيسية (أب). في واجهة التتبع، ستظهر العادات الأبناء أسفل العادة الأب، ويمكنك طي القائمة للتركيز."
      : "You can link small habits (children) to a main habit (parent). In the tracker, child habits appear under the parent, and you can collapse the list to focus.";

    // 6. Voice and Text Comments
    const comments = createSection("mic", "التعليقات الصوتية والنصية", "Voice & Text Comments");
    const commentsList = comments.createEl("p", { cls: "dh-guide-text" });
    commentsList.textContent = isAr
      ? "يمكنك إضافة تعليق نصي أو تسجيل صوتي يومي لكل عادة عن طريق النقر بزر الماوس الأيمن على خلية اليوم واختيار 'إضافة تعليق'. سيتم حفظه في ملف اليومية."
      : "You can add a daily text or voice comment for each habit by right-clicking a day cell and selecting 'Add Comment'. It will be saved in your daily note.";

    // Footer Tip
    panel.createDiv({
      cls: "dh-guide-tip",
      text: isAr
        ? "نصيحة: 'القليل المستمر خير من الكثير المنقطع'. ابدأ اليوم بأصغر فعل ممكن!"
        : "Tip: 'Consistency over Intensity'. Start today with the tiniest action!"
    });
  }
}

export { PluginGuideComponent };