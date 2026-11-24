// « Créer » : d'une phrase, d'une idée ou d'un script (même partiel), l'assistant tire plusieurs idées
// de posts, chacune avec ses formats, ses angles, son temps estimé et une structure de post :
// Hook · Intro · Angles · Contradiction · Conclusion / complément.
import type { Format, Idea, Beat, FormatSuggestion, Estimate, Suggestions } from '../types';
import { askAIJson, getProvider } from './ai';
import { memoryBlock, type Memory } from './assistant';
import { uid } from './util';

export type SeedKind = 'phrase' | 'idee' | 'script';
export function detectSeed(text: string): SeedKind {
  const w = text.trim().split(/\s+/).filter(Boolean).length;
  return w > 60 ? 'script' : w > 15 ? 'idee' : 'phrase';
}
export const SEED_LABEL: Record<SeedKind, string> = {
  phrase: 'Phrase : l’assistant en tirera plusieurs idées.',
  idee: 'Idée : plusieurs angles et une structure de post.',
  script: 'Script : l’assistant garde tes mots et propose la structure.',
};

export interface PostStructure { hook: string; intro: string; angles: string[]; contradiction: string; conclusion: string }
export interface GeneratedIdea {
  title: string; summary: string; angles: string[];
  formats: FormatSuggestion[]; estimate?: Estimate; structure: PostStructure; searches: string[];
}

const RULES = `Règles : tutoie l'utilisateur ; n'invente aucun fait, citation ou intention d'auteur ; ce qui n'est pas sûr est formulé comme une hypothèse à vérifier ; reste concret et visuel (plans, couleurs, cadre, lumière, mouvement) ; phrases courtes, ton oral de vidéo courte ; français.`;
const SCHEMA = `{"ideas":[{"title":"titre court de l'idée","summary":"l'idée en une phrase","angles":["angle 1","angle 2","angle 3"],"formats":[{"formatId":"id exact","fit":"high|conditional|low","reason":"pourquoi"}],"estimate":{"level":"light|moderate|deep","docHours":1,"shootHours":1,"editHours":1,"why":"ce qui rend rapide ou long"},"structure":{"hook":"la première phrase du post","intro":"le contexte en 1-2 phrases","angles":["point fort 1","point fort 2"],"contradiction":"le contre-argument, la nuance ou la limite","conclusion":"la chute, ou un complément qui ouvre"},"searches":["recherche à faire pour se documenter"]}]}`;

const fmtList = (formats: Format[]) => formats.map((f) => `- "${f.id}" ${f.name} (${f.minSec}–${f.maxSec} s) : ${f.promise}`).join('\n');

/** Une phrase / idée / script → plusieurs idées de posts complètes. */
export async function generateFromSeed(seed: string, m: Memory, signal?: AbortSignal): Promise<GeneratedIdea[]> {
  if (getProvider() === 'none') throw new Error('Branche l’assistant (Paramètres → Assistant IA → Gemini) pour générer des idées.');
  const kind = detectSeed(seed);
  const ask = kind === 'script'
    ? `C'est un script (même partiel). Propose 1 ou 2 idées : garde au maximum ses mots et sa voix dans la structure, complète seulement ce qui manque.`
    : kind === 'idee'
      ? `C'est une idée. Propose 2 ou 3 idées de posts qui la déclinent sous des angles vraiment différents.`
      : `C'est une simple phrase. Propose 3 idées de posts différentes qui peuvent en sortir.`;
  const system = `Tu es l'assistant éditorial d'un vidéaste cinéma (vidéos verticales de 30 à 90 s). ${ask} Pour chaque idée : 3 angles distincts, 1 à 3 formats parmi les siens, une estimation réaliste du temps, une structure de post complète et 2 à 4 recherches utiles pour se documenter. ${RULES} Réponds uniquement en JSON : ${SCHEMA}`;
  const user = `Ses formats :\n${fmtList(m.formats)}\n\nMémoire :\n${memoryBlock(m)}\n\nTexte de départ :\n"""${seed}"""`;
  const { data } = await askAIJson<{ ideas: GeneratedIdea[] }>(system, user, signal);
  const ids = new Set(m.formats.map((f) => f.id));
  return (data.ideas ?? []).filter((d) => d?.title).slice(0, 4).map((d) => ({
    title: String(d.title).slice(0, 90), summary: d.summary ?? '',
    angles: (d.angles ?? []).filter(Boolean).slice(0, 4),
    formats: (d.formats ?? []).filter((f) => ids.has(f.formatId)).slice(0, 3).map((f) => ({ ...f, fit: (['high', 'conditional', 'low'].includes(f.fit) ? f.fit : 'conditional') as FormatSuggestion['fit'], angle: f.angle ?? '' })),
    estimate: d.estimate ? { ...d.estimate, totalHours: (d.estimate.docHours || 0) + (d.estimate.shootHours || 0) + (d.estimate.editHours || 0) } : undefined,
    structure: normStructure(d.structure),
    searches: (d.searches ?? []).filter(Boolean).slice(0, 4),
  }));
}

