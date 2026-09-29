# Self-Censored: Roadmap & Research

_Last updated: 2026-09-29_

## Premise
Self-Censored is a news aggregator whose main feature is letting you *not* see news. You pick "credible" outlets and block keywords, and the feed shows only what you already agree with. The satire lives in the copy ("CONFIRM YOUR BIASES", "If you can't see it, it's not real!"). The product itself should work as a genuinely useful filtered news reader.

**Live:** https://self-censored.soniapolis.com

---

## Status

### Phase 1: Make it work publicly (done)
- **A small Node server** (`server/`):
  - Fetches every outlet server-side from one list, `server/sources.json`.
  - Caches each source for 10 minutes, so all visitors share one set of upstream calls.
  - Waits at most 8 seconds per request for a slow source; the source keeps loading into the cache for the next refresh.
  - Keeps API keys on the server only.
- **Retired** the public CORS proxies, rss2json.com and NewsAPI (see research below).
- **Reddit** now uses its public RSS feed; its JSON API returns 403 to servers.
- **Moved the frontend** into `public/`, and `script.js` now fetches from `/api/news`.
- **Fixed bugs:**
  - Titles and keywords could inject HTML/script (XSS). Cards and keyword tags are now built with `textContent`.
  - Your source choices reset on every page load. They're now saved and restored.
  - Image fallbacks used the dead `via.placeholder.com`. They now use the CSS gradient placeholder.
  - The Settings modal was commented out. It's back (articles per page, dark mode, auto-refresh, shuffle, hide limited sources).
  - Adding or removing a keyword re-downloaded all the news. It now re-filters the articles already loaded.
  - Article links are restricted to `http(s)`.
  - The export filename said "clearfeed". It now says "self-censored".
- **Deployed** to the Vultr VPS (details below).

### Phase 1.5: More sources (done)
- Guardian API key installed on the server.
- Added 11 RSS outlets for range across the spectrum:
  - Left: The Atlantic, Vox, Mother Jones, HuffPost.
  - Right: National Review, Washington Examiner, New York Post, The Dispatch.
  - International: DW, France 24, ABC News (Australia).
- Article text is capped at 3,000 characters, and nginx gzip is on. A response with all 39 sources went from 773 KB to 329 KB.
- **Tried and dropped:** CBC (blocks our requests), NHK (English feed gone), HuffPost's main feed URL (406; the alternate feed works).

### Phase 1.6: Credibility, news only, more sources (done)
- **Credibility split:** sources are rated using Media Bias/Fact Check's factual-reporting score. Mixed or Low, unrated sites, and user-submitted aggregators go in a collapsed "Other sources" section (see table below).
- **News-only filter** (`server/filters.js`): drops coupon, deal and shopping posts, and anything older than 14 days.
- **Sort menu** (newest, oldest, mixed), and cards show "3h ago" or a full date and time.
- **New outlets:** NBC, Axios, Semafor, Time, LA Times, Sky News, Euronews, Globe and Mail, Japan Times, The Hindu, SCMP, The Economist, FT, Bloomberg (both have free headline feeds), The Conversation, ScienceDaily, Nature, Engadget, The Register, 404 Media, BleepingComputer, Cybernews, TechARP, and Slashdot (main, Science, Your Rights Online, IT, Hardware, Games, Entertainment).
- **Not available:**
  - Slashdot Technology, Devices and Open Source: their feeds are empty and Google News has almost nothing for them. Slashdot: Hardware covers devices.
  - Direct feeds for Cybernews and TechARP: both return 403, so they go through Google News.
  - HuffPost's alternate feed: it went empty, so HuffPost also goes through Google News.
- **Figma file:** https://www.figma.com/design/8ppI42OlC80Ss8lqIDXbkN (a capture of the current site).

#### Credibility ratings used (Media Bias/Fact Check, checked 2026-09-29)
| Other sources | Bias | Factual reporting |
|---|---|---|
| Fox News | Right | Low |
| New York Post | Right-Center | Mixed |
| Al Jazeera | Left-Center | Mixed |
| South China Morning Post | Left-Center | Mixed |
| Cybernews, TechARP | not rated | — |
| Reddit, Hacker News, Slashdot | user-submitted, not rated | — |

Checked and kept in the main list (Mostly Factual or better): CBS News, HuffPost, Washington Examiner, National Review, Mashable, The Hill, The Hindu, Euronews, 404 Media. All other main-list outlets rate High or Very High, except The Verge and Bloomberg, which weren't found on MBFC and were kept as established outlets.

