#!/usr/bin/env node
// Builds the Clay Oven Square setup site from the live Square catalog export.
// Usage: node build.js [path-to-live-export.csv]
// With no argument it rebuilds from the sanitised data/menu.json already in the repo.

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CSV = process.argv[2];

// ---------------------------------------------------------------- catalog data

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadFromCSV(file) {
  const rows = parseCSV(fs.readFileSync(file, 'utf8')).filter(r => r.length > 5);
  const head = rows[0];
  const col = name => head.indexOf(name);
  return rows.slice(1).map(r => ({
    name: r[col('Item Name')],
    variation: r[col('Variation Name')],
    description: r[col('Description')],
    category: r[col('Categories')],
    price: r[col('Price')],
    alcohol: r[col('Contains Alcohol')] === 'Y',
  }));
}

const dataPath = path.join(ROOT, 'data', 'menu.json');
let rows;
if (CSV) {
  rows = loadFromCSV(CSV);
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  fs.writeFileSync(dataPath, JSON.stringify(rows, null, 1) + '\n');
} else {
  rows = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
}

// Group variation rows back into items. Square emits the description once, on an
// item's first row, so carry it across the group.
function itemsIn(category) {
  const out = [], byName = new Map();
  for (const r of rows) {
    if (r.category !== category) continue;
    let item = byName.get(r.name);
    if (!item) { item = { name: r.name, description: '', prices: [] }; byName.set(r.name, item); out.push(item); }
    if (r.description && !item.description) item.description = r.description;
    item.prices.push({ size: r.variation, price: r.price });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const GROUPS = {
  food: {
    title: 'Food',
    categories: ['Appetizers', 'Tandoori Specialities', 'Seafood Specialities', 'Lamb Specialities',
      'Chicken Wonder', 'Vegetarian Dishes', 'Tandoori Bread / Roti', 'Rice', 'Extras', 'Dessert'],
  },
  drinks: {
    title: 'Drinks',
    categories: ['Beverages', 'Imported Beer', 'Local Beer & Cider', 'Cocktails', 'RTDs', 'Special Coffees'],
  },
  wine: {
    title: 'Wine',
    categories: ['Red Wine', 'White Wine', 'Rosé Wine', 'Sparkling Wine'],
  },
  'happy-hour': {
    title: 'Happy hour',
    categories: ['Happy Hour'],
  },
};

const countRows = cats => rows.filter(r => cats.includes(r.category)).length;
const countItems = cats => new Set(rows.filter(r => cats.includes(r.category)).map(r => r.category + '|' + r.name)).size;
const TOTAL_ITEMS = new Set(rows.map(r => r.category + '|' + r.name)).size;
const TOTAL_ROWS = rows.length;
const TOTAL_CATS = new Set(rows.map(r => r.category)).size;
const TOTAL_ALCOHOL = new Set(rows.filter(r => r.alcohol).map(r => r.name)).size;

// ---------------------------------------------------------------------- markup

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Bumped when the stylesheet changes, so a reader who already has the old page
// cached does not get the old design. Anyone already holding the link matters.
const CSS_VERSION = '2';

const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function money(p) {
  const n = Number(p);
  return Number.isFinite(n) ? '$' + n.toFixed(2) : esc(p);
}

// Each size/price pair is its own no-wrap unit so a three-size wine wraps onto
// two lines on a phone instead of pushing the table sideways.
function priceCell(prices) {
  if (prices.length === 1 && /^(regular)?$/i.test(prices[0].size || '')) return `<span class="pp">${money(prices[0].price)}</span>`;
  return prices
    .map(p => `<span class="pp"><span class="size">${esc(p.size)}</span>&nbsp;${money(p.price)}</span>`)
    .join('<span class="sep" aria-hidden="true">·</span>');
}

// Bottle-only on a reading of the wine card's truncated price columns, not on a
// stated rule. Flagged on the page until the owner confirms.
const UNCONFIRMED = new Set(['Ravenswood Vintners Blend', 'Catena', 'Seghesio Sonoma', 'Daou Paso Robles', 'Cloudy Bay']);

function menuSection(category) {
  const items = itemsIn(category);
  const body = items.map(it => `      <tr>
        <td>${esc(it.name)}${UNCONFIRMED.has(it.name) ? '<span class="tag open">bottle only?</span>' : ''}${it.description ? `<span class="note">${esc(it.description)}</span>` : ''}</td>
        <td class="num">${priceCell(it.prices)}</td>
      </tr>`).join('\n');
  return `  <h2 class="cat" id="${slugify(category)}">${esc(category)}<span class="count">${items.length} item${items.length === 1 ? '' : 's'}</span></h2>
  <table class="menu">
    <tbody>
${body}
    </tbody>
  </table>`;
}

function jumpNav(categories) {
  return `  <nav class="jump" aria-label="Categories on this page">
${categories.map(c => `    <a href="#${slugify(c)}">${esc(c)}</a>`).join('\n')}
  </nav>`;
}

// ------------------------------------------------------- site shape and chrome

// Reading order. Drives the previous/next pager at the foot of every page.
const ORDER = [
  { path: '', label: 'Overview', kicker: 'Clay Oven — Square' },
  { path: 'menu/', label: 'The menu', kicker: 'The menu' },
  { path: 'menu/food/', label: 'Food', kicker: 'The menu' },
  { path: 'menu/drinks/', label: 'Drinks', kicker: 'The menu' },
  { path: 'menu/wine/', label: 'Wine', kicker: 'The menu' },
  { path: 'menu/happy-hour/', label: 'Happy hour', kicker: 'The menu' },
  { path: 'setup/', label: 'The setup', kicker: 'The setup' },
  { path: 'setup/tax/', label: 'Tax', kicker: 'The setup' },
  { path: 'setup/menu/', label: 'How the menu is arranged', kicker: 'The setup' },
  { path: 'setup/till/', label: 'The till', kicker: 'The setup' },
  { path: 'setup/verification/', label: 'How this was checked', kicker: 'The setup' },
  { path: 'open/', label: 'Still open', kicker: 'Still open' },
];

const FOOTER = [
  { title: 'The menu', paths: ['menu/', 'menu/food/', 'menu/drinks/', 'menu/wine/', 'menu/happy-hour/'] },
  { title: 'The setup', paths: ['setup/', 'setup/tax/', 'setup/menu/', 'setup/till/', 'setup/verification/'] },
  { title: 'This report', paths: ['', 'open/'] },
];

const labelOf = p => (ORDER.find(o => o.path === p) || {}).label || p;

function pager(here, up) {
  const i = ORDER.findIndex(o => o.path === here);
  const prev = i > 0 ? ORDER[i - 1] : null;
  const next = i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null;
  if (!prev && !next) return '';
  const cell = (p, dir, cls) => p
    ? `<a class="${cls}" href="${up}${p.path}"><span class="dir">${dir}</span><span class="to">${esc(p.label)}</span></a>`
    : '<span class="empty"></span>';
  return `  <nav class="pager" aria-label="Previous and next page">
    ${cell(prev, '← Previous', 'to-prev')}
    ${cell(next, 'Next →', 'to-next')}
  </nav>`;
}

function siteNav(here, up) {
  return `  <nav class="sitenav" aria-label="All pages">
${FOOTER.map(col => `    <div>
      <h3>${esc(col.title)}</h3>
      <ul class="pages">
${col.paths.map(p => `        <li><a href="${up}${p}"${p === here ? ' aria-current="page"' : ''}>${esc(labelOf(p))}</a></li>`).join('\n')}
      </ul>
    </div>`).join('\n')}
  </nav>`;
}

function page({ file, depth, title, heading, kicker, meta, crumbs = [], body }) {
  const up = '../'.repeat(depth);
  const here = file.replace(/index\.html$/, '');
  const trail = crumbs
    .filter(c => c.href !== '')
    .map((c, i, a) => i === a.length - 1
      ? `<span class="here" aria-current="page">${esc(c.label)}</span>`
      : `<a href="${up}${c.href}">${esc(c.label)}</a>`)
    .join('<span class="slash" aria-hidden="true">/</span>');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#ffffff">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${up}style.css?v=${CSS_VERSION}">
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header>
  <div class="bar">
    <a class="brand" href="${up || './'}"><span class="mark" aria-hidden="true">CO</span><span class="wordmark">Clay Oven</span><span class="sub">Square point of sale</span></a>
    <nav class="crumbs" aria-label="Breadcrumb">${trail || '<span class="here" aria-current="page">Overview</span>'}</nav>
  </div>
</header>
<main id="content">
  <div class="pagehead">
${kicker ? `    <p class="kicker">${esc(kicker)}</p>\n` : ''}    <h1>${esc(heading)}</h1>
${meta ? `    <p class="meta">${meta}</p>\n` : ''}  </div>
${body}
${pager(here, up)}
  <footer class="siteend">
${siteNav(here, up)}
    <p class="colophon">Prepared by Operator for Clay Oven Indian Restaurant. Menu as built in Square on 24 August 2026, generated from the live catalog export.</p>
  </footer>
</main>
</body>
</html>
`;
  const out = path.join(ROOT, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
}

function indexList(items) {
  return `  <ul class="index">
${items.map(i => `    <li><a href="${i.href}"><span class="label">${esc(i.label)}</span><span class="detail">${esc(i.meta)}</span><span class="chev" aria-hidden="true">→</span></a></li>`).join('\n')}
  </ul>`;
}

// ------------------------------------------------------------------- the pages

page({
  file: 'index.html',
  depth: 0,
  title: 'Clay Oven — Square point of sale',
  kicker: 'Build report · 24 August 2026',
  heading: 'Clay Oven — Square point of sale',
  meta: 'Prepared for Clay Oven Indian Restaurant by Paan Waala',
  body: `  <p class="lede">The full menu is in Square, BC tax is applied and verified, happy hour is built, and a till is ready to pair.</p>

  <div class="figures">
    <div><b>${TOTAL_ITEMS}</b><span>items</span></div>
    <div><b>${TOTAL_ROWS}</b><span>price points</span></div>
    <div><b>${TOTAL_CATS}</b><span>categories</span></div>
    <div><b>${TOTAL_ALCOHOL}</b><span>alcohol items</span></div>
  </div>

  <h2>The menu</h2>

  <p>Every button a server will see, in the order the till shows it.</p>
${indexList([
    { href: 'menu/food/', label: 'Food', meta: `${countItems(GROUPS.food.categories)} items` },
    { href: 'menu/drinks/', label: 'Drinks', meta: `${countItems(GROUPS.drinks.categories)} items` },
    { href: 'menu/wine/', label: 'Wine', meta: `${countItems(GROUPS.wine.categories)} items` },
    { href: 'menu/happy-hour/', label: 'Happy hour', meta: `${countItems(GROUPS['happy-hour'].categories)} items` },
  ])}

  <h2>The setup</h2>

  <p>What was built, what was decided, and how it was checked.</p>
${indexList([
    { href: 'setup/tax/', label: 'Tax', meta: 'GST 5% · liquor PST 10%' },
    { href: 'setup/menu/', label: 'How the menu is arranged', meta: 'sizes, channels, happy hour' },
    { href: 'setup/till/', label: 'The till', meta: '1 device code' },
    { href: 'setup/verification/', label: 'How this was checked', meta: 'export and diff' },
  ])}

  <aside class="callout">
    <p><b>One question still needs the owner.</b> Five wines — Ravenswood, Catena, Seghesio, Daou and Cloudy Bay — are built bottle-only. If any are poured by the glass, that is ten missing prices and a minute's work.</p>
    <p class="cta"><a href="open/">See the three open items</a></p>
  </aside>

  <h2>What was done</h2>

  <p>Clay Oven's printed and web menus were transcribed, priced and imported into a new Square catalog, then checked line by line against a fresh export of the live account. BC tax was applied — and Square's own suggested rate was overridden, because it would have been wrong for a restaurant. Happy hour was built as its own screen. One till was registered and is waiting to be paired.</p>

  <p>Six questions the menus could not answer were put to the owner and are now built in. One is still outstanding.</p>`,
});

// ---- menu index

page({
  file: 'menu/index.html',
  depth: 1,
  title: 'The menu — Clay Oven',
  kicker: 'The menu',
  heading: 'The menu',
  meta: `${TOTAL_ITEMS} items · ${TOTAL_ROWS} price points · ${TOTAL_CATS} categories`,
  crumbs: [{ href: '', label: 'Clay Oven — Square' }, { href: 'menu/', label: 'Menu' }],
  body: `  <p class="lede">This is what a server sees on the till, in the order Square shows it. Every price here is generated from the live catalog export, so the page and the till cannot drift apart.</p>
${indexList([
    { href: 'food/', label: 'Food', meta: `${countItems(GROUPS.food.categories)} items` },
    { href: 'drinks/', label: 'Drinks', meta: `${countItems(GROUPS.drinks.categories)} items` },
    { href: 'wine/', label: 'Wine', meta: `${countItems(GROUPS.wine.categories)} items` },
    { href: 'happy-hour/', label: 'Happy hour', meta: `${countItems(GROUPS['happy-hour'].categories)} items` },
  ])}

  <p>Anything sold in more than one size is one button with the sizes behind it, so wines, sangria and the Henkell piccolo do not take up several buttons each.</p>`,
});

for (const [slug, group] of Object.entries(GROUPS)) {
  const notes = {
    food: `<p>Prices as published by Clay Oven. Samosa at $5.95 and Dahi Puri at $9.95 were confirmed by the owner and are not on the printed card.</p>`,
    drinks: `<p>The card's single "Indian Lagers $8.95" line is built as three real buttons — Kingfisher, Taj Mahal and Cobra — on the owner's answer. Every item here carries the 10% liquor PST except Chai Tea.</p>`,
    wine: `<p>Wines with a 6&nbsp;oz and 9&nbsp;oz price are poured by the glass. The five listed with a bottle price only are built bottle-only, read from where the price columns stop on the wine card — the one question the owner has not yet confirmed. They are marked <span class="tag open">bottle only?</span> below.</p>`,
    'happy-hour': `<p>Served 4–6&nbsp;pm. These are separate buttons rather than a second price on each dish, so the normal buttons stay at one tap all day. The till does not switch to these prices by itself; staff tap the Happy Hour screen.</p>`,
  }[slug];
  page({
    file: `menu/${slug}/index.html`,
    depth: 2,
    title: `${group.title} — Clay Oven menu`,
    kicker: 'The menu',
    heading: group.title,
    meta: `${countItems(group.categories)} items · ${countRows(group.categories)} price points`,
    crumbs: [{ href: '', label: 'Clay Oven — Square' }, { href: 'menu/', label: 'Menu' }, { href: `menu/${slug}/`, label: group.title }],
    body: `${notes}\n\n${group.categories.length > 1 ? jumpNav(group.categories) + '\n\n' : ''}${group.categories.map(menuSection).join('\n\n')}`,
  });
}

// ---- setup pages

page({
  file: 'setup/index.html',
  depth: 1,
  title: 'The setup — Clay Oven',
  kicker: 'The setup',
  heading: 'The setup',
  meta: 'What was built, what was decided, and how it was checked',
  crumbs: [{ href: '', label: 'Clay Oven — Square' }, { href: 'setup/', label: 'Setup' }],
  body: indexList([
    { href: 'tax/', label: 'Tax', meta: 'GST 5% · liquor PST 10%' },
    { href: 'menu/', label: 'How the menu is arranged', meta: 'sizes, channels, happy hour' },
    { href: 'till/', label: 'The till', meta: '1 device code' },
    { href: 'verification/', label: 'How this was checked', meta: 'export and diff' },
  ]),
});

page({
  file: 'setup/tax/index.html',
  depth: 2,
  title: 'Tax — Clay Oven',
  kicker: 'The setup',
  heading: 'Tax',
  meta: 'GST 5% on everything · liquor PST 10% on alcohol only',
  crumbs: [{ href: '', label: 'Clay Oven — Square' }, { href: 'setup/', label: 'Setup' }, { href: 'setup/tax/', label: 'Tax' }],
  body: `  <table>
    <thead><tr><th>Tax</th><th>Rate</th><th>Applies to</th></tr></thead>
    <tbody>
      <tr><td>GST</td><td class="num">5%</td><td>Everything, including items added later</td></tr>
      <tr><td>PST — Liquor</td><td class="num">10%</td><td>The ${TOTAL_ALCOHOL} alcohol items only</td></tr>
    </tbody>
  </table>

  <p>A food order rings 5%, a drinks order rings 15%, and a mixed ticket splits per line.</p>

  <h2>Square suggested the wrong rate</h2>

  <p>Its setup wizard proposed 5% federal plus <b>British Columbia 7%</b> on everything. 7% is BC's general PST on goods — restaurant meals are exempt from it and liquor carries 10% instead. Accepting the suggestion would have over-taxed every food item by 7% and under-taxed every drink by 3%. The second rate was renamed, set to 10%, and narrowed to alcohol only.</p>

  <p>Custom amounts inherit GST but not liquor PST, so an open-ring total does not quietly pick up alcohol tax.</p>

  <h2>Taking payments</h2>

  <p>Square's own checklist shows "start taking payments" already ticked from signup. No payment method, bank account or card processing was set up here. If it needs to be genuinely off, that is an account-level decision only the owner can make.</p>`,
});

page({
  file: 'setup/menu/index.html',
  depth: 2,
  title: 'How the menu is arranged — Clay Oven',
  kicker: 'The setup',
  heading: 'How the menu is arranged',
  meta: 'Sizes, channels, happy hour, and the owner’s six answers',
  crumbs: [{ href: '', label: 'Clay Oven — Square' }, { href: 'setup/', label: 'Setup' }, { href: 'setup/menu/', label: 'Arrangement' }],
  body: `  <p>One menu, named Dinner, holding ${TOTAL_CATS} groups that match the categories on the <a href="../../menu/">menu pages</a>.</p>

  <h2>Sizes sit behind one button</h2>

  <p>Anything sold in more than one size is a single button with the sizes behind it, not two buttons:</p>

  <ul>
    <li>Wines poured by the glass — 6&nbsp;oz, 9&nbsp;oz, bottle</li>
    <li>Bottle-only wines — bottle</li>
    <li>Sangria — glass, 500&nbsp;ml</li>
    <li>Henkell Trocken Piccolo — 200&nbsp;ml, 375&nbsp;ml</li>
  </ul>

  <h2>Where the menu appears</h2>

  <p>Points of sale only. Square offers a second channel that publishes the menu to a customer-facing Square Online site; clicking the location row silently selected both, which was caught before saving and turned back off. Putting Clay Oven's menu on a public website is their call, not a side effect of setting up a till.</p>

  <h2>Happy hour is a screen staff tap</h2>

  <p>Square can put hours on a menu group, but its own editor says those hours schedule when a group "can be ordered on online ordering sites, delivery apps, and kiosks". The till is not on that list, and this menu is till-only, so a 4–6&nbsp;pm schedule there would do nothing. Genuinely automatic time-based pricing is Square's automatic-discount feature, which depends on a paid plan and was not touched.</p>

  <h2>Separate buttons, not a second price on each dish</h2>

  <p>A second price on Samosa, Corona, 1516 Lager, Veg. Pakora, Chai Tea, Masala Fries and Dahi Puri would make the till ask "which price?" on every one of those sales, all day, to serve a two-hour window. A <a href="../../menu/happy-hour/">Happy Hour category</a> keeps the normal buttons at one tap. The cost is that samosa sales report on two lines instead of one, and deleting one category reverses it.</p>

  <h2>The owner's answers</h2>

  <table>
    <thead><tr><th>Question</th><th>Answer</th><th>Built</th></tr></thead>
    <tbody>
      <tr><td>Samosa price</td><td>$5.95 regular</td><td>Added to Appetizers</td></tr>
      <tr><td>Chai Tea, Masala Fries, Dahi Puri</td><td>$4.95, $5.95, $9.95</td><td>Three items; Chai Tea opened a new Beverages category</td></tr>
      <tr><td>Which Indian lagers</td><td>Kingfisher, Taj Mahal, Cobra</td><td>The vague "Indian Lagers" button is gone — three real buttons at $8.95</td></tr>
      <tr><td>Biryani at $21.99</td><td>Correct as published</td><td>Unchanged</td></tr>
      <tr><td>Missing seventh Tandoori dish</td><td>One was taken off the menu</td><td>Unchanged; six is right</td></tr>
      <tr><td>House Red and House White</td><td>Changes daily, told to guests verbally</td><td>Generic $6 buttons reading "ask the server for today's wine"</td></tr>
    </tbody>
  </table>`,
});

page({
  file: 'setup/till/index.html',
  depth: 2,
  title: 'The till — Clay Oven',
  kicker: 'The setup',
  heading: 'The till',
  meta: 'One device code, registered and waiting to pair',
  crumbs: [{ href: '', label: 'Clay Oven — Square' }, { href: 'setup/', label: 'Setup' }, { href: 'setup/till/', label: 'Till' }],
  body: `  <p>One device code, named <code>Clay Oven POS 1</code>, unpaired and waiting. Install Square Point of Sale, tap sign in, choose "use a device code", type it in. The code is a credential and was sent privately; it can be revoked and reissued at any time.</p>

  <p>Standard mode was chosen deliberately. Quick Service, Full Service and Bar are Square for Restaurants modes and selecting one can pull the account onto a paid plan. Standard is free and rings orders fine. The mode can be changed later without a new code.</p>`,
});

page({
  file: 'setup/verification/index.html',
  depth: 2,
  title: 'How this was checked — Clay Oven',
  kicker: 'The setup',
  heading: 'How this was checked',
  meta: 'The live catalog exported back out of Square and diffed line by line',
  crumbs: [{ href: '', label: 'Clay Oven — Square' }, { href: 'setup/', label: 'Setup' }, { href: 'setup/verification/', label: 'Verification' }],
  body: `  <p>Not by trusting Square's green success banner. After every change the live catalog was exported back out of Square and compared line by line against what was meant to be there.</p>

  <p class="status ok"><span class="dot" aria-hidden="true"></span>Exact match — 0 differences across ${TOTAL_ROWS} price points</p>

<pre><code>expected rows: 151   live rows: 151
expected items: 129  live items: 129
live categories: 21
missing from Square: 0
unexpected extras: 0
price mismatches: 0
category mismatches: 0
alcohol items expected: 50  live: 50
liquor PST missing: 0       liquor PST unexpected: 0
RESULT: exact match</code></pre>

  <p>GST does not appear in the export because it is a blanket rule rather than a per-item tag — which is what it should be, since new items inherit it. It was confirmed on the items instead: Butter Chicken carries GST only, Corona carries both taxes.</p>

  <p>Every price on these <a href="../../menu/">menu pages</a> is generated from that same export, so what you read here is what the till will ring.</p>`,
});

page({
  file: 'open/index.html',
  depth: 1,
  title: 'Still open — Clay Oven',
  kicker: 'Still open',
  heading: 'Still open',
  meta: 'Three items — one needs an answer, two need a decision',
  crumbs: [{ href: '', label: 'Clay Oven — Square' }, { href: 'open/', label: 'Still open' }],
  body: `  <h2>Wine by the glass <span class="tag open">needs the owner</span></h2>

  <p>Ravenswood, Catena, Seghesio, Daou and Cloudy Bay are built bottle-only, read from where the price columns stop on the wine card. If any of them are poured by the glass, that is ten missing prices — a minute's work once the 6&nbsp;oz and 9&nbsp;oz figures arrive. They are marked on the <a href="../menu/wine/">wine page</a>.</p>

  <h2>A price refresh is coming <span class="tag">expected</span></h2>

  <blockquote>We are going to update the in house menus then we can update on the pos.</blockquote>

  <h2>Taking payments <span class="tag open">owner decision</span></h2>

  <p>Square's own checklist shows "start taking payments" already ticked from signup. No payment method, bank account or card processing was set up here. If it needs to be genuinely off, that is an account-level decision only the owner can make.</p>`,
});

// ------------------------------------------------------------------ stylesheet

fs.writeFileSync(path.join(ROOT, 'style.css'), `:root {
  --bg: #ffffff;
  --paper: #faf8f6;
  --fg: #14120f;
  --muted: #6b6862;
  --faint: #9b978f;
  --line: #e6e2dc;
  --line-soft: #f0ece6;
  --accent: #a2451c;
  --accent-ink: #7f3413;
  --accent-soft: #fbf1ea;
  --accent-line: #e8cdb9;
  --radius: 12px;
  --wrap: 46rem;
  --pad: 1.5rem;
}
* { box-sizing: border-box; }
html {
  -webkit-text-size-adjust: 100%;
  color-scheme: light;
  scroll-behavior: smooth;
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.65 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  touch-action: manipulation;
}

/* ------------------------------------------------------------------ chrome */

.skip {
  position: absolute;
  left: -9999px;
}
.skip:focus {
  position: fixed;
  left: 0.75rem;
  top: 0.75rem;
  z-index: 20;
  background: var(--fg);
  color: #fff;
  padding: 0.6rem 0.9rem;
  border-radius: 8px;
  font-size: 0.875rem;
  text-decoration: none;
}
header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: saturate(180%) blur(10px);
  -webkit-backdrop-filter: saturate(180%) blur(10px);
  border-bottom: 1px solid var(--line);
}
header .bar {
  max-width: var(--wrap);
  margin: 0 auto;
  padding: 0.75rem max(var(--pad), env(safe-area-inset-right)) 0.75rem max(var(--pad), env(safe-area-inset-left));
  display: flex;
  align-items: center;
  gap: 0.875rem;
  min-height: 3.5rem;
}
.brand {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  text-decoration: none;
  color: var(--fg);
  border-radius: 8px;
}
.brand .mark {
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  flex: none;
  border-radius: 7px;
  background: linear-gradient(160deg, #b9552a, var(--accent-ink));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 1px 2px rgba(20, 18, 15, 0.18);
  color: #fff;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.brand .wordmark { font-size: 0.9375rem; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; }
.brand .sub { color: var(--muted); font-size: 0.8125rem; white-space: nowrap; }
.brand:hover .wordmark { color: var(--accent); }
.crumbs {
  margin-left: auto;
  font-size: 0.8125rem;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.crumbs a { color: var(--muted); text-decoration: none; }
.crumbs a:hover { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
.crumbs .here { color: var(--fg); }
.crumbs .slash { color: var(--faint); margin: 0 0.4rem; }

main {
  max-width: var(--wrap);
  margin: 0 auto;
  padding: 4rem max(var(--pad), env(safe-area-inset-right)) 5rem max(var(--pad), env(safe-area-inset-left));
}

/* -------------------------------------------------------------- typography */

.pagehead { margin: 0 0 2.25rem; }
.kicker {
  margin: 0 0 0.75rem;
  font-size: 0.6875rem;
  font-weight: 650;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: var(--accent);
}
h1 {
  font-size: clamp(1.75rem, 1.35rem + 1.7vw, 2.375rem);
  line-height: 1.15;
  letter-spacing: -0.025em;
  font-weight: 650;
  margin: 0;
  text-wrap: balance;
}
.pagehead .meta { margin: 0.75rem 0 0; }
h2 {
  font-size: 1.1875rem;
  letter-spacing: -0.015em;
  font-weight: 650;
  margin: 3.25rem 0 1rem;
  scroll-margin-top: 5.5rem;
  text-wrap: balance;
}
h2::before {
  content: "";
  display: block;
  width: 1.75rem;
  height: 2px;
  border-radius: 2px;
  background: var(--accent);
  opacity: 0.85;
  margin-bottom: 0.875rem;
}
h2.cat::before { display: none; }
p { margin: 0 0 1.25rem; text-wrap: pretty; }
.meta { color: var(--muted); font-size: 0.875rem; }
.lede {
  font-size: 1.125rem;
  line-height: 1.55;
  letter-spacing: -0.005em;
  color: #33302b;
  max-width: 36rem;
  margin-bottom: 2rem;
}
.sep { color: var(--faint); margin: 0 0.4rem; }

/* Inline links read as links: accent, underlined, offset. */
main p a, main li a, main td a, main blockquote a {
  color: var(--accent);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.18em;
  text-decoration-color: var(--accent-line);
  border-radius: 3px;
}
main p a:hover, main li a:hover, main td a:hover {
  color: var(--accent-ink);
  text-decoration-color: currentColor;
}
a:focus-visible, button:focus-visible, [tabindex]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  border-radius: 4px;
}

/* ------------------------------------------------------------ stat tiles */

.figures {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.625rem;
  margin: 0 0 1rem;
  padding: 0;
  list-style: none;
}
.figures div {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 0.875rem 1rem 1rem;
  min-width: 0;
}
.figures b {
  display: block;
  font-size: 1.625rem;
  line-height: 1.1;
  font-weight: 650;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}
.figures span {
  display: block;
  color: var(--muted);
  font-size: 0.8125rem;
  line-height: 1.3;
  margin-top: 0.35rem;
}

/* ------------------------------------------------------------ index rows */

ul.index {
  list-style: none;
  margin: 1.25rem 0 1.75rem;
  padding: 0;
  border-top: 1px solid var(--line);
}
ul.index li {
  margin: 0;
  padding: 0;
  border-bottom: 1px solid var(--line);
}
ul.index li a {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  min-height: 3.25rem;
  padding: 0.75rem;
  margin: 0 -0.75rem;
  border-radius: 10px;
  color: var(--fg);
  text-decoration: none;
  font-weight: 550;
  transition: background-color 0.15s ease, color 0.15s ease;
}
ul.index li a:hover { background: var(--paper); color: var(--accent); }
ul.index .label { min-width: 0; }
ul.index .detail {
  margin-left: auto;
  color: var(--muted);
  font-size: 0.8125rem;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
ul.index .chev {
  flex: none;
  color: var(--faint);
  transition: transform 0.15s ease, color 0.15s ease;
}
ul.index li a:hover .chev { color: var(--accent); transform: translateX(3px); }

/* --------------------------------------------------------- category jump */

.jump {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0 0 2.5rem;
  padding: 0;
}
.jump a {
  display: inline-flex;
  align-items: center;
  min-height: 2.25rem;
  padding: 0 0.75rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: #fff;
  color: var(--muted);
  font-size: 0.8125rem;
  text-decoration: none;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.jump a:hover { background: var(--accent-soft); border-color: var(--accent-line); color: var(--accent); }

/* ------------------------------------------------------------- callout */

.callout {
  background: var(--accent-soft);
  border: 1px solid var(--accent-line);
  border-radius: var(--radius);
  padding: 1.125rem 1.25rem 1.25rem;
  margin: 2.5rem 0 0;
}
.callout p { margin: 0; }
.callout b { color: var(--accent-ink); }
.callout .cta { margin-top: 0.75rem; font-size: 0.9375rem; }

/* -------------------------------------------------------------- tables */

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9375rem;
  margin: 0 0 1.25rem;
}
th {
  text-align: left;
  font-weight: 600;
  color: var(--muted);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0 1rem 0.625rem 0;
  border-bottom: 1px solid var(--line);
}
td {
  padding: 0.75rem 1rem 0.75rem 0;
  border-bottom: 1px solid var(--line-soft);
  vertical-align: top;
}
th:last-child, td:last-child { padding-right: 0; }
td.num { font-variant-numeric: tabular-nums; }
h2.cat {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin-top: 2.75rem;
  font-size: 1.0625rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--line);
}
h2.cat .count {
  margin-left: auto;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--faint);
  white-space: nowrap;
}
table.menu { margin-top: 0.25rem; }
table.menu td { padding: 0.8125rem 1rem 0.8125rem 0; }
table.menu td.num {
  text-align: right;
  font-weight: 550;
  width: 1%;
}
table.menu .pp { white-space: nowrap; }
table.menu .note {
  display: block;
  color: var(--muted);
  font-size: 0.8125rem;
  line-height: 1.45;
  margin-top: 0.2rem;
}
table.menu .size { color: var(--muted); font-size: 0.8125rem; font-weight: 400; }

/* ---------------------------------------------------- lists and blocks */

main ul:not(.index):not(.jump):not(.pages) { margin: 0 0 1.25rem; padding-left: 1.1rem; }
main ul:not(.index):not(.jump):not(.pages) li { margin-bottom: 0.5rem; }
li::marker { color: var(--accent); }
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.875em;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 0.1em 0.35em;
}
pre {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 1.125rem 1.25rem;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8125rem;
  line-height: 1.7;
  margin: 0 0 1.25rem;
}
pre code { background: none; border: 0; padding: 0; font-size: inherit; }
blockquote {
  margin: 0 0 1.25rem;
  padding: 0.25rem 0 0.25rem 1.125rem;
  border-left: 2px solid var(--accent-line);
  color: var(--muted);
  font-style: italic;
}
.tag {
  display: inline-block;
  font-size: 0.75rem;
  line-height: 1.5;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--muted);
  vertical-align: 0.1em;
  margin-left: 0.5rem;
  font-weight: 500;
  font-style: normal;
  white-space: nowrap;
}
.tag.open {
  color: var(--accent-ink);
  border-color: var(--accent-line);
  background: var(--accent-soft);
}
.status {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  border: 1px solid var(--line);
  background: var(--paper);
  border-radius: var(--radius);
  padding: 0.75rem 1rem;
  font-size: 0.9375rem;
  font-weight: 550;
}
.status .dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  flex: none;
  background: #1a7f4b;
  box-shadow: 0 0 0 3px rgba(26, 127, 75, 0.15);
}

/* --------------------------------------------------------------- pager */

.pager {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  margin: 4rem 0 0;
}
.pager a {
  display: block;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 0.875rem 1rem;
  text-decoration: none;
  color: var(--fg);
  background: #fff;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.pager a:hover { background: var(--paper); border-color: var(--accent-line); }
.pager .dir {
  display: block;
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 0.25rem;
}
.pager .to { font-size: 0.9375rem; font-weight: 550; }
.pager a:hover .to { color: var(--accent); }
.pager .to-next { text-align: right; }

/* ------------------------------------------------------------- footer */

.siteend {
  margin-top: 3.5rem;
  padding-top: 2rem;
  border-top: 1px solid var(--line);
}
.sitenav {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 1.75rem 1.5rem;
  margin-bottom: 2rem;
}
.sitenav h3 {
  margin: 0 0 0.5rem;
  font-size: 0.6875rem;
  font-weight: 650;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--faint);
}
.sitenav ul { list-style: none; margin: 0; padding: 0; }
.sitenav li { margin: 0; }
.sitenav a {
  display: block;
  padding: 0.3rem 0;
  font-size: 0.875rem;
  color: var(--muted);
  text-decoration: none;
}
.sitenav a:hover { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
.sitenav a[aria-current="page"] { color: var(--fg); font-weight: 550; }
.colophon { color: var(--faint); font-size: 0.8125rem; margin: 0; }

/* ------------------------------------------------------------ responsive */

@media (max-width: 700px) {
  main { padding-top: 2.75rem; padding-bottom: 3.5rem; }
  :root { --pad: 1.125rem; }
  .brand .sub { display: none; }
  .crumbs { font-size: 0.75rem; }
  .figures { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .figures div { padding: 0.75rem 0.875rem 0.875rem; }
  .figures b { font-size: 1.5rem; }
  /* Row links stack: title and chevron on one line, the detail under it. */
  ul.index li a { flex-wrap: wrap; gap: 0.5rem 0.875rem; }
  ul.index .label { flex: 1 1 auto; }
  ul.index .chev { order: 2; margin-left: auto; }
  ul.index .detail {
    order: 3;
    flex: 1 0 100%;
    margin: -0.15rem 0 0;
    text-align: left;
  }
  .pager { grid-template-columns: 1fr; }
  .pager .to-next { text-align: left; }
  .pager .empty { display: none; }
  /* Sizes stack cleanly instead of running off the side of the phone. */
  table.menu td.num { text-align: right; }
  table.menu td.num .sep { display: none; }
  table.menu .pp { display: block; line-height: 1.5; }
  h2 { margin-top: 2.75rem; }
}
@media (max-width: 380px) {
  .figures { gap: 0.5rem; }
  .figures b { font-size: 1.375rem; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  * { transition: none !important; animation: none !important; }
}

/* ---------------------------------------------------------------- print */

@media print {
  header, .pager, .sitenav, .skip, .jump, .callout { display: none !important; }
  main { max-width: none; padding: 0; }
  a { color: inherit !important; text-decoration: none !important; }
  h2 { break-after: avoid; }
  h2::before { display: none; }
  tr, .figures div { break-inside: avoid; }
  .siteend { border-top: 1px solid #ccc; }
}
`);

fs.writeFileSync(path.join(ROOT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');

console.log(`built ${TOTAL_ITEMS} items / ${TOTAL_ROWS} price points / ${TOTAL_CATS} categories / ${TOTAL_ALCOHOL} alcohol items`);
