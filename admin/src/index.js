// WiTPD admin portal — a Cloudflare Worker.
//
// Cloudflare Access logs people in; the users table in D1 says what they may
// do; edits are committed to _data/*.yml in the site's repo through the
// GitHub API, and GitHub Pages rebuilds the public site. See admin/README.md
// for setup and docs/ARCHITECTURE-PLAN.md for the reasoning.

import { BY_ID } from './collections.js';
import { parseForm } from './forms.js';
import { applyOp, findItem, mergeItem, readCollection, OpError } from './engine.js';
import { createGitHub } from './github.js';
import { authenticate } from './auth.js';
import { html, layout, respond, redirect } from './html.js';
import * as db from './db.js';
import * as views from './views.js';

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      console.error(err);
      return respond(layout({
        title: 'Error',
        body: views.message({ title: 'Something went wrong', body: html`<p>${err.message}</p><p><a href="/">Back to the start</a></p>` }),
      }), 500);
    }
  },
};

const FLASH = {
  published: 'Published. The public site rebuilds in about a minute.',
  submitted: 'Submitted. An editor will review it before it goes live.',
  approved: 'Approved and published. The public site rebuilds in about a minute.',
  rejected: 'Rejected.',
  withdrawn: 'Withdrawn.',
  user: 'Saved.',
  'user-removed': 'Removed.',
};

function flashFrom(url, gh, coll) {
  const done = url.searchParams.get('done');
  if (!FLASH[done]) return null;
  const commit = url.searchParams.get('commit');
  const links = [];
  if (coll && (done === 'published' || done === 'approved')) {
    links.push(html` <a href="${coll.siteUrl}${coll.page}" target="_blank" rel="noopener">View page ↗</a>`);
  }
  if (commit && /^[0-9a-f]{40}$/.test(commit)) {
    links.push(html` <a href="${gh.commitUrl(commit)}" target="_blank" rel="noopener">View change ↗</a>`);
  }
  return { kind: 'ok', body: html`${FLASH[done]}${links}` };
}

async function handle(request, env) {
  const url = new URL(request.url);
  const identity = await authenticate(request, env);
  if (!identity) {
    return respond(layout({
      title: 'Sign-in required',
      body: views.message({ title: 'Sign-in required', body: html`<p>This page is only reachable through the site's Cloudflare Access login.</p>` }),
    }), 401);
  }
  const user = await db.getUser(env.DB, identity.email);
  if (!user) {
    return respond(layout({
      title: 'No access',
      body: views.message({
        title: 'You’re signed in, but not on the list',
        body: html`<p>You signed in as <strong>${identity.email}</strong>, which hasn’t been given access. Ask a site owner to add you on the People page.</p>`,
      }),
    }), 403);
  }

  // Cross-site request forgery: every state-changing request must come from
  // a page on this origin.
  if (request.method === 'POST' && request.headers.get('origin') !== url.origin) {
    return respond('Cross-origin request refused.', 403, { 'content-type': 'text/plain' });
  }

  const siteUrl = String(env.SITE_URL || '').replace(/\/+$/, '');
  const ctx = { env, url, user, siteUrl, gh: createGitHub(env), request };
  ctx.pending = db.can.review(user) ? await db.countPending(env.DB) : 0;
  ctx.page = (title, body, status = 200, extra = {}) =>
    respond(layout({ title, user, body, pending: ctx.pending, ...extra }), status);

  const path = url.pathname.replace(/\/+$/, '') || '/';
  const m = path.match(/^\/c\/([a-z-]+)(?:\/(new|edit|delete|move))?$/);
  if (m) {
    const coll = BY_ID[m[1]];
    if (!coll) return notFound(ctx);
    const action = m[2] ?? 'list';
    if (action === 'list' && request.method === 'GET') return listPage(ctx, coll);
    if (action === 'new' || action === 'edit') return formPage(ctx, coll, action);
    if ((action === 'delete' || action === 'move') && request.method === 'POST') return simpleOp(ctx, coll, action);
    return notFound(ctx);
  }
  const s = path.match(/^\/submissions(?:\/(\d+))?(?:\/(approve|reject|withdraw))?$/);
  if (s) {
    if (!s[1] && request.method === 'GET') return submissionsPage(ctx);
    if (s[1] && !s[2] && request.method === 'GET') return submissionPage(ctx, Number(s[1]));
    if (s[1] && s[2] && request.method === 'POST') return reviewAction(ctx, Number(s[1]), s[2]);
    return notFound(ctx);
  }
  if (path === '/' && request.method === 'GET') {
    const recent = db.can.review(user) ? await db.listAudit(env.DB, 5) : [];
    return ctx.page('Content', views.dashboard({ user, pending: ctx.pending, recent }), 200, { flash: flashFrom(url, ctx.gh) });
  }
  if (path === '/activity' && request.method === 'GET') {
    if (!db.can.review(user)) return forbidden(ctx);
    return ctx.page('Activity', views.activity({ rows: await db.listAudit(env.DB, 200), commitUrl: ctx.gh.commitUrl }));
  }
  if (path === '/users' || path === '/users/delete') {
    if (!db.can.manageUsers(user)) return forbidden(ctx);
    return usersPage(ctx, path === '/users/delete');
  }
  return notFound(ctx);
}

