// Avancement d'une idée, calculé d'après ce qui est rempli (les cases vides comptent comme à faire).
import type { Idea, Source } from '../types';

export interface Progress { pct: number; done: string[]; todo: string[] }
export function ideaProgress(i: Idea, sources: Source[] = []): Progress {
  const nSrc = sources.filter((s) => s.ideaIds.includes(i.id)).length;
  const beats = i.structure.filter((b) => b.content.trim()).length;
  const checks: [string, boolean][] = [
    ['observation', i.observation.trim().length > 10],
    ['format', !!i.formatId],
    ['œuvre', i.workIds.length > 0],
    ['sources', nSrc > 0],
    ['recherche estimée', !!i.research],
    ['angle', !!i.angle.trim() || i.angles.some((a) => a.chosen)],
    ['hook', !!i.hook.trim()],
    ['structure', beats >= 3],
    ['script', !!(i.script.trim() || i.scriptAI?.trim())],
    ['script relu', !!i.scriptReviewed],
  ];
  const done = checks.filter(([, ok]) => ok).map(([k]) => k);
  const todo = checks.filter(([, ok]) => !ok).map(([k]) => k);
  const pct = i.finalizedAt || i.filmedAt ? 100 : Math.round((done.length / checks.length) * 100);
  return { pct, done, todo };
}
export type Band = 'debut' | 'partiel' | 'avance';
export const bandOf = (pct: number): Band => (pct < 34 ? 'debut' : pct < 67 ? 'partiel' : 'avance');
export const BAND_LABEL: Record<Band, string> = { debut: 'à peine commencée', partiel: 'en partie développée', avance: 'bien avancée' };

/** Familles : idée principale + variantes (lien explicite parentId, sinon titres/observations proches). */
export interface Family<T> { head: T; children: T[] }
export function groupFamilies<T extends Idea>(list: T[], auto: Map<string, { n: number; of: number; color: string }>, prog: (i: T) => number): Family<T>[] {
  const byId = new Map(list.map((i) => [i.id, i]));
  const kids = new Map<string, T[]>();
  const placed = new Set<string>();
  // 1. liens explicites
  for (const i of list) if (i.parentId && byId.has(i.parentId) && i.parentId !== i.id) { kids.set(i.parentId, [...(kids.get(i.parentId) ?? []), i]); placed.add(i.id); }
  // 2. familles détectées : la principale = pas en pause, la plus avancée, puis la plus ancienne
  const fams = new Map<string, T[]>();
  for (const i of list) { const v = auto.get(i.id); if (!v || placed.has(i.id) || kids.has(i.id)) continue; const k = v.color + v.of; fams.set(k, [...(fams.get(k) ?? []), i]); }
  for (const members of fams.values()) {
    if (members.length < 2) continue;
    const head = [...members].sort((a, b) => Number(!!a.paused || a.importance === 'plus-tard') - Number(!!b.paused || b.importance === 'plus-tard') || prog(b) - prog(a) || a.createdAt - b.createdAt)[0];
    for (const m of members) if (m.id !== head.id) { kids.set(head.id, [...(kids.get(head.id) ?? []), m]); placed.add(m.id); }
  }
  return list.filter((i) => !placed.has(i.id)).map((head) => ({ head, children: kids.get(head.id) ?? [] }));
}
