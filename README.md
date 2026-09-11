# SiteDashboard

Application desktop **locale** de suivi des coûts et revenus de mes sites
(Denivio / SportSite, HistorySite, SiteWatcher…).

Aucune donnée ne sort de la machine : tout vit dans un fichier SQLite local.

## Stack

| Couche | Choix | Pourquoi |
|---|---|---|
| Coquille desktop | **Tauri 2** | binaire ~10 Mo, WebView système, pas de Chromium embarqué |
| UI | **React 19 + Vite 8 + Tailwind 4** | même stack que les autres projets, composants réutilisables |
| Graphiques | **Recharts** | déjà utilisé sur HistorySite |
| Données | **SQLite** (`tauri-plugin-sql`) | un fichier, sauvegardable, schéma transposable vers Postgres |
| Qualité | oxlint + vitest | aligné sur les autres repos |

## Démarrer

```bash
npm install --legacy-peer-deps
npm run app        # tauri dev : lance Vite + la fenêtre native
```

> `--legacy-peer-deps` est nécessaire : npm 10.9.2 plante (`Cannot read properties of
> null (reading 'edgesOut')`) en résolvant les peer deps de vitest 4. Bug de npm, pas
> du projet — à retirer quand npm sera à jour.

Prérequis : Node 20+, Rust (`winget install --id Rustlang.Rustup`), les Build Tools
MSVC et le runtime WebView2 (déjà présents sur une machine avec Visual Studio).

```bash
npm run test       # tests unitaires (vitest)
npm run lint       # oxlint
npm run app:build  # build release : installeur .msi dans src-tauri/target/release/bundle
```

## Modèle de données

Deux règles non négociables, qui évitent 90 % des bugs de ce genre d'appli :

1. **Les montants sont des entiers en centimes** (`montant_cents`). Jamais de flottant sur
   de l'argent — `0.1 + 0.2 !== 0.3`.
2. **Les dates sont en ISO `YYYY-MM-DD`**. En SQLite, le tri lexicographique est alors
   le tri chronologique, et `substr(date, 1, 7)` donne le mois directement.

| Table | Rôle |
|---|---|
| `sites` | les sites suivis (nom, URL, couleur, actif) |
| `fournisseurs` | OVH, Stripe, Anthropic… avec une catégorie |
| `depenses` | une ligne = une dépense, rattachée à un fournisseur et à un ou plusieurs sites |
| `revenus` | idem côté recettes, pour calculer la marge par site |
| `abonnements` | coûts récurrents (partageables aussi), pour projeter le budget et alerter sur les renouvellements |
| `depense_sites` / `abonnement_sites` | quels sites portent la ligne, et pour quelle part |
| `checks` | ce qu'on vérifie sur un site : une URL, un statut attendu, un fragment de texte |
| `verifications` | le résultat de chaque check, horodaté (purgé au-delà de 30 jours) |

## Coûts partagés entre sites

Une dépense ou un abonnement se rattache à **un ou plusieurs sites** — un hébergement Ionos
à 11 € qui sert à deux sites, par exemple. La liaison passe par `depense_sites` /
`abonnement_sites`, qui stocke la **part de chaque site, en centimes**.

Cette part est calculée **à l'écriture**, pas à l'affichage, et le reste de la division est
distribué un centime à la fois (voir [`src/lib/repartition.js`](src/lib/repartition.js)) :

    11,00 € sur 3 sites  ->  3,67 + 3,67 + 3,66  =  11,00 €

Un `montant / nb_sites` arrondi à l'affichage donnerait 11,01 € ou 10,98 € selon le sens de
l'arrondi : les totaux par site ne retomberaient jamais sur le total réel. Les agrégats
somment donc les parts, jamais les montants — sans quoi une dépense partagée serait comptée
deux fois en entier.

Un abonnement sans aucun site coché est un **coût transverse** : il compte dans le récurrent
global, mais n'est imputé à aucun site.

## Supervision

Tant que l'appli est ouverte, elle rejoue **tous les checks actifs toutes les 60 secondes**
et affiche l'état de chaque site en première ligne du tableau de bord :

| Pastille | Signification |
|---|---|
| 🟢 vert | tous les checks du site passent |
| 🟠 orange | une partie des checks échoue |
| 🔴 rouge | tous les checks échouent |
| ⚪ gris | aucun check, ou aucun encore exécuté |

Un clic sur une carte ouvre le détail du site : disponibilité sur 24 h, courbe de latence,
liste des checks avec leur dernier résultat, incidents récents et dernières dépenses.

Les requêtes HTTP partent **du code Rust**, pas de la WebView : depuis le front, un `fetch`
vers tes sites serait bloqué par CORS et ne donnerait jamais le vrai code de statut.

Un site créé avec une URL reçoit automatiquement un check sur sa page d'accueil ; les checks
supplémentaires (API de santé, page critique, présence d'un texte) s'ajoutent depuis l'écran
de détail.

### Deux pièges rencontrés, à ne pas réintroduire

- **`sql:default` ne donne pas le droit d'écrire.** Il ne contient que `allow-close`,
  `allow-load` et `allow-select`. Sans `sql:allow-execute` dans
  [`capabilities/default.json`](src-tauri/capabilities/default.json), toute écriture est
  refusée à l'exécution — et le message n'apparaît nulle part sans le relais de traces.
- **Une erreur JS est invisible dans une WebView.** La commande Rust `tracer` relaie les
  erreurs du front vers le terminal de `tauri dev` (voir [`src/lib/trace.js`](src/lib/trace.js)).
  C'est ce relais qui a permis de trouver le point précédent.

Les tables `depenses` et `revenus` portent une colonne **`source`** (`manuel` / `csv` / `api`)
et une **`ref_externe`** (identifiant de facture côté fournisseur, avec index unique).
Elles ne servent à rien aujourd'hui — elles existent pour que l'import CSV puis les
connecteurs API puissent être ajoutés sans migration destructive ni doublons.

Le schéma vit dans [`src-tauri/migrations/001_init.sql`](src-tauri/migrations/001_init.sql),
joué au démarrage par le plugin SQL. Pour le faire évoluer : ajouter un fichier
`00N_*.sql` et une entrée `Migration` dans [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs).

## Où sont mes données ?

Le chemin du fichier `.db` est affiché en bas de la barre latérale
(typiquement `%APPDATA%\com.cedklein.sitedashboard\sitedashboard.db`).
Pour sauvegarder : copier ce fichier.

## Suite envisagée

- Import CSV par fournisseur (la plupart exportent du CSV) → `source = 'csv'`
- Connecteurs API là où ça vaut le coup (Stripe, facturation cloud) → `source = 'api'`
- Parts inégales : aujourd'hui un coût partagé est réparti à parts égales entre les sites cochés
