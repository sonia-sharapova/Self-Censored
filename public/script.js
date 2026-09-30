// ==============================================
// NEWS FILTERING PLATFORM - MAIN SCRIPT
// ==============================================
// Articles come from the Self-Censored server (/api/news), which fetches and
// caches every outlet server-side. Filtering happens here, in the browser.

// ==============================================
// GLOBAL STATE VARIABLES
// ==============================================

// The five most-visited outlets in the catalog that are rated credible and have a
// working free feed (Fox News is rated Low; the Washington Post feed is down)
// The default feed, and the ones starred to the sidebar
const DEFAULT_SOURCES = ['wsj', 'pbs', 'npr', 'nature', 'nyt', 'cnn', 'bbc', 'ap'];
const DEFAULT_FAVORITES = ['pbs', 'nyt'];
// One of each kind of keyword: a wildcard at either end, a plain word, an exact match
// The default redactions, which double as examples: a wildcard (*ai: AI,
// OpenAI…), plain words (any case) and an exact match ("ICE", not "ice")
const EXAMPLE_KEYWORDS = ['*AI', 'trump', '"ICE"', 'guilty'];
const DEFAULT_BLOCKED = [...EXAMPLE_KEYWORDS];
const PAGE_SIZE = 12;   // four rows of three

// Source catalog from /api/sources: [{id, name, topics, icon, credible, available}]
let sourceCatalog = [];
let sourcesByName = new Map();
let selectedSources = [...DEFAULT_SOURCES];
// Starred outlets: the only ones listed in the sidebar
let favoriteSources = [];
let currentArticles = [];
// Settings → Keywords to avoid: articles that mention any of these are hidden
let blockedKeywords = [...DEFAULT_BLOCKED];
// Search terms: when any are set, an article must mention at least one
let requiredKeywords = [];
// Articles the user chose to "show anyway" from the hidden list (this session only)
const unhiddenUrls = new Set();
let currentPage = 1;

// Topics. An outlet lists its topics in server/sources.json ("topics") and can
// have several; the feed shows outlets in any selected topic.
// Each topic: a one-line description and an icon (SVG path data, 24px box) for Configure's topic cards
const TOPICS = [
    { id: 'world', name: 'World', description: 'International news, conflicts, diplomacy and global affairs.',
      icon: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>' },
    { id: 'politics', name: 'Politics', description: 'Government, elections, policy and the people behind them.',
      icon: '<path d="M3 21h18M5 21V10M19 21V10M9.5 21V10M14.5 21V10M2 10l10-6 10 6z"/>' },
    { id: 'business', name: 'Business', description: 'Markets, companies, the economy and your money.',
      icon: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>' },
    { id: 'technology', name: 'Technology', description: 'The tech industry, software, security, gadgets and AI.',
      icon: '<rect x="6" y="6" width="12" height="12" rx="1"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>' },
    { id: 'science', name: 'Science', description: 'Research, space, health, climate and the natural world.',
      icon: '<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10"/>' },
    { id: 'culture', name: 'Culture', description: 'Arts, opinion, lifestyle and community discussion.',
      icon: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.9 1.4-1.8-.4-1.2.4-2.2 1.6-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/>' }
];
const TOPIC_IDS = TOPICS.map(topic => topic.id);

// Bias: how strongly an outlet leans, from its MBFC rating (the server maps
// labels to levels; see biasLevel in server/index.js)
const BIAS_LEVELS = [
    { id: 'low', name: 'Low' },
    { id: 'medium', name: 'Medium' },
    { id: 'high', name: 'High' },
    { id: 'unrated', name: 'Unrated' }
];

// Mood: each article's tone, tagged by the server (server/mood.js)
const MOODS = [
    { id: 'doomer', name: 'Doomer' },
    { id: 'neutral', name: 'Neutral' },
    { id: 'hopecore', name: 'Hopecore' }
];

// The three choice filters, each shown in the sidebar (active choices only)
// and as checkboxes in Settings
// Topics are a list of words (pick any number); bias and mood are 3-stop
// sliders (pick one of `steps`, or "all", which is every option, including
// unrated outlets for bias)
const FILTER_GROUPS = {
    topics: { kind: 'words', options: TOPICS, sidebar: 'sidebarTopics', settings: 'settingsTopics', noun: 'topic' },
    biasLevels: { kind: 'stepper', options: BIAS_LEVELS, steps: ['low', 'medium', 'high'], sidebar: 'sidebarBias', settings: 'settingsBias', noun: 'bias level' },
    moods: { kind: 'stepper', options: MOODS, steps: ['doomer', 'neutral', 'hopecore'], sidebar: 'sidebarMood', settings: 'settingsMood', noun: 'mood' }
};
const SIDEBAR_MAX_ACTIVE = 6;
const SIDEBAR_MAX_SOURCES = 5;   // then "See all"

// How far back the feed goes
const TIMEFRAMES = {
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 31 * 24 * 60 * 60 * 1000,
    halfyear: 183 * 24 * 60 * 60 * 1000
};

const DEFAULT_SETTINGS = {
    scanMode: 'all',       // match keywords in 'all' (title, summary, article text) | 'title'
    timeframe: 'week',     // a TIMEFRAMES key
    theme: 'light',       // 'light' | 'dark' | 'system' (follows the OS)
    darkMode: false,      // what's showing now (derived from theme)
    refreshMinutes: 0,     // 0 (off), 15, 30 or 60
    hideInactiveSources: false,   // hide outlets you can't read: no free feed, or paywalled and not subscribed
    subscriptions: [],            // paywalled outlets you pay for (ids)
    topics: ['world', 'politics', 'technology'],       // selected topics (the default three)
    biasLevels: BIAS_LEVELS.map(level => level.id),    // selected bias levels
    moods: MOODS.map(mood => mood.id),                 // selected moods
    useBias: false,        // bias and mood are optional filters, off until switched on
    useMood: false
};
let settings = { ...DEFAULT_SETTINGS };
let autoRefreshInterval = null;
// Settings → Sources: search, filters and view (grid | rows), plus the outlet
// whose detail page is open, if any
// Each filter group holds the values picked; an empty list means "All"
const emptySourceFilters = () => ({ favorite: [], credibility: [], bias: [], topic: [] });
// Two lists share the search + Filters controls, each with its own state:
// "feed" (your sources, in Configure) and "picker" (the Add sources dialog)
const sourceScopes = {
    feed: { query: '', filters: emptySourceFilters(), panel: 'feedFilters', badge: 'feedFiltersCount', toggle: 'feedFiltersToggle' },
    picker: { query: '', filters: emptySourceFilters(), panel: 'sourceFilters', badge: 'sourceFiltersCount', toggle: 'sourceFiltersToggle' },
    selection: { query: '', filters: emptySourceFilters() }
};
let sourceView = loadFromLocalStorage('sourceView', 'grid') === 'rows' ? 'rows' : 'grid';   // grid by default
let detailSourceId = null;
// "Add sources" picker: open or not, and the outlets ticked but not yet added
let pickerOpen = false;
let pendingSources = new Set();   // outlets ticked to add
let pendingRemovals = new Set();  // outlets in the feed, unticked to remove
// Your sources show a few until "Show N more": rows in the table, cards in the grid

// Sources that returned nothing on the last load, shown in the status line
let lastFailedSources = [];

// Incremented on every load so a slow response can't overwrite a newer one
let loadRequestId = 0;

// ==============================================
// API CLIENT
// ==============================================

async function fetchSourceCatalog() {
    const response = await fetch('/api/sources');
    if (!response.ok) throw new Error(`Sources request failed: ${response.status}`);
    return response.json();
}

async function fetchNews(sourceIds) {
    const params = new URLSearchParams({ sources: sourceIds.join(',') });
    const response = await fetch(`/api/news?${params}`);
    if (!response.ok) throw new Error(`News request failed: ${response.status}`);
    return response.json();
}

// Older topic names fold into the current ones
const TOPIC_ALIASES = { tech: 'technology', opinion: 'culture', community: 'culture' };

function normalizeTopics(list) {
    const topics = (Array.isArray(list) ? list : []).map(topic => TOPIC_ALIASES[topic] || topic);
    return TOPIC_IDS.filter(id => topics.includes(id));
}

function setSourceCatalog(catalog) {
    sourceCatalog = catalog.map(source => ({
        ...source,
        topics: normalizeTopics(Array.isArray(source.topics) ? source.topics : [source.category])
    }));
    sourcesByName = new Map(sourceCatalog.map(source => [source.name, source]));
}

// Most popular first (tier 1 household names, 2 well known, 3 niche), then by name
function byPopularity(a, b) {
    return (a.tier || 3) - (b.tier || 3) || a.name.localeCompare(b.name);
}

function sourceById(id) {
    return sourceCatalog.find(s => s.id === id);
}

// Articles carry the outlet's display name, not its id
function articleTopics(article) {
    return sourcesByName.get(article.source)?.topics || [];
}

function articleBiasLevel(article) {
    return sourcesByName.get(article.source)?.biasLevel || 'unrated';
}

// Accepts ids or display names (older exports stored names) and returns known ids
function normalizeSourceIds(list) {
    if (!Array.isArray(list)) return [];
    return list
        .map(value => sourceCatalog.find(s => s.id === value || s.name === value)?.id)
        .filter(Boolean);
}

// ==============================================
// SOURCE LOGOS
// ==============================================

function initials(name) {
    const words = name.replace(/^The\s+/i, '').split(/[\s:]+/).filter(Boolean);
    return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
}

// An outlet's image: its wordmark (assets/logo) or square icon (assets/icon),
// in the order `prefer` asks, falling back to the other, then to its initials.
//   only: never use the other kind (the sidebar shows icons, never wordmarks)
//   keepWide: keep a wide wordmark (shrunk to fit) rather than swap to the icon
function createLogo(source, fallbackName, prefer = 'logo', { only = false, keepWide = false } = {}) {
    const name = source?.name || fallbackName || '?';
    const logo = document.createElement('span');
    logo.title = name;

    const candidates = (prefer === 'icon' ? [['icon', source?.icon], ['logo', source?.logo]] : [['logo', source?.logo], ['icon', source?.icon]])
        .filter(([, url]) => url)
        .filter(([kind]) => !only || kind === prefer);

    const showInitials = () => {
        logo.className = 'logo logo--initials';
        logo.replaceChildren(initials(name));
        logo.setAttribute('role', 'img');
        logo.setAttribute('aria-label', name);
    };

    const show = index => {
        if (index >= candidates.length) {
            showInitials();
            return;
        }
        const [, url] = candidates[index];
        logo.className = 'logo';
        const image = document.createElement('img');
        image.src = url;
        image.alt = name;
        image.addEventListener('error', () => show(index + 1), { once: true });
        logo.replaceChildren(image);
        // Swap in a copy without the file's built-in padding, so every mark is the
        // same height. A wordmark too wide for this spot at that height gives way
        // to the next candidate (the square icon) instead of shrinking.
        trimLogo(url).then(({ src, ratio }) => {
            if (logo.firstChild !== image) return;
            const fit = parseFloat(getComputedStyle(logo).getPropertyValue('--logo-fit')) || 6;
            // A too-wide wordmark gives way to the icon; an icon is always kept (shrunk to fit)
            if (!keepWide && candidates[index][0] === 'logo' && ratio > fit && index + 1 < candidates.length) {
                show(index + 1);
            } else {
                if (src !== url) image.src = src;
                // Icons are sized by area, not height: a wide mark gets shorter and
                // a square one fills the space, so they all look about the same size
                // An outlet without an icon shows its wordmark: let it run wider
                if (prefer === 'icon' && candidates[index][0] === 'logo') showWordmark(logo, image, ratio);
                else if (prefer === 'icon') balanceIcon(logo, image, ratio);
            }
        });
    };

    show(0);
    return logo;
}

// Logo files often sit in a big white or transparent canvas, which makes the
// visible mark small and uneven. Crop that padding off (once per file, in a
// canvas; our own /assets are same-origin). Resolves to { src, ratio }: the
// cropped image as a data URL (or the original) and its width/height ratio.
const trimmedLogos = new Map();

// A wordmark standing in for an icon (e.g. The Washington Post): a short strip,
// up to three slots wide; boxes around it (.logo-box) widen to fit
function showWordmark(logo, image, ratio) {
    if (!ratio || !isFinite(ratio)) return;
    const size = parseFloat(getComputedStyle(logo).getPropertyValue('--logo-size')) || 28;
    const maxWidth = size * 2;   // wide enough to read, leaving room for the name
    const width = Math.min(maxWidth, size * 0.7 * ratio);
    image.style.width = `${width.toFixed(1)}px`;
    image.style.height = `${(width / ratio).toFixed(1)}px`;
    image.style.maxWidth = 'none';
    logo.style.maxWidth = 'none';
    logo.classList.add('logo--wordmark');
    logo.closest('.logo-box')?.classList.add('logo-box--wide');
}

// Size a (trimmed) icon so its area matches a square of the slot's height:
// width × height = size², capped by the slot's width
function balanceIcon(logo, image, ratio) {
    if (!ratio || !isFinite(ratio)) return;
    const size = parseFloat(getComputedStyle(logo).getPropertyValue('--logo-size')) || 28;
    const fit = parseFloat(getComputedStyle(logo).getPropertyValue('--logo-fit')) || 6;
    let height = ratio >= 1 ? size / Math.sqrt(ratio) : size;          // tall marks keep full height
    let width = height * ratio;
    const maxWidth = size * fit;
    if (width > maxWidth) {
        width = maxWidth;
        height = width / ratio;
    }
    image.style.width = `${width.toFixed(1)}px`;
    image.style.height = `${height.toFixed(1)}px`;
    image.style.maxWidth = 'none';
    logo.classList.add('logo--balanced');
}

function trimLogo(url) {
    if (!trimmedLogos.has(url)) {
        trimmedLogos.set(url, new Promise(resolve => {
            const source = new Image();
            source.onerror = () => resolve({ src: url, ratio: 1 });
            source.onload = () => {
                const ratio = (source.naturalWidth || 300) / (source.naturalHeight || 150);
                try {
                    resolve(cropPadding(source) || { src: url, ratio });
                } catch {
                    resolve({ src: url, ratio });   // e.g. a tainted canvas: keep the original
                }
            };
            source.src = url;
        }));
    }
    return trimmedLogos.get(url);
}

function cropPadding(image) {
    // Draw large enough to stay sharp at 2x, small enough to scan quickly
    const naturalWidth = image.naturalWidth || 300;
    const naturalHeight = image.naturalHeight || 150;
    const scale = 600 / Math.max(naturalWidth, naturalHeight);
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);

    // Padding is transparent or near-white; coloured backgrounds are part of the logo
    const isPadding = offset => data[offset + 3] < 16
        || (data[offset] > 235 && data[offset + 1] > 235 && data[offset + 2] > 235);

    let top = height, left = width, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!isPadding((y * width + x) * 4)) {
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
            }
        }
    }
    if (right < 0) return null;                       // blank image
    const cropWidth = right - left + 1;
    const cropHeight = bottom - top + 1;
    if (cropWidth > width * 0.97 && cropHeight > height * 0.97) return null;   // nothing to trim

    const cropped = document.createElement('canvas');
    cropped.width = cropWidth;
    cropped.height = cropHeight;
    cropped.getContext('2d').drawImage(canvas, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    return { src: cropped.toDataURL('image/png'), ratio: cropWidth / cropHeight };
}

// ==============================================
// DATES
// ==============================================

