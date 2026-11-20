#!/usr/bin/env node
// Re-measure findings the audit left for a person: text on a gradient or image,
// targets whose size axe could not decide, and text the clip check flagged.
// Prints JSON to stdout. Write notes.json from it, then run render.mjs.
//
// usage: node measure.mjs <audit-out-dir>
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './deps.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPERS = readFileSync(join(HERE, 'page-helpers.js'), 'utf8');
const SPACING = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node measure.mjs <audit-out-dir>');
  process.exit(2);
}
const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
const findings = results.findings || [];

function parseColor(s) {
  const m = s && String(s).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return { r, g, b };
}
function lum({ r, g, b }) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}
function required(fontSize, fontWeight) {
  const px = parseFloat(fontSize);
  const bold = Number(fontWeight) >= 700;
  return (px >= 24 || (bold && px >= 18.67)) ? 3 : 4.5;
}

const contrastJobs = [];
const seenC = new Set();
for (const f of findings) {
  if (f.check !== 'axe-review:color-contrast' || !f.target || f.target.includes(',')) continue;
  const cls = (f.html || '').match(/class="([^"]+)"/);
  const reason = (f.detail || '').replace(/^\[[^\]]*]\s*/, '').slice(0, 70);
  const sig = `${cls ? cls[1].split(/\s+/)[0] : f.target}|${reason}`;
  if (seenC.has(sig)) continue;
  seenC.add(sig);
  contrastJobs.push(f);
  if (contrastJobs.length >= 8) break;
}
const targetJobs = [];
const seenT = new Set();
for (const f of findings) {
  if (f.check !== 'axe-review:target-size' || !f.target) continue;
  if (seenT.has(f.target)) continue;
  seenT.add(f.target);
  targetJobs.push(f);
}
const clipUrls = [];
for (const f of findings) {
  if (!['text-spacing-clipped', 'reflow-clipped-text', 'zoom200-clipped-text'].includes(f.check)) continue;
  if (!clipUrls.includes(f.url)) clipUrls.push(f.url);
  if (clipUrls.length >= 3) break;
}

const byUrl = new Map();
const addJob = (url, kind, job) => {
  const bag = byUrl.get(url) || { contrast: [], targets: [], clips: false };
  bag[kind].push(job);
  byUrl.set(url, bag);
};
for (const f of contrastJobs) addJob(f.url, 'contrast', f);
for (const f of targetJobs) addJob(f.url, 'targets', f);
for (const url of clipUrls) {
  const bag = byUrl.get(url) || { contrast: [], targets: [], clips: false };
  bag.clips = true;
  byUrl.set(url, bag);
}

const out = { contrast: [], targets: [], clips: [] };
if (!byUrl.size) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

async function medianPixel(page, buf) {
  return page.evaluate(async (b64) => {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = 'data:image/png;base64,' + b64;
    });
    const c = new OffscreenCanvas(img.width, img.height);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, img.width, img.height).data;
    const px = [];
    for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
    px.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
    const m = px[px.length >> 1];
    return { r: m[0], g: m[1], b: m[2] };
  }, buf.toString('base64'));
}

async function measureContrast(page, selector) {
  const meta = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      color: cs.color, fill: cs.fill, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
      text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      x: box.x, y: box.y, w: box.width, h: box.height,
    };
  }, selector).catch(() => null);
  if (!meta || meta.w < 2 || meta.h < 2) return { selector, missing: true };
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    el.dataset.mColor = el.style.color;
    el.dataset.mFill = el.style.fill;
    el.style.setProperty('color', 'transparent', 'important');
    el.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
    el.style.setProperty('fill', 'transparent', 'important');
  }, selector);
  const vs = page.viewportSize();
  const clip = {
    x: Math.max(0, Math.min(meta.x + Math.min(meta.w / 2, 24) - 6, vs.width - 12)),
    y: Math.max(0, Math.min(meta.y + meta.h / 2 - 6, vs.height - 12)),
    width: 12, height: 12,
  };
  let bg = null;
  try {
    bg = await medianPixel(page, await page.screenshot({ clip, type: 'png', animations: 'disabled' }));
  } catch (e) {
    bg = null;
    meta.error = e.message;
  }
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    el.style.color = el.dataset.mColor || '';
    el.style.webkitTextFillColor = '';
    el.style.fill = el.dataset.mFill || '';
  }, selector);
  const svg = meta.tag === 'text' || meta.tag === 'tspan';
  const fg = svg ? (parseColor(meta.fill) || parseColor(meta.color)) : parseColor(meta.color);
  const need = required(meta.fontSize, meta.fontWeight);
  const value = fg && bg ? ratio(fg, bg) : null;
  return {
    selector, text: meta.text, fg: svg ? meta.fill : meta.color,
    fontSize: meta.fontSize, fontWeight: meta.fontWeight,
    bg, ratio: value, required: need, pass: value != null && value >= need,
    ...(meta.error ? { error: meta.error } : {}),
  };
}

async function measureTarget(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { selector: sel, missing: true };
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hits = [];
    for (const o of document.querySelectorAll('a[href], button, input, select, textarea, summary, [role=button], [role=link]')) {
      if (o === el || o.disabled) continue;
      const b = o.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) continue;
      const nx = Math.max(b.left, Math.min(cx, b.right));
      const ny = Math.max(b.top, Math.min(cy, b.bottom));
      if (Math.hypot(cx - nx, cy - ny) < 12) hits.push((o.getAttribute('aria-label') || o.innerText || o.tagName).replace(/\s+/g, ' ').trim().slice(0, 40));
      if (hits.length >= 4) break;
    }
    const w = Math.round(r.width * 10) / 10, h = Math.round(r.height * 10) / 10;
    const undersized = w < 24 || h < 24;
    // 2.5.8: at least 24px, or an undersized target whose 24px circle hits nothing else.
    return { selector: sel, w, h, pass: !undersized || hits.length === 0, hits };
  }, selector).catch(e => ({ selector, missing: true, error: e.message }));
}

function packClip(c, kind) {
  return { kind, text: c.text, owner: c.owner, clipper: c.key, outX: c.outX, outY: c.outY };
}

const browser = await launchBrowser();
try {
  for (const [url, work] of byUrl) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await page.addInitScript(HELPERS);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(400);
      for (const f of work.contrast) out.contrast.push({ url, ...(await measureContrast(page, f.target)) });
      for (const f of work.targets) out.targets.push({ url, ...(await measureTarget(page, f.target)) });
      if (work.clips) {
        const before = await page.evaluate(() => window.__a11y.clipped());
        const id = c => c.owner || c.key;
        await page.addStyleTag({ content: SPACING });
        await page.waitForTimeout(300);
        const spaced = await page.evaluate(() => window.__a11y.clipped());
        for (const c of spaced.filter(a => !before.some(b => id(b) === id(a)))) out.clips.push({ url, ...packClip(c, 'spacing') });
        await page.setViewportSize({ width: 320, height: 256 });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(300);
        const reflow = await page.evaluate(() => window.__a11y.clipped());
        for (const c of reflow.filter(a => !before.some(b => id(b) === id(a)))) out.clips.push({ url, ...packClip(c, 'reflow') });
      }
    } catch (e) {
      out.contrast.push({ url, error: e.message });
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
