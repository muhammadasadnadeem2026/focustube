# FocusTube

A Chrome extension (Manifest V3) that turns YouTube into a distraction-free, productivity-focused tool. It removes Shorts and recommendation feeds, and in **Focus Mode** it only shows videos that match topics you choose.

No account, no servers, no tracking. Everything is stored locally in your browser.

---

## Features

| Area | What it does |
|---|---|
| **Shorts removal** | Hides Shorts shelves, cards, the side-menu entry, the channel "Shorts" tab and search chips. Opening a `/shorts/ID` link plays it as a normal video (or blocks it, your choice). |
| **Distraction-free UI** | Toggles for Home recommendations, suggested videos, Explore/Trending, injected shelves, Mixes, autoplay, end screens, sponsored blocks, comments, notifications and live chat. Thumbnails can be made grayscale. |
| **Normal / Focus Mode** | Normal mode hides distractions only. Focus mode also hides (or dims) any video that doesn't match your topics, allowed keywords or allowed channels. |
| **Topics** | Editable list (defaults: Electrical Engineering, Programming, AI, Data Centers, Mathematics, Electronics, Career Development). Each topic has a name and keywords. You can add, rename, disable or delete topics. |
| **Allow / block lists** | Allowed channels and keywords, blocked channels and keywords. Blocklists apply in both modes and always override allowlists. |
| **Focus guard** | An off-topic (Focus Mode) or blocked video is paused behind a "Go back / Watch anyway" prompt, and a search for a blocked keyword (e.g. "prank") is stopped with "Go back / Search anyway". Videos you open from a channel or playlist play normally. |
| **Search filtering** | In Focus Mode, search results are filtered too, so searching for distracting content doesn't get around it. Can be turned off per area in Settings → Focus Mode. |
| **Unlimited scroll** | When filtering hides a whole batch of videos, FocusTube keeps YouTube's infinite scroll loading instead of letting the feed stop after a few cards. |
| **Schedule** | Turns Focus Mode on automatically, e.g. Mon–Fri 09:00–18:00. Windows that cross midnight are supported. Switching to Normal during a window snoozes the schedule until that window ends. |
| **Popup** | Mode switch, Hide Shorts, Hide recommendations, "Block this channel", quick blocked-keyword entry, topic chips, schedule and today's stats. |
| **Dashboard** | Shorts blocked, videos filtered, distractions removed, focus sessions and estimated time saved, for today and all time. |
| **Shortcut** | `Alt+Shift+F` switches Normal / Focus (change it at `chrome://extensions/shortcuts`). |

---

## Install (load unpacked)

1. Open Chrome and go to **`chrome://extensions`**.
2. Turn on **Developer mode** (top-right switch).
3. Click **Load unpacked**.
4. Select the **`FocusTube`** folder (the one that contains `manifest.json`).
5. The settings page opens on first install. Pin FocusTube from the puzzle-piece menu so the popup is one click away.
6. Open or reload any YouTube tab.

**After editing the code:** click the ↻ reload icon on the FocusTube card in `chrome://extensions`, then reload your YouTube tabs. Tabs that were already open keep running the old content script until they are reloaded.

Requires Chrome 116 or newer (uses the CSS `:has()` selector and MV3 service workers).

---

## Project structure

```
FocusTube/
├── manifest.json                  MV3 manifest: permissions, content scripts, popup, options, shortcut
├── icons/                         16 / 32 / 48 / 128 px toolbar and store icons
├── src/
│   ├── shared/                    loaded by every part of the extension
│   │   ├── defaults.js            default settings, default topics, time-saved estimates
│   │   ├── schedule.js            schedule windows, Focus-active logic, Normal/Focus toggle
│   │   └── storage.js             chrome.storage.local read/write, stats helpers
│   ├── content/                   runs on www.youtube.com
│   │   ├── selectors.js           every YouTube selector, grouped by setting
│   │   ├── filter.js              topic / allowlist / blocklist matching engine
│   │   ├── content.js             SPA routing, MutationObserver, card filtering, guard, stats
│   │   └── content.css            styles for the Home panel, focus guard and dimmed cards
│   ├── background/
│   │   └── service-worker.js      stats queue, focus-session counter, badge, shortcut
│   ├── popup/                     toolbar popup (popup.html / .css / .js)
│   ├── options/                   settings page and dashboard (options.html / .css / .js)
│   └── ui/theme.css               shared dark theme for popup and options
├── tests/logic.test.js            unit tests for the matcher and schedule (Node, no dependencies)
└── package.json                   `npm test`
```

