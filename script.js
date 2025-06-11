// ==============================================
// NEWS FILTERING PLATFORM - MAIN SCRIPT
// ==============================================

// ==============================================
// CONFIGURATION & API SETUP
// ==============================================

// API Configuration
const API_CONFIG = {
    newsapi: {
        key: '68f8d8596f634a87bd0eb70191cefc85',
        baseUrl: 'https://newsapi.org/v2'
    },
    guardian: {
        key: '4b641f98-8905-404c-bbb5-8077c751dcba',
        baseUrl: 'https://content.guardianapis.com'
    },
    worldnews: {
        key: 'e7adbc91347c47dfa414664a868af66a',
        baseUrl: 'https://content.guardianapis.com'
    }
};

// CORS Proxy for development - try different proxies if one fails
const CORS_PROXIES = [
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url=',
    'https://cors-anywhere.herokuapp.com/'
];

let currentProxyIndex = 0;

function getCorsProxy() {
    return CORS_PROXIES[currentProxyIndex];
}

function tryNextProxy() {
    currentProxyIndex = (currentProxyIndex + 1) % CORS_PROXIES.length;
    console.log(`🔄 Switching to proxy: ${getCorsProxy()}`);
}

// ==============================================
// COMPLETE NEWS SOURCES DEFINITION
// ==============================================

// Force clear any cached arrays and redefine everything
window.allSources = undefined;
window.activeSources = undefined;

// COMPLETE NEWS SOURCES LIST - 35 TOTAL SOURCES (Force override)
const allSources = [
    'Al Jazeera',
    'Ars Technica',
    'Associated Press',
    'BBC News',
    'Bloomberg',
    'CBS News',
    'CNET',
    'CNN',
    'Crypto News API',
    'Currents API',
    'ESPN',
    'Financial Times',
    'Fox News',
    'Gizmodo',
    'Google News',
    'Hacker News',
    'Mashable',
    'MT Newswires',
    'New York Times',
    'News Data IO',
    'NewsCatcherAPI',
    'NPR',
    'Reddit r/news',
    'Reuters',
    'Social Animal News API',
    'Spaceflight News',
    'Stocknews.ai',
    'TechCrunch',
    'The Guardian',
    'The Verge',
    'Wall Street Journal',
    'Washington Post',
    'Wired',
    'World News API',
    'ZDNet'
];

// Active sources with working APIs/RSS (19 total)
const activeSources = [
    'Al Jazeera',
    'Ars Technica',
    'Associated Press',
    'BBC News',
    'CNET',
    'CNN',
    'Gizmodo',
    'Hacker News',
    'Mashable',
    'Reddit r/news',
    'Reuters',
    'Spaceflight News',
    'TechCrunch',
    'The Guardian',
    'The Verge',
    'Wall Street Journal',
    'Washington Post',
    'Wired',
    'ZDNet'
];

// Force log to verify
console.log('🚀 FORCED UPDATE - Total sources:', allSources.length);
console.log('🚀 Active sources:', activeSources.length);
console.log('🚀 Full list:', allSources);

// Override any global variables
window.allSources = allSources;
window.activeSources = activeSources;

// ==============================================
// GLOBAL STATE VARIABLES
// ==============================================

// Global state variables
let selectedSources = ['Mashable', 'Wired', 'Ars Technica', 'CNET', 'CNN'];
let currentArticles = [];
let blockedKeywords = [];

let settings = {
    articlesPerPage: 50,
    darkMode: false,
    autoRefresh: false,
    hideInactiveSources: false,
    shuffleArticles: false
};
let autoRefreshInterval = null;

// ==============================================
// NEWS API SERVICE CLASSES
// ==============================================

