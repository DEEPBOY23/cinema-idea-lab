// « Construire mon idée » en 1 clic : chaque étape demande à l'assistant une réponse structurée
// et l'enregistre directement dans la fiche. Tu gardes, modifies ou rejettes ensuite.
import type { Idea, Beat, Format } from '../types';
import { askAIJson } from './ai';
import { ideaContext, type PromptCtx } from './prompts';
import { updateIdea, snapshot, addJournal } from './actions';
import { uid } from './util';
import { db } from '../db';

const RULES = `N'invente aucun fait, aucune citation, aucune intention d'auteur : si une information n'est pas sûre, présente-la comme une hypothèse à vérifier. Pas de script rédigé. Français, phrases courtes.`;
const sys = (task: string, schema: string) => `Tu es l'assistant éditorial d'un vidéaste cinéma. ${task} Réponds uniquement en JSON : ${schema} ${RULES}`;

async function log(ideaId: string, mode: string, input: string, response: unknown) {
  const now = Date.now();
  await db.workshops.add({ id: uid(), ideaId, mode: 'development', input: `${mode} : ${input}`.slice(0, 2000), prompt: '(assistant intégré)', response: JSON.stringify(response, null, 1), createdAt: now, updatedAt: now });
}

export async function proposeAngles(idea: Idea, ctx: PromptCtx, signal?: AbortSignal) {
  const { data } = await askAIJson<{ understood?: string; angles: { text: string; why?: string; toDocument?: string; risk?: string }[] }>(
    sys('Reformule d’abord en une phrase ce que tu comprends de son idée, puis propose 3 angles vraiment différents (pas trois variantes du même).',
      '{"understood":"","angles":[{"text":"l\'angle en une phrase","why":"ce qu\'il promet au spectateur","toDocument":"ce qu\'il faudra vérifier","risk":"le risque principal"}]}'),
    ideaContext(ctx), signal);
  const angles = (data.angles ?? []).filter((a) => a?.text).slice(0, 4).map((a) => ({
    id: uid(), chosen: false, origin: 'ia' as const,
    text: [a.text, a.why && `→ ${a.why}`, a.toDocument && `À documenter : ${a.toDocument}`, a.risk && `Risque : ${a.risk}`].filter(Boolean).join('\n'),
  }));
  await updateIdea(idea.id, { angles: [...idea.angles, ...angles] });
  await log(idea.id, 'angles', idea.observation, data);
  return { understood: data.understood ?? '', count: angles.length };
}

export async function listMissing(idea: Idea, ctx: PromptCtx, signal?: AbortSignal) {
  const { data } = await askAIJson<{ missing: { item: string; how?: string }[] }>(
    sys('Liste les informations qui manquent pour soutenir l’angle retenu : faits à vérifier, scènes à revoir, sources à trouver. Pour chacune, dis comment l’obtenir.',
      '{"missing":[{"item":"ce qui manque","how":"où ou comment le trouver"}]}'),
    ideaContext(ctx), signal);
  const lines = (data.missing ?? []).filter((m) => m?.item).map((m) => `- ${m.item}${m.how ? ` (${m.how})` : ''}`);
  if (lines.length) await updateIdea(idea.id, { missingInfo: [idea.missingInfo, ...lines].filter(Boolean).join('\n') });
  await log(idea.id, 'infos manquantes', idea.angle, data);
  return lines.length;
}

export async function proposeStructure(idea: Idea, ctx: PromptCtx, fmt?: Format, signal?: AbortSignal) {
  const target = fmt ? `${fmt.minSec}–${fmt.maxSec} s, format « ${fmt.name} » (structures du format : ${fmt.structures.map((s) => `${s.name} = ${s.beats.map((b) => b.label).join(' / ')}`).join(' ; ')})` : '30–90 s';
  const { data } = await askAIJson<{ beats: { label: string; seconds: number; content: string }[] }>(
    sys(`Propose une structure narrative pour l’angle retenu, durée totale ${target}. Des temps forts avec leur durée et leur intention, pas de texte rédigé.`,
      '{"beats":[{"label":"nom du temps fort","seconds":8,"content":"intention, ce qu\'on montre"}]}'),
    ideaContext(ctx), signal);
  const beats: Beat[] = (data.beats ?? []).filter((b) => b?.label).map((b) => ({ id: uid(), label: String(b.label).slice(0, 80), seconds: Math.max(1, Math.round(Number(b.seconds) || 8)), content: b.content ?? '' }));
  if (!beats.length) throw new Error('L’assistant n’a pas proposé de structure exploitable. Réessaie.');
  if (idea.structure.length) await snapshot('ideas', idea.id, 'structure', JSON.stringify(idea.structure), 'manual');
  await updateIdea(idea.id, { structure: beats });
  await addJournal('Structure proposée par l’assistant (l’ancienne est conservée dans les versions).', idea.id);
  await log(idea.id, 'structure', idea.angle, data);
  return beats.length;
}

export interface WeakTip { beatId?: string; beat: string; problem: string; suggestion: string }
export async function strengthenWeak(idea: Idea, ctx: PromptCtx, signal?: AbortSignal): Promise<{ verdict: string; tips: WeakTip[] }> {
  const { data } = await askAIJson<{ verdict: string; tips: { beat: string; problem: string; suggestion: string }[] }>(
    sys('Regarde la structure. Pour chaque temps fort marqué faible, ou qui l’est vraiment (en le justifiant), propose une piste concrète pour le renforcer. S’il n’y a pas de vrai problème, dis-le dans "verdict" et laisse "tips" vide.',
      '{"verdict":"avis global en une phrase","tips":[{"beat":"nom exact du temps fort","problem":"ce qui coince","suggestion":"piste concrète"}]}'),
    ideaContext(ctx), signal);
  const tips = (data.tips ?? []).filter((t) => t?.suggestion).map((t) => ({ ...t, beatId: idea.structure.find((b) => b.label.trim().toLowerCase() === String(t.beat).trim().toLowerCase())?.id }));
  await log(idea.id, 'parties faibles', '', data);
  return { verdict: data.verdict ?? '', tips };
}

export async function applyTip(idea: Idea, tip: WeakTip) {
  if (!tip.beatId) return;
  await updateIdea(idea.id, { structure: idea.structure.map((b) => (b.id === tip.beatId ? { ...b, content: [b.content, `Piste : ${tip.suggestion}`].filter(Boolean).join('\n'), weak: false } : b)) });
}
