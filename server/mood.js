// ==============================================
// MOOD: doomer / neutral / hopecore, per article
// ==============================================
// Version 1 scores words: doom words count against an article, hope words for
// it, the headline counts double, and a word right after "no"/"not" is skipped.
// It's quick and free but approximate (it can't read sarcasm or context).
//
// classifyMoods() is async on purpose: a sentiment model (a local one, or an
// LLM with a per-URL cache) can replace the scorer later without the API or
// the browser changing. Each article says which method tagged it (moodSource).

const DOOMER_AT = -2;    // score at or below this is "doomer"
const HOPECORE_AT = 2;   // score at or above this is "hopecore"
const HEADLINE_WEIGHT = 2;

// `*` matches any word ending, as in the keyword filter
const DOOM_WORDS = [
    'war', 'wars', 'killed', 'killing*', 'kills', 'dead', 'death*', 'dies', 'died', 'shooting*', 'murder*',
    'massacre*', 'terror*', 'bomb*', 'missile*', 'airstrike*', 'attack*', 'invasion', 'disaster*', 'crisis', 'crises',
    'catastroph*', 'collapse*', 'recession', 'layoff*', 'laid off', 'bankrupt*', 'pandemic', 'outbreak*', 'wildfire*',
    'earthquake*', 'hurricane*', 'flood*', 'drought*', 'famine', 'crash*', 'plunge*', 'slump*', 'fear*', 'threat*',
    'warn*', 'danger*', 'deadly', 'fatal*', 'victim*', 'injured', 'arrest*', 'fraud*', 'scandal*', 'hack*', 'breach*',
    'ransomware', 'lawsuit*', 'sued', 'banned', 'fired', 'toxic', 'pollution', 'extinct*', 'grim', 'worst'
];

const HOPE_WORDS = [
    'breakthrough*', 'rescue*', 'saved', 'saves', 'cure*', 'heal*', 'recover*',
    'record high', 'celebrat*', 'restor*', 'win', 'wins', 'won', 'victory', 'milestone*', 'reunite*', 'reunion',
    'hope*', 'inspir*', 'kindness', 'donat*', 'volunteer*', 'thriv*', 'boost*', 'improv*', 'success*',
    'discover*', 'first-ever', 'award*', 'honor*', 'honour*', 'clean energy', 'renewable*', 'solar',
    'conservation', 'peace', 'ceasefire', 'rebound*',
    'joy*', 'happy', 'happiest', 'adorable', 'delight*'
];

const NEGATORS = new Set(['no', 'not', 'never', 'without', "isn't", "wasn't", "won't", "didn't"]);

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word matching like the browser's keyword filter (public/script.js)
function wordPattern(word) {
    const body = word
        .split(' ')
        .map(part => part.split('*').map(escapeRegExp).join('[\\p{L}\\p{N}]*'))
        .join('\\s+');
    // A following apostrophe blocks the match too, so "won" doesn't hit "won't"
    return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}'’])`, 'giu');
}

const DOOM_PATTERNS = DOOM_WORDS.map(wordPattern);
const HOPE_PATTERNS = HOPE_WORDS.map(wordPattern);

// Matches in `text`, skipping any right after a negator ("no deaths", "not a crisis")
function countMatches(text, patterns) {
    if (!text) return 0;
    let count = 0;
    for (const pattern of patterns) {
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) {
            const before = text.slice(Math.max(0, match.index - 12), match.index).toLowerCase().trim().split(/\s+/).pop();
            if (!NEGATORS.has(before)) count++;
        }
    }
    return count;
}

function scoreText(text) {
    return countMatches(text, HOPE_PATTERNS) - countMatches(text, DOOM_PATTERNS);
}

export function scoreMood(article) {
    const score = HEADLINE_WEIGHT * scoreText(article.title) + scoreText(article.description);
    const mood = score <= DOOMER_AT ? 'doomer' : score >= HOPECORE_AT ? 'hopecore' : 'neutral';
    return { mood, moodScore: score, moodSource: 'lexicon' };
}

export async function classifyMoods(articles) {
    return articles.map(article => ({ ...article, ...scoreMood(article) }));
}
