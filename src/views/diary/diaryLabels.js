export function diaryEntriesLabel(plugin, count) {
  const language = plugin.settings?.language || "ar";
  const t = (key, params) => plugin.translationManager?.t(key, params) || key;
  if (language !== "ar") {
    return count === 1 ? t("diary_count_one") : t("diary_count_other", { count });
  }
  if (count === 1) return t("diary_count_one");
  if (count === 2) return t("diary_count_two");
  if (count >= 3 && count <= 10) return t("diary_count_few", { count });
  return t("diary_count_many", { count });
}
