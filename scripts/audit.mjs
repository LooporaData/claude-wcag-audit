#!/usr/bin/env node
// WCAG 2.1/2.2 A+AA audit: axe-core plus scripted keyboard, zoom, reflow,
// text-spacing, motion, interactive-state and cross-page checks.
//
// usage: node audit.mjs <base-url> [--sitemap URL] [--pages /a,/b] [--max-pages 40]
//                       [--concurrency 3] [--max-tabs 200] [--out DIR]
//                       [--skip keyboard,toggles,hover,mobile,zoom,spacing]
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { CHECKS } from './wcag.mjs';
import { renderReport } from './report.mjs';
import { renderHtml } from './html-report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const AXE_SRC = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const HELPERS = readFileSync(join(HERE, 'page-helpers.js'), 'utf8');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const SPACING_CSS = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }';

const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 800 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  zoom200: { viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 },   // 1280x800 at 200%
  reflow: { viewport: { width: 320, height: 256 }, deviceScaleFactor: 4 },    // 1280x1024 at 400%
};

// ---------- args ----------
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else a._.push(argv[i]);
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
if (!args._[0]) {
  console.error('usage: node audit.mjs <base-url> [--sitemap URL] [--pages /a,/b] [--max-pages N] [--concurrency N] [--max-tabs N] [--out DIR] [--skip keyboard,toggles,hover,mobile,zoom,spacing]');
  process.exit(2);
}
const BASE = args._[0].replace(/\/$/, '');
const OUT = resolve(args.out || 'a11y-report');
const SHOTS = join(OUT, 'shots');
const MAX_PAGES = Number(args['max-pages'] || 40);
const CONCURRENCY = Number(args.concurrency || 3);
const MAX_TABS = Number(args['max-tabs'] || 200);
const SKIP = new Set(String(args.skip || '').split(',').filter(Boolean));
mkdirSync(SHOTS, { recursive: true });

// ---------- browser ----------
function cachedChromium() {
  const roots = [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const dirs = readdirSync(root).filter(d => /^chromium(_headless_shell)?-\d+$/.test(d))
      .sort((x, y) => Number(y.split('-').pop()) - Number(x.split('-').pop()));
    for (const d of dirs) {
      for (const rel of ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell',
        'chrome-mac/headless_shell', 'chrome-linux/headless_shell', 'chrome-headless-shell-linux64/chrome-headless-shell',
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-linux/chrome']) {
        const p = join(root, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}
async function launch() {
  if (process.env.CHROME_BIN) return chromium.launch({ executablePath: process.env.CHROME_BIN });
  try { return await chromium.launch(); } catch (e) {
    const p = cachedChromium();
    if (p) { console.error(`[a11y] bundled browser missing, using cached ${p}`); return chromium.launch({ executablePath: p }); }
    throw new Error(`No Chromium available. Run "npx playwright install chromium" in ${dirname(HERE)} or set CHROME_BIN.\n${e.message}`);
  }
}

// ---------- state ----------
const findings = [];
const pages = {};
const baselines = new Map();     // `${url}|${vp}` -> Set of axe `${id}|${target}`
const toggleSeen = new Set();
const hoverSeen = new Set();
let shotN = 0;

function add(check, f) {
  const def = CHECKS[check] || {};
  findings.push({ ...f, check, sc: f.sc || def.sc || [], status: f.status || def.status || 'review', title: f.title || def.title || check, fix: f.fix || def.fix || '' });
}
const scFromTags = tags => tags.filter(t => /^wcag\d{3,}$/.test(t)).map(t => { const d = t.slice(4); return `${d[0]}.${d[1]}.${d.slice(2)}`; });

function recordAxe(res, url, vp, context) {
  for (const v of res.violations) {
    const sc = scFromTags(v.tags);
    for (const n of v.nodes) {
      add(`axe:${v.id}`, { url, vp, sc, status: sc.length ? 'fail' : 'bp', title: v.help, fix: v.helpUrl, impact: v.impact,
        target: n.target, html: n.html, detail: (context ? `[${context}] ` : '') + (n.summary || '').replace(/\s*\n\s*/g, ' ') });
    }
  }
  for (const v of res.incomplete) {
    const sc = scFromTags(v.tags);
    for (const n of v.nodes) {
      add(`axe-review:${v.id}`, { url, vp, sc, status: 'review', title: `${v.help} (axe could not decide)`, fix: v.helpUrl, impact: v.impact,
        target: n.target, html: n.html, detail: (context ? `[${context}] ` : '') + (n.msg || '') });
    }
  }
}

async function runAxe(page) {
  if (!(await page.evaluate(() => !!window.axe))) await page.evaluate(AXE_SRC);
  return page.evaluate(async tags => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'] });
    const map = arr => arr.map(v => ({
      id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, tags: v.tags,
      nodes: v.nodes.map(n => ({ target: n.target.join(' '), html: n.html.slice(0, 250), summary: n.failureSummary,
        msg: ((n.any[0] || n.all[0] || n.none[0]) || {}).message })),
    }));
    return { violations: map(r.violations), incomplete: map(r.incomplete), passes: r.passes.length };
  }, AXE_TAGS);
}

async function open(ctx, url, { scroll = true } = {}) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  if (scroll) {
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += innerHeight) { scrollTo(0, y); await new Promise(r => setTimeout(r, 50)); }
      scrollTo(0, 0);
    });
  }
  await page.waitForTimeout(800);
  return page;
}

