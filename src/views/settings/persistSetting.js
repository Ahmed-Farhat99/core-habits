/** Save one setting and its optional heading history without leaving partial in-memory state. */
export async function persistSetting(plugin, key, value, { historyKey = null } = {}) {
  const previous = plugin.settings[key];
  const previousHistory = historyKey ? plugin.settings[historyKey] : null;
  if (value === previous) return false;

  plugin.settings[key] = value;
  if (historyKey && previous && value) {
    plugin.settings[historyKey] = [...new Set([
      ...(Array.isArray(previousHistory) ? previousHistory : []), previous
    ])];
  }
  try { await plugin.saveSettings({ silent: true }); }
  catch (error) {
    plugin.settings[key] = previous;
    if (historyKey) plugin.settings[historyKey] = previousHistory;
    throw error;
  }
  return true;
}
