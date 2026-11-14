/*
 * FocusTube — what to hide, keyed by setting name.
 *
 * Selectors rely on YouTube's custom element names, stable attributes and
 * URL shapes (/shorts/, /feed/trending, start_radio=1), never on position.
 * When YouTube ships a redesign, this is the only file that should need edits.
 *
 * Each feature becomes a CSS rule gated by a class on <html>:
 *   html.ft-on.ft-hideShorts <selector> { display: none !important }
 */

const FT_SHORTS_LINK = 'a[href^="/shorts/"]';

const FT_FEATURES = {
  hideShorts: {
    stat: 'shorts',
    selectors: [
      // Navigation. The mini menu links to /shorts/; the full side menu entry
      // has no href, only title="Shorts" (the brand name is rarely translated;
      // content.js adds a text fallback).
      'ytd-guide-entry-renderer:has(a[href^="/shorts"])',
      'ytd-guide-entry-renderer:has(> a[title="Shorts"])',
      'ytd-mini-guide-entry-renderer:has(a[href^="/shorts"])',
      // Shelves on home, subscriptions, search, channel pages and watch sidebar.
      'ytd-reel-shelf-renderer',
      'ytd-rich-shelf-renderer[is-shorts]',
      'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])',
      `grid-shelf-view-model:has(${FT_SHORTS_LINK})`,
      `ytd-item-section-renderer:has(> #contents > grid-shelf-view-model ${FT_SHORTS_LINK}):not(:has(ytd-video-renderer))`,
      // Individual Short cards anywhere, identified by their /shorts/ link.
      'ytm-shorts-lockup-view-model',
      'ytm-shorts-lockup-view-model-v2',
      'ytd-reel-item-renderer',
      `ytd-rich-item-renderer:has(${FT_SHORTS_LINK})`,
      `ytd-video-renderer:has(${FT_SHORTS_LINK})`,
      `ytd-grid-video-renderer:has(${FT_SHORTS_LINK})`,
      `ytd-compact-video-renderer:has(${FT_SHORTS_LINK})`,
      `yt-lockup-view-model:has(${FT_SHORTS_LINK})`,
      `ytd-notification-renderer:has(${FT_SHORTS_LINK})`,
      // Channel page "Shorts" tab (English attribute; content.js adds a
      // text-independent fallback via data-ft-shorts).
      'yt-tab-shape[tab-title="Shorts"]',
      '[data-ft-shorts]'
    ]
  },

  hideHomeFeed: {
    stat: 'distractions',
    selectors: ['ytd-browse[page-subtype="home"] ytd-rich-grid-renderer']
  },

  hideSuggested: {
    stat: 'distractions',
    selectors: [
      'ytd-watch-flexy #related',
      'ytd-watch-flexy ytd-watch-next-secondary-results-renderer'
    ]
  },

  hideExplore: {
    stat: 'distractions',
    selectors: [
      'ytd-guide-section-renderer:has(a[href="/feed/trending"])',
      'ytd-guide-section-renderer:has(a[href^="/feed/explore"])',
      'ytd-guide-section-renderer:has(a[href^="/gaming"])',
      'ytd-guide-entry-renderer:has(a[href="/feed/trending"])',
      'ytd-guide-entry-renderer:has(a[href^="/feed/explore"])',
      'ytd-mini-guide-entry-renderer:has(a[href="/feed/trending"])',
      'ytd-mini-guide-entry-renderer:has(a[href^="/feed/explore"])'
    ]
  },

  hideShelves: {
    stat: 'distractions',
    selectors: [
      'ytd-browse[page-subtype="home"] ytd-rich-section-renderer',
      'ytd-browse[page-subtype="subscriptions"] ytd-rich-section-renderer',
      'ytd-search ytd-shelf-renderer',
      'ytd-search ytd-horizontal-card-list-renderer',
      'ytd-search grid-shelf-view-model'
    ]
  },

  hideMixes: {
    stat: 'distractions',
    selectors: [
      'ytd-radio-renderer',
      'ytd-compact-radio-renderer',
      'ytd-rich-item-renderer:has(a[href*="start_radio=1"])',
      'yt-lockup-view-model:has(a[href*="start_radio=1"])'
    ]
  },

  hideEndScreen: {
    stat: 'distractions',
    selectors: [
      '.html5-endscreen',
      '.ytp-endscreen-content',
      '.ytp-ce-element',
      '.ytp-fullscreen-grid',
      '.ytp-fullscreen-grid-stills-container',
      '.ytp-pause-overlay',
      '.ytp-suggested-action',
      '.ytp-cards-teaser',
      '.ytp-autonav-endscreen-countdown-overlay'
    ]
  },

  hidePromos: {
    stat: 'distractions',
    selectors: [
      '#masthead-ad',
      '#player-ads',
      'ytd-ad-slot-renderer',
      'ytd-in-feed-ad-layout-renderer',
      'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
      'ytd-search-pyv-renderer',
      'ytd-promoted-sparkles-web-renderer',
      'ytd-display-ad-renderer',
      'ytd-banner-promo-renderer',
      'ytd-statement-banner-renderer',
      'ytd-primetime-promo-renderer',
      'ytd-brand-video-singleton-renderer',
      'ytd-merch-shelf-renderer',
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]'
    ]
  },

  hideComments: {
    stat: 'distractions',
    selectors: ['ytd-watch-flexy #comments', 'ytd-watch-flexy ytd-comments']
  },

  hideNotifications: {
    stat: 'distractions',
    selectors: ['ytd-notification-topbar-button-renderer']
  },

  hideLiveChat: {
    stat: 'distractions',
    selectors: ['ytd-watch-flexy #chat-container', 'ytd-watch-flexy ytd-live-chat-frame']
  }
};

// Video cards the focus filter evaluates. yt-lockup-view-model is the
// 2025+ card used in the watch sidebar and inside rich items.
const FT_TILE_SELECTOR = [
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-grid-video-renderer',
  'ytd-playlist-renderer',
  'ytd-compact-playlist-renderer',
  'ytd-radio-renderer',
  'ytd-compact-radio-renderer',
  'yt-lockup-view-model'
].join(',');

// One rule per selector: if YouTube's engine ever rejects one selector,
// the others in the same feature keep working.
function ftBuildFeatureCss() {
  const rules = [];
  for (const [key, f] of Object.entries(FT_FEATURES)) {
    for (const s of f.selectors) rules.push(`html.ft-on.ft-${key} ${s} { display: none !important; }`);
  }
  return rules.join('\n');
}
