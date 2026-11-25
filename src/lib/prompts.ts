// Prompts copiables pour Claude. L'app ne contient aucune IA : elle prépare le contexte,
// tu travailles dans Claude, puis tu colles la réponse dans l'app.
import type { Idea, Work, Format, Source, ReadingNote, Settings, WorkshopMode } from '../types';
import { statusLabel, SOURCE_STATES, ACCESS_LABELS, CLAIM_LABELS, COMPAT_LABELS } from '../types';

export interface PromptCtx {
  idea?: Idea; works: Work[]; formats: Format[]; sources: Source[]; notes: ReadingNote[]; settings: Settings;
}

const RULES = `Règles impératives :
- N'invente aucune citation, interview, date ou intention de réalisateur/directeur photo.
- Distingue explicitement : [FAIT DOCUMENTÉ], [DÉCLARATION VÉRIFIÉE] (avec source), [INTERPRÉTATION], [HYPOTHÈSE À CONFIRMER].
- Ne propose que des sources réelles et consultables gratuitement, avec lien direct ; signale les liens non vérifiés, payants ou nécessitant une inscription.
- Si tu manques d'informations, dis-le plutôt que de combler.
- Réponds en français, avec des listes à puces (une idée par puce) pour que je puisse les importer.`;

export function seenList(works: Work[]) {
  const seen = works.filter((w) => !w.deletedAt && w.seen === 'seen');
  const partial = works.filter((w) => !w.deletedAt && w.seen === 'partial');
  return [
    `Films/séries que j'ai VUS : ${seen.length ? seen.map(wLabel).join(' ; ') : 'aucun renseigné'}.`,
    partial.length ? `Partiellement vus : ${partial.map(wLabel).join(' ; ')}.` : '',
    `Ne suppose jamais que j'ai vu une œuvre absente de cette liste.`,
  ].filter(Boolean).join('\n');
}
const wLabel = (w: Work) => `${w.title}${w.year ? ` (${w.year})` : ''}${w.director ? `, ${w.director}` : ''}`;

export function ideaContext(c: PromptCtx): string {
  const { idea, works, formats, sources, notes, settings } = c;
  const lines: string[] = [];
  lines.push(`Je suis vidéaste et créateur de contenu cinéma (vidéos verticales courtes). Mon approche : storytelling visuel — mise en scène, lumière, couleurs, cadrage, mouvements de caméra, psychologie des personnages, choix des réalisateurs et directeurs photo.`);
  if (settings.styleProfile.trim()) lines.push(`Mon style / ma personnalité : ${settings.styleProfile.trim()}`);
  lines.push(settings.spoilers === 'avoid' ? `Évite les spoilers majeurs sauf si je les autorise.` : `Les spoilers sont acceptés.`);
  if (idea) {
    const fmt = formats.find((f) => f.id === idea.formatId);
    const iw = works.filter((w) => idea.workIds.includes(w.id));
    lines.push(`\n## Idée : ${idea.title}`);
    lines.push(`Statut : ${statusLabel(idea.status)}`);
    if (iw.length) lines.push(`Œuvre(s) : ${iw.map((w) => `${wLabel(w)} — ${w.seen === 'seen' ? 'vue' : w.seen === 'partial' ? 'partiellement vue' : 'PAS ENCORE VUE'}`).join(' ; ')}`);
    if (fmt) lines.push(`Format : ${fmt.name} (${fmt.minSec}–${fmt.maxSec} s) — ${fmt.promise}`);
    if (idea.observation) lines.push(`Mon observation de départ : ${idea.observation}`);
    if (idea.angle) lines.push(`Angle retenu : ${idea.angle}`);
    if (idea.hook) lines.push(`Hook : ${idea.hook}`);
    if (idea.compat) lines.push(`Compatibilité œuvre/format : ${COMPAT_LABELS[idea.compat.rating]} — ${idea.compat.justification}`);
    if (idea.structure.length) lines.push(`Structure :\n${idea.structure.map((b, i) => `${i + 1}. ${b.label} (${b.seconds}s)${b.content ? ` — ${b.content}` : ''}${b.weak ? ' [partie faible]' : ''}`).join('\n')}`);
    if (idea.missingInfo) lines.push(`Informations manquantes identifiées : ${idea.missingInfo}`);
    const src = sources.filter((s) => !s.deletedAt && s.ideaIds.includes(idea.id));
    if (src.length) lines.push(`Sources déjà rassemblées :\n${src.map((s) => `- ${s.title}${s.media ? ` (${s.media})` : ''} ${s.url} — ${SOURCE_STATES[s.state]}, ${ACCESS_LABELS[s.access]}`).join('\n')}`);
    const nts = notes.filter((n) => !n.deletedAt && n.ideaId === idea.id);
    for (const n of nts) {
      const parts = [
        n.learned && `Appris : ${n.learned}`, n.surprised && `Surpris : ${n.surprised}`, n.observations && `Mes observations : ${n.observations}`,
        n.toVerify && `À vérifier : ${n.toVerify}`, n.toDeepen && `À approfondir : ${n.toDeepen}`,
        ...n.claims.map((cl) => `[${CLAIM_LABELS[cl.nature]}] ${cl.text}${cl.ref ? ` (réf : ${cl.ref})` : ''}`),
      ].filter(Boolean);
      if (parts.length) lines.push(`Notes de lecture « ${n.title || 'sans titre'} » :\n${parts.map((p) => `- ${p}`).join('\n')}`);
    }
  }
  lines.push(`\n${seenList(works)}`);
  return lines.join('\n');
}

