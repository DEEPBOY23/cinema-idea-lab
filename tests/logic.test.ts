import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { LabDB } from '../src/schema';
import { exportAll, importBackup, autoBackupIfDue } from '../src/lib/backup';
import { ageTone } from '../src/lib/aging';
import { milestones, segmentDurations, timeInStatus, computeDashboard } from '../src/lib/stats';
import { isoWeek, shiftWeek, weekStart, median, DAY } from '../src/lib/util';
import { analyzeScript, diffWords, extractLinks, parseList, oralSeconds } from '../src/lib/text';
import type { Idea, IdeaEvent } from '../src/types';

const base = (o: Partial<Idea> = {}): Idea => ({
  id: 'i1', title: 'T', workIds: [], category: 'analyse', createdAt: 0, updatedAt: 0, lastActivityAt: 0, status: 'idea',
  observation: '', angle: '', hook: '', angles: [], structure: [], script: '', missingInfo: '', priority: 2, avDifficulty: 2,
  paused: false, comments: [], ...o,
});

describe('dates', () => {
  it('semaines ISO', () => {
    expect(isoWeek(new Date(2026, 0, 1))).toBe('2026-W01'); // jeudi
    expect(isoWeek(new Date(2027, 0, 1))).toBe('2026-W53');
    expect(isoWeek(new Date(2026, 10, 22))).toBe('2026-W47'); // dimanche
    expect(isoWeek(new Date(2026, 10, 23))).toBe('2026-W48'); // lundi
    expect(weekStart('2026-W48').getDate()).toBe(23);
    expect(shiftWeek('2026-W53', 1)).toBe('2027-W01');
  });
  it('médiane', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });
});

describe('couleurs d’ancienneté', () => {
  const th: [number, number, number] = [7, 21, 45];
  const now = 100 * DAY;
  it('seuils', () => {
    expect(ageTone(base({ lastActivityAt: now - 3 * DAY }), th, now).tone).toBe('fresh');
    expect(ageTone(base({ lastActivityAt: now - 7 * DAY }), th, now).tone).toBe('fresh');
    expect(ageTone(base({ lastActivityAt: now - 8 * DAY }), th, now).tone).toBe('amber');
    expect(ageTone(base({ lastActivityAt: now - 30 * DAY }), th, now).tone).toBe('terracotta');
    expect(ageTone(base({ lastActivityAt: now - 60 * DAY }), th, now).tone).toBe('bordeaux');
  });
  it('réalisée/publiée restent vertes', () => {
    expect(ageTone(base({ status: 'done', lastActivityAt: 0 }), th, now).tone).toBe('done');
    expect(ageTone(base({ status: 'published', lastActivityAt: 0 }), th, now).tone).toBe('published');
    expect(ageTone(base({ paused: true, lastActivityAt: 0 }), th, now).tone).toBe('paused');
  });
});

describe('statistiques', () => {
  const idea = base({ createdAt: 0, status: 'published' });
  const ev = (to: IdeaEvent['to'], from: IdeaEvent['from'], d: number): IdeaEvent => ({ id: `${to}${d}`, ideaId: 'i1', type: 'status', from, to, at: d * DAY });
  const events = [ev('documentation', 'idea', 2), ev('angle', 'documentation', 5), ev('documentation', 'angle', 6), ev('structure', 'documentation', 9), ev('done', 'structure', 12), ev('published', 'done', 14)];
  it('jalons = première entrée, retours conservés', () => {
    const m = milestones(idea, events);
    expect(m.documentation).toBe(2 * DAY);
    expect(m.docEnd).toBe(5 * DAY);
    const s = segmentDurations(m);
    expect(s.create_doc).toBe(2 * DAY);
    expect(s.doc_struct).toBe(7 * DAY);
    expect(s.struct_done).toBe(3 * DAY);
    expect(s.create_done).toBe(12 * DAY);
    expect(s.done_pub).toBe(2 * DAY);
  });
  it('temps par statut, avec retour en arrière', () => {
    const t = timeInStatus(idea, events, 20 * DAY);
    expect(t.documentation).toBe(3 * DAY + 3 * DAY);
    expect(t.angle).toBe(1 * DAY);
    expect(t.published).toBeUndefined();
  });
  it('étape sautée = pas de durée', () => {
    const m = milestones(base(), [ev('done', 'idea', 4)]);
    const s = segmentDurations(m);
    expect(s.create_done).toBe(4 * DAY);
    expect(s.doc_struct).toBeUndefined();
  });
  it('tableau de bord', () => {
    const d = computeDashboard({ ideas: [idea], events, sessions: [{ id: 's', ideaId: 'i1', phase: 'documentation', start: 0, minutes: 90 }], formats: [], sourcesCount: { i1: 2 } }, 20 * DAY);
    expect(d.doneCount).toBe(1);
    expect(d.publishedCount).toBe(1);
    expect(d.mostDoc[0].docWorked).toBe(90);
    expect(d.bottlenecks[0].status.id).toBe('documentation');
  });
});

