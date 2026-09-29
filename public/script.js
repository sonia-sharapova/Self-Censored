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
const DEFAULT_SOURCES = ['nyt', 'cnn', 'bbc', 'ap', 'reuters'];   // the five most popular
const DEFAULT_BLOCKED = ['sam altman'];
const PAGE_SIZE = 15;

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
    hideInactiveSources: false,
    topics: [...TOPIC_IDS],                            // selected topics
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
    picker: { query: '', filters: emptySourceFilters(), panel: 'sourceFilters', badge: 'sourceFiltersCount', toggle: 'sourceFiltersToggle' }
};
let sourceView = loadFromLocalStorage('sourceView', 'rows') === 'grid' ? 'grid' : 'rows';
let detailSourceId = null;
// "Add sources" picker: open or not, and the outlets ticked but not yet added
let pickerOpen = false;
let pendingSources = new Set();
// Your sources show a few until "Show N more": rows in the table, cards in the grid
const FEED_TABLE_ROWS = 5;
const FEED_GRID_CARDS = 8;
let feedExpanded = false;

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

// An outlet's image: its wordmark (assets/logo) or square icon (assets/icons),
// in the order `prefer` asks, falling back to the other, then to its initials.
// Small spots (the sidebar) prefer the icon; larger ones prefer the wordmark.
function createLogo(source, fallbackName, prefer = 'logo') {
    const name = source?.name || fallbackName || '?';
    const logo = document.createElement('span');
    logo.title = name;

    const candidates = (prefer === 'icon' ? [['icon', source?.icon], ['logo', source?.logo]] : [['logo', source?.logo], ['icon', source?.icon]])
        .filter(([, url]) => url);

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
            if (ratio > fit && index + 1 < candidates.length) {
                show(index + 1);
            } else if (src !== url) {
                image.src = src;
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

function saveToLocalStorage(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
        console.warn('Could not save to localStorage:', error);
    }
}

function loadFromLocalStorage(key, defaultValue = null) {
    try {
        const data = localStorage.getItem(key);
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
    favoriteSources = savedFavorites === null ? [...selectedSources] : normalizeSourceIds(savedFavorites);
    if (savedFavorites === null) saveToLocalStorage('favoriteSources', favoriteSources);

    renderSources();
    renderFilters();   // again, now that bias hover text can list outlets
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

    // Bias and mood only appear (and only filter) when switched on in Settings
    [['biasLevels', 'useBias', 'sidebarBiasSection', 'settingsBiasBody'], ['moods', 'useMood', 'sidebarMoodSection', 'settingsMoodBody']]
        .forEach(([, flag, sidebarId, bodyId]) => {
            const section = document.getElementById(sidebarId);
            if (section) section.hidden = !settings[flag];
            const body = document.getElementById(bodyId);
            if (body) body.classList.toggle('metric-body--off', !settings[flag]);
        });

}

function setMetricEnabled(key, enabled) {
    settings[key === 'biasLevels' ? 'useBias' : 'useMood'] = enabled;
    filtersChanged();
}

// "× name": clicking the name opens its place in Settings, the × removes it
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
        [group.sidebar, group.settings].forEach(id => {
            const slot = document.getElementById(id);
            if (slot) slot.replaceChildren(createStepper(key));
        });
        return;
    }

    const selected = settings[key];
    const sidebar = document.getElementById(group.sidebar);
    if (sidebar) {
        sidebar.innerHTML = '';
        const active = group.options.filter(option => selected.includes(option.id));
        const inactive = group.options.filter(option => !selected.includes(option.id));

        const list = document.createElement('ul');
        list.className = 'pick-list pick-list--bullets';
        active.slice(0, SIDEBAR_MAX_ACTIVE).forEach(option => {
            list.appendChild(createPickItem(option.name, {
                onOpen: () => openSettingsModal('topics'),
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
        if (inactive.length > 0) sidebar.appendChild(createAddMore(key, inactive));
    }

    // Configure: a card per topic (icon, name, description, how many of your
    // sources cover it); a ticked card is selected
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
            const text = document.createElement('span');
            text.className = 'topic-card__text';
            const name = document.createElement('strong');
            name.textContent = option.name;
            const description = document.createElement('span');
            description.className = 'topic-card__desc';
            description.textContent = option.description || '';
            text.append(name, description);

            const count = selectedSources.map(sourceById).filter(source => source && source.topics.includes(option.id)).length;
            const foot = document.createElement('span');
            foot.className = 'topic-card__foot';
            foot.textContent = `${count} of your source${count === 1 ? '' : 's'}`;

            const check = document.createElement('span');
            check.className = 'choice-check';
            check.setAttribute('aria-hidden', 'true');
            check.textContent = '✓';

            card.append(icon, text, check, foot);
            settingsList.appendChild(card);
        });
    }
}

// Keywords to avoid, in the sidebar: up to SIDEBAR_MAX_ACTIVE and a "+" under
// them (opens the keyword box in Configure). Hidden when nothing is redacted.
function renderSidebarKeywords() {
    const container = document.getElementById('sidebarAvoid');
    if (!container) return;
    container.innerHTML = '';
    const section = document.getElementById('sidebarAvoidSection');
    if (section) section.hidden = blockedKeywords.length === 0;

    const list = document.createElement('ul');
    list.className = 'pick-list pick-list--bullets pick-list--avoid';
    blockedKeywords.slice(0, SIDEBAR_MAX_ACTIVE).forEach(keyword => {
        list.appendChild(createPickItem(keyword, {
            onOpen: () => openSettingsModal('keywords'),
            onRemove: () => removeKeyword(keyword, 'blocked'),
            openLabel: 'Open keywords in Configure',
            removeLabel: `Stop avoiding "${keyword}"`
        }));
    });
    container.appendChild(list);

    if (blockedKeywords.length > SIDEBAR_MAX_ACTIVE) {
        const more = document.createElement('span');
        more.className = 'sidebar__more';
        more.textContent = `+${blockedKeywords.length - SIDEBAR_MAX_ACTIVE} more`;
        container.appendChild(more);
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'pick-list__add';
    add.textContent = '+';
    add.title = 'Redact another word';
    add.setAttribute('aria-label', 'Redact another word');
    add.addEventListener('click', () => openSettingsModal('keywords'));
    container.appendChild(add);
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

function setStep(key, index) {
    settings[key] = [FILTER_GROUPS[key].steps[index]];
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
    filtersChanged();
}

// ==============================================
// SOURCES: sidebar summary + settings table
// ==============================================

function renderSources() {
    renderSidebarSources();
    renderSettingsSources();
    renderFilterGroup('topics');   // topic cards count your sources
    renderDefaults();
}

// Sidebar sources: only what's in the feed, favourites first. A ★ sits in the
// bullet column for favourites (hover shows × to take the outlet out of the
// feed); the name opens the outlet's page in Configure.
function renderSidebarSources() {
    const list = document.getElementById('sidebarSources');
    const count = document.getElementById('sourcesCount');
    if (!list) return;

    const isFavorite = source => favoriteSources.includes(source.id);
    const inFeed = selectedSources.map(sourceById).filter(source => source && source.available)
        .sort((a, b) => isFavorite(b) - isFavorite(a) || a.name.localeCompare(b.name));
    if (count) count.textContent = `${inFeed.length} source${inFeed.length === 1 ? '' : 's'}`;

    list.innerHTML = '';
    if (inFeed.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'sidebar__empty';
        empty.textContent = 'no sources selected';
        list.appendChild(empty);
        return;
    }

    inFeed.forEach(source => {
        const name = document.createElement('span');
        name.className = 'pick-list__source';
        const label = document.createElement('span');
        label.textContent = source.name;
        name.append(createLogo(source, null, 'icon'), label);
        const item = createPickItem(name, {
            onOpen: () => openSettingsModal(`source:${source.id}`),
            onRemove: () => toggleSource(source.id, false),
            openLabel: `${source.name}: open its page in Configure`,
            removeLabel: `Take ${source.name} out of the feed`
        });
        // The marker column: ★ for a favourite, nothing otherwise
        const bullet = item.querySelector('.pick-list__bullet');
        bullet.textContent = isFavorite(source) ? '★' : '';
        if (isFavorite(source)) bullet.classList.add('pick-list__star');
        list.appendChild(item);
    });

    fitSidebarFavorites();
}

// The sidebar never scrolls: drop sources from the end until it fits the
// screen (the count above the list still says how many are in the feed)
function fitSidebarFavorites() {
    const sidebar = document.querySelector('.sidebar');
    const list = document.getElementById('sidebarSources');
    // Only the sticky desktop sidebar has a fixed height (on phones it stacks)
    if (!sidebar || !list || getComputedStyle(sidebar).position !== 'sticky') return;
    sidebar.classList.remove('sidebar--scroll');

    const items = [...list.querySelectorAll('li')];
    items.forEach(item => { item.hidden = false; });
    const about = sidebar.querySelector('.sidebar__about');
    if (about) about.hidden = false;

    let hiddenCount = 0;
    while (sidebar.scrollHeight > sidebar.clientHeight && hiddenCount < items.length) {
        items[items.length - 1 - hiddenCount].hidden = true;
        hiddenCount++;
    }

    // On a very short screen, the description goes before anything is cut off,
    // and if even that isn't enough, the sidebar scrolls rather than hide controls
    if (about && sidebar.scrollHeight > sidebar.clientHeight) about.hidden = true;
    if (sidebar.scrollHeight > sidebar.clientHeight) sidebar.classList.add('sidebar--scroll');
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
    high: { icon: '✓', label: 'High credibility' },
    medium: { icon: '!', label: 'Medium credibility' },
    low: { icon: '✕', label: 'Low credibility' },
    unrated: { icon: '–', label: 'Not rated' }
};

function createCredibilityBadge(source) {
    const level = credibilityLevel(source);
    const badge = document.createElement('span');
    badge.className = `cred-status cred-status--${level}`;
    badge.title = source.factual ? `MBFC factual reporting: ${source.factual}` : 'Media Bias/Fact Check has not rated this outlet';
    const icon = document.createElement('span');
    icon.className = 'cred-status__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = CREDIBILITY_BADGES[level].icon;
    badge.append(icon, CREDIBILITY_BADGES[level].label);
    return badge;
}

// Bias in lists: just the level; High is red. The MBFC label is on the detail page.
function createBiasLevel(source) {
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
    level.append(gauge, source.biasLevel === 'unrated' ? 'Unrated' : `${source.biasLevel[0].toUpperCase()}${source.biasLevel.slice(1)} bias`);
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
    { key: 'credibility', label: 'Credibility', options: [['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['unrated', 'Not rated']] },
    { key: 'bias', label: 'Bias', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['unrated', 'Unrated']] }
];

// Outlets matching a scope's search box and filters
function filteredSources(scope = 'picker') {
    const { query: raw, filters: f } = sourceScopes[scope];
    const query = raw.trim().toLowerCase();
    const allows = (list, value) => list.length === 0 || list.includes(value);
    return sourceCatalog
        .filter(source => source.available || !settings.hideInactiveSources)
        .filter(source => !query || [source.name, source.owner, source.country, ...(source.aliases || []), ...topicNames(source)]
            .some(text => text && text.toLowerCase().includes(query)))
        .filter(source => f.favorite.length === 0 || favoriteSources.includes(source.id))
        .filter(source => allows(f.credibility, credibilityLevel(source)))
        .filter(source => allows(f.bias, source.biasLevel))
        .filter(source => f.topic.length === 0 || source.topics.some(topic => f.topic.includes(topic)));
}

// Configure → Sources: your sources as a grid or a collapsed table, with
// "+ Add sources" opening the picker (FortifyAI's Attach Policy dialog)
function renderSettingsSources() {
    renderFeedSources();
    if (pickerOpen) renderSourcePicker();
    if (detailSourceId) renderSourceDetail();
}

function renderFeedSources() {
    const container = document.getElementById('feedSources');
    if (!container) return;
    renderSourceFilters('feed');
    document.querySelectorAll('#settingsSourcesSection .view-toggle [data-view]').forEach(button => {
        button.setAttribute('aria-pressed', button.dataset.view === sourceView);
    });
    container.innerHTML = '';

    const inFeed = selectedSources.map(sourceById).filter(Boolean);
    const matching = new Set(filteredSources('feed').map(source => source.id));
    const sources = inFeed.filter(source => matching.has(source.id)).sort((a, b) => a.name.localeCompare(b.name));
    document.getElementById('feedActions').hidden = inFeed.length === 0;

    // Nothing in the feed yet: one dashed "+ Add sources to your feed" slot
    if (inFeed.length === 0) {
        const slot = document.createElement('button');
        slot.type = 'button';
        slot.className = 'add-slot';
        slot.innerHTML = '<span class="add-slot__plus" aria-hidden="true">+</span>';
        slot.append('Add sources to your feed');
        slot.addEventListener('click', openSourcePicker);
        container.appendChild(slot);
        return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'feed-table';
    if (sources.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'grid-message';
        empty.textContent = 'None of your sources match. Try clearing the search or filters.';
        wrap.appendChild(empty);
        container.appendChild(wrap);
        return;
    }

    const limit = sourceView === 'grid' ? FEED_GRID_CARDS : FEED_TABLE_ROWS;
    const shown = feedExpanded ? sources : sources.slice(0, limit);
    if (sourceView === 'grid') {
        wrap.classList.add('feed-table--grid');
        const grid = document.createElement('div');
        grid.className = 'ruled-grid source-grid';
        shown.forEach(source => grid.appendChild(createSourceCard(source)));
        wrap.appendChild(grid);
    } else {
        wrap.appendChild(createFeedTable(shown));
    }

    // "Show N more ⌄": a band under the list, like its header
    if (sources.length > limit) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'feed-table__more';
        more.setAttribute('aria-expanded', String(feedExpanded));
        more.textContent = feedExpanded ? 'Show less ⌃' : `Show ${sources.length - limit} more ⌄`;
        more.addEventListener('click', () => {
            feedExpanded = !feedExpanded;
            renderFeedSources();
        });
        wrap.appendChild(more);
    }
    container.appendChild(wrap);
}

function sourceCell(content, className) {
    const td = document.createElement('td');
    if (className) td.className = className;
    td.append(content);
    return td;
}

function createRemoveButton(source) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'row-remove';
    remove.textContent = '×';
    remove.title = `Take ${source.name} out of the feed`;
    remove.setAttribute('aria-label', remove.title);
    remove.addEventListener('click', event => {
        event.stopPropagation();
        toggleSource(source.id, false);
    });
    return remove;
}

// Rows: logo · name (one line) · country · credibility · bias · ★ · ×.
// Clicking a row opens the outlet's page.
function createFeedTable(sources) {
    const table = document.createElement('table');
    table.className = 'data-table data-table--even';
    table.innerHTML = '<colgroup><col class="col-logo"><col class="col-name"><col class="col-country"><col class="col-cred"><col><col class="col-star"><col class="col-star"></colgroup>'
        + '<thead><tr><th><span class="visually-hidden">Logo</span></th><th>Outlet</th><th>Country</th><th>Credibility</th><th>Bias</th><th><span class="visually-hidden">Favourite</span></th><th><span class="visually-hidden">Remove</span></th></tr></thead>';
    const body = document.createElement('tbody');
    sources.forEach(source => {
        const row = document.createElement('tr');
        row.tabIndex = 0;
        row.title = `Details for ${source.name}`;
        row.addEventListener('click', () => openSourceDetail(source.id));
        row.addEventListener('keydown', event => {
            if (event.key === 'Enter') openSourceDetail(source.id);
        });
        const name = sourceCell(source.name, 'data-table__name');
        name.title = source.available ? source.name : `${source.name} (no free feed)`;
        row.append(
            sourceCell(createLogo(source, null, 'icon'), 'data-table__logo'),
            name,
            sourceCell(source.country || '—', 'data-table__muted'),
            sourceCell(createCredibilityBadge(source)),
            sourceCell(createBiasLevel(source)),
            sourceCell(createStar(source)),
            sourceCell(createRemoveButton(source))
        );
        body.appendChild(row);
    });
    table.appendChild(body);
    return table;
}

// Grid (4 across): × and ★ on top, a larger logo, the name on one line, then
// credibility over bias. Clicking the card opens the outlet's page.
function createSourceCard(source) {
    const card = document.createElement('article');
    card.className = 'card source-card';
    card.tabIndex = 0;
    card.title = `Details for ${source.name}`;
    card.addEventListener('click', () => openSourceDetail(source.id));
    card.addEventListener('keydown', event => {
        if (event.key === 'Enter' && event.target === card) openSourceDetail(source.id);
    });

    const meta = document.createElement('div');
    meta.className = 'card__meta';
    meta.append(createRemoveButton(source), createStar(source));

    const logo = createLogo(source, null, 'logo');
    const name = document.createElement('h4');
    name.className = 'source-card__name';
    name.textContent = source.name;

    const facts = document.createElement('div');
    facts.className = 'source-card__facts';
    facts.append(createCredibilityBadge(source), createBiasLevel(source));

    card.append(meta, logo, name, facts);
    return card;
}

// ----------------------------------------------
// "Add sources" picker: search, Filters, a select-all header, and a list of
// every outlet not yet in the feed; tick any, then "Add"
// ----------------------------------------------

function openSourcePicker() {
    pickerOpen = true;
    pendingSources = new Set();
    closeSourceFilters();
    document.getElementById('settingsMain').hidden = true;
    document.getElementById('sourceDetail').hidden = true;
    document.getElementById('sourcePicker').hidden = false;
    renderSourcePicker();
    document.querySelector('#settingsModal .modal__panel').scrollTop = 0;
    document.getElementById('sourceSearch')?.focus();
}

function closeSourcePicker() {
    pickerOpen = false;
    pendingSources = new Set();
    closeSourceFilters();
    const picker = document.getElementById('sourcePicker');
    if (picker) picker.hidden = true;
    const main = document.getElementById('settingsMain');
    if (main) main.hidden = false;
    renderFeedSources();
    document.getElementById('settingsSourcesSection')?.scrollIntoView({ block: 'start' });
}

function confirmSourcePicker() {
    const added = [...pendingSources].filter(id => !selectedSources.includes(id));
    selectedSources = [...selectedSources, ...added];
    closeSourcePicker();
    sourcesChanged();
}

function pickerSources() {
    return filteredSources('picker')
        .filter(source => !selectedSources.includes(source.id))
        .sort((a, b) => (b.available - a.available) || a.name.localeCompare(b.name));
}

function renderSourcePicker() {
    const container = document.getElementById('settingsSources');
    if (!container) return;
    renderSourceFilters('picker');
    container.innerHTML = '';

    const sources = pickerSources();
    const selectable = sources.filter(source => source.available);
    const picked = selectable.filter(source => pendingSources.has(source.id)).length;

    const list = document.createElement('div');
    list.className = 'attach-list';

    // Header: SELECT ALL (or "N SELECTED") and Clear
    const head = document.createElement('div');
    head.className = 'attach-list__head';
    const label = document.createElement('label');
    label.className = 'attach-list__all';
    const all = document.createElement('input');
    all.type = 'checkbox';
    all.className = 'feed-check';
    all.checked = selectable.length > 0 && picked === selectable.length;
    all.indeterminate = picked > 0 && picked < selectable.length;
    all.disabled = selectable.length === 0;
    all.addEventListener('change', () => {
        selectable.forEach(source => (all.checked ? pendingSources.add(source.id) : pendingSources.delete(source.id)));
        renderSourcePicker();
    });
    label.append(all, pendingSources.size > 0 ? `${pendingSources.size} selected` : 'Select all');
    head.appendChild(label);
    if (pendingSources.size > 0) {
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'link-btn link-btn--danger';
        clear.textContent = 'Clear';
        clear.addEventListener('click', () => {
            pendingSources = new Set();
            renderSourcePicker();
        });
        head.appendChild(clear);
    }
    list.appendChild(head);

    const body = document.createElement('div');
    body.className = 'attach-list__body';
    if (sources.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'grid-message';
        const anyLeft = sourceCatalog.some(source => !selectedSources.includes(source.id));
        empty.textContent = anyLeft ? 'No outlets match. Try clearing the search or filters.' : 'Every outlet is already in your feed.';
        body.appendChild(empty);
    }
    sources.forEach(source => {
        const row = document.createElement('label');
        row.className = 'attach-row';
        if (pendingSources.has(source.id)) row.classList.add('is-selected');
        if (!source.available) row.classList.add('is-disabled');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'feed-check';
        checkbox.checked = pendingSources.has(source.id);
        checkbox.disabled = !source.available;
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) pendingSources.add(source.id);
            else pendingSources.delete(source.id);
            renderSourcePicker();
        });

        const text = document.createElement('span');
        text.className = 'attach-row__text';
        const name = document.createElement('span');
        name.className = 'attach-row__name';
        name.textContent = source.name;
        const meta = document.createElement('span');
        meta.className = 'attach-row__meta';
        const credibility = { high: 'High credibility', medium: 'Medium credibility', low: 'Low credibility', unrated: 'Credibility not rated' }[credibilityLevel(source)];
        const bias = source.biasLevel === 'unrated' ? 'Bias unrated' : `${source.biasLevel[0].toUpperCase()}${source.biasLevel.slice(1)} bias`;
        meta.textContent = [source.country, credibility, bias, !source.available && 'No free feed'].filter(Boolean).join(' • ');
        text.append(name, meta);

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

        row.append(checkbox, createLogo(source, null, 'icon'), text, details);
        body.appendChild(row);
    });
    list.appendChild(body);
    container.appendChild(list);

    const confirm = document.getElementById('pickerConfirm');
    if (confirm) {
        const n = pendingSources.size;
        confirm.disabled = n === 0;
        confirm.textContent = n === 0 ? 'Add' : `Add ${n}`;
    }
}

// The Filters popover for a scope: groups of chips (pick any) with "All"
function renderSourceFilters(scope) {
    const state = sourceScopes[scope];
    const panel = document.getElementById(state.panel);
    const badge = document.getElementById(state.badge);
    if (!panel) return;
    const rerender = () => (scope === 'feed' ? renderFeedSources() : renderSourcePicker());

    const active = SOURCE_FILTER_GROUPS.filter(group => state.filters[group.key].length > 0).length;
    if (badge) {
        badge.hidden = active === 0;
        badge.textContent = active;
    }

    panel.innerHTML = '';
    SOURCE_FILTER_GROUPS.forEach(group => {
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
    if (scope === 'feed') renderFeedSources();
    else renderSourcePicker();
}

function setSourceView(view) {
    sourceView = view === 'grid' ? 'grid' : 'rows';
    saveToLocalStorage('sourceView', sourceView);
    feedExpanded = false;
    renderFeedSources();
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

function openSourceDetail(sourceId) {
    detailSourceId = sourceId;
    closeSourceFilters();
    document.getElementById('settingsMain').hidden = true;
    document.getElementById('sourcePicker').hidden = true;
    document.getElementById('sourceDetail').hidden = false;
    renderSourceDetail();
    document.querySelector('#settingsModal .modal__panel').scrollTop = 0;
}

function closeSourceDetail() {
    detailSourceId = null;
    const detail = document.getElementById('sourceDetail');
    if (detail) detail.hidden = true;
    // Back to wherever it was opened from: the picker or the main page
    if (pickerOpen) {
        document.getElementById('sourcePicker').hidden = false;
        renderSettingsSources();
        return;
    }
    const main = document.getElementById('settingsMain');
    if (main) main.hidden = false;
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
    const logo = createLogo(source);
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
    saveToLocalStorage('selectedSources', selectedSources);
    renderSources();
    loadNews();
}

// ==============================================
// KEYWORD MANAGEMENT
// ==============================================
// Keywords match whole words ("ai" won't hide "said"). Multi-word keywords
// match as a phrase, and a trailing `*` matches any ending ("crypto*").

function normalizeKeyword(value) {
    if (typeof value !== 'string') return '';
    return value
        .trim()
        .replace(/^["']+|["']+$/g, '')
        .replace(/\s+/g, ' ')
        .toLowerCase();
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
    if (input && addToKeywordList('blocked', input.value)) {
        input.value = '';
        renderKeywordSuggestions();
    }
}

function addToKeywordList(kind, value) {
    const keyword = normalizeKeyword(value);
    const list = kind === 'required' ? requiredKeywords : blockedKeywords;
    if (!keyword || list.includes(keyword)) return false;

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

// Common words to redact, offered under "Add other keywords"
const SUGGESTED_KEYWORDS = [
    'trump*', 'musk', 'bezos', 'kardashian*', 'taylor swift', 'royal family', 'celebrity', 'influencer*',
    'crypto*', 'bitcoin', 'stock market', 'recession', 'tariff*', 'layoff*', 'election*', 'poll*',
    'war', 'murder*', 'shooting*', 'chatgpt', 'openai', 'ai'
];

// What kind of match a keyword is, shown as a tag
function keywordKind(keyword) {
    if (keyword.includes('*')) return 'wildcard';
    if (keyword.includes(' ')) return 'phrase';
    return 'word';
}

function createKeywordRow(keyword, index, active) {
    const row = document.createElement('label');
    row.className = active ? 'kw-row' : 'kw-row kw-row--off';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'feed-check';
    checkbox.checked = active;
    checkbox.addEventListener('change', () => {
        if (checkbox.checked) addToKeywordList('blocked', keyword);
        else removeKeyword(keyword, 'blocked');
    });
    const code = document.createElement('span');
    code.className = 'kw-row__index';
    code.textContent = `${active ? 'K' : 'S'}-${String(index + 1).padStart(2, '0')}`;
    const word = document.createElement('span');
    word.className = 'kw-row__word';
    word.textContent = keyword;
    const tag = document.createElement('span');
    tag.className = `kw-tag kw-tag--${keywordKind(keyword)}`;
    tag.textContent = keywordKind(keyword);
    row.append(checkbox, code, word, tag);
    return row;
}

// Configure → Redacted keywords: the active ones, each ticked, indexed K-01…
function renderKeywordList() {
    const list = document.getElementById('settingsBlocked');
    if (!list) return;
    list.innerHTML = '';
    if (blockedKeywords.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'kw-empty';
        empty.textContent = 'Nothing redacted. Add a keyword below.';
        list.appendChild(empty);
    }
    blockedKeywords.forEach((keyword, index) => list.appendChild(createKeywordRow(keyword, index, true)));
    renderKeywordSuggestions();
}

// "Add other keywords": suggestions not yet redacted, filtered by the search
// box; typing something new offers "Redact “…”" first
function renderKeywordSuggestions() {
    const list = document.getElementById('keywordSuggestions');
    if (!list) return;
    const query = normalizeKeyword(document.getElementById('settingsKeywordInput')?.value || '');
    list.innerHTML = '';

    if (query && !blockedKeywords.includes(query) && !SUGGESTED_KEYWORDS.includes(query)) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'kw-row kw-row--new';
        add.innerHTML = '<span class="kw-row__plus" aria-hidden="true">+</span>';
        const word = document.createElement('span');
        word.className = 'kw-row__word';
        word.textContent = `Redact “${query}”`;
        const tag = document.createElement('span');
        tag.className = `kw-tag kw-tag--${keywordKind(query)}`;
        tag.textContent = keywordKind(query);
        add.append(word, tag);
        add.addEventListener('click', () => {
            addToKeywordList('blocked', query);
            document.getElementById('settingsKeywordInput').value = '';
            renderKeywordSuggestions();
        });
        list.appendChild(add);
    }

    SUGGESTED_KEYWORDS
        .filter(keyword => !blockedKeywords.includes(keyword) && (!query || keyword.includes(query)))
        .forEach((keyword, index) => list.appendChild(createKeywordRow(keyword, index, false)));
    list.hidden = list.children.length === 0;
}

function toggleKeywordMore(open) {
    const panel = document.getElementById('keywordMore');
    const toggle = document.getElementById('keywordMoreToggle');
    if (!panel || !toggle) return;
    panel.hidden = typeof open === 'boolean' ? !open : !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) document.getElementById('settingsKeywordInput')?.focus();
}

const keywordPatternCache = new Map();

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordPattern(keyword) {
    if (!keywordPatternCache.has(keyword)) {
        const body = keyword
            .split(' ')
            .map(word => word.split('*').map(escapeRegExp).join('[\\p{L}\\p{N}]*'))
            .join('\\s+');
        keywordPatternCache.set(keyword, new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'iu'));
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
        && matchesSearch(article));

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

    pager.append(
        button('« First', 1, { ariaLabel: 'First page' }),
        button('‹ Previous', currentPage - 1, { ariaLabel: 'Previous page' })
    );

    // Always show the first and last page, and two either side of the current one
    const pages = new Set([1, pageCount]);
    for (let page = currentPage - 2; page <= currentPage + 2; page++) {
        if (page >= 1 && page <= pageCount) pages.add(page);
    }
    let previous = 0;
    [...pages].sort((a, b) => a - b).forEach(page => {
        if (page - previous > 1) pager.appendChild(gap());
        pager.appendChild(button(String(page), page, { current: page === currentPage, ariaLabel: `Page ${page}` }));
        previous = page;
    });

    pager.append(
        button('Next ›', currentPage + 1, { ariaLabel: 'Next page' }),
        button('Last »', pageCount, { ariaLabel: 'Last page' })
    );

    const summary = document.createElement('p');
    summary.className = 'pager__summary';
    const first = (currentPage - 1) * PAGE_SIZE + 1;
    summary.textContent = `Page ${currentPage} of ${pageCount} · articles ${first}–${Math.min(total, first + PAGE_SIZE - 1)} of ${total}`;
    pager.appendChild(summary);
}

function goToPage(page) {
    currentPage = page;
    renderNews();
    document.querySelector('.summary-row')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ==============================================
// CARDS
// ==============================================

// No article image: show the outlet's wordmark, large, on a plain panel (the
// square icon is already in the card's corner)
function createImagePlaceholder(sourceName) {
    const placeholder = document.createElement('div');
    placeholder.className = 'card__placeholder';
    placeholder.appendChild(createLogo(sourcesByName.get(sourceName), sourceName, 'logo'));
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
                <button class="btn" type="button" onclick="openSettingsModal('sources')">Choose sources</button>
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
    selectedSources: [...DEFAULT_SOURCES],   // the five most popular
    blockedKeywords: [...DEFAULT_BLOCKED],   // "sam altman"
    topics: [...TOPIC_IDS],
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
    feedExpanded = false;

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
    summary.innerHTML = '';
    rows.forEach(([label, value]) => {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        summary.append(dt, dd);
    });

    const matches = sameSetup(currentSetup(), d);
    const status = document.createElement('p');
    status.className = matches ? 'defaults-status defaults-status--same' : 'defaults-status';
    status.textContent = matches ? '✓ Your current setup matches your defaults.' : 'Your current setup differs from your defaults.';
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
function openSettingsModal(section) {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;

    // Always open on the main settings page, not an outlet left open last time
    detailSourceId = null;
    pickerOpen = false;
    pendingSources = new Set();
    document.getElementById('sourceDetail').hidden = true;
    document.getElementById('sourcePicker').hidden = true;
    document.getElementById('settingsMain').hidden = false;

    renderSettingsSources();
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');

    const panel = modal.querySelector('.modal__panel');
    const sections = {
        sources: 'settingsSourcesSection', topics: 'settingsTopicsSection', keywords: 'settingsKeywordsSection',
        bias: 'settingsBiasSection', mood: 'settingsMoodSection'
    };
    if (section?.startsWith('source:')) {
        openSourceDetail(section.slice('source:'.length));
    } else if (sections[section]) {
        document.getElementById(sections[section])?.scrollIntoView({ block: 'start' });
        if (section === 'keywords') document.getElementById('settingsKeywordInput')?.focus();
    } else {
        panel.scrollTop = 0;
    }
}

function closeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.style.display = 'none';
    document.body.classList.remove('modal-open');
}

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
    if (document.getElementById('settingsModal')?.style.display !== 'flex') document.body.classList.remove('modal-open');
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
        closeMenus();
        closeSourceFilters();
        closeErrorModal();
        closeSettingsModal();
    }
});

window.addEventListener('resize', () => fitSidebarFavorites());

// Clicking the dimmed backdrop closes a modal
document.addEventListener('click', function(event) {
    if (event.target.classList?.contains('modal')) {
        closeErrorModal();
        closeSettingsModal();
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
