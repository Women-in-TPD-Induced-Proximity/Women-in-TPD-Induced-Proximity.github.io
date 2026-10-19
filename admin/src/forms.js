// Turns a collection's field list into an HTML form, and a submitted form back
// into a clean item. Validation lives here too, so that the same rules run on
// a direct save and again when an editor approves a contributor's submission.

import { html } from './html.js';

// Pending submissions park their photos in D1, whose rows top out at ~2 MB.
// The form's script shrinks photos to a few hundred KB before upload, so this
// only bites when JavaScript is off.
export const MAX_UPLOAD_BYTES = 1_900_000;

const ALLOWED_TAGS = new Set(['em', 'i', 'strong', 'b', 'sub', 'sup']);

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
}

// The top-level keys a collection's form owns. Anything else on an item (a
// field the form doesn't know about) is left untouched on edit.
export function managedKeys(coll) {
  return [...new Set(coll.fields.map((f) => f.name.split('.')[0]))];
}

// The order keys are written to the file in, when it differs from the order
// the form asks for them.
export function storageKeys(coll) {
  return coll.keyOrder ?? managedKeys(coll);
}

// Several templates print URLs unescaped inside href="...", so a URL must be
// a plain http(s) link with nothing that could break out of the attribute.
export function checkUrl(value, { allowMailto = false, allowRelative = false } = {}) {
  if (/[\s"'<>`\\]/.test(value)) return 'URLs cannot contain spaces, quotes or angle brackets.';
  if (allowRelative && /^(\/(?!\/)[^]*|[a-z0-9-]+\.html(#[^]*)?)$/i.test(value)) return null;
  let u;
  try { u = new URL(value); } catch { return 'Enter a full URL starting with https://'; }
  const ok = u.protocol === 'https:' || u.protocol === 'http:' || (allowMailto && u.protocol === 'mailto:');
  return ok ? null : 'Enter a full URL starting with https://';
}

// Glossary text is rendered raw so terms can use <sub>/<em>. Allow exactly
// those few attribute-less tags and nothing else that could become markup.
export function checkInlineHtml(value) {
  const stripped = value.replace(/<(\/?)([a-z0-9]+)(\s*)>/gi, (m, close, tag) =>
    ALLOWED_TAGS.has(tag.toLowerCase()) ? '' : m);
  if (/</.test(stripped)) return 'Only <em>, <i>, <strong>, <b>, <sub> and <sup> are allowed (no attributes). Write a literal "<" as &lt;';
  return null;
}

function checkDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Use the date picker (YYYY-MM-DD).';
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? 'Not a real date.' : null;
}

function cleanText(v) {
  // The data files keep every value on one line.
  return String(v ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

export function sniffImage(bytes) {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  const ascii = (i, n) => String.fromCharCode(...b.slice(i, i + n));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp';
  return null;
}

// Parse a submitted form. Returns the item restricted to the collection's
// managed keys (an absent optional field is `undefined`, meaning "remove"),
// any photo uploads, and per-field errors. On error, `item` still holds what
// was typed so the form can be re-shown with it.
export async function parseForm(coll, form, { existing = null, categories = [] } = {}) {
  const item = {};
  const errors = {};
  const uploads = [];

  for (const f of coll.fields) {
    let value;
    switch (f.type) {
      case 'checkbox':
        value = form.get(f.name) ? true : undefined;
        break;
      case 'year': {
        const s = cleanText(form.get(f.name));
        if (s) {
          value = /^\d{4}$/.test(s) ? Number(s) : s;
          if (typeof value !== 'number') errors[f.name] = 'Enter a four-digit year.';
        }
        break;
      }
      case 'tags':
        value = cleanText(form.get(f.name)).split(',').map((t) => t.trim()).filter(Boolean);
        if (!value.length) value = undefined;
        break;
      case 'urllist':
        value = String(form.get(f.name) ?? '').split(/[\r\n]+/).map((t) => t.trim()).filter(Boolean);
        for (const u of value) {
          const err = checkUrl(u);
          if (err) { errors[f.name] = `${u}: ${err}`; break; }
        }
        if (!value.length) value = undefined;
        break;
      case 'links': {
        const labels = form.getAll(`${f.name}__label`).map(cleanText);
        const hrefs = form.getAll(`${f.name}__href`).map(cleanText);
        value = [];
        labels.forEach((label, i) => {
          const href = hrefs[i] || '';
          if (!label && !href) return;
          value.push({ label, href });
          if (!label || !href) errors[f.name] = 'Each link needs both a label and a URL.';
          else if (checkUrl(href)) errors[f.name] = `${href}: ${checkUrl(href)}`;
        });
        if (!value.length) value = undefined;
        break;
      }
      case 'categories': {
        const primary = cleanText(form.get(`${f.name}__primary`));
        const extra = form.getAll(`${f.name}__extra`).map(cleanText).filter((s) => s && s !== primary);
        value = primary ? [primary, ...extra] : extra;
        const slugs = new Set(categories.map((c) => c.slug));
        if (value.some((s) => !slugs.has(s))) errors[f.name] = 'Unknown category.';
        else if (!primary && extra.length) errors[f.name] = 'Choose a primary category.';
        if (!value.length) value = undefined;
        break;
      }
      case 'image': {
        const file = form.get(f.name);
        value = existing ? getPath(existing, f.name) : undefined;
        if (file && typeof file === 'object' && file.size > 0) {
          if (file.size > MAX_UPLOAD_BYTES) {
            errors[f.name] = `That photo is ${(file.size / 1e6).toFixed(1)} MB; the limit is 1.9 MB. Please use a smaller copy.`;
          } else {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const ext = sniffImage(bytes);
            if (!ext) errors[f.name] = 'Upload a JPEG, PNG or WebP image.';
            else uploads.push({ field: f.name, ext, bytes });
          }
        }
        break;
      }
      default: {
        const s = cleanText(form.get(f.name));
        value = s || undefined;
        if (value && f.type === 'url') {
          const err = checkUrl(value, f);
          if (err) errors[f.name] = err;
        } else if (value && f.type === 'html') {
          const err = checkInlineHtml(value);
          if (err) errors[f.name] = err;
        } else if (value && f.type === 'date') {
          const err = checkDate(value);
          if (err) errors[f.name] = err;
        } else if (value && f.type === 'select') {
          if (!f.options.some(([v]) => v === value)) errors[f.name] = 'Choose one of the options.';
        }
      }
    }
    if (value === undefined && f.keepNull) value = null;
    if (value !== undefined) setPath(item, f.name, value);
    const missing = value === undefined || value === null;
    if (f.required && missing && !errors[f.name]) {
      const uploading = f.type === 'image' && uploads.some((u) => u.field === f.name);
      if (!uploading) errors[f.name] = f.type === 'image' ? 'Choose a photo.' : 'Required.';
    }
  }
  // A nested object keeps all its keys once any is filled in, matching the
  // existing data (`display: {month: '2026', day: TBA, year: ''}`).
  for (const f of coll.fields) {
    const [top, ...rest] = f.name.split('.');
    if (rest.length && item[top] && getPath(item, f.name) === undefined) setPath(item, f.name, '');
  }
  return { item, errors, uploads };
}

// Rules that need the whole item, or the rest of the list, rather than one
// field. Runs again at apply time against the current file, which is what
// catches two people adding the same paper at once.
export function validateItem(coll, item, list, selfIndex = -1) {
  const errors = { ...(coll.validate?.(item) ?? {}) };
  if (coll.unique) {
    const { field, message } = coll.unique;
    const norm = (v) => String(v ?? '').trim().toLowerCase();
    if (list.some((other, i) => i !== selfIndex && norm(other[field]) === norm(item[field]))) {
      errors[field] = message;
    }
  }
  return errors;
}

function fieldId(name) {
  return `f-${name.replace(/\./g, '-')}`;
}

function renderControl(coll, f, item, ctx) {
  const value = getPath(item, f.name);
  const id = fieldId(f.name);
  const req = f.required && f.type !== 'image' && f.type !== 'links' && f.type !== 'categories';
  switch (f.type) {
    case 'textarea':
    case 'html':
      return html`<textarea id="${id}" name="${f.name}" rows="3" ${req ? html`required` : ''}>${value ?? ''}</textarea>`;
    case 'urllist':
      return html`<textarea id="${id}" name="${f.name}" rows="3" spellcheck="false">${(value ?? []).join('\n')}</textarea>`;
    case 'tags':
      return html`<input id="${id}" name="${f.name}" type="text" value="${Array.isArray(value) ? value.join(', ') : value ?? ''}">`;
    case 'date':
      return html`<input id="${id}" name="${f.name}" type="date" value="${value ?? ''}" ${req ? html`required` : ''}>`;
    case 'year':
      return html`<input id="${id}" name="${f.name}" type="number" min="1990" max="2100" step="1" value="${value ?? ''}" ${req ? html`required` : ''}>`;
    case 'url':
      return html`<input id="${id}" name="${f.name}" type="${f.allowRelative || f.allowMailto ? 'text' : 'url'}" inputmode="url" spellcheck="false" value="${value ?? ''}" ${req ? html`required` : ''}>`;
    case 'checkbox':
      return html`<input id="${id}" name="${f.name}" type="checkbox" value="1" ${value ? html`checked` : ''}>`;
    case 'select':
      return html`<select id="${id}" name="${f.name}" ${req ? html`required` : ''}>
        ${f.options.map(([v, label]) => html`<option value="${v}" ${String(value ?? '') === v ? html`selected` : ''}>${label}</option>`)}
      </select>`;
    case 'categories': {
      const [primary, ...extra] = value ?? [];
      return html`<div class="cat-picker">
        <label class="sub">Primary
          <select id="${id}" name="${f.name}__primary">
            <option value="">— choose —</option>
            ${ctx.categories.map((c) => html`<option value="${c.slug}" ${c.slug === primary ? html`selected` : ''}>${c.label}</option>`)}
          </select>
        </label>
        <fieldset class="sub"><legend>Also in</legend>
          ${ctx.categories.map((c) => html`<label class="check"><input type="checkbox" name="${f.name}__extra" value="${c.slug}" ${extra.includes(c.slug) ? html`checked` : ''}> ${c.label}</label>`)}
        </fieldset>
      </div>`;
    }
    case 'links': {
      // Existing rows plus two blank ones, so this works without JavaScript.
      const rows = [...(value ?? []), { label: '', href: '' }, { label: '', href: '' }];
      return html`<div class="link-rows" id="${id}">
        ${rows.map((r) => html`<div class="link-row">
          <input name="${f.name}__label" type="text" placeholder="Paper" aria-label="Link label" value="${r.label}">
          <input name="${f.name}__href" type="url" placeholder="https://doi.org/…" aria-label="Link URL" spellcheck="false" value="${r.href}">
        </div>`)}
      </div>`;
    }
    case 'image': {
      const src = value && coll.image ? `${ctx.siteUrl}/${coll.image.dir}/${value}` : null;
      return html`<div class="image-field">
        ${src ? html`<figure class="current"><img src="${src}" alt=""><figcaption>Current: ${value}</figcaption></figure>` : ''}
        <input id="${id}" name="${f.name}" type="file" accept="image/jpeg,image/png,image/webp" data-resize="${coll.image?.maxSide ?? 1600}">
        <p class="hint">${src ? 'Choose a file only to replace the current photo. ' : ''}Large photos are shrunk automatically before upload.</p>
      </div>`;
    }
    default:
      return html`<input id="${id}" name="${f.name}" type="text" value="${value ?? ''}" ${req ? html`required` : ''}>`;
  }
}

export function renderFields(coll, item, errors, ctx) {
  return coll.fields.map((f) => {
    const err = errors[f.name];
    const label = html`${f.label}${f.required ? html` <span class="req" aria-hidden="true">*</span>` : ''}`;
    const group = ['categories', 'links'].includes(f.type);
    return html`<div class="field field-${f.type}${err ? ' has-error' : ''}">
      ${f.type === 'checkbox'
        ? html`<label class="check">${renderControl(coll, f, item, ctx)} ${label}</label>`
        : group
          ? html`<span class="label" id="${fieldId(f.name)}-label">${label}</span>${renderControl(coll, f, item, ctx)}`
          : html`<label for="${fieldId(f.name)}">${label}</label>${renderControl(coll, f, item, ctx)}`}
      ${f.help ? html`<p class="hint">${f.help}</p>` : ''}
      ${err ? html`<p class="error" role="alert">${err}</p>` : ''}
    </div>`;
  });
}
