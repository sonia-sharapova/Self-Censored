# Self-Censored
Easy-peasy, self-guided news filtration

## Overview
The Self-Censored news app uses a client-side keyword filtering system that scans article metadata to hide content containing specified terms. This document explains exactly how the blocking works, what content is checked, and the system's limitations.

## What Content Is Scanned
### Content That IS Checked:
- Article Headlines/Titles - The main headline text
- Article Descriptions - Summary/excerpt text provided by the news API
- Article Snippets - Short preview text (when available)

## Content That IS NOT Checked:
- Full Article Body - Complete article text (not provided by most APIs)
- Article URLs - Web addresses are not scanned
- Author Names - Bylines are not filtered
- Source Names - Outlet names are not blocked
- Publication Dates - Timestamps are ignored
- Image Alt Text - Image descriptions are not checked

## Technical Implementation
### Core Filtering Function
javascriptfunction containsBlockedKeyword(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    return blockedKeywords.some(keyword =>
        lowerText.includes(keyword.toLowerCase())
    );
}

### How Articles Are Filtered
javascriptconst filteredNews = allArticles.filter(article => {
    // Check if source is selected
    if (!selectedSources.includes(article.source)) {
        return false;
    }

    // Check for blocked keywords in title and description
    const titleContainsBlocked = containsBlockedKeyword(article.title);
    const descContainsBlocked = containsBlockedKeyword(article.description);

    // Article is hidden if ANY blocked keyword is found
    return !titleContainsBlocked && !descContainsBlocked;
});
