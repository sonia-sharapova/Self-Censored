# Self-Censored
Easy-peasy, self-guided news filtration

**Live:** https://self-censored.soniapolis.com

Pick your "credible" outlets, block the words you'd rather not read, and enjoy a feed that agrees with you. Roadmap, API research and deployment notes are in [docs/ROADMAP.md](docs/ROADMAP.md).

## Running it
Requires Node 22.9+.

```bash
npm install
cp deploy/self-censored.env.example .env   # add a free Guardian key (optional)
npm start                                  # http://127.0.0.1:3000
```

Without `GUARDIAN_API_KEY`, The Guardian is listed under "Limited Sources" and everything else still works.

## How it works

```
browser (public/)  ──►  /api/news?sources=bbc,npr,…  ──►  server/  ──►  RSS feeds, Guardian API,
   keyword filter        (JSON articles)                 10-min cache      Google News, HN, Spaceflight
```

- **`server/index.js`**:
  - Serves `public/`.
  - Exposes `GET /api/sources` (the outlet list, and which are available) and `GET /api/news?sources=…` (merged, de-duplicated articles, newest first).
  - Caches each outlet for 10 minutes and keeps the last good copy if an outlet goes down.
  - Waits at most 8 s for a slow outlet; the rest of the feed still returns.
- **`server/sources.json`**: the outlet catalog. Each entry names an adapter (`rss`, `guardian`, `googlenews`, `hackernews`, `spaceflight`, or `none` for paid-only outlets), its `topics` (can be several), and optional `logo` (a wordmark in `assets/logo/`) and `icon` (a square mark in `assets/icon/`) files, each named after the outlet's id (e.g. `assets/icon/nyt.png`, `assets/logo/nyt.svg`). To add an RSS outlet, add one line here.
- **`server/source-details.json`**: per outlet, its aliases, owner and ownership type, country, homepage, MBFC page and notes, shown on the outlet's detail page in Settings. Ownership is as of 2025.
- **`assets/logo/`, `assets/icon/`** (spares in `assets/unused/`): outlet wordmarks and square icons, served under `/assets/`. Cards and the Settings table show the wordmark (or the icon if there is none, or if the wordmark is too wide for the space); the sidebar shows the icon. The browser trims padding from each file so every logo renders at the same height. An outlet with neither shows its initials.
- **`server/adapters.js`**: one function per adapter. Each returns articles as `{title, description, content, url, urlToImage, publishedAt, source, author}`.
- **`public/css/system.css`**: the design system (tokens and components) that every page uses. Rules for new pages are in [docs/STYLEGUIDE.md](docs/STYLEGUIDE.md), and the live reference is at `/styleguide.html`.
- **`public/script.js`**: the UI and all filtering. Source choices, favourite sources, keywords, topics and settings are saved in `localStorage`, and can be exported or imported as JSON from Settings.
- **`deploy/`**: the systemd unit, nginx site config and env template used on the VPS.

### Sources
60 outlets, picked in Settings → Sources: search, a Filters popover (favourite, credibility, bias, topic; pick any, or "All") and a grid or rows view, headed by "N of M in feed" with Select all / Clear; click an outlet for its detail page (ratings, ownership, aliases, topics, notes). Each entry in `server/sources.json` has `topics`, MBFC `bias` / `credibility` / `factual` ratings where MBFC has them, and an optional `"credible": false`. Topics are World, Politics, Business, Technology, Science and Culture. An outlet can have several; specialist ones (e.g. BleepingComputer) have just one. "select all" / "clear" act on the outlets currently listed (after search and filters), and a ☆ on each outlet: starred outlets are the ones listed in the sidebar, where clicking one adds it to or leaves it out of the feed.

- **Main list:** outlets that Media Bias/Fact Check rates "Mostly Factual" or better for factual reporting.
  - **News:** BBC, NPR, PBS, ProPublica, CBS, ABC, NBC, Politico, The Hill, Axios, Semafor, Time, LA Times, Washington Post, NYT, HuffPost, Washington Examiner, The Guardian, Reuters, AP, CNN, WSJ.
  - **World:** DW, France 24, ABC News (Australia), Sky News, Euronews, The Globe and Mail, The Japan Times, The Hindu.
  - **Business:** The Economist, Financial Times, Bloomberg.
  - **Magazines & Analysis:** The Atlantic, Vox, National Review, The Dispatch, The Conversation.
  - **Science:** ScienceDaily, Nature, Spaceflight News.
  - **Tech:** Ars Technica, Wired, The Verge, TechCrunch, Engadget, CNET, Gizmodo, ZDNet, Mashable, The Register, 404 Media, BleepingComputer.
