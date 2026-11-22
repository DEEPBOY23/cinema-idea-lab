// Assistant éditorial : rattacher une idée aux formats, découper et classer un bac à idées.
// Avec IA : appel structuré (JSON). Sans IA : règles simples et transparentes (mots-clés, longueur).
// « Mémoire » : à chaque appel, l'app transmet ce qu'elle sait de toi (formats, films vus, style,
// et tes derniers choix de format/angle), pour que les propositions s'adaptent à ta façon de faire.
import type { Format, Idea, Work, Settings, Suggestions, FormatSuggestion, Estimate, Fit, IdeaEvent, TimeSession } from '../types';
import { askAIJson, aiEnabled } from './ai';
import { milestones } from './stats';
import { median, DAY } from './util';

export interface Memory { formats: Format[]; works: Work[]; settings: Settings; ideas: Idea[]; events: IdeaEvent[]; sessions: TimeSession[] }

function formatsBlock(formats: Format[]) {
  return formats.map((f) => `- id "${f.id}" · ${f.name} (${f.minSec}–${f.maxSec} s) : ${f.promise} Structures : ${f.structures.map((s) => s.name).join(' / ') || '—'}. Charge doc : ${f.docLoad || '?'}. Charge tournage : ${f.avLoad || '?'}`).join('\n');
}

/** Ce que l'app transmet comme « mémoire » à l'IA. */
export function memoryBlock(m: Memory): string {
  const seen = m.works.filter((w) => w.seen === 'seen').map((w) => w.title);
  const past = m.ideas
    .filter((i) => i.formatId && (i.angle || i.status !== 'idea'))
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12)
    .map((i) => `- « ${i.title} » → ${m.formats.find((f) => f.id === i.formatId)?.name ?? '?'}${i.angle ? ` · angle : ${i.angle.slice(0, 120)}` : ''}`);
  // Délais réels par format (création → réalisation), d'après ton historique
  const speeds = m.formats.map((f) => {
    const xs = m.ideas.filter((i) => i.formatId === f.id).map((i) => { const ms = milestones(i, m.events); return ms.done !== undefined ? ms.done - i.createdAt : undefined; }).filter((x): x is number => x !== undefined);
    const med = median(xs);
    return med ? `- ${f.name} : ${Math.round(med / DAY)} j en médiane (${xs.length} vidéo${xs.length > 1 ? 's' : ''})` : '';
  }).filter(Boolean);
  const worked = m.sessions.reduce((a, s) => a + s.minutes, 0);
  return [
    `Créateur de vidéos cinéma courtes (verticales). Approche : storytelling visuel (mise en scène, lumière, couleur, cadre, mouvements, psychologie des personnages, choix des cinéastes).`,
    m.settings.styleProfile.trim() ? `Style personnel : ${m.settings.styleProfile.trim()}` : '',
    `Films/séries vus : ${seen.length ? seen.join(' ; ') : 'non renseigné'}. Ne suppose jamais qu'un autre film a été vu.`,
    past.length ? `Derniers choix éditoriaux (pour t'adapter à ses habitudes) :\n${past.join('\n')}` : '',
    speeds.length ? `Ses délais réels par format :\n${speeds.join('\n')}` : '',
    worked ? `Temps de travail déjà saisi au total : ${Math.round(worked / 60)} h.` : '',
  ].filter(Boolean).join('\n');
}

const RULES = `Règles : n'invente aucun fait, citation ou intention d'auteur ; si une œuvre est inconnue ou l'idée trop vague, dis-le dans "reason" et baisse la pertinence. Pas de script. Français.`;

const SUGGEST_SCHEMA = `{"formats":[{"formatId":"<id exact de la liste>","fit":"high|conditional|low","reason":"pourquoi, 1-2 phrases","angle":"angle proposé pour ce format, 1 phrase","structureName":"nom exact d'une structure du format ou vide"}],"estimate":{"level":"light|moderate|deep","docHours":0,"shootHours":0,"editHours":0,"why":"ce qui rend la vidéo rapide ou longue à faire"}}`;

