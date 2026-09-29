# Styleguide

Every page on Self-Censored uses one design system: **`public/css/system.css`**. The live reference is **`/styleguide.html`**. It is built with the system itself, and its swatches read the real token values, so it can't drift.

The frame follows [privacy4all](https://soniapolis.com/privacy4all/): a frosted left sidebar, a glass search bar across the top, a left-aligned Averia Libre title with uppercase nav on the right, and glass buttons. It sits on Self-Censored's slate paper with the censor bar.

## Files

| File | What goes in it |
|---|---|
| `public/css/system.css` | Tokens (`:root`, `body.dark`), base elements, and every reusable component. The only place colours, fonts, sizes and spacing are defined. |
| `public/css/<page>.css` | Layout for one page only: how system components are arranged. Uses tokens; defines no new colours, fonts or spacing values. |
| `public/styleguide.html` | Live specimens of everything in `system.css`, plus the page template. |
| `assets/logo/`, `assets/icons/` | Outlet wordmarks and square icons, served under `/assets/`. Link them with `"logo"` and `"icon"` in `server/sources.json`. Where there's room show the wordmark, in small spots the icon; each falls back to the other, then to initials. All logos render at one height per spot: padding is trimmed in the browser, and a wordmark too wide for the spot uses the icon instead. |

A new page loads the Google Fonts link (Averia Libre 700, IBM Plex Mono 400/600) and `css/system.css`, plus its own `css/<page>.css` only if it needs page-specific layout.

## Rules

1. **Tokens only.** Use `var(--…)` for colour, type size, spacing, radius and blur. Page CSS has no raw hex values or font sizes. The only pixel values it may use are 1px hairlines, breakpoints and layout minimums. If you need a new value, add a token to `system.css` and its `body.dark` counterpart.
2. **Reuse before you add.** Build pages from existing components. If something new is reusable, add it to `system.css` **and** a specimen to `styleguide.html` in the same change. Remove components nothing uses.
3. **Page skeleton.** Copy it from the bottom of `/styleguide.html`:
   - the censor bar (`p.censor-bar[aria-hidden="true"]`) first, before `.shell`: full width, square, stuck to the top of the screen (`--censor-h`)
   - `.shell` = `.sidebar` (with the `s*lf` mark) + `.shell__main`
   - `.header`: one row with a `.title-block` on the left (one `h1.title` and a short `.subtitle` line under it) and `.header__search` (a small `.search` bar, input + Go) on the right. No right-hand nav.
   - `main.content` > `.content__inner`, the same width as `.header__inner`, so title and content line up
   - `.site-footer`
4. **The sidebar is the control panel, and never scrolls.** It is exactly the screen height below the censor bar. In order: Topics and Redacted keywords (`.pick-list--bullets`, two aligned columns; the bullet turns into × on hover; Redacted has "clear all" and a "+" underneath, and is hidden when nothing is redacted), Sources (only those in the feed, headed "x sources"; favourites first with a ★ in the same bullet column), then Bias and Mood when switched on. Clicking a name opens its place in Configure. At the bottom, one underlined "manage filters" link (opens Configure, which holds "Reset all filters") and the description. The search runs the full content width above the title; every search box has the same slight `--rule-soft` border.
5. **Search finds; settings hide.** The search bar only narrows to articles that mention a word. Words to avoid are managed in Settings. Both lists show as a `.remove-list` ("× word", removed on click): search terms green (`.remove-list--find`), avoided words red, each darker on hover.
6. **Above a feed:** one collapsible `.summary-bar` reading "Displaying N articles (x hidden)", with "x hidden ⌄" on the right to open the list of what was hidden and why. No tabs or sort controls on the feed.
7. **Settings** is a page, not a modal (`#settings`; the sidebar's gear `.sidebar__settings` button opens it and shows as current). It follows the FortifyAI settings page:
   - **Header:** "Settings" in the title typeface (`--font-title`) with a mono subtitle.
   - **Tabs:** horizontal `.settings-tabs` (Appearance · Preferences · Advanced settings · Contact). The current tab has an ink underline.
   - **Section nav:** each tab lists its sections in a sticky `.settings-nav` on the left. Clicking one jumps to it, and the highlight follows scrolling.
   - **Library:** only the full library is a dialog (`#libraryModal`).
   - **Sections:** each is a `.panel-title` over a `.panel-box`, and a field has a `.field-label` above it.
   - **Keywords:** tags (`.kw-tag-item`, with a WORD / PHRASE / WILDCARD / EXACT `.kw-kind`), and examples as dashed + tags.
   - **Topics:** `.topic-card` tiles, blue-framed when selected.
   - **Sources:** `.feed-rows` (★, logo, name, bias, credibility, trash on hover, with a slate header band). "Explore full library →" opens the dialog.
   - **Bias and Mood:** a rectangular `.switch` and a centred `.spectrum` (slider plus "Any"). "Any" means off.
   - **Advanced:** `.setting-row`s, plus `.sub-tag` subscriptions.
   - **Defaults:** a `.defaults-table`.
   - **Tables:** one design everywhere (`.src-table`, plus `.defaults-table` and `.setting-list`):
     - the same light `--rule-soft` border as the search box and Filters
     - a header in the active tab's grey (`--paper-sunk`) with sortable `.th-sort` columns
     - `--rule-soft` row lines, and a `.table-pager` in the same grey underneath
     - fixed page sizes, with short pages padded so the table keeps its height
     - outlet icons in a `.logo-box`, bias as a `.bias-tag`, and credibility as a plain icon and word
   - **Cards:** `.src-card` holds a logo box, name and country, ★ top right, `.topic-tag`s, a facts list, and a trash can on hover.
   - **Sidebar lists:** topics and sources are `.row-list` rows with a trash can on hover and a `.row-list__add` "+" under them on the right; pinned sources come first.
   - **Selected items** (library rows, topic tiles, subscriptions) share one soft look: `--select-bg` with a faint ring (`--select-ring`) and inner glow (`--select-glow`), no hard border.
   - **Motion:** things that open (popovers, dialogs, tab content) fade in and drop slightly. A `.collapse` eases its height open and closed. A changed row settles into its new state. All of it is about 0.22s, and it's switched off for `prefers-reduced-motion`.
   Its content, section by section:
   - **Redacted keywords:** an indexed `.kw-list` of `.kw-row`s (checkbox, `K-01`, word, WORD / PHRASE / WILDCARD `.kw-tag`), then "Add other keywords" (a search box plus unticked suggestions; typing a new word offers "Redact '…'").
   - **Topics:** `.topic-card`s, 3 across, each with an icon tile, name, description and "N of your sources"; selected cards have a dark frame, a filled tile and a `.choice-check` ✓.
   - **Sources:** a `.toolbar`, a `.feed-table` of grid or rows, and `.feed-actions` ("Reset to default" and "+ Add sources"), opening the Attach-style picker.
   - **Bias and Mood:** a `.switch` plus a `.segmented` control (All | each step).
   - **Advanced settings:** a "FEED" group with Hide/Show and a `.setting-list` of `.setting-row`s (title and description left, control right), plus a `.setting-note`.
   - **Appearance:** Light and Dark `.theme-card` previews and a "Sync with system" `.theme-sync` row.
   - **Defaults:** a `.defaults-summary` saying whether you match, "Save current as default", "Reset to default" and "Restore original defaults".
   Changes save as they're made. The page behind an open modal doesn't scroll.
8. **Shapes.** Buttons, chips, tags, fields, sidebar items and the pager all use 2px corners (`--radius-btn` = `--radius-chip`), the same as the containers. Buttons are flat: a solid tint and a hairline border, no gradients or shadows. The censor bar is square. Collections use `.ruled-grid` hairline cells. No drop shadows on cards; hover changes the background only.
9. **Type.** Trebuchet (`--font-sans`) for everything you read, including descriptions. Averia Libre (`--font-title`) only for the page title and sidebar mark. IBM Plex Mono (`--font-mono`) only for the search bar, buttons and pager. No typewriter faces.
10. **Colour means something.** Blue (`--action`, `--action-ink`) = primary action and selected tab. Pink (`--block-*`) = hidden, avoided or destructive, maroon on hover. Green (`--only-*`) = only show. Yellow (`--limited-bg`) = limited or unavailable. Red (`--error`, darker `--error-strong` on hover) = words you've chosen, which you can remove.
11. **One of each per page.** One `.title`, one `.btn--primary` per view.
12. **Paging.** Lists longer than 15 items page with `.pager`: First, Previous, numbers (first, last, two either side of the current one), Next, Last, and a summary line.
13. **Keep the glass.** Floating surfaces (sidebar, search bar, content, summary bar, modals) use the `--glass*` and `--blur*` tokens, with `-webkit-backdrop-filter` alongside.
14. **Accessible by default.** Real `<button>`s and `<a>`s. Toggles use `aria-pressed`; tabs use `role="tab"` and `aria-selected`; the current page uses `aria-current="page"`. Decorative text gets `aria-hidden`, and a card is one link (`.card__link`). Test at 390px wide: no horizontal page scroll.
15. **Dark mode is free.** Components only read tokens, so `body.dark` restyles them. Check new components with "Toggle dark" on `/styleguide.html`.

## Naming

Components are lowercase single words (`.card`, `.chip`, `.pager`). Their parts use `__` (`.card__title`) and their variants use `--` (`.btn--primary`, `.chip--block`). State comes from ARIA attributes (`[aria-pressed]`, `[aria-selected]`, `[aria-current]`, `[open]`), not extra classes.
