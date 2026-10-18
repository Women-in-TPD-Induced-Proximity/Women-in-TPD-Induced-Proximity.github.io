import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify as nodeVerify } from 'node:crypto';
import { verifyAccessJwt, authenticate } from '../src/auth.js';
import { appJwt, createGitHub, pkcs1ToPkcs8 } from '../src/github.js';
import { checkUrl, checkInlineHtml, parseForm, sniffImage } from '../src/forms.js';
import { html, raw } from '../src/html.js';
import { BY_ID } from '../src/collections.js';
import { loadDoc } from '../src/engine.js';
import { repoFile } from './helpers.js';

// ---- Cloudflare Access JWT --------------------------------------------------

const TEAM = 'witpd.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };
const certsFetch = async (url) => {
  assert.equal(url, `https://${TEAM}/cdn-cgi/access/certs`);
  return new Response(JSON.stringify({ keys: [jwk] }));
};

const b64url = (b) => Buffer.from(b).toString('base64url');
async function sign(payload, { kid = 'k1', key = privateKey, alg = 'RS256' } = {}) {
  const h = b64url(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const p = b64url(JSON.stringify(payload));
  const k = await crypto.subtle.importKey('pkcs8', key.export({ type: 'pkcs8', format: 'der' }), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}
const now = Math.floor(Date.now() / 1000);
const good = { iss: `https://${TEAM}`, aud: [AUD], email: 'Jane@Example.org', exp: now + 600, iat: now };

test('Access JWT: valid token yields the lowercased email', async () => {
  assert.deepEqual(await verifyAccessJwt(await sign(good), env, { fetchImpl: certsFetch }), { email: 'jane@example.org' });
});

test('Access JWT: wrong audience, issuer, expiry, key or alg are all refused', async () => {
  const opts = { fetchImpl: certsFetch };
  assert.equal(await verifyAccessJwt(await sign({ ...good, aud: ['other'] }), env, opts), null);
  assert.equal(await verifyAccessJwt(await sign({ ...good, iss: 'https://evil.cloudflareaccess.com' }), env, opts), null);
  assert.equal(await verifyAccessJwt(await sign({ ...good, exp: now - 3600 }), env, opts), null);
  assert.equal(await verifyAccessJwt(await sign({ ...good, email: '' }), env, opts), null);
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  assert.equal(await verifyAccessJwt(await sign(good, { key: other }), env, opts), null);
  assert.equal(await verifyAccessJwt(await sign(good, { kid: 'unknown' }), env, opts), null);
  const [h, p] = (await sign(good)).split('.');
  const none = `${b64url(JSON.stringify({ alg: 'none', kid: 'k1' }))}.${p}.`;
  assert.equal(await verifyAccessJwt(none, env, opts), null);
  // Tampered payload with the original signature.
  const forged = `${h}.${b64url(JSON.stringify({ ...good, email: 'owner@example.org' }))}.${(await sign(good)).split('.')[2]}`;
  assert.equal(await verifyAccessJwt(forged, env, opts), null);
  assert.equal(await verifyAccessJwt('garbage', env, opts), null);
});

test('Access JWT: missing configuration fails closed', async () => {
  await assert.rejects(verifyAccessJwt(await sign(good), { ACCESS_TEAM_DOMAIN: TEAM }, { fetchImpl: certsFetch }));
});

test('dev login bypass only works on localhost', async () => {
  const devEnv = { ...env, DEV_AUTH_EMAIL: 'dev@example.org' };
  assert.deepEqual(await authenticate(new Request('http://localhost:8787/'), devEnv), { email: 'dev@example.org' });
  assert.equal(await authenticate(new Request('https://admin.womenintpdandip.org/'), devEnv), null);
});

// ---- GitHub -----------------------------------------------------------------

test('GitHub App JWT is signed correctly from a PKCS#1 key', async () => {
  const pkcs1 = privateKey.export({ type: 'pkcs1', format: 'pem' });
  assert.match(pkcs1, /BEGIN RSA PRIVATE KEY/);
  const der = privateKey.export({ type: 'pkcs1', format: 'der' });
  assert.deepEqual(Buffer.from(pkcs1ToPkcs8(new Uint8Array(der))), privateKey.export({ type: 'pkcs8', format: 'der' }));
  const jwt = await appJwt('12345', pkcs1, 1_700_000_000);
  const [h, p, s] = jwt.split('.');
  assert.ok(nodeVerify('sha256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url')));
  assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url')), { iat: 1_700_000_000 - 60, exp: 1_700_000_000 + 540, iss: '12345' });
});

test('transact: commits text + binary in one commit, retries when the branch moved', async () => {
  const calls = [];
  let head = 'c1';
  let refUpdates = 0;
  const fakeFetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push(`${init.method ?? 'GET'} ${u.pathname}`);
    assert.equal(init.headers.authorization, 'Bearer tok');
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
    if (u.pathname.endsWith('/git/ref/heads/main')) return json({ object: { sha: head } });
    if (u.pathname.includes('/git/commits/')) return json({ tree: { sha: `tree-of-${u.pathname.split('/').pop()}` } });
    if (u.pathname.includes('/contents/_data/x.yml')) return new Response(`- a: ${u.searchParams.get('ref')}\n`);
    if (u.pathname.includes('/contents/assets')) return json([{ name: 'p.jpg' }]);
    if (u.pathname.endsWith('/git/blobs')) {
      assert.equal(body.encoding, 'base64');
      assert.equal(body.content, Buffer.from([1, 2, 3]).toString('base64'));
      return json({ sha: 'blob1' });
    }
    if (u.pathname.endsWith('/git/trees')) {
      assert.equal(body.base_tree, `tree-of-${head}`);
      assert.deepEqual(body.tree.map((t) => t.path).sort(), ['_data/x.yml', 'assets/p-2.jpg']);
      return json({ sha: 'tree2' });
    }
    if (u.pathname.endsWith('/git/commits')) {
      assert.deepEqual(body.parents, [head]);
      assert.match(body.message, /^Add thing\n\nVia the admin portal, by Jane\.$/);
      return json({ sha: `new-on-${head}` });
    }
    if (u.pathname.endsWith('/git/refs/heads/main')) {
      assert.equal(body.force, false);
      refUpdates++;
      if (refUpdates === 1) { head = 'c2'; return json({ message: 'Update is not a fast forward' }, 422); }
      return json({ object: { sha: body.sha } });
    }
    throw new Error(`unexpected ${url}`);
  };
  const gh = createGitHub({ GITHUB_OWNER: 'o', GITHUB_REPO: 'r', GITHUB_TOKEN: 'tok' }, fakeFetch);
  const seen = [];
  const res = await gh.transact(async (tx) => {
    const text = await tx.read('_data/x.yml');
    seen.push(text);
    const names = await tx.list('assets');
    tx.write('_data/x.yml', `${text}- b: 1\n`);
    tx.write(`assets/${names.includes('p.jpg') ? 'p-2.jpg' : 'p.jpg'}`, new Uint8Array([1, 2, 3]));
    return { message: 'Add thing', summary: 's' };
  }, { authorName: 'Jane' });
  assert.equal(res.commit, 'new-on-c2');
  // The second attempt re-read the file at the new head.
  assert.deepEqual(seen, ['- a: c1\n', '- a: c2\n']);
});

