import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { COLLECTIONS, BY_ID, slug } from '../src/collections.js';
import { loadDoc, printDoc, applyOp, readCollection, itemHash, mergeItem, positionFor, OpError } from '../src/engine.js';
import { parseForm, renderFields } from '../src/forms.js';
import { REPO, repoFile, memTx, formDataFromHtml } from './helpers.js';

const DATA = ['conferences', 'events', 'gallery', 'glossary', 'pub_categories', 'publications', 'scholarship', 'team']
  .map((n) => `_data/${n}.yml`);

function files() {
  return Object.fromEntries(DATA.map((p) => [p, repoFile(p)]));
}

// Lines added/removed between two texts (multiset diff — enough to assert
// that an edit only touched what it should).
function lineDiff(a, b) {
  const count = (t) => t.split('\n').reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map());
  const ca = count(a);
  const cb = count(b);
  const added = [];
  const removed = [];
  for (const [l, n] of cb) for (let i = 0; i < n - (ca.get(l) ?? 0); i++) added.push(l);
  for (const [l, n] of ca) for (let i = 0; i < n - (cb.get(l) ?? 0); i++) removed.push(l);
  return { added, removed };
}

test('every data file round-trips byte-for-byte', () => {
  for (const p of DATA) {
    const src = repoFile(p);
    assert.equal(printDoc(loadDoc(src)), src, p);
  }
});

test('every collection file exists and every schema field is known to the files', () => {
  const known = new Set(COLLECTIONS.map((c) => c.file));
  for (const f of known) assert.ok(fs.existsSync(path.join(REPO, f)), f);
});

const categories = loadDoc(repoFile('_data/pub_categories.yml')).toJS();

test('every existing item survives a render -> submit -> parse cycle unchanged', async () => {
  for (const coll of COLLECTIONS) {
    for (const group of readCollection(repoFile(coll.file), coll)) {
      for (const item of group.items) {
        const markup = String(renderFields(coll, item, {}, { siteUrl: 'https://x', categories }));
        const { item: parsed, errors } = await parseForm(coll, formDataFromHtml(markup), { existing: item, categories });
        assert.deepEqual(errors, {}, `${coll.id}: ${JSON.stringify(item).slice(0, 80)}`);
        const merged = mergeItem(coll, item, parsed);
        assert.deepEqual(merged, item, `${coll.id} changed: ${JSON.stringify(item).slice(0, 80)}`);
        assert.deepEqual(Object.keys(merged), Object.keys(item), `${coll.id} key order`);
      }
    }
  }
});

test('insert a publication: lands in date order, dates stay quoted, nothing else changes', async () => {
  const f = files();
  const tx = memTx(f);
  const item = {
    title: 'A New Degrader', date: '2026-08-10', date_precision: 'day', journal: 'Nature', lead_author: 'Doe',
    authors: 'Jane Doe et al.', categories: ['degraders', 'clinical'],
    links: [{ label: 'Paper', href: 'https://doi.org/10.1/x' }], why: 'Because: reasons.', advance: 'It works.',
    tags: ['yes', 'KRAS'],
  };
  const res = await applyOp(tx, { type: 'insert', collection: 'publications', item });
  assert.match(res.message, /Add publication: A New Degrader/);
  const out = tx.writes.get('_data/publications.yml');
  const list = loadDoc(out).toJS();
  const i = list.findIndex((p) => p.title === 'A New Degrader');
  assert.equal(list[i - 1].date >= '2026-08-10', true);
  assert.equal(list[i + 1].date <= '2026-08-10', true);
  assert.deepEqual(list[i], item);
  assert.match(out, /- date: '2026-08-10'\n {2}date_precision: day\n {2}title: A New Degrader/);
  assert.match(out, /why: 'Because: reasons.'/);
  assert.match(out, / {2}- 'yes'\n/); // YAML 1.1 would read a bare yes as true
  const d = lineDiff(f['_data/publications.yml'], out);
  assert.equal(d.removed.length, 0);
  assert.equal(d.added.length, out.split('\n').length - f['_data/publications.yml'].split('\n').length);
});

