// Locates axe-core and Playwright. A git checkout uses its own node_modules after `npm install`.
// An installed plugin has no node_modules and its folder is replaced on update, so the pinned
// versions from package-lock.json are installed once into the plugin data folder, keyed by a hash
// of the pinned packages so an update that changes them gets a fresh install.
import { existsSync, mkdirSync, copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function depsDir() {
  if (existsSync(join(ROOT, 'node_modules', 'playwright'))) return ROOT;
  const { '': _self, ...pinned } = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')).packages;
  const base = process.env.CLAUDE_PLUGIN_DATA || join(homedir(), '.cache', 'claude-wcag-audit');
  const dir = join(base, 'deps-' + createHash('sha256').update(JSON.stringify(pinned)).digest('hex').slice(0, 12));
  // On Windows npm is npm.cmd, which Node only runs through a shell.
  if (!existsSync(join(dir, 'node_modules', 'playwright'))) {
    console.error(`[a11y] installing axe-core and Playwright into ${dir}`);
    mkdirSync(dir, { recursive: true });
    for (const f of ['package.json', 'package-lock.json']) copyFileSync(join(ROOT, f), join(dir, f));
    execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
  }
  return dir;
}

export const DEPS = depsDir();
const require = createRequire(join(DEPS, 'package.json'));
export const AXE_SRC = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const pw = await import(pathToFileURL(require.resolve('playwright')).href);
export const chromium = pw.chromium ?? pw.default.chromium;
export const PLAYWRIGHT_CLI = join(dirname(require.resolve('playwright/package.json')), 'cli.js');

// Playwright's own browser is often absent in a plugin install. Use a Chromium
// already in the Playwright cache, or CHROME_BIN, before asking for a download.
export function cachedChromium() {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright')].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const dirs = readdirSync(root).filter(d => /^chromium(_headless_shell)?-\d+$/.test(d))
      .sort((x, y) => Number(y.split('-').pop()) - Number(x.split('-').pop()));
    for (const d of dirs) {
      for (const rel of ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell',
        'chrome-mac/headless_shell', 'chrome-linux/headless_shell', 'chrome-headless-shell-linux64/chrome-headless-shell',
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-linux/chrome', 'chrome-linux64/chrome',
        'chrome-headless-shell-win64/chrome-headless-shell.exe', 'chrome-win/headless_shell.exe', 'chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
        const p = join(root, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

export async function launchBrowser() {
  if (process.env.CHROME_BIN) return chromium.launch({ executablePath: process.env.CHROME_BIN });
  try { return await chromium.launch(); } catch (e) {
    const p = cachedChromium();
    if (p) {
      console.error(`[a11y] bundled browser missing, using cached ${p}`);
      return chromium.launch({ executablePath: p });
    }
    throw new Error(`No Chromium available. Run "node ${PLAYWRIGHT_CLI} install chromium" or set CHROME_BIN.\n${e.message}`);
  }
}
