// The editable collections. Each entry mirrors the schema comment at the top
// of its _data/*.yml file — if you change a file's schema, change it here too.
//
// A collection is either a top-level list (publications.yml is one list of
// papers) or a list nested inside a parent list (glossary.yml is a list of
// sections, each holding `terms`). Nested ones name the parent's identifying
// field in `parent.key`, so an operation can say "the section titled X"
// rather than "section 0" and survive someone reordering sections.
//
// Field types (rendering and parsing live in forms.js):
//   text, textarea   single-line string (textarea just gives more room)
//   html             like textarea, but inline <em>/<sub>/... allowed
//   url              http(s) link (mailto/site-relative only where allowed)
//   date             YYYY-MM-DD, stored as a quoted string
//   year             integer
//   select           one of `options`
//   checkbox         stored as `true`, omitted when unticked
//   tags             comma-separated in the form, a YAML list in the file
//   urllist          one URL per line
//   links            rows of label + href
//   categories       primary category + optional extra ones
//   image            an uploaded photo; the file stores only its filename
//
// Ordering. The order of items in the file is the order a visitor without
// JavaScript sees, and sort.js's default option must reproduce it (see
// CLAUDE.md). So collections with a sort key are kept sorted by the server —
// nobody is asked where to put a new paper — and the rest are ordered by hand
// with move up/down.