### Phase 2: Make the filter much better (items 1–6 done)
1. ✅ **Smarter matching:** whole words (so "ai" no longer hides "said"), phrases, a `*` wildcard, and "only show" keywords.
2. ✅ **Topic packs:** Politics, Elon & Tech Bros, AI, Crypto, Celebrity, Sports, Doom.
3. ✅ **Filtering on full text:** on by default, with a toggle in Settings.
4. ✅ **Hidden drawer:** every hidden article with its reason, plus "show anyway".
5. ✅ **Bias filter:** Low / Medium / High / Unrated, from MBFC ratings stored statically in `server/sources.json` (`bias`), mapped to levels in `biasLevel()` in `server/index.js`. No API key needed. A left-to-right slider could still be built on the same field.
6. ✅ **Mood filter, v1:** doomer / neutral / hopecore per article, from word lists in `server/mood.js`.
   - **v2 (next): sentiment analysis.** Replace the scorer behind `classifyMoods()` (keep its signature and the `mood` field; set `moodSource`). Options: a local model via `@xenova/transformers` (free, runs on the VPS's CPU, a distilled sentiment model), or Claude Haiku classifying headlines (more accurate, a fraction of a cent per article). Either way, cache results per article URL so each is classified once.

### Phase 3: Keep people coming back
7. **Shareable profiles:** encode keywords, sources and bias range in the URL (`?p=…`) so you can send someone your bubble.
8. Bookmarks, read/unread state, and search within the filtered feed.
9. **Installable app (PWA):** add to home screen, offline cache.
10. **Optional later:** a daily email digest (the server already runs mail on port 25), and a browser extension that applies the blocklist to other news sites.

---

## Research: credible outlets with free access

| Source | Access | Free-tier terms | Status |
|---|---|---|---|
| **The Guardian** | Official API (Open Platform) | Free **Developer** key for non-commercial use: 1 call/s, 500 calls/day, **full article text** | In use (key installed on server) |
| **New York Times** | Official RSS (API also available: free, 500/day, 5/min) | Free, no key | In use (RSS) |
| BBC, NPR, PBS NewsHour, ProPublica, Al Jazeera, Fox News, CBS, ABC, Politico, The Hill, Washington Post | Official RSS | Free, no key | In use. NPR's API was retired but its RSS works |
| The Atlantic, Vox, Mother Jones, HuffPost, National Review, Washington Examiner, New York Post, The Dispatch, DW, France 24, ABC News (Australia) | Official RSS | Free, no key | In use |
| Ars Technica, Wired, The Verge, TechCrunch, CNET, Gizmodo, ZDNet, Mashable | Official RSS | Free, no key | In use |
| Hacker News, Spaceflight News | Open JSON API | Free, no key | In use |
| Reddit r/news | Public RSS | Free; the JSON API blocks servers (403) | In use (RSS) |
| **Reuters, AP, CNN, WSJ** | Google News per-site RSS search | Free, no key. Links go through a news.google.com redirect | In use |
| GDELT DOC 2.0 | Open API | Free, 1 request per 5 s | **Dropped.** Returned "too many requests" even for a single query from a fresh IP |
| GNews.io | Aggregator | About 100 req/day free; browser access from localhost only | Optional, server-side only |
| NewsData.io | Aggregator | 200 credits/day, 12-hour delay on free | Optional backup |
| Currents API | Aggregator | About 250–1000 req/day free | Optional backup |
| NewsAPI.org | Aggregator | Free plan **forbidden in production**, browser access from localhost only; paid is $449/mo | **Removed** |
| Bloomberg, Financial Times | Paid licenses only | — | Listed as "Limited" |

**Dead feeds found:** CNN's RSS (`rss.cnn.com`) stopped updating in April 2023, and WSJ's (`feeds.a.dj.com`) in January 2025.

### Bias & credibility data (for the Phase 2 slider)
- **AllSides:** left-to-right ratings for about 1,400 outlets. There's a community dataset on GitHub (`favstats/AllSideR`) and a paid license/API. Non-commercial use only; confirm the license before bundling.
- **Media Bias/Fact Check:** bias plus factual-reporting ratings for about 11,000 sources. Its RapidAPI tier is free for non-commercial and academic use with attribution.
- **Plan:** store the ratings as static fields in `server/sources.json`, with attribution. No calls at runtime.

---

## Deployment (soniapolis.com VPS)

| Item | Value |
|---|---|
| Host | Vultr VPS, Debian 11, nginx 1.18 |
| URL | https://self-censored.soniapolis.com (Let's Encrypt via certbot; HTTP redirects to HTTPS) |
| App directory | `/opt/self-censored` (owned by root, read-only to the service) |
| Service | `self-censored.service` (systemd), user `selfcensored`, listens on `127.0.0.1:3917` |
| Node | v22 from the official nodejs.org tarball (checksum verified), in `/opt/node`, linked into `/usr/local/bin` |
| Secrets | `/etc/self-censored.env` (mode 640, `root:selfcensored`) |
| nginx | `/etc/nginx/sites-available/self-censored.soniapolis.com` (source: `deploy/nginx-self-censored.conf`) |
| Logs | `journalctl -u self-censored`, `/var/log/nginx/self-censored.*.log` |

The existing `soniapolis.com` site config was not modified.

### Redeploying
```bash
rsync -az --delete --exclude node_modules --exclude .git --exclude .env --exclude .DS_Store \
  ./ root@soniapolis.com:/opt/self-censored/
ssh root@soniapolis.com 'cd /opt/self-censored && npm ci --omit=dev && chown -R root:root . && systemctl restart self-censored'
```

---

## API keys: what to do

The old NewsAPI, Guardian and WorldNews keys were committed to git, so treat them as public. They're gone from the code but remain in the git history.

1. **NewsAPI and WorldNews:** no longer used. Log in to each dashboard and regenerate (or delete) the key so the leaked one stops working.
2. **The Guardian:** get a new, free **Developer** key. This project is non-commercial, so you don't need a Commercial key. You'd only need one if you started charging, ran ads, or needed more than 500 calls/day.
   - Register at https://open-platform.theguardian.com/access/ → "Register developer key". The key is emailed right away.
   - With the 10-minute cache, the site makes at most about 144 Guardian calls a day, well under the 500 limit.
   - Install it on the server:
     ```bash
     ssh root@soniapolis.com
     nano /etc/self-censored.env        # GUARDIAN_API_KEY=your-new-key
     systemctl restart self-censored
     ```
   - Locally, put the same line in `.env` (git-ignored) and restart `npm start`.
   - To have the old leaked key disabled, contact Guardian Open Platform support. There's no self-service revoke.
