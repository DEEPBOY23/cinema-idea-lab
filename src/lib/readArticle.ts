// « Résumer » un article : Gemini lit la page (outil url_context) et remplit une fiche de notes.
// Les citations doivent être recopiées mot pour mot ; faits, déclarations, interprétations et
// points à vérifier sont séparés. La case « Mes propres observations » reste à l'utilisateur.
import { db, uid } from '../db';
import type { Source, Claim, Idea } from '../types';
import { getGeminiConfig, getProvider, geminiFetch, geminiError, Timeout, extractJson } from './ai';
import { touchIdea } from './actions';

export const canReadArticles = () => getProvider() === 'gemini';

interface ArticleDigest {
  title?: string; author?: string; media?: string; date?: string; minutes?: number;
  summary?: string; learned?: string[];
  quotes?: { text: string; speaker?: string }[];
  facts?: string[]; interpretations?: string[]; toVerify?: string[];
  scenes?: string[]; usefulFor?: string; access?: 'free' | 'paywall' | 'signup';
}

const SCHEMA = `{"title":"titre exact de la page","author":"auteur(s) si indiqué","media":"nom du site ou du média","date":"date de publication si indiquée (AAAA-MM-JJ ou AAAA)","minutes":5,"access":"free|paywall|signup","summary":"résumé en 3 phrases","learned":["ce qu'on y apprend, une idée par élément"],"quotes":[{"text":"citation recopiée MOT POUR MOT depuis la page","speaker":"qui parle"}],"facts":["fait vérifiable affirmé par l'article"],"interpretations":["lecture ou analyse de l'auteur, pas un fait"],"toVerify":["affirmation à recouper ailleurs"],"scenes":["scène ou plan précis mentionné"],"usefulFor":"en quoi l'article sert l'idée de vidéo, 1-2 phrases"}`;

export async function readArticle(source: Source, idea?: Idea, signal?: AbortSignal): Promise<{ noteId: string; digest: ArticleDigest; model: string }> {
  if (!source.url) throw new Error('Cet article n’a pas de lien à lire.');
  if (/youtube\.com|youtu\.be/.test(source.url)) throw new Error('Gemini ne peut pas lire les vidéos YouTube avec cette fonction. Prends tes notes à la main pour celle-ci.');
  const cfg = getGeminiConfig();
  if (!cfg.apiKey) throw new Error('La lecture d’articles utilise Gemini : ajoute ta clé dans Paramètres → Assistant IA.');
  const prompt = [
    `Lis attentivement cette page : ${source.url}`,
    idea ? `Je prépare une courte vidéo d'analyse cinéma : « ${idea.title} »${idea.angle ? `, angle : ${idea.angle}` : ''}${idea.observation ? `. Mon observation : ${idea.observation.slice(0, 400)}` : ''}.` : 'Je prépare une courte vidéo d’analyse cinéma.',
    `Extrais ce qui est utile, en français (sauf les citations, à garder dans leur langue d'origine). Règles strictes :`,
    `- "quotes" : uniquement des phrases RECOPIÉES MOT POUR MOT dans la page, avec la personne qui parle. Si tu n'es pas sûr du mot à mot, ne mets pas la citation.`,
    `- Sépare les faits (vérifiables) des interprétations (analyse de l'auteur).`,
    `- N'ajoute rien qui n'est pas dans la page. Si la page est inaccessible, payante ou vide, mets "access" en conséquence et laisse le reste vide.`,
    `Réponds uniquement en JSON : ${SCHEMA}`,
  ].join('\n');
  const order = [...new Set([cfg.model, ...(cfg.models ?? [])].filter(Boolean))].slice(0, 3);
  let last: Error = new Error('Lecture impossible pour le moment.');
  for (const model of order) {
    let res;
    try {
      res = await geminiFetch(model, cfg.apiKey, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ url_context: {} }],
        generationConfig: { responseMimeType: 'application/json' },
      }, 120_000, signal);
    } catch (e: any) { if (e instanceof Timeout) { last = new Error('La lecture de l’article n’a pas abouti à temps.'); continue; } throw e; }
    const { r, j } = res;
    if (!r.ok) {
      last = r.status === 429 && /quota/i.test(j?.error?.message ?? '')
        ? new Error('La lecture d’articles n’est pas disponible avec ton offre Gemini actuelle (quota). Elle fonctionne avec l’offre payante.')
        : geminiError(r.status, j);
      if (/Clé Gemini refusée/.test(last.message)) throw last;
      continue;
    }
    const cand = j.candidates?.[0];
    const statuses: string[] = (cand?.urlContextMetadata?.urlMetadata ?? []).map((m: any) => m.urlRetrievalStatus);
    if (statuses.length && !statuses.includes('URL_RETRIEVAL_STATUS_SUCCESS')) {
      throw new Error('Gemini n’a pas pu ouvrir cette page (payante, connexion requise, ou bloquée par le site). Ouvre-la toi-même avec ↗.');
    }
    const text = (cand?.content?.parts ?? []).map((p: any) => (p.thought ? '' : p.text ?? '')).join('').trim();
    if (!text) { last = new Error('Réponse vide de Gemini.'); continue; }
    const d = extractJson<ArticleDigest>(text);
    if (d.access && d.access !== 'free' && !(d.summary || d.learned?.length)) {
      await db.sources.update(source.id, { access: d.access === 'paywall' ? 'paywall' : 'signup', updatedAt: Date.now() });
      throw new Error(d.access === 'paywall' ? 'Article payant : Gemini n’a accès qu’au début. Statut mis à « Payant ».' : 'Article réservé aux inscrits : statut mis à « Inscription requise ».');
    }
    const noteId = await saveDigest(source, d, model);
    return { noteId, digest: d, model: j.modelVersion ?? model };
  }
  throw last;
}

