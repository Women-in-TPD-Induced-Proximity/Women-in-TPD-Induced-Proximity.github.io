// Page bodies. Handlers in index.js gather the data; these only render it.

import { COLLECTIONS, BY_ID } from './collections.js';
import { html } from './html.js';
import { renderFields, getPath } from './forms.js';
import { itemHash } from './engine.js';
import { bytesToBase64 } from './github.js';
import { can } from './db.js';

const SECTIONS = [
  ['Research', ['publications', 'glossary']],
  ['People & photos', ['team', 'gallery', 'scholarship', 'scholarship-winners', 'scholarship-photos']],
  ['Calendar', ['conferences', 'events']],
];

const RELATED = {
  scholarship: ['scholarship-winners', 'scholarship-photos'],
  'scholarship-winners': ['scholarship', 'scholarship-photos'],
  'scholarship-photos': ['scholarship', 'scholarship-winners'],
};

function when(iso) {
  return iso ? iso.replace('T', ' ').replace(/:\d\dZ$/, ' UTC') : '';
}

function who(row) {
  return row.name || row.email;
}

function editQuery(coll, parentKey, index, item) {
  const q = new URLSearchParams({ i: String(index), h: itemHash(item) });
  if (coll.parent) q.set('p', parentKey);
  return q.toString();
}

export function dashboard({ user, pending, recent }) {
  return html`
    <h1>Site content</h1>
    ${user.role === 'contributor'
      ? html`<p class="lede">Anything you add or change goes to an editor for review before it appears on the site.</p>`
      : html`<p class="lede">Changes you save are published straight to the live site, which rebuilds in about a minute.</p>`}
    ${pending ? html`<p class="notice"><a href="/submissions">${pending} submission${pending === 1 ? '' : 's'} waiting for review →</a></p>` : ''}
    ${SECTIONS.map(([title, ids]) => html`
      <section class="dash-section">
        <h2>${title}</h2>
        <ul class="tiles">
          ${ids.map((id) => {
            const c = BY_ID[id];
            return html`<li><a class="tile" href="/c/${c.id}"><strong>${c.label}</strong><span>${c.file.replace('_data/', '')}</span></a></li>`;
          })}
        </ul>
      </section>`)}
    ${recent?.length ? html`
      <section class="dash-section">
        <h2>Recent changes</h2>
        ${auditTable(recent, null)}
        <p><a href="/activity">All activity →</a></p>
      </section>` : ''}`;
}

