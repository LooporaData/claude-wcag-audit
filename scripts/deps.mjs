// Locates axe-core and Playwright. A git checkout uses its own node_modules after `npm install`.
// An installed plugin has no node_modules and its folder is replaced on update, so the pinned
// versions from package-lock.json are installed once into the plugin data folder, keyed by a hash
// of the pinned packages so an update that changes them gets a fresh install.
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
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
  if (!existsSync(join(dir, 'node_modules', 'playwright'))) {
    console.error(`[a11y] installing axe-core and Playwright into ${dir}`);
    mkdirSync(dir, { recursive: true });
    for (const f of ['package.json', 'package-lock.json']) copyFileSync(join(ROOT, f), join(dir, f));
    execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
  }
  return dir;
}

export const DEPS = depsDir();
const require = createRequire(join(DEPS, 'package.json'));
export const AXE_SRC = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const pw = await import(pathToFileURL(require.resolve('playwright')).href);
export const chromium = pw.chromium ?? pw.default.chromium;
export const PLAYWRIGHT_CLI = join(dirname(require.resolve('playwright/package.json')), 'cli.js');