- **Marked "mixed credibility" in Settings:**
  - Rated **Mixed or Low** factual reporting: Fox News, New York Post, Al Jazeera.
  - **Unrated:** Cybernews, TechARP.
  - **User-submitted aggregators:** Hacker News and Reddit r/news.

**How each source is fetched:**
- Most use their official RSS feed.
- The Guardian uses its API.
- Reuters, AP, CNN, WSJ, HuffPost, Cybernews and TechARP go through Google News per-site search. They either have no usable feed or block our requests.

### News only
`server/filters.js` drops two kinds of items before articles reach the browser:
- **Shopping content:** coupon and promo-code pages, "% off" / "$ off" deals, gift guides, "how to watch … for free" pages, sponsored posts, and `/shopping/` or `/deals/` URLs. Stories that merely use the word "deal" (e.g. "US-Iran deal") are kept.
- **Stale items:** anything published more than 6 months ago (the longest timeframe in Settings).

The feed shows the newest articles first, 15 per page, with First / Previous / page numbers / Next / Last.

## Defaults
A new visitor, and "Reset to default", get World, Politics and Technology; `*AI`, `trump`, `"ICE"` and `guilty` redacted; and eight sources: WSJ, PBS, NPR, Nature, New York Times, CNN, BBC and AP, with PBS and NYT starred.

## Filtering
Filtering happens in the browser, on articles already loaded, so every change is instant.

