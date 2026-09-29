// ==============================================
// NEWS-ONLY FILTERS
// Feeds mix journalism with shopping content (coupon pages, deal roundups)
// and evergreen pages that are months old. Neither is news, so both are
// dropped before articles reach the browser.
// ==============================================

// Six months: the longest timeframe the settings offer. The browser narrows it
// further (24 hours / 7 days / a month), so this only trims truly stale pages.
const MAX_AGE_MS = 183 * 24 * 60 * 60 * 1000;

const COMMERCE_TITLE_PATTERNS = [
    /\b(coupons?|promo codes?|discount codes?|coupon codes?)\b/i,
    /\b\d+% off\b/i,
    /[$£€]\d[\d,.]*\s+off\b/i,
    /\b(best|top|early|today'?s|daily|weekend) deals?\b/i,
    /\bdeals? of the (day|week)\b/i,
    /\b(prime day|black friday|cyber monday) (deals?|sales?)\b/i,
    /\bgift guide\b/i,
    /\bhow to (watch|stream)\b.*\b(free|online|live ?stream)\b/i,
    /\b(gift|shop) card\b/i,
    /\bsponsored\b/i
];

const COMMERCE_URL_PATTERNS = [
    /\/(coupons?|deals|shopping|sponsored|partner-content)\//i,
    /[-/](coupon|promo-code)s?\b/i
];

export function isCommerce(article) {
    return COMMERCE_TITLE_PATTERNS.some(pattern => pattern.test(article.title))
        || COMMERCE_URL_PATTERNS.some(pattern => pattern.test(article.url));
}

export function isRecent(article, now = Date.now()) {
    const published = new Date(article.publishedAt).getTime();
    return published > now - MAX_AGE_MS;
}

export function isNewsArticle(article) {
    return Boolean(article.title && article.url) && !isCommerce(article) && isRecent(article);
}
