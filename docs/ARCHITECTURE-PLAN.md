# Architecture plan: admin accounts + editable content

**Status:** Phase 0 complete (2026-09-18). Phases 1–3 not started.

## The goal

Several people on the team need to add and edit the site's collections — publications, photos,
members, conferences, events, glossary terms — **without editing HTML and without going through
one bottleneck person**. Different people should have different powers: some can publish
directly, others should have their submissions reviewed first.

GitHub Pages serves static files and nothing else. It cannot run server code, so it cannot check
a password or write to a database. That's the constraint driving everything below.

## The decision, in one paragraph

**Keep Jekyll and GitHub Pages for the public site. Add one small Cloudflare Worker that provides
the admin UI and the login.** Admins sign in with Google or an emailed code through **Cloudflare
Access**; the Worker checks their role in a **Cloudflare D1** database and, if they're allowed,
writes the change into `_data/*.yml` in this repo through the GitHub API. GitHub Pages rebuilds
and the change is live in about a minute.

The important consequence: **the Worker is the only thing that needs a GitHub account.** It holds
a single GitHub App token. The admins themselves never see GitHub, never install anything, and
sign in with the Google account they already use.

### Why not put the content in the database instead?

That was the obvious reading of "we need a database," and it's the wrong trade here:

- The site's pages are server-rendered and work with JavaScript off. Serving collections from a
  database means either rewriting every template as Worker-rendered HTML, or fetching client-side
  and giving up the no-JS guarantee and some SEO on the publications page.
- The whole corpus is ~230 items and ~5 MB of images. It is not a database-shaped problem.
- Git already gives us, for free, the things we'd otherwise have to build: full edit history, who
  changed what, and a one-click revert when someone pastes the wrong DOI.

So D1 holds **accounts, roles, and an audit/queue table** — the things git genuinely cannot do —
and git stays the content store. If the site ever outgrows that (instant publishing, per-row
permissions, thousands of rows), Phase 0 means the content is already structured data and the
migration is a straight import.

## Cost

Everything below is on a permanent free tier, not a trial. Limits as advertised at time of
writing — **re-check before committing**, they do change.

| Service | Free allowance | What we'd use |
|---|---|---|
| GitHub Pages | public repos, 1 GB site, 100 GB/mo bandwidth | the whole public site |
| Cloudflare Workers | 100,000 requests/day | admin UI + API (a few hundred/day at most) |
| Cloudflare D1 | 5 GB, 5M row reads/day | one users table, one audit table |
| Cloudflare Access | up to 50 users | Google + email-code login |
| Cloudflare DNS | free | the domain we already own |
| **Total** | | **$0/month** |

The domain is already paid for, so there's no new recurring cost at all.

**Mailgun isn't needed for login.** Cloudflare Access sends its own one-time email codes. Keep
Mailgun in reserve for *notifications* ("a contributor submitted a publication"), which is a
Phase 3 nicety, not a dependency.

### Alternatives considered

- **Oracle Cloud Always Free** — a genuine forever-free VM, but we'd own patching, TLS renewal,
  backups and uptime, Oracle reclaims idle Always Free compute in some regions, and it's a single
  point of failure. A lot of sysadmin work for a site that is fundamentally a folder of files.
- **Supabase free tier** — free projects pause after roughly a week of inactivity. For a
  deliberately low-traffic community site that's a live failure mode, not an edge case.
- **Firebase Spark** — workable, but Google keeps moving features behind the paid Blaze plan.
- **A git-backed CMS (Decap/Sveltia) on GitHub OAuth** — the least work by far, and the first
  recommendation, but it requires every admin to have a GitHub account. Ruled out on that basis.
  The plan below keeps its best idea (git as the content store) and replaces only the login.

## Phases

### Phase 0 — separate content from markup ✅ done

Required by every possible path, so it was done first and is useful on its own.

All six collections were extracted from hand-written HTML into `_data/*.yml`, and the pages
became Liquid loops: **2,707 lines of markup replaced by 186 lines of template.** Each YAML file
carries a header comment documenting its schema.

Verified by snapshotting the built pages before the change and diffing canonicalised DOMs after:
publications (1,966 nodes), dictac (698), scholarship (177), core-team (166), conferences (165)
and photo-gallery (159) all render **identically**, node for node.

Two things improved as a side effect:

- `events.html` now renders at build time, closing the site's last no-JS gap (`ISSUES.md` #4) and
  fixing `render-events.js`, which had been emitting link markup with no opening `<a>` tag.
- Values that used to be hand-maintained and could silently drift — sort keys, image `alt` text,
  conference date labels, reference numbering — are now derived by the template.

### Phase 1 — put the domain in front of the site

Point the existing domain's nameservers at Cloudflare (free), then `CNAME` the site to GitHub
Pages and add a `CNAME` file to this repo. The `.github.io` URL keeps working as a redirect, so
nothing already linked or printed breaks.

Nothing about the build changes. This exists because Cloudflare Access can only protect a
hostname Cloudflare controls.

*Effort: an afternoon, mostly waiting for DNS.*

### Phase 2 — login and roles

Deploy a Worker at `admin.<domain>` and put Cloudflare Access in front of it, with Google and
email-one-time-code as the identity providers. Access does the authentication and hands the
Worker a signed JWT; the Worker verifies it and looks the email up in a D1 `users` table:

| Role | Can do |
|---|---|
| `owner` | everything, plus add/remove admins |
| `editor` | publish changes directly to the live site |
| `contributor` | submit changes, which an editor or owner approves |

Two layers on purpose: Access decides *who may reach the admin panel at all*, D1 decides *what
they may do once inside*. Roles live in the database rather than in a repo file so that someone
with edit access to content can't promote themselves by editing a YAML file.

*Effort: a day.*

### Phase 3 — the admin UI

A form per collection, generated from the same schemas Phase 0 documented — "Add publication"
with fields for title, journal, authors, date, categories, links, tags. On save the Worker:

1. reads the current `_data/<collection>.yml` via the GitHub API,
2. inserts or updates the entry,
3. commits it back (with the file SHA, so a concurrent edit is detected and retried),
4. records who did what in the D1 audit table.

A `contributor`'s save opens a pull request instead of committing to `main`; an editor approves it
from the same UI. Photo uploads commit the image file alongside the YAML change — at current
volume the repo can absorb decades of photos, and if that ever stops being true the images move to
R2 without touching anything else.

Because the forms are generated from the schemas, **the derived fields stay derived**: nobody is
ever asked to type a sort key.

*Effort: the bulk of the work — a few days, and the part worth building incrementally. Start with
publications and photos, which are the two that actually change often.*

## Open questions

- Which domain, and is its DNS somewhere we can repoint?
- Who is `owner`, and what's the starting list of editors and contributors?
- Does the ~1 minute between "Save" and "live" need explaining in the UI, or is it a non-issue?
  (It's inherent to rebuilding a static site; the UI should show "publishing…" rather than
  pretend it's instant.)
- Should contributor submissions notify anyone by email, or is a pending-queue in the admin UI
  enough? This is the only thing that would bring Mailgun back in.