function newestFirst(articles) {
    return [...articles].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

function withinTimeframe(article, now = Date.now()) {
    return new Date(article.publishedAt).getTime() > now - (TIMEFRAMES[settings.timeframe] || TIMEFRAMES.week);
}

// "5m ago" / "3h ago" for today's news, otherwise "Sep 28, 4:05 PM"
function formatPublished(publishedAt) {
    const published = new Date(publishedAt);
    const minutes = Math.round((Date.now() - published) / 60000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ago`;

    return published.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

// ==============================================
// STORAGE UTILITIES
// ==============================================

// Saving in this browser is off until allowed (the storage notice, or Settings →
// Advanced settings → Your data). Reading is always fine.
const STORAGE_KEYS = ['settings', 'selectedSources', 'favoriteSources', 'blockedKeywords', 'requiredKeywords', 'sourceView', 'defaults', 'sidebarFolded'];

// Settings are saved in this browser by default (no account, no cookies, never
// sent anywhere); 'denied' turns that off. The first time you change something
// a small note says so, with the option to switch it off.
function storageChoice() {
    try {
        return localStorage.getItem('storageConsent');   // 'granted' | 'denied' | null (never chosen)
    } catch {
        return null;
    }
}

function storageConsent() {
    return storageChoice() === 'denied' ? 'denied' : 'granted';
}

// The storage notice appears only once you've changed your configuration, and
// only until you choose (following one of its links hides it for this visit)
let appReady = false;
let configChanged = false;
let consentNoticeDismissed = false;

function saveToLocalStorage(key, data) {
    if (appReady && !configChanged) {
        configChanged = true;
        renderStorageConsent();
    }
    const consent = storageConsent();
    // Not decided yet: keep it for this tab only (survives a reload, gone when the tab closes)
    if (consent === null) {
        try {
            sessionStorage.setItem(key, JSON.stringify(data));
        } catch {
            // storage blocked: nothing to keep
        }
        return;
    }
    if (consent !== 'granted') return;
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
        console.warn('Could not save to localStorage:', error);
    }
}

// Allow or stop saving. Allowing saves everything now; stopping removes what's saved.
function setStorageConsent(allowed, fromNotice = false) {
    try {
        localStorage.setItem('storageConsent', allowed ? 'granted' : 'denied');
        if (!allowed) STORAGE_KEYS.forEach(key => localStorage.removeItem(key));
        STORAGE_KEYS.forEach(key => sessionStorage.removeItem(key));
    } catch {
        // storage blocked entirely: nothing to save or remove
    }
    if (allowed) {
        saveKeywords();
        saveSettings();
        saveToLocalStorage('selectedSources', selectedSources);
        saveToLocalStorage('favoriteSources', favoriteSources);
        saveToLocalStorage('sourceView', sourceView);
        saveToLocalStorage('defaults', userDefaults);
    }
    renderStorageConsent();
    if (fromNotice) showSuccess(allowed ? 'Your settings will be saved on this device ✧' : 'Nothing will be saved. Export your configuration to keep it.');
}

// A link in the notice: go to Settings → Your data, and hide the notice for now
function consentGoTo(event) {
    event.preventDefault();
    consentNoticeDismissed = true;
    renderStorageConsent();
    openSettings('data');
}

function renderStorageConsent() {
    const consent = storageConsent();
    const show = storageChoice() === null && configChanged && !consentNoticeDismissed;
    const notice = document.getElementById('storageConsent');
    if (notice) notice.hidden = !show;
    const toggle = document.getElementById('storageConsentSwitch');
    if (toggle) toggle.checked = consent === 'granted';
    const status = document.getElementById('storageStatus');
    if (status) status.textContent = consent === 'granted' ? 'On (the default): kept in this browser only, nothing leaves your device'
        : 'Off: your setup resets when you close the tab (export it to keep it)';
}

function loadFromLocalStorage(key, defaultValue = null) {
    try {
        const data = storageConsent() === null ? (sessionStorage.getItem(key) ?? localStorage.getItem(key)) : localStorage.getItem(key);
        return data ? JSON.parse(data) : defaultValue;
    } catch (error) {
        console.warn('Could not load from localStorage:', error);
        return defaultValue;
    }
}

function saveSettings() {
    saveToLocalStorage('settings', settings);
}

// ==============================================
// INITIALIZATION
// ==============================================

async function initializeApp() {
    renderStorageConsent();
    applySidebarFolds();
    blockedKeywords = loadFromLocalStorage('blockedKeywords', userDefaults.blockedKeywords).map(normalizeKeyword).filter(Boolean);
    requiredKeywords = loadFromLocalStorage('requiredKeywords', []).map(normalizeKeyword).filter(Boolean);
    settings = migrateSettings({ ...DEFAULT_SETTINGS, ...loadFromLocalStorage('settings', {}) });

    applySettings();
    updateKeywordsList();
    renderFilters();

    try {
        setSourceCatalog(await fetchSourceCatalog());
    } catch (error) {
        console.error('Failed to load source list:', error);
        showError('Could not reach the Self-Censored server. Please try again in a moment.');
        return;
    }

    userDefaults = normalizeDefaults(userDefaults);
    const savedSources = loadFromLocalStorage('selectedSources', null);
    selectedSources = savedSources === null ? [...userDefaults.selectedSources] : normalizeSourceIds(savedSources);

    // First visit after favourites arrived: start with what's already selected
    const savedFavorites = loadFromLocalStorage('favoriteSources', null);
    favoriteSources = savedFavorites === null ? normalizeSourceIds(DEFAULT_FAVORITES) : normalizeSourceIds(savedFavorites);
    if (savedFavorites === null) saveToLocalStorage('favoriteSources', favoriteSources);

    renderSources();
    renderFilters();   // again, now that bias hover text can list outlets
    if (settingsOpen()) showSettingsPage();
    else document.getElementById('navNewsroom')?.setAttribute('aria-current', 'page');
    appReady = true;   // from here on, a save means you changed something
    loadNews();
}

// Brings older saved settings up to date
function migrateSettings(saved) {
    const migrated = { ...saved };

    // Sorting and page size were removed; the feed is always newest first, 15 a page
    ['shuffleArticles', 'sortOrder', 'articlesPerPage', 'category', 'feedTopic'].forEach(key => delete migrated[key]);

    // The auto-refresh checkbox (every 30 minutes) became an interval
    if ('autoRefresh' in migrated) {
        if (!('refreshMinutes' in saved)) migrated.refreshMinutes = migrated.autoRefresh ? 30 : 0;
        delete migrated.autoRefresh;
    }
    migrated.refreshMinutes = [0, 15, 30, 60].includes(Number(migrated.refreshMinutes)) ? Number(migrated.refreshMinutes) : 0;

    // "Also scan article text" became a scan mode
    if ('scanFullText' in migrated) {
        if (!('scanMode' in saved) && migrated.scanFullText === false) migrated.scanMode = 'title';
        delete migrated.scanFullText;
    }
    if (!['all', 'title'].includes(migrated.scanMode)) migrated.scanMode = DEFAULT_SETTINGS.scanMode;
    if (!(migrated.timeframe in TIMEFRAMES)) migrated.timeframe = DEFAULT_SETTINGS.timeframe;

    // Feed tabs became the selected topics
    if ('feedTabs' in migrated) {
        if (!('topics' in saved)) migrated.topics = migrated.feedTabs;
        delete migrated.feedTabs;
    }
    migrated.topics = normalizeTopics(migrated.topics);
    // The light/dark radio became a theme choice that can also follow the system
    if (!['light', 'dark', 'system'].includes(migrated.theme)) migrated.theme = migrated.darkMode ? 'dark' : 'light';
    migrated.subscriptions = Array.isArray(migrated.subscriptions) ? migrated.subscriptions.filter(id => typeof id === 'string') : [];
    migrated.useBias = migrated.useBias === true;
    migrated.useMood = migrated.useMood === true;

    // Sliders hold one step or "all"; anything else (an older multi-pick) becomes "all"
    ['biasLevels', 'moods'].forEach(key => {
        const group = FILTER_GROUPS[key];
        const saved = Array.isArray(migrated[key]) ? migrated[key] : [];
        migrated[key] = saved.length === 1 && group.steps.includes(saved[0]) ? saved : group.options.map(option => option.id);
    });

    return migrated;
}

function applySettings() {
    applyTheme();
    setSelect('scanMode', settings.scanMode);
    setSelect('timeframe', settings.timeframe);
    setSelect('refreshMinutes', settings.refreshMinutes);
    const useBias = document.getElementById('useBias');
    if (useBias) useBias.checked = settings.useBias;
    const useMood = document.getElementById('useMood');
    if (useMood) useMood.checked = settings.useMood;
    startAutoRefresh();

    const hideInactiveCheckbox = document.getElementById('hideInactiveSources');
    if (hideInactiveCheckbox) hideInactiveCheckbox.checked = settings.hideInactiveSources;
}

function setSelect(id, value) {
    const select = document.getElementById(id);
    if (select) select.value = String(value);
}

function setRadio(name, value) {
    const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (radio) radio.checked = true;
}

// ==============================================
// FILTER GROUPS: topics, bias, mood
// ==============================================
// Topics: the sidebar lists the active ones as "× topic" (two per row, up to
// SIDEBAR_MAX_ACTIVE) with "+ add more" for the rest; Settings has checkboxes.
// Bias and mood: a 3-stop slider in both places, plus an "all" link.

function renderFilters() {
    Object.keys(FILTER_GROUPS).forEach(renderFilterGroup);
    renderDefaults();
    renderSidebarKeywords();

    // Bias and mood in the sidebar: open while switched on (or opened with +)
    [['biasLevels', 'useBias', 'sidebarBias'], ['moods', 'useMood', 'sidebarMood']]
        .forEach(([key, flag, slot]) => {
            const open = settings[flag];
            document.getElementById(`${slot}Body`)?.classList.toggle('is-open', open);
            const sidebarSwitch = document.getElementById(`${slot}Switch`);
            if (sidebarSwitch) sidebarSwitch.checked = open;
            const toggle = document.getElementById(flag);
            if (toggle) toggle.checked = settings[flag];
        });

}

// Sidebar sections fold: click a heading to close or open its list (remembered
// when saving is on), so the sidebar never has to scroll
let sidebarFolded = new Set(loadFromLocalStorage('sidebarFolded', ['topics', 'sources', 'avoid']));   // every section starts closed

function toggleSidebarSection(key) {
    const open = sidebarFolded.has(key) || autoFolded.has(key);
    autoFolded.delete(key);
    if (open) {
        sidebarFolded.delete(key);
        lastOpened = key;           // the section in use: never folded to make room
        // Opening it would overflow: close the other sections at the same moment
        // (they swap in one motion); if everything fits, the others stay open
        const sidebar = document.querySelector('.sidebar');
        if (sidebar && getComputedStyle(sidebar).position === 'sticky') {
            let overflow = sidebar.scrollHeight - sidebar.clientHeight + foldHeight(key);
            for (const other of AUTO_FOLD_ORDER) {
                if (overflow <= 0) break;
                if (other === key || sidebarFolded.has(other) || autoFolded.has(other)) continue;
                overflow -= foldHeight(other);
                autoFolded.add(other);
            }
        }
    } else {
        sidebarFolded.add(key);
        if (lastOpened === key) lastOpened = null;
    }
    saveToLocalStorage('sidebarFolded', [...sidebarFolded]);
    applySidebarFolds();
    setTimeout(fitSidebarFavorites, 320);
}

function applySidebarFolds() {
    ['topics', 'sources', 'avoid'].forEach(key => {
        const open = !sidebarFolded.has(key) && !autoFolded.has(key);
        document.getElementById(`${key}Fold`)?.classList.toggle('is-open', open);
        document.getElementById(`${key}Fold`)?.closest('.sidebar-fold')?.classList.toggle('is-open', open);
        document.getElementById(`${key}Label`)?.setAttribute('aria-expanded', String(open));
    });
}

// Sidebar switch for bias / mood: on opens the slider (at the middle level if
// none was picked); off switches the filter off and closes it
function setSidebarMetric(key, on) {
    const flag = key === 'biasLevels' ? 'useBias' : 'useMood';
    if (!on) {
        setAllOptions(key, true);
    } else {
        settings[flag] = true;
        if (settings[key].length !== 1) settings[key] = [FILTER_GROUPS[key].steps[0]];
        filtersChanged();
    }
    setTimeout(fitSidebarFavorites, 320);
}

// Sidebar: + opens the slider (picking a level switches the filter on); − or
// "all" switches it off and closes it
const sidebarMetricOpen = { biasLevels: false, moods: false };

function toggleSidebarMetric(key) {
    const flag = key === 'biasLevels' ? 'useBias' : 'useMood';
    const open = settings[flag] || sidebarMetricOpen[key];
    if (open) {
        setAllOptions(key, true);   // off, and closed below
    } else {
        sidebarMetricOpen[key] = true;
        renderFilters();
    }
    // The slider changes the sidebar's height once the animation ends
    setTimeout(fitSidebarFavorites, 300);
}

// Switching bias / mood on starts the slider at its first (left) level
function setMetricEnabled(key, enabled) {
    settings[key === 'biasLevels' ? 'useBias' : 'useMood'] = enabled;
    if (enabled && settings[key].length !== 1) settings[key] = [FILTER_GROUPS[key].steps[0]];
    filtersChanged();
}

// "× name": clicking the name opens its place in Settings, the × removes it
// Sidebar topics and sources: a stacked row (name, then a trash can that shows on hover)
function createRowItem(content, { onOpen, onRemove, openLabel, removeLabel }) {
    const item = document.createElement('li');
    item.className = 'row-item';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'row-item__name';
    open.title = openLabel;
    open.append(content);
    open.addEventListener('click', onOpen);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'row-item__trash';
    remove.title = removeLabel;
    remove.setAttribute('aria-label', removeLabel);
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
    remove.addEventListener('click', event => {
        event.stopPropagation();
        onRemove();
    });
    item.append(open, remove);
    return item;
}

// "+" under a sidebar list, on the right
function createRowAdd(label, onClick) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'row-list__add';
    add.textContent = '+';
    add.title = label;
    add.setAttribute('aria-label', label);
    add.addEventListener('click', onClick);
    return add;
}

function createPickItem(name, { onOpen, onRemove, openLabel, removeLabel, muted = false }) {
    const item = document.createElement('li');
    item.className = muted ? 'pick-list__item pick-list__item--muted' : 'pick-list__item';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'pick-list__remove';
    remove.setAttribute('aria-label', removeLabel);
    remove.title = removeLabel;
    remove.innerHTML = '<span class="pick-list__bullet" aria-hidden="true">•</span><span class="pick-list__x" aria-hidden="true">×</span>';
    remove.addEventListener('click', event => {
        event.stopPropagation();
        onRemove();
    });

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'pick-list__name';
    open.title = openLabel;
    open.append(name);
    open.addEventListener('click', onOpen);

    item.append(remove, open);
    return item;
}

function renderFilterGroup(key) {
    const group = FILTER_GROUPS[key];
    if (group.kind === 'stepper') {
        // Sidebar: the 3-stop slider; Settings: the slider, centred, with "Any" beside it
        const sidebarSlot = document.getElementById(group.sidebar);
        if (sidebarSlot) sidebarSlot.replaceChildren(createStepper(key));
        const settingsSlot = document.getElementById(group.settings);
        if (settingsSlot) settingsSlot.replaceChildren(createSpectrum(key));
        return;
    }

    const selected = settings[key];
    if (key === 'topics') {
        const count = document.getElementById('topicsCount');
        if (count) count.textContent = `${selected.length} topic${selected.length === 1 ? '' : 's'}`;
    }
    const sidebar = document.getElementById(group.sidebar);
    if (sidebar) {
        sidebar.innerHTML = '';
        const active = group.options.filter(option => selected.includes(option.id));
        const inactive = group.options.filter(option => !selected.includes(option.id));

        const list = document.createElement('ul');
        list.className = 'row-list';
        active.slice(0, SIDEBAR_MAX_ACTIVE).forEach(option => {
            list.appendChild(createRowItem(option.name, {
                onOpen: () => openSettings('topics'),
                onRemove: () => toggleOption(key, option.id),
                openLabel: 'Open topics in Settings',
                removeLabel: `Remove ${option.name}`
            }));
        });
        if (active.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'sidebar__empty';
            empty.textContent = `no ${group.noun} selected`;
            list.appendChild(empty);
        }
        sidebar.appendChild(list);

        if (active.length > SIDEBAR_MAX_ACTIVE) {
            const more = document.createElement('span');
            more.className = 'sidebar__more';
            more.textContent = `+${active.length - SIDEBAR_MAX_ACTIVE} more`;
            sidebar.appendChild(more);
        }
    }

    // Settings: a tile per topic (icon and name; the description is its hover
    // text); a selected tile is framed and ticked
    const settingsList = document.getElementById(group.settings);
    if (settingsList) {
        settingsList.innerHTML = '';
        group.options.forEach(option => {
            const on = selected.includes(option.id);
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'topic-card';
            card.setAttribute('aria-pressed', String(on));
            card.addEventListener('click', () => toggleOption(key, option.id));

            const icon = document.createElement('span');
            icon.className = 'topic-card__icon';
            icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${option.icon || ''}</svg>`;
            card.title = option.description || '';
            const name = document.createElement('span');
            name.className = 'topic-card__name';
            name.textContent = option.name;
            card.append(icon, name);
            settingsList.appendChild(card);
        });
    }
}

