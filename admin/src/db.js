// D1 queries. Roles live here rather than in a repo file so that someone who
// can edit content can't promote themselves by editing YAML.

export const ROLES = ['owner', 'editor', 'contributor'];

export const can = {
  publish: (u) => u.role === 'owner' || u.role === 'editor',
  review: (u) => u.role === 'owner' || u.role === 'editor',
  manageUsers: (u) => u.role === 'owner',
};

export async function getUser(db, email) {
  return db.prepare('SELECT email, name, role FROM users WHERE email = ?').bind(email).first();
}

export async function listUsers(db) {
  const { results } = await db.prepare(
    "SELECT email, name, role, added_by, created_at FROM users ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, name, email",
  ).all();
  return results;
}

export async function upsertUser(db, { email, name, role }, by) {
  await db.prepare(
    'INSERT INTO users (email, name, role, added_by) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO UPDATE SET name = excluded.name, role = excluded.role',
  ).bind(email, name, role, by).run();
}

export async function deleteUser(db, email) {
  await db.prepare('DELETE FROM users WHERE email = ?').bind(email).run();
}

export async function countOwners(db) {
  return (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'").first()).n;
}

export async function audit(db, { email, action, collection = null, summary, commit = null }) {
  await db.prepare('INSERT INTO audit (email, action, collection, summary, commit_sha) VALUES (?, ?, ?, ?, ?)')
    .bind(email, action, collection, summary, commit).run();
}

export async function listAudit(db, limit = 100) {
  const { results } = await db.prepare(
    'SELECT a.*, u.name FROM audit a LEFT JOIN users u ON u.email = a.email ORDER BY a.id DESC LIMIT ?',
  ).bind(limit).all();
  return results;
}

export async function createSubmission(db, { email, op, summary }) {
  const { uploads = [], ...rest } = op;
  const row = await db.prepare(
    'INSERT INTO submissions (email, collection, summary, op) VALUES (?, ?, ?, ?) RETURNING id',
  ).bind(email, op.collection, summary, JSON.stringify(rest)).first();
  for (const u of uploads) {
    await db.prepare('INSERT INTO submission_files (submission_id, field, ext, bytes) VALUES (?, ?, ?, ?)')
      .bind(row.id, u.field, u.ext, u.bytes).run();
  }
  return row.id;
}

export async function listSubmissions(db, { status = null, email = null, limit = 100 } = {}) {
  const where = [];
  const args = [];
  if (status) { where.push('s.status = ?'); args.push(status); }
  if (email) { where.push('s.email = ?'); args.push(email); }
  const { results } = await db.prepare(
    `SELECT s.id, s.created_at, s.email, s.collection, s.summary, s.status, s.reviewed_by, s.reviewed_at, s.note, s.commit_sha, u.name
       FROM submissions s LEFT JOIN users u ON u.email = s.email
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY s.id DESC LIMIT ?`,
  ).bind(...args, limit).all();
  return results;
}

export async function countPending(db) {
  return (await db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status = 'pending'").first()).n;
}

export async function getSubmission(db, id) {
  const row = await db.prepare(
    'SELECT s.*, u.name FROM submissions s LEFT JOIN users u ON u.email = s.email WHERE s.id = ?',
  ).bind(id).first();
  if (!row) return null;
  const { results } = await db.prepare('SELECT field, ext, bytes FROM submission_files WHERE submission_id = ?').bind(id).all();
  // D1 returns BLOBs as ArrayBuffers or arrays of numbers depending on the
  // runtime; Uint8Array accepts both.
  const uploads = results.map((f) => ({ field: f.field, ext: f.ext, bytes: new Uint8Array(f.bytes) }));
  return { ...row, op: { ...JSON.parse(row.op), uploads } };
}

// Only moves a submission that is still pending, so two editors clicking
// Approve at once can't both apply it.
export async function claimSubmission(db, id, status, by, note = null) {
  const res = await db.prepare(
    "UPDATE submissions SET status = ?, reviewed_by = ?, reviewed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), note = ? WHERE id = ? AND status = 'pending'",
  ).bind(status, by, note, id).run();
  return res.meta.changes === 1;
}

export async function releaseSubmission(db, id) {
  await db.prepare("UPDATE submissions SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, note = NULL WHERE id = ?")
    .bind(id).run();
}

export async function setSubmissionCommit(db, id, sha) {
  await db.prepare('UPDATE submissions SET commit_sha = ? WHERE id = ?').bind(sha, id).run();
  // The photo is in git now; no need to keep a second copy.
  await dropSubmissionFiles(db, id);
}

export async function dropSubmissionFiles(db, id) {
  await db.prepare('DELETE FROM submission_files WHERE submission_id = ?').bind(id).run();
}