export const COLLECTIONS = [
  {
    id: 'publications',
    label: 'Publications',
    singular: 'publication',
    file: '_data/publications.yml',
    page: '/publications.html',
    order: { key: (p) => p.date, dir: 'desc', tieFirst: true },
    summary: (p) => ({ title: p.title, meta: [p.journal, p.date].filter(Boolean).join(' · ') }),
    unique: { field: 'title', message: 'A publication with this title is already listed.' },
    // The form asks for the title first; the file has always led with the date.
    keyOrder: ['date', 'date_precision', 'title', 'journal', 'lead_author', 'authors', 'affiliation',
      'categories', 'links', 'why', 'advance', 'tags'],
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'date', label: 'Publication date', type: 'date', required: true,
        help: 'If only the month is known, pick the 15th and set precision to "Month".' },
      { name: 'date_precision', label: 'Date precision', type: 'select', required: true,
        options: [['day', 'Day — shown as "14 Aug 2026"'], ['month', 'Month — shown as "Aug 2026"']] },
      { name: 'journal', label: 'Journal', type: 'text', required: true },
      { name: 'lead_author', label: 'Lead author surname', type: 'text', required: true,
        help: 'Surname only. Used for the "Lead author (A–Z)" sort.' },
      { name: 'authors', label: 'Author line', type: 'text', required: true,
        help: 'As displayed, e.g. "Laura Silvian et al."' },
      { name: 'affiliation', label: 'Affiliation', type: 'text' },
      { name: 'categories', label: 'Category', type: 'categories', required: true,
        help: 'The primary category leads on the card.' },
      { name: 'links', label: 'Links', type: 'links', required: true,
        help: 'Label is the visible text, e.g. "Paper", "Preprint", "Review".' },
      { name: 'why', label: 'Why it matters', type: 'textarea', required: true },
      { name: 'advance', label: 'Key advance', type: 'textarea', required: true },
      { name: 'tags', label: 'Tags', type: 'tags', help: 'Comma-separated, e.g. "KRAS, Resistance, Oncology".' },
    ],
  },
  {
    id: 'glossary',
    label: 'DicTACtionary terms',
    singular: 'term',
    file: '_data/glossary.yml',
    page: '/dictac.html',
    parent: { key: 'title', childKey: 'terms', label: 'Section' },
    summary: (t) => ({ title: t.name, meta: t.abbr || '' }),
    unique: { field: 'name', message: 'This section already has a term with that name.' },
    fields: [
      { name: 'name', label: 'Term', type: 'text', required: true,
        help: 'Plain text — it is also the A–Z sort key and the search text.' },
      { name: 'highlight', label: 'Accent', type: 'text',
        help: 'Optional. Part of the term shown in the accent colour, e.g. "TAC" in PROTAC. Must appear exactly once in the term.' },
      { name: 'abbr', label: 'Abbreviation', type: 'text', help: 'Optional. Shown muted after the term, e.g. "TPD".' },
      { name: 'name_html', label: 'Term with markup', type: 'html',
        help: 'Only if the term needs subscripts etc., e.g. "DC<sub>50</sub>". Overrides the accent.' },
      { name: 'expansion', label: 'Expansion', type: 'html',
        help: 'The short grey line under the term (TAC-family section). <em>, <sub>, <sup> allowed.' },
      { name: 'definition', label: 'Definition', type: 'html',
        help: 'The prose paragraph (concepts section). Use either an expansion or a definition, not both.' },
      { name: 'refs', label: 'References', type: 'urllist', help: 'One URL per line.' },
    ],
    validate(t) {
      const errors = {};
      if (t.highlight && t.name && t.name.split(t.highlight).length !== 2) {
        errors.highlight = 'The accent must appear exactly once in the term.';
      }
      if (t.expansion && t.definition) errors.definition = 'Use either an expansion or a definition, not both.';
      return errors;
    },
  },
  {
    id: 'team',
    label: 'Core team',
    singular: 'team member',
    file: '_data/team.yml',
    page: '/core-team.html',
    summary: (m) => ({ title: m.name, meta: m.org, image: m.photo && `/assets/images/team/${m.photo}` }),
    image: { field: 'photo', dir: 'assets/images/team', maxSide: 800, name: (m) => slug(m.name) },
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'sort_name', label: 'Sort name', type: 'text',
        help: '"Surname, First" for the A–Z sort. Leave blank to use the last word of the name.' },
      { name: 'org', label: 'Organisation', type: 'text', required: true },
      { name: 'photo', label: 'Photo', type: 'image', required: true, help: 'A square-ish portrait works best.' },
      { name: 'linkedin', label: 'LinkedIn URL', type: 'url' },
      { name: 'framing', label: 'Photo framing', type: 'select', options: [['', 'Default'], ['center', 'Centred crop']],
        help: 'Only change this if the default crop cuts off the face.' },
    ],
    derive(m) {
      if (!m.sort_name && m.name) {
        const parts = m.name.trim().split(/\s+/);
        m.sort_name = parts.length > 1 ? `${parts.at(-1)}, ${parts.slice(0, -1).join(' ')}` : m.name.trim();
      }
    },
  },
  {
    id: 'gallery',
    label: 'Photo gallery',
    singular: 'photo',
    file: '_data/gallery.yml',
    page: '/photo-gallery.html',
    order: { key: (p) => p.year, dir: 'desc', tieFirst: true },
    summary: (p) => ({ title: p.event, meta: [p.location, p.year].filter(Boolean).join(' · '),
      image: p.photo && `/assets/images/gallery/${p.photo}` }),
    image: { field: 'photo', dir: 'assets/images/gallery', maxSide: 1600, name: (p) => slug(`${p.event} ${p.year}`) },
    fields: [
      { name: 'event', label: 'Event', type: 'text', required: true },
      { name: 'location', label: 'Location', type: 'text', required: true },
      { name: 'year', label: 'Year', type: 'year', required: true },
      { name: 'photo', label: 'Photo', type: 'image', required: true },
      { name: 'alt', label: 'Alt text override', type: 'text',
        help: 'Optional. By default the description is "<event>, <location>, <year>"; only fill this in if that reads wrong.' },
    ],
  },
  {
    id: 'scholarship',
    label: 'Scholarship years',
    singular: 'scholarship year',
    file: '_data/scholarship.yml',
    page: '/scholarship.html',
    order: { key: (y) => y.year, dir: 'asc' },
    summary: (y) => ({ title: `${y.year} cohort`,
      meta: `${(y.winners || []).length} winners · ${(y.photos || []).length} photos` }),
    unique: { field: 'year', message: 'That year already exists.' },
    defaults: { winners: [], photos: [] },
    fields: [{ name: 'year', label: 'Year', type: 'year', required: true }],
  },
  {
    id: 'scholarship-winners',
    label: 'Scholarship winners',
    singular: 'winner',
    file: '_data/scholarship.yml',
    page: '/scholarship.html',
    parent: { key: 'year', childKey: 'winners', label: 'Year' },
    summary: (w) => ({ title: w.name, meta: w.affiliation }),
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, help: 'As displayed, including any title, e.g. "Dr. Jane Doe".' },
      { name: 'affiliation', label: 'Affiliation', type: 'text', required: true },
      { name: 'linkedin', label: 'LinkedIn URL', type: 'url' },
    ],
  },
  {
    id: 'scholarship-photos',
    label: 'Scholarship photos',
    singular: 'scholarship photo',
    file: '_data/scholarship.yml',
    page: '/scholarship.html',
    parent: { key: 'year', childKey: 'photos', label: 'Year' },
    summary: (p) => ({ title: p.person, meta: p.event, image: p.photo && `/assets/images/scholarship/${p.photo}` }),
    image: { field: 'photo', dir: 'assets/images/scholarship', maxSide: 1600,
      name: (p, parent) => slug(`${p.person} ${parent.year}`) },
    fields: [
      { name: 'person', label: 'Who is pictured', type: 'text', required: true, help: 'e.g. "Leyna Duong & Jessica Graham".' },
      { name: 'event', label: 'Event', type: 'text', required: true },
      { name: 'location', label: 'Location', type: 'text', required: true, help: 'e.g. "Boston MA, 2025".' },
      { name: 'photo', label: 'Photo', type: 'image', required: true },
      { name: 'alt', label: 'Photo description (alt text)', type: 'text', required: true,
        help: 'A full sentence for screen readers, e.g. "Jane Doe at the Keystone Conference, Santa Fe NM, 2025".' },
      { name: 'wide', label: 'Group shot — span two columns', type: 'checkbox' },
    ],
  },
  {
    id: 'conferences',
    label: 'Conferences',
    singular: 'conference',
    file: '_data/conferences.yml',
    page: '/conferences.html',
    order: { key: (c) => c.start, dir: 'asc' },
    summary: (c) => ({ title: c.name, meta: [c.venue, c.start || 'dates TBA'].filter(Boolean).join(' · ') }),
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'venue', label: 'Venue', type: 'text', required: true },
      { name: 'url', label: 'Website', type: 'url', required: true },
      { name: 'start', label: 'Start date', type: 'date', keepNull: true,
        help: 'Leave blank if the dates are not announced yet, and fill in the "TBA" label below instead.' },
      { name: 'end', label: 'End date', type: 'date', help: 'Leave blank for a one-day meeting.' },
      { name: 'display.month', label: 'TBA label — top line', type: 'text', help: 'Only when there is no start date, e.g. "2026".' },
      { name: 'display.day', label: 'TBA label — big line', type: 'text', help: 'e.g. "TBA".' },
      { name: 'display.year', label: 'TBA label — bottom line', type: 'text' },
    ],
    validate(c) {
      const errors = {};
      if (!c.start && !(c.display && (c.display.month || c.display.day))) {
        errors.start = 'Give a start date, or fill in the TBA label.';
      }
      if (c.start && c.display) errors['display.day'] = 'The TBA label is only used when there is no start date — clear it.';
      if (c.end && !c.start) errors.end = 'An end date needs a start date.';
      if (c.start && c.end && c.end < c.start) errors.end = 'The end date is before the start date.';
      return errors;
    },
  },
  {
    id: 'events',
    label: 'Events',
    singular: 'event',
    file: '_data/events.yml',
    page: '/events.html',
    order: { key: (e) => e.date, dir: 'asc' },
    summary: (e) => ({ title: e.title, meta: [e.type, e.date].filter(Boolean).join(' · ') }),
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'type', label: 'Type', type: 'text', required: true,
        help: 'Free text, e.g. Meetup, Panel, Virtual. The page\'s Type filter is built from these.' },
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'time', label: 'Time', type: 'text', required: true, help: 'e.g. "5:30–8:00 PM".' },
      { name: 'venue', label: 'Venue', type: 'text', required: true },
      { name: 'city', label: 'City', type: 'text', required: true },
      { name: 'details', label: 'Details', type: 'textarea', required: true },
      { name: 'registration', label: 'Registration link', type: 'url', allowMailto: true, allowRelative: true,
        help: 'Optional. Without one, the card offers "Host / Sponsor" instead.' },
      { name: 'featured', label: 'Featured', type: 'checkbox' },
    ],
  },
];

export const BY_ID = Object.fromEntries(COLLECTIONS.map((c) => [c.id, c]));

// Filenames for uploaded photos: ASCII, lowercase, hyphenated, like the
// existing ones ("aacr-orlando-2025.jpg").
export function slug(s) {
  return String(s ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60).replace(/-+$/, '') || 'photo';
}
