// Analyses de texte locales (sans IA) : mesures factuelles, jamais de jugement inventé.

export const words = (t: string) => t.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
export const wordCount = (t: string) => words(t).length;
export const oralSeconds = (t: string, wpm = 150) => Math.round((wordCount(t) / wpm) * 60);

export function sentences(t: string): string[] {
  // Un script oral n'a pas toujours de majuscule après le point : on coupe sur toute ponctuation finale,
  // sauf après quelques abréviations courantes.
  return t.replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])(?<!\b(?:M|Mme|Dr|St|etc|ex|cf|vs|p)\.)\s+/u)
    .map((s) => s.trim()).filter(Boolean);
}

const STOP = new Set('le la les un une des de du et à au aux en dans que qui quoi ce cet cette ces se sa son ses il elle ils elles on nous vous je tu me te lui leur y ne pas plus est sont a ont été être avoir pour par sur avec sans mais ou où donc or ni car comme tout tous très bien fait faire c’est c\'est qu\'il qu’il l’ l\' d’ d\' j’ j\' n’ n\' s’ s\''.split(' '));

export interface ScriptAnalysis {
  words: number; seconds: number; sentences: number; avgSentenceWords: number;
  hook: { text: string; words: number; seconds: number };
  longSentences: { text: string; words: number }[];
  paragraphs: { words: number; seconds: number; preview: string }[];
  repeated: { word: string; count: number }[];
  questions: number;
  target?: { min: number; max: number; verdict: 'under' | 'within' | 'over' };
}

export function analyzeScript(text: string, wpm = 150, target?: { min: number; max: number }): ScriptAnalysis {
  const sents = sentences(text);
  const w = wordCount(text);
  const seconds = oralSeconds(text, wpm);
  const hookText = sents[0] ?? '';
  const freq = new Map<string, number>();
  for (const raw of words(text)) {
    const x = raw.toLowerCase().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
    if (x.length < 4 || STOP.has(x)) continue;
    freq.set(x, (freq.get(x) ?? 0) + 1);
  }
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => ({
    words: wordCount(p), seconds: oralSeconds(p, wpm), preview: p.slice(0, 70),
  }));
  return {
    words: w, seconds, sentences: sents.length,
    avgSentenceWords: sents.length ? Math.round(w / sents.length) : 0,
    hook: { text: hookText, words: wordCount(hookText), seconds: oralSeconds(hookText, wpm) },
    longSentences: sents.map((s) => ({ text: s, words: wordCount(s) })).filter((s) => s.words > 25),
    paragraphs,
    repeated: [...freq.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([word, count]) => ({ word, count })),
    questions: (text.match(/\?/g) ?? []).length,
    target: target ? { ...target, verdict: seconds < target.min ? 'under' : seconds > target.max ? 'over' : 'within' } : undefined,
  };
}

/** Diff mot à mot (LCS) pour comparer deux versions. */
export type DiffPart = { type: 'same' | 'add' | 'del'; text: string };
export function diffWords(a: string, b: string): DiffPart[] {
  const A = a.split(/(\s+)/), B = b.split(/(\s+)/);
  const n = A.length, m = B.length;
  if (n * m > 4_000_000) return [{ type: 'del', text: a }, { type: 'add', text: b }];
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (type: DiffPart['type'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text; else out.push({ type, text });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push('same', A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', A[i]); i++; }
    else { push('add', B[j]); j++; }
  }
  while (i < n) push('del', A[i++]);
  while (j < m) push('add', B[j++]);
  return out;
}

/** Découpe une réponse collée (listes à puces ou numérotées) en éléments. */
export function parseList(text: string): string[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const bullet = /^([-*•–]|\d+[.)]|[a-z][.)])\s+/i;
  const items: string[] = [];
  for (const l of lines) {
    if (bullet.test(l)) items.push(l.replace(bullet, '').replace(/^\*\*(.+?)\*\*/, '$1'));
    else if (items.length && !/^#/.test(l) && !/:$/.test(l)) items[items.length - 1] += ' ' + l;
  }
  return items.length ? items : lines.filter((l) => !/^#/.test(l));
}

/** Extrait les URLs (avec le texte qui les précède comme titre). */
export function extractLinks(text: string): { url: string; title: string }[] {
  const out: { url: string; title: string }[] = [];
  const seen = new Set<string>();
  const md = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let mm: RegExpExecArray | null;
  while ((mm = md.exec(text))) { if (!seen.has(mm[2])) { seen.add(mm[2]); out.push({ title: mm[1], url: mm[2] }); } }
  for (const line of text.split('\n')) {
    const urls = line.match(/https?:\/\/[^\s)<>\]]+/g) ?? [];
    for (const u of urls) {
      const url = u.replace(/[.,;:]+$/, '');
      if (seen.has(url)) continue;
      seen.add(url);
      const title = line.replace(u, '').replace(/^([-*•–]|\d+[.)])\s*/, '').replace(/[\s:–-]+$/, '').replace(/\[|\]|\(|\)/g, '').trim();
      out.push({ url, title: title || new URL(url).hostname });
    }
  }
  return out;
}
