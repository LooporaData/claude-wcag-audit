#!/usr/bin/env node
// usage: node render.mjs <audit-dir>
// Re-renders report.md and report.html from <audit-dir>/results.json, applying
// verification notes from <audit-dir>/notes.json if present.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderReport } from './report.mjs';
import { renderHtml } from './html-report.mjs';

const dir = process.argv[2];
if (!dir) { console.error('usage: node render.mjs <audit-dir>'); process.exit(2); }
const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
const notesPath = join(dir, 'notes.json');
if (existsSync(notesPath)) results.notes = JSON.parse(readFileSync(notesPath, 'utf8'));
writeFileSync(join(dir, 'report.md'), renderReport(results));
writeFileSync(join(dir, 'report.html'), renderHtml(results));
console.error(`[a11y] wrote report.md and report.html in ${dir}${results.notes ? ` with ${Object.keys(results.notes).length} notes` : ''}`);
