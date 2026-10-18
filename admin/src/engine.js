// Applies one change ("operation") to a _data/*.yml file.
//
// The file is edited through the `yaml` library's Document model rather than
// re-serialised from plain data, so header comments, quoting and layout all
// survive and a commit touches only the lines that actually changed. With the
// options below, parse -> print is byte-identical for every current data file
// (test/engine.test.js checks this).
//
// An operation is plain JSON so it can wait in the review queue:
//   { type: 'insert' | 'update' | 'delete' | 'move',
//     collection, parent,         // parent key for nested lists, else null
//     index, hash,                // which item (update/delete/move)
//     item,                       // the form's values (insert/update)
//     dir,                        // 'up' | 'down' (move)
//     uploads: [{ field, ext, bytes }] }
//
// `hash` is a fingerprint of the item as the person saw it. If the item at
// `index` no longer matches, someone else changed the file in between, and
// we look for it by fingerprint or refuse rather than edit the wrong row.

import { parseDocument } from 'yaml';
import { BY_ID } from './collections.js';
import { managedKeys, storageKeys, validateItem } from './forms.js';

const PARSE_OPTS = { version: '1.1' }; // Jekyll's YAML (Psych) is 1.1: dates and yes/no must stay quoted.
const PRINT_OPTS = { lineWidth: 0, indentSeq: false, singleQuote: true };

export class OpError extends Error {
  constructor(message, fieldErrors = null) {
    super(message);
    this.fieldErrors = fieldErrors;
  }
}

export function loadDoc(text) {
  const doc = parseDocument(text, PARSE_OPTS);
  if (doc.errors.length) throw new Error(`YAML parse error: ${doc.errors[0].message}`);
  return doc;
}

export function printDoc(doc) {
  return doc.toString(PRINT_OPTS);
}

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function deepEqual(a, b) {
  return stable(a) === stable(b);
}

