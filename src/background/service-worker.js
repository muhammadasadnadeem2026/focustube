/*
 * FocusTube — background service worker.
 *
 *   • Owns statistics writes, serialised through one queue so counters sent
 *     from several YouTube tabs never overwrite each other.
 *   • Counts focus sessions (each Normal → Focus transition, manual or scheduled).
 *   • Shows ON / OFF on the toolbar badge.
 *   • Handles the Alt+Shift+F keyboard shortcut.
 *
 * MV3 workers are short-lived, so all state lives in chrome.storage.local and
 * a one-minute alarm re-checks the schedule.
 */
importScripts('../shared/defaults.js', '../shared/schedule.js', '../shared/storage.js');

let queue = Promise.resolve();
function serial(task) {
  queue = queue.then(task).catch((err) => console.error('[FocusTube]', err));
  return queue;
}

function addStats(delta) {
  return serial(async () => {
    const stats = await ftGetStats();
    let changed = false;
    for (const key of Object.keys(FT_EMPTY_STATS)) {
      const n = Math.max(0, Math.floor(Number(delta[key]) || 0));
      if (!n) continue;
      stats.today[key] += n;
      stats.total[key] += n;
      changed = true;
    }
    if (changed) await chrome.storage.local.set({ [FT_STATS_KEY]: stats });
  });
}

function syncFocusState() {
  return serial(async () => {
    const settings = await ftGetSettings();
    const on = ftIsFocusActive(settings);
    const { ftFocusState } = await chrome.storage.local.get('ftFocusState');
    const wasOn = !!(ftFocusState && ftFocusState.on);

    if (on !== wasOn) {
      await chrome.storage.local.set({ ftFocusState: { on, since: Date.now() } });
      if (on) {
        const stats = await ftGetStats();
        stats.today.sessions += 1;
        stats.total.sessions += 1;
        await chrome.storage.local.set({ [FT_STATS_KEY]: stats });
      }
    }

    await chrome.action.setBadgeText({ text: !settings.enabled ? 'OFF' : on ? 'ON' : '' });
    await chrome.action.setBadgeBackgroundColor({ color: on ? '#7c8cff' : '#5f6368' });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: on ? '#0b0d12' : '#ffffff' });
  });
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.alarms.create('ft:tick', { periodInMinutes: 1 });
  syncFocusState();
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('ft:tick', { periodInMinutes: 1 });
  syncFocusState();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'ft:tick') syncFocusState();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (Object.keys(changes).some((k) => k in FT_DEFAULTS)) syncFocusState();
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg && msg.type === 'ft:stats') addStats(msg.delta || {});
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-focus') return;
  const settings = await ftGetSettings();
  await ftSetSettings(ftFocusTogglePatch(settings));
});
