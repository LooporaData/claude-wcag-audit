// Renders results.json from audit.mjs as a single self-contained HTML report.
// No external requests; works offline, light and dark, and is itself built to
// pass the audit (landmarks, skip link, labelled controls, focus styles).
import { buildModel, RESULT_LABEL, VERDICT_LABEL, path } from './report.mjs';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const slug = s => s.toLowerCase().replace(/[(),]/g, '').trim().replace(/[\s/]+/g, '-');
const understanding = c => `https://www.w3.org/WAI/WCAG22/Understanding/${slug(c.name)}`;
const gid = check => 'g-' + check.replace(/[^a-z0-9]+/gi, '-');

const RESULT_ORDER = ['fail', 'likely', 'review', 'pass-good', 'pass-partial', 'manual', 'na'];
const RESULT_SHORT = { fail: 'Fail', likely: 'Likely fail', review: 'Review', 'pass-good': 'Passed', 'pass-partial': 'Passed (partial)', manual: 'Manual', na: 'N/A', bp: 'Best practice' };
const VERDICT_CHIP = { confirmed: 'fail', 'false-positive': 'na', 'no-issue': 'pass-good', decision: 'review' };
const statusChips = g => g.status === 'resolved'
  ? chip(VERDICT_CHIP[g.verdict] || 'na', VERDICT_LABEL[g.verdict])
  : chip(g.status) + (g.verdict && g.verdict !== 'decision' ? ' ' + chip(VERDICT_CHIP[g.verdict], VERDICT_LABEL[g.verdict]) : g.verdict === 'decision' ? ' ' + chip('review', 'Needs a decision') : '');
const chip = (k, label) => `<span class="chip chip--${esc(k)}">${esc(label || RESULT_SHORT[k] || k)}</span>`;

