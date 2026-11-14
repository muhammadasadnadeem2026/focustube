/*
 * FocusTube — topic / allowlist / blocklist matching engine.
 * Pure functions (no DOM), so tests/filter.test.js can run them in Node.
 *
 * Decision order for a video card:
 *   1. Blocked channel or blocked keyword  → hide (Normal and Focus mode)
 *   2. Focus Mode off, or not applied here → show
 *   3. Allowed channel, keyword or topic   → show
 *   4. Anything else                       → hide or dim (user's choice)
 */

function ftEscapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds one case-insensitive regex for a keyword list. Keywords match on
 * word boundaries (so "ai" does not match "said"), allow a plural "s"/"es",
 * and treat any run of whitespace in a phrase as flexible.
 */
function ftBuildMatcher(keywords) {
  const parts = [...new Set((keywords || []).map((k) => String(k).trim().toLowerCase()).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map((k) => ftEscapeRegex(k).replace(/\s+/g, '\\s+'));
  if (!parts.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join('|')})(?:e?s)?(?![\\p{L}\\p{N}])`, 'iu');
}

/** Splits channel entries into @handles (matched by URL) and display names (matched by text). */
function ftNormalizeChannels(list) {
  const handles = [];
  const names = [];
  for (const raw of list || []) {
    const v = String(raw).trim().toLowerCase();
    if (!v) continue;
    const handle = v.match(/(?:youtube\.com\/)?(@[\w.\-]+)/);
    if (handle) handles.push(handle[1]);
    else names.push(v);
  }
  return { handles, names };
}

function ftChannelMatch(channels, text, hrefs) {
  if (channels.names.some((n) => text.includes(n))) return true;
  return channels.handles.some((h) => hrefs.some((href) => href === `/${h}` || href.startsWith(`/${h}/`) || href.startsWith(`/${h}?`)));
}

/**
 * Compiles settings into a rules object once per settings change, so the
 * per-card check is just a couple of regex tests.
 */
function ftCompileRules(settings, focusActive) {
  const topicKeywords = (settings.topics || [])
    .filter((t) => t.enabled)
    .flatMap((t) => [t.name, ...(t.keywords || [])]);
  const allowRe = ftBuildMatcher([...topicKeywords, ...(settings.allowedKeywords || [])]);
  const allowCh = ftNormalizeChannels(settings.allowedChannels);
  return {
    focus: !!focusActive,
    action: settings.focusAction === 'dim' ? 'dim' : 'hide',
    contexts: {
      home: !!settings.filterHome,
      suggested: !!settings.filterSuggested,
      subscriptions: !!settings.filterSubscriptions,
      search: !!settings.filterSearch
    },
    allowRe,
    allowCh,
    hasAllowRules: !!allowRe || allowCh.handles.length > 0 || allowCh.names.length > 0,
    blockRe: ftBuildMatcher(settings.blockedKeywords),
    blockCh: ftNormalizeChannels(settings.blockedChannels)
  };
}

/**
 * @param rules   result of ftCompileRules
 * @param context 'home' | 'suggested' | 'subscriptions' | 'search' | 'watch'
 * @param text    lower-cased title + channel text of the card
 * @param hrefs   lower-cased link paths inside the card
 * @returns {{verdict: ''|'hide'|'dim', reason?: 'blocked'|'off-topic'}}
 */
function ftDecide(rules, context, text, hrefs = []) {
  if ((rules.blockRe && rules.blockRe.test(text)) || ftChannelMatch(rules.blockCh, text, hrefs)) {
    return { verdict: 'hide', reason: 'blocked' };
  }
  const applies = context === 'watch' || rules.contexts[context];
  if (!rules.focus || !applies || !rules.hasAllowRules) return { verdict: '' };
  if (ftChannelMatch(rules.allowCh, text, hrefs)) return { verdict: '' };
  if (rules.allowRe && rules.allowRe.test(text)) return { verdict: '' };
  return { verdict: context === 'watch' ? 'hide' : rules.action, reason: 'off-topic' };
}

if (typeof module !== 'undefined') {
  module.exports = { ftBuildMatcher, ftNormalizeChannels, ftChannelMatch, ftCompileRules, ftDecide };
}
