// ==============================================
// SELF-CENSORED SERVER
// Serves the static frontend and aggregates news server-side so API keys
// stay private and every visitor shares one cached set of upstream calls.
// ==============================================

import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { adapters, isAvailable } from './adapters.js';
import { isNewsArticle } from './filters.js';
import { classifyMoods } from './mood.js';
import { addMissingImages } from './images.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_WAIT_MS = 4000;   // a slow outlet is left out of this response, not waited on

const SOURCES = JSON.parse(readFileSync(path.join(__dirname, 'sources.json'), 'utf8'));
const SOURCES_BY_ID = Object.fromEntries(SOURCES.map(s => [s.id, s]));
// Ownership, aliases, links and notes for each outlet's detail page
const SOURCE_DETAILS = JSON.parse(readFileSync(path.join(__dirname, 'source-details.json'), 'utf8'));
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const ICONS_DIR = path.join(ASSETS_DIR, 'icon');    // square marks, named <source id>.<ext>
const LOGOS_DIR = path.join(ASSETS_DIR, 'logo');    // wide wordmarks, named <source id>.<ext>

// ==============================================
// CACHE
// Entries keep their last good value so an upstream outage serves stale
// articles instead of nothing.
// ==============================================

const cache = new Map();

// Stale-while-revalidate: once an outlet has loaded, its last articles are
// served straight away and a refresh runs in the background when they're old
async function cached(key, ttl, load) {
    const entry = cache.get(key) || {};
    if (entry.value && entry.expires > Date.now()) return entry.value;
    if (entry.pending) return entry.value || entry.pending;

    entry.pending = load()
        .then(value => {
            cache.set(key, { value, expires: Date.now() + ttl });
            console.log(`[fetch] ${key}: ok`);
            return value;
        })
        .catch(error => {
            console.warn(`[fetch] ${key}: ${error.message}`);
            // Back off for a minute before retrying a failing source
            cache.set(key, { value: entry.value, expires: Date.now() + 60 * 1000 });
            return entry.value || null;
        });
    cache.set(key, entry);
    return entry.value || entry.pending;
}

// Keep every outlet's articles ready: load them all at start-up, and again
// before they go stale, so a visitor rarely waits on an upstream feed
function warmCache() {
    SOURCES.filter(isAvailable).forEach(source => fetchSource(source).catch(() => {}));
}

async function fetchSource(source) {
    return (await cached(source.id, CACHE_TTL_MS, () => adapters[source.adapter](source))) || [];
}

function removeDuplicates(articles) {
    const seen = new Set();
    return articles.filter(article => {
        const key = article.title.toLowerCase().substring(0, 50);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

// ==============================================
// ROUTES
// ==============================================

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
    res.set({
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY'
    });
    next();
});

// How strongly an outlet leans, from its MBFC bias label
function biasLevel(bias) {
    if (!bias) return 'unrated';
    if (bias === 'Least Biased' || bias === 'Pro-Science') return 'low';
    if (bias === 'Left-Center' || bias === 'Right-Center') return 'medium';
    return 'high';   // Left, Right
}

// How an outlet's articles reach us, in words
function fetchedVia(source) {
    switch (source.adapter) {
        case 'rss': return 'Official RSS feed';
        case 'googlenews': return `Google News search of ${source.domain}`;
        case 'guardian': return 'The Guardian Open Platform API';
        case 'hackernews': return 'Hacker News API';
        case 'spaceflight': return 'Spaceflight News API';
        default: return 'No free feed';
    }
}

app.get('/api/sources', (req, res) => {
    res.json(SOURCES.map(({ id, name, tier, paywall, category, topics, icon, logo, bias, credibility, factual, credible }) => ({
        id,
        name,
        tier: [1, 2, 3].includes(tier) ? tier : 3,   // popularity: 1 household name, 2 well known, 3 niche
        paywall: paywall === true,                  // most articles need a subscription
        category,
        topics: topics || [category],
        // Only offer icons that exist, so a renamed file falls back to initials instead of a 404
        icon: icon && existsSync(path.join(ICONS_DIR, icon)) ? `/assets/icon/${encodeURIComponent(icon)}` : null,
        logo: logo && existsSync(path.join(LOGOS_DIR, logo)) ? `/assets/logo/${encodeURIComponent(logo)}` : null,
        bias: bias || null,
        biasLevel: biasLevel(bias),
        credibility: credibility || null,   // MBFC: High | Medium | Low
        factual: factual || null,           // MBFC factual reporting
        credible: credible !== false,
        available: isAvailable(SOURCES_BY_ID[id]),
        fetchedVia: fetchedVia(SOURCES_BY_ID[id]),
        ...(SOURCE_DETAILS[id] || {})
    })));
});

app.get('/api/news', async (req, res) => {
    const requested = String(req.query.sources || '')
        .split(',')
        .map(id => SOURCES_BY_ID[id.trim()])
        .filter(source => source && isAvailable(source));

    // Don't let one slow upstream hold the whole feed; it keeps loading into the cache
    const results = await Promise.all(requested.map(source =>
        Promise.race([
            fetchSource(source),
            new Promise(resolve => setTimeout(() => resolve([]), REQUEST_WAIT_MS))
        ])
    ));
    const failed = requested.filter((_, i) => results[i].length === 0).map(s => s.name);

    const sorted = (await classifyMoods(removeDuplicates(results.flat()).filter(isNewsArticle)))
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    // Pictures for articles whose feed had none (newest first; see images.js)
    const articles = await addMissingImages(sorted);

    res.set('Cache-Control', 'public, max-age=60');
    res.json({ articles, failed });
});

app.use(express.static(path.join(__dirname, '..', 'public')));
// Outlet images live beside public/: assets/icon and assets/logo, each file named <source id>.<ext>
app.use('/assets', express.static(ASSETS_DIR, { maxAge: '1h' }));   // short, so swapped image files show up soon

app.listen(PORT, HOST, () => {
    console.log(`Self-Censored listening on http://${HOST}:${PORT}`);
    warmCache();
    setInterval(warmCache, CACHE_TTL_MS - 60 * 1000).unref();
    if (!process.env.GUARDIAN_API_KEY) {
        console.log('GUARDIAN_API_KEY not set: The Guardian will be listed as limited');
    }
});