// ---------- pixel diff (focus indicator) ----------
let diffPage;
async function pixelDiff(a, b) {
  return diffPage.evaluate(async ([a, b]) => {
    const load = s => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + s; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
    const c = new OffscreenCanvas(w, h), x = c.getContext('2d');
    x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, w, h).data;
    x.clearRect(0, 0, w, h); x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, w, h).data;
    let n = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2])) > 40) n++;
    }
    return n;
  }, [a.toString('base64'), b.toString('base64')]);
}

async function focusDiff(page, f) {
  const vs = page.viewportSize();
  const pad = 6;
  const x = Math.max(0, f.rect.vx - pad), y = Math.max(0, f.rect.vy - pad);
  const width = Math.min(vs.width - x, f.rect.w + 2 * pad), height = Math.min(vs.height - y, f.rect.h + 2 * pad);
  if (width < 2 || height < 2) return { changed: Infinity };
  const clip = { x, y, width, height };
  const a = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  await page.evaluate(() => { const e = window.__a11y.deepActive(); if (e && e.blur) e.blur(); });
  const b = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  return { changed: await pixelDiff(a, b), a, b };
}

// ---------- checks ----------
async function keyboardWalk(page, url, vp) {
  const P = pages[url];
  await page.evaluate(() => { scrollTo(0, 0); const e = document.activeElement; if (e && e.blur) e.blur(); });
  await page.mouse.move(1, 1);
  const startUrl = new URL(page.url());
  const sameDoc = u => u.origin + u.pathname + u.search === startUrl.origin + startUrl.pathname + startUrl.search;
  let popup = null;
  const onPage = p => { popup = p; };
  page.context().on('page', onPage);
  const expected = await page.evaluate(() => window.__a11y.tabbables());
  const seq = [];
  let prevKey = null, repeats = 0, iframeTabs = 0, completed = false, bodyHits = 0;
  try {
    for (let i = 0; i < MAX_TABS; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(60);
      const now = new URL(page.url());
      if (!sameDoc(now)) {
        add('focus-changes-context', { url, vp, target: prevKey || 'document', detail: `Pressing Tab navigated to ${now.href}` });
        break;
      }
      if (popup) {
        add('focus-changes-context', { url, vp, target: prevKey || 'document', detail: `Pressing Tab opened a new window (${popup.url()})` });
        await popup.close().catch(() => {});
        break;
      }
      const f = await page.evaluate(() => window.__a11y.describeFocus()).catch(() => null);
      if (!f) { bodyHits++; if (seq.length) { completed = true; break; } if (bodyHits > 3) break; continue; }
      if (f.key === prevKey) {
        // Native date/time inputs have several sub-fields that each take a Tab stop.
        if (f.tag === 'input' && /type="(date|datetime-local|time|month|week)"/.test(f.html) && ++repeats < 6) continue;
        if (f.tag === 'iframe') {
          if (++iframeTabs > 40) { add('kbd-iframe-long', { url, vp, target: f.key, html: f.html, detail: 'More than 40 Tab presses without leaving the frame; the walk stopped here.' }); break; }
          continue;
        }
        if (++repeats >= 3) { add('kbd-trap', { url, vp, status: 'likely', target: f.key, html: f.html, detail: 'Focus stayed on this element for 3 Tab presses.' }); break; }
        continue;
      }
      repeats = 0; iframeTabs = 0;
      if (seq.some(s => s.key === f.key)) {
        if (seq[0].key === f.key) { completed = true; break; }
        add('kbd-trap', { url, vp, target: f.key, html: f.html, detail: `Focus cycled back to this element after ${seq.length} stops without reaching the end of the page.` });
        break;
      }
      seq.push(f); prevKey = f.key;
      if (!f.visible || !f.inViewport) {
        add('kbd-focus-hidden-element', { url, vp, target: f.key, html: f.html, detail: !f.visible ? 'The focused element has no visible size, or is hidden or transparent.' : 'The focused element stays outside the viewport.' });
        continue;
      }
      if (f.tested > 0 && f.covered === f.tested) {
        add('kbd-focus-obscured', { url, vp, target: f.key, html: f.html, detail: `Covered by ${f.coverer}` });
        continue;
      }
      if (f.tag === 'iframe') continue;
      const d = await focusDiff(page, f);
      if (d.changed < 10) {
        const shot = `shots/focus-${++shotN}.png`;
        writeFileSync(join(OUT, shot), d.a);
        add('kbd-no-focus-indicator', { url, vp, target: f.key, html: f.html, shot,
          detail: `"${f.name}": ${d.changed} pixels changed between focused and unfocused screenshots.` });
      }
    }
  } finally {
    page.context().off('page', onPage);
  }
  P.tab = { stops: seq.length, completed, expected: expected.length, first: seq[0] ? { name: seq[0].name, href: seq[0].href } : null };

  let jumps = 0;
  for (let i = 1; i < seq.length && jumps < 5; i++) {
    const a = seq[i - 1], b = seq[i];
    if ((a.href || '').startsWith('#')) continue;
    // Moving up to the top of the next column to the right is normal reading order.
    if (b.rect.y < a.rect.y - 300 && b.rect.x <= a.rect.x + 20) {
      jumps++;
      add('kbd-order-jump', { url, vp, target: b.key, html: b.html, detail: `After "${a.name}" focus moves ${Math.round(a.rect.y - b.rect.y)}px up the page to "${b.name}".` });
    }
  }
  if (completed) {
    const got = new Set(seq.map(s => s.key));
    let n = 0;
    for (const e of expected) {
      if (got.has(e.key) || [...got].some(k => k.startsWith(e.key + ' > ') || e.key.startsWith(k + ' > '))) continue;
      if (++n > 15) break;
      add('kbd-unreachable', { url, vp, target: e.key, html: e.html, detail: `"${e.name}" was never reached by Tab${e.tabindex ? ` (tabindex=${e.tabindex})` : ''}.` });
    }
  }
  const first = seq[0];
  if (first && first.href && first.href.startsWith('#') && first.href.length > 1) {
    const ok = await page.evaluate(h => !!(document.getElementById(decodeURIComponent(h.slice(1))) || document.getElementsByName(h.slice(1))[0]), first.href);
    if (!ok) add('skip-link-broken', { url, vp, target: first.key, html: first.html, detail: `Skip link points to ${first.href}, which does not exist.` });
  }
}