class NewsAPIService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://newsapi.org/v2';
    }

    async getTopHeadlines(sources = null, pageSize = 20) {
        const params = new URLSearchParams({
            apiKey: this.apiKey,
            pageSize: pageSize,
            language: 'en',
            country: 'us'
        });

        if (sources && sources.length > 0) {
            const sourceMap = {
                'BBC News': 'bbc-news',
                'Reuters': 'reuters',
                'Associated Press': 'associated-press',
                'The Guardian': 'the-guardian',
                'Wall Street Journal': 'the-wall-street-journal',
                'New York Times': 'the-new-york-times',
                'Washington Post': 'the-washington-post',
                'CNN': 'cnn',
                'Fox News': 'fox-news',
                'CBS News': 'cbs-news',
                'Al Jazeera': 'al-jazeera-english',
                'Financial Times': 'financial-times',
                'Bloomberg': 'bloomberg',
                'ESPN': 'espn'
            };

            const apiSources = sources
                .map(source => sourceMap[source])
                .filter(source => source)
                .join(',');

            if (apiSources) {
                params.set('sources', apiSources);
                params.delete('country');
            }
        }

        try {
            const url = `${this.baseUrl}/top-headlines?${params}`;
            const response = await fetch(getCorsProxy() + encodeURIComponent(url));
            const data = await response.json();

            if (data.status === 'ok') {
                return this.formatArticles(data.articles, 'NewsAPI');
            } else {
                if (data.message && data.message.includes('cors')) {
                    tryNextProxy();
                }
                throw new Error(data.message || 'NewsAPI request failed');
            }
        } catch (error) {
            console.error('NewsAPI Error:', error);
            if (error.message.includes('Failed to fetch') || error.message.includes('CORS')) {
                tryNextProxy();
            }
            return [];
        }
    }

    formatArticles(articles, source) {
        return articles
            .filter(article => article.title && article.title !== '[Removed]')
            .map(article => ({
                title: article.title,
                description: article.description || '',
                content: article.content || '',
                url: article.url,
                urlToImage: article.urlToImage,
                publishedAt: article.publishedAt,
                source: article.source.name || source,
                author: article.author
            }));
    }
}

class GuardianAPIService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://content.guardianapis.com';
    }

    async getLatestNews(pageSize = 20) {
        const params = new URLSearchParams({
            'api-key': this.apiKey,
            'page-size': pageSize,
            'show-fields': 'headline,trailText,thumbnail,short-url',
            'order-by': 'newest'
        });

        try {
            const url = `${this.baseUrl}/search?${params}`;
            const response = await fetch(getCorsProxy() + encodeURIComponent(url));
            const data = await response.json();

            if (data.response.status === 'ok') {
                return this.formatArticles(data.response.results);
            } else {
                throw new Error('Guardian API request failed');
            }
        } catch (error) {
            console.error('Guardian API Error:', error);
            if (error.message.includes('Failed to fetch') || error.message.includes('CORS')) {
                tryNextProxy();
            }
            return [];
        }
    }

    formatArticles(articles) {
        return articles.map(article => ({
            title: article.fields?.headline || article.webTitle,
            description: article.fields?.trailText || '',
            content: '',
            url: article.webUrl,
            urlToImage: article.fields?.thumbnail,
            publishedAt: article.webPublicationDate,
            source: 'The Guardian',
            author: ''
        }));
    }
}

class RedditAPIService {
    constructor() {
        this.baseUrl = 'https://www.reddit.com/r';
    }

    async getNews(subreddit = 'news', limit = 25) {
        try {
            const url = `${this.baseUrl}/${subreddit}/hot.json?limit=${limit}`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Reddit API request failed: ${response.status}`);
            }

            const data = await response.json();

            return data.data.children
                .filter(post => !post.data.stickied && post.data.url)
                .map(post => ({
                    title: post.data.title,
                    description: post.data.selftext ? post.data.selftext.substring(0, 200) + '...' : 'Reddit discussion',
                    url: post.data.url.startsWith('/r/') ? `https://reddit.com${post.data.url}` : post.data.url,
                    urlToImage: post.data.thumbnail && post.data.thumbnail.startsWith('http') ? post.data.thumbnail : null,
                    publishedAt: new Date(post.data.created_utc * 1000).toISOString(),
                    source: 'Reddit r/news',
                    author: post.data.author
                }));
        } catch (error) {
            console.error('Reddit API Error:', error);
            return [];
        }
    }
}

class HackerNewsAPIService {
    constructor() {
        this.baseUrl = 'https://hacker-news.firebaseio.com/v0';
    }

    async getTopStories(limit = 30) {
        try {
            const topStoriesResponse = await fetch(`${this.baseUrl}/topstories.json`);
            const storyIds = await topStoriesResponse.json();

            const stories = await Promise.all(
                storyIds.slice(0, limit).map(async id => {
                    const storyResponse = await fetch(`${this.baseUrl}/item/${id}.json`);
                    return storyResponse.json();
                })
            );

            return stories
                .filter(story => story && story.url && story.title)
                .map(story => ({
                    title: story.title,
                    description: story.text ? story.text.substring(0, 200) + '...' : 'Hacker News discussion',
                    url: story.url,
                    urlToImage: this.getImageForHackerNews(story.url, story.title),
                    publishedAt: new Date(story.time * 1000).toISOString(),
                    source: 'Hacker News',
                    author: story.by,
                    score: story.score
                }));
        } catch (error) {
            console.error('Hacker News API Error:', error);
            return [];
        }
    }