There is no build step: the folder is the extension.

---

## How it works

### 1. Settings and storage (`src/shared/`)
All settings live in `chrome.storage.local` as individual keys matching `FT_DEFAULTS`. The popup, options page, content script and service worker all read the same keys. Each one listens to `chrome.storage.onChanged`, so a change made anywhere takes effect in every open YouTube tab straight away, without a reload.

Statistics are stored under one key, `ftStats` (`{ today, total }`). Only the service worker writes it, through a serial queue, so counts sent from several tabs at once can't overwrite each other.

### 2. Hiding distractions (`selectors.js` + `content.js`)
`selectors.js` maps each setting to a list of selectors. At startup `content.js` turns this map into one stylesheet, one rule per selector:

```css
html.ft-on.ft-hideShorts ytd-rich-item-renderer:has(a[href^="/shorts/"]) { display: none !important; }
```

The content script only toggles classes on `<html>` (`ft-on`, `ft-hideShorts`, …). The browser's CSS engine then hides matching elements the moment YouTube inserts them, with no flicker and no per-element JavaScript. Turning a setting off removes the class, and the content comes back without a reload.

Selectors are chosen to survive redesigns: custom element names (`ytd-reel-shelf-renderer`, `grid-shelf-view-model`, `ytm-shorts-lockup-view-model`), stable attributes (`page-subtype="home"`, `is-shorts`) and **URL shapes** (`a[href^="/shorts/"]`, `/feed/trending`, `start_radio=1`). Nothing depends on position. When YouTube changes its markup, `selectors.js` is the only file to update.

### 3. Single-page navigation
YouTube never fully reloads between pages. `content.js` handles this three ways:
- a **MutationObserver** on the document, throttled to one scan per 300 ms and ignoring the video player's own constant updates;
- YouTube's `yt-navigate-finish` event and `popstate`;
- a 2-second interval for player-internal state (the autoplay switch) and a 30-second interval for schedule boundaries.

On each URL change it applies redirects: `/shorts/ID` → `/watch?v=ID`, a channel's `/shorts` tab → `/videos`, and `/feed/trending` → Home.

### 4. Focus filtering (`filter.js`)
Every video card (`ytd-rich-item-renderer`, `ytd-video-renderer`, `yt-lockup-view-model`, …) in a filtered area (Home, suggested, search, optionally subscriptions) is checked against compiled rules, in this order:

1. Blocked channel or blocked keyword → **hide** (both modes)
2. Focus Mode off, or not applied in this area → show
3. Allowed channel, allowed keyword, or keyword of an enabled topic → show
4. Otherwise → **hide** or **dim**

Keywords match on word boundaries (so `AI` doesn't match "s**ai**d"), allow plurals, and ignore case. Channels can be listed by display name (matched in card text) or `@handle` (matched against the card's links). YouTube reuses card elements for different videos, so each card is re-checked whenever its text changes.

### 5. Service worker (`service-worker.js`)
- Receives batched counters from content scripts and writes `ftStats`.
- Checks every minute (via `chrome.alarms`) whether Focus Mode is active, counts each Normal → Focus switch as a **focus session**, and shows **ON** / **OFF** on the toolbar badge.
- Handles the `Alt+Shift+F` shortcut.

### 6. Statistics
- **Shorts blocked**: unique Short IDs hidden from view, plus redirected Shorts links.
- **Videos filtered**: cards hidden or dimmed by Focus Mode or the blocklists.
- **Distractions removed**: one per feature per page view (e.g. the suggestions column on a video), plus autoplay switched off.
- **Estimated time saved**: 45 s per Short, 20 s per filtered video and 5 s per distraction. These are rough estimates, and the dashboard says so.

---

## Privacy

- Permissions: `storage` and `alarms` only. The content script runs only on `youtube.com`.
- No network requests, analytics or remote code.
- No browsing history is recorded. Statistics are anonymous counters.
- Settings can be exported or imported as JSON, and wiped, from **Settings → Privacy & data**.

---

## Development milestones

The code is organised so each milestone works independently:

1. **MVP: Shorts and distraction removal.** `selectors.js`, the stylesheet generated in `content.js`, the Shorts redirect, autoplay off, and the Distractions page.
2. **Focus Mode and filtering.** `filter.js`, card scanning, topics editor, allow/block lists, focus guard, and "Block this channel".
3. **Schedule and statistics.** `schedule.js`, the service worker's session counter and stats queue, and the Dashboard.

---

## Testing

