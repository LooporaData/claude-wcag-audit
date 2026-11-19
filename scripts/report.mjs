// Turns results.json from audit.mjs into a Markdown report with a
// success-criterion matrix, grouped findings and a manual checklist.
import { CRITERIA, CHECKS } from './wcag.mjs';

export const STATUS_ORDER = { fail: 0, likely: 1, review: 2, bp: 3, resolved: 4 };
export const VERDICT_LABEL = { confirmed: 'Confirmed', 'false-positive': 'False positive', 'no-issue': 'Checked, no issue', decision: 'Needs a decision' };
export const RESULT_LABEL = {
  fail: 'Fail', likely: 'Likely fail', review: 'Needs review', 'pass-good': 'No issues found',
  'pass-partial': 'No automated issues (partial)', manual: 'Manual only', na: 'N/A',
};

export const path = u => { try { const p = new URL(u).pathname; return p || '/'; } catch { return u; } };
const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = s => '`' + String(s ?? '').replace(/`/g, "'").slice(0, 220) + '`';

// Shared by the Markdown and HTML renderers.
export function buildModel(r) {
  const total = r.urls.length;
  const invs = Object.values(r.pages).map(p => p.inventory).filter(Boolean);
  const flags = {
    noMedia: !invs.some(i => i.media.length),
    noForms: !invs.some(i => i.fields.length),
    noAuth: !invs.some(i => i.hasPassword),
  };

  const axeBySc = {};
  for (const rule of r.axe.rules) {
    for (const t of rule.tags) {
      if (!/^wcag\d{3,}$/.test(t)) continue;
      const d = t.slice(4), sc = `${d[0]}.${d[1]}.${d.slice(2)}`;
      (axeBySc[sc] ||= []).push(rule.id);
    }
  }
  const customBySc = {};
  for (const [id, c] of Object.entries(CHECKS)) for (const sc of c.sc) (customBySc[sc] ||= []).push(id);

  // Verification notes (notes.json, keyed by check id) adjust the raw statuses:
  // confirmed -> a likely fail becomes a fail; false-positive / no-issue -> resolved
  // and left out of the criteria results; decision -> stays as review with the note.
  const notes = r.notes || {};
  const findings = r.findings.map(f => {
    const v = notes[f.check]?.verdict;
    if (v === 'false-positive' || v === 'no-issue') return { ...f, status: 'resolved' };
    if (v === 'confirmed' && (f.status === 'likely' || f.status === 'review')) return { ...f, status: 'fail', title: f.title.replace(/ \(axe could not decide\)$/, '') };
    return f;
  });

  const bySc = {};
  for (const f of findings) if (f.status !== 'resolved') for (const sc of f.sc) (bySc[sc] ||= []).push(f);

  const rows = CRITERIA.map(c => {
    const fs = bySc[c.sc] || [];
    const has = s => fs.some(f => f.status === s);
    let result;
    if (has('fail')) result = 'fail';
    else if (has('likely')) result = 'likely';
    else if (has('review')) result = 'review';
    else if (c.naIf && flags[c.naIf]) result = 'na';
    else if (c.coverage === 'none') result = 'manual';
    else result = c.coverage === 'good' ? 'pass-good' : 'pass-partial';
    const counted = { fail: ['fail', 'likely'], likely: ['likely'], review: ['review'] }[result] || [];
    const targets = new Set(fs.filter(f => counted.includes(f.status)).map(f => `${f.check}|${f.target}`));
    const how = [
      ...(axeBySc[c.sc]?.length ? [`axe (${axeBySc[c.sc].length} rules)`] : []),
      ...(customBySc[c.sc] || []),
    ];
    return { ...c, result, count: targets.size, how };
  });

  const tally = {};
  for (const row of rows) if (!row.obsolete) tally[row.result] = (tally[row.result] || 0) + 1;

  const groups = new Map();
  for (const f of findings) {
    const g = groups.get(f.check) || { check: f.check, title: f.title, fix: f.fix, sc: f.sc, status: f.status, impact: f.impact, targets: new Map(),
      verdict: notes[f.check]?.verdict, note: notes[f.check]?.note };
    if (STATUS_ORDER[f.status] < STATUS_ORDER[g.status]) g.status = f.status;
    const tk = typeof f.target === 'string' ? f.target : JSON.stringify(f.target);
    const t = g.targets.get(tk) || { target: tk, pages: new Set(), vps: new Set(), html: f.html, details: new Set(), shot: f.shot };
    t.pages.add(path(f.url)); t.vps.add(f.vp); if (f.detail) t.details.add(f.detail); if (!t.shot && f.shot) t.shot = f.shot;
    g.targets.set(tk, t);
    groups.set(f.check, g);
  }
  const pageList = set => (set.size === total && total > 1 ? `all ${total} pages` : [...set].slice(0, 6).join(', ') + (set.size > 6 ? ` +${set.size - 6} more` : ''));
  const sortedGroups = statuses => [...groups.values()].filter(g => statuses.includes(g.status))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.targets.size - a.targets.size);

  return { total, invs, flags, rows, tally, groups, pageList, sortedGroups };
}