    getImageForHackerNews(url, title) {
        if (!url) return null;

        try {
            const domain = new URL(url).hostname.replace('www.', '');

            if (domain.includes('github')) {
                return 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';
            } else if (domain.includes('youtube')) {
                return 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/YouTube_full-color_icon_%282017%29.svg/2560px-YouTube_full-color_icon_%282017%29.svg.png';
            } else if (domain.includes('twitter') || domain.includes('x.com')) {
                return 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Logo_of_Twitter.svg/512px-Logo_of_Twitter.svg.png';
            } else {
                return `https://via.placeholder.com/400x200/667eea/ffffff?text=${encodeURIComponent(domain)}`;
            }
        } catch (e) {
            return null;
        }
    }
}

class SpaceflightNewsService {
    constructor() {
        this.baseUrl = 'https://api.spaceflightnewsapi.net/v4';
    }

    async getNews(limit = 20) {
        try {
            const response = await fetch(`${this.baseUrl}/articles/?limit=${limit}&ordering=-published_at`);
            const data = await response.json();

            return data.results.map(article => ({
                title: article.title,
                description: article.summary,
                url: article.url,
                urlToImage: article.image_url,
                publishedAt: article.published_at,
                source: 'Spaceflight News',
                author: article.news_site
            }));
        } catch (error) {
            console.error('Spaceflight News API Error:', error);
            return [];
        }
    }
}

class RSSNewsService {
    constructor(sourceName, rssUrl) {
        this.sourceName = sourceName;
        this.rssUrl = rssUrl;
    }