test('update a publication in place: only the changed line differs', async () => {
  const f = files();
  const list = loadDoc(f['_data/publications.yml']).toJS();
  const index = 2;
  const before = list[index];
  const tx = memTx(f);
  const item = { ...before, journal: 'npj Drug Discovery (2026)' };
  await applyOp(tx, { type: 'update', collection: 'publications', index, hash: itemHash(before), item });
  const d = lineDiff(f['_data/publications.yml'], tx.writes.get('_data/publications.yml'));
  assert.deepEqual(d, { added: ['  journal: npj Drug Discovery (2026)'], removed: ['  journal: npj Drug Discovery'] });
});

test('update that changes the sort key moves the item', async () => {
  const f = files();
  const list = loadDoc(f['_data/publications.yml']).toJS();
  const tx = memTx(f);
  await applyOp(tx, { type: 'update', collection: 'publications', index: 0, hash: itemHash(list[0]), item: { ...list[0], date: '2001-01-01' } });
  const out = loadDoc(tx.writes.get('_data/publications.yml')).toJS();
  assert.equal(out.at(-1).title, list[0].title);
  assert.equal(out.length, list.length);
});

test('removing an optional field deletes its line; adding one puts it in schema order', async () => {
  const f = files();
  const list = loadDoc(f['_data/publications.yml']).toJS();
  const withAff = list.findIndex((p) => p.affiliation);
  const without = list.findIndex((p) => !p.affiliation);
  let tx = memTx(f);
  const { affiliation, ...rest } = list[withAff];
  await applyOp(tx, { type: 'update', collection: 'publications', index: withAff, hash: itemHash(list[withAff]), item: { ...rest, affiliation: undefined } });
  assert.deepEqual(lineDiff(f['_data/publications.yml'], tx.writes.get('_data/publications.yml')), { added: [], removed: [`  affiliation: ${affiliation}`] });

  tx = memTx(f);
  await applyOp(tx, { type: 'update', collection: 'publications', index: without, hash: itemHash(list[without]), item: { ...list[without], affiliation: 'MIT' } });
  const out = loadDoc(tx.writes.get('_data/publications.yml')).toJS();
  const keys = Object.keys(out[without]);
  assert.equal(keys[keys.indexOf('authors') + 1], 'affiliation');
});

test('the header comment stays at the top through insert-first, delete-first and move-first', async () => {
  const f = files();
  const header = (t) => t.slice(0, t.indexOf('\n- '));
  const gallery = f['_data/gallery.yml'];
  let tx = memTx(f);
  await applyOp(tx, { type: 'insert', collection: 'gallery', item: { event: 'Newest', location: 'X', year: 2030 },
    uploads: [{ field: 'photo', ext: 'jpg', bytes: new Uint8Array([0xff, 0xd8, 0xff]) }] });
  let out = tx.writes.get('_data/gallery.yml');
  assert.equal(header(out), header(gallery));
  assert.match(out, /\n- event: Newest\n {2}location: X\n {2}year: 2030\n {2}photo: newest-2030\.jpg\n- event: AACR\n/);
  assert.deepEqual(lineDiff(gallery, out).removed, []);

  const first = loadDoc(gallery).toJS()[0];
  tx = memTx(f);
  await applyOp(tx, { type: 'delete', collection: 'gallery', index: 0, hash: itemHash(first) });
  out = tx.writes.get('_data/gallery.yml');
  assert.equal(header(out), header(gallery));

  const team = loadDoc(f['_data/team.yml']).toJS();
  tx = memTx(f);
  await applyOp(tx, { type: 'move', collection: 'team', index: 1, hash: itemHash(team[1]), dir: 'up' });
  out = tx.writes.get('_data/team.yml');
  assert.equal(header(out), header(f['_data/team.yml']));
  assert.match(out, new RegExp(`\n- name: ${team[1].name}\n`));
  assert.equal(loadDoc(out).toJS()[0].name, team[1].name);
});