// cyrb53 — a small, fast 53-bit string hash. Only used to notice concurrent
// edits, so collision resistance against an adversary doesn't matter.
export function itemHash(item) {
  const str = stable(item);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// Read a collection for display: one group per parent (a single group with
// parent null for top-level collections).
export function readCollection(text, coll) {
  const data = loadDoc(text).toJS() ?? [];
  if (!coll.parent) return [{ parent: null, parentKey: null, items: data }];
  return data.map((p) => ({
    parent: p,
    parentKey: String(p[coll.parent.key]),
    items: p[coll.parent.childKey] ?? [],
  }));
}

export function findItem(coll, text, parentKey, index, hash) {
  const group = readCollection(text, coll).find((g) => g.parentKey === (coll.parent ? String(parentKey) : null));
  if (!group) throw new OpError(`That ${coll.parent?.label.toLowerCase() ?? 'list'} no longer exists.`);
  const i = locate(group.items, index, hash);
  return { item: group.items[i], index: i, parent: group.parent, list: group.items };
}

function locate(list, index, hash) {
  if (Number.isInteger(index) && list[index] && itemHash(list[index]) === hash) return index;
  const matches = list.flatMap((it, i) => (itemHash(it) === hash ? [i] : []));
  if (matches.length === 1) return matches[0];
  throw new OpError('This item was changed or removed by someone else since you opened it. Reload and try again.');
}

// Display order of two items under a collection's sort rule. Blank keys sort
// last, matching sort.js.
function compare(order, a, b) {
  const ka = order.key(a);
  const kb = order.key(b);
  const blankA = ka == null || ka === '';
  const blankB = kb == null || kb === '';
  if (blankA || blankB) return blankA === blankB ? 0 : blankA ? 1 : -1;
  if (ka === kb) return 0;
  return (ka < kb) === (order.dir === 'asc') ? -1 : 1;
}

// Where `item` belongs in `list` (which does not contain it). `hint` is its
// old position on edit: if it is still in order there, it stays put, so an
// edit that doesn't change the sort key doesn't shuffle the file.
export function positionFor(order, list, item, hint = -1) {
  if (hint >= 0 && hint <= list.length) {
    const prev = list[hint - 1];
    const next = list[hint];
    if ((!prev || compare(order, prev, item) <= 0) && (!next || compare(order, item, next) <= 0)) return hint;
  }
  const i = list.findIndex((other) => {
    const c = compare(order, item, other);
    return c < 0 || (c === 0 && order.tieFirst);
  });
  return i === -1 ? list.length : i;
}

// Merge the form's values onto an existing item: managed keys are replaced or
// removed, unknown keys are kept, and a newly added key lands next to its
// neighbours in schema order rather than at the end.
export function mergeItem(coll, existing, incoming) {
  const schema = storageKeys(coll);
  const managed = new Set(managedKeys(coll));
  const keys = Object.keys(existing).filter((k) => !managed.has(k) || incoming[k] !== undefined);
  schema.forEach((k, si) => {
    if (incoming[k] === undefined || keys.includes(k)) return;
    const prev = schema.slice(0, si).reverse().find((p) => keys.includes(p));
    const next = schema.slice(si + 1).find((p) => keys.includes(p));
    const at = prev ? keys.indexOf(prev) + 1 : next ? keys.indexOf(next) : keys.length;
    keys.splice(at, 0, k);
  });
  const out = {};
  for (const k of keys) out[k] = managed.has(k) ? incoming[k] : existing[k];
  return out;
}

function newItem(coll, incoming) {
  const out = {};
  for (const k of storageKeys(coll)) if (incoming[k] !== undefined) out[k] = incoming[k];
  for (const [k, v] of Object.entries(coll.defaults ?? {})) if (!(k in out)) out[k] = structuredClone(v);
  return out;
}

const pairKey = (pair) => pair.key?.value ?? pair.key;

// Rewrite a YAML map node to equal `value`, touching only keys that changed
// so unchanged scalars keep their original quoting.
function updateMapNode(doc, map, value) {
  for (const pair of [...map.items]) if (!(pairKey(pair) in value)) map.delete(pairKey(pair));
  const order = Object.keys(value);
  for (const [k, v] of Object.entries(value)) {
    if (map.has(k)) {
      const node = map.get(k, true);
      const current = node && typeof node.toJS === 'function' ? node.toJS(doc) : node;
      if (!deepEqual(current, v)) map.set(k, doc.createNode(v));
    } else {
      const pair = doc.createPair(k, v);
      const at = map.items.findIndex((p) => order.indexOf(pairKey(p)) > order.indexOf(k));
      if (at === -1) map.items.push(pair);
      else map.items.splice(at, 0, pair);
    }
  }
}

// The yaml library attaches a file's header comment to the FIRST item of the
// list, not to the document. Lift it off before reordering the list and put
// it back on whatever ends up first, so the schema comment stays at the top
// when a new item is inserted (or the first one deleted or moved).
function detachLead(seq) {
  const first = seq.items[0];
  if (!first || first.commentBefore == null) return null;
  const lead = { comment: first.commentBefore, space: first.spaceBefore };
  first.commentBefore = undefined;
  first.spaceBefore = undefined;
  return lead;
}

function attachLead(seq, lead) {
  if (!lead) return;
  const target = seq.items[0] ?? seq;
  target.commentBefore = lead.comment;
  if (lead.space) target.spaceBefore = lead.space;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
}

function titleOf(coll, item) {
  return coll.summary(item).title ?? '';
}

// Apply `op` inside a GitHub transaction (see github.js): `tx.read(path)`,
// `tx.list(dir)` and `tx.write(path, content)`. Returns a commit message and
// a short human summary.
export async function applyOp(tx, op) {
  const coll = BY_ID[op.collection];
  if (!coll) throw new OpError('Unknown collection.');
  const doc = loadDoc(await tx.read(coll.file));
  const data = doc.toJS() ?? [];

  // Locate the list both as a YAML node and as plain data. Every change is
  // made to both; at the end the printed YAML must parse back to exactly the
  // plain data, or nothing is written.
  let seq = doc.contents;
  let list = data;
  let parent = null;
  if (coll.parent) {
    const pi = data.findIndex((p) => String(p[coll.parent.key]) === String(op.parent));
    if (pi === -1) throw new OpError(`That ${coll.parent.label.toLowerCase()} no longer exists.`);
    parent = data[pi];
    const parentNode = doc.contents.items[pi];
    if (!parentNode.has(coll.parent.childKey)) parentNode.set(coll.parent.childKey, doc.createNode([]));
    seq = parentNode.get(coll.parent.childKey, true);
    list = parent[coll.parent.childKey] ??= [];
  }
  // `photos: []` parses as a flow sequence; once it has items, write it as a
  // block list like every other list in the files.
  seq.flow = false;

  let verb;
  let item;
  const lead = detachLead(seq);
  switch (op.type) {
    case 'insert':
    case 'update': {
      let index = -1;
      if (op.type === 'update') {
        index = locate(list, op.index, op.hash);
        item = mergeItem(coll, list[index], op.item);
      } else {
        item = newItem(coll, op.item);
      }
      coll.derive?.(item);
      for (const up of op.uploads ?? []) {
        const base = coll.image.name(item, parent);
        const taken = new Set(await tx.list(coll.image.dir));
        let name = `${base}.${up.ext}`;
        for (let n = 2; taken.has(name); n++) name = `${base}-${n}.${up.ext}`;
        tx.write(`${coll.image.dir}/${name}`, up.bytes);
        setPath(item, up.field, name);
      }
      const errors = validateItem(coll, item, list, index);
      if (Object.keys(errors).length) throw new OpError('Please fix the highlighted fields.', errors);

      if (op.type === 'update') {
        const others = list.filter((_, i) => i !== index);
        const to = coll.order ? positionFor(coll.order, others, item, index) : index;
        list.splice(index, 1);
        list.splice(to, 0, item);
        const [node] = seq.items.splice(index, 1);
        updateMapNode(doc, node, item);
        seq.items.splice(to, 0, node);
        verb = 'Update';
      } else {
        const to = coll.order ? positionFor(coll.order, list, item) : list.length;
        list.splice(to, 0, item);
        seq.items.splice(to, 0, doc.createNode(item));
        verb = 'Add';
      }
      break;
    }
    case 'delete': {
      const index = locate(list, op.index, op.hash);
      item = list[index];
      list.splice(index, 1);
      seq.items.splice(index, 1);
      verb = 'Remove';
      break;
    }
    case 'move': {
      if (coll.order) throw new OpError(`${coll.label} are kept in order automatically.`);
      const index = locate(list, op.index, op.hash);
      const to = op.dir === 'up' ? index - 1 : index + 1;
      if (to < 0 || to >= list.length) throw new OpError('It is already at that end of the list.');
      item = list[index];
      [list[index], list[to]] = [list[to], list[index]];
      [seq.items[index], seq.items[to]] = [seq.items[to], seq.items[index]];
      verb = `Move ${op.dir}`;
      break;
    }
    default:
      throw new OpError('Unknown operation.');
  }
  attachLead(seq, lead);

  const out = printDoc(doc);
  if (!deepEqual(loadDoc(out).toJS(), data)) {
    throw new Error('Internal error: the edited YAML did not read back as intended. Nothing was saved.');
  }
  tx.write(coll.file, out);

  const where = coll.parent ? ` (${parent[coll.parent.key]})` : '';
  const title = titleOf(coll, item);
  return {
    summary: `${verb} ${coll.singular} “${title}”${where}`,
    message: `${verb} ${coll.singular}: ${title}${where}`,
  };
}