    async getNews(limit = 15) {
        try {
            const response = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(this.rssUrl)}&count=${limit}`);
            const data = await response.json();

            if (data.status === 'ok') {
                return data.items.map(item => ({
                    title: item.title,
                    description: this.cleanDescription(item.description),
                    url: item.link,
                    urlToImage: item.thumbnail || null,
                    publishedAt: item.pubDate,
                    source: this.sourceName,
                    author: item.author || this.sourceName
                }));
            }
            return [];
        } catch (error) {
            console.error(`${this.sourceName} RSS Error:`, error);
            return [];
        }
    }

    cleanDescription(description) {
        if (!description) return `${this.sourceName} article`;
        return description.replace(/<[^>]*>/g, '').substring(0, 200) + '...';
    }
}

class WorldNewsAPIService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.worldnewsapi.com';
    }

    async getNews(limit = 20) {
        if (!this.apiKey || this.apiKey === API_CONFIG.worldnews) {
            console.log('World News API key not configured');
            return [];
        }

        try {
            const response = await fetch(`${this.baseUrl}/search-news?api-key=${this.apiKey}&number=${limit}&sort=publish-time&sort-direction=DESC`);
            const data = await response.json();

            return data.news?.map(article => ({
                title: article.title,
                description: article.summary || article.text?.substring(0, 200) + '...' || '',
                url: article.url,
                urlToImage: article.image,
                publishedAt: article.publish_date,
                source: 'World News API',
                author: article.author
            })) || [];
        } catch (error) {
            console.error('World News API Error:', error);
            return [];
        }
    }
}

// ==============================================
// AGGREGATED NEWS SERVICE
// ==============================================

class AggregatedNewsService {
    constructor(apiKeys) {
        this.services = {};

        if (apiKeys.newsapi && apiKeys.newsapi !== 'YOUR_NEWSAPI_KEY_HERE') {
            this.services.newsapi = new NewsAPIService(apiKeys.newsapi);
        }

        if (apiKeys.guardian && apiKeys.guardian !== 'YOUR_GUARDIAN_KEY_HERE') {
            this.services.guardian = new GuardianAPIService(apiKeys.guardian);
        }

        if (apiKeys.worldnews && apiKeys.worldnews !== 'YOUR_WORLDNEWS_API_KEY') {
            this.services.worldnews = new WorldNewsAPIService(apiKeys.worldnews);
        }

        this.services.reddit = new RedditAPIService();
        this.services.hackernews = new HackerNewsAPIService();
        this.services.spaceflight = new SpaceflightNewsService();

        this.rssServices = {
            'TechCrunch': new RSSNewsService('TechCrunch', 'https://techcrunch.com/feed/'),
            'The Verge': new RSSNewsService('The Verge', 'https://www.theverge.com/rss/index.xml'),
            'Ars Technica': new RSSNewsService('Ars Technica', 'https://feeds.arstechnica.com/arstechnica/index'),
            'CNET': new RSSNewsService('CNET', 'https://www.cnet.com/rss/news/'),
            'Gizmodo': new RSSNewsService('Gizmodo', 'https://gizmodo.com/rss'),
            'ZDNet': new RSSNewsService('ZDNet', 'https://www.zdnet.com/news/rss.xml'),
            'Mashable': new RSSNewsService('Mashable', 'https://mashable.com/feeds/rss/all'),
            'Wired': new RSSNewsService('Wired', 'https://www.wired.com/feed/rss'),
            'Al Jazeera': new RSSNewsService('Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml')
        };
    }

    async getAllNews(selectedSources, maxArticles = 50) {
        console.log('🔍 Fetching news for sources:', selectedSources);
        const allPromises = [];

        const newsAPISources = selectedSources.filter(source =>
            ['BBC News', 'Reuters', 'Associated Press', 'CNN', 'Fox News', 'CBS News', 'Washington Post', 'Wall Street Journal'].includes(source)
        );
        if (this.services.newsapi && newsAPISources.length > 0) {
            console.log('📰 Adding NewsAPI sources:', newsAPISources);
            allPromises.push(
                this.services.newsapi.getTopHeadlines(newsAPISources, Math.floor(maxArticles * 0.25))
                    .catch(error => {
                        console.error('NewsAPI failed:', error);
                        return [];
                    })
            );
        }

        if (this.services.guardian && selectedSources.includes('The Guardian')) {
            console.log('📰 Adding Guardian');
            allPromises.push(
                this.services.guardian.getLatestNews(Math.floor(maxArticles * 0.15))
                    .catch(error => {
                        console.error('Guardian API failed:', error);
                        return [];
                    })
            );
        }

        selectedSources.forEach(source => {
            if (this.rssServices[source]) {
                console.log('📰 Adding RSS source:', source);
                allPromises.push(
                    this.rssServices[source].getNews(Math.floor(maxArticles * 0.2))
                        .catch(error => {
                            console.error(`${source} RSS failed:`, error);
                            return [];
                        })
                );
            }
        });

        if (selectedSources.includes('Reddit r/news')) {
            console.log('📰 Adding Reddit');
            allPromises.push(
                this.services.reddit.getNews('news', Math.floor(maxArticles * 0.1))
                    .catch(error => {
                        console.error('Reddit API failed:', error);
                        return [];
                    })
            );
        }

        if (selectedSources.includes('Hacker News')) {
            console.log('📰 Adding Hacker News');
            allPromises.push(
                this.services.hackernews.getTopStories(Math.floor(maxArticles * 0.1))
                    .catch(error => {
                        console.error('Hacker News API failed:', error);
                        return [];
                    })
            );
        }

        if (selectedSources.includes('Spaceflight News')) {
            console.log('📰 Adding Spaceflight News');
            allPromises.push(
                this.services.spaceflight.getNews(Math.floor(maxArticles * 0.05))
                    .catch(error => {
                        console.error('Spaceflight News API failed:', error);
                        return [];
                    })
            );
        }

        if (this.services.worldnews && selectedSources.includes('World News API')) {
            console.log('📰 Adding World News API');
            allPromises.push(
                this.services.worldnews.getNews(Math.floor(maxArticles * 0.1))
                    .catch(error => {
                        console.error('World News API failed:', error);
                        return [];
                    })
            );
        }

        console.log('🚀 Total promises to fetch:', allPromises.length);

        try {
            const results = await Promise.allSettled(allPromises);
            const articles = results
                .filter(result => result.status === 'fulfilled')
                .flatMap(result => result.value);

            console.log('Raw articles fetched:', articles.length);

            if (articles.length === 0) {
                console.warn('⚠️ No articles fetched from any source!');
                return [];
            }

            const uniqueArticles = this.removeDuplicates(articles);
            console.log('📊 Unique articles after dedup:', uniqueArticles.length);

            if (settings.shuffleArticles) {
                return this.smartMix(uniqueArticles);
            } else {
                return this.sortByDate(uniqueArticles);
            }
        } catch (error) {
            console.error('Error aggregating news:', error);
            return [];
        }
    }

    removeDuplicates(articles) {
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

    sortByDate(articles) {
        return articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    }

    shuffleArticles(articles) {
        const shuffled = [...articles];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    smartMix(articles) {
        const sourceGroups = {};
        articles.forEach(article => {
            if (!sourceGroups[article.source]) {
                sourceGroups[article.source] = [];
            }
            sourceGroups[article.source].push(article);
        });

        Object.keys(sourceGroups).forEach(source => {
            sourceGroups[source] = this.shuffleArticles(sourceGroups[source]);
        });

        const mixed = [];
        const sources = Object.keys(sourceGroups);
        let maxLength = Math.max(...Object.values(sourceGroups).map(group => group.length));

        for (let i = 0; i < maxLength; i++) {
            sources.forEach(source => {
                if (sourceGroups[source][i]) {
                    mixed.push(sourceGroups[source][i]);
                }
            });
        }

        return mixed;
    }
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

// ==============================================
// INITIALIZATION - UPDATED FOR NEW LAYOUT
// ==============================================

function initializeApp() {
    console.log('🚀 Initializing app with new layout...');

    if (document.readyState !== 'complete') {
        console.log('⏳ DOM not ready, waiting...');
        setTimeout(initializeApp, 50);
        return;
    }

    // Check for any wheel containers first
    const wheelContainers = document.querySelectorAll('.sources-wheel');
    if (wheelContainers.length === 0) {
        console.log('⏳ Source wheels not found, retrying...');
        setTimeout(initializeApp, 50);
        return;
    }

    console.log('✅ DOM ready, found', wheelContainers.length, 'source wheels!');

    // Load settings
    blockedKeywords = loadFromLocalStorage('blockedKeywords', []);

    // Reset sources to defaults
    localStorage.removeItem('selectedSources');
    selectedSources = ['Mashable', 'Wired', 'Ars Technica', 'CNET', 'CNN'];

    settings = { ...settings, ...loadFromLocalStorage('settings', {}) };

    // Force update the global arrays
    window.allSources = allSources;
    window.activeSources = activeSources;

    console.log('🎯 Initialized with', window.allSources.length, 'total sources');
    console.log('🎯 Active sources:', window.activeSources.length);
    console.log('🎯 Selected sources:', selectedSources);

    // Apply settings
    applySettings();

    // Setup UI
    console.log('🛠️ Setting up sources UI...');
    setupSources();
    updateKeywordsList();

    // Save the current settings
    saveToLocalStorage('selectedSources', selectedSources);

    // AUTO-LOAD NEWS ON STARTUP
    console.log('📰 Auto-loading news...');

    // Add a small delay to ensure everything is set up
    setTimeout(() => {
        loadNews();
    }, 500);

    console.log('🚀 ClearFeed setup completed!');
}

function applySettings() {
    const articlesPerPageSelect = document.getElementById('articlesPerPage');
    if (articlesPerPageSelect) articlesPerPageSelect.value = settings.articlesPerPage;

    const autoRefreshCheckbox = document.getElementById('autoRefresh');
    if (autoRefreshCheckbox) autoRefreshCheckbox.checked = settings.autoRefresh;
    if (settings.autoRefresh) {
        startAutoRefresh();
    }

    const hideInactiveCheckbox = document.getElementById('hideInactiveSources');
    if (hideInactiveCheckbox) hideInactiveCheckbox.checked = settings.hideInactiveSources;

    const shuffleCheckbox = document.getElementById('shuffleArticles');
    if (shuffleCheckbox) shuffleCheckbox.checked = settings.shuffleArticles;
}

// ==============================================
// SOURCE MANAGEMENT - UPDATED FOR NEW LAYOUT
// ==============================================

function setupSources() {
    const activeSourcesContainer = document.getElementById('activeSources');
    const limitedSourcesContainer = document.getElementById('limitedSources');

    if (!activeSourcesContainer || !limitedSourcesContainer) {
        console.error('❌ Source containers not found!');
        console.log('Looking for elements with IDs: activeSources, limitedSources');

        // Fallback: try to find the containers by class
        const activeWheelContainer = document.querySelector('.active-wheel');
        const limitedWheelContainer = document.querySelector('.limited-wheel');

        if (activeWheelContainer && limitedWheelContainer) {
            console.log('📍 Found containers by class, creating ID containers...');

            // Create containers if they don't exist
            let activeContainer = activeWheelContainer.querySelector('#activeSources');
            let limitedContainer = limitedWheelContainer.querySelector('#limitedSources');

            if (!activeContainer) {
                activeContainer = document.createElement('div');
                activeContainer.id = 'activeSources';
                activeContainer.style.display = 'contents';
                activeWheelContainer.appendChild(activeContainer);
            }

            if (!limitedContainer) {
                limitedContainer = document.createElement('div');
                limitedContainer.id = 'limitedSources';
                limitedContainer.style.display = 'contents';
                limitedWheelContainer.appendChild(limitedContainer);
            }

            // Try again with the created containers
            return setupSources();
        }

        console.error('❌ Could not find or create source containers');
        return;
    }

    const currentSources = window.allSources || allSources;
    const currentActiveSources = window.activeSources || activeSources;

    // Clear existing content
    activeSourcesContainer.innerHTML = '';
    limitedSourcesContainer.innerHTML = '';

    console.log('📊 Setting up sources with:', currentSources.length, 'sources');
    console.log('📊 Active sources:', currentActiveSources.length);
    console.log('📊 Selected sources:', selectedSources.length);

    const sortedActiveSources = currentActiveSources.sort();
    const sortedLimitedSources = currentSources.filter(source => !currentActiveSources.includes(source)).sort();

    // Create Active Sources
    sortedActiveSources.forEach((source, index) => {
        const sourceItem = createSourceItem(source, index, true);
        activeSourcesContainer.appendChild(sourceItem);
    });

    // Create Limited Sources
    sortedLimitedSources.forEach((source, index) => {
        const sourceItem = createSourceItem(source, index, false);
        limitedSourcesContainer.appendChild(sourceItem);
    });

    console.log('✅ Source setup completed - Active:', sortedActiveSources.length, 'Limited:', sortedLimitedSources.length);

    // Verify that the default sources are properly checked
    selectedSources.forEach(source => {
        const safeId = source.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
        const checkbox = document.getElementById(`source-${safeId}`);
        if (checkbox) {
            console.log(`✅ Found checkbox for ${source}:`, checkbox.checked);
        } else {
            console.log(`❌ Missing checkbox for ${source} with ID: source-${safeId}`);
        }
    });
}

function createSourceItem(source, index, isActive) {
    const sourceItem = document.createElement('div');
    sourceItem.className = `wheel-item ${isActive ? 'active-source' : 'limited-source'}`;

    const safeId = source.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `source-${safeId}`;
    checkbox.checked = selectedSources.includes(source);

    checkbox.addEventListener('change', function() {
        toggleSource(source);
    });

    const label = document.createElement('label');
    label.setAttribute('for', `source-${safeId}`);
    label.textContent = source;
    label.style.cursor = 'pointer';

    sourceItem.appendChild(checkbox);
    sourceItem.appendChild(label);

    return sourceItem;
}

function toggleSource(source) {
    console.log('🔄 Toggling source:', source);
    console.log('📊 Current selected sources:', selectedSources);

    const safeId = source.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const checkbox = document.getElementById(`source-${safeId}`);

    if (!checkbox) {
        console.error('❌ Checkbox not found for source:', source, 'with ID:', `source-${safeId}`);
        return;
    }

    if (checkbox.checked) {
        if (!selectedSources.includes(source)) {
            selectedSources.push(source);
            console.log('✅ Added source:', source);
        }
    } else {
        selectedSources = selectedSources.filter(s => s !== source);
        console.log('❌ Removed source:', source);
    }

    console.log('📊 New selected sources:', selectedSources);
    saveToLocalStorage('selectedSources', selectedSources);
    loadNews();
}

// ==============================================
// KEYWORD MANAGEMENT
// ==============================================

function addKeyword() {
    const input = document.getElementById('keywordInput');
    if (!input) return;

    const keyword = input.value.trim().toLowerCase();

    if (keyword && !blockedKeywords.includes(keyword)) {
        blockedKeywords.push(keyword);
        input.value = '';
        updateKeywordsList();
        saveToLocalStorage('blockedKeywords', blockedKeywords);
        loadNews();
    }
}

function removeKeyword(keyword) {
    blockedKeywords = blockedKeywords.filter(k => k !== keyword);
    updateKeywordsList();
    saveToLocalStorage('blockedKeywords', blockedKeywords);
    loadNews();
}

function updateKeywordsList() {
    const keywordsList = document.getElementById('keywordsList');
    if (!keywordsList) return;

    keywordsList.innerHTML = '';

    blockedKeywords.forEach(keyword => {
        const tag = document.createElement('div');
        tag.className = 'keyword-tag';
        tag.innerHTML = `
            ${keyword}
            <span class="remove" onclick="removeKeyword('${keyword}')" title="Remove keyword">×</span>
        `;
        keywordsList.appendChild(tag);
    });
}

function containsBlockedKeyword(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    return blockedKeywords.some(keyword =>
        lowerText.includes(keyword.toLowerCase())
    );
}

// ==============================================
// NEWS LOADING & FILTERING
// ==============================================

async function loadNews() {
    console.log('📰 Starting loadNews function...');
    console.log('📊 Current selected sources:', selectedSources);
    console.log('📊 Current blocked keywords:', blockedKeywords);

    const loading = document.getElementById('loading');
    const newsContainer = document.getElementById('newsContainer');
    const status = document.getElementById('status');

    if (!newsContainer) {
        console.error('❌ News container not found!');
        return;
    }

    if (loading) {
        loading.style.display = 'block';
        console.log('✅ Showing loading indicator');
    }
    if (newsContainer) newsContainer.innerHTML = '';
    if (status) status.style.display = 'none';

    if (selectedSources.length === 0) {
        console.warn('⚠️ No sources selected, stopping...');
        if (loading) loading.style.display = 'none';
        showNoResults();
        return;
    }

    try {
        console.log('🔧 Creating news service...');
        const newsService = new AggregatedNewsService({
            newsapi: API_CONFIG.newsapi.key,
            guardian: API_CONFIG.guardian.key,
            worldnews: API_CONFIG.worldnews.key
        });

        console.log('📡 Fetching articles...');
        const allArticles = await newsService.getAllNews(selectedSources, settings.articlesPerPage);
        currentArticles = allArticles;

        console.log('📄 Raw articles received:', allArticles.length);

        const filteredNews = allArticles.filter(article => {
            if (!selectedSources.includes(article.source)) {
                return false;
            }

            const titleContainsBlocked = containsBlockedKeyword(article.title);
            const descContainsBlocked = containsBlockedKeyword(article.description);

            return !titleContainsBlocked && !descContainsBlocked;
        });

        console.log('📊 Filtered articles:', filteredNews.length);

        if (loading) {
            loading.style.display = 'none';
            console.log('✅ Hiding loading indicator');
        }

        updateStatus(allArticles.length, filteredNews.length);

        if (filteredNews.length === 0) {
            console.warn('⚠️ No articles to display');
            showNoResults();
            return;
        }

        console.log('🎨 Displaying articles...');
        displayNews(filteredNews);

    } catch (error) {
        console.error('❌ Failed to load news:', error);
        if (loading) loading.style.display = 'none';
        showError('Failed to load news. Please check your internet connection and try again.');
    }
}

function updateStatus(totalArticles, filteredArticles) {
    const status = document.getElementById('status');
    if (!status) return;

    if (blockedKeywords.length > 0 || selectedSources.length < activeSources.length) {
        status.style.display = 'block';
        status.className = 'status filtered';
        const filteredCount = totalArticles - filteredArticles;
        status.innerHTML = `
            ദ്ദി(˵ •̀ ᴗ - ˵ ) ✧ <br> Showing ${filteredArticles} articles 
            ${filteredCount > 0 ? `(${filteredCount} filtered out)` : ''}
            from ${selectedSources.length} sources
        `;
    } else {
        status.style.display = 'block';
        status.className = 'status';
        status.innerHTML = `0.o Showing ${filteredArticles} latest articles from all sources`;
    }
}

function displayNews(articles) {
    console.log('🎨 Starting displayNews with', articles.length, 'articles');

    const newsContainer = document.getElementById('newsContainer');
    if (!newsContainer) {
        console.error('❌ News container element not found!');
        return;
    }

    newsContainer.innerHTML = '';
    console.log('🧹 Cleared news container');

    if (articles.length === 0) {
        console.warn('⚠️ No articles to display');
        showNoResults();
        return;
    }

    articles.forEach((article, index) => {
        console.log(`📰 Creating card ${index + 1}:`, article.title.substring(0, 50) + '...');

        const newsCard = document.createElement('article');
        newsCard.className = 'news-card';
        newsCard.onclick = () => openArticle(article.url);

        const imageHtml = article.urlToImage ?
            `<img src="${article.urlToImage}" alt="Article image" onerror="this.src='https://via.placeholder.com/400x200/667eea/ffffff?text=${encodeURIComponent(article.source)}'; this.onerror=null;">` :
            `<div style="height: 150px; background: linear-gradient(135deg, #667eea, #764ba2); display: flex; align-items: center; justify-content: center; color: white; font-size: 1.2rem; text-align: center; padding: 1rem;">
                ₍^. .^₎⟆<br><small style="font-size: 0.8rem; margin-top: 0.5rem;">${article.source}</small>
            </div>`;

        const publishedDate = new Date(article.publishedAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });

        newsCard.innerHTML = `
            ${imageHtml}
            <div class="news-content">
                <h3 class="news-title">${article.title}</h3>
                <p class="news-description">${article.description}</p>
                <div class="news-meta">
                    <span class="news-source">${article.source}</span>
                    <span class="news-date">${publishedDate}</span>
                </div>
            </div>
        `;

        newsCard.style.animationDelay = `${index * 0.1}s`;
        newsContainer.appendChild(newsCard);
    });

    console.log('✅ Successfully created', articles.length, 'news cards');
    console.log('📊 News container now has', newsContainer.children.length, 'child elements');
}

function openArticle(url) {
    if (url && url !== '#') {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
}

function showNoResults() {
    const newsContainer = document.getElementById('newsContainer');
    if (!newsContainer) return;

    newsContainer.innerHTML = `
        <div class="no-results">
            <h3>ᯓ★ No articles available</h3>
            <p>Unable to fetch articles from the selected news sources.</p>
            <div style="text-align: left; margin: 1rem 0;">
                <p><strong>Pour Quoi?</strong></p>
                <ul style="margin-left: 1rem;">
                    <ul>⤷ RSS feeds are temporarily unavailable</ul>
                    <ul>⤷ API rate limits have been reached</ul>
                    <ul>⤷ Network connectivity issues</ul>
                    <ul>⤷ CORS restrictions on RSS services</ul>
                </ul>
            </div>
            <button class="btn" onclick="loadNews()" style="margin-right: 1rem;">↻ Try Again ↺</button>
            <button class="btn btn-secondary" onclick="clearAllFilters()">Clear Everything</button>
        </div>
    `;
}

// ==============================================
// UTILITY FUNCTIONS
// ==============================================

function clearAllFilters() {
    blockedKeywords = [];
    selectedSources = [];

    updateKeywordsList();
    setupSources();

    saveToLocalStorage('blockedKeywords', blockedKeywords);
    saveToLocalStorage('selectedSources', selectedSources);

    loadNews();
}

function resetToDefaults() {
    localStorage.clear();

    blockedKeywords = [];
    selectedSources = ['Mashable', 'Wired', 'Ars Technica', 'CNET', 'CNN'];
    settings = {
        articlesPerPage: 50,
        darkMode: false,
        autoRefresh: false,
        hideInactiveSources: false,
        shuffleArticles: false
    };

    updateKeywordsList();
    setupSources();
    applySettings();

    saveToLocalStorage('blockedKeywords', blockedKeywords);
    saveToLocalStorage('selectedSources', selectedSources);
    saveToLocalStorage('settings', settings);

    loadNews();

    showSuccess('Reset to default settings!');
}

function exportSettings() {
    const exportData = {
        blockedKeywords,
        selectedSources,
        settings,
        exportDate: new Date().toISOString(),
        version: '1.0'
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    link.download = `clearfeed-settings-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
}

function importSettings(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importData = JSON.parse(e.target.result);

            if (importData.blockedKeywords) blockedKeywords = importData.blockedKeywords;
            if (importData.selectedSources) selectedSources = importData.selectedSources;
            if (importData.settings) settings = { ...settings, ...importData.settings };

            saveToLocalStorage('blockedKeywords', blockedKeywords);
            saveToLocalStorage('selectedSources', selectedSources);
            saveToLocalStorage('settings', settings);

            applySettings();
            updateKeywordsList();
            setupSources();
            loadNews();

            showSuccess('Settings imported successfully!');

        } catch (error) {
            showError('Invalid settings file. Please check the file and try again.');
        }
    };
    reader.readAsText(file);
}