test('stale edit is refused, moved item is still found', async () => {
  const f = files();
  const list = loadDoc(f['_data/publications.yml']).toJS();
  const tx = memTx(f);
  await assert.rejects(
    applyOp(tx, { type: 'delete', collection: 'publications', index: 3, hash: 'nope' }),
    OpError,
  );
  // Right hash, wrong index (someone inserted above it): found by hash.
  await applyOp(tx, { type: 'delete', collection: 'publications', index: 0, hash: itemHash(list[3]) });
  const out = loadDoc(tx.writes.get('_data/publications.yml')).toJS();
  assert.equal(out.length, list.length - 1);
  assert.ok(!out.some((p) => p.title === list[3].title));
});

test('duplicate title is rejected', async () => {
  const f = files();
  const first = loadDoc(f['_data/publications.yml']).toJS()[0];
  await assert.rejects(
    applyOp(memTx(f), { type: 'insert', collection: 'publications', item: { ...first, title: first.title.toUpperCase() } }),
    (err) => err instanceof OpError && Boolean(err.fieldErrors?.title),
  );
});

test('glossary: insert into a section, move, and the HTML/accent rules', async () => {
  const f = files();
  const sections = loadDoc(f['_data/glossary.yml']).toJS();
  const parent = sections[1].title;
  let tx = memTx(f);
  await applyOp(tx, { type: 'insert', collection: 'glossary', parent, item: { name: 'Zeta-substrate', definition: 'A <em>new</em> target.' } });
  let out = loadDoc(tx.writes.get('_data/glossary.yml')).toJS();
  assert.deepEqual(out[1].terms.at(-1), { name: 'Zeta-substrate', definition: 'A <em>new</em> target.' });
  assert.equal(out[0].terms.length, sections[0].terms.length);

  const terms = sections[0].terms;
  tx = memTx(f);
  await applyOp(tx, { type: 'move', collection: 'glossary', parent: sections[0].title, index: 1, hash: itemHash(terms[1]), dir: 'up' });
  out = loadDoc(tx.writes.get('_data/glossary.yml')).toJS();
  assert.equal(out[0].terms[0].name, terms[1].name);
  assert.equal(out[0].terms[1].name, terms[0].name);

  await assert.rejects(
    applyOp(memTx(f), { type: 'insert', collection: 'glossary', parent, item: { name: 'PROTAC2', highlight: 'X' } }),
    (err) => Boolean(err.fieldErrors?.highlight),
  );
});

test('publications cannot be moved by hand', async () => {
  const f = files();
  const list = loadDoc(f['_data/publications.yml']).toJS();
  await assert.rejects(applyOp(memTx(f), { type: 'move', collection: 'publications', index: 1, hash: itemHash(list[1]), dir: 'up' }), OpError);
});

test('gallery upload: named from the event, -2 on collision, top of its year, one write per file', async () => {
  const f = files();
  const tx = memTx(f, { 'assets/images/gallery': ['aacr-2026.jpg', 'other.jpg'] });
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
  await applyOp(tx, {
    type: 'insert', collection: 'gallery',
    item: { event: 'AACR', location: 'Chicago', year: 2026 },
    uploads: [{ field: 'photo', ext: 'jpg', bytes }],
  });
  assert.equal(tx.writes.get('assets/images/gallery/aacr-2026-2.jpg'), bytes);
  const out = loadDoc(tx.writes.get('_data/gallery.yml')).toJS();
  assert.deepEqual(out[0], { event: 'AACR', location: 'Chicago', year: 2026, photo: 'aacr-2026-2.jpg' });

  const tx2 = memTx(f, {});
  await applyOp(tx2, { type: 'insert', collection: 'gallery', item: { event: 'Old', location: 'X', year: 2024 }, uploads: [{ field: 'photo', ext: 'png', bytes }] });
  const out2 = loadDoc(tx2.writes.get('_data/gallery.yml')).toJS();
  const i = out2.findIndex((p) => p.event === 'Old');
  assert.equal(out2[i - 1].year, 2025);
  assert.equal(out2[i + 1].year, 2024);
});

