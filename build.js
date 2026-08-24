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

function money(p) {
  const n = Number(p);
  return Number.isFinite(n) ? '$' + n.toFixed(2) : esc(p);
}

function priceCell(prices) {
  if (prices.length === 1 && /^(regular)?$/i.test(prices[0].size || '')) return money(prices[0].price);
  return prices.map(p => `<span class="size">${esc(p.size)}</span>&nbsp;${money(p.price)}`).join('<span class="sep">·</span>');
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
  return `  <h2 id="${category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}">${esc(category)}</h2>
  <table class="menu">
    <tbody>
${body}
    </tbody>
  </table>`;
}

function page({ file, depth, title, heading, meta, crumbs = [], body }) {
  const up = '../'.repeat(depth);
  const trail = crumbs.map(c => `<a href="${up}${c.href}">${esc(c.label)}</a>`).join('<span class="sep">/</span>');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${up}style.css">
</head>
<body>
<header>
  <nav>${trail || '<span class="here">Clay Oven — Square</span>'}</nav>
</header>
<main>
  <h1>${esc(heading)}</h1>
${meta ? `  <p class="meta">${meta}</p>\n` : ''}${body}
  <hr>
  <footer>Prepared by Operator for Clay Oven Indian Restaurant. Menu as built in Square on 24 August 2026.</footer>
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
${items.map(i => `    <li><a href="${i.href}">${esc(i.label)}</a><span>${esc(i.meta)}</span></li>`).join('\n')}
  </ul>`;
}

// ------------------------------------------------------------------- the pages

page({
  file: 'index.html',
  depth: 0,
  title: 'Clay Oven — Square point of sale',
  heading: 'Clay Oven — Square point of sale',
  meta: 'Built 24 August 2026 · Paan Waala',
  body: `  <p class="lede">The full menu is in Square, BC tax is applied and verified, happy hour is built, and a till is ready to pair.</p>

  <div class="figures">
    <div><b>${TOTAL_ITEMS}</b><span>items</span></div>
    <div><b>${TOTAL_ROWS}</b><span>price points</span></div>
    <div><b>${TOTAL_CATS}</b><span>categories</span></div>
    <div><b>${TOTAL_ALCOHOL}</b><span>alcohol items</span></div>
  </div>

  <h2>The menu</h2>
${indexList([
    { href: 'menu/food/', label: 'Food', meta: `${countItems(GROUPS.food.categories)} items` },
    { href: 'menu/drinks/', label: 'Drinks', meta: `${countItems(GROUPS.drinks.categories)} items` },
    { href: 'menu/wine/', label: 'Wine', meta: `${countItems(GROUPS.wine.categories)} items` },
    { href: 'menu/happy-hour/', label: 'Happy hour', meta: `${countItems(GROUPS['happy-hour'].categories)} items` },
  ])}

  <h2>The setup</h2>
${indexList([
    { href: 'setup/tax/', label: 'Tax', meta: 'GST 5% · liquor PST 10%' },
    { href: 'setup/menu/', label: 'How the menu is arranged', meta: 'sizes, channels, happy hour' },
    { href: 'setup/till/', label: 'The till', meta: '1 device code' },
    { href: 'setup/verification/', label: 'How this was checked', meta: 'export and diff' },
    { href: 'open/', label: 'Still open', meta: '3 items' },
  ])}

  <h2>What was done</h2>

  <p>Clay Oven's printed and web menus were transcribed, priced and imported into a new Square catalog, then checked line by line against a fresh export of the live account. BC tax was applied — and Square's own suggested rate was overridden, because it would have been wrong for a restaurant. Happy hour was built as its own screen. One till was registered and is waiting to be paired.</p>

  <p>Six questions the menus could not answer were put to the owner and are now built in. One is still outstanding.</p>`,
});

// ---- menu index

page({
  file: 'menu/index.html',
  depth: 1,
  title: 'The menu — Clay Oven',
  heading: 'The menu',
  meta: `${TOTAL_ITEMS} items · ${TOTAL_ROWS} price points · ${TOTAL_CATS} categories`,
  crumbs: [{ href: '', label: 'Clay Oven — Square' }, { href: 'menu/', label: 'Menu' }],
  body: `${indexList([
    { href: 'food/', label: 'Food', meta: `${countItems(GROUPS.food.categories)} items` },
    { href: 'drinks/', label: 'Drinks', meta: `${countItems(GROUPS.drinks.categories)} items` },
    { href: 'wine/', label: 'Wine', meta: `${countItems(GROUPS.wine.categories)} items` },
    { href: 'happy-hour/', label: 'Happy hour', meta: `${countItems(GROUPS['happy-hour'].categories)} items` },
  ])}

  <p>This is what a server sees on the till, in the order Square shows it. Anything sold in more than one size is one button with the sizes behind it, so wines, sangria and the Henkell piccolo do not take up several buttons each.</p>`,
});

for (const [slug, group] of Object.entries(GROUPS)) {
  const notes = {
    food: `<p>Prices as published by Clay Oven. Samosa at $5.95 and Dahi Puri at $9.95 were confirmed by the owner and are not on the printed card.</p>`,
    drinks: `<p>The card's single "Indian Lagers $8.95" line is built as three real buttons — Kingfisher, Taj Mahal and Cobra — on the owner's answer. Every item here carries the 10% liquor PST except Chai Tea.</p>`,
    wine: `<p>Wines with a 6&nbsp;oz and 9&nbsp;oz price are poured by the glass. The five listed with a bottle price only are built bottle-only, read from where the price columns stop on the wine card — the one question the owner has not yet confirmed.</p>`,
    'happy-hour': `<p>Served 4–6&nbsp;pm. These are separate buttons rather than a second price on each dish, so the normal buttons stay at one tap all day. The till does not switch to these prices by itself; staff tap the Happy Hour screen.</p>`,
  }[slug];
  page({
    file: `menu/${slug}/index.html`,
    depth: 2,
    title: `${group.title} — Clay Oven menu`,
    heading: group.title,
    meta: `${countItems(group.categories)} items · ${countRows(group.categories)} price points`,
    crumbs: [{ href: '', label: 'Clay Oven — Square' }, { href: 'menu/', label: 'Menu' }, { href: `menu/${slug}/`, label: group.title }],
    body: `${notes}\n\n${group.categories.map(menuSection).join('\n\n')}`,
  });
}

// ---- setup pages

page({
  file: 'setup/index.html',
  depth: 1,
  title: 'The setup — Clay Oven',
  heading: 'The setup',
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
  heading: 'Tax',
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
  heading: 'How the menu is arranged',
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
  heading: 'The till',
  crumbs: [{ href: '', label: 'Clay Oven — Square' }, { href: 'setup/', label: 'Setup' }, { href: 'setup/till/', label: 'Till' }],
  body: `  <p>One device code, named <code>Clay Oven POS 1</code>, unpaired and waiting. Install Square Point of Sale, tap sign in, choose "use a device code", type it in. The code is a credential and was sent privately; it can be revoked and reissued at any time.</p>

  <p>Standard mode was chosen deliberately. Quick Service, Full Service and Bar are Square for Restaurants modes and selecting one can pull the account onto a paid plan. Standard is free and rings orders fine. The mode can be changed later without a new code.</p>`,
});

page({
  file: 'setup/verification/index.html',
  depth: 2,
  title: 'How this was checked — Clay Oven',
  heading: 'How this was checked',
  crumbs: [{ href: '', label: 'Clay Oven — Square' }, { href: 'setup/', label: 'Setup' }, { href: 'setup/verification/', label: 'Verification' }],
  body: `  <p>Not by trusting Square's green success banner. After every change the live catalog was exported back out of Square and compared line by line against what was meant to be there.</p>

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

  <p>Every price on these menu pages is generated from that same export, so what you read here is what the till will ring.</p>`,
});

page({
  file: 'open/index.html',
  depth: 1,
  title: 'Still open — Clay Oven',
  heading: 'Still open',
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
  --fg: #0a0a0a;
  --muted: #737373;
  --faint: #a3a3a3;
  --line: #eaeaea;
  --soft: #fafafa;
  --accent: #b45309;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.65 ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
header {
  border-bottom: 1px solid var(--line);
  background: var(--bg);
}
header nav {
  max-width: 44rem;
  margin: 0 auto;
  padding: 1.125rem 1.5rem;
  font-size: 0.8125rem;
  color: var(--muted);
}
header nav a { color: var(--muted); border: 0; }
header nav a:hover { color: var(--fg); }
header nav a:last-child { color: var(--fg); }
header .here { color: var(--fg); }
main {
  max-width: 44rem;
  margin: 0 auto;
  padding: 5rem 1.5rem 8rem;
}
h1 {
  font-size: 1.75rem;
  line-height: 1.25;
  letter-spacing: -0.02em;
  font-weight: 600;
  margin: 0 0 2.5rem;
}
h2 {
  font-size: 1.25rem;
  letter-spacing: -0.015em;
  font-weight: 600;
  margin: 4rem 0 1.25rem;
}
h1 + .meta { margin: -2rem 0 2.5rem; }
p { margin: 0 0 1.25rem; }
a { color: inherit; text-decoration: none; border-bottom: 1px solid var(--line); }
a:hover { border-color: var(--muted); }
.meta { color: var(--muted); font-size: 0.875rem; }
.lede { font-size: 1.0625rem; max-width: 38rem; }
.sep { color: var(--faint); margin: 0 0.5rem; }
.figures {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 2rem 1.5rem;
  margin: 3rem 0 0;
  padding: 2rem 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.figures b {
  display: block;
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.figures span {
  display: block;
  color: var(--muted);
  font-size: 0.8125rem;
  margin-top: 0.25rem;
}
ul.index {
  list-style: none;
  margin: 0 0 1.25rem;
  padding: 0;
  border-top: 1px solid var(--line);
}
ul.index li {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
  border-bottom: 1px solid var(--line);
  margin: 0;
  padding: 0;
}
ul.index li a {
  flex: 1;
  border: 0;
  padding: 0.875rem 0;
  font-weight: 500;
}
ul.index li a:hover { color: var(--accent); }
ul.index li span { color: var(--muted); font-size: 0.8125rem; }
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9375rem;
  margin: 0 0 1.25rem;
}
th {
  text-align: left;
  font-weight: 500;
  color: var(--muted);
  font-size: 0.8125rem;
  padding: 0 1rem 0.625rem 0;
  border-bottom: 1px solid var(--line);
}
td {
  padding: 0.75rem 1rem 0.75rem 0;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}
th:last-child, td:last-child { padding-right: 0; }
td.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
table.menu td { padding: 0.8125rem 1rem 0.8125rem 0; }
table.menu td.num { text-align: right; }
table.menu .note {
  display: block;
  color: var(--muted);
  font-size: 0.8125rem;
  margin-top: 0.15rem;
}
table.menu .size { color: var(--muted); font-size: 0.8125rem; }
ul { margin: 0 0 1.25rem; padding-left: 1.1rem; }
li { margin-bottom: 0.5rem; }
li::marker { color: var(--muted); }
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.875em;
  background: var(--soft);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0.1em 0.35em;
}
pre {
  background: var(--soft);
  border: 1px solid var(--line);
  border-radius: 8px;
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
  padding-left: 1.125rem;
  border-left: 2px solid var(--line);
  color: var(--muted);
}
.tag {
  display: inline-block;
  font-size: 0.75rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--muted);
  vertical-align: 0.15em;
  margin-left: 0.5rem;
  font-weight: 500;
}
.tag.open { color: var(--accent); border-color: #f0d5b4; }
hr { border: 0; border-top: 1px solid var(--line); margin: 4rem 0 0; }
footer { color: var(--muted); font-size: 0.8125rem; margin-top: 2rem; }
@media (max-width: 640px) {
  main { padding: 3rem 1.25rem 5rem; }
  header nav { padding: 1rem 1.25rem; }
  .figures { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.75rem 1.5rem; }
}
`);

fs.writeFileSync(path.join(ROOT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');

console.log(`built ${TOTAL_ITEMS} items / ${TOTAL_ROWS} price points / ${TOTAL_CATS} categories / ${TOTAL_ALCOHOL} alcohol items`);
