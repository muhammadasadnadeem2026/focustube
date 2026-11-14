/*
 * FocusTube — content script (runs on www.youtube.com at document_start).
 *
 * Responsibilities:
 *   1. Toggle feature classes on <html>; the generated stylesheet does the hiding.
 *   2. Follow YouTube's SPA navigation (yt-navigate-finish + MutationObserver)
 *      to redirect Shorts URLs and re-scan dynamically loaded cards.
 *   3. Run the focus / blocklist filter on video cards.
 *   4. Show a "focus guard" before off-topic or blocked videos.
 *   5. Keep autoplay off, report counters to the service worker.
 */
(() => {
  'use strict';

  const root = document.documentElement;
  let S = ftMergeSettings({});
  let rules = ftCompileRules(S, false);
  let ready = false;
  let active = false;
  let focusOn = false;
  let generation = 0;         // bumps on every settings change → cards re-evaluated

  // ---------------------------------------------------------------------------
  // Stylesheet generated from selectors.js
  // ---------------------------------------------------------------------------
  const style = document.createElement('style');
  style.id = 'focustube-rules';
  style.textContent = ftBuildFeatureCss();
  (document.head || root).appendChild(style);

  function applyState() {
    active = !!S.enabled;
    focusOn = ftIsFocusActive(S);
    root.classList.toggle('ft-on', active);
    root.classList.toggle('ft-focus', active && focusOn);
    root.classList.toggle('ft-grayscale', active && !!S.grayscaleThumbs);
    for (const key of Object.keys(FT_FEATURES)) root.classList.toggle(`ft-${key}`, active && !!S[key]);
    rules = ftCompileRules(S, focusOn);
    generation++;
  }

  // ---------------------------------------------------------------------------
  // Statistics — batched and sent to the service worker, which owns storage.
  // ---------------------------------------------------------------------------
  const pending = { shorts: 0, videos: 0, distractions: 0 };
  let flushTimer = 0;

  function bump(kind, n = 1) {
    pending[kind] += n;
    if (!flushTimer) flushTimer = setTimeout(flushStats, 4000);
  }

  function flushStats() {
    clearTimeout(flushTimer);
    flushTimer = 0;
    if (!pending.shorts && !pending.videos && !pending.distractions) return;
    const delta = { ...pending };
    pending.shorts = pending.videos = pending.distractions = 0;
    try {
      chrome.runtime.sendMessage({ type: 'ft:stats', delta }).catch(() => {});
    } catch (_) {
      // Extension was reloaded; this page's script is orphaned.
    }
  }

  // A "distraction removed" is one feature acting on one page view (e.g. the
  // suggestions column on a video). Counting DOM nodes would inflate the
  // number: the player keeps end-screen elements around at all times.
  const countedFeatures = new Set();
  const countedShorts = new Set();
  let lastCount = 0;

  function countHidden() {
    if (Date.now() - lastCount < 2000) return;
    lastCount = Date.now();
    for (const [key, feature] of Object.entries(FT_FEATURES)) {
      if (!S[key] || feature.stat !== 'distractions') continue;
      const id = `${location.pathname}${location.search}|${key}`;
      if (countedFeatures.has(id)) continue;
      const present = feature.selectors.some((sel) => {
        try { return !!document.querySelector(sel); } catch (_) { return false; }
      });
      if (present) { countedFeatures.add(id); bump('distractions'); }
    }
    // Shorts are counted by unique video id, not by DOM node.
    if (S.hideShorts) {
      for (const a of document.querySelectorAll(FT_SHORTS_LINK)) {
        const id = (a.getAttribute('href').match(/^\/shorts\/([\w-]+)/) || [])[1];
        if (id && !countedShorts.has(id)) { countedShorts.add(id); bump('shorts'); }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Routing (YouTube is a single-page app)
  // ---------------------------------------------------------------------------
  const INTENTIONAL_PAGES = new Set(['search', 'channel', 'playlist', 'subscriptions', 'library']);
  let lastUrl = '';
  let currentPage = '';
  const intentionalVideos = new Map();  // video id → page it was opened from
  const allowedVideos = new Set();      // "Watch anyway"

  function pageType() {
    const p = location.pathname;
    if (p === '/') return 'home';
    if (p === '/watch') return 'watch';
    if (p === '/results') return 'search';
    if (p.startsWith('/shorts')) return 'shorts';
    if (p === '/feed/subscriptions') return 'subscriptions';
    if (p.startsWith('/playlist')) return 'playlist';
    if (/^\/(@|channel\/|c\/|user\/)/.test(p)) return 'channel';
    if (p.startsWith('/feed/')) return 'library';
    return 'other';
  }

  function trackRoute() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    const previous = currentPage;
    currentPage = pageType();
    root.dataset.ftPage = currentPage;

    if (currentPage === 'watch') {
      const params = new URLSearchParams(location.search);
      const id = params.get('v');
      const fromPlaylist = params.has('list') && !params.has('start_radio');
      if (id && (INTENTIONAL_PAGES.has(previous) || fromPlaylist)) intentionalVideos.set(id, fromPlaylist ? 'playlist' : previous);
    }
    enforceRoute();
  }

  /** Redirects for pages that are distractions by themselves. */
  function enforceRoute() {
    if (!ready || !active) return;
    const path = location.pathname;

    if (S.hideShorts && S.shortsRedirect !== 'off' && path.startsWith('/shorts/')) {
      const id = (path.match(/^\/shorts\/([\w-]+)/) || [])[1];
      bump('shorts');
      flushStats();
      location.replace(S.shortsRedirect === 'watch' && id ? `/watch?v=${id}` : '/');
      return;
    }
    if (S.hideShorts && currentPage === 'channel' && /\/shorts\/?$/.test(path)) {
      location.replace(path.replace(/\/shorts\/?$/, '/videos'));
      return;
    }
    if (S.hideExplore && /^\/feed\/(trending|explore)/.test(path)) {
      bump('distractions');
      location.replace('/');
    }
  }

  // ---------------------------------------------------------------------------
  // Card filtering
  // ---------------------------------------------------------------------------
  function contextOf(tile) {
    if (tile.closest('ytd-playlist-panel-renderer, ytd-miniplayer, ytd-engagement-panel-section-list-renderer')) return null;
    if (tile.closest('ytd-watch-flexy')) {
      return tile.closest('#related, ytd-watch-next-secondary-results-renderer') ? 'suggested' : null;
    }
    if (tile.closest('ytd-search')) return 'search';
    const subtype = tile.closest('ytd-browse')?.getAttribute('page-subtype');
    if (subtype === 'home') return 'home';
    if (subtype === 'subscriptions') return 'subscriptions';
    return null;   // channel pages, playlists, library: the user chose these
  }

  /**
   * Title + channel only. The full card text also holds descriptions and
   * YouTube UI copy ("AI-generated video summary", "AI can make mistakes"),
   * which would make every card match topics like "AI".
   */
  function cardText(tile) {
    const parts = [];
    const title = tile.querySelector('#video-title, #video-title-link, h3');
    if (title) parts.push(title.getAttribute('title') || title.textContent);
    const channel = tile.querySelector('ytd-channel-name, #channel-name, yt-content-metadata-view-model');
    if (channel) parts.push(channel.textContent);
    return (parts.length ? parts.join(' ') : tile.textContent).replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function clearVerdict(tile) {
    if (tile.hasAttribute('data-ft')) tile.removeAttribute('data-ft');
  }

  function scanTiles() {
    for (const tile of document.querySelectorAll(FT_TILE_SELECTOR)) {
      // A lockup nested inside another card is handled through its parent.
      if (tile.localName === 'yt-lockup-view-model'
        && tile.parentElement?.closest('ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-video-renderer')) continue;

      const ctx = contextOf(tile);
      if (!ctx) { clearVerdict(tile); continue; }
      // Shorts and ads are already removed by CSS; don't double count them.
      if ((S.hideShorts && tile.querySelector(FT_SHORTS_LINK)) || tile.querySelector('ytd-ad-slot-renderer')) continue;

      const text = cardText(tile);
      if (!text) continue;   // still a loading skeleton
      // YouTube recycles card elements for new videos, so key on content.
      if (tile.__ftText === text && tile.__ftGen === generation) continue;
      const isNewContent = tile.__ftText !== text;
      tile.__ftText = text;
      tile.__ftGen = generation;

      const hrefs = [...tile.querySelectorAll('a[href]')].map((a) => a.getAttribute('href').toLowerCase());
      const { verdict } = ftDecide(rules, ctx, text, hrefs);
      if (verdict) {
        if (tile.getAttribute('data-ft') !== verdict) tile.setAttribute('data-ft', verdict);
        if (isNewContent) bump('videos');
      } else {
        clearVerdict(tile);
      }
    }
  }

  /** Text fallback for Shorts chips, tabs and menu entries that carry no /shorts/ link. */
  function markShortsByText() {
    for (const el of document.querySelectorAll('yt-chip-cloud-chip-renderer, yt-tab-shape, ytd-guide-entry-renderer')) {
      const isShorts = el.textContent.trim().toLowerCase() === 'shorts';
      if (isShorts !== el.hasAttribute('data-ft-shorts')) el.toggleAttribute('data-ft-shorts', isShorts);
    }
  }

  // ---------------------------------------------------------------------------
  // Autoplay
  // ---------------------------------------------------------------------------
  let lastAutoplayClick = 0;
  function enforceAutoplayOff() {
    if (!active || !S.disableAutoplay || currentPage !== 'watch') return;
    const toggle = document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]');
    if (toggle && Date.now() - lastAutoplayClick > 3000) {
      lastAutoplayClick = Date.now();
      (toggle.closest('button') || toggle).click();
      bump('distractions');
    }
  }

  // ---------------------------------------------------------------------------
  // Infinite scroll
  //
  // YouTube requests the next batch when its continuation spinner scrolls into
  // view (IntersectionObserver). When filtering hides a whole batch, the
  // spinner never leaves the viewport, so the observer never fires again and
  // the feed stalls after a few videos. Briefly un-rendering the spinner makes
  // it "enter" the viewport again and YouTube loads the next batch.
  // ---------------------------------------------------------------------------
  const CONTINUATION_SELECTOR = 'ytd-continuation-item-renderer';
  const STALL_MS = 1200;              // spinner visible this long = stalled
  const MAX_EMPTY_NUDGES = 40;        // batches in a row with nothing to show
  const continuationSeen = new WeakMap();
  let feedKey = '';
  let emptyNudges = 0;
  let lastVisibleCards = 0;

  function visibleCardCount() {
    let n = 0;
    for (const tile of document.querySelectorAll(FT_TILE_SELECTOR)) {
      if (tile.getAttribute('data-ft') !== 'hide' && tile.getClientRects().length) n++;
    }
    return n;
  }

  function keepFeedLoading() {
    if (!active) return;
    if (feedKey !== location.href) {
      feedKey = location.href;
      emptyNudges = 0;
      lastVisibleCards = 0;
    }
    const now = Date.now();
    for (const spinner of document.querySelectorAll(CONTINUATION_SELECTOR)) {
      const rect = spinner.getBoundingClientRect();
      const inView = spinner.getClientRects().length > 0 && rect.top < innerHeight + 200 && rect.bottom > -200;
      if (!inView) { continuationSeen.delete(spinner); continue; }
      if (!continuationSeen.has(spinner)) { continuationSeen.set(spinner, now); continue; }
      if (now - continuationSeen.get(spinner) < STALL_MS) continue;

      // Stop if batch after batch contains nothing on-topic, so an empty
      // topic list can't make YouTube page through the entire feed.
      const cards = visibleCardCount();
      if (cards > lastVisibleCards) { lastVisibleCards = cards; emptyNudges = 0; }
      else if (++emptyNudges > MAX_EMPTY_NUDGES) return;

      continuationSeen.set(spinner, now);
      nudgeLoader(spinner);
    }
  }

  // YouTube has used both an IntersectionObserver on the spinner and
  // scroll/resize listeners over time, so send every signal it may watch.
  function nudgeLoader(spinner) {
    spinner.style.setProperty('display', 'none', 'important');
    setTimeout(() => {
      spinner.style.removeProperty('display');
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
      if (document.documentElement.scrollHeight > innerHeight) {
        const y = scrollY;
        scrollTo(0, y + 1);
        requestAnimationFrame(() => scrollTo(0, y));
      }
    }, 120);
  }

  // ---------------------------------------------------------------------------
  // DOM helper (no innerHTML: YouTube enforces Trusted Types)
  // ---------------------------------------------------------------------------
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null) el.append(c);
    return el;
  }

  // ---------------------------------------------------------------------------
  // Home page focus panel (replaces the recommendation grid)
  // ---------------------------------------------------------------------------
  function ensureHomePanel() {
    const primary = document.querySelector('ytd-browse[page-subtype="home"] #primary');
    if (!primary || primary.querySelector(':scope > .ft-home-panel')) return;

    const input = h('input', { type: 'search', class: 'ft-home-input', placeholder: 'What do you want to learn today?', 'aria-label': 'Search YouTube' });
    const form = h('form', {
      class: 'ft-home-search',
      onsubmit: (e) => {
        e.preventDefault();
        const q = input.value.trim();
        if (q) location.href = `/results?search_query=${encodeURIComponent(q)}`;
      }
    }, input, h('button', { type: 'submit', class: 'ft-btn ft-btn-primary' }, 'Search'));

    const topics = (S.topics || []).filter((t) => t.enabled);
    const chips = topics.map((t) => h('a', { class: 'ft-chip', href: `/results?search_query=${encodeURIComponent(t.name)}` }, t.name));

    const links = [
      ['Subscriptions', '/feed/subscriptions'],
      ['Watch later', '/playlist?list=WL'],
      ['Playlists', '/feed/playlists'],
      ['History', '/feed/history']
    ].map(([label, href]) => h('a', { class: 'ft-link', href }, label));

    primary.prepend(h('section', { class: 'ft-home-panel' },
      h('div', { class: 'ft-home-eyebrow' }, focusOn ? 'FocusTube · Focus Mode' : 'FocusTube'),
      h('h1', { class: 'ft-home-title' }, 'Recommendations are off.'),
      h('p', { class: 'ft-home-sub' }, 'Search for what you came here for, or jump into one of your topics.'),
      form,
      chips.length ? h('div', { class: 'ft-home-chips' }, chips) : null,
      h('nav', { class: 'ft-home-links' }, links)
    ));
  }

  function removeHomePanels() {
    document.querySelectorAll('.ft-home-panel').forEach((el) => el.remove());
  }

  // ---------------------------------------------------------------------------
  // Focus guard (watch page interstitial)
  // ---------------------------------------------------------------------------
  let guardEl = null;
  let guardKey = '';

  function currentVideoInfo() {
    const id = new URLSearchParams(location.search).get('v');
    const meta = document.querySelector('ytd-watch-metadata');
    const title = meta?.querySelector('h1')?.textContent.replace(/\s+/g, ' ').trim() || '';
    // The link text holds the name once; ytd-channel-name's own text repeats it in a tooltip.
    const channelLink = meta?.querySelector('#owner ytd-channel-name a');
    const handleLink = meta?.querySelector('#owner a[href^="/@"], #owner a[href^="/channel/"]');
    return {
      id,
      title,
      channel: channelLink?.textContent.replace(/\s+/g, ' ').trim() || '',
      handle: (channelLink || handleLink)?.getAttribute('href') || ''
    };
  }

  function updateGuard() {
    if (!active || !S.guardWatchPage) { hideGuard(); return; }
    if (!document.body) return;   // document_start: the URL is known before <body> exists
    if (currentPage === 'search') { updateSearchGuard(); return; }
    if (currentPage !== 'watch') { hideGuard(); return; }
    const info = currentVideoInfo();
    if (!info.id || allowedVideos.has(info.id)) { hideGuard(); return; }
    const flexyId = document.querySelector('ytd-watch-flexy')?.getAttribute('video-id');
    if (!info.title || (flexyId && flexyId !== info.id)) return;   // metadata still loading

    const key = `${info.id}|${info.title}|${info.channel}|${generation}`;
    if (key === guardKey) return;
    guardKey = key;

    const text = `${info.title} ${info.channel}`.toLowerCase();
    const { verdict, reason } = ftDecide(rules, 'watch', text, info.handle ? [info.handle.toLowerCase()] : []);
    // A video picked from a channel or playlist is a deliberate choice. One
    // picked from search is too, unless search results are focus-filtered.
    const source = intentionalVideos.get(info.id);
    const deliberate = source && !(source === 'search' && S.filterSearch);
    const skip = !verdict || (reason === 'off-topic' && deliberate);
    if (skip) hideGuard();
    else showGuard(reason, info);
  }

  /** Searching for a blocked keyword (e.g. "prank") is guarded like a blocked video. */
  function updateSearchGuard() {
    const query = (new URLSearchParams(location.search).get('search_query') || '').trim();
    const id = `search:${query.toLowerCase()}`;
    if (!query || allowedVideos.has(id)) { hideGuard(); return; }
    const key = `${id}|${generation}`;
    if (key === guardKey) return;
    guardKey = key;
    const { reason } = ftDecide(rules, 'search', query.toLowerCase());
    if (reason === 'blocked') showGuard('blocked', { id, title: `“${query}”`, channel: '' }, 'search');
    else hideGuard();
  }

  function showGuard(reason, info, kind = 'video') {
    hideGuard();
    const blocked = reason === 'blocked';
    const isSearch = kind === 'search';
    guardEl = h('div', { class: 'ft-guard', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ft-guard-title' },
      h('div', { class: 'ft-guard-card' },
        h('div', { class: 'ft-home-eyebrow' }, blocked ? 'FocusTube · Blocklist' : 'FocusTube · Focus Mode'),
        h('h2', { id: 'ft-guard-title', class: 'ft-guard-title' },
          isSearch ? 'This search matches your blocklist'
            : blocked ? 'This video matches your blocklist' : 'This video is outside your focus topics'),
        h('p', { class: 'ft-guard-video' }, info.title, info.channel ? h('span', {}, ` · ${info.channel}`) : null),
        h('div', { class: 'ft-guard-actions' },
          h('button', { class: 'ft-btn ft-btn-primary', onclick: goBack }, 'Go back'),
          h('button', {
            class: 'ft-btn',
            onclick: () => {
              allowedVideos.add(info.id);
              hideGuard();
              if (!isSearch) document.querySelector('video')?.play().catch(() => {});
            }
          }, isSearch ? 'Search anyway' : 'Watch anyway')
        ),
        h('p', { class: 'ft-guard-hint' },
          blocked ? 'Edit your blocklist in FocusTube settings.' : 'Add a topic, keyword or allowed channel in FocusTube to let videos like this through.')
      )
    );
    document.body.append(guardEl);
    if (!isSearch) pauseVideo();
    guardEl.querySelector('.ft-btn-primary').focus();
  }

  function hideGuard() {
    if (guardEl) { guardEl.remove(); guardEl = null; }
  }

  function goBack() {
    hideGuard();
    if (history.length > 1) history.back();
    else location.href = '/';
  }

  function pauseVideo() {
    document.querySelectorAll('video').forEach((v) => { if (!v.paused) v.pause(); });
  }

  // Autoplay can start after the guard appears; stop it while the guard is up.
  document.addEventListener('play', () => { if (guardEl) pauseVideo(); }, true);

  // ---------------------------------------------------------------------------
  // Scan loop
  // ---------------------------------------------------------------------------
  function scan() {
    if (!ready) return;
    if (!style.isConnected) (document.head || root).appendChild(style);
    if (root.classList.contains('ft-on') !== active) applyState();   // YouTube reset <html> classes
    trackRoute();
    if (!active) { hideGuard(); return; }
    if (S.hideShorts) markShortsByText();
    scanTiles();
    if (S.hideHomeFeed) ensureHomePanel();
    updateGuard();
    enforceAutoplayOff();
    keepFeedLoading();
    countHidden();
  }

  let scanTimer = 0;
  let lastScan = 0;
  function scheduleScan() {
    if (scanTimer) return;
    const wait = Math.max(0, 300 - (performance.now() - lastScan));
    scanTimer = setTimeout(() => {
      scanTimer = 0;
      lastScan = performance.now();
      scan();
    }, wait);
  }

  // The player mutates constantly during playback; ignore those mutations.
  function onMutations(records) {
    if (scanTimer) return;
    for (const r of records) {
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (!el || !el.closest('#movie_player')) { scheduleScan(); return; }
    }
  }

  function onSettingsChanged() {
    applyState();
    removeHomePanels();
    guardKey = '';
    enforceRoute();
    scheduleScan();
  }

  function start() {
    new MutationObserver(onMutations).observe(root, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', scheduleScan);
    window.addEventListener('popstate', scheduleScan);

    // Schedule boundaries (e.g. 09:00) and player-internal state that the
    // observer deliberately ignores.
    setInterval(() => {
      if (ftIsFocusActive(S) !== focusOn) onSettingsChanged();
    }, 30000);
    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      enforceAutoplayOff();
      updateGuard();
      keepFeedLoading();
    }, 2000);

    window.addEventListener('pagehide', flushStats);
    scan();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let relevant = false;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (!(key in FT_DEFAULTS)) continue;
      S[key] = newValue === undefined ? FT_DEFAULTS[key] : newValue;
      relevant = true;
    }
    if (!relevant) return;
    S = ftMergeSettings(S);
    onSettingsChanged();
  });

  // Popup asks what's on screen for the "Block this" button.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'ft:pageInfo') return;
    const page = pageType();
    const info = { page, channel: '', handle: '', title: '' };
    if (page === 'watch') {
      Object.assign(info, currentVideoInfo());
    } else if (page === 'channel') {
      info.handle = (location.pathname.match(/^\/(@[^/]+)/) || [])[1] || '';
      info.channel = document.querySelector('yt-page-header-view-model h1, ytd-c4-tabbed-header-renderer #channel-name #text')
        ?.textContent.replace(/\s+/g, ' ').trim() || info.handle;
    }
    // Only @handles are stable identifiers worth storing; drop /channel/UC… paths.
    const handle = (info.handle.match(/^\/?(@[^/?]+)/) || [])[1] || '';
    info.handle = decodeURIComponent(handle);
    sendResponse(info);
  });

  ftGetSettings().then((settings) => {
    S = settings;
    ready = true;
    applyState();
    start();
  });
})();