function inventoryChecks(url, inv) {
  const vp = 'desktop';
  const generic = /^(click here|here|read more|learn more|more|details|link|continue|go|this|view|see more|find out more|more info|read)$/i;
  for (const l of inv.links) {
    if (!l.aria && generic.test(l.visibleText.trim())) add('link-generic-text', { url, vp, target: l.key, detail: `"${l.visibleText}" -> ${l.href}` });
  }
  const byText = new Map();
  for (const l of inv.links) {
    const t = l.text.toLowerCase();
    if (!t) continue;
    const href = l.href.split('#')[0].replace(/\/$/, '');
    if (!byText.has(t)) byText.set(t, new Map());
    byText.get(t).set(href, l.key);
  }
  for (const [t, hrefs] of byText) {
    if (hrefs.size > 1) add('link-ambiguous', { url, vp, target: [...hrefs.values()][0], detail: `"${t}" links to ${[...hrefs.keys()].join(', ')}` });
  }
  for (const img of inv.imgs) {
    const alt = img.alt || '';
    if (!alt) continue;
    if (/\.(png|jpe?g|gif|svg|webp|avif)$/i.test(alt) || /^(image|img|photo|picture|graphic|icon|untitled|banner|screenshot|dsc|img_)\s*\d*$/i.test(alt) ||
      (/^[\w-]{9,}$/.test(alt) && /[_-]/.test(alt)) || alt.length > 200) {
      add('img-alt-suspicious', { url, vp, target: img.key, detail: `alt="${alt.slice(0, 120)}"${img.src ? ` (src ${img.src})` : ''}` });
    }
  }
  const purposes = [
    [/e-?mail/i, ['email']], [/full[ _-]?name|^name$|your name|^name\b/i, ['name']],
    [/(first|given)[ _-]?name|fname/i, ['given-name']], [/(last|family|sur)[ _-]?name|lname/i, ['family-name']],
    [/phone|tel\b|mobile/i, ['tel', 'tel-national']],
    [/(organi[sz]ation|company|institution|employer)(?![ _-]?(type|size|kind|category))/i, ['organization']],
    [/job[ _-]?title|^title$|\brole\b/i, ['organization-title']],
    [/zip|postal/i, ['postal-code']], [/country/i, ['country', 'country-name']], [/city|town/i, ['address-level2']],
    [/street|address/i, ['street-address', 'address-line1', 'address-line2']], [/website|url/i, ['url']],
  ];
  for (const f of inv.fields) {
    const hay = [f.label, f.name, f.id, f.placeholder].filter(Boolean).join(' ');
    if (['checkbox', 'radio', 'search', 'password', 'file', 'range', 'date', 'hidden'].includes(f.type)) continue;
    const match = purposes.find(([re]) => re.test(hay));
    if (match) {
      const ac = (f.autocomplete || '').toLowerCase().split(/\s+/);
      if (!match[1].some(tok => ac.includes(tok))) add('input-autocomplete-missing', { url, vp, target: f.key, detail: `Field "${hay.slice(0, 60)}" has autocomplete="${f.autocomplete || ''}"; expected ${match[1].join(' or ')}.` });
    }
    if (!f.label && f.placeholder) add('input-placeholder-only', { url, vp, target: f.key, detail: `Only label is placeholder "${f.placeholder}".` });
  }
  for (const m of inv.media) {
    if (m.autoplay) add('autoplay-media', { url, vp, target: m.key, detail: `${m.tag} autoplay${m.muted ? ' (muted)' : ''}${m.controls ? '' : ', no native controls'}${m.loop ? ', loops' : ''}` });
  }
  for (const g of inv.gestures) add('gesture-widget', { url, vp, target: g.key, html: g.html, detail: 'Possible drag or swipe interaction.' });
}