- **Keywords to avoid** (Settings → Keywords to avoid): hides any article that mentions one. Click a word ("× amazon") to remove it.
- **Search bar:** finds articles that mention a word. When any search terms are set, an article must mention at least one, across every selected topic and source. Search terms show in green under the bar; click one ("× nasa") to remove it.
- **"x hidden":** the summary line above the feed reads "Displaying 87 articles (16 hidden)"; click it to list every hidden article with its reason ("avoided: tariffs"), and "show anyway" brings one back for the session.
- **Topics (sidebar):** World, Politics, Business, Technology, Science, and Culture (which includes the community aggregators). The feed shows outlets in any selected topic.
- **Bias (sidebar):** how strongly an outlet leans, from [Media Bias/Fact Check](https://mediabiasfactcheck.com/) (stored as `bias` in `server/sources.json`; full list in `docs/source-ratings.xlsx`). Low = Least Biased or Pro-Science, Medium = Left-Center or Right-Center, High = Left or Right, Unrated = no MBFC rating (Reddit, Cybernews, TechARP, Spaceflight News).
- **Mood (sidebar):** each article is tagged doomer, neutral or hopecore by `server/mood.js`. It counts doom words (war, killed, crisis, layoff*…) against hope words (breakthrough, rescue*, recover*…) in the headline (×2) and summary, skipping any right after "no"/"not"; −2 or lower is doomer, +2 or higher hopecore. It's approximate (no sarcasm or context) and hopecore is rare in news. The server's `classifyMoods()` is async so a sentiment model can replace the word lists later without the browser changing.
- **Bias and Mood are optional:** each has a switch in Settings (off by default). When off, it doesn't filter the feed and isn't shown in the sidebar.
- **Sidebar:** Topics and Redacted (keywords to avoid) are bulleted lists; clicking a name opens that part of Configure, hovering the bullet shows × to remove it. Redacted has "+" and "clear all", and disappears when empty. Sources lists only what's in your feed ("x sources"), favourites first with a ★ in the bullet column. Bias and Mood appear when switched on. One underlined "manage filters" link at the bottom opens Configure, where "Reset all filters" lives (every topic, the five most popular sources, bias and mood off, *ai, trump, "ICE" and guilty redacted; also the first-visit default).
- **Bias and Mood (sidebar):** off, each is just its heading with a "+"; that opens the slider. Picking a level switches the filter on; "all" (or "−") switches it off and closes it again.
- **Article images:** RSS photos come from `media:content` (including inside `media:group`, as ABC Australia uses), `media:thumbnail`, an image enclosure, CBS's plain `<image>` tag (with its 60×60 thumbnail path removed for the full-size picture), or the first real `<img>` in the body. Outlets fetched through Google News, and feeds that include no pictures (Al Jazeera, Bloomberg, Euronews, The Economist and others), show the outlet's wordmark instead.
- **Privacy and saving:** no accounts and no cookies. Your settings are saved in this browser's `localStorage` by default and never leave the device. The first time you change something, a small note at the bottom says so, with "Don't save" to switch it off. The same switch is under Settings → Advanced settings → Your data, where you can also export your setup as a JSON file and import it later (or on another device).
- **Popularity:** each outlet in `server/sources.json` has a `tier` (1 = household names like CNN, NYT, BBC; 2 = well known; 3 = niche). Your sources (the sidebar's top 5 and the Configure table) are ordered by tier, then name; the "Add sources" list stays A to Z. "N sources" and "See all" in the sidebar open the Sources table.
- **Configure → Sources** shows the outlets in your feed as a grid (4 across) or rows, collapsed with "Show N more", with its own search and Filters (Topic first) and import/export beside them. ★ keeps an outlet in the sidebar, × removes it, clicking opens its details. "Clear all" empties the feed; "Reset all filters" restores the defaults. "+ Add sources" opens an Attach-style picker: search, Filters, "Select all", tick outlets (each shows country • credibility • bias), then "Add N". Everything saves as you go.
- **Settings** is its own page (`#settings`, opened by the gear button in the sidebar; "← Back to your feed" returns). It has tabs across the top (**Appearance**, **Preferences**, **Advanced settings**, **Contact**), and each tab lists its sections on the left; clicking one jumps to it. Links like `#settings/sources` or `#settings/source:nyt` open a section or an outlet's page directly. Its sections:
  - **Redacted keywords:** type into the input; your keywords show as tags, with examples to add (`*ai`, `trump`, `"ICE"`, `guilty`: the default redactions). A plain word matches the whole word in any case. `*` stands for any letters (`*ai` hides AI and OpenAI). "Double quotes" match exactly, capitals included (`"Trump"` hides Trump, not "trump card").
  - **Topics:** a tile per topic.
  - **Sources**
  - **Sources:** your outlets as a table or a card grid, pinned (★) outlets first, with a pager so the table keeps its height.
    - **Table:** a select box, the outlet (logo in a fixed square, then name), bias as a coloured tag, credibility (icon and word), country, pinned, and a trash can on hover. Headers sort, and ticking rows offers Pin, Remove or Undo selection.
    - **Grid:** 4 cards across, each with the icon, name and country, ★ top right, topic tags, credibility and bias, and a trash can on hover.
    - **Explore full library →** swaps the table for the library, in the same box: "Available news outlets" (search, Filters without "Favourite", and the same table) and a "Current media selection" drop-down (its own search, your feed ticked, and "N sources →" back to your table). Nothing changes until Add, Remove or Apply.
  - **Bias / Mood:** a switch and a slider across the spectrum, with "Any" beside it. Picking a level switches the filter on; "Any" switches it off.
  - **Advanced settings:** timeframe, keyword matching, auto-refresh, and "Hide sources you can't read". Under "Sources you have access to", tick the paywalled outlets you subscribe to (outlets marked `"paywall": true` in `server/sources.json`). Articles from paywalled outlets you don't subscribe to show 🔒.
  - **Appearance:** light, dark, or sync with the system.
  - **Defaults:** "Save current as default" makes your setup the starting point. "Reset to default" puts it back, and "Restore original defaults" returns to the built-in ones: the 5 most popular sources, all topics, bias and mood off, *ai, trump, "ICE" and guilty redacted. Defaults are included in export and import.
- **Timeframe (Settings → Feed):** last 24 hours, 7 days (default), a month, or 6 months. Most feeds only carry their latest 20–50 items, so longer timeframes show what the feeds still hold, not a full archive.
- **Auto-refresh (Settings → Feed):** off (default), or every 15 minutes, 30 minutes or hour.

### Matching rules
| You type | Matches | Doesn't match |
|---|---|---|
| `ai` | "AI", "OpenAI's AI-powered" | "said", "Taiwan" |
| `war` | "war", "War!" | "warning", "Warsaw" |
| `climate change` (or `"climate change"`) | "Climate  change" | "climate policy change" |
| `crypto*` | "crypto", "cryptocurrency" | "encrypted" |

Matching ignores case and uses whole words; `*` at the end of a word matches any ending.

### What is checked
The headline, the description/summary, and the article text (up to 3,000 characters) when the source provides it (the Guardian and many RSS feeds). Settings → Feed → "Match keywords in: Title only" checks just the headline.

URLs, author names, source names, dates and image alt text are not checked.

## Deploying
See [docs/ROADMAP.md → Deployment](docs/ROADMAP.md#deployment-soniapoliscom-vps). In short: rsync to `/opt/self-censored`, then `npm ci --omit=dev`, then `systemctl restart self-censored`.