const CSS = `
:root{--bg:#fbfbfa;--surface:#fff;--surface-2:#f3f4f6;--text:#1b2230;--muted:#525c6e;--border:#d9dde4;--accent:#2c4fb3;--focus:#2c4fb3;
--fail:#b42318;--fail-bg:#fdecea;--likely:#9a3f07;--likely-bg:#fff3e0;--review:#5b3cc4;--review-bg:#f1edff;--pass-good:#05603a;--pass-good-bg:#e6f6ec;
--pass-partial:#226147;--pass-partial-bg:#eef6f1;--manual:#414b5c;--manual-bg:#eceff3;--na:#5a6372;--na-bg:#f4f5f7;--bp:#1d4f99;--bp-bg:#e9f1fd;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#12151b;--surface:#1a1e26;--surface-2:#232833;--text:#e7eaf0;--muted:#a8b0be;--border:#343b48;--accent:#8fb0ff;--focus:#8fb0ff;
--fail:#ffb4ab;--fail-bg:#3d1a17;--likely:#ffc58a;--likely-bg:#3a2510;--review:#cbbcff;--review-bg:#2a2245;--pass-good:#8fe0b0;--pass-good-bg:#11301f;--pass-partial:#a6d8bb;--pass-partial-bg:#172a20;
--manual:#c3cad6;--manual-bg:#2a303b;--na:#aab2bf;--na-bg:#22272f;--bp:#a9c7ff;--bp-bg:#172640;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px;border-radius:3px}
.skip{position:absolute;left:-9999px;top:8px;background:var(--surface);color:var(--text);padding:8px 12px;border:2px solid var(--focus);z-index:10}
.skip:focus{left:16px}
.wrap{max-width:1120px;margin:0 auto;padding:0 16px}
header.top{border-bottom:1px solid var(--border);background:var(--surface)}
header.top .wrap{padding-top:28px;padding-bottom:20px}
h1{font-size:1.75rem;line-height:1.2;margin:0 0 6px}
h2{font-size:1.35rem;margin:40px 0 12px;padding-top:8px}
h3{font-size:1.08rem;margin:0}
.meta{color:var(--muted);margin:0;font-size:.95rem}
nav.toc ul{list-style:none;display:flex;flex-wrap:wrap;gap:6px 18px;padding:0;margin:14px 0 0}
.lead{font-size:1.05rem;max-width:72ch}
.note{color:var(--muted);max-width:72ch}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin:16px 0}
.tile{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px}
.tile b{display:block;font-size:1.6rem;line-height:1.1;font-variant-numeric:tabular-nums}
.tile span{color:var(--muted);font-size:.9rem}
.tile--fail{border-left:5px solid var(--fail)}.tile--likely{border-left:5px solid var(--likely)}.tile--review{border-left:5px solid var(--review)}
.tile--pass-good,.tile--pass-partial{border-left:5px solid var(--pass-good)}.tile--manual,.tile--na{border-left:5px solid var(--manual)}
.bar{display:flex;height:14px;border-radius:7px;overflow:hidden;border:1px solid var(--border);margin:6px 0 4px}
.bar span{display:block;height:100%}
.chip{display:inline-block;font-size:.78rem;font-weight:600;line-height:1.3;padding:2px 8px;border-radius:999px;white-space:nowrap}
${['fail', 'likely', 'review', 'pass-good', 'pass-partial', 'manual', 'na', 'bp'].map(k => `.chip--${k}{color:var(--${k});background:var(--${k}-bg)}.bar .seg--${k}{background:var(--${k})}`).join('')}
.toolbar{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
.toolbar button,.btn{font:inherit;font-size:.9rem;padding:5px 12px;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;min-height:32px}
.toolbar button[aria-pressed=true]{background:var(--text);color:var(--bg);border-color:var(--text)}
.scroll{overflow-x:auto;border:1px solid var(--border);border-radius:10px;background:var(--surface)}
table{border-collapse:collapse;width:100%;font-size:.93rem}
caption{text-align:left;padding:10px 12px;color:var(--muted)}
th,td{text-align:left;padding:8px 12px;border-top:1px solid var(--border);vertical-align:top}
thead th{background:var(--surface-2);border-top:0;white-space:nowrap}
td.num{font-variant-numeric:tabular-nums}
tr[hidden]{display:none}
.how{color:var(--muted);font-size:.85rem}
.finding{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin:12px 0}
.finding--fail,.finding--likely{border-left:5px solid var(--fail)}.finding--likely{border-left-color:var(--likely)}
.finding--review{border-left:5px solid var(--review)}.finding--resolved{border-left:5px solid var(--na);opacity:.92}
.verify{background:var(--surface-2);padding:6px 10px;border-radius:6px}.finding--bp{border-left:5px solid var(--bp)}
.finding .head{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;justify-content:space-between}
.finding dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:10px 0 0}
.finding dt{color:var(--muted)}.finding dd{margin:0}
details>summary{cursor:pointer;margin-top:10px;font-weight:600}
ol.els{margin:8px 0 0;padding-left:22px}
ol.els li{margin:10px 0}
code{font:.86em/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--surface-2);padding:1px 5px;border-radius:4px;overflow-wrap:anywhere}
pre{margin:6px 0;background:var(--surface-2);padding:8px 10px;border-radius:6px;overflow-x:auto;white-space:pre-wrap;overflow-wrap:anywhere}
pre code{background:none;padding:0}
.where{color:var(--muted);font-size:.9rem}
img.shot{max-width:100%;border:1px solid var(--border);border-radius:6px;margin-top:6px}
ul.check{list-style:none;padding:0}
ul.check li{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--border)}
ul.check input{width:20px;height:20px;margin-top:3px;flex:none}
ul.check label{cursor:pointer}
.evidence details{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:4px 16px 12px;margin:10px 0}
footer{color:var(--muted);font-size:.9rem;border-top:1px solid var(--border);margin-top:48px;padding:20px 0 40px}
@media (max-width:640px){h1{font-size:1.4rem}.finding dl{grid-template-columns:1fr}.finding dt{margin-top:6px}}
@media print{.toolbar,.skip,nav.toc,.btn{display:none}.finding,.tile{break-inside:avoid}body{background:#fff}}
`;