export function renderReport(r) {
  const { total, invs, rows, tally, groups, pageList, sortedGroups } = buildModel(r);
  const L = [];
  L.push(`# Accessibility audit: ${r.base}`, '');
  L.push(`${new Date(r.date).toUTCString()} · ${total} pages · axe-core ${r.axe.version} · ${r.durationSec}s`, '');
  L.push('Viewports: desktop 1280x800, mobile 390x844, 200% zoom (640x400), 400% zoom / reflow (320x256).', '');
  L.push('## Summary', '');
  L.push(`Against WCAG 2.2 Level A and AA: ${rows.filter(x => !x.obsolete).length} criteria, which is WCAG 2.1's ${rows.filter(x => x.ver !== '2.2').length} plus ${rows.filter(x => x.ver === '2.2').length} added in 2.2, without the obsolete 4.1.1:`, '');
  for (const k of ['fail', 'likely', 'review', 'pass-good', 'pass-partial', 'manual', 'na']) {
    if (tally[k]) L.push(`- **${RESULT_LABEL[k]}:** ${tally[k]}`);
  }
  L.push('', 'Automated testing cannot establish conformance. "No issues found" means the scripted checks passed; criteria marked partial or manual still need the checklist at the end.', '');

  L.push('## Success criteria', '');
  L.push('| SC | Level | Name | Result | Elements | How checked |', '|---|---|---|---|---|---|');
  for (const row of rows) {
    L.push(`| ${row.sc}${row.ver === '2.2' ? ' (2.2)' : ''} | ${row.level} | ${cell(row.name)}${row.obsolete ? ' (obsolete)' : ''} | ${RESULT_LABEL[row.result]} | ${row.count || ''} | ${cell(row.how.join(', ') || 'manual')} |`);
  }
  L.push('');

  const section = (heading, statuses, intro) => {
    const gs = sortedGroups(statuses);
    if (!gs.length) return;
    L.push(`## ${heading}`, '');
    if (intro) L.push(intro, '');
    gs.forEach((g, i) => {
      const allPages = new Set([...g.targets.values()].flatMap(t => [...t.pages]));
      L.push(`### ${i + 1}. ${g.title}`, '');
      L.push(`- **Status:** ${g.status === 'resolved' ? VERDICT_LABEL[g.verdict] : RESULT_LABEL[g.status] || 'Best practice'}${g.impact ? ` (axe impact: ${g.impact})` : ''}`);
      if (g.note) L.push(`- **Verification:** ${g.verdict && g.status !== 'resolved' ? `${VERDICT_LABEL[g.verdict]}. ` : ''}${g.note}`);
      L.push(`- **WCAG:** ${g.sc.length ? g.sc.join(', ') : 'best practice'} · **Check:** ${g.check}`);
      L.push(`- **Scope:** ${g.targets.size} element${g.targets.size === 1 ? '' : 's'} on ${pageList(allPages)}`);
      L.push(`- **Fix:** ${g.fix}`, '');
      for (const t of [...g.targets.values()].slice(0, 8)) {
        L.push(`- ${code(t.target)} (${pageList(t.pages)}; ${[...t.vps].join(', ')})`);
        if (t.html) L.push(`  - ${code(t.html)}`);
        for (const d of [...t.details].slice(0, 2)) L.push(`  - ${cell(d).slice(0, 300)}`);
        if (t.shot) L.push(`  - screenshot: ${t.shot}`);
      }
      if (g.targets.size > 8) L.push(`- ...and ${g.targets.size - 8} more (see results.json)`);
      L.push('');
    });
  };
  section('Failures', ['fail', 'likely'], '"Likely fail" findings come from heuristics. Verify each one before reporting it as a failure.');
  section('Needs review', ['review']);
  section('Best practice (not WCAG A/AA)', ['bp']);
  section('Resolved during verification', ['resolved'], 'Automated findings that a person checked and found not to be failures. They are excluded from the criteria results.');

  L.push('## Manual checklist', '');
  L.push('These criteria have no automated check, or only partial coverage. Evidence gathered during the scan is listed where it helps.', '');
  for (const row of rows.filter(x => ['pass-partial', 'manual', 'review'].includes(x.result) && !x.obsolete)) {
    L.push(`- [ ] **${row.sc} ${row.name}** (${row.level}): ${row.manual}`);
  }
  for (const row of rows.filter(x => x.result === 'na')) L.push(`- N/A **${row.sc} ${row.name}**: nothing relevant found on the scanned pages.`);
  L.push('');

  L.push('## Evidence', '');
  const alts = new Map();
  for (const p of Object.values(r.pages)) for (const img of p.inventory?.imgs || []) {
    const k = `${img.src || img.tag}|${img.alt ?? '(no alt)'}|${img.label || ''}`;
    alts.set(k, (alts.get(k) || 0) + 1);
  }
  L.push('### Image text alternatives (1.1.1)', '');
  if (!alts.size) L.push('No images found.', '');
  else {
    L.push('| Image | alt | aria-label | Occurrences |', '|---|---|---|---|');
    for (const [k, n] of [...alts.entries()].slice(0, 80)) { const [src, alt, label] = k.split('|'); L.push(`| ${cell(src)} | ${cell(alt === '' ? '"" (decorative)' : alt)} | ${cell(label)} | ${n} |`); }
    L.push('');
  }
  L.push('### Forms (1.3.5, 3.3.x)', '');
  const formPages = Object.values(r.pages).filter(p => p.inventory?.fields.length);
  if (!formPages.length) L.push('No form fields found.', '');
  for (const p of formPages) {
    L.push(`**${path(p.url)}**: ` + p.inventory.fields.map(f => `${f.label || f.placeholder || f.name || f.type} (${f.type}${f.required ? ', required' : ''}${f.autocomplete ? `, autocomplete=${f.autocomplete}` : ''})`).join('; '), '');
  }
  L.push('### Media and embedded frames (1.2.x, 2.1.2)', '');
  const media = Object.values(r.pages).flatMap(p => (p.inventory?.media || []).map(m => `${path(p.url)}: ${m.tag} ${m.src}${m.autoplay ? ' (autoplay)' : ''}`));
  const frames = Object.values(r.pages).flatMap(p => (p.inventory?.iframes || []).map(f => `${path(p.url)}: iframe ${f.host} title="${f.title || ''}"`));
  L.push(media.length ? media.map(m => `- ${m}`).join('\n') : 'No audio or video found.', '');
  if (frames.length) L.push(frames.map(m => `- ${m}`).join('\n'), '');
  L.push('### Multiple ways (2.4.5)', '');
  L.push(`Search on any page: ${invs.some(i => i.search) ? 'yes' : 'no'}. HTML sitemap link: ${invs.some(i => i.links.some(l => /site ?map/i.test(l.text))) ? 'yes' : 'no'}. Navigation links on the most common nav: ${invs[0]?.nav.length || 0}.`, '');
  L.push('### Headings (1.3.1, 2.4.6)', '');
  for (const p of Object.values(r.pages)) {
    const hs = p.inventory?.headings || [];
    L.push(`**${path(p.url)}** (${cell(p.inventory?.title)}): ` + (hs.length ? hs.map(h => `h${h.level} ${h.text}`).join(' · ') : 'no headings'), '');
  }

  L.push('## Pages', '');
  L.push('| Page | axe desktop (violations / review) | axe mobile | Tab stops | Reflow 320px width | Findings | Errors |', '|---|---|---|---|---|---|---|');
  for (const u of r.urls) {
    const p = r.pages[u] || {};
    const n = r.findings.filter(f => f.url === u && f.status !== 'bp' && f.status !== 'review').length;
    L.push(`| ${path(u)} | ${p.axe?.desktop ? `${p.axe.desktop.violations} / ${p.axe.desktop.incomplete}` : '-'} | ${p.axe?.mobile ? `${p.axe.mobile.violations} / ${p.axe.mobile.incomplete}` : '-'} | ${p.tab ? `${p.tab.stops}${p.tab.completed ? '' : ' (incomplete)'}` : '-'} | ${p.reflow ? `${p.reflow.scrollWidth}px` : '-'} | ${n} | ${cell((p.errors || []).join('; '))} |`);
  }
  L.push('');
  return L.join('\n');
}