function notFound(ctx) {
  return ctx.page('Not found', views.message({ title: 'Not found', body: html`<p><a href="/">Back to the start</a></p>` }), 404);
}

function forbidden(ctx) {
  return ctx.page('Not allowed', views.message({ title: 'Not allowed', body: html`<p>Your role can’t do that.</p>` }), 403);
}

// ---- collections -----------------------------------------------------------

async function listPage(ctx, coll) {
  const groups = readCollection(await ctx.gh.read(coll.file), coll);
  return ctx.page(coll.label, views.collectionList({ coll, groups, user: ctx.user, siteUrl: ctx.siteUrl }), 200, {
    flash: flashFrom(ctx.url, ctx.gh, { ...coll, siteUrl: ctx.siteUrl }),
  });
}

function target(ctx, source) {
  const p = source.get('p');
  const i = Number(source.get('i'));
  const h = source.get('h') ?? '';
  return { parent: p, index: Number.isInteger(i) ? i : -1, hash: h };
}

async function formPage(ctx, coll, mode) {
  const { url, request, gh, user } = ctx;
  const t = target(ctx, url.searchParams);
  const text = await gh.read(coll.file);
  const fctx = { siteUrl: ctx.siteUrl, categories: [] };
  if (coll.fields.some((f) => f.type === 'categories')) {
    fctx.categories = readCollection(await gh.read('_data/pub_categories.yml'), {})[0].items;
  }

  let existing = null;
  if (coll.parent) {
    const exists = readCollection(text, coll).some((g) => g.parentKey === t.parent);
    if (!exists) return notFound(ctx);
  }
  if (mode === 'edit') {
    try {
      existing = findItem(coll, text, t.parent, t.index, t.hash).item;
    } catch (err) {
      if (!(err instanceof OpError)) throw err;
      return ctx.page('Changed', views.message({ title: 'This item has changed', body: html`<p>${err.message}</p><p><a href="/c/${coll.id}">Back to ${coll.label}</a></p>` }), 409);
    }
  }

  const render = (item, errors = {}, formError = null, status = 200) => ctx.page(
    `${mode === 'new' ? 'Add' : 'Edit'} ${coll.singular}`,
    views.itemForm({ coll, mode, item, errors, formError, user, ctx: fctx, parentKey: t.parent, query: url.searchParams.toString() }),
    status,
  );

  if (request.method === 'GET') return render(existing ?? { ...(coll.defaults ?? {}) });
  if (request.method !== 'POST') return notFound(ctx);

  const form = await request.formData();
  const { item, errors, uploads } = await parseForm(coll, form, { existing, categories: fctx.categories });
  const shown = existing ? mergeItem(coll, existing, item) : item;
  if (Object.keys(errors).length) {
    const photoNote = uploads.length ? ' Choose the photo again — browsers don’t keep it after an error.' : '';
    return render(shown, errors, `Please fix the highlighted fields.${photoNote}`, 422);
  }

  const op = {
    type: mode === 'new' ? 'insert' : 'update',
    collection: coll.id,
    parent: coll.parent ? t.parent : null,
    index: t.index,
    hash: t.hash,
    item,
    uploads,
  };
  try {
    return await perform(ctx, coll, op);
  } catch (err) {
    if (!(err instanceof OpError)) throw err;
    return render(shown, err.fieldErrors ?? {}, err.message, 409);
  }
}

