/* FocusTube — options page. Auto-saves every change to chrome.storage.local. */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let S = null;

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------
let toastTimer = 0;
function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1400);
}

async function save(patch, { rerender = true } = {}) {
  Object.assign(S, patch);
  await ftSetSettings(patch);
  if (rerender) render();
  toast('Saved');
}

const debouncers = {};
function saveLater(key, patchFn, wait = 400) {
  clearTimeout(debouncers[key]);
  debouncers[key] = setTimeout(() => save(patchFn(), { rerender: false }), wait);
}

// ---------------------------------------------------------------------------
// Small DOM helper
// ---------------------------------------------------------------------------
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((v) => {
    const k = v.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Chip-style list editor: Enter or comma adds, × removes, Backspace on empty removes last. */
function tagInput({ values, placeholder, onChange }) {
  let list = [...values];
  const input = h('input', { type: 'text', placeholder, 'aria-label': placeholder });
  const box = h('div', { class: 'tags', onclick: (e) => { if (e.target === box) input.focus(); } });

  function commit(next) {
    list = dedupe(next);
    draw();
    onChange(list);
  }
  function addFromInput() {
    const parts = input.value.split(',').map((s) => s.trim()).filter(Boolean);
    input.value = '';
    if (parts.length) commit([...list, ...parts]);
  }
  function draw() {
    box.replaceChildren(
      ...list.map((v, i) => h('span', { class: 'chip' }, v,
        h('button', { class: 'x', type: 'button', 'aria-label': `Remove ${v}`, onclick: () => commit(list.filter((_, j) => j !== i)) }, '×'))),
      input
    );
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addFromInput(); }
    else if (e.key === 'Backspace' && !input.value && list.length) commit(list.slice(0, -1));
  });
  input.addEventListener('blur', addFromInput);
  draw();
  return box;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
  // Simple bound controls
  for (const el of $$('[data-key]')) {
    const key = el.dataset.key;
    if (el.type === 'checkbox') el.checked = !!S[key];
    else el.value = S[key];
  }

  // Mode
  const focus = ftIsFocusActive(S);
  for (const btn of $$('.segmented button')) btn.setAttribute('aria-pressed', String((btn.dataset.mode === 'focus') === focus));
  const scheduled = ftIsScheduleActive(S) && !S.focusMode;
  $('#focusHint').textContent = !S.enabled
    ? 'FocusTube is disabled.'
    : scheduled ? 'On because of your schedule. Shortcut: Alt+Shift+F' : 'Shortcut: Alt+Shift+F';
  $('#modeLine').textContent = !S.enabled
    ? 'FocusTube is disabled.'
    : focus ? `Focus Mode is on${scheduled ? ' (scheduled)' : ''}.` : 'Normal Mode.';

  renderTopics();
  renderLists();
  renderSchedule();
}

function renderTopics() {
  const listEl = $('#topicList');
  if (!S.topics.length) {
    listEl.replaceChildren(h('div', { class: 'empty' }, 'No topics yet. Add one to use Focus Mode.'));
    return;
  }
  listEl.replaceChildren(...S.topics.map((topic) => {
    const update = (patch) => S.topics.map((t) => (t.id === topic.id ? { ...t, ...patch } : t));
    const card = h('div', { class: `topic${topic.enabled ? '' : ' off'}` });
    const nameInput = h('input', {
      class: 'topic-name',
      value: topic.name,
      'aria-label': 'Topic name',
      oninput: (e) => {
        topic.name = e.target.value;
        saveLater(`name-${topic.id}`, () => ({ topics: update({ name: e.target.value.trim() || 'Untitled topic' }) }));
      }
    });
    const enabled = h('input', {
      type: 'checkbox',
      checked: topic.enabled,
      'aria-label': `Enable ${topic.name}`,
      onchange: (e) => save({ topics: update({ enabled: e.target.checked }) })
    });
    const remove = h('button', {
      class: 'btn btn-ghost',
      type: 'button',
      onclick: () => {
        if (confirm(`Delete the topic "${topic.name}"?`)) save({ topics: S.topics.filter((t) => t.id !== topic.id) });
      }
    }, 'Delete');
    card.append(
      h('div', { class: 'topic-head' }, h('label', { class: 'switch' }, enabled, h('span')), nameInput, remove),
      tagInput({
        values: topic.keywords || [],
        placeholder: 'Add keyword and press Enter',
        onChange: (keywords) => save({ topics: update({ keywords }) }, { rerender: false })
      })
    );
    return card;
  }));
}

function renderLists() {
  for (const mount of $$('[data-tags]')) {
    const key = mount.dataset.tags;
    mount.replaceChildren(tagInput({
      values: S[key],
      placeholder: mount.dataset.placeholder,
      onChange: (values) => save({ [key]: values }, { rerender: false })
    }));
  }
}

