// Estimation globale du temps d'une idée.
// - liveEstimate : calcul local, gratuit et instantané, recalculé à chaque modification de la fiche.
// - aiEstimate : à la demande (1 appel IA), remplit aussi le niveau de recherche.
import type { Idea, Format, ResearchLevelId } from '../types';
import { localSuggest } from './assistant';
import { askAIJson } from './ai';
import { ideaContext, type PromptCtx } from './prompts';
import { updateIdea, addJournal } from './actions';

export interface LiveEstimate { doc: number; shoot: number; edit: number; total: number; basis: string; changes: string[] }
const r2 = (x: number) => Math.round(x * 2) / 2;

export function liveEstimate(idea: Idea, fmt?: Format, formats: Format[] = []): LiveEstimate {
  const r = idea.research;
  const e = idea.suggestions?.estimate;
  let doc: number, shoot: number, edit: number, basis: string;
  if (r && (r.docHours || r.shootHours || r.editHours)) { doc = r.docHours || 0; shoot = r.shootHours ?? 1; edit = r.editHours ?? 1; basis = 'tes estimations'; }
  else if (e) { doc = e.docHours; shoot = e.shootHours; edit = e.editHours; basis = e && idea.suggestions?.source === 'ia' ? 'l’estimation de l’assistant' : 'des règles simples'; }
  else { const l = localSuggest(`${idea.title} ${idea.observation} ${idea.angle}`, fmt ? [fmt] : formats).estimate!; doc = l.docHours; shoot = l.shootHours; edit = l.editHours; basis = 'des règles simples'; }
  const changes: string[] = [];
  // Ajustements en direct d'après le contenu réel de la fiche
  const chosen = idea.angles.filter((a) => a.chosen).length;
  if (chosen > 1) { doc += 0.5 * (chosen - 1); changes.push(`${chosen} angles combinés`); }
  if (idea.workIds.length > 1) { doc += 0.5 * (idea.workIds.length - 1); changes.push(`${idea.workIds.length} œuvres`); }
  const missing = idea.missingInfo.split('\n').filter((l) => l.trim()).length;
  if (missing > 2) { doc += 0.25 * (missing - 2); changes.push(`${missing} infos à chercher`); }
  const sec = idea.structure.reduce((a, b) => a + (Number(b.seconds) || 0), 0);
  if (sec > 0) { const need = r2(sec / 30); if (need > edit) { edit = need; changes.push(`${sec} s de structure`); } }
  if (idea.structure.length > 6) { shoot += 0.5; changes.push(`${idea.structure.length} temps forts`); }
  doc = r2(doc); shoot = r2(shoot); edit = r2(edit);
  return { doc, shoot, edit, total: r2(doc + shoot + edit), basis, changes };
}

/** Estimation par l'IA (à la demande) : remplit le niveau de recherche et les heures. */
export async function aiEstimate(idea: Idea, ctx: PromptCtx, signal?: AbortSignal) {
  const { data } = await askAIJson<{ level: ResearchLevelId; justification: string; sourcesNeeded: string; missing: string; docHours: number; shootHours: number; editHours: number }>(
    `Tu es l'assistant éditorial d'un vidéaste cinéma. Estime de façon réaliste le temps pour réaliser cette idée en vidéo courte, d'après tout ce qui est dans la fiche (angles, structure, œuvres, script). Donne aussi le niveau de recherche documentaire, sa justification, les sources nécessaires et ce qui manque. Tutoie, sois concret, n'invente aucun fait. Réponds uniquement en JSON : {"level":"light|moderate|deep","justification":"","sourcesNeeded":"","missing":"","docHours":1,"shootHours":1,"editHours":1}`,
    ideaContext(ctx), signal);
  const level = (['light', 'moderate', 'deep'].includes(data.level) ? data.level : 'moderate') as ResearchLevelId;
  const cur = idea.research;
  await updateIdea(idea.id, { research: {
    level, justification: cur?.justification || data.justification || '', sourcesNeeded: cur?.sourcesNeeded || data.sourcesNeeded || '', missing: cur?.missing || data.missing || '',
    docHours: Number(data.docHours) || 1, shootHours: Number(data.shootHours) || 1, editHours: Number(data.editHours) || 1,
  } });
  const total = (Number(data.docHours) || 0) + (Number(data.shootHours) || 0) + (Number(data.editHours) || 0);
  await addJournal(`Temps ré-estimé par l’assistant : ≈ ${total} h.`, idea.id);
  return total;
}