// ==============================================
// SETTINGS MANAGEMENT
// ==============================================

function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.style.display = 'flex';
}

function closeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.style.display = 'none';
}

function updateSettings() {
    const articlesPerPageSelect = document.getElementById('articlesPerPage');
    if (articlesPerPageSelect) {
        settings.articlesPerPage = parseInt(articlesPerPageSelect.value);
    }
    saveToLocalStorage('settings', settings);
    loadNews();
}

function toggleAutoRefresh() {
    const checkbox = document.getElementById('autoRefresh');
    if (checkbox) {
        settings.autoRefresh = checkbox.checked;

        if (settings.autoRefresh) {
            startAutoRefresh();
        } else {
            stopAutoRefresh();
        }

        saveToLocalStorage('settings', settings);
    }
}

function toggleHideInactiveSources() {
    const checkbox = document.getElementById('hideInactiveSources');
    if (checkbox) {
        settings.hideInactiveSources = checkbox.checked;
        saveToLocalStorage('settings', settings);
        setupSources();
    }
}

function toggleShuffleArticles() {
    const checkbox = document.getElementById('shuffleArticles');
    if (checkbox) {
        settings.shuffleArticles = checkbox.checked;
        saveToLocalStorage('settings', settings);
        loadNews();
    }
}

function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshInterval = setInterval(() => {
        console.log('Auto-refreshing news...');
        loadNews();
    }, 30 * 60 * 1000);
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
    if (errorModal) errorModal.style.display = 'flex';
}

function closeErrorModal() {
    const errorModal = document.getElementById('errorModal');
    if (errorModal) errorModal.style.display = 'none';
}

function showSuccess(message) {
    const notification = document.createElement('div');
    notification.className = 'success-notification';
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
    if (event.target.id === 'keywordInput' && event.key === 'Enter') {
        event.preventDefault();
        addKeyword();
    }

    if (event.key === 'Escape') {
        closeErrorModal();
        closeSettingsModal();
    }
});

window.addEventListener('resize', function() {
    clearTimeout(window.resizeTimeout);
    window.resizeTimeout = setTimeout(() => {
        if (window.innerWidth <= 768) {
            console.log('📱 Mobile layout detected');
        }
    }, 150);
});