test('scholarship: a new year gets empty lists, and photos can then be added to it', async () => {
  const f = files();
  let tx = memTx(f);
  await applyOp(tx, { type: 'insert', collection: 'scholarship', item: { year: 2027 } });
  f['_data/scholarship.yml'] = tx.writes.get('_data/scholarship.yml');
  assert.match(f['_data/scholarship.yml'], /- year: 2027\n {2}winners: \[\]\n {2}photos: \[\]\n$/);

  tx = memTx(f);
  await applyOp(tx, { type: 'insert', collection: 'scholarship-winners', parent: '2027', item: { name: 'Dr. A', affiliation: 'B' } });
  f['_data/scholarship.yml'] = tx.writes.get('_data/scholarship.yml');
  tx = memTx(f);
  await applyOp(tx, {
    type: 'insert', collection: 'scholarship-photos', parent: '2027',
    item: { person: 'Dr. A', event: 'E', location: 'L', alt: 'Dr. A at E', wide: true },
    uploads: [{ field: 'photo', ext: 'jpg', bytes: new Uint8Array([0xff, 0xd8, 0xff]) }],
  });
  const text = tx.writes.get('_data/scholarship.yml');
  assert.match(text, /- year: 2027\n {2}winners:\n {2}- name: Dr\. A\n {4}affiliation: B\n {2}photos:\n {2}- person: Dr\. A\n/);
  const last = loadDoc(text).toJS().at(-1);
  assert.equal(last.photos[0].photo, 'dr-a-2027.jpg');
  assert.ok(tx.writes.has('assets/images/scholarship/dr-a-2027.jpg'));

  await assert.rejects(applyOp(memTx(f), { type: 'insert', collection: 'scholarship', item: { year: 2025 } }), (e) => Boolean(e.fieldErrors?.year));
});

test('conferences: TBA meeting sorts last with start: null', async () => {
  const f = files();
  const tx = memTx(f);
  await applyOp(tx, { type: 'insert', collection: 'conferences', item: { name: 'New TBA', venue: 'X', url: 'https://x.org', start: null, display: { month: '2027', day: 'TBA', year: '' } } });
  const text = tx.writes.get('_data/conferences.yml');
  assert.match(text, /- name: New TBA\n {2}venue: X\n {2}url: https:\/\/x\.org\n {2}start: null\n {2}display:\n {4}month: '2027'\n {4}day: TBA\n {4}year: ''\n$/);
  const tx2 = memTx(f);
  await applyOp(tx2, { type: 'insert', collection: 'conferences', item: { name: 'Early', venue: 'X', url: 'https://x.org', start: '2026-01-01' } });
  assert.equal(loadDoc(tx2.writes.get('_data/conferences.yml')).toJS()[0].name, 'Early');
});

test('team: sort_name derived when blank', async () => {
  const f = files();
  const tx = memTx(f);
  await applyOp(tx, { type: 'insert', collection: 'team', item: { name: 'Ada María Lovelace', org: 'X' }, uploads: [{ field: 'photo', ext: 'png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }] });
  const last = loadDoc(tx.writes.get('_data/team.yml')).toJS().at(-1);
  assert.equal(last.sort_name, 'Lovelace, Ada María');
  assert.equal(last.photo, 'ada-maria-lovelace.png');
});

test('positionFor keeps an in-order item where it is', () => {
  const order = BY_ID.events.order;
  const list = [{ date: '2026-01-01' }, { date: '2026-02-01' }, { date: '2026-02-01' }, { date: '2026-03-01' }];
  assert.equal(positionFor(order, list, { date: '2026-02-01' }, 1), 1);
  assert.equal(positionFor(order, list, { date: '2026-02-01' }), 3);
  assert.equal(positionFor(order, list, { date: '2025-01-01' }), 0);
});

test('slug', () => {
  assert.equal(slug('Leyna Duong & Jessica Graham 2025'), 'leyna-duong-jessica-graham-2025');
  assert.equal(slug('Inés María García'), 'ines-maria-garcia');
  assert.equal(slug('***'), 'photo');
});
