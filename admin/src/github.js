// Reads and writes this repository through the GitHub REST API.
//
// Credentials, in order of preference:
//   - a GitHub App installed on the repo (GITHUB_APP_ID +
//     GITHUB_APP_INSTALLATION_ID + secret GITHUB_APP_PRIVATE_KEY). Tokens are
//     minted per hour and never expire as a whole.
//   - a fine-grained personal access token (secret GITHUB_TOKEN) with
//     Contents: read & write on this one repo. Simpler to set up, but it
//     expires (a year at most) and is tied to one person's account.
//
// Writes go through the Git Data API so that a photo and the YAML line that
// references it land in ONE commit. The branch ref is moved without force; if
// someone else committed in the meantime GitHub rejects the update, and the
// whole change is recomputed on top of the new head (see transact()).

const API_VERSION = '2022-11-28';

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function b64urlFromBytes(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function pemToDer(pem) {
  const b64 = pem.replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function derLength(n) {
  if (n < 0x80) return [n];
  const out = [];
  while (n > 0) { out.unshift(n & 0xff); n >>= 8; }
  return [0x80 | out.length, ...out];
}

// GitHub hands out PKCS#1 keys ("BEGIN RSA PRIVATE KEY"); Web Crypto only
// imports PKCS#8. Wrap one in the other so nobody has to run openssl.
export function pkcs1ToPkcs8(pkcs1) {
  const algId = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLength(pkcs1.length)];
  const body = [0x02, 0x01, 0x00, ...algId, ...octet];
  const total = body.length + pkcs1.length;
  const out = new Uint8Array([0x30, ...derLength(total), ...body, ...pkcs1]);
  return out;
}

async function importAppKey(pem) {
  const der = pemToDer(pem);
  const pkcs8 = /BEGIN RSA PRIVATE KEY/.test(pem) ? pkcs1ToPkcs8(der) : der;
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

export async function appJwt(appId, pem, now = Math.floor(Date.now() / 1000)) {
  const enc = new TextEncoder();
  const header = b64urlFromBytes(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = b64urlFromBytes(enc.encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(appId) })));
  const key = await importAppKey(pem);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64urlFromBytes(new Uint8Array(sig))}`;
}

// Installation tokens last an hour; keep one per isolate until shortly before
// it expires.
let cachedToken = null;

export function createGitHub(env, fetchImpl = fetch) {
  const api = (env.GITHUB_API || 'https://api.github.com').replace(/\/$/, '');
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';
  if (!owner || !repo) throw new Error('GITHUB_OWNER and GITHUB_REPO must be set.');
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

  async function token() {
    if (env.GITHUB_APP_ID && env.GITHUB_APP_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY) {
      if (cachedToken && cachedToken.expires - Date.now() > 5 * 60 * 1000) return cachedToken.value;
      const jwt = await appJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
      const res = await fetchImpl(`${api}/app/installations/${encodeURIComponent(env.GITHUB_APP_INSTALLATION_ID)}/access_tokens`, {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, accept: 'application/vnd.github+json', 'user-agent': 'witpd-admin', 'x-github-api-version': API_VERSION },
      });
      if (!res.ok) throw new GitHubError(res.status, `GitHub App token request failed (${res.status}). Check the App ID, installation ID and private key.`);
      const body = await res.json();
      cachedToken = { value: body.token, expires: Date.parse(body.expires_at) };
      return body.token;
    }
    if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
    throw new Error('No GitHub credentials configured (GitHub App or GITHUB_TOKEN).');
  }

  async function call(method, path, { body, accept = 'application/vnd.github+json', allow = [] } = {}) {
    const res = await fetchImpl(`${api}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await token()}`,
        accept,
        'user-agent': 'witpd-admin',
        'x-github-api-version': API_VERSION,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && !allow.includes(res.status)) {
      let detail = '';
      try { detail = (await res.json()).message ?? ''; } catch { /* not JSON */ }
      throw new GitHubError(res.status, `GitHub ${method} ${path.split('?')[0]} failed (${res.status}) ${detail}`.trim());
    }
    return res;
  }

  async function readAt(path, ref) {
    const res = await call('GET', `${repoPath}/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`, {
      accept: 'application/vnd.github.raw+json',
    });
    return res.text();
  }

  async function listAt(dir, ref) {
    const res = await call('GET', `${repoPath}/contents/${encPath(dir)}?ref=${encodeURIComponent(ref)}`, { allow: [404] });
    if (res.status === 404) return [];
    const body = await res.json();
    return Array.isArray(body) ? body.map((e) => e.name) : [];
  }

  return {
    branch,
    commitUrl: (sha) => `https://github.com/${owner}/${repo}/commit/${sha}`,

    // Read the latest version of a file on the branch (for display).
    read: (path) => readAt(path, branch),

    // Run `fn(tx)` against a consistent snapshot of the branch and commit
    // whatever it wrote. `fn` must be safe to run more than once: on a race
    // it is re-run from scratch against the new head.
    async transact(fn, { authorName } = {}) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const ref = await (await call('GET', `${repoPath}/git/ref/heads/${encPath(branch)}`)).json();
        const head = ref.object.sha;
        const commit = await (await call('GET', `${repoPath}/git/commits/${head}`)).json();
        const writes = new Map();
        const reads = new Map();
        const tx = {
          read: (p) => (reads.has(p) ? reads.get(p) : reads.set(p, readAt(p, head)).get(p)),
          list: (d) => listAt(d, head),
          write: (p, content) => writes.set(p, content),
        };
        const result = await fn(tx);
        if (!writes.size) return { ...result, commit: null };

        const tree = [];
        for (const [path, content] of writes) {
          if (typeof content === 'string') {
            tree.push({ path, mode: '100644', type: 'blob', content });
          } else {
            const blob = await (await call('POST', `${repoPath}/git/blobs`, {
              body: { content: bytesToBase64(content), encoding: 'base64' },
            })).json();
            tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
          }
        }
        const newTree = await (await call('POST', `${repoPath}/git/trees`, { body: { base_tree: commit.tree.sha, tree } })).json();
        const message = authorName ? `${result.message}\n\nVia the admin portal, by ${authorName}.` : result.message;
        const newCommit = await (await call('POST', `${repoPath}/git/commits`, {
          body: { message, tree: newTree.sha, parents: [head] },
        })).json();
        const moved = await call('PATCH', `${repoPath}/git/refs/heads/${encPath(branch)}`, {
          body: { sha: newCommit.sha, force: false },
          allow: [409, 422],
        });
        if (moved.ok) return { ...result, commit: newCommit.sha };
        // Not a fast-forward: someone else committed. Recompute on the new head.
      }
      throw new GitHubError(409, 'The site was being changed by someone else at the same moment. Please try again.');
    },
  };
}
