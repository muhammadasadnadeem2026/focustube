/*
 * FocusTube — schedule and mode logic. Pure functions, no chrome.* APIs,
 * so the same code runs in the content script, popup, worker and tests.
 */

function ftParseTime(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return ((h || 0) * 60 + (m || 0)) % 1440;
}

/**
 * Returns the end of the scheduled window that contains `now` (epoch ms),
 * or 0 when `now` is outside every window. Handles overnight windows such
 * as 22:00–02:00, where the window belongs to the day it started on.
 */
function ftScheduleWindowEnd(schedule, now = new Date()) {
  if (!schedule || !schedule.enabled || !Array.isArray(schedule.days)) return 0;
  const start = ftParseTime(schedule.start);
  const end = ftParseTime(schedule.end);
  if (start === end) return 0;

  const minutes = now.getHours() * 60 + now.getMinutes();
  const day = now.getDay();
  const endAt = (daysAhead) => {
    const d = new Date(now);
    d.setDate(d.getDate() + daysAhead);
    d.setHours(Math.floor(end / 60), end % 60, 0, 0);
    return d.getTime();
  };

  if (start < end) {
    return schedule.days.includes(day) && minutes >= start && minutes < end ? endAt(0) : 0;
  }
  // Overnight window.
  if (minutes >= start && schedule.days.includes(day)) return endAt(1);
  const yesterday = (day + 6) % 7;
  if (minutes < end && schedule.days.includes(yesterday)) return endAt(0);
  return 0;
}

function ftIsScheduleActive(settings, now = new Date()) {
  const windowEnd = ftScheduleWindowEnd(settings.schedule, now);
  return windowEnd > 0 && now.getTime() >= (settings.scheduleSnoozeUntil || 0);
}

/** Focus Mode is on when switched on manually or while a schedule window runs. */
function ftIsFocusActive(settings, now = new Date()) {
  if (!settings.enabled) return false;
  return !!settings.focusMode || ftIsScheduleActive(settings, now);
}

/**
 * Settings patch for the Normal/Focus switch. Switching to Normal during a
 * scheduled window snoozes the schedule until that window ends, so the
 * manual choice wins without disabling the schedule for other days.
 */
function ftFocusTogglePatch(settings, now = new Date()) {
  if (!ftIsFocusActive(settings, now)) return { focusMode: true };
  const patch = { focusMode: false };
  const windowEnd = ftScheduleWindowEnd(settings.schedule, now);
  if (windowEnd) patch.scheduleSnoozeUntil = windowEnd;
  return patch;
}

/** Human-readable summary, e.g. "Mon–Fri · 09:00–18:00". */
function ftDescribeSchedule(schedule) {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = [...(schedule.days || [])].sort();
  let dayText;
  if (days.length === 7) dayText = 'Every day';
  else if (days.join() === '1,2,3,4,5') dayText = 'Mon–Fri';
  else if (days.join() === '0,6') dayText = 'Weekends';
  else if (!days.length) dayText = 'No days';
  else dayText = days.map((d) => names[d]).join(', ');
  return `${dayText} · ${schedule.start}–${schedule.end}`;
}

if (typeof module !== 'undefined') {
  module.exports = { ftParseTime, ftScheduleWindowEnd, ftIsScheduleActive, ftIsFocusActive, ftFocusTogglePatch, ftDescribeSchedule };
}
