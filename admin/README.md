# WiTPD admin portal

A sign-in-protected web page where approved people add and edit the site's lists:
publications, DicTACtionary terms, the core team, gallery photos, scholarship winners and
photos, conferences and events. Nobody needs a GitHub account or has to touch YAML.

```
browser ──► Cloudflare Access ──► this Worker ──► GitHub API ──► _data/*.yml ──► GitHub Pages
            (Google / email code)   │                 (one commit per save)        (rebuild ~1 min)
                                    └─► D1: people + roles, review queue, activity log
```

- **Cloudflare Access** handles the login (Google, or a one-time code sent by email) and proves
  who the person is.
- **D1** (the `users` table) decides what they may do. That is the **People** page; there's no
  second list to keep in sync.
- **GitHub** stays the content store. Every save is a normal commit on `main`, so the history,
  blame and one-click revert all still work.

Roles:

| Role | Can |
|---|---|
| **Owner** | everything, plus add/remove people on the People page |
| **Editor** | publish changes directly; approve or reject contributors' submissions |
| **Contributor** | suggest changes; they wait in the review queue until an editor approves |

## What it does for you

- **Forms built from each list's schema** (`src/collections.js`, mirroring the comment at the
  top of each `_data/*.yml`). Required fields, date pickers, category pickers, link rows, and
  checks for bad URLs or disallowed HTML.
- **Ordering is automatic** where the page has a default sort. A new paper lands in date order,
  a gallery photo in year order, a conference by start date, so `sort.js`'s rule that the
  authored order is the default order always holds. Hand-ordered lists (team, glossary terms,
  winners) get ↑/↓ buttons.
- **Photos**: shrunk in the browser before upload, checked server-side to be a real JPEG, PNG
  or WebP, named like the existing files (`aacr-orlando-2025.jpg`, then `-2`, `-3`), and
  committed **in the same commit** as the YAML line that uses them.
- **Minimal diffs.** The YAML is edited in place, so comments, quoting and layout survive, and
  changing a journal name changes exactly one line. (`npm test` checks that every current data
  file reads and writes back byte-for-byte.)
- **Safe when two people edit at once.** Each edit carries a fingerprint of the row as the person
  saw it. If someone else changed that row in the meantime the save is refused, not applied to
  the wrong row. If the branch moved under a save, the change is recomputed on the new head.
- **Review queue.** A contributor's change is stored in D1, not as a branch. Approving it applies
  it to the *current* file, so queued submissions never conflict with each other.
- **Activity log** of every publish, submission and decision, with links to the commits.

Not editable here, on purpose: `_data/pub_categories.yml` (each category also needs CSS in
`styles.css`), the glossary's two section headings, and page prose. Edit those in the repo.

Photos are never deleted, even when an item is removed or its photo replaced. The homepage
references some gallery and scholarship images directly, and the old file costs nothing.

## One-time setup (all in the browser)

Nothing runs on anyone's computer, during setup or after. The portal runs on Cloudflare, and
Cloudflare redeploys it from this repo whenever `admin/` changes on `main`.

You need: a Cloudflare account (free), the domain's DNS on Cloudflare (Phase 1 of
`docs/ARCHITECTURE-PLAN.md`), admin rights on the GitHub org, and the portal merged into `main`.

**Where settings live.** Plain settings (IDs, the Access audience tag) go in `wrangler.toml` in
this repo. Edit it on github.com; the commit triggers a redeploy. Don't set them as plain
variables in the Cloudflare dashboard: each deploy resets those to the values in `wrangler.toml`.
Only the **secret** (the GitHub App key) is set in the dashboard, and secrets survive deploys.

### 1. Database (Cloudflare D1)

1. Cloudflare dashboard → **Storage & databases → D1 → Create database**. Name it `witpd-admin`.
2. Open it → **Console**. Paste the whole of `migrations/0001_init.sql` and run it.
3. In the same console, add yourself as the first owner. Use the email you'll sign in with, in
   lowercase:
   ```sql
   INSERT INTO users (email, name, role) VALUES ('you@example.org', 'Your Name', 'owner');
   ```
4. Copy the database's **ID** into `database_id` in `wrangler.toml`.

Everyone after that is added from the portal's **People** page. The name, not the email, appears
in the public commit history ("Via the admin portal, by Jane Doe").

### 2. GitHub access: a GitHub App

An App's tokens are minted hourly and the App itself never expires, and it isn't tied to any
one person's account.

1. GitHub → org **Settings → Developer settings → GitHub Apps → New GitHub App**.
   - Name: e.g. `WiTPD admin`. Homepage URL: the site.
   - **Webhook**: untick "Active".
   - **Repository permissions → Contents: Read and write.** Nothing else.
   - Where can it be installed: *Only on this account*.
2. Create it. Note the **App ID**, then **Generate a private key** (downloads a `.pem`).
3. **Install App** → this org → *Only select repositories* →
   `Women-in-TPD-Induced-Proximity.github.io`. The URL you land on ends in
   `/installations/<number>`; that number is the **installation ID**.
