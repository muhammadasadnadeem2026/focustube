// Unit tests for the pure logic (matching engine + schedule).
// Run with:  node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');

const { FT_DEFAULTS } = require('../src/shared/defaults.js');
const { ftScheduleWindowEnd, ftIsFocusActive, ftFocusTogglePatch, ftDescribeSchedule } = require('../src/shared/schedule.js');
const { ftBuildMatcher, ftCompileRules, ftDecide } = require('../src/content/filter.js');

const settings = (patch = {}) => ({ ...structuredClone(FT_DEFAULTS), ...patch });
const at = (iso) => new Date(iso); // local time

// ---------------------------------------------------------------- matcher --
test('keywords match on word boundaries, case-insensitively', () => {
  const re = ftBuildMatcher(['AI', 'python']);
  assert.ok(re.test('intro to ai agents'));
  assert.ok(re.test('learn python fast'));
  assert.ok(!re.test('she said hello'));          // "ai" inside a word
  assert.ok(!re.test('pythonic dreams'));         // no partial words
});

test('keywords allow plurals and flexible whitespace, and escape symbols', () => {
  const re = ftBuildMatcher(['data center', 'c++', '#shorts']);
  assert.ok(re.test('touring hyperscale data   centers'));
  assert.ok(re.test('modern c++ in 2026'));
  assert.ok(re.test('funny cat #shorts'));
  assert.ok(!re.test('c language basics'));
});

test('empty keyword list yields no matcher', () => {
  assert.equal(ftBuildMatcher([]), null);
  assert.equal(ftBuildMatcher(['  ', '']), null);
});

// --------------------------------------------------------------- decisions --
test('Normal mode: only blocklists hide', () => {
  const rules = ftCompileRules(settings(), false);
  assert.equal(ftDecide(rules, 'home', 'epic prank on my brother').verdict, 'hide');
  assert.equal(ftDecide(rules, 'home', 'cute dogs compilation').verdict, '');
});

test('Focus mode: on-topic shows, off-topic hides or dims', () => {
  const rules = ftCompileRules(settings(), true);
  assert.equal(ftDecide(rules, 'home', 'fastapi crash course').verdict, '');
  assert.equal(ftDecide(rules, 'home', 'three phase transformer explained').verdict, '');
  assert.equal(ftDecide(rules, 'home', 'cute dogs compilation').verdict, 'hide');

  const dim = ftCompileRules(settings({ focusAction: 'dim' }), true);
  assert.equal(ftDecide(dim, 'home', 'cute dogs compilation').verdict, 'dim');
});

test('Blocklist beats allowlist', () => {
  const rules = ftCompileRules(settings(), true);
  assert.equal(ftDecide(rules, 'home', 'python gaming setup tour').reason, 'blocked');
});

test('Search results are topic-filtered by default, and can be opted out', () => {
  const rules = ftCompileRules(settings(), true);
  assert.equal(ftDecide(rules, 'search', 'funny cat compilation').verdict, 'hide');
  assert.equal(ftDecide(rules, 'search', 'python decorators explained').verdict, '');
  const open = ftCompileRules(settings({ filterSearch: false }), true);
  assert.equal(ftDecide(open, 'search', 'funny cat compilation').verdict, '');
});

test('A search query matching the blocklist is blocked in both modes', () => {
  assert.equal(ftDecide(ftCompileRules(settings(), false), 'search', 'best pranks 2026').reason, 'blocked');
  assert.equal(ftDecide(ftCompileRules(settings(), true), 'search', 'celebrity gossip').reason, 'blocked');
});

test('Disabled topics do not count', () => {
  const topics = FT_DEFAULTS.topics.map((t) => ({ ...t, enabled: t.id !== 'mathematics' }));
  const rules = ftCompileRules(settings({ topics, allowedKeywords: [] }), true);
  assert.equal(ftDecide(rules, 'home', 'linear algebra lecture 4').verdict, 'hide');
});

test('Channels match by name in text or by @handle in links', () => {
  const rules = ftCompileRules(settings({ allowedChannels: ['3Blue1Brown', '@veritasium'], blockedChannels: ['@mrbeast'] }), true);
  assert.equal(ftDecide(rules, 'home', 'but what is a fourier series? 3blue1brown').verdict, '');
  assert.equal(ftDecide(rules, 'home', 'the surprising truth', ['/@veritasium']).verdict, '');
  assert.equal(ftDecide(rules, 'home', 'the surprising truth', ['/@veritasiumfan']).verdict, 'hide');
  assert.equal(ftDecide(rules, 'home', 'learn python in 1 day', ['/@mrbeast/videos']).reason, 'blocked');
});

test('Focus mode with no allow rules does not hide everything', () => {
  const rules = ftCompileRules(settings({ topics: [], allowedKeywords: [], allowedChannels: [] }), true);
  assert.equal(ftDecide(rules, 'home', 'anything at all').verdict, '');
});

// ---------------------------------------------------------------- schedule --
const weekdays = { enabled: true, start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] };

test('Weekday window is active inside hours only', () => {
  // 2026-09-28 is a Monday.
  assert.ok(ftScheduleWindowEnd(weekdays, at('2026-09-28T10:30:00')) > 0);
  assert.equal(ftScheduleWindowEnd(weekdays, at('2026-09-28T08:59:00')), 0);
  assert.equal(ftScheduleWindowEnd(weekdays, at('2026-09-28T18:00:00')), 0);
  assert.equal(ftScheduleWindowEnd(weekdays, at('2026-09-27T10:30:00')), 0); // Sunday
});

test('Overnight window belongs to the day it starts', () => {
  const night = { enabled: true, start: '22:00', end: '02:00', days: [5] }; // Friday night
  const fri = at('2026-10-02T23:00:00');
  const satEarly = at('2026-10-03T01:00:00');
  const satNight = at('2026-10-03T23:00:00');
  assert.equal(new Date(ftScheduleWindowEnd(night, fri)).getHours(), 2);
  assert.ok(ftScheduleWindowEnd(night, satEarly) > 0);
  assert.equal(ftScheduleWindowEnd(night, satNight), 0);
});

test('Focus is active by manual switch or schedule, never when disabled', () => {
  const mon = at('2026-09-28T10:00:00');
  assert.ok(ftIsFocusActive(settings({ focusMode: true }), mon));
  assert.ok(ftIsFocusActive(settings({ schedule: weekdays }), mon));
  assert.ok(!ftIsFocusActive(settings({ schedule: weekdays, enabled: false }), mon));
  assert.ok(!ftIsFocusActive(settings({ schedule: { ...weekdays, enabled: false } }), mon));
});

test('Switching to Normal during a window snoozes it until the window ends', () => {
  const mon = at('2026-09-28T10:00:00');
  const s = settings({ schedule: weekdays });
  const patch = ftFocusTogglePatch(s, mon);
  assert.equal(patch.focusMode, false);
  assert.equal(new Date(patch.scheduleSnoozeUntil).getHours(), 18);
  assert.ok(!ftIsFocusActive({ ...s, ...patch }, mon));
  // Next day the schedule applies again.
  assert.ok(ftIsFocusActive({ ...s, ...patch }, at('2026-09-29T10:00:00')));
  // And switching back on works while snoozed.
  assert.deepEqual(ftFocusTogglePatch({ ...s, ...patch }, mon), { focusMode: true });
});

test('Schedule summary', () => {
  assert.equal(ftDescribeSchedule(weekdays), 'Mon–Fri · 09:00–18:00');
  assert.equal(ftDescribeSchedule({ ...weekdays, days: [0, 6] }), 'Weekends · 09:00–18:00');
});
