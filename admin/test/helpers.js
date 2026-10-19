import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function repoFile(p) {
  return fs.readFileSync(path.join(REPO, p), 'utf8');
}

// An in-memory stand-in for github.js's transaction object.
export function memTx(files, dirs = {}) {
  const writes = new Map();
  return {
    writes,
    read: async (p) => {
      if (!(p in files)) throw new Error(`no such file ${p}`);
      return files[p];
    },
    list: async (d) => dirs[d] ?? [],
    write: (p, c) => writes.set(p, c),
  };
}

// Pull the submitted values out of rendered form HTML, the way a browser
// would on submit (our own markup only — not a general HTML parser).
export function formDataFromHtml(markup) {
  const fd = new FormData();
  const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const attr = (tag, name) => {
    const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
    return m ? unesc(m[1]) : null;
  };
  const re = /<input\b[^>]*>|<textarea\b[^>]*>[^]*?<\/textarea>|<select\b[^>]*>[^]*?<\/select>/g;
  for (const [tag] of markup.matchAll(re)) {
    const name = attr(tag, 'name');
    if (!name) continue;
    if (tag.startsWith('<input')) {
      const type = attr(tag, 'type');
      if (type === 'file') { fd.append(name, new File([], '')); continue; }
      if (type === 'checkbox') { if (/\schecked\b/.test(tag)) fd.append(name, attr(tag, 'value')); continue; }
      fd.append(name, attr(tag, 'value') ?? '');
    } else if (tag.startsWith('<textarea')) {
      fd.append(name, unesc(tag.replace(/^<textarea\b[^>]*>/, '').replace(/<\/textarea>$/, '')));
    } else {
      const opts = [...tag.matchAll(/<option\b[^>]*>/g)].map(([o]) => o);
      const sel = opts.find((o) => /\sselected\b/.test(o)) ?? opts[0];
      fd.append(name, sel ? attr(sel, 'value') : '');
    }
  }
  return fd;
}