/** D'autres angles pour une idée générée (sans toucher au reste). */
export async function moreAngles(idea: { title: string; summary: string; angles: string[] }, m: Memory, signal?: AbortSignal): Promise<string[]> {
  const { data } = await askAIJson<{ angles: string[] }>(
    `Tu es l'assistant éditorial d'un vidéaste cinéma. Propose 3 NOUVEAUX angles pour cette idée, différents de ceux déjà proposés. ${RULES} Réponds en JSON : {"angles":["",""]}`,
    `Mémoire :\n${memoryBlock(m)}\n\nIdée : ${idea.title} — ${idea.summary}\nAngles déjà proposés :\n${idea.angles.map((a) => `- ${a}`).join('\n')}`, signal);
  return (data.angles ?? []).filter(Boolean).slice(0, 3);
}

function normStructure(s?: Partial<PostStructure>): PostStructure {
  return {
    hook: s?.hook ?? '', intro: s?.intro ?? '',
    angles: Array.isArray(s?.angles) ? s!.angles.filter(Boolean).slice(0, 4) : s?.angles ? [String(s.angles)] : [],
    contradiction: s?.contradiction ?? '', conclusion: s?.conclusion ?? '',
  };
}

// ---------- Structure de post ⇄ temps forts de la fiche ----------
export const POST_LABELS = { hook: 'Hook', intro: 'Intro', angle: 'Angle', contradiction: 'Contradiction', conclusion: 'Conclusion / complément' };

/** Transforme la structure de post en temps forts, avec des durées adaptées au format. */
export function structureToBeats(s: PostStructure, fmt?: Format): Beat[] {
  const total = fmt ? Math.round((fmt.minSec + fmt.maxSec) / 2) : 45;
  const nA = Math.max(1, s.angles.length);
  const share = { hook: 0.1, intro: 0.15, angles: 0.5, contradiction: 0.13, conclusion: 0.12 };
  const sec = (x: number) => Math.max(3, Math.round(total * x));
  return [
    { id: uid(), label: POST_LABELS.hook, seconds: sec(share.hook), content: s.hook },
    { id: uid(), label: POST_LABELS.intro, seconds: sec(share.intro), content: s.intro },
    ...(s.angles.length ? s.angles : ['']).map((a, i) => ({ id: uid(), label: nA > 1 ? `${POST_LABELS.angle} ${i + 1}` : POST_LABELS.angle, seconds: sec(share.angles / nA), content: a })),
    { id: uid(), label: POST_LABELS.contradiction, seconds: sec(share.contradiction), content: s.contradiction },
    { id: uid(), label: POST_LABELS.conclusion, seconds: sec(share.conclusion), content: s.conclusion },
  ];
}

/** Lit la structure de post depuis les temps forts (si l'idée en a une). */
export function beatsToStructure(beats: Beat[]): PostStructure | null {
  const find = (re: RegExp) => beats.find((b) => re.test(b.label));
  const hook = find(/^hook/i), intro = find(/^intro/i), con = find(/^contradiction/i), fin = find(/^conclusion/i);
  if (!hook && !intro && !con && !fin) return null;
  return {
    hook: hook?.content ?? '', intro: intro?.content ?? '',
    angles: beats.filter((b) => /^angle/i.test(b.label)).map((b) => b.content),
    contradiction: con?.content ?? '', conclusion: fin?.content ?? '',
  };
}

/** Complète (ou propose) la structure de post d'une idée existante, en gardant ce qui est déjà écrit. */
export async function completePostStructure(idea: Idea, m: Memory, signal?: AbortSignal): Promise<PostStructure> {
  const cur = beatsToStructure(idea.structure);
  const fmt = m.formats.find((f) => f.id === idea.formatId);
  const { data } = await askAIJson<{ structure: PostStructure }>(
    `Tu es l'assistant éditorial d'un vidéaste cinéma. Construis ou complète la structure de son post. Garde mot pour mot ce qu'il a déjà écrit ; complète seulement les parties vides. ${RULES} Réponds en JSON : {"structure":{"hook":"","intro":"","angles":["",""],"contradiction":"","conclusion":""}}`,
    `Mémoire :\n${memoryBlock(m)}\n\nIdée : ${idea.title}\nObservation : ${idea.observation}\nAngle retenu : ${idea.angle}\nHook actuel : ${idea.hook}\n${fmt ? `Format : ${fmt.name} (${fmt.minSec}–${fmt.maxSec} s) — ${fmt.promise}\n` : ''}Structure actuelle : ${cur ? JSON.stringify(cur) : 'aucune'}\nScript actuel : ${idea.script.slice(0, 2500)}`,
    signal);
  const s = normStructure(data.structure);
  if (cur) { // ne jamais écraser ce qui est écrit
    s.hook = cur.hook || s.hook; s.intro = cur.intro || s.intro; s.contradiction = cur.contradiction || s.contradiction; s.conclusion = cur.conclusion || s.conclusion;
    if (cur.angles.some(Boolean)) s.angles = cur.angles.map((a, i) => a || s.angles[i] || '');
  }
  return s;
}