async function simpleOp(ctx, coll, action) {
  const form = await ctx.request.formData();
  const t = target(ctx, ctx.url.searchParams);
  const op = {
    type: action,
    collection: coll.id,
    parent: coll.parent ? t.parent : null,
    index: t.index,
    hash: t.hash,
    dir: form.get('dir') === 'up' ? 'up' : 'down',
  };
  try {
    return await perform(ctx, coll, op);
  } catch (err) {
    if (!(err instanceof OpError)) throw err;
    const groups = readCollection(await ctx.gh.read(coll.file), coll);
    return ctx.page(coll.label, views.collectionList({ coll, groups, user: ctx.user, siteUrl: ctx.siteUrl }), 409, {
      flash: { kind: 'error', body: err.message },
    });
  }
}

// Publish directly (editors, owners) or queue for review (contributors).
async function perform(ctx, coll, op) {
  const { user, env, gh } = ctx;
  if (db.can.publish(user)) {
    const res = await gh.transact((tx) => applyOp(tx, op), { authorName: user.name || 'an editor' });
    await db.audit(env.DB, { email: user.email, action: 'publish', collection: coll.id, summary: res.summary, commit: res.commit });
    return redirect(`/c/${coll.id}?done=published${res.commit ? `&commit=${res.commit}` : ''}`);
  }
  // Dry run against the current file, so a contributor hears about a
  // duplicate or a stale edit now rather than from a reviewer later.
  const dry = { read: (p) => gh.read(p), list: async () => [], write: () => {} };
  const { summary } = await applyOp(dry, op);
  const id = await db.createSubmission(env.DB, { email: user.email, op, summary });
  await db.audit(env.DB, { email: user.email, action: 'submit', collection: coll.id, summary: `Submitted: ${summary}` });
  return redirect(`/submissions/${id}?done=submitted`);
}

// ---- review queue -----------------------------------------------------------

async function submissionsPage(ctx) {
  const { env, user } = ctx;
  const mine = db.can.review(user) ? null : user.email;
  const pending = await db.listSubmissions(env.DB, { status: 'pending', email: mine });
  const recent = (await db.listSubmissions(env.DB, { email: mine, limit: 50 })).filter((s) => s.status !== 'pending');
  return ctx.page('Submissions', views.submissionList({ pending, recent, user }), 200, { flash: flashFrom(ctx.url, ctx.gh) });
}

async function loadSubmission(ctx, id) {
  const sub = await db.getSubmission(ctx.env.DB, id);
  if (!sub) return null;
  if (!db.can.review(ctx.user) && sub.email !== ctx.user.email) return null;
  return sub;
}

async function submissionPage(ctx, id, error = null, status = 200) {
  const sub = await loadSubmission(ctx, id);
  if (!sub) return notFound(ctx);
  const coll = BY_ID[sub.collection];
  let current = null;
  let currentError = error;
  if (sub.op.type !== 'insert' && sub.status === 'pending') {
    try {
      current = findItem(coll, await ctx.gh.read(coll.file), sub.op.parent, sub.op.index, sub.op.hash).item;
    } catch (err) {
      if (!(err instanceof OpError)) throw err;
      currentError ??= `${err.message} This submission can no longer be applied as-is.`;
    }
  }
  return ctx.page(`Submission ${id}`, views.submissionDetail({ sub, current, currentError, user: ctx.user, commitUrl: ctx.gh.commitUrl }),
    status, { flash: flashFrom(ctx.url, ctx.gh, { ...coll, siteUrl: ctx.siteUrl }) });
}