const JS = `
(() => {
  const btns = document.querySelectorAll('[data-filter]');
  btns.forEach(b => b.addEventListener('click', () => {
    btns.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    const f = b.dataset.filter;
    let n = 0;
    document.querySelectorAll('#criteria tbody tr').forEach(tr => {
      const show = f === 'all' || tr.dataset.result === f || (f === 'pass' && tr.dataset.result.startsWith('pass'));
      tr.hidden = !show; if (show) n++;
    });
    document.getElementById('criteria-count').textContent = n + ' criteria shown';
  }));
  const key = 'a11y-checklist:' + document.body.dataset.key;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
  const boxes = document.querySelectorAll('ul.check input');
  const progress = document.getElementById('check-progress');
  const update = () => { const done = [...boxes].filter(b => b.checked).length; progress.textContent = done + ' of ' + boxes.length + ' checked'; };
  boxes.forEach(b => {
    b.checked = !!saved[b.id];
    b.addEventListener('change', () => { saved[b.id] = b.checked; try { localStorage.setItem(key, JSON.stringify(saved)); } catch (e) {} update(); });
  });
  update();
  const toggle = document.getElementById('expand-all');
  const groups = [...document.querySelectorAll('#findings-section details')];
  const label = () => { toggle.textContent = groups.every(d => d.open) ? 'Collapse all elements' : 'Expand all elements'; };
  if (toggle && groups.length) {
    label();
    groups.forEach(d => d.addEventListener('toggle', label));
    toggle.addEventListener('click', () => { const open = !groups.every(d => d.open); groups.forEach(d => { d.open = open; }); label(); });
  } else if (toggle) toggle.hidden = true;
  window.addEventListener('beforeprint', () => document.querySelectorAll('details').forEach(d => { d.open = true; }));
})();
`;

