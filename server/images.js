// ==============================================
// ARTICLE IMAGES for feeds that don't include one
// ==============================================
// Some RSS feeds (Al Jazeera, TechCrunch, BleepingComputer, …) carry no
// picture, so we read the article page's preview image (og:image /
// twitter:image). Results are cached per link, sites that refuse us (401/403:
// Bloomberg, The Economist) are skipped for a while, and the feed only waits a
// short time: whatever isn't ready yet fills in on a later load.
//
// Google News links (Reuters, AP, CNN, WSJ, …) are left alone: turning them
// into the publisher's URL takes two requests to Google per article, which
// soon trips its bot check and could get the server blocked from Google News,
// the feed those outlets come through. (Reuters, AP and WSJ also refuse page
// reads.) Those articles show the outlet's logo instead.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const FETCH_TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const BLOCKED_TTL_MS = 6 * 60 * 60 * 1000;
const CONCURRENCY = 6;
const MAX_HTML_BYTES = 400_000;       // the <head> is near the top; don't read whole pages

const resolved = new Map();           // article URL -> { url, image, expires }
const pending = new Map();            // article URL -> Promise
const blockedHosts = new Map();       // hostname -> retry after (ms)

// WordPress's image proxy (i0.wp.com) often 404s; the original file usually works
export function unproxyImage(url) {
    return typeof url === 'string' ? url.replace(/^https?:\/\/i\d\.wp\.com\//i, 'https://') : url;
}

function isGoogleNews(url) {
    return /^https:\/\/news\.google\.com\/rss\/articles\//.test(url);
}

async function fetchText(url, options = {}, maxBytes = MAX_HTML_BYTES) {
    const response = await fetch(url, {
        ...options,
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...(options.headers || {}) },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow'
    });
    if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
    }
    // Read only the start of the page
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (size < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
    }
    reader.cancel().catch(() => {});
    return Buffer.concat(chunks).toString('utf8');
}

function metaContent(html, names) {
    for (const name of names) {
        const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i');
        const reversed = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`, 'i');
        const found = html.match(pattern)?.[1] || html.match(reversed)?.[1];
        if (found) return found.replace(/&amp;/g, '&');
    }
    return null;
}

// A site-wide logo or placeholder isn't the story's picture
function isGenericImage(url) {
    return /logo|placeholder|default[-_.]|favicon|\/icon/i.test(url);
}

async function lookUp(articleUrl) {
    const url = articleUrl;
    if (isGoogleNews(url)) return { url, image: null };

    const host = new URL(url).hostname;
    if ((blockedHosts.get(host) || 0) > Date.now()) return { url, image: null };
    try {
        const html = await fetchText(url);
        const image = metaContent(html, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']);
        const absolute = image ? new URL(image, url).href : null;
        return { url, image: absolute && !isGenericImage(absolute) ? unproxyImage(absolute) : null };
    } catch (error) {
        if (error.status === 401 || error.status === 403) blockedHosts.set(host, Date.now() + BLOCKED_TTL_MS);
        return { url, image: null };
    }
}

function lookUpCached(articleUrl) {
    const hit = resolved.get(articleUrl);
    if (hit && hit.expires > Date.now()) return Promise.resolve(hit);
    if (pending.has(articleUrl)) return pending.get(articleUrl);
    const job = lookUp(articleUrl)
        .catch(() => ({ url: articleUrl, image: null }))
        .then(result => {
            const entry = { ...result, expires: Date.now() + CACHE_TTL_MS };
            resolved.set(articleUrl, entry);
            pending.delete(articleUrl);
            return entry;
        });
    pending.set(articleUrl, job);
    return job;
}

// Fill in missing images for these articles, waiting
// at most `budgetMs`; lookups still running carry on for next time
export async function addMissingImages(articles, budgetMs = 2500) {
    // Look up the page the picture is on (for Reddit, the linked story)
    const pageOf = article => article.imageFrom || article.url;
    const missing = articles.filter(article => !article.urlToImage && pageOf(article) && !isGoogleNews(pageOf(article)));
    const queue = [...missing];
    const work = Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length) await lookUpCached(pageOf(queue.shift()));
    });
    await Promise.race([Promise.all(work), new Promise(resolve => setTimeout(resolve, budgetMs))]);

    return articles.map(({ imageFrom, ...article }) => {
        const hit = resolved.get(imageFrom || article.url);
        if (!hit) return article;
        return { ...article, urlToImage: article.urlToImage || hit.image || null };
    });
}
