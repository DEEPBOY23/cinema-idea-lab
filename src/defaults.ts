import type { Format, Settings } from './types';

// Les 8 formats intégrés vivent dans le code. Seules tes modifications (et tes formats perso)
// sont enregistrées en base : un format modifié est stocké avec le même id et remplace celui-ci.
// Ainsi, deux appareils ne "ré-initialisent" jamais tes changements lors de la synchronisation.

const f = (o: Omit<Format, 'custom' | 'updatedAt'>): Format => ({ ...o, custom: false, updatedAt: 0 });

export const BUILTIN_FORMATS: Format[] = [
  f({
    id: 'fmt-color-stories', order: 1, name: 'Color Stories', minSec: 35, maxSec: 75,
    promise: "Faire voir le rôle narratif d'une couleur : ce qu'elle raconte dans une scène ou comment elle évolue dans un film.",
    features: ['Une couleur, une idée directrice', 'Comparaisons de plans avant/après', 'Lien explicite couleur ↔ personnage ou thème', "S'appuie si possible sur des déclarations du chef opérateur, chef déco ou étalonneur"],
    structures: [
      { name: 'Évolution', beats: [{ label: 'Hook : la couleur à l’écran', seconds: 5 }, { label: 'Première apparition', seconds: 12 }, { label: 'Transformation', seconds: 18 }, { label: 'Ce que ça raconte', seconds: 15 }, { label: 'Chute / ouverture', seconds: 6 }] },
      { name: 'Une scène, une couleur', beats: [{ label: 'Hook visuel', seconds: 4 }, { label: 'Contexte de la scène', seconds: 8 }, { label: 'Lecture de la couleur', seconds: 18 }, { label: 'Intention documentée', seconds: 10 }, { label: 'Conclusion', seconds: 5 }] },
      { name: 'Contraste entre deux mondes', beats: [{ label: 'Hook : deux images opposées', seconds: 5 }, { label: 'Monde A', seconds: 12 }, { label: 'Monde B', seconds: 12 }, { label: 'Le point de bascule', seconds: 12 }, { label: 'Sens global', seconds: 8 }] },
    ],
    themes: ['Une couleur associée à un personnage', 'La disparition progressive d’une couleur', 'Palette de deux mondes qui s’opposent', 'Couleur et souvenir / flashback', 'Une couleur intruse dans une palette'],
    docLeads: ['Interviews du directeur photo et du chef décorateur', 'Articles techniques (étalonnage, pellicule, LUT)', 'Dossiers de presse et making-of', 'Captures de scènes pour comparer la palette'],
    docLoad: 'Modérée : il faut documenter l’intention, pas seulement l’observer.',
    avLoad: 'Modérée : extraits comparatifs, éventuellement palettes extraites.',
  }),
  f({
    id: 'fmt-one-shot', order: 2, name: 'One Shot, One Story', minSec: 30, maxSec: 45,
    promise: 'Décrypter un seul plan : composition, focale, mouvement, émotion et signification.',
    features: ['Un plan unique, revu plusieurs fois', 'Lecture couche par couche', 'Vocabulaire technique expliqué simplement'],
    structures: [
      { name: 'Couche par couche', beats: [{ label: 'Hook : le plan', seconds: 4 }, { label: 'Composition', seconds: 8 }, { label: 'Focale / caméra', seconds: 8 }, { label: 'Lumière', seconds: 8 }, { label: 'Ce que ça signifie', seconds: 10 }] },
      { name: 'Question / réponse', beats: [{ label: 'Question sur le plan', seconds: 5 }, { label: 'Indice 1', seconds: 10 }, { label: 'Indice 2', seconds: 10 }, { label: 'Réponse', seconds: 12 }] },
    ],
    themes: ['Un plan d’ouverture', 'Un plan-séquence clé', 'Un plan fixe très long', 'Le dernier plan d’un film'],
    docLeads: ['Interview du directeur photo sur le plan', 'Story-boards publiés', 'Analyses de mise en scène reconnues'],
    docLoad: 'Légère à modérée selon la disponibilité d’informations sur le tournage du plan.',
    avLoad: 'Légère : un extrait, annotations à l’écran.',
  }),
  f({
    id: 'fmt-creative-decisions', order: 3, name: 'Creative Decisions', minSec: 60, maxSec: 90,
    promise: 'Expliquer un choix créatif de mise en scène, ses contraintes et ce qu’il apporte au récit.',
    features: ['Un choix précis et documenté', 'Alternatives possibles évoquées', 'Contribution au récit démontrée'],
    structures: [
      { name: 'Choix → alternatives → effet', beats: [{ label: 'Hook : le choix', seconds: 6 }, { label: 'Contexte', seconds: 12 }, { label: 'Ce qui aurait pu être fait', seconds: 15 }, { label: 'Pourquoi ce choix (sources)', seconds: 20 }, { label: 'Effet sur le récit', seconds: 15 }, { label: 'Conclusion', seconds: 7 }] },
      { name: 'Enquête', beats: [{ label: 'Le mystère', seconds: 8 }, { label: 'Premières hypothèses', seconds: 15 }, { label: 'Ce que disent les auteurs', seconds: 25 }, { label: 'Lecture personnelle', seconds: 15 }, { label: 'Chute', seconds: 7 }] },
    ],
    themes: ['Le choix d’un format d’image', 'Tourner en décor réel plutôt qu’en studio', 'Le refus de la musique dans une scène', 'Un choix d’objectif atypique'],
    docLeads: ['Interviews du réalisateur', 'Masterclasses', 'Commentaires audio', 'Dossiers de production'],
    docLoad: 'Approfondie : l’intention doit être sourcée.',
    avLoad: 'Modérée : extraits, éventuels schémas.',
  }),
  f({
    id: 'fmt-feel-the-frame', order: 4, name: 'Feel the Frame', minSec: 30, maxSec: 45,
    promise: "Montrer comment l'image transmet une émotion ou l'état psychologique d'un personnage.",
    features: ['Partir de l’émotion ressentie', 'Relier sensation et technique', 'Focus personnage'],
    structures: [
      { name: 'Émotion → outils', beats: [{ label: 'Hook émotionnel', seconds: 5 }, { label: 'L’état du personnage', seconds: 8 }, { label: 'Les outils visuels', seconds: 15 }, { label: 'Ce que ça nous fait', seconds: 10 }] },
      { name: 'Avant / après', beats: [{ label: 'Hook', seconds: 4 }, { label: 'Le personnage avant', seconds: 10 }, { label: 'Le personnage après', seconds: 10 }, { label: 'Ce qui a changé dans l’image', seconds: 14 }] },
    ],
    themes: ['Isolement par le cadre', 'Perte de repères par la caméra', 'Oppression par la profondeur de champ', 'Apaisement par la lumière'],
    docLeads: ['Analyses de mise en scène', 'Interviews sur la direction d’acteurs et le découpage'],
    docLoad: 'Légère : une part d’interprétation assumée, à signaler comme telle.',
    avLoad: 'Légère.',
  }),
  f({
    id: 'fmt-invisible', order: 5, name: 'Invisible Filmmaking', minSec: 30, maxSec: 45,
    promise: 'Révéler des techniques visuelles discrètes qui influencent notre perception sans qu’on les remarque.',
    features: ['Effet “je n’avais jamais vu ça”', 'Démonstration visuelle', 'Technique nommée et expliquée'],
    structures: [
      { name: 'Révélation', beats: [{ label: 'Hook : “tu ne l’as pas vu”', seconds: 4 }, { label: 'La scène telle qu’on la perçoit', seconds: 8 }, { label: 'La technique révélée', seconds: 15 }, { label: 'Pourquoi c’est efficace', seconds: 10 }] },
    ],
    themes: ['Raccords invisibles', 'Changements de lumière progressifs', 'Effets numériques discrets', 'Montage sonore qui guide le regard'],
    docLeads: ['Making-of et breakdowns VFX', 'Articles techniques spécialisés', 'Interviews de monteurs et superviseurs VFX'],
    docLoad: 'Modérée : il faut une preuve de la technique.',
    avLoad: 'Modérée : comparaisons, ralentis, zooms.',
  }),
  f({
    id: 'fmt-constraints', order: 6, name: 'Constraints Create Cinema', minSec: 60, maxSec: 90,
    promise: 'Analyser comment une contrainte (décor, budget, tournage) a stimulé la créativité.',
    features: ['Contrainte réelle et documentée', 'Solution trouvée', 'Résultat à l’écran'],
    structures: [
      { name: 'Problème → solution → résultat', beats: [{ label: 'Hook : la contrainte', seconds: 6 }, { label: 'Contexte de production', seconds: 15 }, { label: 'La solution', seconds: 25 }, { label: 'Le résultat à l’écran', seconds: 18 }, { label: 'Leçon pour créateurs', seconds: 8 }] },
    ],
    themes: ['Petit budget', 'Décor unique', 'Délais de tournage', 'Contraintes techniques ou météo'],
    docLeads: ['Making-of', 'Interviews de production', 'Articles historiques'],
    docLoad: 'Approfondie : les contraintes doivent être vérifiées.',
    avLoad: 'Modérée.',
  }),
  f({
    id: 'fmt-experiments', order: 7, name: 'Cinematic Experiments', minSec: 30, maxSec: 60,
    promise: 'Démontrer visuellement une technique et son influence sur le storytelling, en la testant soi-même.',
    features: ['Expérience filmée par toi', 'Comparaison A/B', 'Lien avec une référence de film'],
    structures: [
      { name: 'Test A/B', beats: [{ label: 'Hook : la question', seconds: 5 }, { label: 'Version A', seconds: 10 }, { label: 'Version B', seconds: 10 }, { label: 'Ce qui change', seconds: 12 }, { label: 'Référence film', seconds: 8 }] },
    ],
    themes: ['Changer de focale sur une même scène', 'Lumière dure vs douce', 'Caméra à l’épaule vs pied', 'Vitesse d’obturation'],
    docLeads: ['Ressources techniques', 'Tutoriels de chefs opérateurs'],
    docLoad: 'Légère.',
    avLoad: 'Élevée : tournage d’expérience.',
  }),
  f({
    id: 'fmt-visual-rule', order: 8, name: 'The Visual Rule', minSec: 30, maxSec: 45,
    promise: 'Expliquer une règle du langage cinématographique et la façon dont les cinéastes l’utilisent ou la brisent.',
    features: ['Une règle claire', 'Un exemple qui la respecte', 'Un exemple qui la brise'],
    structures: [
      { name: 'Règle → exemple → transgression', beats: [{ label: 'Hook', seconds: 4 }, { label: 'La règle', seconds: 8 }, { label: 'Exemple qui la respecte', seconds: 10 }, { label: 'Exemple qui la brise', seconds: 10 }, { label: 'Ce que ça nous apprend', seconds: 6 }] },
    ],
    themes: ['Règle des 180°', 'Règle des tiers', 'Regard caméra', 'Espace de regard (lead room)'],
    docLeads: ['Manuels de langage cinématographique', 'Ressources pédagogiques d’écoles de cinéma'],
    docLoad: 'Légère.',
    avLoad: 'Légère à modérée.',
  }),
];

export const DEFAULT_SETTINGS: Settings = {
  id: 'main',
  thresholds: [7, 21, 45],
  weeklyLong: 1,
  weeklyShort: 3,
  countOn: 'published',
  styleProfile: '',
  spoilers: 'avoid',
  wpm: 150,
  updatedAt: 0,
};

export const isLongFormat = (fmt?: { maxSec: number }) => !!fmt && fmt.maxSec >= 60;