async function auditDesktop(ctx, url) {
  const vp = 'desktop';
  const P = pages[url];
  const page = await open(ctx, url);
  try {
    P.inventory = await page.evaluate(() => window.__a11y.inventory());
    const ax = await runAxe(page);
    P.axe.desktop = { violations: ax.violations.length, incomplete: ax.incomplete.length, passes: ax.passes };
    recordAxe(ax, url, vp);
    baselines.set(`${url}|${vp}`, new Set(ax.violations.flatMap(v => v.nodes.map(n => `${v.id}|${n.target}`))));
    inventoryChecks(url, P.inventory);

    for (const b of await page.evaluate(() => window.__a11y.inputBoundaries())) {
      add('input-boundary-contrast', { url, vp, status: b.hasShadow ? 'review' : undefined, target: b.key, html: b.html,
        detail: `Best boundary contrast ${b.ratio}:1 against the surrounding background${b.hasShadow ? ' (has a box-shadow that may act as a border; check visually)' : ''}.` });
    }
    for (const m of await page.evaluate(() => window.__a11y.mouseOnly())) {
      add('mouse-only-interactive', { url, vp, target: m.key, html: m.html, detail: `cursor:pointer on "${m.name}" but it can't take keyboard focus.` });
    }
    await page.waitForTimeout(Math.max(0, 5500 - (Date.now() - P.t0)));
    const anims = await page.evaluate(() => window.__a11y.longAnimations());
    const byContainer = new Map();
    for (const a of anims) byContainer.set(a.container, [...(byContainer.get(a.container) || []), a]);
    for (const [container, list] of byContainer) {
      add('motion-no-pause', { url, vp, target: container, html: list[0].containerHtml,
        detail: `${list.length} long or looping animation${list.length > 1 ? 's' : ''} (${[...new Set(list.map(a => a.name))].slice(0, 6).join(', ')}) inside this region.` });
    }

    if (!SKIP.has('keyboard')) await keyboardWalk(page, url, vp);

    if (!SKIP.has('spacing')) {
      await page.evaluate(() => scrollTo(0, 0));
      const before = await page.evaluate(() => window.__a11y.clipped());
      P.clippedDesktop = before.map(c => c.key);
      const style = await page.addStyleTag({ content: SPACING_CSS });
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => window.__a11y.clipped());
      await style.evaluate(n => n.remove());
      for (const c of after.filter(a => !before.some(b => b.key === a.key))) {
        add('text-spacing-clipped', { url, vp, target: c.key, html: c.html, detail: `"${c.text}" overflows its container ${c.outY ? 'vertically' : 'horizontally'}.` });
      }
    }

    if (anims.length) {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForTimeout(600);
      const still = new Set((await page.evaluate(() => window.__a11y.longAnimations())).map(a => a.key));
      for (const a of anims.filter(a => still.has(a.key))) add('reduced-motion-ignored', { url, vp, target: a.key, html: a.html, detail: `"${a.name}" keeps running with prefers-reduced-motion: reduce.` });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    }

    P.toggles.desktop = await page.evaluate(() => window.__a11y.toggles());
    P.hover = await page.evaluate(() => window.__a11y.hoverCandidates());

    // 3.2.2: changing a select must not navigate. Done last because it may leave the page.
    const selects = await page.evaluate(() => [...document.querySelectorAll('select')].filter(s => window.__a11y.isVisible(s) && !s.multiple && !s.disabled && s.options.length > 1).map(s => ({ key: window.__a11y.cssPath(s), idx: s.selectedIndex, n: s.options.length })));
    for (const s of selects.slice(0, 3)) {
      const before = page.url();
      await page.locator(s.key).selectOption({ index: (s.idx + 1) % s.n }).catch(() => {});
      await page.waitForTimeout(800);
      if (page.url() !== before) { add('input-changes-context', { url, vp, target: s.key, detail: `Changing the selection navigated to ${page.url()}` }); break; }
    }
  } finally {
    await page.close();
  }
}

