# CLAUDE.md

Guidance for working in this repository.

## What this is

The website for the **Women in TPD / Induced Proximity** community (targeted protein
degradation + induced proximity science). It's a static site hosted on **GitHub Pages**,
built with **Jekyll**.

- Repo: `Women-in-TPD-Induced-Proximity/Women-in-TPD-Induced-Proximity.github.io`
- This is a **user/org Pages site → served at the domain root**
  (`https://women-in-tpd-induced-proximity.github.io/`), so there is **no `baseurl`**.
  Root-absolute paths like `/assets/...` are correct.

## Two design systems (important)

The site deliberately contains **two different front-end systems**. Know which one you're in:

1. **`index.html` — the Kubio/WordPress export.** ~300 KB, ~40 inline `<style>` blocks,
   hundreds of `--kubio-color-*` vars, machine-generated `style-local-*` classes, its own
   header/nav/footer. Its CSS/JS/fonts are **self-hosted** under `assets/vendor/` so the page has
   no runtime dependency on the WordPress site it was exported from (see **`docs/SELF-HOSTING.md`**).
   It has **no Jekyll front matter**, so Jekyll copies it **verbatim** and it keeps its own styling
   untouched.
   - Don't try to "clean up" or merge its CSS into the hand-built system.
   - When editing it, work **surgically** and **reuse existing base classes**
     (e.g. an icon's `style-v_xh_8AwkFU-*` base + an existing `style-local-NN`); reusing a
     local class on a second element is fine and adds no CSS.
   - Custom additions to index live in `<style id="wiip-cards">` in its `<head>` and use a
     `wiip-` class prefix.

2. **Every other page — hand-built.** Uses `assets/css/styles.css` + the Jekyll
   layout/includes below. This is where normal work happens.

The two systems look different (different brand lockup, fonts, palette), so there is a visual
seam between the homepage and the subpages. This is **known and accepted** — don't "fix" it
without being asked.

## Jekyll architecture

- `_config.yml` — minimal, GitHub-Pages-safe (no plugins).
- `_layouts/default.html` — the page skeleton: `<head>` (title/description/`styles.css`),
  skip-link, `{% include header.html %}`, `{{ content }}`, `{% include footer.html %}`,
  then `main.js`.
- `_includes/header.html` / `_includes/footer.html` — the shared chrome, defined **once**.
  - The header highlights the active nav link via the page's `active` front-matter value.
  - **Chrome uses root-absolute paths** (`/assets/...`, `/mission.html`, …) on purpose, so it
    also works on `404.html` (which GitHub serves from arbitrary URLs).
  - The footer year is stamped at build time with `{{ site.time | date: "%Y" }}` **and**
    refreshed client-side by `main.js`.

### Subpages are content fragments

Each hand-built page is just front matter + body, e.g.:

```
---
layout: default
title: "DicTACtionary"
description: "..."        # quote it (see gotcha below)
active: mission           # optional; only mission / core-team use this
---
<main id="main" class="page"> ... </main>
<script> ...optional page-specific JS... </script>
```

The layout supplies `<html>/<head>/<body>`, the chrome, and `main.js`. Don't repeat those in
a page.

### Adding a new page

1. Create `name.html` with the front matter above + a `<main id="main" class="page">`.
2. Page-specific **CSS** → add to `assets/css/styles.css` (use a unique class prefix; that's
   how the existing per-page styles live there with zero collisions).
3. Page-specific **JS** → an inline `<script>` after `</main>`, or a file in `assets/js/`
   referenced from the fragment.
4. If it should be discoverable, add it to the **Explore** list in `_includes/footer.html`.
5. Keep the **top nav minimal** (Mission · Core Team · Join) — don't bloat it.

## Build + verify loop

Toolchain: **Ruby 3.2.2 via rbenv**, **Jekyll 4.4.1** installed (`gem install jekyll`).
rbenv shims aren't always on PATH — prefix with:

```bash
export PATH="$HOME/.rbenv/shims:$PATH"
```

**Canonical local preview (matches production):**

```bash
bundle install            # one time; installs the github-pages gem
bundle exec jekyll serve  # http://localhost:4000  (auto-rebuilds)
```

**Quick one-off build gotcha:** plain `jekyll build`/`serve` will try to load Bundler because
a `Gemfile` is present, and fail if `bundle install` hasn't been run. Either use
`bundle exec`, or temporarily move the Gemfile:

```bash
mv Gemfile .Gemfile.bak && jekyll build ; mv .Gemfile.bak Gemfile
```

**Verifying visually (the loop used here):** the built chrome uses **absolute** `/assets`
paths, so you **must serve over HTTP — not `file://`**:

```bash
cd _site && python3 -m http.server 8765      # then visit http://localhost:8765/<page>.html
```

Screenshot with headless Chrome and inspect:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars --window-size=1280,1500 \
  --screenshot=/tmp/shot.png "http://localhost:8765/dictac.html"
```

Then clean up: `rm -rf _site` (it's git-ignored anyway). **Don't `rm -rf _site` while a
`bundle exec jekyll serve` is running** — serve serves *from* that dir but only rebuilds it on a
*source* change, so deleting it 404s the live `:4000` server (and its own error page) until the
next edit. If a serve is already up, just screenshot `http://localhost:4000/<page>` directly
instead of doing a separate build + static server.

What to check after a build:
- `jekyll build` exits cleanly (watch for **YAML front-matter exceptions**).
- `_site/index.html` is unchanged in size (~303 KB) — confirms the Kubio export was copied
  verbatim, not run through a layout.
- Chrome is present in served HTML (no-JS): `grep -c 'class="site-header"' _site/<page>.html`.

## Gotchas / decisions (don't relearn these)

- **Quote front-matter strings.** At least one description contains a colon
  (`"The DicTACtionary: ..."`); unquoted, YAML reads it as a mapping and the build throws
  "mapping values are not allowed here." Always wrap `title`/`description` in double quotes.
- **`.nojekyll` was removed on purpose** — it was the switch that *disabled* Jekyll. Don't add
  it back unless you intend to turn Jekyll off (which would stop includes/layouts from
  rendering).
- **`index.html` must stay front-matter-free** so Jekyll copies it verbatim. Adding front
  matter (or a global layout default) would wreck it.
- **There are two `<head>`s — edit both.** The homepage doesn't use the layout, so anything
  head-level (favicon, meta/OG tags, analytics, fonts) must be added to **both**
  `_layouts/default.html` (all hand-built pages + `404.html`) **and** `index.html`'s own Kubio
  `<head>`. The favicon `<link>`s live in both.
- **Don't verify the built site over `file://`** — absolute `/assets` paths only resolve under
  an HTTP root.
- **`partials.js` is gone.** It was a prior approach (client-side header/footer injection)
  superseded by Jekyll includes. The active runtime JS is just `main.js`
  (mobile nav toggle + year) plus a couple of page-specific scripts.
- GitHub Pages builds with the `github-pages` gem (Jekyll 3.10.x) in safe mode. We use only
  core features (layouts, includes, front matter, `include`/`date` filters), so it's
  compatible. The `Gemfile` is only for local/Actions; classic Pages builds on push regardless.

## Page inventory

- `index.html` — homepage (Kubio). Intro icon cards link to: Highlighted Publications →
  `publications.html`, **DicTACtionary** → `dictac.html`, Mentorship Program →
  `mentorship.html`. Whole cards are clickable via absolutely-positioned `.wiip-overlay`
  anchors; the "List of Activities" cards (Conferences, Travel Scholarship, Photo Gallery)
  use `.wiip-elevated` (dropshadow + click overlay) and point at **local** images
  (`/assets/images/conference-stock.jpg`, `scholarship/raghd-obidat-2026.jpeg`,
  `gallery/annual-2023.jpg`). A `#kubio .wiip-elevated figure img{aspect-ratio:3/2;object-fit:cover}`
  rule in `<style id="wiip-cards">` normalises those three to a uniform 3:2 crop, so a
  replacement image needn't be 3:2 — it's centre-cropped to fit.
  Only ~5 `<img>` render on the whole page: the hero logo (`image.png`, root-relative), these three
  card photos, and a never-shown SureCart cart template. The intro icon cards are inline SVG. The
  page's CSS/JS/fonts are self-hosted under `assets/vendor/` and its SEO/social metadata is WiTPD
  (OG / `canonical` / JSON-LD point at the site root) — see **`docs/SELF-HOSTING.md`**.
- `dictac.html` — **DicTACtionary** glossary (TAC modalities + induced-proximity terms).
  Terms are static `<article data-dic>` inside `data-dic-section` groups; an inline script
  filters them by the `#dic-search` box. Content is readable without JS; only search needs it.
- `publications.html`, `mentorship.html` — "coming soon" placeholders.
- `scholarship.html` — **Travel Scholarship** winners by year (2024–26) with photos, linked from
  the homepage "Travel Scholarship" activity card. Reuses the gallery `.photo-grid`/`.photo-tile`
  but with real `<img class="photo-img">` (the `.photo-img` rule = full image, no crop, portraits
  capped at 460 px); photos live in `assets/images/scholarship/`. Photos are **click-to-expand** via
  the shared `assets/js/lightbox.js` viewer (see JavaScript).
- `photo-gallery.html` — community photo grid (`.photo-grid`/`.photo-tile`), photos in
  `assets/images/gallery/`. Has an inline gallery-filter script **and** the shared
  `assets/js/lightbox.js` **click-to-expand** viewer (see JavaScript).
- `mission.html`, `core-team.html`, `conferences.html`,
  `blog.html`, `events.html`, `get-involved.html`, `tools.html` — content pages.
- `meetups.html` — **orphaned**: the homepage card that linked it was repurposed to Travel
  Scholarship, so nothing links to it now (it still builds).
- `404.html` — uses the shared layout (full nav + footer).

## Favicon / brand mark

The favicon is the logo's **"O"**: a navy ring (`#131C55`) with an orange (`#EE7320`) quarter from
12→3 o'clock on a white rounded tile, rebuilt as **vector** so it's crisp at 16 px. (Note the
**logo palette differs from the site tokens** — `--navy #004d80` / `--gold #f5b800` — it's part of
the homepage-vs-subpage seam.)

- Source of truth: `assets/favicon.svg`. Rasters derive from it: `favicon.ico` (repo **root**,
  16/32/48 — satisfies the browser's automatic `/favicon.ico` request) and
  `assets/apple-touch-icon.png` (180², solid-white bg for iOS). Regenerate by rendering the SVG
  headless to a transparent PNG, then `PIL Image.save(..., sizes=[...])` — no ImageMagick needed.
- Wired into **both** `<head>`s (see the two-`<head>`s gotcha).

## JavaScript

- `assets/js/main.js` — mobile nav toggle (`[data-nav-toggle]` / `[data-nav]`) + year stamp
  (`#year`). Loaded on every layout page.
- `assets/js/render-events.js` — **events.html only**; fetches `assets/data/events.json`
  (relative) and renders the list. **Still requires JS** — this is the one remaining no-JS gap
  (the page *chrome* is server-rendered, but the event entries are not). Optional follow-up:
  move to `_data/events.yml` + a Liquid loop to render at build time.
- `assets/js/lightbox.js` — **shared image viewer**, referenced from `photo-gallery.html` and
  `scholarship.html` (deferred `<script>` after `</main>`). Progressive enhancement: it scans for
  `.photo-tile` elements containing an `<img>`, makes each a keyboard-accessible button, and opens a
  click-to-expand overlay (the `.lightbox-*` CSS) showing that tile's `.photo-caption`, with
  prev/next across all photos on the page, a counter, Esc/←/→ keys, focus trap + restore, and
  backdrop-click close. Photos stay fully visible without JS; the script adds a `js-lightbox` class
  to `<html>` that gates the CSS hover/zoom affordances so they never show if JS didn't load. It's
  **generic** — drops onto any page using the `.photo-tile` markup, no per-page config. (No hi-res
  originals exist, so it shows the same image file uncropped/larger; it would honor an optional
  `data-full` attr if hi-res versions are ever added.)
- Inline page scripts: `dictac.html` (glossary search), `photo-gallery.html` (gallery filter).

## Design system (`assets/css/styles.css`, ~1210 lines)

- Tokens (CSS vars): `--navy #004d80`, `--navy-dk`, `--teal`, `--gold #f5b800`, surfaces, text,
  shadows, radii. Fonts: **Urbanist** (headings) + **Open Sans** (body).
- Components: `.page-hero`, `.section` / `.section.alt`, `.section-head`, `.cards-3`, `.card`,
  `.button.primary|secondary`, `.badge`, `.pill`, `.notice`, `.cta`, footer grid, mobile nav.
- Responsive breakpoints at 920 / 760 / 640 px.
- The lower portion of the file holds the per-page styles (`.conf-*`, `.dic-*`, gallery/filter,
  etc.) that were consolidated here from former inline `<style>` blocks — selectors are unique
  per page, so they're globally safe.
- The very end holds the **shared `.lightbox-*` component** (the image viewer, `assets/js/lightbox.js`)
  plus its `.js-lightbox .photo-tile` hover/zoom hints — not per-page, but keyed off the `.photo-tile`
  markup that both `photo-gallery.html` and `scholarship.html` use.
