---
name: wcag-audit
description: Audit a website or web app against WCAG 2.1/2.2 Level A and AA. Runs axe-core plus scripted keyboard, focus, zoom, reflow, text-spacing, motion, menu/dialog and cross-page checks with Playwright, then produces a success-criterion matrix, verified findings and a manual checklist. Use for "accessibility audit", "a11y", "WCAG", "check accessibility", "is the site accessible".
---

# Accessibility audit (WCAG 2.1/2.2 A+AA)

Automated tools can't certify WCAG conformance. This skill automates as much as it reasonably can, says plainly which criteria are covered and how well, and leaves a checklist for the rest. Never present a clean automated result as "WCAG compliant".

## 1. Pick the target

- **Live or staging URL**: use it directly.
- **Local project**: start the dev server in the background, wait for HTTP 200, and audit `http://localhost:<port>`. Stop the server afterwards.
- **Pages**: the script reads `<base>/sitemap.xml` (including sitemap indexes). Without one it crawls links from the home page. Use `--pages /a,/b` for an explicit list, and include pages with forms, dialogs and other interactive features if the sitemap misses them.
- Only audit sites the user owns or has asked about. The script never submits forms, but it does click menu and disclosure toggles and change `<select>` values.

## 2. Run the audit

On the first run the script installs the pinned axe-core and Playwright into the plugin's data folder, which takes about a minute and needs network access. If Playwright's bundled browser is missing, the script falls back to any Chromium in the Playwright cache, or `CHROME_BIN`. Otherwise its error message gives the exact `install chromium` command to run.

```bash
CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/scripts/audit.mjs" <base-url> --out <scratch-dir>/a11y-report \
  [--pages /,/contact] [--max-pages 40] [--concurrency 3] [--max-tabs 200] \
  [--skip keyboard,toggles,hover,mobile,zoom,spacing]
```

It takes about 20 to 40 seconds per page at concurrency 3, so run it in the background for more than a few pages. Write output to the scratchpad unless the user names a location. It writes:

- `report.md`
- `report.html`: self-contained, works offline, light and dark, criteria filter, saved checklist ticks
- `results.json`
- `shots/`: focus screenshots

axe-core is an npm dependency (pinned in `package-lock.json`). The script injects it through Playwright with CSP bypass, so strict Content-Security-Policy headers don't block it.

### What it checks

| Check | Viewport | WCAG |
|---|---|---|
| axe-core, tags wcag2a/aa, wcag21a/aa, wcag22aa, best-practice; violations and "needs review" | desktop 1280, mobile 390 | many |
| Keyboard walk with Tab: every stop gets a focused vs. unfocused pixel diff, a visibility check and a "covered by sticky/fixed content" check | desktop | 2.4.7, 2.4.11, 2.4.3 |
| Keyboard trap and focus-loop detection, elements never reached by Tab, URL change or popup on focus | desktop | 2.1.1, 2.1.2, 3.2.1 |
| Skip link target exists | desktop | 2.4.1 |
| Clickable-looking elements (cursor:pointer) that can't take focus | desktop | 2.1.1 |
| Menus, disclosures, dialogs: open with Enter/Space vs click, aria-expanded updates, axe on the opened state, focus moves into dialogs, Escape closes, focus returns | desktop, mobile | 2.1.1, 4.1.2, 2.4.3 |
| Hover-revealed submenus and tooltips: also appear on focus, dismiss with Escape | desktop | 1.4.13, 2.1.1 |
| WCAG text-spacing overrides, newly clipped text | desktop | 1.4.12 |
| 200% zoom (640x400 at 2x), newly clipped text | zoom200 | 1.4.4 |
| 400% zoom (320x256 at 4x), horizontal scroll and offending elements, clipped text | reflow | 1.4.10 |
| Form field boundary contrast (3:1) | desktop | 1.4.11 |
| Personal-data fields without autocomplete tokens, placeholder-only labels | desktop | 1.3.5, 3.3.2 |
| Infinite or >5s animations, autoplay media, whether prefers-reduced-motion stops them | desktop | 2.2.2, 1.4.2 |
| Changing a `<select>` navigates | desktop | 3.2.2 |
| Generic and ambiguous link text, filename-like alt text | desktop | 2.4.4, 1.1.1 |
| Duplicate titles, navigation order, help/contact link placement across pages | site | 2.4.2, 3.2.3, 3.2.6 |