async function auditMobile(ctx, url) {
  const vp = 'mobile';
  const P = pages[url];
  const page = await open(ctx, url);
  try {
    const ax = await runAxe(page);
    P.axe.mobile = { violations: ax.violations.length, incomplete: ax.incomplete.length, passes: ax.passes };
    recordAxe(ax, url, vp);
    baselines.set(`${url}|${vp}`, new Set(ax.violations.flatMap(v => v.nodes.map(n => `${v.id}|${n.target}`))));
    P.toggles.mobile = await page.evaluate(() => window.__a11y.toggles());
  } finally {
    await page.close();
  }
}

async function auditZoom(ctx, url, vp) {
  const P = pages[url];
  const page = await open(ctx, url);
  try {
    const r = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      over: window.__a11y.overflowers(), clip: window.__a11y.clipped(),
    }));
    P[vp] = { scrollWidth: r.sw, clientWidth: r.cw };
    const base = new Set(P.clippedDesktop || []);
    const newClip = r.clip.filter(c => !base.has(c.key));
    if (vp === 'reflow') {
      if (r.sw > r.cw + 1) {
        if (!r.over.length) add('reflow-horizontal-scroll', { url, vp, target: 'html', detail: `Page is ${r.sw}px wide in a ${r.cw}px viewport.` });
        for (const o of r.over) add('reflow-horizontal-scroll', { url, vp, target: o.key, html: o.html, detail: `Page is ${r.sw}px wide in a ${r.cw}px viewport; this element ends at ${o.right}px.` });
      }
      for (const c of newClip) add('reflow-clipped-text', { url, vp, target: c.key, html: c.html, detail: `"${c.text}" is cut off.` });
    } else {
      for (const c of newClip) add('zoom200-clipped-text', { url, vp, target: c.key, html: c.html, detail: `"${c.text}" is cut off.` });
    }
  } finally {
    await page.close();
  }
}

