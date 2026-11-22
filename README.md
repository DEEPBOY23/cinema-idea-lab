# Cinema Idea Lab

Laboratoire éditorial cinéma personnel : documentation → réflexion → angle → structure → script facultatif → réalisation.
PWA gratuite, privée, utilisable hors ligne, avec synchronisation Mac ↔ téléphone facultative (Dexie Cloud).

Stack : React 18 + TypeScript + Vite, Dexie.js (IndexedDB), dexie-cloud-addon, vite-plugin-pwa (service worker Workbox).

---

## 1. Lancer l'application en local

Prérequis : Node.js 20 ou plus récent.

```bash
npm install
npm run dev        # développement : http://localhost:5173
npm test           # tests de la logique (dates, statistiques, couleurs, sauvegarde/restauration)
npm run build      # version de production dans dist/
npm run preview    # sert dist/ (service worker actif) : http://localhost:4173
```

Les données sont stockées dans le navigateur (IndexedDB) **par adresse** : les données de `localhost` ne sont pas celles du site déployé. Utilise toujours la même adresse au quotidien.

## 2. Déploiement gratuit (GitHub Pages)

1. Crée un dépôt GitHub (privé ou public ; le code ne contient aucun secret) et pousse ce dossier sur la branche `main`.
2. Dans le dépôt : **Settings → Pages → Source : GitHub Actions**.
3. Le workflow `.github/workflows/deploy.yml` teste, construit et publie à chaque push. L'adresse sera `https://<ton-compte>.github.io/<nom-du-depot>/`.

Le routage par `#` et `base: './'` rendent l'app compatible avec un sous-dossier. Netlify ou Cloudflare Pages conviennent aussi (dossier `dist`, commande `npm run build`).

**Installer l'app :**
- Mac (Chrome/Edge) : icône « Installer » dans la barre d'adresse. Safari (macOS 14+) : Fichier → Ajouter au Dock.
- iPhone : Safari → Partager → « Sur l'écran d'accueil ».
- Android : Chrome → menu → « Installer l'application ».

Mise à jour : quand une nouvelle version est publiée, un bandeau « Mettre à jour » apparaît.

## 3. Synchronisation Mac ↔ téléphone (facultative)

L'app fonctionne sans compte. La synchronisation se configure une fois :

```bash
npx dexie-cloud create
```

Cette commande te demande ton e-mail, crée une base et écrit `dexie-cloud.json` et `dexie-cloud.key` (**ne les publie pas**, ils sont dans `.gitignore`). Ensuite, autorise les adresses où tourne l'app :

```bash
npx dexie-cloud whitelist https://<ton-compte>.github.io
```

```bash
npx dexie-cloud whitelist http://localhost:5173
```

Puis, **sur chaque appareil** : Paramètres → Synchronisation → colle l'adresse de la base (`https://xxxxxxxx.dexie.cloud`, visible dans `dexie-cloud.json`) → Activer → Se connecter (code reçu par e-mail). Utilise le même e-mail sur le Mac et le téléphone.

Pour que personne d'autre ne puisse créer de compte sur ta base, restreins l'inscription à ton adresse dans le gestionnaire Dexie Cloud (manager.dexie.cloud) ; vérifie l'option exacte dans la documentation Dexie Cloud en vigueur.

**Quotas** : Dexie Cloud propose une offre gratuite dont les limites (utilisateurs, stockage) peuvent évoluer : vérifie-les sur dexie.org avant de t'y fier. L'app ne synchronise que du texte et des métadonnées ; les PDF, images et sauvegardes automatiques restent sur l'appareil. Paramètres → « Stockage et quotas » affiche le volume synchronisable.

### Comment se comporte la synchronisation
- Elle a lieu à l'ouverture, à la reconnexion, au retour sur l'app, et en continu tant que l'app est ouverte. **Sur mobile, rien ne se synchronise quand l'app est fermée.**
- Hors ligne, tout est enregistré localement ; l'indicateur affiche le nombre réel de modifications en attente (lu dans la file de mutations de Dexie Cloud).
- Les données créées avant l'activation sont rattachées à ton compte à la première connexion.
- **Conflits** : Dexie Cloud fusionne champ par champ. Si le même texte est modifié sur deux appareils, la dernière écriture gagne, mais l'app conserve l'autre version dans l'historique des versions (script, angle, hook, observation, notes). Si tu es en train d'écrire au moment où une autre version arrive, un bandeau te laisse choisir.
- **Désactiver la synchro** (sur un appareil) : les données locales restent intactes.
- **Se déconnecter** : Dexie Cloud efface la copie locale des données synchronisées (elles restent sur le serveur). L'app télécharge d'abord une sauvegarde JSON.

