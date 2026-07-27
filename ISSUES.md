# Known issues

Things found but **not** fixed, with enough detail to pick up cold. Fixed items are recorded in
`CLAUDE.md` / `docs/SELF-HOSTING.md` instead, not here.

Last reviewed: 2026-07-27 (during the shared header + footer work).

---

## 1. Subpages still depend on Google Fonts

**Where:** `assets/css/styles.css`, line 1.

```css
@import url('https://fonts.googleapis.com/css2?family=Urbanist:…&family=Open+Sans:…');
```

`docs/SELF-HOSTING.md` made the *homepage* fully self-contained (zero external requests), but the
hand-built pages were never touched, so every subpage still calls out to `fonts.googleapis.com`
(which then calls `fonts.gstatic.com`). The site as a whole is therefore **not** dependency-free,
and the two systems load the same two families by different routes.

**Why it matters:** third-party runtime dependency, a privacy/GDPR consideration, and an extra
blocking `@import` (an `@import` inside CSS is fetched only *after* `styles.css` parses, so it's
the slowest possible way to load a font).

**Fix sketch:** both families are already vendored — Urbanist as WOFF2 in
`assets/vendor/fonts/urbanist/` (declared by `assets/vendor/fonts/fonts.css`) and Open Sans as
`assets/vendor/fonts/OpenSans-VariableFont.ttf`. Drop the `@import`, add
`<link rel="stylesheet" href="/assets/vendor/fonts/fonts.css">` to `_layouts/default.html`, and
add `@font-face` blocks for Open Sans (ideally subset the 517 KB `.ttf` to WOFF2 first). Verify
Urbanist/Open Sans still render on subpages afterwards — `fonts.css` currently declares Urbanist
only.

---

## 2. `index.html` has no skip-link

**Where:** `index.html` vs `_layouts/default.html`.

Every hand-built page starts with `<a href="#main" class="skip-link">Skip to content</a>`. The
homepage has none, so keyboard and screen-reader users must tab through the whole nav on the
site's most-visited page.

**Why not fixed here:** there's no clean target. The Kubio export has no `<main>` and no content
wrapper with an id; the only candidate is `<div id="page-top" tabindex="-1">`, which sits *above*
the header and so is useless as a "skip to content" destination.

**Fix sketch:** add `id="main"` (plus `tabindex="-1"`) to the first content section after the
header — the `<div … id="about">` section is the natural choice — then insert the same skip-link
markup immediately after `<body>`. The `.skip-link` CSS lives in `styles.css`, which the homepage
can't load, so the rule would need to move to `site-header.css` (it's chrome, so that's a
reasonable home for it) or be added to `<style id="wiip-cards">`.

---

## 3. Nav toggle's accessible name never changes

**Where:** `_includes/header.html` + `assets/js/main.js`.

The button is always labelled `aria-label="Open menu"`, even while the menu is open. `main.js`
does correctly toggle `aria-expanded`, so the state is exposed — the label is just stale, and a
screen reader announces "Open menu, expanded".

**Why not fixed here:** cosmetic-in-the-a11y-tree, and out of scope for the navbar restructure.

**Fix sketch:** in `main.js`, alongside the existing `aria-expanded` update, set
`toggle.setAttribute('aria-label', isOpen ? 'Open menu' : 'Close menu')`. Low risk, ~1 line.

---

## 4. `events.html` needs JS to show any events

**Where:** `assets/js/render-events.js`, `assets/data/events.json`.

The page chrome is server-rendered but the event entries are fetched client-side, so with JS off
(or if the fetch fails) the page renders an empty shell. This is the last no-JS gap on the site
and is already noted in `CLAUDE.md`.

**Fix sketch:** move `assets/data/events.json` to `_data/events.yml` and render with a Liquid
loop at build time. No plugins needed, so it stays GitHub-Pages-safe.

---

## 5. `meetups.html` is orphaned

**Where:** `meetups.html`.

Nothing links to it — the homepage card that used to point at it was repurposed to Travel
Scholarship. It still builds and is still reachable by direct URL.

**Fix sketch:** decide to either delete it, or link it from the footer's **Explore** list in
`_includes/footer.html`. Needs a content owner's call, not a technical one.

---

## 6. Footer "Connect" links are dead placeholders

**Where:** `_includes/footer.html`, the **Connect** column.

`Email` and `Code of Conduct` are still `href="#"` and go nowhere. This mattered less when the
footer only appeared on subpages; it now renders on the homepage too, so they're on every page.
(`LinkedIn` was wired up to `https://lnkd.in/gDHsQN-a` — the URL the homepage's two "JOIN"
buttons already use.)

**Why not fixed:** needs real destinations — a contact address, and a Code of Conduct page that
doesn't exist yet. Both are content-owner decisions.

**Fix sketch:** point `Email` at a `mailto:`, and either write a `code-of-conduct.html` page
(front matter + `<main id="main" class="page">`, per "Adding a new page") or drop the link.

---

## 7. Kubio export contains a lot of inert dead code

**Where:** `index.html`.

Documented in `docs/SELF-HOSTING.md` and deliberately left alone: ~41 `medchemboston.org`
`url()`s in unused header-shape CSS, a hidden SureCart cart drawer subtree, WooCommerce analytics
config, and assorted WordPress inline JSON. None of it makes network requests or renders.

**Why not fixed:** the repo rule is "don't clean up index's CSS/markup" — excising it by hand
risks breaking the export for no user-visible gain.