// Sidebar Redacted: your keywords as equal-width tags (× shows on hover; the
// word opens Keywords in Settings), then "+" at the bottom right
function renderSidebarKeywords() {
    const container = document.getElementById('sidebarAvoid');
    if (!container) return;
    const section = document.getElementById('sidebarAvoidSection');
    if (section) section.hidden = blockedKeywords.length === 0;

    const list = document.createElement('ul');
    list.className = 'tag-list';
    blockedKeywords.slice(0, SIDEBAR_MAX_ACTIVE).forEach(keyword => {
        const item = document.createElement('li');
        item.className = 'tag-list__item';
        const word = document.createElement('button');
        word.type = 'button';
        word.className = 'tag-list__word';
        word.textContent = keyword;
        word.title = 'Open keywords in Settings';
        word.addEventListener('click', () => openSettings('keywords'));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'tag-list__remove';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Stop redacting "${keyword}"`);
        remove.title = remove.getAttribute('aria-label');
        remove.addEventListener('click', event => {
            event.stopPropagation();
            removeKeyword(keyword, 'blocked');
        });
        item.append(word, remove);
        list.appendChild(item);
    });

    const count = document.getElementById('keywordsCount');
    if (count) {
        count.textContent = `${blockedKeywords.length} keyword${blockedKeywords.length === 1 ? '' : 's'}`;
        count.title = 'Keywords in Settings';
    }

    container.replaceChildren(list);
}

function clearBlockedKeywords() {
    blockedKeywords = [];
    keywordsChanged();
}

// A 3-stop slider (native range input) with the stop names underneath. With
// "all" selected it shows no position until you pick a stop.
function createStepper(key) {
    const group = FILTER_GROUPS[key];
    const current = settings[key].length === 1 ? group.steps.indexOf(settings[key][0]) : -1;
    const names = group.steps.map(id => group.options.find(option => option.id === id).name);

    const stepper = document.createElement('div');
    stepper.className = current < 0 ? 'stepper stepper--all' : 'stepper';

    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'stepper__range';
    range.min = '0';
    range.max = String(group.steps.length - 1);
    range.step = '1';
    range.value = String(current < 0 ? 1 : current);
    range.setAttribute('aria-label', `${group.noun}: ${current < 0 ? 'all' : names[current]}`);
    range.setAttribute('aria-valuetext', current < 0 ? 'all' : names[current]);
    range.addEventListener('input', () => setStep(key, Number(range.value)));
    // Clicking the thumb while on "all" picks the step it sits on
    range.addEventListener('pointerup', () => {
        if (stepper.classList.contains('stepper--all')) setStep(key, Number(range.value));
    });

    const labels = document.createElement('div');
    labels.className = 'stepper__labels';
    names.forEach((name, index) => {
        const label = document.createElement('button');
        label.type = 'button';
        label.textContent = name;
        label.title = filterHint(key, group.options.find(option => option.id === group.steps[index]));
        label.setAttribute('aria-pressed', index === current);
        label.addEventListener('click', () => setStep(key, index));
        labels.appendChild(label);
    });

    stepper.append(range, labels);
    return stepper;
}

// Settings' bias / mood control: the spectrum slider, centred. The switch
// beside the heading turns it on and off; on, the slider is thicker.
function createSpectrum(key) {
    const flag = key === 'biasLevels' ? 'useBias' : 'useMood';
    const wrap = document.createElement('div');
    wrap.className = settings[flag] ? 'spectrum spectrum--on' : 'spectrum';
    const stepper = createStepper(key);
    stepper.classList.add('stepper--large');
    if (!settings[flag]) stepper.classList.add('stepper--all');
    wrap.appendChild(stepper);
    return wrap;
}

function setStep(key, index) {
    settings[key] = [FILTER_GROUPS[key].steps[index]];
    // Picking a level on bias or mood switches that filter on
    if (key === 'biasLevels') settings.useBias = true;
    if (key === 'moods') settings.useMood = true;
    filtersChanged();
}

// Hover text: which outlets a bias level covers
function filterHint(key, option) {
    if (key !== 'biasLevels' || sourceCatalog.length === 0) return '';
    const names = sourceCatalog.filter(source => source.biasLevel === option.id).map(source => source.name);
    return names.length ? `${names.join(', ')}. ` : '';
}

// "+ add more": a small menu of the choices that aren't active
function createAddMore(key, inactive) {
    const wrap = document.createElement('div');
    wrap.className = 'sidebar__add';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'link-btn sidebar__more';
    toggle.textContent = '+ add more';
    toggle.setAttribute('aria-haspopup', 'menu');
    toggle.setAttribute('aria-expanded', 'false');

    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    inactive.forEach(option => {
        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.textContent = option.name;
        item.title = filterHint(key, option);
        item.addEventListener('click', () => toggleOption(key, option.id));
        menu.appendChild(item);
    });

    toggle.addEventListener('click', event => {
        event.stopPropagation();
        const opening = menu.hidden;
        closeMenus();
        menu.hidden = !opening;
        toggle.setAttribute('aria-expanded', String(opening));
        if (opening) menu.querySelector('button')?.focus();
    });

    wrap.append(toggle, menu);
    return wrap;
}

function closeMenus() {
    document.querySelectorAll('.menu').forEach(menu => { menu.hidden = true; });
    document.querySelectorAll('[aria-haspopup="menu"]').forEach(toggle => toggle.setAttribute('aria-expanded', 'false'));
}

function filtersChanged() {
    saveSettings();
    renderViewFilters();
    renderFilters();
    renderSettingsSources();
    fitSidebarFavorites();
    currentPage = 1;
    renderNews();
}

function toggleOption(key, id) {
    const ids = FILTER_GROUPS[key].options.map(option => option.id);
    const selected = settings[key].includes(id);
    settings[key] = ids.filter(other => (other === id ? !selected : settings[key].includes(other)));
    filtersChanged();
}

// "select all" / "clear" (topics) and "all" (bias, mood)
function setAllOptions(key, selected) {
    settings[key] = selected ? FILTER_GROUPS[key].options.map(option => option.id) : [];
    // "Any" on bias or mood is the same as the filter being off
    if (selected && key === 'biasLevels') settings.useBias = false;
    if (selected && key === 'moods') settings.useMood = false;
    if (selected && key in sidebarMetricOpen) sidebarMetricOpen[key] = false;
    filtersChanged();
}

// ==============================================
// SOURCES: sidebar summary + settings table
// ==============================================

function renderSources() {
    renderSidebarSources();
    renderSettingsSources();
    renderDefaults();
}

// Sidebar sources: what's in the feed, pinned (★) first then by popularity, the
// first SIDEBAR_MAX_SOURCES as rows (the name opens the outlet's page; a trash
// can shows on hover; remove one and the next moves up). The heading shows
// the count while folded and "+" (to Settings) while open.
function renderSidebarSources() {
    const list = document.getElementById('sidebarSources');
    const count = document.getElementById('sourcesCount');
    if (!list) return;

    const inFeed = selectedSources.map(sourceById).filter(source => source && source.available)
        .sort((a, b) => isPinned(b) - isPinned(a) || byPopularity(a, b));
    if (count) count.textContent = `${inFeed.length} source${inFeed.length === 1 ? '' : 's'}`;

    list.className = 'row-list sidebar-sources';
    list.innerHTML = '';
    if (inFeed.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'sidebar__empty';
        empty.textContent = 'no sources selected';
        list.appendChild(empty);
    }

    inFeed.slice(0, SIDEBAR_MAX_SOURCES).forEach(source => {
        const name = document.createElement('span');
        name.className = 'row-item__source';
        const star = document.createElement('span');
        star.className = 'row-item__pin';
        star.textContent = isPinned(source) ? '★' : '';
        if (isPinned(source)) star.setAttribute('aria-label', 'pinned');
        const label = document.createElement('span');
        label.className = 'row-item__label';
        label.textContent = source.name;
        name.append(star, createLogo(source, null, 'icon', { only: true }), label);
        list.appendChild(createRowItem(name, {
            onOpen: () => openSettings(`source:${source.id}`),
            onRemove: () => toggleSource(source.id, false),
            openLabel: `${source.name}: open its page in Settings`,
            removeLabel: `Take ${source.name} out of the feed`
        }));
    });

    // "See all": a last row that opens Settings → Sources, on Your sources
    if (inFeed.length > 0) {
        const seeAll = document.createElement('li');
        seeAll.className = 'row-item row-item--see-all';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'row-item__name';
        // Lines up with the icons above (after the ★ column)
        button.innerHTML = '<span class="row-item__source"><span class="row-item__pin"></span><span class="row-item__label">See all</span></span>';
        button.addEventListener('click', () => {
            openSettings('sources');
            if (pickerOpen) closeSourcePicker();
        });
        seeAll.appendChild(button);
        list.appendChild(seeAll);
    }

    fitSidebarFavorites();
}

// The sidebar never scrolls. If it's too tall, sections fold themselves
// (Redacted first, then Topics; never one you opened yourself), then the
// description goes; scrolling is the last resort.
// With room to spare, sections folded this way open again.
const autoFolded = new Set();
let lastOpened = null;                                   // the section you opened most recently
const AUTO_FOLD_ORDER = ['avoid', 'topics', 'sources'];  // folded in this order when out of room

function foldHeight(key) {
    const inner = document.getElementById(`${key}Fold`)?.firstElementChild;
    return inner ? inner.scrollHeight : 0;
}

function fitSidebarFavorites() {
    const sidebar = document.querySelector('.sidebar');
    const list = document.getElementById('sidebarSources');
    // Only the sticky desktop sidebar has a fixed height (on phones it stacks)
    if (!sidebar || !list || getComputedStyle(sidebar).position !== 'sticky') return;
    sidebar.classList.remove('sidebar--scroll');

    const items = [...list.querySelectorAll('li:not(.sidebar-sources__all)')];
    items.forEach(item => { item.hidden = false; });
    const about = sidebar.querySelector('.sidebar__about');
    if (about) about.hidden = false;

    // Out of room: fold open sections you're not using (never the one you just
    // opened) until everything fits. With room again, reopen what was folded.
    let overflow = sidebar.scrollHeight - sidebar.clientHeight;
    if (overflow > 0) {
        for (const key of AUTO_FOLD_ORDER) {
            if (overflow <= 0) break;
            if (key === lastOpened || sidebarFolded.has(key) || autoFolded.has(key)) continue;
            overflow -= foldHeight(key);
            autoFolded.add(key);
        }
    } else {
        for (const key of [...AUTO_FOLD_ORDER].reverse()) {
            if (!autoFolded.has(key)) continue;
            if (foldHeight(key) > -overflow) break;
            autoFolded.delete(key);
            overflow += foldHeight(key);
        }
    }
    applySidebarFolds();
    if (overflow <= 0) return;

    // Still too tall (the open section alone doesn't fit): drop source rows
    // from the end ("See all" stays), then the description, and only then scroll
    const settle = () => sidebar.scrollHeight - sidebar.clientHeight - foldPending();
    const rows = items.filter(item => !item.classList.contains('row-item--see-all'));
    for (let i = rows.length - 1; i > 0 && settle() > 0; i--) rows[i].hidden = true;
    if (about && settle() > 0) about.hidden = true;
    if (settle() > 0) sidebar.classList.add('sidebar--scroll');
}

// Height still to disappear from sections that are mid-fold
function foldPending() {
    return [...autoFolded].reduce((sum, key) => {
        const fold = document.getElementById(`${key}Fold`);
        const shown = fold ? fold.getBoundingClientRect().height : 0;
        return sum + shown;
    }, 0);
}

// ==============================================
// SETTINGS → SOURCES: grid / rows, search, filters, detail page
// ==============================================
// Laid out like the FortifyAI agents page: a search box, a Filters popover of
// single-choice chip groups, and a grid/rows toggle. Clicking an outlet (not its
// checkbox or star) opens its detail page inside the modal.

// Credibility status from MBFC: High = green check, Medium = yellow, Low = red.
// Where MBFC shows no credibility line, its factual rating stands in.
function credibilityLevel(source) {
    const level = source.credibility
        || ({ 'Very High': 'High', High: 'High', 'Mostly Factual': 'Medium', Mixed: 'Medium', Low: 'Low' })[source.factual];
    return level ? level.toLowerCase() : 'unrated';
}

const CREDIBILITY_BADGES = {
    high: { icon: '✓', label: 'Reliable' },
    medium: { icon: '!', label: 'Shaky' },
    low: { icon: '✕', label: 'Poor' },
    unrated: { icon: '–', label: 'Not rated' }
};

// compact: just the coloured icon (the label moves to the hover text)
function createCredibilityBadge(source, { compact = false } = {}) {
    const level = credibilityLevel(source);
    const badge = document.createElement('span');
    // An icon and a word in the status colour (no pill); compact: the icon alone
    badge.className = `cred-status cred-status--${level} ${compact ? 'cred-status--compact' : 'cred-status--text'}`;
    badge.title = source.factual ? `MBFC factual reporting: ${source.factual}` : 'Media Bias/Fact Check has not rated this outlet';
    if (compact) {
        badge.title = `Credibility: ${CREDIBILITY_BADGES[level].label}. ${badge.title}`;
        badge.setAttribute('role', 'img');
        badge.setAttribute('aria-label', CREDIBILITY_BADGES[level].label);
    }
    const icon = document.createElement('span');
    icon.className = 'cred-status__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = CREDIBILITY_BADGES[level].icon;
    badge.append(icon);
    if (!compact) badge.append(CREDIBILITY_BADGES[level].label);
    return badge;
}

// Bias in lists: just the level; High is red. The MBFC label is on the detail page.
// compact: just the gauge, coloured by level
function createBiasLevel(source, { compact = false } = {}) {
    const level = document.createElement('span');
    level.className = `bias-level bias-level--${source.biasLevel}`;
    // A 3-bar gauge (1 bar = low, 3 = high), then the word
    const filled = { low: 1, medium: 2, high: 3 }[source.biasLevel] || 0;
    const gauge = document.createElement('span');
    gauge.className = 'bias-gauge';
    gauge.setAttribute('aria-hidden', 'true');
    for (let bar = 1; bar <= 3; bar++) {
        const segment = document.createElement('i');
        if (bar <= filled) segment.className = 'is-on';
        gauge.appendChild(segment);
    }
    const words = source.biasLevel === 'unrated' ? 'Bias unrated' : `${source.biasLevel[0].toUpperCase()}${source.biasLevel.slice(1)} bias`;
    if (compact) {
        level.classList.add('bias-level--compact');
        level.title = `${words}${source.bias ? ` (MBFC: ${source.bias})` : ''}`;
        level.setAttribute('role', 'img');
        level.setAttribute('aria-label', words);
        level.append(gauge);
        return level;
    }
    level.append(gauge, source.biasLevel === 'unrated' ? 'Unrated' : words);
    level.title = source.bias ? `MBFC: ${source.bias}` : 'No MBFC bias rating';
    return level;
}

// Kept for the detail page: the MBFC label, e.g. "Left-Center"
function createBiasBadge(source) {
    const badge = document.createElement('span');
    badge.className = `bias-badge bias-badge--${source.biasLevel}`;
    badge.textContent = source.bias || 'Unrated';
    return badge;
}

function topicNames(source) {
    return source.topics.map(id => TOPICS.find(topic => topic.id === id)?.name).filter(Boolean);
}

// The Filters popover: groups of chips (pick any number) with an "All" checkbox
const SOURCE_FILTER_GROUPS = [
    { key: 'topic', label: 'Topic', options: TOPICS.map(topic => [topic.id, topic.name]) },
    { key: 'favorite', label: 'Favourite', options: [['starred', '★ Starred']] },
    { key: 'credibility', label: 'Credibility', options: [['high', 'Reliable'], ['medium', 'Shaky'], ['low', 'Poor'], ['unrated', 'Not rated']] },
    { key: 'bias', label: 'Bias', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['unrated', 'Unrated']] }
];

// You can read an outlet if it has a free feed and, if paywalled, you subscribe
function canRead(source) {
    return source.available && (!source.paywall || settings.subscriptions.includes(source.id));
}

// Settings → Advanced → "Sources you have access to": a tag per paywalled
// outlet; ticked ones are yours
function renderSubscriptions() {
    const list = document.getElementById('subscriptionTags');
    if (!list) return;
    const paywalled = sourceCatalog.filter(source => source.paywall).sort((a, b) => a.name.localeCompare(b.name));
    list.replaceChildren(...paywalled.map(source => {
        const on = settings.subscriptions.includes(source.id);
        const tag = document.createElement('button');
        tag.type = 'button';
        tag.className = 'sub-tag';
        tag.setAttribute('aria-pressed', String(on));
        tag.append(createLogo(source, null, 'icon', { only: true }), source.name);
        tag.addEventListener('click', () => {
            settings.subscriptions = on ? settings.subscriptions.filter(id => id !== source.id) : [...settings.subscriptions, source.id];
            saveSettings();
            renderSubscriptions();
            renderSettingsSources();
            renderNews();
        });
        return tag;
    }));
}

// Outlets matching a scope's search box and filters
function filteredSources(scope = 'picker') {
    const { query: raw, filters: f } = sourceScopes[scope];
    const query = raw.trim().toLowerCase();
    const allows = (list, value) => list.length === 0 || list.includes(value);
    return sourceCatalog
        .filter(source => !settings.hideInactiveSources || canRead(source))
        .filter(source => !query || [source.name, source.owner, source.country, ...(source.aliases || []), ...topicNames(source)]
            .some(text => text && text.toLowerCase().includes(query)))
        .filter(source => f.favorite.length === 0 || favoriteSources.includes(source.id))
        .filter(source => allows(f.credibility, credibilityLevel(source)))
        .filter(source => allows(f.bias, source.biasLevel))
        .filter(source => f.topic.length === 0 || source.topics.some(topic => f.topic.includes(topic)));
}

// ==============================================
// SETTINGS → SOURCES: one table design for every list (your sources, the
// library's available outlets, your current selection), a card grid, and the
// library shown in place of your sources
// ==============================================
// A table: a checkbox column, the outlet (logo in a fixed box, then name), bias
// as a coloured tag, credibility (plain icon and word), country, then ★ + trash
// (your sources) or › (the library). Headers sort. Rows come a page at a time,
// with a pager underneath; short pages are padded so the table keeps its height.

const PAGE_SIZE_ROWS = 8;
const PAGE_SIZE_CARDS = 8;
const tablePages = { feed: 1, available: 1, selection: 1 };   // how many lots of rows are showing ("Show more" adds one)
const tableSorts = { feed: null, available: { key: 'name', dir: 1 }, selection: { key: 'name', dir: 1 } };
const feedRemovals = new Set();      // your sources unticked: removed once you confirm
let tableModalScope = null;          // the "See all" popup, if open ('feed' | 'available')
let selectionExpanded = false;       // the "Current media selection" list
let availableExpanded = true;        // the "Available news outlets" list

// Every outlet is already in your feed
function allSourcesPresent() {
    return sourceCatalog.length > 0 && sourceCatalog.every(source => selectedSources.includes(source.id));
}

function toggleLibraryAvailable() {
    availableExpanded = !availableExpanded;
    renderSourcePicker();
}
let lastPickerChange = null;         // the row just ticked eases into its new look

const BIAS_ORDER = { low: 0, medium: 1, high: 2, unrated: 3 };
const CRED_ORDER = { high: 0, medium: 1, low: 2, unrated: 3 };
const SORTERS = {
    name: (a, b) => a.name.localeCompare(b.name),
    bias: (a, b) => BIAS_ORDER[a.biasLevel] - BIAS_ORDER[b.biasLevel] || a.name.localeCompare(b.name),
    credibility: (a, b) => CRED_ORDER[credibilityLevel(a)] - CRED_ORDER[credibilityLevel(b)] || a.name.localeCompare(b.name),
    country: (a, b) => (a.country || '~').localeCompare(b.country || '~') || a.name.localeCompare(b.name)
};

function isPinned(source) {
    return favoriteSources.includes(source.id);
}

// Sort by the column picked; your sources keep pinned ones first
function sortSources(sources, scope) {
    const sort = tableSorts[scope];
    const byColumn = sort ? (a, b) => sort.dir * SORTERS[sort.key](a, b) : byPopularity;
    return [...sources].sort((a, b) => (scope === 'feed' ? isPinned(b) - isPinned(a) : 0) || byColumn(a, b));
}

function setTableSort(scope, key) {
    const sort = tableSorts[scope];
    tableSorts[scope] = sort?.key === key ? { key, dir: -sort.dir } : { key, dir: 1 };
    tablePages[scope] = 1;
    rerenderScope(scope);
}

function setTablePage(scope, page) {
    tablePages[scope] = page;
    rerenderScope(scope);
}

function rerenderScope(scope) {
    if (scope === 'feed') renderFeedSources();
    else renderSourcePicker();
    if (tableModalScope) renderTableModal();
}

function renderSettingsSources() {
    renderFeedSources();
    renderSubscriptions();
    if (pickerOpen) renderSourcePicker();
    if (detailSourceId) renderSourceDetail();
}

// Your sources: toolbar, a bulk bar when rows are ticked, the table or grid
function renderFeedSources() {
    const container = document.getElementById('feedSources');
    if (!container) return;
    renderSourceFilters('feed');
    document.querySelectorAll('#settingsSourcesSection .view-toggle [data-view]').forEach(button => {
        button.setAttribute('aria-pressed', button.dataset.view === sourceView);
    });

    const inFeed = selectedSources.map(sourceById).filter(Boolean);
    const matching = new Set(filteredSources('feed').map(source => source.id));
    const sources = sortSources(inFeed.filter(source => matching.has(source.id)), 'feed');
    [...feedRemovals].forEach(id => { if (!selectedSources.includes(id)) feedRemovals.delete(id); });
    document.getElementById('feedActions').hidden = inFeed.length === 0;
    const tabCount = document.getElementById('sourceTabCount');
    if (tabCount) tabCount.textContent = inFeed.length;

    // Nothing in the feed yet: one dashed "+ Add sources to your feed" slot
    if (inFeed.length === 0) {
        const slot = document.createElement('button');
        slot.type = 'button';
        slot.className = 'add-slot';
        slot.innerHTML = '<span class="add-slot__plus" aria-hidden="true">+</span>';
        slot.append('Add sources to your feed');
        slot.addEventListener('click', openSourcePicker);
        container.replaceChildren(slot);
        return;
    }

    const parts = [];
    if (feedRemovals.size > 0) parts.push(createBulkBar());
    parts.push(sourceView === 'grid' ? createSourceGrid(sources) : createSourceTable(sources, 'feed'));
    container.replaceChildren(...parts);
}

// Unticked rows in your sources: Remove them, or Undo selection
function createBulkBar() {
    const bar = document.createElement('div');
    bar.className = 'bulk-bar';
    const count = document.createElement('span');
    count.className = 'bulk-bar__count';
    count.textContent = `${feedRemovals.size} unticked`;
    const action = (label, className, run) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.addEventListener('click', run);
        return button;
    };
    bar.append(
        count,
        action(`Remove ${feedRemovals.size}`, 'btn btn--danger', () => {
            selectedSources = selectedSources.filter(id => !feedRemovals.has(id));
            feedRemovals.clear();
            sourcesChanged();
        }),
        action('Undo selection', 'link-btn bulk-bar__undo', () => {
            feedRemovals.clear();
            rerenderScope('feed');
        })
    );
    return bar;
}

function sourceCell(content, className) {
    const td = document.createElement('td');
    if (className) td.className = className;
    td.append(content);
    return td;
}

// The outlet's icon in a fixed square, so every mark scales the same way
function createLogoBox(source, size = 'md') {
    const box = document.createElement('span');
    box.className = `logo-box logo-box--${size}`;
    box.appendChild(createLogo(source, null, 'icon'));
    return box;
}

// Bias as a small coloured tag: Low (green), Medium (blue), High (red)
function createBiasTag(source) {
    const tag = document.createElement('span');
    tag.className = `bias-tag bias-tag--${source.biasLevel}`;
    tag.textContent = source.biasLevel === 'unrated' ? 'Unrated' : `${source.biasLevel[0].toUpperCase()}${source.biasLevel.slice(1)}`;
    tag.title = source.bias ? `Bias: ${source.biasLevel} (MBFC: ${source.bias})` : 'No MBFC bias rating';
    return tag;
}

function createTrashButton(source) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-trash';
    button.title = `Take ${source.name} out of the feed`;
    button.setAttribute('aria-label', button.title);
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
    button.addEventListener('click', event => {
        event.stopPropagation();
        toggleSource(source.id, false);
    });
    return button;
}

function createDetailsButton(source) {
    const details = document.createElement('button');
    details.type = 'button';
    details.className = 'row-details';
    details.textContent = '›';
    details.title = `Details for ${source.name}`;
    details.setAttribute('aria-label', details.title);
    details.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openSourceDetail(source.id);
    });
    return details;
}

// Which rows a table's checkboxes mean: bulk picks (your sources) or ticks in the library
function tableTicks(scope) {
    if (scope === 'feed') {
        return {
            ticked: source => !feedRemovals.has(source.id),
            set: (source, on) => (on ? feedRemovals.delete(source.id) : feedRemovals.add(source.id)),
            usable: () => true
        };
    }
    return {
        ticked: isPickerTicked,
        set: setPickerTicked,
        usable: source => source.available || selectedSources.includes(source.id)
    };
}

function createSourceTable(sources, scope, { all: showAll = false } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'src-table';
    const ticks = tableTicks(scope);
    // A few rows at a time ("Show more" adds PAGE_SIZE_ROWS); the "See all" popup shows every one
    const page = showAll ? sources : sources.slice(0, tablePages[scope] * PAGE_SIZE_ROWS);

    const table = document.createElement('table');
    table.className = `src-table__table src-table__table--${scope === 'feed' ? 'feed' : 'library'}`;
    const colgroup = document.createElement('colgroup');
    colgroup.innerHTML = '<col class="c-check"><col class="c-outlet"><col class="c-bias"><col class="c-cred"><col class="c-country">'
        + '<col class="c-pin"><col class="c-act">';
    table.appendChild(colgroup);

    // Header: select-all box and sortable columns
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    const usable = sources.filter(ticks.usable);
    const tickedCount = usable.filter(ticks.ticked).length;
    const all = document.createElement('input');
    all.type = 'checkbox';
    all.className = 'feed-check';
    all.checked = usable.length > 0 && tickedCount === usable.length;
    all.indeterminate = tickedCount > 0 && tickedCount < usable.length;
    all.disabled = usable.length === 0;
    all.setAttribute('aria-label', scope === 'feed' ? 'Select all your sources' : 'Tick all listed outlets');
    all.addEventListener('change', () => {
        usable.forEach(source => ticks.set(source, all.checked));
        rerenderScope(scope);
    });
    const th = (content, className) => {
        const cell = document.createElement('th');
        if (className) cell.className = className;
        cell.append(content);
        return cell;
    };
    const sortButton = (label, key) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'th-sort';
        const sort = tableSorts[scope];
        const active = sort?.key === key;
        button.setAttribute('aria-sort', active ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none');
        button.innerHTML = `<span>${label}</span><span class="th-sort__arrows" aria-hidden="true">${active ? (sort.dir > 0 ? '▲' : '▼') : '⇅'}</span>`;
        button.addEventListener('click', () => setTableSort(scope, key));
        return button;
    };
    headRow.append(
        th(all, 'c-check'),
        th(sortButton('Outlet', 'name')),
        th(sortButton('Bias', 'bias')),
        th(sortButton('Credibility', 'credibility')),
        th(sortButton('Country', 'country'))
    );
    // Right of the header: how many rows are showing, e.g. "5 of 55"
    const count = document.createElement('span');
    count.className = 'src-table__count';
    count.textContent = `${page.length} of ${sources.length}`;
    headRow.append(th('Pinned', 'c-pin'), th(count, 'c-act'));
    head.appendChild(headRow);
    table.appendChild(head);

    const body = document.createElement('tbody');
    page.forEach(source => body.appendChild(createSourceRow(source, scope, ticks)));
    if (sources.length === 0) {
        const empty = document.createElement('tr');
        empty.className = 'src-table__empty';
        empty.innerHTML = `<td colspan="7"></td>`;
        empty.firstChild.textContent = scope === 'feed' ? 'None of your sources match. Try clearing the search or filters.'
            : scope === 'selection' ? 'Nothing in your selection matches.' : 'No outlets match. Try clearing the search or filters.';
        body.appendChild(empty);
    }
    // "⌄ Show 5 more" as a last row, centred; "See all" at its right
    if (!showAll && page.length < sources.length) {
        const moreRow = document.createElement('tr');
        moreRow.className = 'src-table__more';
        const cell = document.createElement('td');
        cell.colSpan = 7;
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'src-table__more-btn';
        more.innerHTML = `<span class="show-more__chev" aria-hidden="true">⌄</span> Show ${Math.min(PAGE_SIZE_ROWS, sources.length - page.length)} more`;
        more.addEventListener('click', event => {
            event.stopPropagation();
            setTablePage(scope, tablePages[scope] + 1);
        });
        cell.appendChild(more);
        moreRow.addEventListener('click', () => more.click());
        if (scope !== 'selection') {
            const seeAll = document.createElement('button');
            seeAll.type = 'button';
            seeAll.className = 'link-btn src-table__see-all';
            seeAll.textContent = 'See all';
            seeAll.addEventListener('click', event => {
                event.stopPropagation();
                openTableModal(scope === 'feed' ? 'feed' : 'available');
            });
            cell.appendChild(seeAll);
        }
        moreRow.appendChild(cell);
        body.appendChild(moreRow);
    }
    table.appendChild(body);
    wrap.appendChild(table);
    const outer = document.createElement('div');
    outer.className = 'src-table-outer';
    outer.appendChild(wrap);

    return outer;
}

function createSourceRow(source, scope, ticks) {
    const row = document.createElement('tr');
    const inFeed = selectedSources.includes(source.id);
    const ticked = ticks.ticked(source);
    row.tabIndex = 0;
    if (ticked && scope !== 'feed') row.classList.add('is-selected');
    if (inFeed && !ticked) row.classList.add('is-removing');
    if (!ticks.usable(source)) row.classList.add('is-disabled');
    if (lastPickerChange === source.id) row.classList.add('just-changed');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'feed-check';
    checkbox.checked = ticked;
    checkbox.disabled = !ticks.usable(source);
    checkbox.setAttribute('aria-label', `Select ${source.name}`);
    checkbox.addEventListener('click', event => event.stopPropagation());
    checkbox.addEventListener('change', () => {
        ticks.set(source, checkbox.checked);
        lastPickerChange = source.id;
        rerenderScope(scope);
    });

    // Row click: your sources open the outlet's page; library rows tick
    row.addEventListener('click', () => {
        if (scope === 'feed') openSourceDetail(source.id);
        else if (ticks.usable(source)) checkbox.click();
    });
    row.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            row.click();
        }
    });

    const outlet = document.createElement('span');
    outlet.className = 'src-table__outlet';
    const name = document.createElement('span');
    name.className = 'src-table__name';
    name.textContent = source.name;
    const status = inFeed && !ticked ? 'Will be removed'
        : scope !== 'feed' && inFeed ? 'In your feed' : !source.available ? 'No free feed' : '';
    if (status) {
        const small = document.createElement('small');
        small.textContent = status;
        name.appendChild(small);
    }
    outlet.append(createLogoBox(source), name);

    row.append(
        sourceCell(checkbox, 'c-check'),
        sourceCell(outlet),
        sourceCell(createBiasTag(source)),
        sourceCell(createCredibilityBadge(source)),
        sourceCell(source.country || '—', 'src-table__muted')
    );
    row.append(sourceCell(createStar(source), 'c-pin'),
        sourceCell(scope === 'feed' ? createTrashButton(source) : createDetailsButton(source), 'c-act'));
    return row;
}

// Under a table or grid: "⌄ Show more" (the next few), "12 of 55", and "See all"
// (every row in a popup)
function createShowMore(scope, total, shown, step) {
    const bar = document.createElement('div');
    bar.className = 'show-more';
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'show-more__btn';
    const next = Math.min(step, total - shown);
    more.innerHTML = `<span class="show-more__chev" aria-hidden="true">⌄</span> Show ${next} more`;
    more.hidden = shown >= total;
    more.addEventListener('click', () => setTablePage(scope, tablePages[scope] + 1));
    const count = document.createElement('span');
    count.className = 'show-more__count';
    count.textContent = total === 0 ? '' : `${shown} of ${total}`;
    const seeAll = document.createElement('button');
    seeAll.type = 'button';
    seeAll.className = 'link-btn show-more__all';
    seeAll.textContent = 'See all';
    seeAll.hidden = total <= step || scope === 'selection';
    seeAll.addEventListener('click', () => openTableModal(scope === 'feed' ? 'feed' : 'available'));
    bar.append(more, count, seeAll);
    return bar;
}

// "See all": every row of a list in a popup, the table as tall as it needs
function openTableModal(scope) {
    tableModalScope = scope;
    const modal = document.getElementById('tableModal');
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
    renderTableModal();
    // Open near where the table sits on the page (its box's top edge)
    const box = document.querySelector(scope === 'feed' ? '#sourcesMine .src-box' : '#sourcePicker .src-box');
    const rect = box ? box.getBoundingClientRect() : null;
    const panel = modal.querySelector('.modal__panel');
    const wide = window.innerWidth > 760;
    // Across the Settings content, starting just above the table (kept high
    // enough to leave room for the list); the table inside is 80% of it
    const area = document.querySelector('.settings-page__inner')?.getBoundingClientRect();
    panel.style.marginTop = rect ? `${Math.min(Math.max(24, rect.top - 24), window.innerHeight * 0.35)}px` : '';
    panel.style.marginLeft = area && wide ? `${Math.max(16, area.left - 16)}px` : '';
    panel.style.width = area && wide ? `${area.width + 32}px` : '';
    panel.style.maxHeight = `${window.innerHeight - panel.getBoundingClientRect().top - 16}px`;
}

function closeTableModal() {
    const modal = document.getElementById('tableModal');
    if (!modal || modal.style.display === 'none') return;
    tableModalScope = null;
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
    // Closing it lands on the "Add more" tab
    if (!pickerOpen) openSourcePicker();
}

function tableModalSources(scope) {
    if (scope === 'available') return pickerSources().available;
    const matching = new Set(filteredSources('feed').map(source => source.id));
    return sortSources(selectedSources.map(sourceById).filter(source => source && matching.has(source.id)), 'feed');
}

function renderTableModal() {
    if (!tableModalScope) return;
    const sources = tableModalSources(tableModalScope);
    document.getElementById('tableModalTitle').textContent = tableModalScope === 'feed'
        ? `Your sources (${sources.length})` : `Available news outlets (${sources.length})`;
    const body = document.getElementById('tableModalBody');
    const parts = [];
    if (tableModalScope === 'feed' && feedRemovals.size > 0) parts.push(createBulkBar());
    parts.push(createSourceTable(sources, tableModalScope, { all: true }));
    body.replaceChildren(...parts);
    const note = document.getElementById('tableModalNote');
    if (note) note.textContent = tableModalScope === 'available'
        ? 'Ticked outlets are added when you press Add under the list.' : '';
}

// "‹ 1 2 3 ›   7–12 of 23" under a table or grid
function createTablePager(scope, total, pageCount, size) {
    const pager = document.createElement('nav');
    pager.className = 'table-pager';
    pager.setAttribute('aria-label', 'Pages');
    const current = tablePages[scope];
    const summary = document.createElement('span');
    summary.className = 'table-pager__summary';
    const first = total === 0 ? 0 : (current - 1) * size + 1;
    summary.textContent = `${first}–${Math.min(total, current * size)} of ${total}`;
    const buttons = document.createElement('span');
    buttons.className = 'table-pager__pages';
    const button = (label, page, ariaLabel) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pager__btn';
        btn.textContent = label;
        btn.setAttribute('aria-label', ariaLabel);
        if (label === String(page) && page === current) {
            btn.setAttribute('aria-current', 'page');
            btn.disabled = true;
        } else {
            btn.disabled = page < 1 || page > pageCount;
            btn.addEventListener('click', () => setTablePage(scope, page));
        }
        return btn;
    };
    buttons.appendChild(button('‹', current - 1, 'Previous page'));
    // First, last, and the pages either side of the current one, with … between
    const shown = [...new Set([1, pageCount, current - 1, current, current + 1])].filter(page => page >= 1 && page <= pageCount).sort((a, b) => a - b);
    shown.forEach((page, index) => {
        if (index > 0 && page - shown[index - 1] > 1) {
            const gap = document.createElement('span');
            gap.className = 'table-pager__gap';
            gap.textContent = '…';
            buttons.appendChild(gap);
        }
        buttons.appendChild(button(String(page), page, `Page ${page}`));
    });
    buttons.appendChild(button('›', current + 1, 'Next page'));
    pager.append(summary, buttons);
    return pager;
}

// Grid: 4 across, 8 to a page. Each card: the icon and name (with country),
// ★ in the top-right corner, topic and bias tags, credibility and bias lines,
// and a trash can on hover. Clicking the card opens the outlet's page.
function createSourceGrid(sources, scope = 'feed') {
    const wrap = document.createElement('div');
    wrap.className = 'src-grid-wrap';
    const page = sources;   // the grid shows every card, one continuous grid
    const grid = document.createElement('div');
    grid.className = 'src-grid';
    page.forEach(source => grid.appendChild(createSourceCard(source, scope)));
    wrap.append(grid);
    const outer = document.createElement('div');
    outer.className = 'src-table-outer';
    outer.append(wrap);
    return outer;
}

// Your sources: clicking a card opens its page (trash on hover removes it).
// Add more: clicking a card ticks it to add (› opens its page).
function createSourceCard(source, scope = 'feed') {
    const picking = scope !== 'feed';
    const card = document.createElement('article');
    card.className = isPinned(source) ? 'src-card src-card--pinned' : 'src-card';
    card.tabIndex = 0;
    if (picking) {
        const ticked = isPickerTicked(source);
        const usable = source.available || selectedSources.includes(source.id);
        if (ticked) card.classList.add('is-picked');
        if (!usable) card.classList.add('is-disabled');
        card.setAttribute('role', 'checkbox');
        card.setAttribute('aria-checked', String(ticked));
        card.title = usable ? `${ticked ? 'Untick' : 'Tick'} ${source.name}` : `${source.name}: no free feed`;
        const toggle = () => {
            if (!usable) return;
            setPickerTicked(source, !ticked);
            renderSourcePicker();
        };
        card.addEventListener('click', toggle);
        card.addEventListener('keydown', event => {
            if ((event.key === 'Enter' || event.key === ' ') && event.target === card) {
                event.preventDefault();
                toggle();
            }
        });
    } else {
        card.title = `Details for ${source.name}`;
        card.addEventListener('click', () => openSourceDetail(source.id));
        card.addEventListener('keydown', event => {
            if (event.key === 'Enter' && event.target === card) openSourceDetail(source.id);
        });
    }

    const head = document.createElement('div');
    head.className = 'src-card__head';
    const titles = document.createElement('div');
    titles.className = 'src-card__titles';
    const name = document.createElement('h4');
    name.className = 'src-card__name';
    name.textContent = source.name;
    const country = document.createElement('span');
    country.className = 'src-card__sub';
    country.textContent = source.country || '—';
    titles.append(name);
    const star = createStar(source);
    star.classList.add('src-card__star');
    head.append(createLogoBox(source, 'lg'), titles, star);

    const tags = document.createElement('hr');   // a line between the name and the ratings
    tags.className = 'src-card__rule';

    const facts = document.createElement('dl');
    facts.className = 'src-card__facts';
    const fact = (label, value) => {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.append(value);
        facts.append(dt, dd);
    };
    fact('Credibility', createCredibilityBadge(source));
    fact('Bias', createBiasTag(source));

    const corner = picking ? createDetailsButton(source) : createTrashButton(source);
    corner.classList.add('src-card__trash');
    card.append(head, tags, facts, corner);
    if (picking) {
        const tick = document.createElement('span');
        tick.className = 'src-card__tick';
        tick.setAttribute('aria-hidden', 'true');
        tick.textContent = '✓';
        card.appendChild(tick);
    }
    return card;
}

// ----------------------------------------------
// The full library, in place of your sources: "Available news outlets" (not
// in your feed; while searching, matching ones already in your feed show too,
// ticked) and "Current media selection" (your feed, ticked). Nothing changes
// until Add / Remove / Apply.
// ----------------------------------------------

function openSourcePicker() {
    if (!settingsOpen()) openSettings('sources');
    const before = tableViewHash();
    pickerOpen = true;
    availableExpanded = true;
    pendingSources = new Set();
    pendingRemovals = new Set();
    tablePages.available = 1;
    tablePages.selection = 1;
    closeSourceFilters();
    cancelSourcesChange();
    document.getElementById('sourcesMine').hidden = true;
    document.getElementById('sourcePicker').hidden = false;
    setSourceTab('add');
    pushTableView(before);
    renderSourcePicker();
    document.getElementById('sourceSearch')?.focus({ preventScroll: true });
}

function closeSourcePicker(rerender = true) {
    const wasOpen = pickerOpen;
    pickerOpen = false;
    pendingSources = new Set();
    pendingRemovals = new Set();
    closeSourceFilters();
    const picker = document.getElementById('sourcePicker');
    if (picker) picker.hidden = true;
    const mine = document.getElementById('sourcesMine');
    if (mine) mine.hidden = false;
    setSourceTab('current');
    if (wasOpen) pushTableView();
    if (rerender && wasOpen) renderFeedSources();
}

function confirmSourcePicker() {
    const added = [...pendingSources].filter(id => !selectedSources.includes(id));
    selectedSources = [...selectedSources.filter(id => !pendingRemovals.has(id)), ...added];
    closeSourcePicker();
    sourcesChanged();
}

function pickerSources() {
    const searching = sourceScopes.picker.query.trim() !== '';
    const selectionQuery = sourceScopes.selection.query.trim().toLowerCase();
    // Outlets not in your feed (while searching, matching ones already in it too)
    const matching = filteredSources('picker');
    const notInFeed = matching.filter(source => !selectedSources.includes(source.id));
    return {
        available: sortSources(searching ? matching : notInFeed, 'available'),
        selection: sortSources(selectedSources.map(sourceById).filter(Boolean)
            .filter(source => !selectionQuery || [source.name, source.owner, source.country, ...(source.aliases || [])]
                .some(text => text && text.toLowerCase().includes(selectionQuery))), 'selection')
    };
}

// Ticked = will be in the feed after "Apply"
function isPickerTicked(source) {
    return selectedSources.includes(source.id) ? !pendingRemovals.has(source.id) : pendingSources.has(source.id);
}

function setPickerTicked(source, ticked) {
    if (selectedSources.includes(source.id)) {
        if (ticked) pendingRemovals.delete(source.id);
        else pendingRemovals.add(source.id);
    } else if (ticked) {
        pendingSources.add(source.id);
    } else {
        pendingSources.delete(source.id);
    }
}

// The Sources tabs: "Your sources" and "Add more"
function setSourceTab(tab) {
    document.getElementById('sourceTabCurrent')?.setAttribute('aria-selected', String(tab === 'current'));
    document.getElementById('sourceTabAdd')?.setAttribute('aria-selected', String(tab === 'add'));
}

function toggleLibrarySelection() {
    selectionExpanded = !selectionExpanded;
    renderSourcePicker();
}

function renderSourcePicker() {
    const available = document.getElementById('settingsSources');
    const selectionBox = document.getElementById('librarySelection');
    if (!available) return;
    renderSourceFilters('picker');
    const lists = pickerSources();

    const searching = sourceScopes.picker.query.trim() !== '';
    const allPresent = allSourcesPresent() && !searching;
    const note = document.getElementById('libraryAllPresent');
    if (note) note.hidden = !allPresent;
    if (allPresent) available.replaceChildren();
    else available.replaceChildren(sourceView === 'grid'
        ? createSourceGrid(lists.available, 'available')
        : createSourceTable(lists.available, 'available'));
    // Footer, left: how many are ticked, and "Undo selection"
    const summary = document.getElementById('pickerSummary');
    if (summary && !summary.childElementCount) {
        const link = (label, className, run) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = className;
            button.textContent = label;
            button.addEventListener('click', run);
            return button;
        };
        summary.append(
            // Clear all: untick everything ticked here
            link('Clear all', 'link-btn link-btn--danger', () => {
                pendingSources = new Set();
                pendingRemovals = new Set();
                renderSourcePicker();
            }),
            // Reset: also clear the search and filters, back to the first rows
            link('Reset', 'link-btn', () => {
                pendingSources = new Set();
                pendingRemovals = new Set();
                sourceScopes.picker.query = '';
                sourceScopes.picker.filters = emptySourceFilters();
                const search = document.getElementById('sourceSearch');
                if (search) search.value = '';
                tablePages.available = 1;
                renderSourcePicker();
            })
        );
    }
    if (selectionBox) selectionBox.replaceChildren(createListBar('selection', lists.selection), createSourceTable(lists.selection, 'selection'));

    // "N sources →" in the Current media selection header
    const back = document.getElementById('librarySelectionBack');
    if (back) {
        const n = selectedSources.length - pendingRemovals.size + pendingSources.size;
        back.innerHTML = `<span>${n} source${n === 1 ? '' : 's'}</span><span aria-hidden="true">→</span>`;
    }
    document.getElementById('librarySelectionBody')?.classList.toggle('is-open', selectionExpanded);
    document.getElementById('libraryAvailableBody')?.classList.toggle('is-open', availableExpanded);
    document.getElementById('libraryAvailableToggle')?.setAttribute('aria-expanded', String(availableExpanded));

    document.getElementById('librarySelectionToggle')?.setAttribute('aria-expanded', String(selectionExpanded));

    // "Add 2", "Remove 1", or "Apply (+2 −1)"
    const confirm = document.getElementById('pickerConfirm');
    if (confirm) {
        const adds = pendingSources.size;
        const removes = pendingRemovals.size;
        confirm.disabled = adds + removes === 0;
        confirm.textContent = adds && removes ? `Apply (+${adds} −${removes})`
            : removes ? `Remove ${removes}` : adds ? `Add ${adds}` : 'Add';
    }
    lastPickerChange = null;
}

// Above a library table: "Undo selection" once you've changed something (and,
// for your selection, how much of it is kept)
function createListBar(scope, sources) {
    const bar = document.createElement('div');
    bar.className = 'list-bar';
    // Available news outlets show no count; your selection says how much is kept
    if (scope === 'selection') {
        const ticked = sources.filter(isPickerTicked).length;
        const count = document.createElement('span');
        count.className = 'list-bar__count';
        count.textContent = ticked === sources.length ? `All ${sources.length} selected` : `${ticked} of ${sources.length} kept`;
        bar.appendChild(count);
    }
    if (sources.some(source => pendingSources.has(source.id) || pendingRemovals.has(source.id))) {
        const undo = document.createElement('button');
        undo.type = 'button';
        undo.className = 'link-btn';
        undo.textContent = 'Undo selection';
        undo.addEventListener('click', () => {
            sources.forEach(source => {
                pendingSources.delete(source.id);
                pendingRemovals.delete(source.id);
            });
            renderSourcePicker();
        });
        bar.appendChild(undo);
    }
    bar.hidden = bar.childElementCount === 0;
    return bar;
}

// The Filters popover for a scope: groups of chips (pick any) with "All"
function renderSourceFilters(scope) {
    const state = sourceScopes[scope];
    const panel = document.getElementById(state.panel);
    const badge = document.getElementById(state.badge);
    if (!panel) return;
    const rerender = () => (scope === 'feed' ? renderFeedSources() : renderSourcePicker());

    // The library has no "Favourite" filter (starring is for your own sources)
    const groups = SOURCE_FILTER_GROUPS.filter(group => scope === 'feed' || group.key !== 'favorite');
    const active = groups.filter(group => state.filters[group.key].length > 0).length;
    if (badge) {
        badge.hidden = active === 0;
        badge.textContent = active;
    }

    panel.innerHTML = '';
    groups.forEach(group => {
        const picked = state.filters[group.key];
        const section = document.createElement('div');
        section.className = 'filter-pop__group';

        const head = document.createElement('div');
        head.className = 'filter-pop__head';
        const label = document.createElement('p');
        label.className = 'eyebrow';
        label.textContent = group.label;
        const allLabel = document.createElement('label');
        allLabel.className = 'check';
        const all = document.createElement('input');
        all.type = 'checkbox';
        all.checked = picked.length === 0;
        all.addEventListener('click', event => event.stopPropagation());
        all.addEventListener('change', () => {
            state.filters[group.key] = [];
            rerender();
        });
        allLabel.append(all, 'All');
        allLabel.addEventListener('click', event => event.stopPropagation());
        head.append(label, allLabel);

        const chips = document.createElement('div');
        chips.className = 'chip-choices';
        group.options.forEach(([value, name]) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.textContent = name;
            chip.setAttribute('aria-pressed', picked.includes(value));
            chip.addEventListener('click', event => {
                event.stopPropagation();
                const current = state.filters[group.key];   // read now, not when the popover was drawn
                state.filters[group.key] = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
                rerender();
            });
            chips.appendChild(chip);
        });
        section.append(head, chips);
        panel.appendChild(section);
    });

    if (active > 0) {
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'link-btn filter-pop__reset';
        reset.textContent = 'Reset filters';
        reset.addEventListener('click', event => {
            event.stopPropagation();
            state.filters = emptySourceFilters();
            rerender();
        });
        panel.appendChild(reset);
    }
}

function toggleSourceFilters(event, scope = 'picker') {
    event.stopPropagation();
    const { panel: panelId, toggle: toggleId } = sourceScopes[scope];
    const panel = document.getElementById(panelId);
    const toggle = document.getElementById(toggleId);
    if (!panel || !toggle) return;
    const opening = panel.hidden;
    closeSourceFilters();
    panel.hidden = !opening;
    toggle.setAttribute('aria-expanded', String(opening));
}

function closeSourceFilters() {
    Object.values(sourceScopes).forEach(({ panel: panelId, toggle }) => {
        const panel = document.getElementById(panelId);
        if (panel && !panel.hidden) {
            panel.hidden = true;
            document.getElementById(toggle)?.setAttribute('aria-expanded', 'false');
        }
    });
}

function setSourceQuery(value, scope = 'picker') {
    sourceScopes[scope].query = value;
    tablePages[scope === 'picker' ? 'available' : scope] = 1;
    if (scope === 'feed') renderFeedSources();
    else renderSourcePicker();
}

// Each table view (tab, grid or rows) gets its own history entry, so the
// browser's Back button returns to the previous one
let restoringTableView = false;

function tableViewHash() {
    return `#settings/sources/${pickerOpen ? 'add' : 'mine'}/${sourceView}`;
}

// `before`: the view being left, so the first Back lands on it too
function pushTableView(before) {
    if (restoringTableView || !settingsOpen()) return;
    if (before && !location.hash.startsWith('#settings/sources/')) history.replaceState(null, '', before);
    const hash = tableViewHash();
    if (location.hash !== hash) history.pushState(null, '', hash);
}

// From a #settings/sources/<tab>/<view> address (Back / Forward): no scrolling
function restoreTableView(hash) {
    const [, , tab, view] = hash.slice(1).split('/');
    restoringTableView = true;
    if (view === 'grid' || view === 'rows') setSourceView(view);
    if (tab === 'add' && !pickerOpen) openSourcePicker({ scroll: false });
    if (tab === 'mine' && pickerOpen) closeSourcePicker();
    restoringTableView = false;
}

function setSourceView(view) {
    const before = tableViewHash();
    sourceView = view === 'grid' ? 'grid' : 'rows';
    pushTableView(before);
    saveToLocalStorage('sourceView', sourceView);
    tablePages.feed = 1;
    renderFeedSources();
    if (pickerOpen) renderSourcePicker();
}

function createStar(source) {
    const favorite = favoriteSources.includes(source.id);
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'star';
    star.textContent = favorite ? '★' : '☆';
    star.setAttribute('aria-pressed', favorite);
    star.setAttribute('aria-label', `${favorite ? 'Unfavourite' : 'Favourite'} ${source.name}`);
    star.title = favorite ? 'Remove from the sidebar' : 'Keep in the sidebar';
    star.addEventListener('click', event => {
        event.stopPropagation();
        toggleFavorite(source.id);
    });
    return star;
}

// ==============================================
// SOURCE DETAIL PAGE (inside the settings modal)
// ==============================================

// An outlet's page, in place of the Settings content (from the library, the
// dialog steps aside and comes back on "Back")
function openSourceDetail(sourceId) {
    detailSourceId = sourceId;
    closeSourceFilters();
    if (!settingsOpen()) history.pushState(null, '', `#settings/source:${sourceId}`);
    document.getElementById('settingsPage').hidden = false;
    document.querySelector('.title-block').hidden = true;
    document.querySelector('.content').hidden = true;
    document.getElementById('settingsMain').hidden = true;
    document.getElementById('sourceDetail').hidden = false;
    renderSourceDetail();
    window.scrollTo(0, 0);
}

function closeSourceDetail() {
    detailSourceId = null;
    if (location.hash.startsWith('#settings/source:')) history.replaceState(null, '', '#settings/sources');
    const detail = document.getElementById('sourceDetail');
    if (detail) detail.hidden = true;
    document.getElementById('settingsMain').hidden = false;
    if (pickerOpen) {
        renderSourcePicker();
        document.getElementById('settingsSourcesSection')?.scrollIntoView({ block: 'start' });
        return;
    }
    renderFeedSources();
    document.getElementById('settingsSourcesSection')?.scrollIntoView({ block: 'start' });
}

// Why the outlet is in the catalog, and anything notable about it
function sourceNotes(source) {
    const notes = [];
    if (!source.available) {
        notes.push('Listed, but it has no free feed we can use.');
    } else if (!source.credible) {
        notes.push('Available, but marked "mixed credibility" and listed after the main outlets.');
    } else {
        notes.push(`In the main list: Media Bias/Fact Check rates its factual reporting ${source.factual || 'Mostly Factual or better'}.`);
    }
    if (source.note) notes.push(source.note);
    return notes;
}

function renderSourceDetail() {
    const container = document.getElementById('sourceDetail');
    const source = sourceById(detailSourceId);
    if (!container || !source) return;
    container.innerHTML = '';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'detail__back';
    back.innerHTML = '<span aria-hidden="true">←</span>';
    back.append(' Back to sources');
    back.addEventListener('click', closeSourceDetail);

    // Header: logo, name, credibility, and the feed / favourite actions
    const head = document.createElement('header');
    head.className = 'detail__head';
    const logo = createLogo(source, null, 'logo', { keepWide: true });
    logo.classList.add('detail__logo');
    const titles = document.createElement('div');
    titles.className = 'detail__titles';
    const name = document.createElement('h3');
    name.textContent = source.name;
    const badges = document.createElement('div');
    badges.className = 'source-card__badges';
    badges.append(createCredibilityBadge(source), createBiasBadge(source));
    titles.append(name, badges);

    const actions = document.createElement('div');
    actions.className = 'detail__actions';
    const inFeed = selectedSources.includes(source.id);
    const feedButton = document.createElement('button');
    feedButton.type = 'button';
    feedButton.className = inFeed ? 'btn' : 'btn btn--primary';
    feedButton.disabled = !source.available;
    feedButton.textContent = !source.available ? 'No free feed' : inFeed ? 'Remove from feed' : '+ Add to feed';
    feedButton.addEventListener('click', () => toggleSource(source.id, !inFeed));
    actions.append(feedButton, createStar(source));
    head.append(logo, titles, actions);

    // Main column: notes, topics, ownership, aliases
    const main = document.createElement('div');
    main.className = 'detail__main';
    const section = (title, ...content) => {
        const block = document.createElement('section');
        block.className = 'detail__section';
        const heading = document.createElement('h4');
        heading.textContent = title;
        block.append(heading, ...content);
        main.appendChild(block);
    };
    const para = text => {
        const p = document.createElement('p');
        p.textContent = text;
        return p;
    };
    const tags = list => {
        const wrap = document.createElement('div');
        wrap.className = 'tag-list';
        list.forEach(text => {
            const tag = document.createElement('span');
            tag.className = 'tag';
            tag.textContent = text;
            wrap.appendChild(tag);
        });
        return wrap;
    };

    section('Notes on this choice', ...sourceNotes(source).map(para));
    section('Topics', topicNames(source).length ? tags(topicNames(source)) : para('Not in any topic, so it only shows up when every topic is selected.'));

    const siblings = sourceCatalog.filter(other => other.id !== source.id && other.owner && other.owner === source.owner).map(other => other.name);
    section('Ownership',
        para(`${source.owner || 'Unknown'}${source.ownerType ? `: ${source.ownerType.charAt(0).toLowerCase()}${source.ownerType.slice(1)}` : ''}.`),
        ...(siblings.length ? [para('Same owner as:'), tags(siblings)] : []));
    if (source.aliases?.length) section('Also known as', tags(source.aliases));

    // Side column: ratings, links, feed facts
    const side = document.createElement('aside');
    side.className = 'detail__side';
    const facts = document.createElement('dl');
    facts.className = 'facts facts--stacked';
    const fact = (term, value) => {
        const wrap = document.createElement('div');
        const dt = document.createElement('dt');
        dt.textContent = term;
        const dd = document.createElement('dd');
        dd.append(value);
        wrap.append(dt, dd);
        facts.appendChild(wrap);
    };
    const link = (href, text) => {
        const a = document.createElement('a');
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = 'link-btn';
        a.textContent = text;
        return a;
    };
    fact('Bias', source.bias ? `${source.bias} (${source.biasLevel})` : 'Not rated');
    fact('Factual reporting', source.factual || 'Not rated');
    fact('Credibility', source.credibility || (source.factual ? 'Not listed' : 'Not rated'));
    if (source.mbfc) fact('Ratings source', link(source.mbfc, 'Media Bias/Fact Check ↗'));
    if (source.homepage) fact('Website', link(source.homepage, new URL(source.homepage).hostname.replace(/^www\./, '') + ' ↗'));
    fact('Country', source.country || '—');
    fact('Articles via', source.fetchedVia);
    side.appendChild(facts);

    const body = document.createElement('div');
    body.className = 'detail__body';
    body.append(main, side);

    const foot = document.createElement('p');
    foot.className = 'detail__foot';
    foot.textContent = 'Ratings from Media Bias/Fact Check, checked 29 Sep 2026. Ownership as of 2025; outlets change hands, so check the outlet\'s site if it matters.';

    container.append(back, head, body, foot);
}

function toggleFavorite(sourceId) {
    favoriteSources = favoriteSources.includes(sourceId)
        ? favoriteSources.filter(id => id !== sourceId)
        : [...favoriteSources, sourceId];
    saveToLocalStorage('favoriteSources', favoriteSources);
    renderSources();
}

function sourcesChanged() {
    saveToLocalStorage('selectedSources', selectedSources);
    renderSources();
    loadNews();
}

function toggleSource(sourceId, checked) {
    if (checked) {
        if (!selectedSources.includes(sourceId)) selectedSources.push(sourceId);
    } else {
        selectedSources = selectedSources.filter(s => s !== sourceId);
    }
    pendingSources.delete(sourceId);
    pendingRemovals.delete(sourceId);
    saveToLocalStorage('selectedSources', selectedSources);
    renderSources();
    loadNews();
}

// ==============================================
// KEYWORD MANAGEMENT
// ==============================================
// Keywords match whole words ("ai" won't hide "said"). Multi-word keywords
// match as a phrase, and a trailing `*` matches any ending ("crypto*").

// Tidy a keyword (spaces, curly quotes). "Double-quoted" ones keep their quotes
// and match exactly; plain ones match in any case
function normalizeKeyword(value) {
    if (typeof value !== 'string') return '';
    let keyword = value.trim().replace(/[“”]/g, '"').replace(/\s+/g, ' ');
    const quoted = /^".+"$/.test(keyword);
    keyword = keyword.replace(/^["']+|["']+$/g, '').trim();
    if (!keyword) return '';
    return quoted ? `"${keyword}"` : keyword;   // shown as typed; plain keywords match any case
}

function isExactKeyword(keyword) {
    return keyword.length > 2 && keyword.startsWith('"') && keyword.endsWith('"');
}

// The search bar finds articles that mention the word (the opposite of
// Settings → Keywords to avoid, which hides them)
function submitSearch(event) {
    event.preventDefault();
    const input = document.getElementById('keywordInput');
    if (input && addToKeywordList('required', input.value)) input.value = '';
}

function addKeywordFromSettings(event) {
    event.preventDefault();
    const input = document.getElementById('settingsKeywordInput');
    if (input && addToKeywordList('blocked', input.value)) input.value = '';
}

function addToKeywordList(kind, value) {
    const keyword = normalizeKeyword(value);
    const list = kind === 'required' ? requiredKeywords : blockedKeywords;
    // Plain keywords that differ only in case are the same keyword
    const same = other => other === keyword || (!isExactKeyword(keyword) && !isExactKeyword(other) && other.toLowerCase() === keyword.toLowerCase());
    if (!keyword || list.some(same)) return false;

    list.push(keyword);
    keywordsChanged();
    return true;
}

function removeKeyword(keyword, kind) {
    if (kind === 'required') {
        requiredKeywords = requiredKeywords.filter(k => k !== keyword);
    } else {
        blockedKeywords = blockedKeywords.filter(k => k !== keyword);
    }
    keywordsChanged();
}

function keywordsChanged() {
    saveKeywords();
    updateKeywordsList();
    currentPage = 1;
    renderNews();
}

function saveKeywords() {
    saveToLocalStorage('blockedKeywords', blockedKeywords);
    saveToLocalStorage('requiredKeywords', requiredKeywords);
}

// "× word" lists: search terms under the search bar, avoided words in settings
function fillRemoveList(id, keywords, kind) {
    const container = document.getElementById(id);
    if (!container) return;

    container.innerHTML = '';
    keywords.forEach(keyword => {
        const item = document.createElement('li');
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = keyword;
        remove.title = kind === 'required' ? `Stop searching for "${keyword}"` : `Stop avoiding "${keyword}"`;
        remove.setAttribute('aria-label', `Remove "${keyword}"`);
        remove.addEventListener('click', () => removeKeyword(keyword, kind));
        item.appendChild(remove);
        container.appendChild(item);
    });
}

function updateKeywordsList() {
    renderSidebarKeywords();
    fillRemoveList('keywordsList', requiredKeywords, 'required');
    renderKeywordList();
    renderDefaults();
}

// What kind of match a keyword is, shown on its tag
function keywordKind(keyword) {
    if (isExactKeyword(keyword)) return 'exact';
    if (keyword.includes('*')) return 'wildcard';
    if (keyword.includes(' ')) return 'phrase';
    return 'word';
}

// A keyword as a tag: the word and × (or + first, for an example). Its kind
// (word, phrase, wildcard, exact) is the hover text.
function createKeywordTag(keyword, active) {
    const tag = document.createElement('span');
    tag.className = active ? 'kw-tag-item' : 'kw-tag-item kw-tag-item--example';
    const word = document.createElement('span');
    word.className = 'kw-tag-item__word';
    word.textContent = keyword;
    tag.title = `${keywordKind(keyword)} match`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'kw-tag-item__action';
    button.textContent = active ? '×' : '+';
    button.setAttribute('aria-label', active ? `Stop redacting ${keyword}` : `Redact ${keyword}`);
    button.title = button.getAttribute('aria-label');
    button.addEventListener('click', () => (active ? removeKeyword(keyword, 'blocked') : addToKeywordList('blocked', keyword)));
    if (active) tag.append(word, button);
    else tag.append(button, word);
    return tag;
}

// Settings → Redacted keywords: your keywords as tags under the input
function renderKeywordList() {
    const list = document.getElementById('settingsBlocked');
    if (!list) return;
    list.replaceChildren(...blockedKeywords.map(keyword => createKeywordTag(keyword, true)));
    list.hidden = blockedKeywords.length === 0;
    renderKeywordSuggestions();
}

// Examples you haven't added yet, one of each kind, as + tags. Adding one moves
// it under Keywords; once any is in use the rest collapse (the toggle reopens them).
let keywordExamplesOpen = null;   // null: open until an example is used

function renderKeywordSuggestions() {
    const list = document.getElementById('keywordSuggestions');
    if (!list) return;
    const left = EXAMPLE_KEYWORDS.filter(keyword => !blockedKeywords.includes(keyword));
    list.replaceChildren(...left.map(keyword => createKeywordTag(keyword, false)));
    const wrap = document.getElementById('keywordExamples');
    if (wrap) wrap.hidden = left.length === 0;
    const open = keywordExamplesOpen ?? left.length === EXAMPLE_KEYWORDS.length;
    document.getElementById('keywordExamplesBody')?.classList.toggle('is-open', open);
    document.getElementById('keywordExamplesToggle')?.setAttribute('aria-expanded', String(open));
}

function toggleKeywordExamples() {
    const body = document.getElementById('keywordExamplesBody');
    keywordExamplesOpen = !body?.classList.contains('is-open');
    renderKeywordSuggestions();
}

const keywordPatternCache = new Map();

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word matching. `*` stands for any letters or digits (so *ai matches
// "OpenAI"); a "quoted" keyword matches exactly: capitals count and * is literal
function keywordPattern(keyword) {
    if (!keywordPatternCache.has(keyword)) {
        const exact = isExactKeyword(keyword);
        const text = exact ? keyword.slice(1, -1) : keyword;
        const body = text
            .split(' ')
            .map(word => (exact ? escapeRegExp(word) : word.split('*').map(escapeRegExp).join('[\\p{L}\\p{N}]*')))
            .join('\\s+');
        keywordPatternCache.set(keyword, new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, exact ? 'u' : 'iu'));
    }
    return keywordPatternCache.get(keyword);
}

function matchesKeyword(text, keyword) {
    return Boolean(text) && keywordPattern(keyword).test(text);
}

function articleText(article) {
    if (settings.scanMode === 'title') return article.title || '';
    return [article.title, article.description, article.content].filter(Boolean).join('\n');
}

// Returns why an article is hidden (an avoided keyword), or null
function hiddenReason(article) {
    const blocked = blockedKeywords.find(keyword => matchesKeyword(articleText(article), keyword));
    return blocked ? `avoided: ${blocked}` : null;
}

// With search terms set, only articles that mention one of them are found.
// Articles that don't match aren't "hidden"; they're just not what you searched for.
function matchesSearch(article) {
    if (requiredKeywords.length === 0) return true;
    const text = articleText(article);
    return requiredKeywords.some(keyword => matchesKeyword(text, keyword));
}

// ==============================================
// NEWS LOADING & FILTERING
// ==============================================

async function loadNews() {
    const requestId = ++loadRequestId;
    const loading = document.getElementById('loading');
    const newsContainer = document.getElementById('newsContainer');
    const summary = document.getElementById('feedSummary');

    if (newsContainer) newsContainer.innerHTML = '';
    if (summary) summary.style.display = 'none';
    renderPager(0);
    currentPage = 1;

    if (selectedSources.length === 0) {
        currentArticles = [];
        if (loading) loading.style.display = 'none';
        showNoResults('Pick at least one source to see the news you already agree with.');
        return;
    }

    if (loading) loading.style.display = 'block';

    try {
        const { articles, failed } = await fetchNews(selectedSources);
        if (requestId !== loadRequestId) return;

        currentArticles = articles;
        lastFailedSources = failed;
        if (failed.length > 0) {
            console.warn('Sources with no articles right now:', failed);
        }
        renderNews();
    } catch (error) {
        if (requestId !== loadRequestId) return;
        console.error('Failed to load news:', error);
        showError('Failed to load news. Please check your internet connection and try again.');
    } finally {
        if (requestId === loadRequestId && loading) loading.style.display = 'none';
    }
}

// Applies topics, timeframe and keywords to the already-fetched articles
function renderNews() {
    const empty = Object.keys(FILTER_GROUPS).find(key => settings[key].length === 0);
    if (empty) {
        renderSummary(0, []);
        renderPager(0);
        showNoResults(`Pick at least one ${FILTER_GROUPS[empty].noun} in the sidebar.`);
        return;
    }

    const now = Date.now();
    const inView = newestFirst(currentArticles).filter(article =>
        withinTimeframe(article, now)
        && articleTopics(article).some(topic => settings.topics.includes(topic))
        && (!settings.useBias || settings.biasLevels.includes(articleBiasLevel(article)))
        && (!settings.useMood || settings.moods.includes(article.mood || 'neutral'))
        && matchesSearch(article)
        && matchesViewFilters(article));

    const shown = [];
    const hidden = [];
    inView.forEach(article => {
        const reason = unhiddenUrls.has(article.url) ? null : hiddenReason(article);
        if (reason) {
            hidden.push({ article, reason });
        } else {
            shown.push(article);
        }
    });

    const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
    currentPage = Math.min(Math.max(1, currentPage), pageCount);
    const start = (currentPage - 1) * PAGE_SIZE;
    const visible = shown.slice(start, start + PAGE_SIZE);

    renderSummary(shown.length, hidden);
    renderPager(shown.length);

    if (visible.length === 0) {
        showNoResults();
        return;
    }

    displayNews(visible);
}

// "ദ്ദി(˵ •̀ ᴗ - ˵ ) ✧ Displaying 87 articles (16 hidden)", with "16 hidden ⌄"
// on the right opening the list of what was hidden and why
function renderSummary(shownCount, hidden) {
    const seeHidden = document.getElementById('seeHidden');
    if (seeHidden) {
        seeHidden.textContent = `See hidden (${hidden.length})`;
        seeHidden.disabled = hidden.length === 0;
    }
    const summary = document.getElementById('feedSummary');
    const status = document.getElementById('status');
    const toggle = document.getElementById('hiddenToggle');
    const list = document.getElementById('hiddenList');
    if (!summary || !status || !toggle || !list) return;

    const hiddenText = hidden.length > 0 ? ` (${hidden.length} hidden)` : '';
    status.textContent = `ദ്ദി(˵ •̀ ᴗ - ˵ ) ✧ Displaying ${shownCount} article${shownCount === 1 ? '' : 's'}${hiddenText}`;
    if (lastFailedSources.length > 0) {
        status.appendChild(document.createElement('br'));
        status.append(`Currently unreachable: ${lastFailedSources.join(', ')}`);
    }

    toggle.textContent = hidden.length > 0 ? `${hidden.length} hidden` : '';
    summary.classList.toggle('summary-bar--static', hidden.length === 0);
    if (hidden.length === 0) summary.open = false;

    list.innerHTML = '';
    hidden.forEach(({ article, reason }) => {
        const item = document.createElement('li');

        const title = document.createElement('span');
        title.className = 'summary-bar__title';
        title.textContent = `${article.title} (${article.source})`;

        const why = document.createElement('span');
        why.className = 'summary-bar__reason';
        why.textContent = reason;

        const showAnyway = document.createElement('button');
        showAnyway.type = 'button';
        showAnyway.className = 'link-btn';
        showAnyway.textContent = 'show anyway';
        showAnyway.addEventListener('click', () => {
            unhiddenUrls.add(article.url);
            renderNews();
        });

        item.append(title, why, showAnyway);
        list.appendChild(item);
    });

    summary.style.display = '';
}

// ==============================================
// PAGINATION: First, Previous, 1 … 4 [5] 6 … 20, Next, Last
// ==============================================

function renderPager(total) {
    const pager = document.getElementById('pager');
    if (!pager) return;

    pager.innerHTML = '';
    const pageCount = Math.ceil(total / PAGE_SIZE);
    if (pageCount <= 1) return;

    const button = (label, page, { current = false, ariaLabel } = {}) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pager__btn';
        btn.textContent = label;
        if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
        if (current) {
            btn.setAttribute('aria-current', 'page');
            btn.disabled = true;
        } else {
            btn.disabled = page < 1 || page > pageCount || page === currentPage;
            btn.addEventListener('click', () => goToPage(page));
        }
        return btn;
    };
    const gap = () => {
        const span = document.createElement('span');
        span.className = 'pager__gap';
        span.textContent = '…';
        return span;
    };

    const start = document.createElement('span');
    start.className = 'pager__edge';
    start.append(
        button('« First', 1, { ariaLabel: 'First page' }),
        button('‹ Previous', currentPage - 1, { ariaLabel: 'Previous page' })
    );
    const numbers = document.createElement('span');
    numbers.className = 'pager__numbers';
    pager.append(start, numbers);

    // Always the first and last page, and four either side of the current one
    const pages = new Set([1, pageCount]);
    for (let page = currentPage - 4; page <= currentPage + 4; page++) {
        if (page >= 1 && page <= pageCount) pages.add(page);
    }
    let previous = 0;
    [...pages].sort((a, b) => a - b).forEach(page => {
        if (page - previous > 1) numbers.appendChild(gap());
        numbers.appendChild(button(String(page), page, { current: page === currentPage, ariaLabel: `Page ${page}` }));
        previous = page;
    });

    const end = document.createElement('span');
    end.className = 'pager__edge';
    end.append(
        button('Next ›', currentPage + 1, { ariaLabel: 'Next page' }),
        button('Last »', pageCount, { ariaLabel: 'Last page' })
    );
    pager.appendChild(end);

    const summary = document.createElement('p');
    summary.className = 'pager__summary';
    const first = (currentPage - 1) * PAGE_SIZE + 1;
    summary.textContent = `Page ${currentPage} of ${pageCount} · articles ${first}–${Math.min(total, first + PAGE_SIZE - 1)} of ${total}`;
    pager.appendChild(summary);
}

function goToPage(page) {
    currentPage = page;
    renderNews();
    document.querySelector('.newsroom-bar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ==============================================
// CARDS
// ==============================================

// No article image: show the outlet's wordmark, large, on a plain panel (the
// square icon is already in the card's corner)
function createImagePlaceholder(sourceName) {
    const placeholder = document.createElement('div');
    placeholder.className = 'card__placeholder';
    placeholder.appendChild(createLogo(sourcesByName.get(sourceName), sourceName, 'logo', { keepWide: true }));
    return placeholder;
}

// Only link to http(s) URLs so a feed can't smuggle in javascript: links
function safeUrl(url) {
    return url && /^https?:\/\//i.test(url) ? url : null;
}

function createNewsCard(article) {
    const card = document.createElement('article');
    card.className = 'card';

    const meta = document.createElement('div');
    meta.className = 'card__meta';

    const date = document.createElement('time');
    date.dateTime = article.publishedAt;
    date.textContent = formatPublished(article.publishedAt);
    date.title = new Date(article.publishedAt).toLocaleString();

    // The square icon in the corner; the wordmark fills the image space when there's no photo
    meta.append(createLogo(sourcesByName.get(article.source), article.source, 'icon'), date);
    // 🔒 on articles from a paywalled outlet you don't subscribe to
    const cardSource = sourcesByName.get(article.source);
    if (cardSource?.paywall && !settings.subscriptions.includes(cardSource.id)) {
        const lock = document.createElement('span');
        lock.className = 'card__lock';
        lock.textContent = '🔒';
        lock.title = `${cardSource.name} is paywalled. Tick it under Settings → Advanced settings if you subscribe.`;
        date.before(lock);
    }

    const media = document.createElement('div');
    media.className = 'card__media';
    if (article.urlToImage) {
        const image = document.createElement('img');
        image.src = article.urlToImage;
        image.alt = '';
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => image.replaceWith(createImagePlaceholder(article.source)), { once: true });
        media.appendChild(image);
    } else {
        media.appendChild(createImagePlaceholder(article.source));
    }

    const title = document.createElement('h3');
    title.className = 'card__title';
    const href = safeUrl(article.url);
    if (href) {
        // The title link stretches over the whole card (see .card__link in system.css)
        const link = document.createElement('a');
        link.className = 'card__link';
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = article.title;
        title.appendChild(link);
    } else {
        title.textContent = article.title;
    }

    card.append(meta, media, title);

    if (article.description) {
        const excerpt = document.createElement('p');
        excerpt.className = 'card__excerpt';
        excerpt.textContent = article.description;
        card.appendChild(excerpt);
    }

    if (href) {
        const more = document.createElement('span');
        more.className = 'card__more';
        more.setAttribute('aria-hidden', 'true');
        more.textContent = `Read more on ${article.source} ↗`;
        card.appendChild(more);
    }

    return card;
}

function displayNews(articles) {
    const newsContainer = document.getElementById('newsContainer');
    if (!newsContainer) return;

    newsContainer.innerHTML = '';
    articles.forEach(article => newsContainer.appendChild(createNewsCard(article)));
}

function showNoResults(message = 'Nothing survived your filters, or the selected sources are unreachable.') {
    const newsContainer = document.getElementById('newsContainer');
    if (!newsContainer) return;

    newsContainer.innerHTML = `
        <div class="grid-message">
            <h3>ᯓ★ No articles available</h3>
            <p id="noResultsMessage"></p>
            <ul>
                <li><strong>Pour quoi?</strong></li>
                <li>⤷ Your filters caught everything (congratulations)</li>
                <li>⤷ Nothing this recent (try a longer timeframe in Settings)</li>
                <li>⤷ The selected feeds are temporarily unavailable</li>
            </ul>
            <div class="actions">
                <button class="btn btn--primary" type="button" onclick="loadNews()">↻ Try again</button>
                <button class="btn" type="button" onclick="openSettings('sources')">Choose sources</button>
            </div>
        </div>
    `;
    document.getElementById('noResultsMessage').textContent = message;
}

// ==============================================
// UTILITY FUNCTIONS
// ==============================================

// ----------------------------------------------
// DEFAULTS: a starting point you can change; "Reset to default" restores it
// ----------------------------------------------

const FACTORY_DEFAULTS = {
    selectedSources: [...DEFAULT_SOURCES],
    blockedKeywords: [...DEFAULT_BLOCKED],   // *ai, trump, "ICE", guilty
    topics: ['world', 'politics', 'technology'],
    useBias: false,
    useMood: false,
    biasLevels: BIAS_LEVELS.map(level => level.id),
    moods: MOODS.map(mood => mood.id)
};

function normalizeDefaults(saved) {
    const d = { ...FACTORY_DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
    return {
        // Before the outlet list loads, keep the ids as they are (checked again once it has)
        selectedSources: sourceCatalog.length ? normalizeSourceIds(d.selectedSources)
            : (Array.isArray(d.selectedSources) ? d.selectedSources.filter(id => typeof id === 'string') : []),
        blockedKeywords: (Array.isArray(d.blockedKeywords) ? d.blockedKeywords : []).map(normalizeKeyword).filter(Boolean),
        topics: normalizeTopics(d.topics),
        useBias: d.useBias === true,
        useMood: d.useMood === true,
        biasLevels: Array.isArray(d.biasLevels) ? d.biasLevels : FACTORY_DEFAULTS.biasLevels,
        moods: Array.isArray(d.moods) ? d.moods : FACTORY_DEFAULTS.moods
    };
}

let userDefaults = normalizeDefaults(loadFromLocalStorage('defaults', null));

function currentSetup() {
    return normalizeDefaults({
        selectedSources, blockedKeywords, topics: settings.topics,
        useBias: settings.useBias, useMood: settings.useMood,
        biasLevels: settings.biasLevels, moods: settings.moods
    });
}

function sameSetup(a, b) {
    const same = (x, y) => JSON.stringify([...x].sort()) === JSON.stringify([...y].sort());
    return same(a.selectedSources, b.selectedSources) && same(a.blockedKeywords, b.blockedKeywords)
        && same(a.topics, b.topics) && a.useBias === b.useBias && a.useMood === b.useMood
        && (!a.useBias || same(a.biasLevels, b.biasLevels)) && (!a.useMood || same(a.moods, b.moods));
}

// "Reset to default": your saved defaults (or the original ones)
function resetToDefaults() {
    const d = userDefaults;
    blockedKeywords = [...d.blockedKeywords];
    requiredKeywords = [];
    selectedSources = [...d.selectedSources];
    settings.topics = [...d.topics];
    settings.useBias = d.useBias;
    settings.useMood = d.useMood;
    settings.biasLevels = [...d.biasLevels];
    settings.moods = [...d.moods];
    unhiddenUrls.clear();
    tablePages.feed = 1;

    updateKeywordsList();
    renderFilters();
    renderSources();
    applySettings();

    saveKeywords();
    saveSettings();
    saveToLocalStorage('selectedSources', selectedSources);

    loadNews();
    showSuccess('Reset to your defaults ✧');
}

function saveCurrentAsDefaults() {
    userDefaults = currentSetup();
    saveToLocalStorage('defaults', userDefaults);
    renderDefaults();
    showSuccess('Saved as your default ✧');
}

function restoreFactoryDefaults() {
    userDefaults = normalizeDefaults(FACTORY_DEFAULTS);
    saveToLocalStorage('defaults', userDefaults);
    renderDefaults();
    showSuccess('Original defaults restored; press "Reset to default" to apply them');
}

// What the defaults hold, and whether the current setup matches them
function renderDefaults() {
    const summary = document.getElementById('defaultsSummary');
    if (!summary) return;
    const d = userDefaults;
    const names = ids => ids.map(sourceById).filter(Boolean).map(source => source.name);
    const topicNames = d.topics.length === TOPIC_IDS.length ? 'All topics'
        : d.topics.map(id => TOPICS.find(topic => topic.id === id)?.name).filter(Boolean).join(', ') || 'None';
    const sources = names(d.selectedSources);
    const rows = [
        ['Sources', sources.length ? `${sources.length}: ${sources.join(', ')}` : 'None'],
        ['Topics', topicNames],
        ['Redacted', d.blockedKeywords.length ? d.blockedKeywords.join(', ') : 'Nothing'],
        ['Bias', d.useBias ? `On (${d.biasLevels.length === 1 ? d.biasLevels[0] : 'all'})` : 'Off'],
        ['Mood', d.useMood ? `On (${d.moods.length === 1 ? d.moods[0] : 'all'})` : 'Off']
    ];
    // A small table: a header band, one row per setting, then a status line
    const matches = sameSetup(currentSetup(), d);
    const head = document.createElement('div');
    head.className = 'defaults-table__head';
    head.innerHTML = '<span>Setting</span><span>Default</span>';
    summary.replaceChildren(head, ...rows.map(([label, value]) => {
        const row = document.createElement('div');
        row.className = 'defaults-table__row';
        const name = document.createElement('span');
        name.className = 'defaults-table__label';
        name.textContent = label;
        const val = document.createElement('span');
        val.className = 'defaults-table__value';
        val.textContent = value;
        row.append(name, val);
        return row;
    }));
    const status = document.createElement('div');
    status.className = matches ? 'defaults-table__status defaults-table__status--same' : 'defaults-table__status';
    status.textContent = matches ? '✓ Your current setup matches your defaults.' : '● Your current setup differs from your defaults.';
    summary.appendChild(status);
    const reset = document.getElementById('resetToDefaultsButton');
    if (reset) reset.disabled = matches;
}

function exportSettings() {
    const exportData = {
        blockedKeywords,
        requiredKeywords,
        selectedSources,
        favoriteSources,
        settings,
        defaults: userDefaults,
        exportDate: new Date().toISOString(),
        version: '6.0'
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    link.download = `self-censored-settings-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
}

function importSettings(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importData = JSON.parse(e.target.result);

            if (Array.isArray(importData.blockedKeywords)) {
                blockedKeywords = importData.blockedKeywords.map(normalizeKeyword).filter(Boolean);
            }
            if (Array.isArray(importData.requiredKeywords)) {
                requiredKeywords = importData.requiredKeywords.map(normalizeKeyword).filter(Boolean);
            }
            if (importData.selectedSources) selectedSources = normalizeSourceIds(importData.selectedSources);
            if (importData.favoriteSources) favoriteSources = normalizeSourceIds(importData.favoriteSources);
            if (importData.settings) settings = migrateSettings({ ...settings, ...importData.settings });
            if (importData.defaults) {
                userDefaults = normalizeDefaults(importData.defaults);
                saveToLocalStorage('defaults', userDefaults);
            }

            saveKeywords();
            saveToLocalStorage('selectedSources', selectedSources);
            saveToLocalStorage('favoriteSources', favoriteSources);
            saveSettings();

            applySettings();
            updateKeywordsList();
            renderFilters();
            renderSources();
            loadNews();

            showSuccess('Settings imported successfully!');

        } catch (error) {
            showError('Invalid settings file. Please check the file and try again.');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// ==============================================
// SETTINGS MANAGEMENT
// ==============================================

// section: 'sources' | 'topics' | 'keywords' | 'source:<id>' (that outlet's page)
// Settings is its own page (#settings): tabs across the top, and each tab's
// sections listed on the left (click one to jump to it)
const SETTINGS_SECTIONS = {
    keywords: ['preferences', 'settingsKeywordsSection'],
    topics: ['preferences', 'settingsTopicsSection'],
    sources: ['preferences', 'settingsSourcesSection'],
    bias: ['preferences', 'settingsBiasSection'],
    mood: ['preferences', 'settingsMoodSection'],
    spectrum: ['preferences', 'settingsSpectrumSection'],
    appearance: ['appearance'],
    preferences: ['preferences'],
    advanced: ['advanced'],
    defaults: ['advanced', 'settingsDefaultsSection'],
    data: ['advanced', 'settingsDataSection'],
    contact: ['contact']
};
const SETTINGS_SUBNAV = {
    appearance: [['settingsAppearanceSection', 'Theme']],
    preferences: [['settingsTopicsSection', 'Topics'], ['settingsSourcesSection', 'Sources'], ['settingsKeywordsSection', 'Redacted keywords'], ['settingsSpectrumSection', 'The Spectrum']],
    advanced: [['settingsAdvancedSection', 'Feed'], ['settingsDataSection', 'Your data'], ['settingsDefaultsSection', 'Defaults']],
    contact: [['settingsContactSection', 'Contact']]
};
let settingsGroup = 'preferences';
let subnavHold = null;   // a clicked section stays highlighted until the next manual scroll

function settingsOpen() {
    return location.hash.startsWith('#settings');
}

// Open Settings (optionally at a section, e.g. 'sources' or 'source:nyt')
function openSettings(section) {
    detailSourceId = null;
    const target = section ? `#settings/${section}` : '#settings';
    if (location.hash !== target) history.pushState(null, '', target);
    showSettingsPage(section);
}

// s*lf: back to the feed without reloading the page, so nothing unsaved is lost
function goHome(event) {
    event.preventDefault();
    if (settingsOpen()) closeSettings();
    else window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeSettings(event) {
    event?.preventDefault();
    if (!settingsOpen()) return;
    history.pushState(null, '', location.pathname + location.search);
    showSettingsPage(null, false);
}

// Swap the feed for the Settings page (or back), from the URL
function showSettingsPage(section = location.hash.slice('#settings/'.length) || null, open = settingsOpen()) {
    setTimeout(alignSidebarNav, 0);
    const page = document.getElementById('settingsPage');
    if (!page) return;
    page.hidden = !open;
    document.querySelector('.title-block').hidden = open;   // tabs stay; the site title is for the feed
    document.querySelector('.content').hidden = open;
    document.querySelector('.sidebar__settings')?.setAttribute('aria-current', open ? 'page' : 'false');
    document.getElementById('navNewsroom')?.setAttribute('aria-current', open ? 'false' : 'page');
    document.querySelector('.site-tabs__link')?.setAttribute('aria-current', open ? 'page' : 'false');
    if (!open) {
        closeSourceFilters();   // the library and its ticks stay as they were for when you come back
        window.scrollTo(0, 0);
        return;
    }

    document.getElementById('sourceDetail').hidden = true;
    document.getElementById('settingsMain').hidden = false;
    renderSettingsSources();

    if (section?.startsWith('source:')) {
        showSettingsGroup('preferences');
        openSourceDetail(section.slice('source:'.length));
        return;
    }
    // A table view address (#settings/sources/add/grid): open Sources in that view
    if (section?.startsWith('sources/')) {
        showSettingsGroup('preferences');
        jumpToSetting('settingsSourcesSection');
        restoreTableView(location.hash);
        return;
    }
    const [group, target] = SETTINGS_SECTIONS[section] || [settingsGroup];
    showSettingsGroup(group);
    if (target) jumpToSetting(target);
    if (section === 'keywords') document.getElementById('settingsKeywordInput')?.focus({ preventScroll: true });
}

window.addEventListener('popstate', () => setTimeout(alignSidebarNav, 50));
window.addEventListener('popstate', () => {
    // Moving between table views on an open Settings page: just switch the view
    if (location.hash.startsWith('#settings/sources/') && !document.getElementById('settingsPage').hidden) {
        restoreTableView(location.hash);
        return;
    }
    showSettingsPage();
});

// Show one tab's sections, and its section list on the left
function showSettingsGroup(group) {
    settingsGroup = group;
    document.querySelectorAll('.settings-group').forEach(el => { el.hidden = el.dataset.group !== group; });
    document.querySelectorAll('.settings-tabs__tab').forEach(tab => {
        tab.setAttribute('aria-current', tab.dataset.group === group ? 'page' : 'false');
    });
    const nav = document.getElementById('settingsSubnav');
    if (nav) {
        nav.replaceChildren(...(SETTINGS_SUBNAV[group] || []).map(([id, label]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'settings-nav__item';
            button.dataset.target = id;
            button.textContent = label;
            button.addEventListener('click', () => jumpToSetting(id));
            return button;
        }));
    }
    if (GROUP_PANES[group]) showPrefPane(GROUP_PANES[group]);
    scrollToSettingsTop();
    updateSettingsSubnav();
}

// The top of the Settings page (on phones the sidebar sits above it)
function scrollToSettingsTop() {
    const page = document.getElementById('settingsPage');
    const stacked = getComputedStyle(document.querySelector('.sidebar')).position !== 'sticky';   // phones
    if (page && stacked) window.scrollTo(0, Math.max(0, page.getBoundingClientRect().top + window.scrollY - 40));
    else window.scrollTo(0, 0);
}

// A section link jumps to its section on the page
// Configure shows one section at a time (its item in the list on the left);
// The Spectrum holds Bias and Mood
const PREF_PANES = {
    settingsTopicsSection: ['settingsTopicsSection'],
    settingsSourcesSection: ['settingsSourcesSection'],
    settingsKeywordsSection: ['settingsKeywordsSection'],
    settingsSpectrumSection: ['settingsSpectrumSection', 'settingsBiasSection', 'settingsMoodSection'],
    settingsAdvancedSection: ['settingsAdvancedSection'],
    settingsDataSection: ['settingsDataSection'],
    settingsDefaultsSection: ['settingsDefaultsSection']
};
const GROUP_PANES = { preferences: 'settingsTopicsSection', advanced: 'settingsAdvancedSection' };   // each tab's open section
let prefPane = 'settingsTopicsSection';

function paneOf(id) {
    return Object.keys(PREF_PANES).find(pane => PREF_PANES[pane].includes(id));
}

function showPrefPane(pane) {
    prefPane = pane;
    const group = document.getElementById(pane)?.closest('.settings-group')?.dataset.group;
    if (group) GROUP_PANES[group] = pane;
    // Hide the other sections of this pane's tab
    const siblings = Object.keys(PREF_PANES).filter(other => document.getElementById(other)?.closest('.settings-group')?.dataset.group === group);
    siblings.forEach(other => PREF_PANES[other].forEach(id => {
        const section = document.getElementById(id);
        if (section) section.hidden = other !== pane;
    }));
}

function jumpToSetting(id) {
    const target = document.getElementById(id);
    if (!target) return;
    const pane = paneOf(id);
    if (pane) {
        showPrefPane(pane);
        updateSettingsSubnav(pane);
        // Stay put, with the heading in view: only scroll if the section's top is off screen
        const top = document.querySelector('.settings-layout')?.getBoundingClientRect().top ?? 0;
        if (top < 0) scrollToSettingsTop();
        return;
    }
    subnavHold = { id, until: Date.now() + 600 };
    target.scrollIntoView({ block: 'start' });
    updateSettingsSubnav(id);
}

// Highlight the section at the top of the window
function updateSettingsSubnav(forced) {
    const buttons = [...document.querySelectorAll('#settingsSubnav [data-target]')];
    if (buttons.length === 0) return;
    let current = GROUP_PANES[settingsGroup] || forced;
    if (!current) {
        const top = 160;
        current = buttons[0].dataset.target;
        buttons.forEach(button => {
            const section = document.getElementById(button.dataset.target);
            if (section && section.getBoundingClientRect().top <= top) current = button.dataset.target;
        });
        // Scrolled to the very bottom: the last section is current
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = buttons[buttons.length - 1].dataset.target;
    }
    buttons.forEach(button => button.setAttribute('aria-current', button.dataset.target === current ? 'true' : 'false'));
}

window.addEventListener('scroll', () => {
    if (!settingsOpen()) return;
    if (subnavHold && Date.now() < subnavHold.until) updateSettingsSubnav(subnavHold.id);
    else updateSettingsSubnav();
}, { passive: true });

function updateScanMode(mode) {
    settings.scanMode = mode === 'title' ? 'title' : 'all';
    saveSettings();
    currentPage = 1;
    renderNews();
}

function setTimeframe(timeframe) {
    settings.timeframe = timeframe in TIMEFRAMES ? timeframe : DEFAULT_SETTINGS.timeframe;
    saveSettings();
    currentPage = 1;
    renderNews();
}

// ----------------------------------------------
// APPEARANCE: light, dark, or sync with the system
// ----------------------------------------------

const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)');

function setTheme(theme) {
    settings.theme = ['light', 'dark', 'system'].includes(theme) ? theme : 'light';
    applyTheme();
    saveSettings();
}

function applyTheme() {
    const osDark = Boolean(systemDark?.matches);
    settings.darkMode = settings.theme === 'dark' || (settings.theme === 'system' && osDark);
    document.body.classList.toggle('dark', settings.darkMode);
    document.querySelectorAll('[data-theme-choice]').forEach(choice => {
        choice.setAttribute('aria-pressed', String(choice.dataset.themeChoice === settings.theme));
    });
    const note = document.getElementById('themeSyncNote');
    if (note) note.textContent = `Currently rendering as ${osDark ? 'dark' : 'light'} based on your OS preference.`;
}

systemDark?.addEventListener?.('change', applyTheme);

function setAutoRefresh(minutes) {
    settings.refreshMinutes = [0, 15, 30, 60].includes(Number(minutes)) ? Number(minutes) : 0;
    saveSettings();
    startAutoRefresh();
}

function toggleHideInactiveSources() {
    const checkbox = document.getElementById('hideInactiveSources');
    if (checkbox) {
        settings.hideInactiveSources = checkbox.checked;
        saveSettings();
        renderSettingsSources();
    }
}

// (Re)starts the refresh timer at the chosen interval; 0 leaves it off
function startAutoRefresh() {
    stopAutoRefresh();
    if (!settings.refreshMinutes) return;
    autoRefreshInterval = setInterval(() => {
        console.log('Auto-refreshing news...');
        loadNews();
    }, settings.refreshMinutes * 60 * 1000);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

// ==============================================
// ERROR HANDLING & NOTIFICATIONS
// ==============================================

function showError(message) {
    const errorMessage = document.getElementById('errorMessage');
    const errorModal = document.getElementById('errorModal');
    if (errorMessage) errorMessage.textContent = message;
    if (errorModal) {
        errorModal.style.display = 'flex';
        document.body.classList.add('modal-open');
    }
}

function closeErrorModal() {
    const errorModal = document.getElementById('errorModal');
    if (errorModal) errorModal.style.display = 'none';
    document.body.classList.remove('modal-open');
}

function showSuccess(message) {
    const notification = document.createElement('div');
    notification.className = 'toast';
    notification.setAttribute('role', 'status');
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// ==============================================
// EVENT LISTENERS & STARTUP
// ==============================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeTableModal();
        if (pendingSourcesChange) cancelSourcesChange();
        closeMenus();
        closeSourceFilters();
        closeErrorModal();
        closeSourcePicker(false);
    }
});

window.addEventListener('resize', () => fitSidebarFavorites());

// Clicking the dimmed backdrop closes a modal
document.addEventListener('click', function(event) {
    if (event.target.classList?.contains('modal')) {
        closeTableModal();
        closeErrorModal();
        closeSourcePicker(false);
    }
});

// Clicking anywhere else closes an open "+ add more" menu or the Filters popover
document.addEventListener('click', function(event) {
    if (!event.target.closest?.('.sidebar__add')) closeMenus();
    if (!event.target.closest?.('.filter-pop')) closeSourceFilters();
});

// With nothing hidden, the summary line has nothing to open
document.addEventListener('click', function(event) {
    const summary = event.target.closest?.('#feedSummary > summary');
    if (summary && summary.parentElement.classList.contains('summary-bar--static')) event.preventDefault();
});

// ----------------------------------------------
// SOURCES FOOTER: "Clear all" and "Reset" ask first; Save applies
// ----------------------------------------------

let pendingSourcesChange = null;

function askSourcesChange(kind) {
    pendingSourcesChange = kind;
    const n = selectedSources.length;
    const defaults = userDefaults.selectedSources.map(sourceById).filter(Boolean).map(source => source.name);
    const text = kind === 'clear'
        ? `Are you sure? This takes all ${n} source${n === 1 ? '' : 's'} out of your feed, which stays empty until you add some.`
        : `Are you sure? This replaces your ${n} source${n === 1 ? '' : 's'} with your default ${defaults.length}: ${defaults.join(', ')}.`;
    document.getElementById('sourcesConfirmText').textContent = text;
    const bar = document.getElementById('sourcesConfirm');
    bar.hidden = false;
    bar.querySelector('.btn--primary').focus();
}

function cancelSourcesChange() {
    pendingSourcesChange = null;
    document.getElementById('sourcesConfirm').hidden = true;
}

function applySourcesChange() {
    if (pendingSourcesChange === 'clear') selectedSources = [];
    if (pendingSourcesChange === 'reset') selectedSources = [...userDefaults.selectedSources];
    cancelSourcesChange();
    tablePages.feed = 1;
    sourcesChanged();
    showSuccess('Sources saved ✧');
}

// ----------------------------------------------
// FEED TABS: small dropdown menus above the feed
// ----------------------------------------------

function closeNavMenus() {
    document.querySelectorAll('.nav-menu__panel').forEach(panel => { panel.hidden = true; });
    document.querySelectorAll('.nav-menu__tab').forEach(tab => tab.setAttribute('aria-expanded', 'false'));
}

function toggleNavMenu(event, key) {
    event.stopPropagation();
    const panel = document.getElementById(`navMenu-${key}`);
    const opening = panel.hidden;
    closeNavMenus();
    panel.hidden = !opening;
    event.currentTarget.setAttribute('aria-expanded', String(opening));
}

document.addEventListener('click', event => {
    if (!event.target.closest?.('.nav-menu')) closeNavMenus();
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeNavMenus();
});

// ----------------------------------------------
// NEWSROOM FILTER: narrow the feed to part of your current setup (your topics,
// sources, bias, mood). Just for this view: nothing in Settings changes.
// ----------------------------------------------

const viewFilters = { topics: [], sources: [], bias: [], mood: [] };   // empty = all

function matchesViewFilters(article) {
    const source = sourcesByName.get(article.source);
    return (viewFilters.topics.length === 0 || articleTopics(article).some(topic => viewFilters.topics.includes(topic)))
        && (viewFilters.sources.length === 0 || (source && viewFilters.sources.includes(source.id)))
        && (viewFilters.bias.length === 0 || viewFilters.bias.includes(articleBiasLevel(article)))
        && (viewFilters.mood.length === 0 || viewFilters.mood.includes(article.mood || 'neutral'));
}

// Only choices from your current configuration
function viewFilterGroups() {
    const yourSources = selectedSources.map(sourceById).filter(Boolean).sort(byPopularity);
    return [
        { key: 'topics', label: 'Topics', options: TOPICS.filter(topic => settings.topics.includes(topic.id)).map(topic => [topic.id, topic.name]) },
        { key: 'sources', label: 'Sources', options: yourSources.map(source => [source.id, source.name]) },
        { key: 'bias', label: 'Bias', options: BIAS_LEVELS.filter(level => level.id !== 'unrated' && (!settings.useBias || settings.biasLevels.includes(level.id))).map(level => [level.id, level.name]) },
        { key: 'mood', label: 'Mood', options: MOODS.filter(mood => !settings.useMood || settings.moods.includes(mood.id)).map(mood => [mood.id, mood.name]) }
    ].filter(group => group.options.length > 1);
}

function renderViewFilters() {
    const panel = document.getElementById('viewFilters');
    const badge = document.getElementById('viewFiltersCount');
    if (!panel) return;
    const groups = viewFilterGroups();
    // Drop picks that are no longer part of your setup
    Object.keys(viewFilters).forEach(key => {
        const allowed = groups.find(group => group.key === key)?.options.map(([id]) => id) || [];
        viewFilters[key] = viewFilters[key].filter(id => allowed.includes(id));
    });
    const active = Object.values(viewFilters).filter(list => list.length > 0).length;
    if (badge) {
        badge.hidden = active === 0;
        badge.textContent = active;
    }

    panel.innerHTML = '';
    const note = document.createElement('p');
    note.className = 'filter-pop__note';
    note.textContent = 'From your current setup. Just for this view.';
    panel.appendChild(note);
    groups.forEach(group => {
        const section = document.createElement('div');
        section.className = 'filter-pop__group';
        const head = document.createElement('div');
        head.className = 'filter-pop__head';
        const label = document.createElement('p');
        label.className = 'eyebrow';
        label.textContent = group.label;
        const allLabel = document.createElement('label');
        allLabel.className = 'check';
        const all = document.createElement('input');
        all.type = 'checkbox';
        all.checked = viewFilters[group.key].length === 0;
        all.addEventListener('change', () => {
            viewFilters[group.key] = [];
            viewFiltersChanged();
        });
        allLabel.append(all, 'All');
        head.append(label, allLabel);
        const chips = document.createElement('div');
        chips.className = 'chip-choices';
        group.options.forEach(([id, name]) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.textContent = name;
            chip.setAttribute('aria-pressed', String(viewFilters[group.key].includes(id)));
            chip.addEventListener('click', event => {
                event.stopPropagation();
                const current = viewFilters[group.key];
                viewFilters[group.key] = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
                viewFiltersChanged();
            });
            chips.appendChild(chip);
        });
        section.append(head, chips);
        panel.appendChild(section);
    });
    if (active > 0) {
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'link-btn link-btn--danger filter-pop__reset';
        reset.textContent = 'Clear filter';
        reset.addEventListener('click', event => {
            event.stopPropagation();
            Object.keys(viewFilters).forEach(key => { viewFilters[key] = []; });
            viewFiltersChanged();
        });
        panel.appendChild(reset);
    }
}

function viewFiltersChanged() {
    currentPage = 1;
    renderViewFilters();
    renderNews();
}

function toggleViewFilters(event) {
    event.stopPropagation();
    const panel = document.getElementById('viewFilters');
    const opening = panel.hidden;
    closeSourceFilters();
    if (opening) renderViewFilters();
    panel.hidden = !opening;
    document.getElementById('viewFiltersToggle').setAttribute('aria-expanded', String(opening));
}

function closeViewFilters() {
    const panel = document.getElementById('viewFilters');
    if (panel && !panel.hidden) {
        panel.hidden = true;
        document.getElementById('viewFiltersToggle')?.setAttribute('aria-expanded', 'false');
    }
}

document.addEventListener('click', event => {
    if (!event.target.closest?.('.newsroom-filter')) closeViewFilters();
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeViewFilters();
});

// "See hidden": open the list of hidden articles and scroll to it
function showHiddenArticles() {
    const summary = document.getElementById('feedSummary');
    if (!summary || summary.style.display === 'none') return;
    summary.open = true;
    summary.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// NEWSROOM starts level with the page title (the feed's, or Settings'),
// whatever the sidebar above it measures on this screen
function alignSidebarNav() {
    const nav = document.querySelector('.sidebar-nav');
    const sidebar = document.querySelector('.sidebar');
    if (!nav || !sidebar || getComputedStyle(sidebar).position !== 'sticky') return;
    const title = settingsOpen() ? document.getElementById('settingsTitle') : document.querySelector('.title');
    if (!title || !title.offsetParent) return;
    nav.style.marginTop = '0px';
    const gap = title.getBoundingClientRect().top + window.scrollY - (nav.getBoundingClientRect().top + window.scrollY);
    nav.style.marginTop = `${Math.max(0, Math.round(gap))}px`;
}

window.addEventListener('resize', alignSidebarNav);
window.addEventListener('load', alignSidebarNav);
document.fonts?.ready.then(alignSidebarNav);

// A sidebar section opens and closes from anywhere on its heading row (the
// count, "+" and switches keep their own jobs)
document.querySelectorAll('.sidebar-fold .sidebar__label').forEach(label => {
    label.addEventListener('click', event => {
        if (event.target.closest('button, a, input, label.switch')) return;
        label.querySelector('.sidebar__toggle')?.click();
    });
});