/** Données d'une idée générée → champs d'une fiche d'idée. */
export function generatedToIdea(g: GeneratedIdea, chosenAngles: number[], seed: string, formats: Format[]): Partial<Idea> {
  const top = g.formats[0];
  const fmt = formats.find((f) => f.id === top?.formatId);
  const chosen = chosenAngles.length ? chosenAngles.map((i) => g.angles[i]).filter(Boolean) : [];
  const suggestions: Suggestions = { formats: g.formats, estimate: g.estimate, source: 'ia', at: Date.now() };
  return {
    title: g.title, observation: seed, formatId: top && top.fit !== 'low' ? top.formatId : undefined,
    angle: chosen.join(' + '), hook: g.structure.hook,
    angles: g.angles.map((a, i) => ({ id: uid(), text: a, chosen: chosenAngles.includes(i), origin: 'ia' as const })),
    structure: structureToBeats({ ...g.structure, angles: g.structure.angles.length ? g.structure.angles : chosen }, fmt),
    suggestions,
    research: g.estimate ? { level: g.estimate.level, justification: g.estimate.why, sourcesNeeded: g.searches.join(' · '), missing: '', docHours: g.estimate.docHours, shootHours: g.estimate.shootHours, editHours: g.estimate.editHours } : undefined,
    missingInfo: g.searches.length ? g.searches.map((s) => `- À chercher : ${s}`).join('\n') : '',
    status: chosen.length ? 'angle' : 'idea',
  };
}

// ---------- Titres distincts : deux idées sœurs ne doivent pas se confondre dans la liste ----------
const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\[.*?\]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
export function similarTitles(a: string, b: string): boolean {
  const x = norm(a), y = new Set(norm(b));
  if (!x.length || !y.size) return false;
  const common = x.filter((w) => y.has(w)).length;
  return common / Math.min(x.length, y.size) >= 0.5;
}
const short = (t: string, n = 48) => { const c = t.split(/[\n.:;]/)[0].trim(); return c.length > n ? `${c.slice(0, n).replace(/\s+\S*$/, '')}…` : c; };
/** Si le titre ressemble à une idée existante, on le précise avec l'angle (ou le format), puis un numéro de variante. */
export function distinctTitle(title: string, existing: string[], angle?: string, formatName?: string): string {
  if (!existing.some((e) => similarTitles(title, e))) return title;
  const detail = angle ? short(angle) : formatName;
  let t = detail ? `${title} — ${detail}` : title;
  let n = 2;
  const base = t;
  while (existing.some((e) => e.trim().toLowerCase() === t.trim().toLowerCase())) t = `${base} (variante ${n++})`;
  return t;
}

// ---------- Familles de variantes : idées sœurs issues de la même idée de départ ----------
export const FAMILY_COLORS = ['#c79a76', '#86a8a4', '#b3a2c4', '#c2b48a', '#a7b6c9'];
export interface Variant { n: number; of: number; color: string }
/** Regroupe les idées dont le titre se ressemble ou qui partent de la même observation. */
export function variantFamilies(ideas: { id: string; title: string; observation: string; createdAt: number }[]): Map<string, Variant> {
  const out = new Map<string, Variant>();
  const seen = new Set<string>();
  let fam = 0;
  const sorted = [...ideas].sort((a, b) => a.createdAt - b.createdAt);
  for (const a of sorted) {
    if (seen.has(a.id)) continue;
    const group = sorted.filter((b) => b.id === a.id || (!seen.has(b.id) && (similarTitles(a.title, b.title) || (a.observation.trim().length > 20 && a.observation.trim() === b.observation.trim()))));
    if (group.length < 2) continue;
    const color = FAMILY_COLORS[fam++ % FAMILY_COLORS.length];
    group.forEach((g, i) => { seen.add(g.id); out.set(g.id, { n: i + 1, of: group.length, color }); });
  }
  return out;
}