### Confidentialité réelle
- Données isolées par utilisateur (contrôle d'accès côté serveur), transport chiffré (HTTPS/WSS).
- **Pas de chiffrement de bout en bout** : l'opérateur du service peut techniquement accéder aux données stockées.
- Aucune clé secrète dans le code client : l'adresse de la base n'est pas un secret.

## 4. Sauvegarde et restauration

Synchronisation ≠ sauvegarde : une suppression se propage à tous les appareils.

- **Export** : Paramètres → Exporter (JSON complet, corbeille incluse ; documents locaux en option). Range le fichier ailleurs (iCloud Drive, disque externe). Fais-le régulièrement.
- **Sauvegardes automatiques** : une par jour au lancement, 10 conservées, sur l'appareil uniquement.
- **Restauration** : Paramètres → Restaurer un fichier. Chaque élément est identifié par son id, donc **aucun doublon**. Mode « Fusionner » (garde la version la plus récente) ou « La sauvegarde prime ». Un instantané local est créé juste avant.
- **Corbeille** : toute suppression est d'abord réversible (idées, œuvres, sources, notes, formats), même après synchronisation.
- **Si Dexie Cloud disparaît** : désactive la synchro ; l'app continue en local avec les mêmes données. Un export JSON se restaure sur n'importe quel appareil, sans compte.

## 5. Ce qui fonctionne hors ligne

Tout, sauf ce qui exige Internet par nature :

| Hors ligne ✔ | Nécessite Internet |
|---|---|
| Idées, statuts, historique, dates, couleurs | Synchronisation |
| Formats (consultation, modification, création) | Ouvrir les liens des sources |
| Filmothèque | Recherches web (liens préparés) |
| Notes de lecture, affirmations qualifiées, pistes | Claude (copier-coller du prompt) |
| Documents importés (PDF, images, textes) | Dictée vocale sur Chrome (service Google) |
| Atelier : mesures locales du script, diff de versions, durée orale | |
| Planning, statistiques, export/import | |

Une page web enregistrée par son URL **n'est pas** consultable hors ligne : importe le document (si tu en as le droit) dans la fiche de la source.

## 6. IA et recherche : ce que l'app fait vraiment

- **Aucune IA intégrée, aucune API payante.** L'atelier construit des prompts complets (idée, format, sources, notes, films vus, ton style, consignes anti-invention) ; tu les copies dans Claude, puis tu colles la réponse. L'app en extrait les angles, structures, pistes ou liens, que tu acceptes, modifies ou rejettes.
- **Pas d'API de recherche gratuite sans clé** : l'app prépare des requêtes ciblées (DuckDuckGo, Google, YouTube, American Cinematographer, No Film School, IndieWire, archive.org) et importe en lot les liens que tu colles. Tout lien importé est marqué « accès non vérifié » jusqu'à ce que tu le vérifies.
- « Tester le lien » indique seulement si le serveur répond : impossible, depuis un navigateur, de garantir qu'une page est gratuite et sans inscription.
- Les « suggestions » locales (niveau de recherche, planning) sont des règles simples affichées avec leurs raisons, jamais présentées comme une analyse intelligente.
- Le diagnostic local donne des mesures (durée, longueur du hook, phrases longues, répétitions), pas des jugements.

## 7. Organisation du code

```
src/
  schema.ts        schéma Dexie versionné (migrations : ajouter this.version(2)…)
  db.ts            instance, configuration Dexie Cloud, identifiant d'appareil
  types.ts         modèle de données
  defaults.ts      8 formats intégrés (dans le code ; seules tes modifications sont stockées)
  hooks.ts         requêtes réactives, routage, état de synchronisation
  lib/             actions, statistiques, couleurs, planning, texte, prompts, sauvegarde
  components/      champs à enregistrement immédiat + versions, dictée, pont Claude
  pages/           Accueil, Formats, Documentation, Atelier, Filmothèque, Idées, Planning, Stats, Paramètres
tests/logic.test.ts
```

## 8. Tests réalisés et limites connues

**Vérifié** : 13 tests automatisés (semaines ISO, seuils de couleur, jalons et durées avec retours en arrière, goulots, analyse de script, diff, import de liens, export/import sans doublon, fusion par date, sauvegardes auto). Dans le navigateur : création d'idée, statuts, liaison film/format, structure, validation, persistance après rechargement, statistiques, activation puis désactivation de la synchro sans perte, et fonctionnement **serveur coupé** via le service worker.

**Non vérifié faute de compte Dexie Cloud dans cet environnement** : synchronisation réelle entre deux appareils, modification simultanée, longue période hors ligne, déconnexion/reconnexion. Le code utilise l'API officielle de l'addon, mais teste ces scénarios toi-même après configuration (deux navigateurs ou Mac + téléphone).

**Limites** :
- Pas de synchronisation en arrière-plan quand l'app mobile est fermée (limite des navigateurs).
- Conflits : pas de fusion automatique de texte ; dernière écriture gagnante + version précédente conservée.
- Documents locaux non synchronisés (choix volontaire pour le quota gratuit).
- Dictée : disponible seulement si le navigateur fournit l'API Web Speech ; sur iPhone, la dictée du clavier reste la plus fiable.
- Le bundle JS fait ~650 Ko (≈200 Ko compressé), mis en cache après la première visite.
- Sur iOS, Safari peut effacer les données d'un site non installé et non visité pendant longtemps : installe l'app sur l'écran d'accueil et exporte régulièrement.