The criteria map with coverage levels and manual instructions is in `scripts/wcag.mjs`.

## 3. Verify before reporting

`report.md` separates **Fail** (confident), **Likely fail** (heuristic), **Needs review** and **Best practice**. Before telling the user something fails:

- **Likely fail**: confirm each group with at least one example. Look at the focus screenshot in `shots/`, or open the page with browser tools and reproduce it: Tab to the element, zoom, apply the spacing CSS. Drop false positives and say you did.
- **axe "needs review" color contrast** (gradients, images, overlapping elements): measure a sample. Take a screenshot and read the pixel colors, or compute them from the computed styles. Report real failures and summarize the rest.
- **Repeated components**: a header or footer problem shows up on every page. Report it once, with its scope.
- **Best-practice findings** (axe `best-practice` rules, Escape handling, reduced motion) aren't WCAG A/AA failures. Keep them separate.

Record what you verified in `<out>/notes.json`, keyed by check id (the `Check` value in the report, e.g. `input-boundary-contrast` or `axe-review:target-size`):

```json
{ "<check>": { "verdict": "confirmed | false-positive | no-issue | decision", "note": "what you measured or what needs deciding" } }
```

- `confirmed` turns a likely fail or review item into a fail.
- `false-positive` and `no-issue` move the group to "Resolved during verification" and drop it from the criteria results.
- `decision` keeps it under Needs review, labeled as needing the owner's decision.
- A note with no verdict just annotates the group.

Then regenerate both reports without rescanning: `node "${CLAUDE_PLUGIN_ROOT}/scripts/render.mjs" <out>`. If a false positive comes from a heuristic in the script, fix the script too and rerun the fixture checks before relying on it.

## 4. Report to the user

Lead with the outcome in a sentence or two, then:

1. **Verified failures**: grouped by issue, with the WCAG criterion and level, scope (pages, element count), one example (selector plus HTML), and a specific fix. Order them by user impact (keyboard and focus blockers, contrast, reflow and zoom, then the rest).
2. **Needs review**: the items that need a human decision, briefly.
3. **Coverage**: how many of the A/AA criteria failed, need review, passed the automated checks (and whether that coverage is good or partial), or are manual only. Use the matrix in `report.md`.
4. **Manual checklist**: what still has to be tested by a person (screen reader pass, captions, error handling on forms in a test environment, content quality). Use the evidence section of `report.md`: alt text inventory, headings, forms, media.
5. Paths to `report.html`, `report.md` and `results.json`.

If the user wants a shareable report, offer to publish `report.html` as an artifact (screenshots in `shots/` go with it as supporting files) instead of pasting `report.md` into chat.

## Optional: source linting

For React/JSX codebases, `eslint-plugin-jsx-a11y` catches some problems before they ship. Ask before adding it as a dependency. It mostly overlaps with axe and doesn't replace the runtime audit.

## Limits

These are not automated, so always list them as manual:

- **Screen reader behavior:** announcements, live regions and status messages (4.1.3).
- **Media:** captions and audio description (1.2.x), flashing content (2.3.1).
- **Forms:** error identification, suggestions and prevention (3.3.1, 3.3.3, 3.3.4). The script won't submit forms on a live site.
- **Meaning and quality:** alt text and link text quality, heading and label quality, sensory instructions, use of color beyond links.
- **Pointer and device input:** gestures, dragging, pointer cancellation, motion actuation.
- **Single-key shortcuts** (2.1.4).
- **Logged-in areas:** the script runs in a fresh browser with no session.
