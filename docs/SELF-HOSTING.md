# Self-hosting the homepage's external assets

`index.html` is a Kubio/WordPress export of another site (`medchemboston.org`) and originally
loaded its CSS, JS, and fonts **at runtime from that host** — ~29 stylesheets + ~62 scripts, plus
Google Fonts and `stats.wp.com` trackers. That made the homepage depend on a third-party WordPress
site staying up and unchanged; if it moved its plugin paths or went away, the homepage would break.

This work made `index.html` **fully self-contained**: a network capture shows **zero** runtime
requests to any external host. Done 2026-07-17. (Subpages were never affected — they use
`assets/css/styles.css` + the Jekyll layout.)

## What's now local

- **CSS → `assets/vendor/{kubio,iconvert}/`** — the 6 load-bearing files:
  - `kubio/block-library.css` (174 KB), `kubio/third-party-blocks.css` (29 KB)
  - `iconvert/pb-block-library.css` (227 KB), `iconvert/animate.min.css` (72 KB),
    `iconvert/style.min.css` (13 KB), `iconvert/fancybox.min.css` (13 KB)
  - The other **23 stylesheets** (WooCommerce, SureCart, LatePoint, contact-form-7, live-chat,
    superb-blocks, two stray themes, Jetpack, Bluehost, astra-sites) were **dropped**.
- **Fonts → `assets/vendor/fonts/`**:
  - **Urbanist** (headings) → 4 WOFF2 in `urbanist/` + a local `fonts.css` that replaces the Google
    Fonts `<link>`.
    - ⚠️ **Fixed 2026-07-27:** that `<link>` to `fonts.css` was left wrapped in the export's
      `<noscript>` block and had no ordinary counterpart, so **Urbanist never loaded for anyone
      with JS enabled** — headings silently fell back to Helvetica/Arial. It's now a plain
      stylesheet `<link>`. If you re-run this kind of asset surgery, check that replacements
      land *outside* `<noscript>`; the export uses a `preload`+`onload` / `<noscript>` pair for
      most stylesheets and it's easy to patch only the fallback half.
  - **Open Sans** (body) + **Oswald** → the theme's `.ttf`s (`OpenSans-VariableFont.ttf` 517 KB,
    `Oswald-VariableFont.ttf` 165 KB); the inline `@font-face` `url()`s were repointed to these.
  - Only Urbanist / Open Sans / Oswald actually render; the other 4 families the Google Fonts URL
    requested (Muli, Playfair Display, Libre Franklin, Mulish, Source Sans Pro) were dropped.
- **JS → all 63 external scripts dropped**, nothing self-hosted (see below).

The URLs in `index.html` are root-absolute (`/assets/vendor/…`), consistent with the rest of the
repo.

## Key decisions & findings

### JS was fully droppable
Desktop renders **pixel-identical** with zero external JS. The mobile horizontal overflow is
**pre-existing** — identical with and without JS (a separate Kubio-export layout bug, not caused
here). The clickable activity cards are plain `<a>` overlays, needing no JS. So none of the 63
scripts (jQuery, Kubio/iconvert frontend, WooCommerce, SureCart, wp-emoji, …) were kept.

### Phone-home removals (beyond `<link>`/`<script>` resources)
Several things fetched remotely at runtime via inline code and were removed:
- **wp-emoji subsystem** — the settings JSON + the `<script type="module">` detector; it pulled a
  polyfill from `medchemboston.org` and emoji PNGs from `s.w.org`. (Browsers render emoji natively.)
- **Cloudflare `cdn-cgi` challenge injector** — a root-relative script that 404s on GitHub Pages.
- **`stats.wp.com`** scripts + its dns-prefetch, and the stale **`EditURI`** (RSD/xmlrpc) link.

### Dead SureCart cart drawer → hidden, not deleted
Dropping SureCart's CSS un-hid its slide-out cart ("Review My Order / Checkout") at the page bottom.
It's a **16 KB nested WP-block subtree** tangled with a `surecart/checkout` wrapper and ~40 inline
component `<style>`s, so it's **hidden with one CSS rule** in `<style id="wiip-cards">`:

```css
.wp-block-surecart-slide-out-cart,.sc-cart-drawer,.sc-drawer__backdrop{display:none!important;}
```

Hiding is the surgical, low-risk fix — excising the subtree by hand risks breaking the HTML, and it
respects the repo rule "don't clean up index's CSS/markup."

### Left as inert dead code (zero runtime cost)
- **~41 Kubio "header-shapes" `url()`s** still name `medchemboston.org` in inline CSS, but they're
  **never fetched** (proven — 0 requests, even at a tall viewport). Mirroring them would be **5.3 MB**
  of decorative PNGs the page doesn't use, and mass-editing Kubio's generated CSS is against repo
  guidance — so they were left.
- **Inline WordPress JS-config objects** still contain `medchemboston.org` URLs as dead string data
  (localization for the removed scripts). Inert; never fetched.

These are why `grep medchemboston index.html` is non-empty — but none is a runtime dependency.

### `.gitignore` gotcha
The repo ignored `vendor/`, which **also matched `assets/vendor/`** — the new assets would not have
been committed or deployed. Fixed by anchoring the pattern to `/vendor/` (Bundler's root gem dir
only). **Keep future vendored front-end assets under `assets/vendor/`.**

## How it was verified
- **Network capture (the definitive check):** copy `index.html`, rewrite every
  `medchemboston.org` / `stats.wp.com` / `s.w.org` / `fonts.g*.com` URL to `http://localhost:<port>`,
  serve, load in headless Chrome (`--virtual-time-budget`), and read the local server's access log.
  Anything requested = a missed dependency. **Final run: nothing.** (This is also how the emoji and
  Cloudflare phone-homes were caught.)
- **Keep-set discovery:** stripping *all* external CSS from a copy blows up the layout (giant unsized
  icons, collapsed hero) — proving Kubio's grid + icon sizing live in the vendored CSS, not the 42
  inline `<style>` blocks. Dropping only the unused plugins rendered pixel-identical.
- **Visual:** headless-Chrome screenshots (desktop + mobile) compared against production; identical.

## Optional future polish
- The Open Sans variable `.ttf` is 517 KB — could be subset to WOFF2 to trim page weight.
- ~~The homepage's mobile horizontal overflow is **pre-existing** (unrelated to this work) and still
  unaddressed.~~ **Fixed 2026-07-27.** Cause: Kubio's `.h-x-container-inner` gutter uses negative
  side margins (`-35px`/`-14px`/`-10px` by breakpoint) that the section padding stops absorbing
  below ~360px, so button groups poked ~4px past the viewport. Fixed with
  `#kubio .wp-block-kubio-buttongroup__outer{overflow-x:clip}` in `<style id="wiip-cards">`.
  `clip` rather than `hidden` is deliberate — `hidden` would create a scroll container and break
  `position:sticky` on the site header.
- **Subpages still load Google Fonts** (`styles.css` opens with an `@import` to
  `fonts.googleapis.com`). The self-hosting work covered only the homepage, so the site as a whole
  still has a third-party font dependency — see `ISSUES.md`.
