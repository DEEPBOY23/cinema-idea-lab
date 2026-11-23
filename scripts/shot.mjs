// Capture rapide d'une route : node scripts/shot.mjs "<url>" <largeur> <hauteur> <fichier> [attente ms]
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [url, w = '1440', h = '900', out = 'shot.png', wait = '2500'] = process.argv.slice(2);
const profile = mkdtempSync(join(tmpdir(), 'cil-shot-'));
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: profile, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
const p = await b.newPage();
await p.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
await p.goto(url, { waitUntil: 'networkidle0' });
if (process.env.HIDEUI) await p.addStyleTag({ content: '.sidebar,.topbar-wrap,.tabbar,.main,.toasts,.backdrop-dither{display:none!important}' });
await new Promise((r) => setTimeout(r, +wait));
await p.screenshot({ path: out, ...(out.endsWith('.jpg') ? { type: 'jpeg', quality: 82 } : {}) });
await b.close(); rmSync(profile, { recursive: true, force: true });
