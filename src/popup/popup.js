/* FocusTube — popup. Every control writes straight to chrome.storage.local;
   open YouTube tabs pick the change up through storage.onChanged. */

const $ = (sel) => document.querySelector(sel);
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

let S = null;
let pageInfo = null;

async function save(patch) {
  Object.assign(S, patch);
  render();
  await ftSetSettings(patch);
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render() {
  const focus = ftIsFocusActive(S);
  const scheduled = ftIsScheduleActive(S);
  document.body.classList.toggle('disabled', !S.enabled);

  for (const input of document.querySelectorAll('input[data-key]')) input.checked = !!S[input.dataset.key];
  $('#hideRecs').checked = S.hideHomeFeed && S.hideSuggested;

  for (const btn of document.querySelectorAll('.segmented button')) {
    btn.setAttribute('aria-pressed', String((btn.dataset.mode === 'focus') === focus));
  }

  const status = $('#status');
  const enabledTopics = S.topics.filter((t) => t.enabled).length;
  status.replaceChildren();
  if (!S.enabled) {
    status.textContent = 'FocusTube is off. YouTube is unfiltered.';
  } else if (focus) {
    const end = ftScheduleWindowEnd(S.schedule);
    const lead = document.createElement('b');
    lead.textContent = scheduled && !S.focusMode ? `Scheduled focus until ${fmtTime(end)}` : 'Focus Mode is on';
    status.append(lead, ` · showing ${enabledTopics} topic${enabledTopics === 1 ? '' : 's'} only`);
    if (!enabledTopics && !S.allowedKeywords.length && !S.allowedChannels.length) {
      status.textContent = 'Focus Mode is on, but no topics are allowed yet.';
    }
  } else if (S.schedule.enabled && S.scheduleSnoozeUntil > Date.now()) {
    status.textContent = `Schedule snoozed until ${fmtTime(S.scheduleSnoozeUntil)}.`;
  } else {
    status.textContent = 'Normal Mode · distractions hidden, all topics visible.';
  }

  // Topics
  const topics = $('#topics');
  topics.replaceChildren(...S.topics.map((t, i) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = t.name;
    chip.setAttribute('aria-pressed', String(!!t.enabled));
    chip.addEventListener('click', () => {
      const next = S.topics.map((x, j) => (j === i ? { ...x, enabled: !x.enabled } : x));
      save({ topics: next });
    });
    return chip;
  }));
  if (!S.topics.length) topics.textContent = 'No topics yet.';

  // Schedule
  $('#schedEnabled').checked = S.schedule.enabled;
  $('#schedSummary').textContent = S.schedule.enabled ? ftDescribeSchedule(S.schedule) : 'Off';
  $('#schedSummary').closest('.card').classList.toggle('sched-off', !S.schedule.enabled);
  $('#schedStart').value = S.schedule.start;
  $('#schedEnd').value = S.schedule.end;
  $('#schedDays').replaceChildren(...DAY_LETTERS.map((letter, day) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = letter;
    b.title = DAY_NAMES[day];
    b.setAttribute('aria-label', DAY_NAMES[day]);
    b.setAttribute('aria-pressed', String(S.schedule.days.includes(day)));
    b.addEventListener('click', () => {
      const days = S.schedule.days.includes(day)
        ? S.schedule.days.filter((d) => d !== day)
        : [...S.schedule.days, day].sort();
      save({ schedule: { ...S.schedule, days } });
    });
    return b;
  }));

  // Blocklist summary
  const k = S.blockedKeywords.length;
  const c = S.blockedChannels.length;
  $('#blockSummary').textContent = `${k} keyword${k === 1 ? '' : 's'} · ${c} channel${c === 1 ? '' : 's'} blocked`;

  renderBlockThis();
}

function renderBlockThis() {
  const btn = $('#blockThis');
  const label = $('#blockLabel');
  const name = pageInfo && (pageInfo.channel || pageInfo.handle);
  if (!name) {
    label.textContent = 'Block this channel';
    label.title = '';
    const hint = document.createElement('small');
    hint.textContent = ' · open a video or channel';
    label.append(hint);
    btn.disabled = true;
    return;
  }
  const already = [pageInfo.channel, pageInfo.handle].some((v) => v && S.blockedChannels.some((b) => b.toLowerCase() === v.toLowerCase()));
  label.textContent = `Block ${name}`;
  label.title = name;
  btn.disabled = already;
  btn.textContent = already ? 'Blocked' : 'Block';
  btn.classList.toggle('done', already);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function bind() {
  for (const input of document.querySelectorAll('input[data-key]')) {
    input.addEventListener('change', () => save({ [input.dataset.key]: input.checked }));
  }
  $('#hideRecs').addEventListener('change', (e) => save({ hideHomeFeed: e.target.checked, hideSuggested: e.target.checked }));

  for (const btn of document.querySelectorAll('.segmented button')) {
    btn.addEventListener('click', () => {
      const wantFocus = btn.dataset.mode === 'focus';
      if (wantFocus !== ftIsFocusActive(S)) save(ftFocusTogglePatch(S));
    });
  }

  $('#schedToggle').addEventListener('click', (e) => {
    const body = $('#schedBody');
    body.hidden = !body.hidden;
    e.target.setAttribute('aria-expanded', String(!body.hidden));
    e.target.textContent = body.hidden ? 'Edit' : 'Done';
  });
  $('#schedEnabled').addEventListener('change', (e) => save({ schedule: { ...S.schedule, enabled: e.target.checked }, scheduleSnoozeUntil: 0 }));
  $('#schedStart').addEventListener('change', (e) => e.target.value && save({ schedule: { ...S.schedule, start: e.target.value } }));
  $('#schedEnd').addEventListener('change', (e) => e.target.value && save({ schedule: { ...S.schedule, end: e.target.value } }));

  $('#blockForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#blockInput');
    const words = input.value.split(',').map((w) => w.trim()).filter(Boolean);
    const fresh = words.filter((w) => !S.blockedKeywords.some((b) => b.toLowerCase() === w.toLowerCase()));
    if (fresh.length) save({ blockedKeywords: [...S.blockedKeywords, ...fresh] });
    input.value = '';
  });

  $('#blockThis').addEventListener('click', () => {
    if (!pageInfo) return;
    // Prefer the channel name: it appears in every card's text, whereas
    // @handles only match cards that link to the channel.
    const entry = pageInfo.channel || pageInfo.handle;
    save({ blockedChannels: [...S.blockedChannels, entry] });
  });

  // Open settings pages in a tab (links in a popup can't navigate it).
  for (const a of document.querySelectorAll('a[href*="options.html"]')) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const hash = a.getAttribute('href').split('#')[1];
      chrome.tabs.create({ url: chrome.runtime.getURL(`src/options/options.html${hash ? `#${hash}` : ''}`) });
      window.close();
    });
  }
}

async function loadStats() {
  const { today } = await ftGetStats();
  $('#stShorts').textContent = today.shorts.toLocaleString();
  $('#stVideos').textContent = today.videos.toLocaleString();
  $('#stSaved').textContent = ftFormatDuration(ftTimeSaved(today));
}

async function loadPageInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    // Only YouTube tabs run the content script; elsewhere this rejects.
    pageInfo = await chrome.tabs.sendMessage(tab.id, { type: 'ft:pageInfo' });
  } catch (_) {
    pageInfo = null;
  }
  renderBlockThis();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('ftStats' in changes) loadStats();
});

(async function init() {
  S = await ftGetSettings();
  bind();
  render();
  loadStats();
  loadPageInfo();
})();
