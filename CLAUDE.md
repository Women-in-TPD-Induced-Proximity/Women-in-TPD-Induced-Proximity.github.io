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
   header/nav/footer, and external `i0.wp.com` images. It has **no Jekyll front matter**, so
   Jekyll copies it **verbatim** and it keeps its own styling untouched.
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

Then clean up: `rm -rf _site` (it's git-ignored anyway).

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
  anchors; the "List of Activities" cards use `.wiip-elevated` (dropshadow + click overlay).
- `dictac.html` — **DicTACtionary** glossary (TAC modalities + induced-proximity terms).
  Terms are static `<article data-dic>` inside `data-dic-section` groups; an inline script
  filters them by the `#dic-search` box. Content is readable without JS; only search needs it.
- `publications.html`, `mentorship.html` — "coming soon" placeholders.
- `mission.html`, `core-team.html`, `conferences.html`, `meetups.html`, `photo-gallery.html`,
  `blog.html`, `events.html`, `get-involved.html`, `tools.html` — content pages.
- `404.html` — uses the shared layout (full nav + footer).

## JavaScript

- `assets/js/main.js` — mobile nav toggle (`[data-nav-toggle]` / `[data-nav]`) + year stamp
  (`#year`). Loaded on every layout page.
- `assets/js/render-events.js` — **events.html only**; fetches `assets/data/events.json`
  (relative) and renders the list. **Still requires JS** — this is the one remaining no-JS gap
  (the page *chrome* is server-rendered, but the event entries are not). Optional follow-up:
  move to `_data/events.yml` + a Liquid loop to render at build time.
- Inline page scripts: `dictac.html` (glossary search), `photo-gallery.html` (gallery filter).

## Design system (`assets/css/styles.css`, ~1030 lines)

- Tokens (CSS vars): `--navy #004d80`, `--navy-dk`, `--teal`, `--gold #f5b800`, surfaces, text,
  shadows, radii. Fonts: **Urbanist** (headings) + **Open Sans** (body).
- Components: `.page-hero`, `.section` / `.section.alt`, `.section-head`, `.cards-3`, `.card`,
  `.button.primary|secondary`, `.badge`, `.pill`, `.notice`, `.cta`, footer grid, mobile nav.
- Responsive breakpoints at 920 / 760 / 640 px.
- The lower portion of the file holds the per-page styles (`.conf-*`, `.dic-*`, gallery/filter,
  etc.) that were consolidated here from former inline `<style>` blocks — selectors are unique
  per page, so they're globally safe.
