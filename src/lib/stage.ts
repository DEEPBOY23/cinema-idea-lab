// Étapes visibles d'une idée : ☁️ dans les nuages → 🔵 à filmer (finalisée) → 🟢 filmée.
import type { Idea } from '../types';
import { updateIdea, addJournal, setStatus } from './actions';
import { statusRank } from '../types';

export type Stage = 'cloud' | 'ready' | 'filmed';
export const STAGE_LABEL: Record<Stage, string> = { cloud: 'Dans les nuages', ready: 'À filmer', filmed: 'Filmées' };
export function ideaStage(i: Idea): Stage {
  if (i.filmedAt || i.status === 'done' || i.status === 'published') return 'filmed';
  if (i.finalizedAt) return 'ready';
  return 'cloud';
}
export async function finalizeIdea(i: Idea) {
  await updateIdea(i.id, { finalizedAt: Date.now(), paused: false });
  await addJournal('Idée finalisée : fiche récap prête, à filmer.', i.id);
}
export async function unfinalizeIdea(i: Idea) {
  await updateIdea(i.id, { finalizedAt: undefined, filmedAt: undefined });
  await addJournal('Idée remise dans les nuages.', i.id);
}
export async function setFilmed(i: Idea, filmed: boolean) {
  await updateIdea(i.id, { filmedAt: filmed ? Date.now() : undefined });
  await addJournal(filmed ? 'Filmée.' : 'Marquée « pas encore filmée ».', i.id);
  if (filmed && statusRank(i.status) < statusRank('production')) await setStatus(i, 'production');
}
