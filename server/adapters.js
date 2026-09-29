// ==============================================
// SOURCE ADAPTERS
// Each adapter fetches one outlet and returns articles in the shape the
// frontend expects: {title, description, content, url, urlToImage, publishedAt, source, author}
// ==============================================

import { unproxyImage } from './images.js';
import Parser from 'rss-parser';

const USER_AGENT = 'Mozilla/5.0 (compatible; SelfCensored/1.0; +https://soniapolis.com)';
const PER_SOURCE_LIMIT = 20;
// Article body is only used for keyword matching, so cap it to keep responses small
const CONTENT_LIMIT = 3000;
const FETCH_TIMEOUT_MS = 15000;

const rssParser = new Parser({
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
    customFields: {
        item: [
            ['media:content', 'mediaContent', { keepArray: true }],
            ['media:thumbnail', 'mediaThumbnail'],
            ['media:group', 'mediaGroup'],    // ABC Australia nests its media:content in here
            ['image', 'itemImage'],           // CBS: a plain <image>URL</image> per item
            ['content:encoded', 'contentEncoded']
        ]
    }
});

async function fetchJson(url) {
    const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText} for ${url}`);
    }
    return response.json();
}

function stripHtml(html) {
    if (!html) return '';
    return html
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;|&apos;|&#8217;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

function truncate(text, length = 300) {
    if (!text || text.length <= length) return text || '';
    return text.substring(0, length).trimEnd() + '...';
}

function toIsoDate(value) {
    const date = new Date(value);
    return isNaN(date) ? new Date().toISOString() : date.toISOString();
}

// ----------------------------------------------
// RSS / Atom
// ----------------------------------------------

// CBS lists a 60x60 thumbnail whose size is signed into the URL; without the
// /thumbnail/WxH/<hash> part it serves the full picture
function fullSizeImage(url) {
    return url.replace(/\/thumbnail\/\d+x\d+\/[0-9a-f]+\//i, '/');
}

function rssImage(item) {
    const isImage = m => m?.$?.url && (!m.$.medium || m.$.medium === 'image');
    const media = item.mediaContent?.find(isImage)
        || [].concat(item.mediaGroup?.['media:content'] || []).find(isImage);
    if (media) return media.$.url;
    if (typeof item.itemImage === 'string' && /^https?:\/\//.test(item.itemImage.trim())) return fullSizeImage(item.itemImage.trim());
    if (item.mediaThumbnail?.$?.url) return item.mediaThumbnail.$.url;
    if (item.enclosure?.url && (item.enclosure.type || '').startsWith('image')) return item.enclosure.url;

    // Images embedded in the body are often share buttons or tracking pixels, not the story image
    const html = item.contentEncoded || item.content || '';
    const embedded = [...html.matchAll(/<img[^>]+src=(["'])(.+?)\1/gi)]   // NPR uses single quotes
        .map(match => match[2])
        .find(src => !/icon|logo|pixel|feedburner|share|badge|\.gif(\?|$)/i.test(src));
    return embedded || null;
}

async function rss(source) {
    const feed = await rssParser.parseURL(source.url);
    return feed.items.slice(0, PER_SOURCE_LIMIT).map(item => ({
        title: stripHtml(item.title),
        description: truncate(item.contentSnippet ? stripHtml(item.contentSnippet) : stripHtml(item.content || item.summary)),
        content: stripHtml(item.contentEncoded || '').substring(0, CONTENT_LIMIT),
        url: item.link,
        urlToImage: unproxyImage(rssImage(item)),
        // Reddit posts link to the news story as "[link]"; its page has the picture
        imageFrom: (item.content || '').match(/<a href="(https?:[^"]+)">\[link\]<\/a>/)?.[1] || null,
        publishedAt: toIsoDate(item.isoDate || item.pubDate),
        source: source.name,
        author: item.creator || item.author || ''
    }));
}

// ----------------------------------------------
// The Guardian Open Platform (needs GUARDIAN_API_KEY)
// ----------------------------------------------

async function guardian(source) {
    const params = new URLSearchParams({
        'api-key': process.env.GUARDIAN_API_KEY,
        'page-size': PER_SOURCE_LIMIT,
        'show-fields': 'headline,trailText,thumbnail,byline,bodyText',
        'order-by': 'newest'
    });
    const data = await fetchJson(`https://content.guardianapis.com/search?${params}`);

    return data.response.results.map(article => ({
        title: stripHtml(article.fields?.headline || article.webTitle),
        description: truncate(stripHtml(article.fields?.trailText)),
        content: (article.fields?.bodyText || '').substring(0, CONTENT_LIMIT),
        url: article.webUrl,
        urlToImage: article.fields?.thumbnail || null,
        publishedAt: toIsoDate(article.webPublicationDate),
        source: source.name,
        author: article.fields?.byline || ''
    }));
}

// ----------------------------------------------
// Google News per-site search (no key)
// For outlets whose own feeds are gone or paywalled (Reuters, AP, CNN, WSJ).
// Links go through a news.google.com redirect to the original article.
// ----------------------------------------------

async function googlenews(source) {
    const params = new URLSearchParams({
        // Low-volume sites need a wider window than the default day
        q: `site:${source.domain} when:${source.window || '1d'}`,
        hl: 'en-US',
        gl: 'US',
        ceid: 'US:en'
    });
    const feed = await rssParser.parseURL(`https://news.google.com/rss/search?${params}`);

    return feed.items.slice(0, PER_SOURCE_LIMIT).map(item => ({
        // Titles arrive as "Headline - Outlet"
        title: stripHtml(item.title).replace(/\s+-\s+[^-]+$/, ''),
        description: '',
        content: '',
        url: item.link,
        urlToImage: null,
        publishedAt: toIsoDate(item.isoDate || item.pubDate),
        source: source.name,
        author: ''
    }));
}

// ----------------------------------------------
// Keyless JSON APIs
// ----------------------------------------------

async function hackernews(source) {
    const ids = await fetchJson('https://hacker-news.firebaseio.com/v0/topstories.json');
    const stories = await Promise.all(
        ids.slice(0, PER_SOURCE_LIMIT).map(id =>
            fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)
        )
    );

    return stories
        .filter(story => story && story.url && story.title)
        .map(story => ({
            title: story.title,
            description: story.text ? truncate(stripHtml(story.text), 200) : 'Hacker News discussion',
            content: '',
            url: story.url,
            urlToImage: null,
            publishedAt: new Date(story.time * 1000).toISOString(),
            source: source.name,
            author: story.by
        }));
}

async function spaceflight(source) {
    const data = await fetchJson(`https://api.spaceflightnewsapi.net/v4/articles/?limit=${PER_SOURCE_LIMIT}&ordering=-published_at`);
    return data.results.map(article => ({
        title: article.title,
        description: truncate(article.summary),
        content: '',
        url: article.url,
        urlToImage: unproxyImage(article.image_url),
        publishedAt: toIsoDate(article.published_at),
        source: source.name,
        author: article.news_site
    }));
}

export const adapters = { rss, guardian, googlenews, hackernews, spaceflight };

export function isAvailable(source) {
    if (source.adapter === 'none') return false;
    if (source.adapter === 'guardian') return Boolean(process.env.GUARDIAN_API_KEY);
    return true;
}
