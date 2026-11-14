/*
 * FocusTube — default settings and topic presets.
 * Loaded by the content script, popup, options page and service worker,
 * so it must stay plain (no modules, no DOM access).
 */

const FT_DEFAULT_TOPICS = [
  {
    id: 'electrical-engineering',
    name: 'Electrical Engineering',
    enabled: true,
    keywords: [
      'electrical engineering', 'power systems', 'power electronics', 'circuit analysis',
      'transformer', 'electric motor', 'generator', 'voltage', 'three phase', 'kirchhoff',
      'ohm\'s law', 'signal processing', 'control systems', 'switchgear', 'substation', 'electrical'
    ]
  },
  {
    id: 'programming',
    name: 'Programming',
    enabled: true,
    keywords: [
      'programming', 'coding', 'software engineering', 'python', 'javascript', 'typescript',
      'java', 'c++', 'c#', 'rust', 'golang', 'fastapi', 'django', 'flask', 'react', 'node.js',
      'sql', 'api', 'algorithm', 'data structure', 'web development', 'git', 'docker',
      'kubernetes', 'linux', 'devops', 'leetcode', 'system design'
    ]
  },
  {
    id: 'ai',
    name: 'AI',
    enabled: true,
    keywords: [
      'artificial intelligence', 'ai', 'machine learning', 'deep learning', 'neural network',
      'llm', 'large language model', 'pytorch', 'tensorflow', 'computer vision', 'nlp',
      'reinforcement learning', 'generative ai', 'prompt engineering', 'data science'
    ]
  },
  {
    id: 'data-centers',
    name: 'Data Centers',
    enabled: true,
    keywords: [
      'data center', 'datacenter', 'data centre', 'hyperscale', 'hyperscaler', 'colocation',
      'server rack', 'server', 'liquid cooling', 'cooling system', 'power distribution',
      'cloud infrastructure', 'uptime institute', 'tier iii', 'network infrastructure'
    ]
  },
  {
    id: 'mathematics',
    name: 'Mathematics',
    enabled: true,
    keywords: [
      'math', 'maths', 'mathematics', 'calculus', 'linear algebra', 'algebra', 'geometry',
      'trigonometry', 'probability', 'statistics', 'differential equation', 'discrete math',
      'number theory', 'theorem', 'proof'
    ]
  },
  {
    id: 'electronics',
    name: 'Electronics',
    enabled: true,
    keywords: [
      'electronics', 'circuit', 'pcb', 'arduino', 'raspberry pi', 'microcontroller', 'esp32',
      'embedded', 'soldering', 'oscilloscope', 'transistor', 'op amp', 'fpga', 'analog',
      'digital logic', 'kicad'
    ]
  },
  {
    id: 'career-development',
    name: 'Career Development',
    enabled: true,
    keywords: [
      'career', 'interview', 'resume', 'job search', 'leadership', 'communication skills',
      'soft skills', 'salary negotiation', 'personal development', 'productivity',
      'time management', 'study tips', 'linkedin'
    ]
  }
];

const FT_DEFAULTS = {
  // Master switch. When false the extension leaves YouTube untouched.
  enabled: true,

  // --- Distraction removal (Milestone 1) ---
  hideShorts: true,
  shortsRedirect: 'watch',      // 'watch' = open as a normal video, 'home' = block, 'off'
  hideHomeFeed: false,          // home page recommendations grid
  hideSuggested: true,          // watch-page sidebar "up next" suggestions
  hideExplore: true,            // Explore / Trending sections in the side menu
  hideShelves: true,            // injected shelves: "Breaking news", "People also watched"…
  hideMixes: true,              // auto-generated Mix playlists
  hideEndScreen: true,          // end-screen cards and the end-of-video video wall
  disableAutoplay: true,        // turn off the autoplay switch
  hidePromos: true,             // sponsored cards, masthead promos, merch shelves
  hideComments: false,
  hideNotifications: false,
  hideLiveChat: false,
  grayscaleThumbs: false,

  // --- Focus Mode (Milestone 2) ---
  focusMode: false,             // manual Normal / Focus switch
  focusAction: 'hide',          // 'hide' non-matching videos, or 'dim' them
  filterHome: true,             // where focus filtering applies
  filterSuggested: true,
  filterSubscriptions: false,
  filterSearch: true,           // off-topic search results are filtered too
  guardWatchPage: true,         // interstitial before off-topic / blocked videos and blocked searches
  topics: FT_DEFAULT_TOPICS,
  allowedKeywords: ['Python', 'FastAPI', 'Electrical Engineering'],
  allowedChannels: [],

  // Blocklists apply in both modes.
  blockedKeywords: ['prank', 'celebrity', 'gaming', '#shorts'],
  blockedChannels: [],

  // --- Schedule (Milestone 3) ---
  schedule: {
    enabled: false,
    start: '09:00',
    end: '18:00',
    days: [1, 2, 3, 4, 5]       // 0 = Sunday … 6 = Saturday
  },
  // When the user switches to Normal during a scheduled window, the schedule
  // is snoozed until the window ends (epoch ms).
  scheduleSnoozeUntil: 0
};

// Seconds of attention each blocked item is assumed to save. Shown to the
// user on the dashboard, so keep these conservative and easy to explain.
const FT_TIME_ESTIMATES = {
  shorts: 45,
  videos: 20,
  distractions: 5
};

const FT_EMPTY_STATS = { shorts: 0, videos: 0, distractions: 0, sessions: 0 };

if (typeof module !== 'undefined') {
  module.exports = { FT_DEFAULTS, FT_DEFAULT_TOPICS, FT_TIME_ESTIMATES, FT_EMPTY_STATS };
}