/** Rattache une idée (ou un script) à un ou plusieurs formats. */
export async function suggestFormats(text: string, m: Memory, signal?: AbortSignal): Promise<Suggestions> {
  if (!aiEnabled()) return localSuggest(text, m.formats);
  const system = `Tu es l'assistant éditorial d'un vidéaste cinéma. Tu rattaches ses idées à ses formats récurrents et estimes l'effort de réalisation. Réponds en JSON selon ce schéma : ${SUGGEST_SCHEMA}\nClasse les formats du plus adapté au moins adapté ; garde au maximum 3 formats, uniquement ceux qui ont du sens. ${RULES}`;
  const user = `Ses formats :\n${formatsBlock(m.formats)}\n\nMémoire :\n${memoryBlock(m)}\n\nIdée ou script :\n"""${text}"""`;
  const { data, model } = await askAIJson<{ formats: FormatSuggestion[]; estimate?: Omit<Estimate, 'totalHours'> }>(system, user, signal);
  return { ...sanitize(data, m.formats), source: 'ia', model, at: Date.now() };
}

export interface InboxDraft { title: string; summary: string; raw: string; works: string[]; suggestions: Suggestions }

/** Bac à idées : sépare un texte en vrac en idées distinctes, rattache chacune et estime son effort. */
export async function analyzeInbox(dump: string, m: Memory, signal?: AbortSignal): Promise<InboxDraft[]> {
  if (!aiEnabled()) {
    return splitLocal(dump).map((raw) => ({ raw, title: titleOf(raw), summary: '', works: [], suggestions: localSuggest(raw, m.formats) }));
  }
  const system = `Tu es l'assistant éditorial d'un vidéaste cinéma. On te donne un texte en vrac contenant une ou plusieurs idées ou scripts de vidéos. 1) Sépare chaque idée distincte (ne fusionne pas deux idées, ne coupe pas une idée en deux). 2) Pour chacune : titre court, résumé d'une phrase, extrait exact du texte source, œuvres citées, formats possibles et estimation de l'effort. Réponds en JSON : {"items":[{"title":"","summary":"","raw":"extrait exact","works":["titre d'œuvre"],"formats":[...même forme que ci-dessous...],"estimate":{...}}]}. Forme d'un élément formats/estimate : ${SUGGEST_SCHEMA}\nAu maximum 3 formats par idée. Estime les heures de façon réaliste pour une vidéo verticale de 30 à 90 s, en tenant compte de ses délais réels s'ils sont fournis. ${RULES}`;
  const user = `Ses formats :\n${formatsBlock(m.formats)}\n\nMémoire :\n${memoryBlock(m)}\n\nTexte en vrac :\n"""${dump}"""`;
  const { data, model } = await askAIJson<{ items: { title: string; summary: string; raw: string; works?: string[]; formats: FormatSuggestion[]; estimate?: Omit<Estimate, 'totalHours'> }[] }>(system, user, signal);
  return (data.items ?? []).map((it) => ({
    title: it.title || titleOf(it.raw), summary: it.summary ?? '', raw: it.raw || it.summary || it.title, works: it.works ?? [],
    suggestions: { ...sanitize(it, m.formats), source: 'ia' as const, model, at: Date.now() },
  }));
}

function sanitize(d: { formats?: FormatSuggestion[]; estimate?: Partial<Estimate> }, formats: Format[]): Pick<Suggestions, 'formats' | 'estimate'> {
  const ids = new Set(formats.map((f) => f.id));
  const fits: Fit[] = ['high', 'conditional', 'low'];
  const fs = (d.formats ?? [])
    .filter((x) => x && ids.has(x.formatId))
    .map((x) => ({ ...x, fit: fits.includes(x.fit) ? x.fit : 'conditional', structureName: formats.find((f) => f.id === x.formatId)?.structures.some((s) => s.name === x.structureName) ? x.structureName : undefined }))
    .slice(0, 3);
  const e = d.estimate;
  const n = (v: unknown) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.round(v * 2) / 2 : 0);
  const estimate = e ? {
    level: (['light', 'moderate', 'deep'].includes(e.level as string) ? e.level : 'moderate') as Estimate['level'],
    docHours: n(e.docHours), shootHours: n(e.shootHours), editHours: n(e.editHours), why: e.why ?? '', totalHours: 0,
  } : undefined;
  if (estimate) estimate.totalHours = estimate.docHours + estimate.shootHours + estimate.editHours;
  return { formats: fs, estimate };
}