const bullets = (xs?: string[]) => (xs ?? []).filter(Boolean).map((x) => `- ${x}`).join('\n');

async function saveDigest(source: Source, d: ArticleDigest, model: string): Promise<string> {
  const now = Date.now();
  const ref = [d.media || source.media, d.date].filter(Boolean).join(', ') || source.url;
  const claims: Claim[] = [
    ...(d.quotes ?? []).filter((q) => q?.text).map((q) => ({ id: uid(), text: `« ${q.text} »${q.speaker ? ` — ${q.speaker}` : ''}`, nature: 'statement' as const, ref })),
    ...(d.facts ?? []).filter(Boolean).map((t) => ({ id: uid(), text: t, nature: 'fact' as const, ref })),
    ...(d.interpretations ?? []).filter(Boolean).map((t) => ({ id: uid(), text: t, nature: 'interpretation' as const, ref: d.author ? `${d.author}, ${ref}` : ref })),
  ];
  const learned = [d.summary, bullets(d.learned)].filter(Boolean).join('\n\n');
  const header = `Résumé automatique (Gemini, ${new Date(now).toLocaleDateString('fr-FR')}) — à relire : vérifie les citations dans l’article avant de les utiliser.`;
  const existing = (await db.notes.where('sourceId').equals(source.id).toArray()).find((n) => !n.deletedAt);
  let noteId: string;
  if (existing) {
    noteId = existing.id;
    await db.notes.update(existing.id, {
      learned: [existing.learned, `${header}\n${learned}`].filter(Boolean).join('\n\n'),
      rewatch: [existing.rewatch, bullets(d.scenes)].filter(Boolean).join('\n'),
      toVerify: [existing.toVerify, bullets(d.toVerify)].filter(Boolean).join('\n'),
      claims: [...existing.claims, ...claims], updatedAt: now,
    });
  } else {
    noteId = uid();
    await db.notes.add({
      id: noteId, sourceId: source.id, ideaId: source.ideaIds[0], title: `Notes — ${d.title || source.title}`,
      learned: `${header}\n${learned}`, surprised: '', observations: '', rewatch: bullets(d.scenes), toVerify: bullets(d.toVerify), toDeepen: '',
      claims, createdAt: now, updatedAt: now,
    });
  }
  const looksAuto = !source.title || /·|^https?:/.test(source.title);
  await db.sources.update(source.id, {
    ...(looksAuto && d.title ? { title: d.title } : {}),
    ...(!source.author && d.author ? { author: d.author } : {}),
    ...(!source.media && d.media ? { media: d.media } : {}),
    ...(!source.date && d.date ? { date: d.date } : {}),
    ...(!source.minutes && typeof d.minutes === 'number' && d.minutes > 0 ? { minutes: Math.round(d.minutes) } : {}),
    ...(d.usefulFor && !source.interest ? { interest: d.usefulFor } : {}),
    access: source.access === 'unverified' ? 'verified' : source.access,
    state: source.state === 'toread' ? 'reading' : source.state,
    updatedAt: now,
  });
  await db.journal.add({ id: uid(), ideaId: source.ideaIds[0], noteId, at: now, text: `Article résumé par ${model} : « ${d.title || source.title} » (${claims.length} élément${claims.length > 1 ? 's' : ''} qualifié${claims.length > 1 ? 's' : ''}).` });
  for (const i of source.ideaIds) await touchIdea(i);
  return noteId;
}