### Automated
Unit tests cover the matching engine and the schedule logic (word boundaries, plurals, blocklist precedence, @handles, overnight windows, snoozing):

```bash
npm test
```

(or `node --test` from the `FocusTube` folder; needs Node 18+).

### Manual checklist

**Setup**
- [ ] Extension loads in `chrome://extensions` with no errors; the settings page opens on first install.
- [ ] Popup opens and fits without scrolling; the toolbar badge shows nothing in Normal Mode.

**Shorts**
- [ ] Home: no Shorts shelf, no "Shorts" entry in the side menu or the collapsed mini menu.
- [ ] Search (e.g. "python tutorial"): no Shorts shelf or Shorts cards.
- [ ] Subscriptions: no Shorts shelf or Shorts cards.
- [ ] A channel page: no "Shorts" tab; visiting `/@channel/shorts` goes to `/@channel/videos`.
- [ ] Opening any `youtube.com/shorts/ID` link lands on `/watch?v=ID`. With "Block it" selected it lands on Home.
- [ ] Turning **Hide Shorts** off in the popup brings Shorts back immediately, without a reload.

**Distractions**
- [ ] **Hide recommendations** replaces the Home feed with the FocusTube search panel and removes the "Up next" column on watch pages.
- [ ] Explore/Trending is gone from the menu; `/feed/trending` redirects to Home.
- [ ] Autoplay switch in the player turns off by itself.
- [ ] No end-screen cards or video wall when a video ends.
- [ ] Comments, notifications bell and live chat hide only when their toggles are on.

**Focus Mode**
- [ ] Switching to **Focus** shows the ON badge. Home and suggested videos show only on-topic videos (try disabling "Programming" and watch Python videos disappear).
- [ ] **Dim** mode fades off-topic cards instead of removing them.
- [ ] Opening an off-topic video from a pasted link shows the guard and the video stays paused; **Watch anyway** plays it; **Go back** returns.
- [ ] Search "funny cats" in Focus Mode: off-topic results are hidden, and scrolling keeps loading more.
- [ ] Search a blocked keyword (e.g. "prank") in either mode: the blocked-search guard appears; **Search anyway** shows results.
- [ ] On the Home feed in Focus Mode, keep scrolling: new on-topic videos keep loading (the feed doesn't stop after a few cards).
- [ ] Adding a topic in Settings (name + keywords) takes effect in an open YouTube tab without a reload.

**Allow / block**
- [ ] Blocked keyword (e.g. "prank") hides matching videos in both modes.
- [ ] On a watch page, popup → **Block** hides that channel's cards everywhere and shows the blocklist guard on its videos.
- [ ] An allowed channel's videos show in Focus Mode even without matching topics.

**Schedule**
- [ ] Set a window that includes the current time: Focus Mode turns on within a minute; the popup says "Scheduled focus until …".
- [ ] Switching to **Normal** during the window keeps it off until the window ends ("Schedule snoozed until …").
- [ ] A window outside the current time leaves Normal Mode alone.

**Stats and data**
- [ ] Dashboard counters rise while browsing; focus sessions go up by one per Normal → Focus switch.
- [ ] Export, then Reset settings, then Import restores your topics and lists.
- [ ] Master switch off: YouTube looks completely stock.

**SPA navigation**
- [ ] Navigate Home → search → video → channel → Home by clicking only (no reloads): filtering keeps working on every page.

---

## Known limitations

- **YouTube markup changes.** YouTube ships UI experiments often. If something reappears, update the selectors in `src/content/selectors.js`.
- **Text fallbacks.** The full side-menu Shorts entry and Shorts filter chips have no `/shorts/` link, so they are matched by the word "Shorts" (YouTube rarely translates it). Everything else is language-independent.
- **Keyword matching is literal.** Topics match words in the title and channel name, not the meaning of a video. Add keywords to widen a topic, or allowed channels for trusted creators.
- **Desktop only.** `m.youtube.com` and YouTube Music aren't supported.
- **Video ads** inside the player are not blocked. "Hide sponsored blocks" only removes promoted cards and banners.
- Turning autoplay off clicks YouTube's own switch, so YouTube also remembers that choice.

## Troubleshooting

- **Nothing changes on YouTube:** reload the tab after installing or reloading the extension. Check that the master switch is on.
- **Errors:** `chrome://extensions` → FocusTube → *Errors*. For the content script, open DevTools on a YouTube tab and look for messages from the extension's context.
- **Service worker logs:** `chrome://extensions` → FocusTube → *Service worker* → Inspect.