async function reviewAction(ctx, id, action) {
  const { env, user, gh, request } = ctx;
  const sub = await loadSubmission(ctx, id);
  if (!sub) return notFound(ctx);
  const form = await request.formData();

  if (action === 'withdraw') {
    if (sub.email !== user.email) return forbidden(ctx);
    if (await db.claimSubmission(env.DB, id, 'withdrawn', user.email)) {
      await db.dropSubmissionFiles(env.DB, id);
      await db.audit(env.DB, { email: user.email, action: 'withdraw', collection: sub.collection, summary: `Withdrew: ${sub.summary}` });
    }
    return redirect('/submissions?done=withdrawn');
  }
  if (!db.can.review(user)) return forbidden(ctx);

  if (action === 'reject') {
    const note = String(form.get('note') ?? '').trim().slice(0, 1000) || null;
    if (await db.claimSubmission(env.DB, id, 'rejected', user.email, note)) {
      await db.dropSubmissionFiles(env.DB, id);
      await db.audit(env.DB, { email: user.email, action: 'reject', collection: sub.collection, summary: `Rejected: ${sub.summary}` });
    }
    return redirect('/submissions?done=rejected');
  }

  // approve
  if (!(await db.claimSubmission(env.DB, id, 'approved', user.email))) {
    return submissionPage(ctx, id, 'Someone else already handled this submission.', 409);
  }
  try {
    const authorName = `${sub.name || 'a contributor'}, approved by ${user.name || 'an editor'}`;
    const res = await gh.transact((tx) => applyOp(tx, sub.op), { authorName });
    await db.setSubmissionCommit(env.DB, id, res.commit);
    await db.audit(env.DB, { email: user.email, action: 'approve', collection: sub.collection, summary: `Approved: ${res.summary}`, commit: res.commit });
    return redirect(`/submissions/${id}?done=approved${res.commit ? `&commit=${res.commit}` : ''}`);
  } catch (err) {
    await db.releaseSubmission(env.DB, id);
    if (!(err instanceof OpError)) throw err;
    const fields = err.fieldErrors ? ` (${Object.values(err.fieldErrors).join(' ')})` : '';
    return submissionPage(ctx, id, `Couldn’t apply this: ${err.message}${fields}`, 409);
  }
}

// ---- people -----------------------------------------------------------------

async function usersPage(ctx, isDelete) {
  const { env, user, request } = ctx;
  const show = async (error = null, status = 200) => ctx.page('People',
    views.people({ users: await db.listUsers(env.DB), me: user, error }), status, { flash: flashFrom(ctx.url, ctx.gh) });

  if (request.method === 'GET' && !isDelete) return show();
  if (request.method !== 'POST') return notFound(ctx);

  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return show('Enter a valid email address.', 422);
  const existing = await db.getUser(env.DB, email);
  const owners = await db.countOwners(env.DB);

  if (isDelete) {
    if (email === user.email) return show('You can’t remove yourself.', 422);
    if (existing?.role === 'owner' && owners <= 1) return show('There must always be at least one owner.', 422);
    await db.deleteUser(env.DB, email);
    await db.audit(env.DB, { email: user.email, action: 'user', summary: `Removed ${email}` });
    return redirect('/users?done=user-removed');
  }

  const name = String(form.get('name') ?? '').trim().slice(0, 100);
  const role = String(form.get('role') ?? '');
  if (!db.ROLES.includes(role)) return show('Choose a role.', 422);
  if (!name) return show('Enter a name — it is shown in the change history.', 422);
  if (existing?.role === 'owner' && role !== 'owner' && owners <= 1) return show('There must always be at least one owner.', 422);
  await db.upsertUser(env.DB, { email, name, role }, user.email);
  await db.audit(env.DB, { email: user.email, action: 'user', summary: `${existing ? 'Updated' : 'Added'} ${email} as ${role}` });
  return redirect('/users?done=user');
}
