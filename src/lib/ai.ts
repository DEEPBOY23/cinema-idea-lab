// Assistant IA facultatif. Un seul fournisseur actif à la fois, choisi dans Paramètres.
// - OpenAI (modèles de ChatGPT) : clé API platform.openai.com, facturée à l'usage, séparée de ChatGPT Plus.
// - Claude : clé API platform.claude.com, séparée de l'abonnement Claude.
// Les clés restent sur cet appareil (localStorage) : jamais synchronisées, jamais exportées.
import { getClaudeConfig, askClaude, claudeEnabled } from './claude';

export type Provider = 'gemini' | 'openai' | 'claude' | 'none';
export interface OpenAIConfig { apiKey: string; model: string }
const OKEY = 'cil.openai';
const PKEY = 'cil.ai.provider';

export function getOpenAIConfig(): OpenAIConfig {
  try { const r = localStorage.getItem(OKEY); if (r) return JSON.parse(r); } catch { /* indisponible */ }
  return { apiKey: '', model: '' };
}
export function setOpenAIConfig(c: OpenAIConfig) { localStorage.setItem(OKEY, JSON.stringify(c)); notify(); }
export function clearOpenAIConfig() { localStorage.removeItem(OKEY); notify(); }

// ---- Gemini (Google) : fournisseur par défaut, clé gratuite sur Google AI Studio ----
export interface GeminiConfig { apiKey: string; model: string }
const GKEY = 'cil.gemini';
export function getGeminiConfig(): GeminiConfig {
  try { const r = localStorage.getItem(GKEY); if (r) return JSON.parse(r); } catch { /* indisponible */ }
  return { apiKey: '', model: '' };
}
export function setGeminiConfig(c: GeminiConfig) { localStorage.setItem(GKEY, JSON.stringify(c)); notify(); }
export function clearGeminiConfig() { localStorage.removeItem(GKEY); notify(); }

const hasKey = (p: Provider) => (p === 'gemini' ? !!getGeminiConfig().apiKey : p === 'openai' ? !!getOpenAIConfig().apiKey : p === 'claude' ? claudeEnabled() : false);

/** Fournisseur actif : celui choisi s'il a une clé, sinon le premier configuré (Gemini d'abord). */
export function getProvider(): Provider {
  let p: Provider | null = null;
  try { p = localStorage.getItem(PKEY) as Provider | null; } catch { /* */ }
  if (p === 'none') return 'none';
  if (p && hasKey(p)) return p;
  return (['gemini', 'openai', 'claude'] as Provider[]).find(hasKey) ?? 'none';
}
export function setProvider(p: Provider) { localStorage.setItem(PKEY, p); notify(); }
function notify() { window.dispatchEvent(new Event('cil-claude-config')); }

export const aiEnabled = () => getProvider() !== 'none';
export const providerLabel = (p = getProvider()) => (p === 'gemini' ? 'Gemini (gratuit)' : p === 'openai' ? 'ChatGPT (API OpenAI)' : p === 'claude' ? 'Claude (API)' : 'aucune IA');

// ---------------- OpenAI ----------------
const OPENAI = 'https://api.openai.com/v1';
const EXCLUDE = /(audio|realtime|transcribe|tts|whisper|embedding|dall-e|image|moderation|search|codex|instruct|babbage|davinci|computer|deep-research|-preview)/i;

