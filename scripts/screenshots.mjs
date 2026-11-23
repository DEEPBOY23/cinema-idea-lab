// Captures pleine page de toutes les pages de l'app, avec des données de démonstration.
// Utilise Chrome installé sur le Mac, dans un profil temporaire isolé (tes vraies données ne sont pas touchées).
// Usage : npm run build && node scripts/screenshots.mjs "<dossier de sortie>"
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'captures';
const FULL = process.env.FULL !== '0'; // FULL=0 : capture au format écran (maquettes)
const PORT = 4190;
const BASE = `http://localhost:${PORT}/`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const profile = mkdtempSync(join(tmpdir(), 'cil-shots-'));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, args: ['--no-first-run', '--hide-scrollbars', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

try {
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!globalThis.__cilDb);
  const ids = await page.evaluate(seed);

  const routes = [
    ['01-accueil', '#/'],
    ['02-bac-a-idees', '#/bac'],
    ['03-formats', '#/formats'],
    ['04-format-color-stories', '#/formats/fmt-color-stories'],
    ['05-idees', '#/ideas'],
    ['05b-articles', '#/articles'],
    ['06-fiche-idee', `#/ideas/${ids.idea}`],
    ['07-documentation-sources', '#/docs'],
    ['08-documentation-notes', '#/docs?tab=notes'],
    ['09-documentation-documents-locaux', '#/docs?tab=files'],
    ['10-documentation-rechercher', `#/docs?tab=search&idea=${ids.idea}`],
    ['11-fiche-source', `#/docs/source/${ids.source}`],
    ['12-notes-apres-lecture', `#/docs/note/${ids.note}`],
    ['13-atelier-trouver-des-sources', `#/atelier?mode=inspiration&idea=${ids.idea}`],
    ['14-atelier-construire-mon-idee', `#/atelier?mode=development&idea=${ids.idea}`],
    ['15-atelier-relire-mon-script', `#/atelier?mode=diagnostic&idea=${ids.scripted}`],
    ['16-atelier-ecrire-avec-aide', `#/atelier?mode=writing&idea=${ids.scripted}`],
    ['17-atelier-tester-mon-idee', `#/atelier?mode=challenge&idea=${ids.idea}`],
    ['18-filmotheque', '#/films'],
    ['19-fiche-film', `#/films/${ids.work}`],
    ['20-planning', '#/planning'],
    ['21-statistiques', '#/stats'],
    ['22-parametres', '#/settings'],
  ];

  for (const [device, vp] of [['ordinateur', FULL ? { width: 1280, height: 800 } : { width: 1440, height: 900 }], ['telephone', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    const dir = join(OUT, device);
    mkdirSync(dir, { recursive: true });
    await page.setViewport(vp);
    for (const [name, hash] of routes) {
      await page.goto(BASE + hash, { waitUntil: 'networkidle0' });
      await page.reload({ waitUntil: 'networkidle0' }); // relit les paramètres de l'URL (mode de l'atelier)
      await new Promise((r) => setTimeout(r, 600));
      await page.evaluate(() => {
        document.querySelectorAll('details').forEach((d) => { d.open = true; });
        window.scrollTo(0, 0);
      });
      if (FULL) await page.addStyleTag({ content: '.tabbar{position:static!important;margin:16px 12px} .main{padding-bottom:16px!important} .topbar-wrap{position:static!important}' });
      await new Promise((r) => setTimeout(r, 1200));
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: FULL });
      console.log(device, name);
    }
  }
} finally {
  await browser.close();
  server.kill();
  rmSync(profile, { recursive: true, force: true });
}

