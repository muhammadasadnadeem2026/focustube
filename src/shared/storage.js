/*
 * FocusTube — storage layer.
 * Everything lives in chrome.storage.local: nothing is synced to a Google
 * account and nothing leaves the browser.
 *
 *   settings  → individual keys matching FT_DEFAULTS
 *   ftStats   → { today: {date, ...counts}, total: {...counts} }
 */

const FT_STATS_KEY = 'ftStats';

async function ftGetSettings() {
  const stored = await chrome.storage.local.get(Object.keys(FT_DEFAULTS));
  return ftMergeSettings(stored);
}

function ftMergeSettings(stored) {
  const merged = { ...FT_DEFAULTS, ...stored };
  merged.schedule = { ...FT_DEFAULTS.schedule, ...(stored.schedule || {}) };
  return merged;
}

function ftSetSettings(patch) {
  return chrome.storage.local.set(patch);
}

async function ftResetSettings() {
  await chrome.storage.local.remove(Object.keys(FT_DEFAULTS));
}

function ftTodayKey(date = new Date()) {
  // Local calendar date, YYYY-MM-DD.
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function ftGetStats() {
  const { [FT_STATS_KEY]: stats } = await chrome.storage.local.get(FT_STATS_KEY);
  const today = ftTodayKey();
  const result = {
    today: { date: today, ...FT_EMPTY_STATS },
    total: { ...FT_EMPTY_STATS }
  };
  if (stats) {
    result.total = { ...FT_EMPTY_STATS, ...stats.total };
    if (stats.today && stats.today.date === today) result.today = { ...result.today, ...stats.today };
  }
  return result;
}

/** Seconds saved, using the published per-item estimates. */
function ftTimeSaved(counts) {
  return (counts.shorts || 0) * FT_TIME_ESTIMATES.shorts
    + (counts.videos || 0) * FT_TIME_ESTIMATES.videos
    + (counts.distractions || 0) * FT_TIME_ESTIMATES.distractions;
}

function ftFormatDuration(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 1) return '0m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}