function opened(s0, s1) {
  return (s1.expanded === 'true' && s0.expanded !== 'true') || (s1.detailsOpen && !s0.detailsOpen) ||
    (!!s1.dialog && !s0.dialog) || (s1.visible - s0.visible > 3);
}

async function testToggles(ctx, url, vp) {
  const P = pages[url];
  for (const t of (P.toggles[vp] || []).slice(0, 8)) {
    const dk = `${vp}|${t.key}|${t.name}`;
    if (toggleSeen.has(dk)) continue;
    toggleSeen.add(dk);
    const page = await open(ctx, url, { scroll: false });
    try {
      const loc = page.locator(t.key).first();
      if (!(await loc.isVisible().catch(() => false))) continue;
      const state = () => page.evaluate(k => window.__a11y.stateOf(k), t.key);
      const startUrl = page.url();
      await loc.focus();
      const s0 = await state();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      if (page.url() !== startUrl) continue;
      let s1 = await state();
      if (!opened(s0, s1)) {
        await loc.focus();
        await page.keyboard.press(' ');
        await page.waitForTimeout(500);
        s1 = await state();
      }
      if (!opened(s0, s1)) {
        await loc.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(500);
        if (page.url() === startUrl && opened(s0, await state())) {
          add('toggle-not-keyboard', { url, vp, target: t.key, html: t.html, detail: `"${t.name}" opens on click but not on Enter or Space.` });
        }
        continue;
      }
      const isPopup = /aria-haspopup/.test(t.html) || !!s1.dialog;
      if (!s1.dialog && s1.detailsOpen === null && s1.expanded !== 'true') {
        add('toggle-state-not-exposed', { url, vp, target: t.key, html: t.html,
          detail: `"${t.name}" revealed content but aria-expanded is ${s1.expanded === null ? 'missing' : `"${s1.expanded}"`}.` });
      }
      const ax = await runAxe(page);
      const base = baselines.get(`${url}|${vp}`) || new Set();
      ax.violations = ax.violations.map(v => ({ ...v, nodes: v.nodes.filter(n => !base.has(`${v.id}|${n.target}`)) })).filter(v => v.nodes.length);
      ax.incomplete = [];
      recordAxe(ax, url, vp, `after opening "${t.name}"`);
      if (s1.dialog && !s1.focusInDialog) add('dialog-focus-not-moved', { url, vp, target: t.key, html: t.html, detail: `"${t.name}" opened ${s1.dialog} but focus stayed on ${s1.activeKey}.` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const s3 = await state();
      const stillOpen = s3.expanded === 'true' || !!s3.dialog || (s3.visible - s0.visible > 3);
      if (isPopup && stillOpen) add('escape-does-not-close', { url, vp, target: t.key, html: t.html, detail: `"${t.name}" stays open after Escape.` });
      else if (!stillOpen && s1.activeKey !== t.key && !s3.focusOnTrigger) {
        add('focus-not-returned', { url, vp, target: t.key, html: t.html, detail: `After closing "${t.name}", focus is on ${s3.activeKey || 'the document body'}.` });
      }
    } catch (e) {
      P.errors.push(`toggle ${vp} ${t.key}: ${e.message.split('\n')[0]}`);
    } finally {
      await page.close();
    }
  }
}

async function testHover(ctx, url) {
  const P = pages[url];
  const vp = 'desktop';
  for (const c of P.hover || []) {
    if (hoverSeen.has(c.key)) continue;
    hoverSeen.add(c.key);
    const page = await open(ctx, url, { scroll: false });
    try {
      const count = () => page.evaluate(() => window.__a11y.visibleCount());
      await page.mouse.move(1, 1);
      const s0 = await count();
      await page.locator(c.key).first().hover();
      await page.waitForTimeout(400);
      if ((await count()) - s0 <= 2) continue;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      if ((await count()) - s0 > 2) add('hover-not-dismissible', { url, vp, target: c.key, detail: `${c.kind} "${c.name}" stays visible after Escape.` });
      await page.mouse.move(1, 1);
      await page.waitForTimeout(400);
      const base = await count();
      const focusTarget = page.locator(`${c.key} a[href], ${c.key} button, ${c.key}[tabindex]`).first();
      if (await focusTarget.count()) {
        await focusTarget.focus();
        await page.waitForTimeout(400);
        if ((await count()) - base <= 2) add('hover-only-content', { url, vp, target: c.key, detail: `${c.kind} "${c.name}" appears on hover but not when its trigger has keyboard focus.` });
      }
    } catch (e) {
      P.errors.push(`hover ${c.key}: ${e.message.split('\n')[0]}`);
    } finally {
      await page.close();
    }
  }
}

function siteChecks(urls) {
  const vp = 'site';
  const titles = new Map();
  for (const u of urls) {
    const t = pages[u].inventory?.title;
    if (t) titles.set(t, [...(titles.get(t) || []), u]);
  }
  for (const [t, us] of titles) if (us.length > 1) for (const u of us) add('title-duplicate', { url: u, vp, target: 'title', detail: `"${t}" is used on ${us.length} pages.` });

  const sigs = urls.map(u => pages[u].inventory?.nav || []).filter(n => n.length);
  if (sigs.length > 1) {
    const counts = new Map();
    for (const s of sigs) counts.set(s.join('|'), (counts.get(s.join('|')) || 0) + 1);
    const ref = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split('|');
    for (const u of urls) {
      const nav = pages[u].inventory?.nav || [];
      const common = nav.filter(x => ref.includes(x));
      const refCommon = ref.filter(x => common.includes(x));
      if (common.join('|') !== refCommon.join('|')) add('nav-order-inconsistent', { url: u, vp, target: 'nav', detail: `Order here: ${common.join(', ')}` });
    }
  }

  const helpRe = /contact|help|support|book a call|get in touch|talk to/i;
  const regions = new Map();
  for (const u of urls) {
    const r = new Set((pages[u].inventory?.links || []).filter(l => helpRe.test(l.text)).map(l => l.region));
    regions.set(u, r);
  }
  const anyHelp = [...regions.values()].some(r => r.size);
  if (anyHelp) {
    const common = ['header', 'nav', 'footer'].filter(reg => [...regions.values()].filter(r => r.has(reg)).length > urls.length / 2);
    for (const [u, r] of regions) {
      if (!common.length) continue;
      const missing = common.filter(reg => !r.has(reg));
      if (missing.length) add('help-inconsistent', { url: u, vp, target: 'help link', detail: `No contact/help link in ${missing.join(', ')} here, unlike most pages.` });
    }
  }
}

// ---------- discovery ----------
async function discover(browser) {
  if (args.pages) return String(args.pages).split(',').map(p => (/^[a-z]+:/i.test(p) ? p : BASE + (p.startsWith('/') ? p : '/' + p)));
  const smUrl = args.sitemap || `${BASE}/sitemap.xml`;
  const fetchLocs = async u => {
    const res = await fetch(u, { redirect: 'follow' });
    if (!res.ok) return [];
    const xml = await res.text();
    return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1].replace(/&amp;/g, '&'));
  };
  try {
    let locs = await fetchLocs(smUrl);
    const nested = locs.filter(l => /\.xml(\?|$)/.test(l));
    if (nested.length) locs = locs.filter(l => !nested.includes(l)).concat(...(await Promise.all(nested.map(fetchLocs))));
    locs = locs.filter(l => !/\.(pdf|jpe?g|png|gif|svg|webp|zip|xml|txt)(\?|$)/i.test(l));
    if (locs.length) return [...new Set(locs)].slice(0, MAX_PAGES);
  } catch { /* fall through to crawl */ }
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  const origin = new URL(page.url()).origin;
  const links = await page.evaluate(o => [...document.querySelectorAll('a[href]')].map(a => a.href.split('#')[0]).filter(h => h.startsWith(o)), origin);
  await ctx.close();
  return [...new Set([page.url(), ...links])].filter(l => !/\.(pdf|jpe?g|png|zip)(\?|$)/i.test(l)).slice(0, MAX_PAGES);
}

