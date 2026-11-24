// Test de l'assistant, niveau par niveau, sur l'appareil où on le lance.
import { askAI, askAIJson, getProvider, getGeminiConfig, geminiFetch, clearGroundingRefusal, markGroundingRefused, providerLabel } from './ai';

export interface Check { name: string; ok: boolean | null; detail: string }

export async function diagnoseAI(onStep: (c: Check[]) => void): Promise<Check[]> {
  const out: Check[] = [];
  const push = (c: Check) => { out.push(c); onStep([...out]); };
  const p = getProvider();
  if (p === 'none') { push({ name: 'Assistant branché', ok: false, detail: 'Aucune clé sur cet appareil. Paramètres → Assistant IA → colle ta clé Gemini.' }); return out; }
  const cfg = getGeminiConfig();
  push({ name: 'Assistant branché', ok: true, detail: `${providerLabel(p)}${p === 'gemini' ? ` · offre ${cfg.plan === 'paid' ? 'payante' : 'gratuite'} · modèle ${cfg.model}` : ''}` });

  try { const r = await askAI('Réponds seulement : OK'); push({ name: 'Texte (idées, angles, structure, résumés)', ok: true, detail: `Répond (${r.model}).` }); }
  catch (e: any) { push({ name: 'Texte (idées, angles, structure, résumés)', ok: false, detail: e?.message ?? String(e) }); return out; }

  try { const { data } = await askAIJson<{ ok: boolean }>('Réponds en JSON : {"ok":true}', 'test'); push({ name: 'Réponses structurées (Créer, Bac à idées, estimations)', ok: !!data?.ok, detail: data?.ok ? 'Fonctionne.' : 'Réponse inattendue.' }); }
  catch (e: any) { push({ name: 'Réponses structurées (Créer, Bac à idées, estimations)', ok: false, detail: e?.message ?? String(e) }); }

  if (p !== 'gemini') { push({ name: 'Recherche Google et lecture d’articles', ok: null, detail: 'Réservées à Gemini.' }); return out; }

  try {
    const { r, j } = await geminiFetch(cfg.model, cfg.apiKey, { contents: [{ role: 'user', parts: [{ text: 'Quel est le titre du dernier film de Denis Villeneuve ? Une ligne.' }] }], tools: [{ google_search: {} }] }, 60_000);
    const chunks = j?.candidates?.[0]?.groundingMetadata?.groundingChunks?.length ?? 0;
    if (r.ok) { clearGroundingRefusal(); push({ name: 'Recherche Google (vraies sources)', ok: true, detail: `Fonctionne (${chunks} résultat${chunks > 1 ? 's' : ''}).` }); }
    else if (r.status === 429) { markGroundingRefused(); push({ name: 'Recherche Google (vraies sources)', ok: false, detail: cfg.plan === 'paid' ? 'Refusée (quota). Vérifie que la facturation est active sur ce projet dans Google AI Studio.' : 'Non incluse dans l’offre gratuite : l’app utilisera les « pistes de recherche ». Passe en Payant pour les vrais liens.' }); }
    else push({ name: 'Recherche Google (vraies sources)', ok: false, detail: j?.error?.message ?? `Erreur ${r.status}` });
  } catch (e: any) { push({ name: 'Recherche Google (vraies sources)', ok: false, detail: e?.message ?? 'Pas de réponse à temps.' }); }

  try {
    const { r, j } = await geminiFetch(cfg.model, cfg.apiKey, { contents: [{ role: 'user', parts: [{ text: 'Lis https://example.com et donne son titre en une ligne.' }] }], tools: [{ url_context: {} }] }, 60_000);
    const st = j?.candidates?.[0]?.urlContextMetadata?.urlMetadata?.[0]?.urlRetrievalStatus ?? '';
    const ok = r.ok && /SUCCESS/.test(st);
    push({ name: 'Lecture d’articles (✦ résumé)', ok, detail: ok ? 'Fonctionne.' : r.ok ? `Page non lue (${st || 'statut inconnu'}).` : (j?.error?.message ?? `Erreur ${r.status}`) });
  } catch (e: any) { push({ name: 'Lecture d’articles (✦ résumé)', ok: false, detail: e?.message ?? 'Pas de réponse à temps.' }); }
  return out;
}
