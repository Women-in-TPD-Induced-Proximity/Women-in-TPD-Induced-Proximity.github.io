// Who is this request from?
//
// Cloudflare Access sits in front of the Worker and handles the actual login
// (Google, or a one-time code sent by email). On every request it passes a
// signed JWT in the Cf-Access-Jwt-Assertion header. We verify that JWT
// ourselves rather than trusting that Access is in front: if the Worker is
// ever reachable without Access (a misconfigured route, workers.dev), every
// request fails closed.
//
// Access only answers "who is this"; whether they may do anything is decided
// by the users table in D1 (see db.js).

const certCache = new Map(); // team domain -> { keys, fetched }

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function teamDomain(env) {
  return String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

async function getKeys(team, fetchImpl, force = false) {
  const hit = certCache.get(team);
  if (hit && !force && Date.now() - hit.fetched < 60 * 60 * 1000) return hit.keys;
  const res = await fetchImpl(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Could not fetch Access signing keys (${res.status}).`);
  const { keys } = await res.json();
  certCache.set(team, { keys, fetched: Date.now() });
  return keys;
}

export async function verifyAccessJwt(token, env, { fetchImpl = fetch, now = Date.now() / 1000 } = {}) {
  const team = teamDomain(env);
  if (!team || !env.ACCESS_AUD) throw new Error('ACCESS_TEAM_DOMAIN and ACCESS_AUD must be configured.');
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header;
  let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;

  let jwk = (await getKeys(team, fetchImpl)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await getKeys(team, fetchImpl, true)).find((k) => k.kid === header.kid); // keys rotated
  if (!jwk) return null;

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;

  const skew = 60;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== `https://${team}`) return null;
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (typeof payload.exp !== 'number' || payload.exp + skew < now) return null;
  if (typeof payload.nbf === 'number' && payload.nbf - skew > now) return null;
  if (typeof payload.email !== 'string' || !payload.email) return null;
  return { email: payload.email.trim().toLowerCase() };
}

function cookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

export async function authenticate(request, env, opts) {
  // Local development only: `wrangler dev` on localhost with DEV_AUTH_EMAIL
  // set in .dev.vars. Both conditions are required, and a deployed Worker is
  // never served from localhost, so this can't be switched on in production
  // by a stray variable alone.
  const host = new URL(request.url).hostname;
  if (env.DEV_AUTH_EMAIL && (host === 'localhost' || host === '127.0.0.1')) {
    return { email: String(env.DEV_AUTH_EMAIL).trim().toLowerCase() };
  }
  const token = request.headers.get('cf-access-jwt-assertion') || cookie(request, 'CF_Authorization');
  if (!token) return null;
  return verifyAccessJwt(token, env, opts);
}