function renderSchedule() {
  const sched = S.schedule;
  $('#schedEnabled').checked = sched.enabled;
  $('#schedStart').value = sched.start;
  $('#schedEnd').value = sched.end;
  $('#schedSummary').textContent = sched.enabled ? ftDescribeSchedule(sched) : `Off · ${ftDescribeSchedule(sched)}`;
  $('#schedDays').replaceChildren(...DAY_SHORT.map((label, day) => h('button', {
    type: 'button',
    'aria-pressed': String(sched.days.includes(day)),
    onclick: () => {
      const days = sched.days.includes(day) ? sched.days.filter((d) => d !== day) : [...sched.days, day].sort();
      save({ schedule: { ...sched, days } });
    }
  }, label)));
}

async function renderStats() {
  const { today, total } = await ftGetStats();
  const cards = (c) => [
    ['Shorts blocked', c.shorts],
    ['Videos filtered', c.videos],
    ['Distractions removed', c.distractions],
    ['Focus sessions', c.sessions]
  ].map(([label, value]) => h('div', { class: 'stat' }, h('strong', {}, value.toLocaleString()), h('span', {}, label)))
    .concat(h('div', { class: 'stat accent' }, h('strong', {}, ftFormatDuration(ftTimeSaved(c))), h('span', {}, 'Est. time saved')));
  $('#statsToday').replaceChildren(...cards(today));
  $('#statsTotal').replaceChildren(...cards(total));
  $('#estimateNote').textContent = `Time saved is an estimate: ${FT_TIME_ESTIMATES.shorts}s per Short, `
    + `${FT_TIME_ESTIMATES.videos}s per filtered video and ${FT_TIME_ESTIMATES.distractions}s per removed distraction.`;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function showPage() {
  const id = (location.hash || '#dashboard').slice(1);
  const page = document.getElementById(id) && $(`#${id}.page`) ? id : 'dashboard';
  for (const p of $$('.page')) p.classList.toggle('active', p.id === page);
  for (const a of $$('#nav a')) {
    if (a.getAttribute('href') === `#${page}`) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);   // hash links would otherwise jump past the page header
  if (page === 'dashboard') renderStats();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function bind() {
  for (const el of $$('[data-key]')) {
    el.addEventListener('change', () => save({ [el.dataset.key]: el.type === 'checkbox' ? el.checked : el.value }));
  }

  for (const btn of $$('.segmented button')) {
    btn.addEventListener('click', () => {
      if ((btn.dataset.mode === 'focus') !== ftIsFocusActive(S)) save(ftFocusTogglePatch(S));
    });
  }

  $('#addTopic').addEventListener('click', async () => {
    const topic = { id: `t-${Date.now().toString(36)}`, name: 'New topic', enabled: true, keywords: [] };
    await save({ topics: [...S.topics, topic] });
    const inputs = $$('.topic-name');
    const last = inputs[inputs.length - 1];
    last.focus();
    last.select();
  });

  $('#schedEnabled').addEventListener('change', (e) => save({ schedule: { ...S.schedule, enabled: e.target.checked }, scheduleSnoozeUntil: 0 }));
  $('#schedStart').addEventListener('change', (e) => e.target.value && save({ schedule: { ...S.schedule, start: e.target.value } }));
  $('#schedEnd').addEventListener('change', (e) => e.target.value && save({ schedule: { ...S.schedule, end: e.target.value } }));

  $('#exportBtn').addEventListener('click', () => {
    const data = {};
    for (const key of Object.keys(FT_DEFAULTS)) data[key] = S[key];
    const blob = new Blob([JSON.stringify({ app: 'FocusTube', version: 1, settings: data }, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `focustube-settings-${ftTodayKey()}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = parsed.settings || parsed;
      const patch = {};
      for (const key of Object.keys(FT_DEFAULTS)) {
        if (key in incoming && typeof incoming[key] === typeof FT_DEFAULTS[key]) patch[key] = incoming[key];
      }
      if (!Object.keys(patch).length) throw new Error('No FocusTube settings found in this file.');
      await save(patch);
      S = await ftGetSettings();
      render();
      toast('Settings imported');
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  });

  $('#resetStats').addEventListener('click', async () => {
    if (!confirm('Reset all statistics?')) return;
    await chrome.storage.local.remove(FT_STATS_KEY);
    renderStats();
    toast('Statistics reset');
  });

  $('#resetSettings').addEventListener('click', async () => {
    if (!confirm('Reset all settings to their defaults? Topics and lists will be replaced.')) return;
    await ftResetSettings();
    S = await ftGetSettings();
    render();
    toast('Settings reset');
  });

  window.addEventListener('hashchange', showPage);
}

// Changes made elsewhere (popup, keyboard shortcut) show up here live.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (FT_STATS_KEY in changes && $('#dashboard').classList.contains('active')) renderStats();
  let external = false;
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (!(key in FT_DEFAULTS)) continue;
    const value = newValue === undefined ? FT_DEFAULTS[key] : newValue;
    if (JSON.stringify(value) !== JSON.stringify(S[key])) { S[key] = value; external = true; }
  }
  if (external) {
    S = ftMergeSettings(S);
    render();
  }
});

(async function init() {
  S = await ftGetSettings();
  bind();
  render();
  showPage();
})();