export function collectionList({ coll, groups, user, siteUrl }) {
  const manual = !coll.order;
  const addLabel = can.publish(user) ? `Add ${coll.singular}` : `Suggest a new ${coll.singular}`;
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  return html`
    <div class="page-head">
      <div>
        <p class="crumbs"><a href="/">Content</a> /</p>
        <h1>${coll.label}</h1>
        <p class="muted">${total} item${total === 1 ? '' : 's'} · <a href="${siteUrl}${coll.page}" target="_blank" rel="noopener">View on site ↗</a>
        ${RELATED[coll.id] ? html` · Related: ${RELATED[coll.id].map((id, i) => html`${i ? ', ' : ''}<a href="/c/${id}">${BY_ID[id].label}</a>`)}` : ''}</p>
      </div>
      ${coll.parent ? '' : html`<a class="btn primary" href="/c/${coll.id}/new">${addLabel}</a>`}
    </div>
    ${coll.order ? html`<p class="hint">New items are placed automatically by ${coll.id === 'gallery' ? 'year' : 'date'}, matching the page's default order.</p>` : ''}
    ${total > 12 ? html`<input class="filter" type="search" placeholder="Filter…" aria-label="Filter this list" data-filter>` : ''}
    ${groups.map((g) => html`
      <section class="group">
        ${coll.parent ? html`
          <div class="group-head">
            <h2>${coll.parent.label}: ${g.parentKey}</h2>
            <a class="btn" href="/c/${coll.id}/new?p=${encodeURIComponent(g.parentKey)}">${addLabel}</a>
          </div>` : ''}
        ${g.items.length ? html`<ol class="items">
          ${g.items.map((item, i) => {
            const s = coll.summary(item);
            const q = editQuery(coll, g.parentKey, i, item);
            return html`<li class="item" data-text="${`${s.title} ${s.meta ?? ''}`.toLowerCase()}">
              ${s.image ? html`<img class="thumb" src="${siteUrl}${s.image}" alt="" loading="lazy">` : ''}
              <div class="item-main"><strong>${s.title}</strong>${s.meta ? html`<span class="muted">${s.meta}</span>` : ''}</div>
              <div class="item-actions">
                <a class="btn small" href="/c/${coll.id}/edit?${q}">Edit</a>
                ${manual ? html`
                  <form method="post" action="/c/${coll.id}/move?${q}"><input type="hidden" name="dir" value="up"><button class="btn small icon" ${i === 0 ? html`disabled` : ''} title="Move up" aria-label="Move up">↑</button></form>
                  <form method="post" action="/c/${coll.id}/move?${q}"><input type="hidden" name="dir" value="down"><button class="btn small icon" ${i === g.items.length - 1 ? html`disabled` : ''} title="Move down" aria-label="Move down">↓</button></form>` : ''}
                <form method="post" action="/c/${coll.id}/delete?${q}" data-confirm="Remove “${s.title}”?"><button class="btn small danger">${can.publish(user) ? 'Remove' : 'Suggest removal'}</button></form>
              </div>
            </li>`;
          })}
        </ol>` : html`<p class="muted empty">Nothing here yet.</p>`}
      </section>`)}`;
}

export function itemForm({ coll, mode, item, errors, formError, user, ctx, parentKey, query }) {
  const verb = mode === 'new' ? 'Add' : 'Edit';
  const action = `/c/${coll.id}/${mode}${query ? `?${query}` : ''}`;
  return html`
    <p class="crumbs"><a href="/">Content</a> / <a href="/c/${coll.id}">${coll.label}</a> /</p>
    <h1>${verb} ${coll.singular}${coll.parent ? html` <span class="muted">· ${coll.parent.label} ${parentKey}</span>` : ''}</h1>
    ${can.publish(user) ? '' : html`<p class="notice">An editor will review this before it goes live.</p>`}
    ${formError ? html`<p class="flash flash-error" role="alert">${formError}</p>` : ''}
    <form class="item-form" method="post" action="${action}" enctype="multipart/form-data">
      ${renderFields(coll, item, errors, ctx)}
      <div class="form-actions">
        <button class="btn primary" type="submit">${can.publish(user) ? (mode === 'new' ? 'Publish' : 'Save & publish') : 'Submit for review'}</button>
        <a class="btn" href="/c/${coll.id}">Cancel</a>
      </div>
    </form>`;
}

function displayValue(field, value, uploads) {
  if (field.type === 'image') {
    const up = uploads?.find((u) => u.field === field.name);
    if (up) {
      const mime = up.ext === 'jpg' ? 'image/jpeg' : `image/${up.ext}`;
      return html`<img class="preview" src="data:${mime};base64,${bytesToBase64(up.bytes)}" alt="Uploaded photo"><br><span class="muted">new upload</span>`;
    }
  }
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return html`<span class="muted">—</span>`;
  if (field.type === 'checkbox') return value ? 'Yes' : '';
  if (field.type === 'links') return value.map((l) => html`<div>${l.label} — <a href="${l.href}" target="_blank" rel="noopener">${l.href}</a></div>`);
  if (Array.isArray(value)) return value.map((v) => html`<div>${v}</div>`);
  return String(value);
}

export function submissionDetail({ sub, current, currentError, user, commitUrl }) {
  const coll = BY_ID[sub.collection];
  const op = sub.op;
  const proposed = op.type === 'insert' || op.type === 'update' ? op.item : null;
  const typeLabel = { insert: 'New', update: 'Edit', delete: 'Removal', move: 'Reorder' }[op.type];
  return html`
    <p class="crumbs"><a href="/submissions">Submissions</a> /</p>
    <h1>${sub.summary}</h1>
    <p class="muted">${typeLabel} · ${coll.label}${coll.parent ? ` · ${coll.parent.label} ${op.parent}` : ''} · submitted by ${who(sub)} on ${when(sub.created_at)}</p>
    <p><span class="status status-${sub.status}">${sub.status}</span>
      ${sub.reviewed_by ? html` by ${sub.reviewed_by} on ${when(sub.reviewed_at)}` : ''}
      ${sub.commit_sha ? html` · <a href="${commitUrl(sub.commit_sha)}" target="_blank" rel="noopener">view change</a>` : ''}</p>
    ${sub.note ? html`<p class="notice">Reviewer note: ${sub.note}</p>` : ''}
    ${currentError ? html`<p class="flash flash-error">${currentError}</p>` : ''}
    ${op.type === 'move' ? html`<p>Move <strong>${current ? coll.summary(current).title : 'item'}</strong> ${op.dir}.</p>` : html`
      <table class="diff">
        <thead><tr><th>Field</th>${current ? html`<th>Now on the site</th>` : ''}${proposed ? html`<th>Proposed</th>` : ''}</tr></thead>
        <tbody>
          ${coll.fields.map((f) => {
            const before = current ? getPath(current, f.name) : undefined;
            const after = proposed ? getPath(proposed, f.name) : undefined;
            const changed = current && proposed && JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
            const uploadChanged = proposed && op.uploads?.some((u) => u.field === f.name);
            return html`<tr class="${changed || uploadChanged ? 'changed' : ''}">
              <th scope="row">${f.label}</th>
              ${current ? html`<td>${displayValue(f, before)}</td>` : ''}
              ${proposed ? html`<td>${displayValue(f, after, op.uploads)}</td>` : ''}
            </tr>`;
          })}
        </tbody>
      </table>`}
    ${sub.status === 'pending' && can.review(user) ? html`
      <div class="review">
        <form method="post" action="/submissions/${sub.id}/approve">
          <button class="btn primary">Approve & publish</button>
        </form>
        <form method="post" action="/submissions/${sub.id}/reject" class="reject">
          <label for="note">Reject with a note (optional)</label>
          <textarea id="note" name="note" rows="2"></textarea>
          <button class="btn danger">Reject</button>
        </form>
      </div>` : ''}
    ${sub.status === 'pending' && sub.email === user.email && !can.review(user) ? html`
      <form method="post" action="/submissions/${sub.id}/withdraw" data-confirm="Withdraw this submission?">
        <button class="btn">Withdraw</button>
      </form>` : ''}`;
}

export function submissionList({ pending, recent, user }) {
  const table = (rows) => html`<table class="list">
    <thead><tr><th>#</th><th>Change</th><th>By</th><th>Submitted</th><th>Status</th></tr></thead>
    <tbody>${rows.map((s) => html`<tr>
      <td>${s.id}</td>
      <td><a href="/submissions/${s.id}">${s.summary}</a></td>
      <td>${who(s)}</td>
      <td>${when(s.created_at)}</td>
      <td><span class="status status-${s.status}">${s.status}</span></td>
    </tr>`)}</tbody></table>`;
  return html`
    <h1>${can.review(user) ? 'Review queue' : 'My submissions'}</h1>
    <h2>Waiting for review</h2>
    ${pending.length ? table(pending) : html`<p class="muted">Nothing waiting.</p>`}
    ${recent.length ? html`<h2>Recently decided</h2>${table(recent)}` : ''}`;
}

export function auditTable(rows, commitUrl) {
  return html`<table class="list">
    <thead><tr><th>When</th><th>Who</th><th>What</th>${commitUrl ? html`<th></th>` : ''}</tr></thead>
    <tbody>${rows.map((r) => html`<tr>
      <td class="nowrap">${when(r.at)}</td>
      <td>${who(r)}</td>
      <td>${r.summary}</td>
      ${commitUrl ? html`<td>${r.commit_sha ? html`<a href="${commitUrl(r.commit_sha)}" target="_blank" rel="noopener">change ↗</a>` : ''}</td>` : ''}
    </tr>`)}</tbody></table>`;
}

export function activity({ rows, commitUrl }) {
  return html`<h1>Activity</h1>${rows.length ? auditTable(rows, commitUrl) : html`<p class="muted">No activity yet.</p>`}`;
}

export function people({ users, me, error }) {
  const roleSelect = (name, value) => html`<select name="${name}" aria-label="Role">
    ${['owner', 'editor', 'contributor'].map((r) => html`<option value="${r}" ${r === value ? html`selected` : ''}>${r}</option>`)}
  </select>`;
  return html`
    <h1>People</h1>
    <p class="lede">Who can sign in, and what they can do. Each person signs in with this email address
    (Google, or a one-time code sent to it).</p>
    <dl class="roles">
      <dt>Owner</dt><dd>Everything, plus managing this list.</dd>
      <dt>Editor</dt><dd>Publishes changes directly and reviews contributors' submissions.</dd>
      <dt>Contributor</dt><dd>Suggests changes; an editor approves them before they go live.</dd>
    </dl>
    ${error ? html`<p class="flash flash-error" role="alert">${error}</p>` : ''}
    <table class="list people">
      <thead><tr><th>Email</th><th>Name</th><th>Role</th><th></th></tr></thead>
      <tbody>${users.map((u) => html`<tr>
        <td>${u.email}${u.email === me.email ? html` <span class="muted">(you)</span>` : ''}</td>
        <td colspan="2">
          <form method="post" action="/users" class="inline">
            <input type="hidden" name="email" value="${u.email}">
            <input name="name" type="text" value="${u.name}" aria-label="Name">
            ${roleSelect('role', u.role)}
            <button class="btn small">Save</button>
          </form>
        </td>
        <td>${u.email === me.email ? '' : html`
          <form method="post" action="/users/delete" data-confirm="Remove ${u.email}?">
            <input type="hidden" name="email" value="${u.email}">
            <button class="btn small danger">Remove</button>
          </form>`}</td>
      </tr>`)}</tbody>
    </table>
    <h2>Add someone</h2>
    <form method="post" action="/users" class="inline add-user">
      <input name="email" type="email" placeholder="email@example.org" aria-label="Email" required>
      <input name="name" type="text" placeholder="Name" aria-label="Name" required>
      ${roleSelect('role', 'contributor')}
      <button class="btn primary">Add</button>
    </form>
    <p class="hint">Names appear in the site's public change history ("Via the admin portal, by …"); emails do not.</p>`;
}

export function message({ title, body }) {
  return html`<h1>${title}</h1>${body}`;
}

export { COLLECTIONS };
