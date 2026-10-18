// A tiny HTML templating helper. Everything interpolated into html`...` is
// escaped unless it is itself the result of html`...` (or raw()), so the
// default is safe and opting out is visible at the call site.

class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export const raw = (s) => new Safe(String(s));

export function esc(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new Safe(out);
}

const SECURITY_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy':
    "default-src 'self'; img-src 'self' https: data: blob:; style-src 'self'; script-src 'self'; " +
    "form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'referrer-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
};

export function respond(body, status = 200, headers = {}) {
  return new Response(String(body), { status, headers: { ...SECURITY_HEADERS, ...headers } });
}

export function redirect(location) {
  return new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } });
}

const ROLE_LABEL = { owner: 'Owner', editor: 'Editor', contributor: 'Contributor' };

export function layout({ title, user, body, flash, pending = 0, wide = false }) {
  const nav = user ? html`
    <nav class="topnav" aria-label="Admin">
      <a href="/">Content</a>
      ${user.role === 'contributor'
        ? html`<a href="/submissions">My submissions</a>`
        : html`<a href="/submissions">Review queue${pending ? html` <span class="count">${pending}</span>` : ''}</a>`}
      ${user.role !== 'contributor' ? html`<a href="/activity">Activity</a>` : ''}
      ${user.role === 'owner' ? html`<a href="/users">People</a>` : ''}
    </nav>
    <div class="who"><span>${user.name || user.email}</span> <span class="role role-${user.role}">${ROLE_LABEL[user.role]}</span></div>` : '';
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title} · WiTPD admin</title>
<link rel="stylesheet" href="/static/admin.css">
<script src="/static/admin.js" defer></script>
</head>
<body>
<header class="bar">
  <a class="brand" href="/">WiTPD <span>admin</span></a>
  ${nav}
</header>
<main class="${wide ? 'wrap wide' : 'wrap'}">
  ${flash ? html`<div class="flash flash-${flash.kind}" role="status">${flash.body}</div>` : ''}
  ${body}
</main>
</body>
</html>`;
}
