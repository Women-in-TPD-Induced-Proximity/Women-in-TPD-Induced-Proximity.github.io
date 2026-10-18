# Women in TPD / Induced Proximity — website

The community website for targeted protein degradation and induced-proximity science.
Static site, built with **Jekyll**, served by **GitHub Pages** at
<https://women-in-tpd-induced-proximity.github.io/>.

## Editing content

**All the lists on the site live in `_data/*.yml`.** You do not need to touch HTML to add a
publication, a team member, a photo, a conference, a glossary term, or an event.

| To change… | Edit |
|---|---|
| Highlighted publications | `_data/publications.yml` (categories: `_data/pub_categories.yml`) |
| DicTACtionary glossary | `_data/glossary.yml` |
| Core team | `_data/team.yml` + a photo in `assets/images/team/` |
| Photo gallery | `_data/gallery.yml` + a photo in `assets/images/gallery/` |
| Travel Scholarship winners | `_data/scholarship.yml` + photos in `assets/images/scholarship/` |
| Conferences | `_data/conferences.yml` |
| Events | `_data/events.yml` |

Every one of those files starts with a comment block explaining each field — **read it before
adding a row.** A few rules apply everywhere:

- Plain text is always safe; the templates escape everything on output.
- Sort keys, image `alt` text, conference date labels and reference numbering are **derived**, not
  typed. Don't hand-maintain them.
- Order in the file is the order on the page for anyone without JavaScript, so put a new row where
  it belongs rather than at the end. (`gallery.yml` is newest-**first**.)

Push to `main` and GitHub Pages rebuilds automatically.

## Running it locally

```bash
bundle install              # once
bundle exec jekyll serve    # http://localhost:4000, rebuilds on save
```

Needs Ruby (this repo is developed against 3.2.2 via rbenv). If `jekyll` isn't on your PATH,
`export PATH="$HOME/.rbenv/shims:$PATH"` first.

## Repo map

```
_data/          all page content (see above)
_layouts/       default.html — the page skeleton for every hand-built page
_includes/      header.html / footer.html — the shared chrome, defined once
assets/css/     tokens.css -> site-header.css -> site-footer.css -> styles.css
assets/js/      main.js (nav + year), sort.js, lightbox.js
assets/vendor/  self-hosted CSS/JS/fonts for the homepage
index.html      the homepage — a WordPress/Kubio export, handled differently (see CLAUDE.md)
docs/           SELF-HOSTING.md, ARCHITECTURE-PLAN.md
```

## Further reading

- **`CLAUDE.md`** — how the site is built, the two front-end systems, the build/verify loop, and
  the gotchas worth not relearning. Start here before changing anything structural.
- **`ISSUES.md`** — known problems that are deliberately not fixed yet.
- **`docs/SELF-HOSTING.md`** — why the homepage's assets are vendored locally.
- **`docs/ARCHITECTURE-PLAN.md`** — the plan for adding admin accounts and a database so the
  team can edit content through a web UI instead of git.

## Notes

- **Do not add a `.nojekyll` file.** It disables Jekyll, which would stop the layouts, includes
  and `_data` loops from rendering. It was removed on purpose.