// ---- input validation -------------------------------------------------------

test('URLs: only plain http(s) unless widened', () => {
  assert.equal(checkUrl('https://doi.org/10.1/x'), null);
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'https://x.org/"onmouseover="x', 'https://x.org/<a>', 'x.org', '/relative']) {
    assert.ok(checkUrl(bad), bad);
  }
  assert.equal(checkUrl('mailto:a@b.org', { allowMailto: true }), null);
  assert.equal(checkUrl('get-involved.html', { allowRelative: true }), null);
  assert.equal(checkUrl('/get-involved.html#join', { allowRelative: true }), null);
  assert.ok(checkUrl('//evil.example', { allowRelative: true }));
  assert.ok(checkUrl('javascript:x', { allowRelative: true, allowMailto: true }));
});

test('glossary HTML: a few bare inline tags only', () => {
  assert.equal(checkInlineHtml('k<sub>off</sub> and <em>removes</em>'), null);
  for (const bad of ['<script>x</script>', '<em onclick="x">a</em>', '<img src=x onerror=alert(1)>', '<img src=x onerror=alert(1)', '<a href="x">y</a>', 'a < b']) {
    assert.ok(checkInlineHtml(bad), bad);
  }
});

test('every existing glossary HTML field passes the allow-list', () => {
  const sections = loadDoc(repoFile('_data/glossary.yml')).toJS();
  for (const t of sections.flatMap((s) => s.terms)) {
    for (const k of ['name_html', 'expansion', 'definition']) if (t[k]) assert.equal(checkInlineHtml(t[k]), null, t[k]);
  }
});

test('image uploads are sniffed, not trusted by name', async () => {
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
  assert.equal(sniffImage(new TextEncoder().encode('<svg onload=alert(1)>')), null);
  const fd = new FormData();
  for (const [k, v] of Object.entries({ event: 'E', location: 'L', year: '2026' })) fd.append(k, v);
  fd.append('photo', new File(['<svg/>'], 'x.jpg', { type: 'image/jpeg' }));
  const { errors } = await parseForm(BY_ID.gallery, fd);
  assert.match(errors.photo, /JPEG, PNG or WebP/);
  const big = new FormData();
  for (const [k, v] of Object.entries({ event: 'E', location: 'L', year: '2026' })) big.append(k, v);
  big.append('photo', new File([new Uint8Array(2_000_000)], 'x.jpg'));
  assert.match((await parseForm(BY_ID.gallery, big)).errors.photo, /limit/);
});

test('form parsing: required fields, multi-line text flattened, tags split', async () => {
  const fd = new FormData();
  fd.append('title', '  Hello\r\n  world ');
  fd.append('tags', 'A, B ,, C');
  fd.append('date', '2026-02-30');
  const { item, errors } = await parseForm(BY_ID.publications, fd, { categories: [{ slug: 'degraders' }] });
  assert.equal(item.title, 'Hello world');
  assert.deepEqual(item.tags, ['A', 'B', 'C']);
  assert.equal(errors.date, 'Not a real date.');
  assert.equal(errors.journal, 'Required.');
  assert.equal(errors.links, 'Required.');
});

test('html`` escapes interpolations unless raw', () => {
  const evil = '<img src=x onerror=alert(1)>"\'&';
  assert.equal(String(html`<p title="${evil}">${evil}</p>`),
    '<p title="&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;">&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;</p>');
  assert.equal(String(html`${raw('<b>')}${[1, '<', null, false]}`), '<b>1&lt;');
});