/** Liste réelle des modèles de texte accessibles avec ta clé (gratuit : aucun jeton consommé). */
export async function listOpenAIModels(apiKey: string): Promise<string[]> {
  const r = await fetch(`${OPENAI}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (r.status === 401) throw new Error('Clé refusée par OpenAI : vérifie-la sur platform.openai.com.');
  if (!r.ok) throw new Error(`Erreur OpenAI ${r.status}`);
  const j = await r.json();
  return (j.data as { id: string }[]).map((m) => m.id).filter((id) => /^(gpt-|o\d)/.test(id) && !EXCLUDE.test(id)).sort();
}

/** Choix par défaut « le plus pertinent » : la version GPT la plus récente, modèle complet (pas mini/nano), alias sans date. */
export function pickDefaultModel(ids: string[]): string {
  const score = (id: string) => {
    const v = parseFloat((id.match(/^gpt-(\d+(?:\.\d+)?)/) ?? [])[1] ?? '0');
    let s = v * 100;
    if (/mini|nano/.test(id)) s -= 30;
    if (/\d{4}-\d{2}-\d{2}/.test(id)) s -= 5; // préférer l'alias qui suit les mises à jour
    if (/chat-latest/.test(id)) s -= 2;
    return s;
  };
  return [...ids].sort((a, b) => score(b) - score(a))[0] ?? '';
}

async function openAIChat(system: string, user: string, json: boolean, signal?: AbortSignal): Promise<{ text: string; model: string }> {
  const cfg = getOpenAIConfig();
  if (!cfg.apiKey) throw new Error('Aucune clé OpenAI configurée (Paramètres → Assistant IA).');
  let model = cfg.model;
  if (!model) { model = pickDefaultModel(await listOpenAIModels(cfg.apiKey)); setOpenAIConfig({ ...cfg, model }); }
  let r: Response;
  try {
    r = await fetch(`${OPENAI}/chat/completions`, {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    // OpenAI ne rend pas lisibles ses réponses d'erreur d'authentification depuis un navigateur.
    throw new Error(navigator.onLine
      ? 'OpenAI a refusé la demande : clé invalide ou révoquée, ou crédit épuisé. Vérifie dans Paramètres → Assistant IA (« Connecter » teste la clé).'
      : 'Hors ligne : l’IA n’est pas joignable. Le tri simple et le copier-coller restent disponibles.');
  }
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    const msg = body?.error?.message ?? '';
    if (r.status === 401) throw new Error('Clé OpenAI refusée. Vérifie-la dans Paramètres → Assistant IA.');
    if (r.status === 429) throw new Error(/quota|billing|credit/i.test(msg) ? 'Crédit OpenAI épuisé : ajoute des crédits sur platform.openai.com.' : 'Trop de requêtes, réessaie dans un instant.');
    if (r.status === 404) throw new Error(`Le modèle « ${model} » n’est pas accessible avec ta clé. Choisis-en un autre dans Paramètres.`);
    throw new Error(`Erreur OpenAI ${r.status} : ${msg}`);
  }
  const j = await r.json();
  const choice = j.choices?.[0];
  if (choice?.message?.refusal) throw new Error('Le modèle a refusé cette demande.');
  return { text: (choice?.message?.content ?? '').trim(), model: j.model ?? model };
}

// ---------------- Gemini ----------------
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const G_EXCLUDE = /(embed|tts|image|imagen|vision|live|audio|native|aqa|learnlm|gemma|veo|robotics|computer|exp|preview|thinking)/i;

function geminiError(status: number, body: any): Error {
  const msg: string = body?.error?.message ?? '';
  const reason: string = body?.error?.details?.find((d: any) => d.reason)?.reason ?? '';
  if (reason === 'API_KEY_INVALID' || /API key not valid/i.test(msg)) return new Error('Clé Gemini refusée : vérifie-la sur Google AI Studio (aistudio.google.com).');
  if (status === 429) return new Error('Limite gratuite de Gemini atteinte pour le moment. Réessaie plus tard, ou utilise le tri simple.');
  if (status === 403) return new Error('Accès refusé par Google pour cette clé (pays, compte ou API non activée).');
  if (status === 404) return new Error('Ce modèle Gemini n’est pas disponible avec ta clé. Reconnecte-toi dans Paramètres pour en choisir un autre.');
  return new Error(`Erreur Gemini ${status} : ${msg}`);
}

/** Modèles Gemini de texte accessibles avec ta clé (appel gratuit, aucun jeton consommé). */
export async function listGeminiModels(apiKey: string): Promise<string[]> {
  let r: Response;
  try { r = await fetch(`${GEMINI}/models?pageSize=1000`, { headers: { 'x-goog-api-key': apiKey } }); }
  catch { throw new Error('Pas de connexion à Google (hors ligne ?).'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw geminiError(r.status, j);
  return ((j.models ?? []) as { name: string; supportedGenerationMethods?: string[] }[])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((id) => /^gemini-/.test(id) && !G_EXCLUDE.test(id))
    .sort();
}

/** Par défaut : le « flash » stable le plus récent (rapide, et le plus généreux en accès gratuit). */
export function pickGeminiModel(ids: string[]): string {
  const score = (id: string) => {
    const v = parseFloat((id.match(/^gemini-(\d+(?:\.\d+)?)/) ?? [])[1] ?? '0');
    let s = v * 100;
    if (/flash/.test(id) && !/lite/.test(id)) s += 20;
    else if (/lite/.test(id)) s += 5;
    if (/pro/.test(id)) s -= 10; // accès gratuit souvent très limité
    if (/-\d{3}$|\d{2}-\d{2}/.test(id)) s -= 3; // préférer l'alias stable
    if (/latest/.test(id)) s -= 1;
    return s;
  };
  return [...ids].sort((a, b) => score(b) - score(a))[0] ?? '';
}

async function geminiChat(system: string, user: string, json: boolean, signal?: AbortSignal): Promise<{ text: string; model: string }> {
  const cfg = getGeminiConfig();
  if (!cfg.apiKey) throw new Error('Aucune clé Gemini configurée (Paramètres → Assistant IA).');
  let model = cfg.model;
  if (!model) { model = pickGeminiModel(await listGeminiModels(cfg.apiKey)); setGeminiConfig({ ...cfg, model }); }
  let r: Response;
  try {
    r = await fetch(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal,
      headers: { 'x-goog-api-key': cfg.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        ...(json ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
      }),
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new Error('Hors ligne : Gemini n’est pas joignable. Le tri simple et le copier-coller restent disponibles.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw geminiError(r.status, j);
  if (j.promptFeedback?.blockReason) throw new Error('Gemini a bloqué cette demande. Reformule ou utilise le copier-coller.');
  const cand = j.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p: any) => (p.thought ? '' : p.text ?? '')).join('').trim();
  if (!text) throw new Error(cand?.finishReason === 'SAFETY' ? 'Gemini a bloqué cette réponse.' : 'Réponse vide de Gemini. Réessaie.');
  return { text: cand?.finishReason === 'MAX_TOKENS' ? `${text}\n\n[Réponse coupée]` : text, model: j.modelVersion ?? model };
}

// ---------------- Recherche web réelle (Gemini + Google Search) ----------------
export interface FoundSource { url: string; title: string; viaGoogle: boolean; note?: string }
export interface GroundedResult { text: string; sources: FoundSource[]; queries: string[]; model: string }
// La recherche Google n'est gratuite que sur certains modèles (Gemini 2.5 Flash d'après la doc de Google) :
// on essaie d'abord celui-ci, puis le modèle choisi.
const GROUNDING_FREE_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
export const groundingAvailable = () => getProvider() === 'gemini';

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

export async function searchWebSources(prompt: string, signal?: AbortSignal): Promise<GroundedResult> {
  const cfg = getGeminiConfig();
  if (!cfg.apiKey) throw new Error('La recherche de sources réelles utilise Gemini : ajoute ta clé dans Paramètres → Assistant IA.');
  const order = [...new Set([...GROUNDING_FREE_MODELS, cfg.model].filter(Boolean))];
  let lastErr: Error | null = null;
  for (const model of order) {
    let r: Response;
    try {
      r = await fetch(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', signal,
        headers: { 'x-goog-api-key': cfg.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }),
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e;
      throw new Error('Hors ligne : la recherche de sources demande une connexion.');
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { lastErr = geminiError(r.status, j); if (r.status === 400 && /API key/i.test(j?.error?.message ?? '')) throw lastErr; continue; }
    const cand = j.candidates?.[0];
    const text = (cand?.content?.parts ?? []).map((p: any) => (p.thought ? '' : p.text ?? '')).join('').trim();
    const gm = cand?.groundingMetadata ?? {};
    const chunks: FoundSource[] = (gm.groundingChunks ?? [])
      .map((c: any) => c.web).filter((w: any) => w?.uri)
      .map((w: any) => ({ url: w.uri as string, title: (w.title as string) || host(w.uri), viaGoogle: true }));
    if (!chunks.length) { lastErr = new Error('La recherche Google n’a rien renvoyé pour cette demande. Précise le sujet (film, réalisateur, technique).'); continue; }
    // Liens écrits par le modèle : gardés seulement si leur site fait partie des résultats Google.
    const googleDomains = new Set(chunks.map((c) => (c.title.includes('.') ? c.title.replace(/^www\./, '') : host(c.url))));
    const written: FoundSource[] = [];
    for (const m of text.matchAll(/https?:\/\/[^\s)\]>"]+/g)) {
      const url = m[0].replace(/[.,;:]+$/, '');
      const h = host(url);
      if (h && [...googleDomains].some((d) => h === d || h.endsWith('.' + d))) {
        const line = (text.split('\n') as string[]).find((l: string) => l.includes(url)) ?? '';
        written.push({ url, title: line.replace(url, '').replace(/^[-*•\d.)\s]+/, '').replace(/[\s—–:-]+$/, '').slice(0, 140) || h, viaGoogle: true, note: 'lien direct cité par Gemini, site confirmé par Google' });
      }
    }
    const seen = new Set<string>();
    const sources = [...written, ...chunks].filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
    return { text, sources, queries: gm.webSearchQueries ?? [], model: j.modelVersion ?? model };
  }
  throw lastErr ?? new Error('Recherche impossible pour le moment.');
}

// ---------------- Interface commune ----------------
export interface AIText { text: string; model: string; note?: string }

/** Texte libre (atelier). */
export async function askAI(prompt: string, signal?: AbortSignal): Promise<AIText> {
  const p = getProvider();
  if (p === 'gemini') return geminiChat('Tu es un assistant éditorial cinéma rigoureux. Réponds en français.', prompt, false, signal);
  if (p === 'openai') return openAIChat('Tu es un assistant éditorial cinéma rigoureux. Réponds en français.', prompt, false, signal);
  if (p === 'claude') {
    const a = await askClaude(prompt, signal);
    return { text: a.text, model: a.model, note: a.costUsd !== undefined ? `≈ ${a.costUsd < 0.01 ? '< 0,01' : a.costUsd.toFixed(2).replace('.', ',')} $` : undefined };
  }
  throw new Error('Aucune IA configurée (Paramètres → Assistant IA).');
}

/** Réponse JSON structurée (rattachement aux formats, bac à idées). */
export async function askAIJson<T>(system: string, user: string, signal?: AbortSignal): Promise<{ data: T; model: string }> {
  const p = getProvider();
  let res: AIText;
  if (p === 'gemini') res = await geminiChat(system, user, true, signal);
  else if (p === 'openai') res = await openAIChat(system, user, true, signal);
  else if (p === 'claude') res = await askAI(`${system}\n\nRéponds uniquement avec un objet JSON valide, sans texte autour.\n\n${user}`, signal);
  else throw new Error('Aucune IA configurée.');
  return { data: extractJson<T>(res.text), model: res.model };
}

export function extractJson<T>(text: string): T {
  const t = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try { return JSON.parse(t); } catch { /* chercher le premier objet */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('Réponse de l’IA illisible. Réessaie.');
}

export { getClaudeConfig };
