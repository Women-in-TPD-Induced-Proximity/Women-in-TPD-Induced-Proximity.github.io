// A stand-in for the slice of the GitHub API the portal uses, so the portal
// can be tried locally with no GitHub credentials and no risk to the real
// repo. Files are read from this checkout; commits live in memory only.
//
//   node dev/mock-github.js            # listens on :8788
//   GITHUB_API=http://127.0.0.1:8788   # in .dev.vars, then `npm run dev`
//
// GET /__file/<path> returns a file as of the current head, for inspection.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 8788);

const blobs = new Map(); // sha -> Buffer
const trees = new Map(); // sha -> Map(path -> Buffer | null)  (overlay on the checkout)
const commits = new Map(); // sha -> { tree, parents, message }
const id = () => crypto.randomBytes(20).toString('hex');

trees.set('t0', new Map());
commits.set('c0'.padEnd(40, '0'), { tree: 't0', parents: [], message: 'checkout' });
let head = 'c0'.padEnd(40, '0');

function readAt(commitSha, p) {
  const overlay = trees.get(commits.get(commitSha).tree);
  if (overlay.has(p)) return overlay.get(p);
  const full = path.join(ROOT, p);
  if (!full.startsWith(ROOT + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return fs.readFileSync(full);
}

function listAt(commitSha, dir) {
  const names = new Set();
  const full = path.join(ROOT, dir);
  if (fs.existsSync(full) && fs.statSync(full).isDirectory()) fs.readdirSync(full).forEach((n) => names.add(n));
  for (const [p, v] of trees.get(commits.get(commitSha).tree)) {
    if (path.dirname(p) === dir) (v ? names.add(path.basename(p)) : names.delete(path.basename(p)));
  }
  return [...names].sort();
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let body = '';
  for await (const chunk of req) body += chunk;
  const json = body ? JSON.parse(body) : null;
  const p = decodeURIComponent(url.pathname);
  const repo = p.match(/^\/repos\/[^/]+\/[^/]+(\/.*)$/)?.[1];
  console.log(req.method, url.pathname + url.search);

  if (p.startsWith('/__file/')) {
    const data = readAt(head, p.slice('/__file/'.length));
    return data ? send(res, 200, data, 'text/plain; charset=utf-8') : send(res, 404, 'not found', 'text/plain');
  }
  if (!repo) return send(res, 404, { message: 'Not Found' });

  if (req.method === 'GET' && /^\/git\/ref\/heads\/[^/]+$/.test(repo)) return send(res, 200, { object: { sha: head } });
  if (req.method === 'GET' && repo.startsWith('/git/commits/')) {
    const c = commits.get(repo.split('/').pop());
    return c ? send(res, 200, { sha: repo.split('/').pop(), tree: { sha: c.tree } }) : send(res, 404, { message: 'Not Found' });
  }
  if (req.method === 'GET' && repo.startsWith('/contents/')) {
    const ref = url.searchParams.get('ref');
    const sha = commits.has(ref) ? ref : head;
    const target = repo.slice('/contents/'.length);
    const file = readAt(sha, target);
    if (file) return send(res, 200, file, 'text/plain; charset=utf-8');
    const names = listAt(sha, target);
    return names.length ? send(res, 200, names.map((name) => ({ name, type: 'file' }))) : send(res, 404, { message: 'Not Found' });
  }
  if (req.method === 'POST' && repo === '/git/blobs') {
    const sha = id();
    blobs.set(sha, Buffer.from(json.content, json.encoding === 'base64' ? 'base64' : 'utf8'));
    return send(res, 201, { sha });
  }
  if (req.method === 'POST' && repo === '/git/trees') {
    const overlay = new Map(trees.get(json.base_tree));
    for (const e of json.tree) overlay.set(e.path, e.sha === null ? null : e.content != null ? Buffer.from(e.content) : blobs.get(e.sha));
    const sha = id();
    trees.set(sha, overlay);
    return send(res, 201, { sha });
  }
  if (req.method === 'POST' && repo === '/git/commits') {
    const sha = id();
    commits.set(sha, { tree: json.tree, parents: json.parents, message: json.message });
    return send(res, 201, { sha });
  }
  if (req.method === 'PATCH' && /^\/git\/refs\/heads\/[^/]+$/.test(repo)) {
    const c = commits.get(json.sha);
    if (!c || c.parents[0] !== head) return send(res, 422, { message: 'Update is not a fast forward' });
    head = json.sha;
    console.log(`  -> new head ${head.slice(0, 7)}: ${c.message.split('\n')[0]}`);
    return send(res, 200, { object: { sha: head } });
  }
  return send(res, 404, { message: 'Not Found' });
}).listen(PORT, '127.0.0.1', () => console.log(`mock GitHub on http://127.0.0.1:${PORT}`));
