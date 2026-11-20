// Injected into every audited page (via addInitScript) as window.__a11y.
// Plain browser JS; no imports.
(() => {
  if (window.__a11y) return;

  const esc = s => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, '\\$&'));

  function cssPath(el) {
    if (!(el instanceof Element)) return '';
    if (el.id && document.querySelectorAll('#' + esc(el.id)).length === 1) return '#' + esc(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node.id && document.querySelectorAll('#' + esc(node.id)).length === 1) { parts.unshift('#' + esc(node.id)); break; }
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter(c => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false; // includes the 1px visually-hidden pattern
    if (r.right + scrollX <= 0 || r.bottom + scrollY <= 0) return false; // parked off-screen
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    const closed = el.parentElement && el.parentElement.closest('details:not([open])');
    if (closed && !el.closest('summary')?.parentElement?.isSameNode(closed)) return false;
    if (/inset\(\s*(50|100)%/.test(cs.clipPath) || /rect\(\s*0(px)?[ ,]+0(px)?[ ,]+0(px)?[ ,]+0(px)?\s*\)/.test(cs.clip)) return false;
    let n = el;
    while (n && n.nodeType === 1) {
      const s = getComputedStyle(n);
      if (parseFloat(s.opacity) === 0) return false;
      if (n !== el) {
        // ancestor uses the visually-hidden pattern (clip, clip-path, or a 1px overflow:hidden box)
        if (/inset\(\s*(50|100)%/.test(s.clipPath) || /rect\(\s*0(px)?[ ,]+0(px)?[ ,]+0(px)?[ ,]+0(px)?\s*\)/.test(s.clip)) return false;
        const ar = n.getBoundingClientRect();
        if (s.overflow !== 'visible' && (ar.width <= 1 || ar.height <= 1)) return false;
      }
      n = n.parentElement;
    }
    return true;
  }

  function accName(el) {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
      if (t) return t;
    }
    const labels = el.labels ? [...el.labels].map(l => l.innerText).join(' ').trim() : '';
    return (el.getAttribute('aria-label') || labels || el.innerText || el.value || el.getAttribute('title') ||
      el.getAttribute('alt') || el.querySelector?.('img[alt]')?.getAttribute('alt') || '').trim().replace(/\s+/g, ' ');
  }

  const short = (s, n = 200) => (s || '').replace(/\s+/g, ' ').slice(0, n);

  function deepActive() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  function describeFocus() {
    const el = deepActive();
    if (!el || el === document.body || el === document.documentElement) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const visible = r.width >= 1 && r.height >= 1 && cs.visibility !== 'hidden' && isVisible(el);
    const inViewport = r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    let covered = 0, coverer = null, tested = 0;
    if (visible && inViewport) {
      for (const [fx, fy] of [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        tested++;
        const hit = document.elementFromPoint(x, y);
        if (hit && !el.contains(hit) && !hit.contains(el)) { covered++; coverer = coverer || cssPath(hit); }
      }
    }
    return {
      key: cssPath(el), tag: el.tagName.toLowerCase(), role: el.getAttribute('role'),
      name: short(accName(el), 80), html: short(el.outerHTML),
      href: el.getAttribute('href'),
      rect: { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, vx: r.left, vy: r.top },
      visible, inViewport, covered, tested, coverer,
    };
  }

  const FOCUSABLE = 'a[href], area[href], button, input:not([type=hidden]), select, textarea, summary, iframe, [tabindex], [contenteditable=""], [contenteditable="true"]';

  function isFocusable(el) {
    if (!el.matches(FOCUSABLE)) return false;
    if (el.disabled) return false;
    const ti = el.getAttribute('tabindex');
    return !(ti !== null && parseInt(ti, 10) < 0);
  }

  // Visible elements a keyboard user should be able to reach with Tab.
  function tabbables() {
    const out = [];
    for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex^="-"]), [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=switch]')) {
      if (el.disabled || el.closest('[inert]') || el.closest('[aria-hidden="true"]')) continue;
      if (!isVisible(el)) continue;
      // roving tabindex: composite widgets (tabs, menus, listboxes...) expose one Tab stop and use arrow keys
      if (el.getAttribute('tabindex') === '-1' && /^(tab|menuitem|menuitemradio|menuitemcheckbox|option|radio|treeitem|gridcell|row)$/.test(el.getAttribute('role') || '')) {
        const group = el.closest('[role=tablist],[role=menu],[role=menubar],[role=listbox],[role=radiogroup],[role=tree],[role=grid],[role=treegrid]');
        if (group && [...group.querySelectorAll('[tabindex="0"], [role] button:not([tabindex="-1"])')].length) continue;
      }
      // radio groups: only one radio per group is in the tab sequence
      if (el.type === 'radio' && el.name) {
        const group = document.querySelectorAll(`input[type=radio][name="${esc(el.name)}"]`);
        if (group[0] !== el) continue;
      }
      out.push({ key: cssPath(el), html: short(el.outerHTML), name: short(accName(el), 80), tabindex: el.getAttribute('tabindex') });
    }
    return out;
  }

  // Elements styled as clickable (cursor:pointer originates here) that can't take focus.
  function mouseOnly() {
    const out = [];
    for (const el of document.body.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.cursor !== 'pointer') continue;
      const p = el.parentElement;
      if (p && getComputedStyle(p).cursor === 'pointer') continue;
      if (['LABEL', 'OPTION', 'HTML', 'BODY'].includes(el.tagName)) continue;
      if (isFocusable(el) || el.closest('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex^="-"]), [contenteditable]')) continue;
      if (el.querySelector(FOCUSABLE)) continue;
      if (el.closest('label')) continue;
      if (!isVisible(el)) continue;
      out.push({ key: cssPath(el), html: short(el.outerHTML), name: short(accName(el), 80) });
      if (out.length >= 25) break;
    }
    return out;
  }

  // Text that is cut off by an overflow:hidden/clip ancestor.
  // One record per text element. `owner` is that element. `key` is the box that clips it.
  function clipped() {
    const out = [];
    const hid = v => v === 'hidden' || v === 'clip';
    for (const el of document.body.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (!hid(cs.overflowX) && !hid(cs.overflowY)) continue;
      if (el.clientWidth <= 2 || el.clientHeight <= 2) continue; // visually-hidden pattern
      if (!isVisible(el)) continue;
      const box = el.getBoundingClientRect();
      const left = box.left + el.clientLeft, top = box.top + el.clientTop;
      const right = left + el.clientWidth, bottom = top + el.clientHeight;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n, count = 0;
      while ((n = walker.nextNode()) && count < 400) {
        count++;
        if (!n.textContent.trim()) continue;
        const pe = n.parentElement;
        if (!pe || !isVisible(pe) || pe.closest('[aria-hidden="true"]')) continue;
        // content inside a nearer scroll container can be scrolled to, so it isn't lost
        let sc = pe, scrollable = false;
        while (sc && sc !== el) { const o = getComputedStyle(sc); if (/auto|scroll/.test(o.overflowX + o.overflowY)) { scrollable = true; break; } sc = sc.parentElement; }
        if (scrollable) continue;
        const ps = getComputedStyle(pe);
        if (ps.position === 'fixed') continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const rr of range.getClientRects()) {
          if (rr.width < 1 || rr.height < 1) continue;
          const outY = hid(cs.overflowY) && (rr.bottom > bottom + 1.5 || rr.top < top - 1.5);
          const outX = hid(cs.overflowX) && (rr.right > right + 1.5 || rr.left < left - 1.5);
          if (outY || outX) {
            out.push({ key: cssPath(el), html: short(el.outerHTML, 160), owner: cssPath(pe), ownerHtml: short(pe.outerHTML, 160), text: short(n.textContent, 80), outX, outY });
            break;
          }
        }
      }
    }
    // For each text element, keep the innermost box that actually clips it.
    const byOwner = new Map();
    for (const a of out) {
      const prev = byOwner.get(a.owner);
      if (!prev || a.key.length > prev.key.length) byOwner.set(a.owner, a);
    }
    return [...byOwner.values()];
  }

  // Elements that stick out past the right edge of the viewport and cause page scroll.
  function overflowers() {
    const cw = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.right <= cw + 1 || r.width < 1 || r.height < 1) continue;
      if (!isVisible(el)) continue;
      let a = el.parentElement, contained = false;
      while (a && a !== document.body) {
        const s = getComputedStyle(a);
        if (['auto', 'scroll', 'hidden', 'clip'].includes(s.overflowX)) { contained = true; break; }
        a = a.parentElement;
      }
      if (contained) continue;
      const p = el.parentElement;
      if (p && p !== document.body && p.getBoundingClientRect().right > cw + 1) continue; // report the outermost offender
      out.push({ key: cssPath(el), html: short(el.outerHTML, 160), right: Math.round(r.right), width: Math.round(r.width) });
      if (out.length >= 10) break;
    }
    return out;
  }

  function parseColor(s) {
    const m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  }
  function lum({ r, g, b }) {
    const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function contrast(a, b) {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }
  function blend(top, under) {
    const a = top.a;
    return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
  }
  // Background behind el (exclusive), or null if an image/gradient makes it unknowable.
  function bgBehind(el) {
    const layers = [];
    let n = el.parentElement;
    while (n) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== 'none') return null;
      const c = parseColor(s.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
      n = n.parentElement;
    }
    let col = { r: 255, g: 255, b: 255, a: 1 };
    for (const c of layers.reverse()) col = blend(c, col);
    return col;
  }

  // A small no-repeat icon (a select chevron) does not paint the field, so the
  // border and fill can still be measured. A gradient or a large image cannot.
  function spotBackground(el, s) {
    const img = s.backgroundImage;
    if (!img || img === 'none' || /gradient\(/i.test(img)) return false;
    if (s.backgroundRepeat.split(',')[0].trim() !== 'no-repeat') return false;
    const box = el.getBoundingClientRect();
    const size = s.backgroundSize.split(',')[0].trim().split(/\s+/);
    const px = token => token && token.endsWith('px') ? parseFloat(token) : null;
    const w = px(size[0]);
    const h = px(size[1] || size[0]);
    if (w != null && h != null) return w <= 48 && h <= 48 && w <= box.width * 0.45 && h <= box.height * 0.45;
    let dec = img;
    try { dec = decodeURIComponent(img); } catch { /* already decoded */ }
    const mw = dec.match(/width=['"](\d+(?:\.\d+)?)['"]/i);
    const mh = dec.match(/height=['"](\d+(?:\.\d+)?)['"]/i);
    if (!mw || !mh) return false;
    const iw = parseFloat(mw[1]), ih = parseFloat(mh[1]);
    return iw <= 48 && ih <= 48 && iw <= box.width * 0.45 && ih <= box.height * 0.45;
  }

  function inputBoundaries() {
    const out = [];
    for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=image]):not([type=range]):not([type=color]):not([type=file]), textarea, select')) {
      if (!isVisible(el) || isDecoy(el)) continue;
      const s = getComputedStyle(el);
      const outside = bgBehind(el);
      if (!outside) continue;
      if (s.backgroundImage && s.backgroundImage !== 'none' && !spotBackground(el, s)) continue;
      const own = parseColor(s.backgroundColor);
      const fill = own && own.a > 0 ? blend(own, outside) : outside;
      const fillRatio = contrast(fill, outside);
      let borderRatio = 0;
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        if (parseFloat(s[`border${side}Width`]) >= 1 && s[`border${side}Style`] !== 'none') {
          const bc = parseColor(s[`border${side}Color`]);
          if (bc && bc.a > 0) borderRatio = Math.max(borderRatio, contrast(blend(bc, outside), outside));
        }
      }
      const best = Math.max(fillRatio, borderRatio);
      if (best < 3) {
        out.push({ key: cssPath(el), html: short(el.outerHTML, 160), ratio: Math.round(best * 100) / 100,
          hasShadow: s.boxShadow && s.boxShadow !== 'none' });
      }
    }
    return out;
  }

  // Hidden-from-everyone fields such as spam honeypots.
  function isDecoy(el) {
    return !!el.closest('[aria-hidden="true"],[inert]') && el.getAttribute('tabindex') === '-1';
  }

  function labelText(el) {
    const parts = [];
    if (el.id) document.querySelectorAll(`label[for="${esc(el.id)}"]`).forEach(l => parts.push(l.innerText));
    const wrap = el.closest('label'); if (wrap) parts.push(wrap.innerText);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) lb.split(/\s+/).forEach(id => parts.push(document.getElementById(id)?.innerText || ''));
    if (el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label'));
    return short(parts.join(' ').trim(), 80);
  }

  function inventory() {
    const imgs = [...document.querySelectorAll('img, [role=img], svg[aria-label]')].filter(isVisible).map(el => ({
      key: cssPath(el), tag: el.tagName.toLowerCase(),
      src: el.currentSrc ? el.currentSrc.split('/').pop().split('?')[0] : null,
      alt: el.getAttribute('alt'), label: el.getAttribute('aria-label'),
      w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height),
    }));
    const links = [...document.querySelectorAll('a[href]')].filter(isVisible).map(a => ({
      key: cssPath(a), text: short(accName(a), 100), visibleText: short(a.innerText, 100), href: a.href,
      aria: !!(a.getAttribute('aria-label') || a.getAttribute('aria-labelledby')),
      region: a.closest('header,[role=banner]') ? 'header' : a.closest('footer,[role=contentinfo]') ? 'footer' : a.closest('nav,[role=navigation]') ? 'nav' : 'main',
    }));
    const fields = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea')].filter(el => isVisible(el) && !isDecoy(el)).map(el => ({
      key: cssPath(el), type: el.type || el.tagName.toLowerCase(), name: el.name, id: el.id,
      label: labelText(el), placeholder: el.getAttribute('placeholder'), autocomplete: el.getAttribute('autocomplete'),
      required: el.required || el.getAttribute('aria-required') === 'true', form: el.form ? cssPath(el.form) : null,
    }));
    const media = [...document.querySelectorAll('video, audio, iframe')].filter(el => el.tagName !== 'IFRAME' || /youtube|vimeo|wistia|loom|player|video|soundcloud|spotify/i.test(el.src)).map(el => ({
      key: cssPath(el), tag: el.tagName.toLowerCase(), src: short(el.currentSrc || el.src, 120),
      autoplay: el.autoplay || /autoplay=1/.test(el.src || ''), muted: el.muted, controls: el.controls, loop: el.loop,
      duration: Number.isFinite(el.duration) ? Math.round(el.duration) : null, paused: el.paused,
    }));
    const iframes = [...document.querySelectorAll('iframe')].map(f => ({ key: cssPath(f), title: f.title, host: (() => { try { return new URL(f.src).host; } catch { return f.src; } })() }));
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')].filter(isVisible).map(h => ({
      level: h.getAttribute('aria-level') || h.tagName.slice(1), text: short(h.innerText, 100),
    }));
    const navRoot = document.querySelector('header nav, nav, [role=navigation], header');
    const nav = navRoot ? [...navRoot.querySelectorAll('a[href]')].map(a => `${short(a.innerText, 40) || accName(a)} -> ${new URL(a.href, location.href).pathname}`) : [];
    const gestures = [...document.querySelectorAll('[draggable=true], [aria-roledescription*=carousel i], [class*=carousel i], [class*=swiper i], [class*=slider i], [class*=marquee i], input[type=range], canvas')]
      .filter(isVisible).slice(0, 10).map(el => ({ key: cssPath(el), html: short(el.outerHTML, 140) }));
    const search = !!document.querySelector('input[type=search], [role=search], form[action*=search i]');
    return {
      title: document.title, lang: document.documentElement.lang, imgs, links, fields, media, iframes, headings, nav, gestures, search,
      hasPassword: !!document.querySelector('input[type=password]'),
      forms: document.querySelectorAll('form').length,
    };
  }

  function longAnimations() {
    if (!document.getAnimations) return [];
    const seen = new Map();
    for (const a of document.getAnimations()) {
      if (a.playState !== 'running') continue;
      const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
      if (!t) continue;
      const long = t.iterations === Infinity || (t.endTime && t.endTime > 5000);
      const target = a.effect.target;
      if (!long || !(target instanceof Element) || !isVisible(target)) continue;
      const r = target.getBoundingClientRect();
      const k = cssPath(target);
      const region = target.closest('section, header, footer, aside, nav, [role=region], [role=banner]') || document.body;
      if (!seen.has(k)) seen.set(k, { key: k, name: a.animationName || a.id || 'animation', size: `${Math.round(r.width)}x${Math.round(r.height)}`,
        infinite: t.iterations === Infinity, container: cssPath(region), containerHtml: short(region.outerHTML, 140) });
    }
    return [...seen.values()].slice(0, 40);
  }

  function toggles() {
    const sel = 'button[aria-expanded], [role=button][aria-expanded], [aria-haspopup]:not([aria-haspopup=false]), button[aria-controls], summary';
    return [...document.querySelectorAll(sel)].filter(el => isVisible(el) && !el.disabled && el.type !== 'submit' && el.tagName !== 'A').map(el => ({
      key: cssPath(el), name: short(accName(el), 60), html: short(el.outerHTML, 160),
    }));
  }

  // Hover-reveal candidates: tooltip triggers and nav items with hidden submenus.
  function hoverCandidates() {
    const out = [];
    for (const el of document.querySelectorAll('[aria-describedby]')) {
      const ids = el.getAttribute('aria-describedby').split(/\s+/);
      if (ids.some(id => document.getElementById(id)?.getAttribute('role') === 'tooltip') && isVisible(el)) out.push({ key: cssPath(el), name: short(accName(el), 60), kind: 'tooltip' });
    }
    for (const li of document.querySelectorAll('nav li, header li')) {
      const sub = li.querySelector(':scope > ul, :scope > div, :scope > [role=menu]');
      if (sub && !isVisible(sub) && sub.querySelector('a[href]') && isVisible(li)) out.push({ key: cssPath(li), name: short(li.innerText, 60), kind: 'submenu' });
    }
    return out.slice(0, 6);
  }

  // Count visible elements, used to detect content appearing after an action.
  function visibleCount() {
    let n = 0;
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width >= 1 && r.height >= 1 && getComputedStyle(el).visibility !== 'hidden') n++;
    }
    return n;
  }

  function stateOf(key) {
    const el = document.querySelector(key);
    const dialog = [...document.querySelectorAll('dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]')].find(isVisible);
    const active = deepActive();
    return {
      exists: !!el, expanded: el ? el.getAttribute('aria-expanded') : null,
      detailsOpen: el && el.tagName === 'SUMMARY' ? !!el.parentElement?.open : null,
      visible: visibleCount(), dialog: dialog ? cssPath(dialog) : null,
      focusInDialog: !!(dialog && active && dialog.contains(active)),
      focusOnTrigger: !!(el && active === el),
      activeKey: active ? cssPath(active) : null,
    };
  }

  window.__a11y = { cssPath, isVisible, describeFocus, tabbables, mouseOnly, clipped, overflowers, inputBoundaries, inventory, longAnimations, toggles, hoverCandidates, visibleCount, stateOf, deepActive };
})();