// ----- Données de démonstration (exécuté dans la page) -----
async function seed() {
  const db = globalThis.__cilDb;
  const D = 86400000, now = Date.now();
  const id = () => crypto.randomUUID();
  const W = (title, year, director, seen, extra = {}) => ({ id: id(), title, year, director, kind: 'film', seen, notes: '', scenes: '', createdAt: now, updatedAt: now, ...extra });
  const her = W('Her', 2013, 'Spike Jonze', 'seen', { seenDate: '2025-03-14', notes: '[Démo] Palette chaude omniprésente, très peu de bleu.', scenes: '[Démo] La scène de la plage (≈ 1 h 10).\n[Démo] Le métro, quand Theodore parle à Samantha.' });
  const mood = W('In the Mood for Love', 2000, 'Wong Kar-wai', 'seen');
  const br = W('Blade Runner 2049', 2017, 'Denis Villeneuve', 'partial');
  const drive = W('Drive', 2011, 'Nicolas Winding Refn', 'unseen');
  await db.works.bulkAdd([her, mood, br, drive]);

  const sugg = (formats, total) => ({ formats, estimate: { level: 'moderate', docHours: Math.round(total * 0.4 * 2) / 2, shootHours: Math.round(total * 0.2 * 2) / 2, editHours: Math.round(total * 0.4 * 2) / 2, totalHours: total, why: '[Démo] Estimation d’exemple.' }, source: 'local', at: now });
  const mk = async (o, age, steps) => {
    const created = now - age * D - 12 * D;
    const i = { id: id(), workIds: [], category: 'analyse', createdAt: created, updatedAt: now - age * D, lastActivityAt: now - age * D, status: steps.at(-1)?.[0] ?? 'idea', observation: '', angle: '', hook: '', angles: [], structure: [], script: '', missingInfo: '', priority: 2, avDifficulty: 2, paused: false, comments: [], ...o };
    await db.ideas.add(i);
    await db.events.add({ id: id(), ideaId: i.id, type: 'created', at: created });
    let prev = 'idea';
    for (const [to, d] of steps) { await db.events.add({ id: id(), ideaId: i.id, type: 'status', from: prev, to, at: created + d * D }); prev = to; }
    return i;
  };
  const beats = [['Hook : la couleur à l’écran', 5], ['Première apparition', 12], ['Transformation', 18], ['Ce que ça raconte', 15], ['Chute / ouverture', 6]].map(([label, seconds]) => ({ id: id(), label, seconds, content: '[Démo] intention de ce temps fort' }));
  const main = await mk({
    title: '[Démo] Le corail qui suit Theodore', workIds: [her.id], formatId: 'fmt-color-stories', priority: 1,
    observation: '[Démo] Dans Her, le corail et le rouge accompagnent Theodore. Hypothèse : la couleur remplace la présence physique de Samantha.',
    angle: '[Démo] La couleur comme corps absent', hook: '[Démo] Et si le personnage principal de Her était une couleur ?',
    angles: [{ id: id(), text: '[Démo] La couleur comme corps absent', chosen: true, origin: 'moi' }, { id: id(), text: '[Démo] Un futur sans bleu', chosen: false, origin: 'claude' }],
    structure: beats, research: { level: 'moderate', justification: '[Démo] intention à sourcer', sourcesNeeded: '[Démo] interview du chef opérateur', missing: '[Démo] confirmer le choix de palette', docHours: 3, shootHours: 1, editHours: 3 },
    suggestions: { formats: [{ formatId: 'fmt-color-stories', fit: 'high', reason: '[Démo] Une couleur porte le récit du début à la fin.', angle: '[Démo] La couleur comme corps absent', structureName: 'Évolution' }, { formatId: 'fmt-feel-the-frame', fit: 'conditional', reason: '[Démo] Possible si on se concentre sur la solitude de Theodore.', angle: '[Démo] Être seul dans un monde chaud' }], estimate: { level: 'moderate', docHours: 3, shootHours: 1, editHours: 3, totalHours: 7, why: '[Démo] Intention à documenter, extraits comparatifs.' }, source: 'ia', model: 'démo', at: now },
    comments: [{ id: id(), at: now - D, text: '[Démo] Revoir la scène de la plage avant d’écrire.' }],
  }, 2, [['documentation', 1], ['angle', 5], ['structure', 9]]);
  const scripted = await mk({ title: '[Démo] Un couloir, un ralenti', workIds: [mood.id], formatId: 'fmt-feel-the-frame', script: '[Démo] Regarde ce couloir. Il est étroit, rouge, et la caméra ralentit. Wong Kar-wai ne filme pas deux amoureux : il filme deux personnes qui n’ont pas le droit de l’être. Chaque passage dans ce couloir est une occasion manquée. Le ralenti étire ce moment interdit, et la musique revient comme un souvenir. À la fin, on comprend que le couloir était le seul endroit où ils pouvaient se frôler.', suggestions: sugg([{ formatId: 'fmt-feel-the-frame', fit: 'high', reason: '[Démo] émotion portée par le cadre et le rythme', angle: '' }], 5) }, 14, [['documentation', 1], ['angle', 4], ['structure', 6], ['script', 8]]);
  await mk({ title: '[Démo] Règle des 180° brisée', formatId: 'fmt-visual-rule', suggestions: sugg([{ formatId: 'fmt-visual-rule', fit: 'high', reason: '[Démo]', angle: '' }], 3) }, 30, []);
  await mk({ title: '[Démo] Plan d’ouverture du désert', workIds: [br.id], formatId: 'fmt-one-shot' }, 60, [['documentation', 2]]);
  await mk({ title: '[Démo] Focale 24 vs 85 mm', formatId: 'fmt-experiments', category: 'technique' }, 1, [['documentation', 1], ['structure', 3], ['production', 5], ['done', 7], ['published', 9]]);
  await mk({ title: '[Démo] Lumière néon', workIds: [br.id], formatId: 'fmt-creative-decisions' }, 3, [['documentation', 1], ['angle', 3], ['structure', 6], ['production', 8], ['done', 9]]);
  await db.sessions.bulkAdd([
    { id: id(), ideaId: main.id, phase: 'documentation', start: now - 3 * D, minutes: 95 },
    { id: id(), ideaId: main.id, phase: 'ecriture', start: now - 2 * D, minutes: 40 },
  ]);

  const source = { id: id(), title: '[Démo] Exemple de source à vérifier', url: 'https://theasc.com', author: '[Démo] Auteur', media: 'American Cinematographer', date: '2014', type: 'Interview directeur photo', topics: ['couleur', 'palette'], interest: '[Démo] Pourrait confirmer l’intention de palette.', minutes: 15, state: 'reading', access: 'unverified', ideaIds: [main.id], workIds: [her.id], createdAt: now, updatedAt: now };
  await db.sources.bulkAdd([source,
    { ...source, id: id(), title: '[Démo] Analyse de mise en scène', state: 'toread', type: 'Analyse de mise en scène', access: 'verified' },
    { ...source, id: id(), title: '[Démo] Making-of', state: 'read', type: 'Making-of / BTS' },
    { ...source, id: id(), title: '[Démo] Le rouge chez Wong Kar-wai', url: 'https://example.org/wkw-rouge', state: 'toread', ideaIds: [scripted.id], workIds: [] },
    { ...source, id: id(), title: '[Démo] Ralenti et mémoire', url: 'https://example.org/ralenti', state: 'deepen', ideaIds: [scripted.id], workIds: [] },
    { ...source, id: id(), title: '[Démo] Article à ranger', url: 'https://example.org/a-ranger', state: 'toread', ideaIds: [], workIds: [] }]);
  const note = { id: id(), sourceId: source.id, ideaId: main.id, title: '[Démo] Notes — palette de Her', learned: '[Démo] Ce que j’ai appris en lisant.', surprised: '[Démo] Ce qui m’a surpris.', observations: '[Démo] Mes propres observations.', rewatch: '[Démo] Scène de la plage.', toVerify: '[Démo] Le bleu a-t-il été évité volontairement ?', toDeepen: '[Démo] Lien entre couleur et voix.', claims: [{ id: id(), text: '[Démo] Exemple de fait documenté', nature: 'fact', ref: 'source, p. 2' }, { id: id(), text: '[Démo] Exemple d’interprétation personnelle', nature: 'interpretation', ref: '' }, { id: id(), text: '[Démo] Exemple d’hypothèse', nature: 'hypothesis', ref: '' }], createdAt: now, updatedAt: now };
  await db.notes.add(note);
  await db.leads.bulkAdd([
    { id: id(), noteId: note.id, ideaId: main.id, point: 'palette', kind: 'question', text: '[Démo] Quelle couleur disparaît quand Samantha s’éloigne ?', state: 'accepted', createdAt: now, updatedAt: now },
    { id: id(), noteId: note.id, ideaId: main.id, point: 'palette', kind: 'axis', text: '[Démo] La couleur comme voix visible', state: 'proposed', createdAt: now, updatedAt: now },
    { id: id(), noteId: note.id, ideaId: main.id, point: 'palette', kind: 'link', text: '[Démo] Le rouge chez Wong Kar-wai', state: 'rejected', createdAt: now, updatedAt: now },
  ]);
  await db.journal.add({ id: id(), ideaId: main.id, at: now - D, text: '[Démo] Angle choisi : la couleur comme corps absent' });

  const batch = id();
  const inbox = (title, raw, f, total) => ({ id: id(), batchId: batch, title, summary: `[Démo] ${raw.slice(0, 70)}`, raw, works: [], suggestions: sugg(f, total), status: 'pending', createdAt: now, updatedAt: now });
  await db.inbox.bulkAdd([
    inbox('[Démo] Tester un 24 mm contre un 85 mm', 'Tester un 24 mm contre un 85 mm sur un visage.', [{ formatId: 'fmt-experiments', fit: 'high', reason: '[Démo] démonstration filmée', angle: '[Démo] La focale change le caractère' }], 4),
    inbox('[Démo] Le désert vide de Villeneuve', 'Pourquoi Villeneuve filme le désert si vide ?', [{ formatId: 'fmt-creative-decisions', fit: 'high', reason: '[Démo] choix de mise en scène', angle: '[Démo] Le vide comme menace' }, { formatId: 'fmt-one-shot', fit: 'conditional', reason: '[Démo] si on isole un plan', angle: '' }], 9),
    inbox('[Démo] Le regard caméra', 'Quand un personnage regarde la caméra.', [{ formatId: 'fmt-visual-rule', fit: 'high', reason: '[Démo] règle du langage', angle: '[Démo] Briser le 4e mur' }], 3),
  ]);
  return { idea: main.id, scripted: scripted.id, source: source.id, note: note.id, work: her.id };
}