export const MODE_INFO: Record<WorkshopMode, { label: string; intro: string }> = {
  inspiration: { label: 'Trouver des sources', intro: 'Trouve quoi lire et regarder sur un film ou une technique, avant d’avoir une idée précise.' },
  development: { label: 'Construire mon idée', intro: 'Pars de ton intuition et avance pas à pas : angle, infos manquantes, structure.' },
  diagnostic: { label: 'Relire mon script', intro: 'Colle ton script : tu vois ce qui marche et ce qui manque. Rien n’est réécrit.' },
  writing: { label: 'Écrire avec aide', intro: 'Seulement si tu le demandes : rédiger, reformuler un passage, comparer deux versions.' },
  challenge: { label: 'Tester mon idée', intro: 'Vérifie si ton angle tient la route : original, prouvé, intéressant ?' },
  compat: { label: 'Compatibilité œuvre / format', intro: '' },
  deepen: { label: 'Approfondir un point', intro: '' },
  alternatives: { label: 'Alternatives parmi mes films vus', intro: '' },
};

export type DiagFocus = 'all' | 'hook' | 'structure' | 'fond' | 'rythme';
export type WritingTask = 'draft' | 'restructure' | 'improve';

export function buildPrompt(mode: WorkshopMode, c: PromptCtx, input: string, opts: { focus?: DiagFocus; task?: WritingTask; step?: string; subject?: string } = {}): string {
  const ctx = ideaContext(c);
  const fmt = c.idea && c.formats.find((f) => f.id === c.idea!.formatId);
  let task = '';
  switch (mode) {
    case 'inspiration':
      task = `## Ce que je veux
Inspiration documentaire sur : ${opts.subject || input || c.idea?.title || '(à préciser)'}
${input && opts.subject ? `Précisions : ${input}\n` : ''}
Commence par la documentation, PAS par des angles ni des scripts :
1. Les ressources gratuites et fiables à consulter (interviews de réalisateurs/directeurs photo, articles de fond, analyses, making-of, masterclasses) avec lien, auteur, média, date et temps de consultation estimé.
2. Les questions de recherche intéressantes à me poser.
3. Ce qui est déjà bien documenté vs ce qui relève de l'interprétation.
4. Seulement ensuite, 2 ou 3 pistes d'observation à vérifier (pas encore des angles finis).`;
      break;
    case 'development':
      task = opts.step === 'missing'
        ? `## Ce que je veux
Identifie les informations manquantes pour soutenir l'angle retenu : faits à vérifier, scènes à revoir, sources à trouver. Ne rédige pas de script.`
        : opts.step === 'weak'
          ? `## Ce que je veux
Regarde la structure ci-dessus. Pour chaque partie marquée faible (ou qui te semble faible, en le justifiant), propose 1 ou 2 façons de la renforcer. Ne réécris pas tout, ne rédige pas de script complet. S'il n'y a pas de réel problème, dis-le.`
          : opts.step === 'structure'
            ? `## Ce que je veux
Propose une structure narrative adaptable pour l'angle retenu${fmt ? `, adaptée au format ${fmt.name} (${fmt.minSec}–${fmt.maxSec} s)` : ''} : une liste de temps forts au format « Étiquette (durée en s) — intention ». Pas de texte rédigé.`
            : `## Ce que je veux
Voici mon intuition / hook / observation :
"""${input || c.idea?.observation || ''}"""

1. Reformule en une phrase ce que tu comprends de mon idée (pour vérifier qu'on parle de la même chose).
2. Propose 2 ou 3 angles DIFFÉRENTS, une puce par angle, chacun avec : la promesse, ce qu'il faudrait documenter, le risque principal.
Ne rédige pas de script.`;
      break;
    case 'diagnostic': {
      const focus = opts.focus ?? 'all';
      const scope = { all: 'le hook, la structure, le fond et le rythme', hook: 'UNIQUEMENT le hook', structure: 'UNIQUEMENT la structure / progression', fond: 'UNIQUEMENT le fond (exactitude, solidité documentaire)', rythme: 'UNIQUEMENT le rythme' }[focus];
      task = `## Ce que je veux
Diagnostic éditorial de mon script, en analysant ${scope}. N'ÉCRIS PAS de nouvelle version et ne modifie pas mon texte.
Indique :
- Ce qui fonctionne.
- Ce qui manque réellement.
- Les faiblesses de progression ou de rythme.
- Les éléments documentaires insuffisants ou affirmations à sourcer.
- Des suggestions facultatives.
N'invente pas de défauts : si une partie fonctionne, dis-le simplement.

Script :
"""${input}"""`;
      break;
    }
    case 'writing':
      task = opts.task === 'draft'
        ? `## Ce que je veux (demande explicite d'écriture)
Rédige un script oral à partir de ma structure validée ci-dessus${fmt ? `, pour ${fmt.minSec}–${fmt.maxSec} s` : ''}. Respecte mon style. N'ajoute aucun fait non présent dans mes notes/sources ; marque [À VÉRIFIER] tout ce qui manque.${input ? `\nConsignes : ${input}` : ''}`
        : opts.task === 'restructure'
          ? `## Ce que je veux (demande explicite d'écriture)
Restructure ce brouillon oral (transcription de ma voix) en gardant mes mots et ma personnalité autant que possible. Ne rajoute pas de contenu factuel.
"""${input}"""`
          : `## Ce que je veux (demande explicite d'écriture)
Améliore uniquement ce passage, en gardant mon ton. Propose 2 variantes maximum et explique brièvement ce qui change.
"""${input}"""`;
      break;
    case 'challenge':
      task = `## Ce que je veux
Challenge mon idée de manière constructive : pertinence de l'angle, originalité, preuves disponibles, intérêt narratif pour un public qui aime le cinéma. Ne contredis pas artificiellement : si c'est solide, dis-le et explique pourquoi.${input ? `\nPoint à challenger : ${input}` : ''}`;
      break;
    case 'compat':
      task = `## Ce que je veux
Évalue la compatibilité entre l'œuvre et le format ci-dessus. Réponds par l'une de ces catégories : Très pertinente / Pertinente sous certaines conditions / Peu pertinente / Informations insuffisantes.
Justifie sans inventer de faits ni forcer le rapprochement. Puis liste des pistes documentaires (sources réelles et gratuites) — pas de script.${input ? `\nMon observation : ${input}` : ''}`;
      break;
    case 'deepen':
      task = `## Ce que je veux
Je veux approfondir ce point :
"""${input}"""
Propose, sous quatre titres distincts :
### Questions
### Sources
### Axes narratifs
### Liens avec des films que j'ai vus (uniquement parmi ma liste)
Une puce par proposition.`;
      break;
    case 'alternatives':
      task = `## Ce que je veux
Je n'ai pas vu : ${input}.
1. Propose des alternatives UNIQUEMENT parmi les films que j'ai vus (liste ci-dessus) qui illustreraient la même idée.
2. Pour chacune, évalue honnêtement si elle reste pertinente.
3. Si aucune ne convient, dis-moi simplement de regarder l'œuvre originale avant de poursuivre. Sans spoiler.`;
      break;
  }
  return `${ctx}\n\n${task}\n\n${RULES}`;
}

export function searchLinks(q: string) {
  const e = encodeURIComponent;
  return [
    { label: 'Web', url: `https://duckduckgo.com/?q=${e(q)}` },
    { label: 'Google', url: `https://www.google.com/search?q=${e(q)}` },
    { label: 'YouTube (interviews, BTS)', url: `https://www.youtube.com/results?search_query=${e(q + ' interview cinematographer')}` },
    { label: 'American Cinematographer', url: `https://duckduckgo.com/?q=${e(q + ' site:theasc.com')}` },
    { label: 'No Film School', url: `https://duckduckgo.com/?q=${e(q + ' site:nofilmschool.com')}` },
    { label: 'IndieWire (craft)', url: `https://duckduckgo.com/?q=${e(q + ' site:indiewire.com')}` },
    { label: 'Interviews DP (Wikipédia exclue)', url: `https://duckduckgo.com/?q=${e(q + ' director of photography interview -wikipedia')}` },
    { label: 'Pubs (cinématographie)', url: `https://duckduckgo.com/?q=${e(q + ' commercial cinematography (site:shots.net OR site:lbbonline.com OR site:campaignlive.com)')}` },
    { label: 'Archive.org', url: `https://archive.org/search?query=${e(q)}` },
  ];
}