describe('texte', () => {
  it('durée orale et analyse', () => {
    const t = 'Regarde ce plan. ' + 'mot '.repeat(148);
    expect(oralSeconds(t, 150)).toBe(60);
    const a = analyzeScript(t, 150, { min: 30, max: 45 });
    expect(a.hook.text).toBe('Regarde ce plan.');
    expect(a.target?.verdict).toBe('over');
  });
  it('diff', () => {
    const d = diffWords('la lumière est douce', 'la lumière est dure');
    expect(d.some((p) => p.type === 'del' && p.text.includes('douce'))).toBe(true);
    expect(d.some((p) => p.type === 'add' && p.text.includes('dure'))).toBe(true);
  });
  it('import de liens et listes', () => {
    const l = extractLinks('- Interview DP : https://example.com/a\n- [Article](https://example.org/b).\nhttps://example.com/a');
    expect(l.map((x) => x.url)).toEqual(['https://example.org/b', 'https://example.com/a']);
    expect(parseList('Intro :\n1. Premier angle\n2. Second\n   suite')).toEqual(['Premier angle', 'Second suite']);
  });
});

describe('sauvegarde / restauration', () => {
  it('export → import sans duplication, fusion par date', async () => {
    const a = new LabDB('test-a', false);
    await a.ideas.add(base({ id: 'x', title: 'v1', updatedAt: 1 }));
    await a.works.add({ id: 'w', title: 'Film', director: '', kind: 'film', seen: 'seen', notes: '', scenes: '', createdAt: 0, updatedAt: 0 });
    const dump = await exportAll(a);
    // Import double dans une base vide : aucun doublon
    const b = new LabDB('test-b', false);
    await importBackup(b, dump);
    const r2 = await importBackup(b, dump);
    expect(await b.ideas.count()).toBe(1);
    expect(r2.added).toBe(0);
    // Version locale plus récente conservée en mode fusion
    await b.ideas.update('x', { title: 'v2 locale', updatedAt: 5 });
    const r3 = await importBackup(b, dump, 'merge');
    expect((await b.ideas.get('x'))!.title).toBe('v2 locale');
    expect(r3.kept).toBeGreaterThan(0);
    // Mode « la sauvegarde prime »
    await importBackup(b, dump, 'overwrite');
    expect((await b.ideas.get('x'))!.title).toBe('v1');
    // Fichier invalide refusé
    await expect(importBackup(b, { foo: 1 } as any)).rejects.toThrow();
  });
  it('sauvegarde auto quotidienne, 10 max', async () => {
    const c = new LabDB('test-c', false);
    expect(await autoBackupIfDue(c, 0)).toBe(false); // base vide
    await c.ideas.add(base());
    expect(await autoBackupIfDue(c, DAY)).toBe(true);
    expect(await autoBackupIfDue(c, DAY + 3600_000)).toBe(false);
    for (let i = 2; i < 15; i++) await autoBackupIfDue(c, i * DAY);
    expect(await c.autoBackups.count()).toBe(10);
  });
});