// ---------- main ----------
const started = Date.now();
const browser = await launch();
const diffCtx = await browser.newContext();
diffPage = await diffCtx.newPage();
const urls = await discover(browser);
console.error(`[a11y] ${urls.length} pages, concurrency ${CONCURRENCY}`);

const axeInfo = await (async () => {
  const p = await diffCtx.newPage();
  await p.evaluate(AXE_SRC);
  const r = await p.evaluate(tags => ({ version: window.axe.version, rules: window.axe.getRules(tags).map(r => ({ id: r.ruleId, tags: r.tags })) }), AXE_TAGS);
  await p.close();
  return r;
})();

async function newCtx(vp) {
  const c = await browser.newContext({ ...VIEWPORTS[vp], bypassCSP: true, reducedMotion: 'no-preference' });
  await c.addInitScript(HELPERS);
  return c;
}

let next = 0;
async function worker() {
  const ctx = {};
  for (const vp of Object.keys(VIEWPORTS)) ctx[vp] = await newCtx(vp);
  while (next < urls.length) {
    const url = urls[next++];
    const P = pages[url] = { url, axe: {}, toggles: {}, errors: [], t0: Date.now() };
    const step = async (name, fn) => {
      try { await fn(); } catch (e) { P.errors.push(`${name}: ${e.message.split('\n')[0]}`); }
    };
    await step('desktop', () => auditDesktop(ctx.desktop, url));
    if (!SKIP.has('mobile')) await step('mobile', () => auditMobile(ctx.mobile, url));
    if (!SKIP.has('zoom')) {
      await step('zoom200', () => auditZoom(ctx.zoom200, url, 'zoom200'));
      await step('reflow', () => auditZoom(ctx.reflow, url, 'reflow'));
    }
    if (!SKIP.has('toggles')) {
      await step('toggles-desktop', () => testToggles(ctx.desktop, url, 'desktop'));
      if (!SKIP.has('mobile')) await step('toggles-mobile', () => testToggles(ctx.mobile, url, 'mobile'));
    }
    if (!SKIP.has('hover')) await step('hover', () => testHover(ctx.desktop, url));
    const n = findings.filter(f => f.url === url).length;
    console.error(`[a11y] ${url} done in ${Math.round((Date.now() - P.t0) / 1000)}s, ${n} findings${P.errors.length ? `, ${P.errors.length} errors` : ''}`);
  }
  for (const c of Object.values(ctx)) await c.close();
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
siteChecks(urls);
await browser.close();

const results = {
  base: BASE, date: new Date().toISOString(), durationSec: Math.round((Date.now() - started) / 1000),
  axe: axeInfo, viewports: VIEWPORTS, urls, pages, findings,
};
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
writeFileSync(join(OUT, 'report.md'), renderReport(results));
writeFileSync(join(OUT, 'report.html'), renderHtml(results));
console.error(`[a11y] wrote report.md, report.html and results.json to ${OUT} in ${results.durationSec}s`);
