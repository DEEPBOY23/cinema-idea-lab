import type { Idea, IdeaEvent, Status, TimeSession, Format } from '../types';
import { STATUSES } from '../types';
import { median, mean } from './util';

export type Milestones = Partial<Record<Status | 'created' | 'docEnd', number>>;

/** Dates d'étapes : première entrée dans chaque statut (les retours en arrière restent dans l'historique). */
export function milestones(idea: Idea, events: IdeaEvent[]): Milestones {
  const ev = events.filter((e) => e.ideaId === idea.id && e.type === 'status').sort((a, b) => a.at - b.at);
  const m: Milestones = { created: idea.createdAt };
  for (const e of ev) if (e.to && m[e.to] === undefined) m[e.to] = e.at;
  const leaveDoc = ev.find((e) => e.from === 'documentation');
  if (leaveDoc) m.docEnd = leaveDoc.at;
  return m;
}

export const SEGMENTS = [
  { id: 'create_doc', label: 'Création → début de documentation', from: 'created', to: 'documentation' },
  { id: 'doc_struct', label: 'Documentation → structure validée', from: 'documentation', to: 'structure' },
  { id: 'struct_done', label: 'Structure validée → réalisation', from: 'structure', to: 'done' },
  { id: 'create_done', label: 'Création → réalisation', from: 'created', to: 'done' },
  { id: 'done_pub', label: 'Réalisation → publication', from: 'done', to: 'published' },
] as const;
export type SegmentId = (typeof SEGMENTS)[number]['id'];

export function segmentDurations(m: Milestones): Partial<Record<SegmentId, number>> {
  const out: Partial<Record<SegmentId, number>> = {};
  for (const s of SEGMENTS) {
    const a = m[s.from as keyof Milestones], b = m[s.to as keyof Milestones];
    if (a !== undefined && b !== undefined && b >= a) out[s.id] = b - a;
  }
  return out;
}

/** Temps passé dans chaque statut (calendaire), en suivant les transitions successives. */
export function timeInStatus(idea: Idea, events: IdeaEvent[], now = Date.now()): Partial<Record<Status, number>> {
  const ev = events.filter((e) => e.ideaId === idea.id && e.type === 'status').sort((a, b) => a.at - b.at);
  const out: Partial<Record<Status, number>> = {};
  let cur: Status = 'idea';
  let since = idea.createdAt;
  for (const e of ev) {
    if (!e.to) continue;
    out[cur] = (out[cur] ?? 0) + Math.max(0, e.at - since);
    cur = e.to; since = e.at;
  }
  if (cur !== 'done' && cur !== 'published') out[cur] = (out[cur] ?? 0) + Math.max(0, now - since);
  return out;
}

export function workedMinutes(ideaId: string, sessions: TimeSession[], phase?: TimeSession['phase']) {
  return sessions.filter((s) => s.ideaId === ideaId && !s.deletedAt && (!phase || s.phase === phase)).reduce((a, s) => a + s.minutes, 0);
}

export interface StatsInput { ideas: Idea[]; events: IdeaEvent[]; sessions: TimeSession[]; formats: Format[]; sourcesCount: Record<string, number> }

export function computeDashboard({ ideas, events, sessions, formats, sourcesCount }: StatsInput, now = Date.now()) {
  const rows = ideas.map((idea) => {
    const m = milestones(idea, events);
    return {
      idea, m, seg: segmentDurations(m),
      worked: workedMinutes(idea.id, sessions),
      docWorked: workedMinutes(idea.id, sessions, 'documentation'),
      sources: sourcesCount[idea.id] ?? 0,
      tis: timeInStatus(idea, events, now),
    };
  });
  const seg = (id: SegmentId) => rows.map((r) => r.seg[id]).filter((x): x is number => x !== undefined);
  const segmentStats = Object.fromEntries(
    (['create_doc', 'doc_struct', 'struct_done', 'create_done', 'done_pub'] as SegmentId[]).map((id) => {
      const xs = seg(id);
      return [id, { n: xs.length, mean: mean(xs), median: median(xs) }];
    }),
  ) as Record<SegmentId, { n: number; mean?: number; median?: number }>;

  const fastest = rows.filter((r) => r.seg.create_done !== undefined).sort((a, b) => a.seg.create_done! - b.seg.create_done!).slice(0, 5);
  const mostDoc = rows
    .filter((r) => r.docWorked > 0 || r.sources > 0)
    .sort((a, b) => b.docWorked - a.docWorked || b.sources - a.sources)
    .slice(0, 5);
  const waiting = rows
    .filter((r) => r.idea.status !== 'done' && r.idea.status !== 'published' && !r.idea.paused)
    .sort((a, b) => a.idea.lastActivityAt - b.idea.lastActivityAt)
    .slice(0, 5);

  const byFormat = formats.map((f) => {
    const xs = rows.filter((r) => r.idea.formatId === f.id && r.seg.create_done !== undefined).map((r) => r.seg.create_done!);
    return { format: f, n: xs.length, median: median(xs) };
  }).filter((x) => x.n > 0).sort((a, b) => a.median! - b.median!);

  // Étapes qui ralentissent : médiane du temps passé par statut (idées ayant traversé ce statut)
  const bottlenecks = STATUSES.filter((s) => s.id !== 'done' && s.id !== 'published').map((s) => {
    const xs = rows.map((r) => r.tis[s.id]).filter((x): x is number => x !== undefined && x > 0);
    return { status: s, n: xs.length, median: median(xs) };
  }).filter((b) => b.n > 0).sort((a, b) => b.median! - a.median!);

  return {
    rows, segmentStats, fastest, mostDoc, waiting, byFormat, bottlenecks,
    doneCount: rows.filter((r) => r.m.done !== undefined || r.idea.status === 'done' || r.idea.status === 'published').length,
    publishedCount: rows.filter((r) => r.m.published !== undefined || r.idea.status === 'published').length,
  };
}