export function renderHtml(r) {
  const { total, invs, rows, tally, pageList, sortedGroups } = buildModel(r);
  const host = (() => { try { return new URL(r.base).host; } catch { return r.base; } })();
  const date = new Date(r.date);
  const dateStr = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const active = rows.filter(x => !x.obsolete);
  const groupsFor = statuses => sortedGroups(statuses);
  const failGroups = groupsFor(['fail', 'likely']), reviewGroups = groupsFor(['review']), bpGroups = groupsFor(['bp']), resolvedGroups = groupsFor(['resolved']);
  const groupsBySc = {};
  for (const g of [...failGroups, ...reviewGroups]) for (const sc of g.sc) (groupsBySc[sc] ||= []).push(g);

  const H = [];
  H.push(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`);
  H.push(`<title>Accessibility audit: ${esc(host)}</title><style>${CSS}</style></head>`);
  H.push(`<body data-key="${esc(r.base)}|${esc(r.date)}"><a class="skip" href="#main">Skip to content</a>`);
  H.push(`<header class="top"><div class="wrap"><h1>Accessibility audit: ${esc(host)}</h1>`);
  H.push(`<p class="meta">${esc(dateStr)} · ${total} page${total === 1 ? '' : 's'} · WCAG 2.2 Level A and AA · axe-core ${esc(r.axe.version)} plus scripted checks</p>`);
  H.push(`<nav class="toc" aria-label="Report sections"><ul><li><a href="#summary">Summary</a></li><li><a href="#criteria-h">Success criteria</a></li><li><a href="#findings">Findings</a></li><li><a href="#checklist">Manual checklist</a></li><li><a href="#evidence">Evidence</a></li><li><a href="#pages">Pages</a></li></ul></nav></div></header>`);
  H.push(`<main id="main" class="wrap">`);

  // Summary
  const nFail = (tally.fail || 0) + (tally.likely || 0);
  H.push(`<section aria-labelledby="summary"><h2 id="summary">Summary</h2>`);
  H.push(`<p class="lead">${nFail ? `${nFail} of ${active.length} criteria have failures` : `No automated failures across ${active.length} criteria`}, ${tally.review || 0} need review, and ${(tally['pass-good'] || 0) + (tally['pass-partial'] || 0)} passed the automated checks. ${tally.manual || 0} can only be checked by hand.</p>`);
  H.push(`<div class="bar" aria-hidden="true">${RESULT_ORDER.filter(k => tally[k]).map(k => `<span class="seg--${k}" style="width:${(tally[k] / active.length * 100).toFixed(2)}%"></span>`).join('')}</div>`);
  H.push(`<div class="tiles">${RESULT_ORDER.filter(k => tally[k]).map(k => `<div class="tile tile--${k}"><b>${tally[k]}</b><span>${esc(RESULT_LABEL[k])}</span></div>`).join('')}</div>`);
  H.push(`<p class="note">Scanned at desktop 1280×800, mobile 390×844, 200% zoom and 400% zoom (320 CSS px). Automated testing cannot establish WCAG conformance. "Passed (partial)" means the checks that exist for that criterion found nothing, but part of the criterion still needs a person. "Likely fail" comes from heuristics and should be confirmed before it is reported.</p></section>`);

  // Criteria
  H.push(`<section aria-labelledby="criteria-h"><h2 id="criteria-h">Success criteria</h2>`);
  H.push(`<div class="toolbar" role="group" aria-label="Filter criteria by result"><button type="button" data-filter="all" aria-pressed="true">All</button>${['fail', 'likely', 'review', 'pass', 'manual', 'na'].filter(k => k === 'pass' ? (tally['pass-good'] || tally['pass-partial']) : tally[k]).map(k => `<button type="button" data-filter="${k}" aria-pressed="false">${esc(k === 'pass' ? 'Passed' : RESULT_SHORT[k])}</button>`).join('')}</div>`);
  H.push(`<p class="note" id="criteria-count" aria-live="polite">${rows.length} criteria shown</p>`);
  H.push(`<div class="scroll" role="region" aria-label="Success criteria table" tabindex="0"><table id="criteria"><caption>WCAG 2.1 A and AA criteria plus the WCAG 2.2 additions, with the result of this audit</caption>`);
  H.push(`<thead><tr><th scope="col">SC</th><th scope="col">Criterion</th><th scope="col">Level</th><th scope="col">Result</th><th scope="col">Findings</th><th scope="col">How checked</th></tr></thead><tbody>`);
  for (const c of rows) {
    const links = (groupsBySc[c.sc] || []).map(g => `<a href="#${gid(g.check)}">${esc(g.title)}</a>`).join('<br>');
    H.push(`<tr data-result="${c.result}"><td>${esc(c.sc)}</td><td><a href="${understanding(c)}">${esc(c.name)}</a>${c.ver === '2.2' ? ' <span class="how">(new in 2.2)</span>' : ''}${c.obsolete ? ' <span class="how">(obsolete)</span>' : ''}</td><td>${c.level}</td><td>${chip(c.result)}</td><td>${c.count ? `<span class="num">${c.count}</span> ${c.count === 1 ? 'element' : 'elements'}<br>` : ''}${links}</td><td class="how">${esc(c.how.join(', ') || 'manual')}</td></tr>`);
  }
  H.push(`</tbody></table></div></section>`);

  // Findings
  const renderGroup = (g, open) => {
    const allPages = new Set([...g.targets.values()].flatMap(t => [...t.pages]));
    const targets = [...g.targets.values()];
    const fix = /^https?:/.test(g.fix) ? `<a href="${esc(g.fix)}">Deque guidance for the ${esc(g.check.replace(/^axe(-review)?:/, ''))} rule</a>` : esc(g.fix);
    const items = targets.slice(0, 25).map(t => `<li><code>${esc(t.target)}</code><div class="where">${esc(pageList(t.pages))} · ${esc([...t.vps].join(', '))}</div>` +
      (t.html ? `<pre><code>${esc(t.html)}</code></pre>` : '') +
      [...t.details].slice(0, 2).map(d => `<div>${esc(d)}</div>`).join('') +
      (t.shot ? `<img class="shot" src="${esc(t.shot)}" alt="Screenshot of ${esc(t.target)} while focused" loading="lazy">` : '') + '</li>').join('');
    return `<article class="finding finding--${g.status}" id="${gid(g.check)}" aria-labelledby="${gid(g.check)}-t"><div class="head"><h3 id="${gid(g.check)}-t">${esc(g.title)}</h3><span>${statusChips(g)}</span></div>
<dl><dt>WCAG</dt><dd>${g.sc.length ? esc(g.sc.join(', ')) : 'Best practice'}${g.impact ? ` · axe impact: ${esc(g.impact)}` : ''}</dd><dt>Scope</dt><dd>${targets.length} element${targets.length === 1 ? '' : 's'} on ${esc(pageList(allPages))}</dd>${g.note ? `<dt>Verification</dt><dd class="verify">${esc(g.note)}</dd>` : ''}<dt>Fix</dt><dd>${fix}</dd><dt>Check</dt><dd><code>${esc(g.check)}</code></dd></dl>
<details${open ? ' open' : ''}><summary>${targets.length === 1 ? 'Affected element' : `Affected elements (${targets.length})`}</summary><ol class="els">${items}</ol>${targets.length > 25 ? `<p class="note">${targets.length - 25} more in results.json.</p>` : ''}</details></article>`;
  };
  H.push(`<section id="findings-section" aria-labelledby="findings"><h2 id="findings">Findings</h2><button type="button" class="btn" id="expand-all">Expand all elements</button>`);
  H.push(`<h3 class="sub" style="margin-top:20px">Failures (${failGroups.length})</h3>`);
  H.push(failGroups.length ? failGroups.map(g => renderGroup(g, false)).join('') : '<p>No failures found by the automated checks.</p>');
  H.push(`<h3 class="sub" style="margin-top:28px">Needs review (${reviewGroups.length})</h3>`);
  H.push(reviewGroups.length ? reviewGroups.map(g => renderGroup(g, false)).join('') : '<p>Nothing to review.</p>');
  if (resolvedGroups.length) H.push(`<h3 class="sub" style="margin-top:28px">Resolved during verification (${resolvedGroups.length})</h3><p class="note">Automated findings that were checked and are not failures. They are left out of the criteria results.</p>` + resolvedGroups.map(g => renderGroup(g, false)).join(''));
  if (bpGroups.length) H.push(`<h3 class="sub" style="margin-top:28px">Best practice, not WCAG A/AA (${bpGroups.length})</h3>` + bpGroups.map(g => renderGroup(g, false)).join(''));
  H.push(`</section>`);

  // Checklist
  const todo = rows.filter(x => ['pass-partial', 'manual', 'review'].includes(x.result) && !x.obsolete);
  H.push(`<section aria-labelledby="checklist"><h2 id="checklist">Manual checklist</h2><p class="note">These criteria have no automated check or only partial coverage. Ticks are saved in this browser only.</p><p id="check-progress" aria-live="polite"></p><ul class="check">`);
  for (const c of todo) H.push(`<li><input type="checkbox" id="chk-${c.sc.replace(/\./g, '-')}"><label for="chk-${c.sc.replace(/\./g, '-')}"><strong>${esc(c.sc)} ${esc(c.name)}</strong> (${c.level}) ${chip(c.result)}<br>${esc(c.manual)}</label></li>`);
  H.push(`</ul>`);
  const na = rows.filter(x => x.result === 'na');
  if (na.length) H.push(`<p class="note">Not applicable, because nothing relevant was found on the scanned pages: ${na.map(c => `${esc(c.sc)} ${esc(c.name)}`).join('; ')}.</p>`);
  H.push(`</section>`);

  // Evidence
  H.push(`<section aria-labelledby="evidence" class="evidence"><h2 id="evidence">Evidence for manual review</h2>`);
  const alts = new Map();
  for (const p of Object.values(r.pages)) for (const img of p.inventory?.imgs || []) {
    const k = JSON.stringify([img.src || img.tag, img.alt, img.label || '']);
    alts.set(k, (alts.get(k) || 0) + 1);
  }
  H.push(`<details><summary>Image text alternatives, 1.1.1 (${alts.size})</summary>${alts.size ? `<div class="scroll" role="region" aria-label="Image alternatives table" tabindex="0"><table><thead><tr><th scope="col">Image</th><th scope="col">alt</th><th scope="col">aria-label</th><th scope="col">Count</th></tr></thead><tbody>${[...alts.entries()].map(([k, n]) => { const [src, alt, label] = JSON.parse(k); return `<tr><td><code>${esc(src)}</code></td><td>${alt === null ? '<em>missing</em>' : alt === '' ? '<em>empty (decorative)</em>' : esc(alt)}</td><td>${esc(label)}</td><td class="num">${n}</td></tr>`; }).join('')}</tbody></table></div>` : '<p>No images found.</p>'}</details>`);
  const formPages = Object.values(r.pages).filter(p => p.inventory?.fields.length);
  H.push(`<details><summary>Forms, 1.3.5 and 3.3.x (${formPages.length} pages)</summary>${formPages.map(p => `<h4>${esc(path(p.url))}</h4><ul>${p.inventory.fields.map(f => `<li>${esc(f.label || f.placeholder || f.name || f.type)} <span class="how">${esc(f.type)}${f.required ? ', required' : ''}${f.autocomplete ? `, autocomplete=${esc(f.autocomplete)}` : ''}</span></li>`).join('')}</ul>`).join('') || '<p>No form fields found.</p>'}</details>`);
  const media = Object.values(r.pages).flatMap(p => (p.inventory?.media || []).map(m => `${path(p.url)}: ${m.tag} ${m.src}${m.autoplay ? ' (autoplay)' : ''}`));
  const frames = Object.values(r.pages).flatMap(p => (p.inventory?.iframes || []).map(f => `${path(p.url)}: ${f.host}, title "${f.title || ''}"`));
  H.push(`<details><summary>Media and embedded frames, 1.2.x and 2.1.2</summary><ul>${[...media, ...frames].map(m => `<li>${esc(m)}</li>`).join('') || '<li>No audio, video or frames found.</li>'}</ul></details>`);
  H.push(`<details><summary>Multiple ways, 2.4.5</summary><p>Search on any page: ${invs.some(i => i.search) ? 'yes' : 'no'}. HTML sitemap link: ${invs.some(i => i.links.some(l => /site ?map/i.test(l.text))) ? 'yes' : 'no'}. Links in the main navigation: ${invs[0]?.nav.length || 0}.</p></details>`);
  H.push(`<details><summary>Heading outlines, 1.3.1 and 2.4.6</summary>${Object.values(r.pages).map(p => `<h4>${esc(path(p.url))} <span class="how">${esc(p.inventory?.title)}</span></h4><ul>${(p.inventory?.headings || []).map(h => `<li style="margin-left:${(Number(h.level) - 1) * 14}px"><span class="how">h${esc(h.level)}</span> ${esc(h.text)}</li>`).join('') || '<li>No headings</li>'}</ul>`).join('')}</details>`);
  H.push(`</section>`);

  // Pages
  H.push(`<section aria-labelledby="pages"><h2 id="pages">Pages</h2><div class="scroll" role="region" aria-label="Pages table" tabindex="0"><table><thead><tr><th scope="col">Page</th><th scope="col">axe desktop<br><span class="how">violations / review</span></th><th scope="col">axe mobile</th><th scope="col">Tab stops</th><th scope="col">Width at 320px</th><th scope="col">Failures</th><th scope="col">Errors</th></tr></thead><tbody>`);
  for (const u of r.urls) {
    const p = r.pages[u] || {};
    const n = r.findings.filter(f => f.url === u && (f.status === 'fail' || f.status === 'likely')).length;
    H.push(`<tr><td><a href="${esc(u)}">${esc(path(u))}</a></td><td class="num">${p.axe?.desktop ? `${p.axe.desktop.violations} / ${p.axe.desktop.incomplete}` : '–'}</td><td class="num">${p.axe?.mobile ? `${p.axe.mobile.violations} / ${p.axe.mobile.incomplete}` : '–'}</td><td class="num">${p.tab ? `${p.tab.stops}${p.tab.completed ? '' : ' (stopped early)'}` : '–'}</td><td class="num">${p.reflow ? `${p.reflow.scrollWidth}px` : '–'}</td><td class="num">${n}</td><td>${esc((p.errors || []).join('; '))}</td></tr>`);
  }
  H.push(`</tbody></table></div></section></main>`);
  H.push(`<footer><div class="wrap">Generated ${esc(date.toUTCString())} in ${r.durationSec}s from <code>results.json</code>. axe-core ${esc(r.axe.version)}. Automated results only; see the manual checklist for what still needs a person.</div></footer>`);
  H.push(`<script>${JS}</script></body></html>`);
  return H.join('\n');
}