// ---------------- Sans IA : règles simples ----------------
const KEYWORDS: Record<string, RegExp> = {
  'fmt-color-stories': /couleur|palette|rouge|bleu|vert|jaune|orange|violet|teinte|étalonn|néon|chromat/i,
  'fmt-one-shot': /\bun plan\b|ce plan|plan[- ]séquence|cadre|cadrage|composition|focale|ouverture du film|dernier plan/i,
  'fmt-creative-decisions': /choix|décision|pourquoi (le|la|les)? ?réalisat|intention|a choisi|décidé/i,
  'fmt-feel-the-frame': /émotion|ressent|angoisse|solitude|isolement|psycholog|malaise|tension|personnage/i,
  'fmt-invisible': /invisible|raccord|on ne remarque|subtil|discret|vfx|effet spécial|son|montage caché/i,
  'fmt-constraints': /contrainte|budget|petit budget|tournage difficile|décor unique|délai|météo|limit/i,
  'fmt-experiments': /expérien|test|j'ai essayé|comparer|a\/b|versus|vs\b|focale \d|objectif \d/i,
  'fmt-visual-rule': /règle|180|tiers|regard caméra|lead room|loi|principe/i,
};

export function localSuggest(text: string, formats: Format[]): Suggestions {
  const hits = formats.map((f) => {
    const re = KEYWORDS[f.id];
    const themeHit = f.themes.some((t) => t.split(/\s+/).filter((w) => w.length > 5).some((w) => text.toLowerCase().includes(w.toLowerCase())));
    const n = (re ? (text.match(new RegExp(re.source, 'gi')) ?? []).length : 0) + (themeHit ? 1 : 0);
    return { f, n };
  }).filter((h) => h.n > 0).sort((a, b) => b.n - a.n).slice(0, 3);
  const words = text.trim().split(/\s+/).length;
  const many = (text.match(/«|"|\(\d{4}\)/g) ?? []).length > 2;
  const top = hits[0]?.f;
  const deep = /approfondie/i.test(top?.docLoad ?? '') || many;
  const doc = deep ? 4 : /modérée/i.test(top?.docLoad ?? '') ? 2 : 1;
  const shoot = /élevée/i.test(top?.avLoad ?? '') ? 3 : 1;
  const edit = Math.max(1, Math.round(((top?.maxSec ?? 45) / 30) * 2) / 2);
  return {
    formats: hits.map((h, i) => ({ formatId: h.f.id, fit: i === 0 && h.n > 1 ? 'high' : 'conditional', reason: 'Mots-clés correspondant au format (suggestion simple, sans IA).', angle: '' })),
    estimate: { level: deep ? 'deep' : doc > 1 ? 'moderate' : 'light', docHours: doc, shootHours: shoot, editHours: edit, totalHours: doc + shoot + edit, why: `Estimation sans IA : charge indicative du format${many ? ', plusieurs œuvres citées' : ''}, ${words} mots.` },
    source: 'local', at: Date.now(),
  };
}

/** Sépare un texte en vrac : lignes vides, puces ou numéros. */
export function splitLocal(dump: string): string[] {
  const t = dump.replace(/\r/g, '').trim();
  if (!t) return [];
  let parts = t.split(/\n\s*\n+/);
  if (parts.length === 1) {
    const lines = t.split('\n').filter((l) => l.trim());
    if (lines.length > 1 && lines.every((l) => /^\s*([-*•–]|\d+[.)])\s+/.test(l))) parts = lines;
  }
  return parts.map((p) => p.replace(/^\s*([-*•–]|\d+[.)])\s+/, '').trim()).filter((p) => p.length > 3);
}
export const titleOf = (raw: string) => raw.split(/[.\n!?]/)[0].slice(0, 70).trim() || 'Idée';

/** Durée totale estimée pour classer du plus rapide au plus lent. */
export const totalOf = (s?: Suggestions) => s?.estimate?.totalHours ?? Number.POSITIVE_INFINITY;
