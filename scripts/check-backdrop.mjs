// Vérifie que le fond est animé : deux captures à 4 s d'écart doivent différer (sans données ni compte).
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const OUT = process.argv[2] ?? '.';
const server = spawn('npx', ['vite', 'preview', '--port', '4191', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const profile = mkdtempSync(join(tmpdir(), 'cil-bg-'));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: profile, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto('http://localhost:4191/#/stats', { waitUntil: 'networkidle0' });
  await page.addStyleTag({ content: '.main, .topbar-wrap, .tabbar, .sidebar { visibility: hidden !important; }' });
  await new Promise((r) => setTimeout(r, 2000));
  const a = await page.screenshot(); await new Promise((r) => setTimeout(r, 4000)); const b = await page.screenshot();
  writeFileSync(join(OUT, 'fond-t0.png'), a); writeFileSync(join(OUT, 'fond-t4s.png'), b);
  const diff = await page.evaluate(async (x, y) => {
    const load = (s) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = 'data:image/png;base64,' + s; });
    const [ia, ib] = await Promise.all([load(x), load(y)]);
    const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height; const g = c.getContext('2d');
    g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, c.width, c.height).data; g.drawImage(ib, 0, 0); const db = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0, sum = 0; for (let i = 0; i < da.length; i += 4) { const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]); sum += d; if (d > 6) n++; }
    return { changed: n / (da.length / 4), mean: sum / (da.length / 4) };
  }, a.toString('base64'), b.toString('base64'));
  console.log(`Pixels qui ont bougé en 4 s : ${(diff.changed * 100).toFixed(1)} % · écart moyen ${diff.mean.toFixed(1)}`);
  console.log(diff.changed > 0.05 ? 'Fond ANIMÉ ✓' : 'Fond quasi FIGÉ ✗');
} finally { await browser.close(); server.kill(); rmSync(profile, { recursive: true, force: true }); }
