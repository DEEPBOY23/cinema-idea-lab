// « Quoi faire aujourd'hui » : la prochaine action concrète selon le temps dont tu disposes.
// Sans IA : règles simples et visibles. Avec IA : l'assistant choisit parmi TES idées (aucune idée inventée).
import type { Idea, Source, Format, Settings, IdeaEvent } from '../types';
import { statusRank, statusLabel } from '../types';
import { askAIJson } from './ai';
import { weekProgress, ideaKind } from './planning';
import { isoWeek, DAY } from './util';
import { memoryBlock, type Memory } from './assistant';

export interface TodayAction { ideaId?: string; sourceId?: string; action: string; why: string; minutes: number }

const remainingHours = (i: Idea) => {
  const r = i.research ?? i.suggestions?.estimate;
  if (!r) return undefined;
  const doc = r.docHours || 0, shoot = r.shootHours || 0, edit = r.editHours || 0;
  if (statusRank(i.status) >= statusRank('production')) return edit || undefined;
  if (statusRank(i.status) >= statusRank('structure')) return shoot + edit || undefined;
  return doc + shoot + edit || undefined;
};

export function localToday(minutes: number, ideas: Idea[], sources: Source[], formats: Format[], settings: Settings, events: IdeaEvent[]): TodayAction[] {
  const active = ideas.filter((i) => statusRank(i.status) < statusRank('done') && !i.paused);
  const out: TodayAction[] = [];
  const week = isoWeek(Date.now());
  const wp = weekProgress(week, ideas, events, formats, settings);
  const needLong = wp.long.length < settings.weeklyLong, needShort = wp.short.length < settings.weeklyShort;

  // 1. Finir ce qui est presque fini (montage / tournage)
  for (const i of active.filter((x) => x.status === 'production')) {
    out.push({ ideaId: i.id, action: `Terminer « ${i.title} »`, why: 'Déjà en production : c’est la vidéo la plus proche d’être publiée.', minutes: Math.round((remainingHours(i) ?? 1.5) * 60) });
  }
  // 2. Tourner une idée dont la structure est validée, en priorité celle qui remplit l'objectif de la semaine
  for (const i of active.filter((x) => statusRank(x.status) >= statusRank('structure') && statusRank(x.status) < statusRank('production'))) {
    const k = ideaKind(i, formats);
    const goal = (k === 'long' && needLong) || (k === 'short' && needShort);
    out.push({ ideaId: i.id, action: `Tourner « ${i.title} »`, why: `Structure validée${goal ? ` · compte pour ton objectif de la semaine (${k === 'long' ? 'analyse longue' : 'analyse courte'})` : ''}.`, minutes: Math.round((remainingHours(i) ?? 2) * 60) });
  }
  // 3. Lire une source en attente liée à une idée en documentation
  for (const s of sources.filter((x) => (x.state === 'toread' || x.state === 'reading') && x.ideaIds.some((id) => active.some((i) => i.id === id && statusRank(i.status) <= statusRank('angle'))))) {
    const idea = active.find((i) => s.ideaIds.includes(i.id));
    out.push({ sourceId: s.id, ideaId: idea?.id, action: `${s.state === 'reading' ? 'Finir de lire' : 'Lire'} « ${s.title || s.url} »`, why: `Documentation de « ${idea?.title} ».`, minutes: s.minutes ?? 20 });
  }
  // 4. Choisir un angle / poser une structure
  for (const i of active.filter((x) => x.status === 'angle')) out.push({ ideaId: i.id, action: `Construire la structure de « ${i.title} »`, why: 'Angle choisi, il manque la structure.', minutes: 30 });
  for (const i of active.filter((x) => x.status === 'documentation' && x.angles.length > 0 && !x.angles.some((a) => a.chosen))) out.push({ ideaId: i.id, action: `Choisir l’angle de « ${i.title} »`, why: `${i.angles.length} angles en attente.`, minutes: 15 });
  // 5. Reprendre une idée qui s'endort
  const [, amber] = settings.thresholds;
  for (const i of active.filter((x) => (Date.now() - x.lastActivityAt) / DAY > amber).slice(0, 2)) out.push({ ideaId: i.id, action: `Reprendre « ${i.title} »`, why: `Sans activité depuis ${Math.floor((Date.now() - i.lastActivityAt) / DAY)} j (${statusLabel(i.status)}).`, minutes: 15 });

  const fit = out.filter((a) => a.minutes <= minutes * 1.25);
  return (fit.length ? fit : out.sort((a, b) => a.minutes - b.minutes)).slice(0, 4);
}

export async function aiToday(minutes: number, m: Memory, sources: Source[], signal?: AbortSignal): Promise<{ message: string; actions: TodayAction[] }> {
  const active = m.ideas.filter((i) => statusRank(i.status) < statusRank('done') && !i.paused);
  if (!active.length) return { message: 'Ta bibliothèque n’a pas d’idée en cours : verse des idées dans le Bac à idées.', actions: [] };
  const wp = weekProgress(isoWeek(Date.now()), m.ideas, m.events, m.formats, m.settings);
  const list = active.map((i) => {
    const src = sources.filter((s) => s.ideaIds.includes(i.id));
    return `- id ${i.id} · « ${i.title} » · ${statusLabel(i.status)} · ${m.formats.find((f) => f.id === i.formatId)?.name ?? 'sans format'} · ${ideaKind(i, m.formats)} · ${Math.floor((Date.now() - i.lastActivityAt) / DAY)} j sans activité · reste ≈ ${remainingHours(i) ?? '?'} h · sources : ${src.filter((s) => s.state === 'read').length}/${src.length} lues${i.missingInfo ? ` · manque : ${i.missingInfo.slice(0, 120)}` : ''}`;
  }).join('\n');
  const { data } = await askAIJson<{ message: string; actions: TodayAction[] }>(
    `Tu es le coach éditorial d'un vidéaste cinéma. Il a ${minutes} minutes aujourd'hui. Choisis 1 à 3 actions concrètes, UNIQUEMENT parmi ses idées listées (n'en invente aucune), qui tiennent dans ce temps et font avancer le plus vers une publication, en tenant compte de son objectif de la semaine. Réponds en JSON : {"message":"une phrase d'encouragement factuelle","actions":[{"ideaId":"id exact","action":"action concrète, verbe à l'infinitif","why":"pourquoi maintenant","minutes":30}]}. Français, tutoie-le, sans flatterie.`,
    `Mémoire :\n${memoryBlock(m)}\n\nObjectif de la semaine : ${m.settings.weeklyLong} analyse(s) longue(s) (fait : ${wp.long.length}), ${m.settings.weeklyShort} courte(s) (fait : ${wp.short.length}).\n\nIdées en cours :\n${list}`,
    signal);
  const ids = new Set(active.map((i) => i.id));
  return {
    message: data.message ?? '',
    actions: (data.actions ?? []).filter((a) => a?.action).map((a) => ({ ...a, ideaId: a.ideaId && ids.has(a.ideaId) ? a.ideaId : undefined, minutes: Math.max(5, Math.round(Number(a.minutes) || 30)) })).slice(0, 3),
  };
}
