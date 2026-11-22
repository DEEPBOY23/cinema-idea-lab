// Option facultative : appel direct à l'API Claude (Anthropic), avec TA clé API.
// - L'abonnement Claude Pro/Max ne peut pas être utilisé ici : l'API est un service séparé, facturé à l'usage.
// - La clé reste sur cet appareil (localStorage) : jamais synchronisée, jamais incluse dans les exports.
// - Le SDK est chargé à la demande, seulement si tu utilises l'option.

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (le plus capable, par défaut)', price: '4 $ / 20 $ par million de jetons (entrée / sortie)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (rapide)', price: '2 $ / 10 $ par million de jetons' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (le moins cher)', price: '0,10 $ / 0,50 $ par million de jetons' },
] as const;

export interface ClaudeConfig { apiKey: string; model: string }
const KEY = 'cil.claude';

export function getClaudeConfig(): ClaudeConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { model: CLAUDE_MODELS[0].id, ...JSON.parse(raw) };
  } catch { /* stockage indisponible */ }
  return { apiKey: '', model: CLAUDE_MODELS[0].id };
}
export function setClaudeConfig(c: ClaudeConfig) {
  localStorage.setItem(KEY, JSON.stringify(c));
  window.dispatchEvent(new Event('cil-claude-config'));
}
export function clearClaudeConfig() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event('cil-claude-config'));
}
export const claudeEnabled = () => getClaudeConfig().apiKey.trim().length > 0;

async function client(apiKey: string) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // Appel depuis le navigateur : la clé est la tienne et reste sur ton appareil.
  return { Anthropic, c: new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) };
}

/** Vérifie la clé sans consommer de jetons (liste des modèles). */
export async function testClaudeKey(apiKey: string): Promise<string> {
  const { Anthropic, c } = await client(apiKey);
  try {
    await c.models.retrieve(CLAUDE_MODELS[0].id);
    return 'Clé valide.';
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return 'Clé refusée : vérifie-la sur platform.claude.com.';
    if (e instanceof Anthropic.APIConnectionError) return 'Pas de connexion à l’API (hors ligne ?).';
    if (e instanceof Anthropic.APIError) return `Erreur ${e.status} : ${e.message}`;
    throw e;
  }
}

export interface ClaudeAnswer { text: string; model: string; inputTokens: number; outputTokens: number; costUsd?: number }

const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5],
};

/** Envoie le prompt préparé par l'atelier et renvoie la réponse texte. */
export async function askClaude(prompt: string, signal?: AbortSignal): Promise<ClaudeAnswer> {
  const cfg = getClaudeConfig();
  if (!cfg.apiKey) throw new Error('Aucune clé API configurée (Paramètres → Claude).');
  const { Anthropic, c } = await client(cfg.apiKey);
  // Repli automatique côté serveur si le modèle décline (non disponible pour Haiku 5.5).
  const fallback = cfg.model === 'claude-haiku-5-5'
    ? {}
    : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };
  try {
    const msg = await c.beta.messages.stream({
      model: cfg.model,
      max_tokens: 16000,
      output_config: { effort: 'high' },
      ...fallback,
      messages: [{ role: 'user', content: prompt }],
    }, { signal }).finalMessage();

    if (msg.stop_reason === 'refusal') {
      throw new Error('Claude a décliné cette demande. Reformule le prompt ou utilise le copier-coller.');
    }
    const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
    const p = PRICES[msg.model] ?? PRICES[cfg.model];
    const inputTokens = msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
    const outputTokens = msg.usage.output_tokens;
    return {
      text: msg.stop_reason === 'max_tokens' ? `${text}\n\n[Réponse coupée : limite de longueur atteinte]` : text,
      model: msg.model, inputTokens, outputTokens,
      costUsd: p ? (inputTokens * p[0] + outputTokens * p[1]) / 1_000_000 : undefined,
    };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Clé API refusée. Vérifie-la dans Paramètres → Claude.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Limite de requêtes atteinte. Réessaie dans un moment.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Pas de connexion à l’API Claude (hors ligne ?). Le copier-coller reste disponible.');
    if (e instanceof Anthropic.APIError) throw new Error(`Erreur API ${e.status} : ${e.message}`);
    throw e;
  }
}
