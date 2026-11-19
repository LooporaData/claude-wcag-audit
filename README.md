# claude-wcag-audit

A Claude Code skill that audits a website against WCAG 2.1 and 2.2 Level A and AA.

Running axe-core on each page is a good start, but axe only has rules for about 22 of the 50 WCAG 2.1 A/AA success criteria, often partially, and it doesn't test keyboard operation, focus visibility, zoom, reflow, text spacing or interactive states. This skill adds scripted Playwright checks for those, reports a status for every criterion, and leaves a manual checklist for what can't be automated.

## Install

```bash
git clone https://github.com/LooporaData/claude-wcag-audit ~/.claude/skills/a11y
cd ~/.claude/skills/a11y && npm install
```

Claude Code loads skills from `~/.claude/skills/<name>/SKILL.md` (or `.claude/skills/` inside a project), so no settings change is needed. The audit uses Playwright's Chromium. If it isn't installed, the script falls back to any Chromium already in the Playwright cache, or to `CHROME_BIN`. Otherwise run `npx playwright install chromium`.

## Use

Ask Claude Code to audit a site ("run an accessibility audit on https://example.com", or `/a11y`). Claude runs the script, verifies the heuristic findings, records its conclusions and reports back.

You can also run the script directly:

```bash
node scripts/audit.mjs https://example.com --out a11y-report
node scripts/audit.mjs http://localhost:3000 --pages /,/contact,/pricing --out a11y-report
```

| Option | Default | Notes |
|---|---|---|
| `--sitemap URL` | `<base>/sitemap.xml` | Sitemap indexes are followed. Without a sitemap the home page links are crawled. |
| `--pages /a,/b` | | Explicit page list, paths or full URLs |
| `--max-pages N` | 40 | |
| `--concurrency N` | 3 | Pages audited in parallel |
| `--max-tabs N` | 200 | Tab presses per page in the keyboard walk |
| `--skip list` | | Any of `keyboard,toggles,hover,mobile,zoom,spacing` |
| `--out DIR` | `./a11y-report` | |

A page takes about 20 to 40 seconds. The script never submits forms, but it does open menus, dialogs and disclosures, and changes `<select>` values, so point it at sites you own.

## What it checks

- **axe-core 4.10.2** with the `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` and `best-practice` tags, at desktop and mobile widths. axe is installed from npm and injected through Playwright, so a strict Content-Security-Policy doesn't block it. axe's "needs review" results are reported instead of dropped.
- **Keyboard walk.** Tabs through every page. At each stop it compares screenshots with and without focus to detect missing focus indicators (2.4.7), checks whether a sticky header or banner covers the focused element (2.4.11), and flags focus on invisible elements. It also detects keyboard traps (2.1.2), interactive elements Tab never reaches (2.1.1), backwards jumps in focus order (2.4.3), focus that changes the page (3.2.1) and broken skip links (2.4.1).
- **Interactive states.** Opens each menu, disclosure and dialog trigger with Enter and Space and compares that with a mouse click (2.1.1). Checks that `aria-expanded` updates (4.1.2), reruns axe on the opened state, and checks that focus moves into dialogs, that Escape closes them and that focus returns to the trigger. Hover-revealed submenus and tooltips must also appear on keyboard focus and dismiss with Escape (1.4.13).
- **Zoom and spacing.** 200% zoom (1.4.4) and 400% / 320 CSS px reflow (1.4.10) as real viewports, plus the WCAG text-spacing overrides (1.4.12). It reports horizontal scrolling with the offending elements, and text that becomes clipped.
- **Forms.** Field boundary contrast of 3:1 (1.4.11), autocomplete tokens on personal-data fields (1.3.5), placeholder-only labels (3.3.2), and `<select>` changes that navigate (3.2.2).
- **Motion.** Infinite or longer-than-5-second animations and autoplaying media (2.2.2, 1.4.2), and whether `prefers-reduced-motion` stops them.
- **Content and consistency.** Generic or ambiguous link text (2.4.4), filename-like alt text (1.1.1), duplicate titles (2.4.2), navigation order (3.2.3) and help-link placement (3.2.6) across pages.

`scripts/wcag.mjs` maps each criterion to its checks, how good the coverage is, and the manual steps that remain.

## Output

- `report.html`: a self-contained report that works offline, in light and dark mode. It has the criteria matrix with filters, findings grouped across pages, a manual checklist that remembers ticks, evidence for manual review (alt text, forms, headings, media) and a summary per page. It passes its own audit.
- `report.md`: the same content as Markdown.
- `results.json`: raw findings.
- `shots/`: screenshots for focus-indicator findings.

Findings are graded **Fail** (confident), **Likely fail** (heuristic), **Needs review** or **Best practice**. Automated testing can't establish conformance, and the report says so.

### Verification notes

After checking findings, record the conclusions in `<out>/notes.json` and re-render without rescanning:

```json
{
  "input-boundary-contrast": { "verdict": "confirmed", "note": "Border #919ab0 on white measured at 2.82:1." },
  "motion-no-pause": { "verdict": "decision", "note": "Hero loops stop under reduced motion; product owner to decide on a pause control." }
}
```

```bash
node scripts/render.mjs a11y-report
```

- `confirmed` promotes a likely fail or review item to a fail.
- `false-positive` and `no-issue` move the item to "Resolved during verification" and leave it out of the criteria results.
- `decision` keeps it under review, labeled for the owner.

## Testing

`test/fixture.html` is a page with planted failures: a missing focus indicator, an off-screen focusable link, a sticky banner covering focus, clipped text under text spacing, a page too wide at 320px, a click-only toggle, a broken skip link, a low-contrast input, and more. After changing a heuristic, serve it and confirm every check still fires:

```bash
(cd test && python3 -m http.server 8765) &
node scripts/audit.mjs http://localhost:8765 --pages /fixture.html --out /tmp/fixture-report
```

## Limits

Some things still need a person: screen reader announcements and status messages, captions and audio description, form error handling (the script won't submit forms), the quality of alt text, link text and headings, pointer gestures, single-key shortcuts, and anything behind a login.

## License

MIT, see [LICENSE](LICENSE).

Dependencies are installed by `npm install` and aren't stored in this repository: [axe-core](https://github.com/dequelabs/axe-core) by Deque Systems ([MPL-2.0](https://www.mozilla.org/MPL/2.0/)) and [Playwright](https://github.com/microsoft/playwright) (Apache-2.0). Versions are pinned in `package.json` and `package-lock.json`.

Inspired by [airowe/claude-a11y-skill](https://github.com/airowe/claude-a11y-skill), which ran axe-core from a Claude Code skill.
