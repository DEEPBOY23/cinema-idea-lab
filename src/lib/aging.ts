import type { Idea, Settings } from '../types';
import { DAY } from './util';

export type AgeTone = 'fresh' | 'amber' | 'terracotta' | 'bordeaux' | 'done' | 'published' | 'paused';
export const AGE_LABEL: Record<AgeTone, string> = {
  fresh: 'Récente', amber: 'À reprendre', terracotta: 'En attente', bordeaux: 'Endormie',
  done: 'Réalisée', published: 'Publiée', paused: 'En pause',
};

/** Couleur d'ancienneté : basée sur la dernière activité ; réalisée/publiée restent vertes. */
export function ageTone(idea: Pick<Idea, 'status' | 'paused' | 'lastActivityAt'>, thresholds: Settings['thresholds'], now = Date.now()): { tone: AgeTone; days: number } {
  const days = Math.floor((now - idea.lastActivityAt) / DAY);
  if (idea.status === 'published') return { tone: 'published', days };
  if (idea.status === 'done') return { tone: 'done', days };
  if (idea.paused) return { tone: 'paused', days };
  const [a, b, c] = thresholds;
  if (days <= a) return { tone: 'fresh', days };
  if (days <= b) return { tone: 'amber', days };
  if (days <= c) return { tone: 'terracotta', days };
  return { tone: 'bordeaux', days };
}
