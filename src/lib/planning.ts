import type { Idea, IdeaEvent, Format, Settings, TimeSession } from '../types';
import { statusRank } from '../types';
import { isLongFormat } from '../defaults';
import { milestones } from './stats';
import { isoWeek, median, DAY } from './util';

export type Kind = 'long' | 'short' | 'tech';
export function ideaKind(idea: Idea, formats: Format[]): Kind {
  if (idea.category === 'technique') return 'tech';
  const f = formats.find((x) => x.id === idea.formatId);
  if (idea.targetSeconds) return idea.targetSeconds >= 60 ? 'long' : 'short';
  return isLongFormat(f) ? 'long' : 'short';
}

/** Progression d'une semaine : idées réalisées ou publiées (selon le réglage) dans la semaine. */
export function weekProgress(week: string, ideas: Idea[], events: IdeaEvent[], formats: Format[], settings: Settings) {
  const doneThisWeek = ideas.filter((i) => {
    const m = milestones(i, events);
    const at = settings.countOn === 'published' ? m.published : (m.done ?? m.published);
    return at !== undefined && isoWeek(at) === week;
  });
  const by = (k: Kind) => doneThisWeek.filter((i) => ideaKind(i, formats) === k);
  return {
    long: by('long'), short: by('short'), tech: by('tech'),
    planned: ideas.filter((i) => i.plannedWeek === week),
  };
}

/** Suggestions issues de ta bibliothèque (jamais d'idées inventées), avec raisons explicites. */
export function suggestIdeas(ideas: Idea[], events: IdeaEvent[], sessions: TimeSession[], formats: Format[], sourcesRead: Record<string, { total: number; read: number }>, want: Kind | 'any') {
  // Délais habituels par format (création → réalisation), d'après ton historique
  const habit = new Map<string, number | undefined>();
  for (const f of formats) {
    const xs = ideas.filter((i) => i.formatId === f.id).map((i) => { const m = milestones(i, events); return m.done && m.structure ? m.done - m.structure : undefined; }).filter((x): x is number => x !== undefined);
    habit.set(f.id, median(xs));
  }
  return ideas
    .filter((i) => statusRank(i.status) < statusRank('done') && !i.paused && !i.plannedWeek)
    .filter((i) => want === 'any' || ideaKind(i, formats) === want)
    .map((i) => {
      const reasons: string[] = [];
      let score = statusRank(i.status) * 2;
      if (statusRank(i.status) >= statusRank('structure')) reasons.push('structure validée');
      else if (statusRank(i.status) >= statusRank('angle')) reasons.push('angle choisi');
      const sr = sourcesRead[i.id];
      if (sr && sr.total) { const r = sr.read / sr.total; score += r * 3; reasons.push(`${sr.read}/${sr.total} sources lues`); }
      else if (i.research?.level === 'light') reasons.push('peu de documentation nécessaire');
      if (i.research?.level === 'light') score += 2; else if (i.research?.level === 'moderate') score += 1;
      if (i.avDifficulty === 1) { score += 1; reasons.push('tournage simple'); }
      if (i.priority === 1) { score += 2; reasons.push('priorité haute'); }
      const h = i.formatId ? habit.get(i.formatId) : undefined;
      if (h) reasons.push(`structure → réalisation habituellement ≈ ${Math.max(1, Math.round(h / DAY))} j pour ce format`);
      const est = (i.research?.docHours ?? 0) + (i.research?.shootHours ?? 0) + (i.research?.editHours ?? 0);
      if (est) reasons.push(`≈ ${est} h estimées`);
      const worked = sessions.filter((s) => s.ideaId === i.id).reduce((a, s) => a + s.minutes, 0);
      if (worked) reasons.push(`${Math.round(worked / 60)} h déjà travaillées`);
      return { idea: i, score, reasons };
    })
    .sort((a, b) => b.score - a.score);
}