4. Put both numbers in `wrangler.toml` (`GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`).

If `main` has branch protection that requires pull requests, add the App to the bypass list,
or every save will be refused.

### 3. Deploy from the repo (Workers Builds)

1. Cloudflare dashboard → **Workers & Pages → Create → Import a repository**. Connect GitHub
   when asked, and give Cloudflare's app access to this repository.
2. Settings:
   - **Project name:** `witpd-admin` (must match `name` in `wrangler.toml`)
   - **Production branch:** `main`
   - **Root directory:** `admin`
   - **Build command:** leave empty. **Deploy command:** `npx wrangler deploy` (the default).
3. Deploy. This also creates `admin.womenintpdandip.org` (the `routes` entry in
   `wrangler.toml`). Until Access is set up, every request gets "Sign-in required", which is
   correct: the portal fails closed.
4. Worker → **Settings → Build → Build watch paths**: include `admin/*`. Otherwise every content
   save would trigger a pointless rebuild, since saves also commit to `main`.
5. Worker → **Settings → Variables and secrets → Add** → type **Secret**, name
   `GITHUB_APP_PRIVATE_KEY`. Paste the entire contents of the `.pem` file, including the
   `-----BEGIN…` and `-----END…` lines. Line breaks don't need to survive the paste.

*Stopgap alternative to the App:* a fine-grained personal access token limited to this
repository, with **Contents: read and write**, saved as a secret named `GITHUB_TOKEN`. It
expires (after a year at most) and acts as whoever created it.

### 4. Cloudflare Access (the login)

In the Cloudflare dashboard → **Zero Trust**:

1. First visit only: pick a team name and the Free plan. Your **team domain** is
   `<team>.cloudflareaccess.com`.
2. **Settings → Authentication → Login methods**: *One-time PIN* is there by default (a code
   by email, which works for any address). Optionally add *Google*.
3. **Access → Applications → Add an application → Self-hosted**:
   - Domain: `admin.womenintpdandip.org`
   - Session duration: e.g. 1 week
   - Policy: **Allow**, Include **Everyone**. Access only proves the email; the People page
     decides who gets in. Someone who isn't on it sees "You're signed in, but not on the
     list". (Prefer a tighter Access policy? Fine, but then you maintain two lists.)
4. Open the application and copy its **Application Audience (AUD) Tag**.
5. Fill in `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `wrangler.toml` and commit. Cloudflare
   redeploys within a minute or two.

Visit `https://admin.womenintpdandip.org`, sign in, and you should see the content dashboard.

**Before the domain is on Cloudflare:** comment out `routes` and enable Access on the
`*.workers.dev` URL instead (Worker → Settings → Domains & Routes → workers.dev → enable
Cloudflare Access). Then use that application's AUD tag.

**From a terminal instead** (optional, for developers): `npm install`, `npx wrangler login`,
`npx wrangler d1 create witpd-admin`, `npm run db:migrate`, `npm run deploy`, and
`npx wrangler secret put GITHUB_APP_PRIVATE_KEY < key.pem`. It ends up in the same place.

## Day to day

- **Add people**: People page → email, name, role.
- **After saving**, the page shows "Published" with links to the live page and to the commit. The
  site rebuilds in about a minute.
- **Undo**: edit the item again, or revert the commit on GitHub (the activity log links to it).
- **Review queue**: editors see a count in the top bar. A submission shows the proposed values,
  and for an edit, the current ones beside them with the changes highlighted.

## Local development

```bash
cp .dev.vars.example .dev.vars            # DEV_AUTH_EMAIL + fake GitHub
npm run db:migrate:local
npx wrangler d1 execute witpd-admin --local \
  --command "INSERT INTO users (email, name, role) VALUES ('you@example.org', 'You', 'owner')"
node dev/mock-github.js &                 # in-memory GitHub, reads this checkout
npm run dev                               # http://localhost:8787
```

The fake GitHub serves files from your working copy and keeps commits in memory, so nothing you
do touches the real repo. `curl http://127.0.0.1:8788/__file/_data/publications.yml` shows the
result. `DEV_AUTH_EMAIL` is honoured only when the request is for `localhost`, so it can't
switch off sign-in on a deployed Worker. Change it and restart to try another role.

```bash
npm test     # engine, forms, auth and GitHub client; no network needed
```

## Files

```
src/index.js        routes and request handling
src/collections.js  the editable lists — keep in step with the _data/*.yml header comments
src/forms.js        form rendering, parsing and validation
src/engine.js       applies one change to a YAML file (insert / update / delete / move)
src/github.js       GitHub API: reads, and atomic multi-file commits
src/auth.js         Cloudflare Access JWT verification
src/db.js           D1 queries (users, submissions, audit)
src/views.js        page templates;  src/html.js  escaping + layout
public/static/      the portal's CSS and JS
migrations/         D1 schema
dev/mock-github.js  fake GitHub for local development
```

If you change a `_data/*.yml` schema (new field, renamed field), update the matching entry in
`src/collections.js` and run `npm test`. The tests push every existing item through the form and
fail if any would be altered or rejected.
