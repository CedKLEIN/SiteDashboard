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
npm run test       # tests (vitest) : logique pure + requêtes SQL réelles
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
| `abonnements` | coûts récurrents (partageables aussi), avec leur date de premier paiement |
| `abonnement_tarifs` | historique des prix d'un abonnement, chacun avec sa date d'entrée en vigueur |
| `depense_sites` / `abonnement_sites` | quels sites portent la ligne, et pour quelle part |
| `checks` | ce qu'on vérifie sur un site : une URL, un statut attendu, un fragment de texte |
| `verifications` | le résultat de chaque check, horodaté (purgé au-delà de 30 jours) |
| `sites.favicon` | icône du site, stockée en data URI (pas en URL : elle doit s'afficher même site tombé) |
| `revenu_sites` | même partage côté recettes |
| `preferences` | réglages de l'application, en clé/valeur |

## Coûts partagés entre sites

Une dépense ou un abonnement se rattache à **un ou plusieurs sites** — un hébergement Ionos
à 11 € qui sert à deux sites, par exemple. La liaison passe par `depense_sites` /
`abonnement_sites`, qui stocke la **part de chaque site, en centimes**.

Cette part est calculée **à l'écriture**, pas à l'affichage, et le reste de la division est
distribué un centime à la fois (voir [`src/lib/repartition.js`](src/lib/repartition.js)) :

    11,00 € sur 3 sites  ->  3,67 + 3,67 + 3,66  =  11,00 €

Le partage est égal par défaut, mais le formulaire permet de saisir des **parts inégales**
(un hébergement qui sert surtout à un site). Dans ce cas la somme des parts doit faire
exactement le montant : la vérification a lieu dans `partsPourSites`, donc au moment de
l'écriture et pas seulement dans le formulaire — c'est le seul passage obligé. Elle est
faite **avant** l'`INSERT`, sinon un refus laisserait une ligne orpheline rattachée à
aucun site.

Un `montant / nb_sites` arrondi à l'affichage donnerait 11,01 € ou 10,98 € selon le sens de
l'arrondi : les totaux par site ne retomberaient jamais sur le total réel. Les agrégats
somment donc les parts, jamais les montants — sans quoi une dépense partagée serait comptée
deux fois en entier.

Un abonnement sans aucun site coché est un **coût transverse** : il compte dans le récurrent
global, mais n'est imputé à aucun site.

## Abonnements : historique de prix et cumul payé

Un abonnement porte une **date de premier paiement** (`debut`) et un **historique de tarifs**,
pas un montant unique. Un nom de domaine à 6 € la première année puis 11 € :

| À partir du | Montant |
|---|---|
| 2024-03-01 | 6,00 € |
| 2025-03-01 | 11,00 € |

Un abonnement résilié porte une **date de fin** : sans elle, soit on le ferait courir
indéfiniment et on inventerait des prélèvements, soit on l'exclurait et ses paiements passés
disparaîtraient du cumul. Le drapeau « actif » dit *que* c'est arrêté, pas *quand*.

Le cumul payé additionne chaque échéance **au tarif qui s'appliquait ce jour-là** — ici
6 + 11 + 11 = 28,00 € au bout de trois ans. Écraser le montant aurait fait disparaître la
première année et rendu tout cumul faux.

`abonnements.montant_cents` a donc été supprimée : le prix courant se lit dans l'historique
(le dernier tarif dont la date est passée), pour ne pas laisser deux vérités concurrentes.

**Effet de bord traité** : les parts entre sites sont calculées sur un montant. Quand le
tarif change, elles sont **redistribuées proportionnellement**
([`redistribuer`](src/lib/repartition.js)) — un partage 80/20 sur 10 € devient 80/20 sur
20 € — pour que l'invariant « somme des parts = montant courant » tienne toujours.

Un abonnement se modifie (crayon) : libellé, fournisseur, périodicité, date de premier
paiement, sites. Le **prix ne se change pas là** — il vit dans l'historique des tarifs, où
une correction garde la trace de ce qui a réellement été payé. Chaque tarif est corrigeable
ou supprimable, et **toute** modification de l'historique recalcule les parts entre sites,
puisqu'une suppression peut elle aussi changer le prix en vigueur.

L'icône d'un abonnement est celle de son **fournisseur**, récupérée depuis l'URL saisie à la
création (`https://chatgpt.com` → l'icône d'OpenAI). Deux abonnements du même fournisseur la
partagent, elle n'est téléchargée qu'une fois.

## Devises

Un revenu peut être saisi en **euros ou en dollars**. Trois valeurs sont stockées : le montant
d'origine (ce qui a réellement été reçu), le **taux appliqué**, et le montant converti.

Le taux est celui **du jour de la transaction**, récupéré auprès de l'API Frankfurter (données
BCE). Reconvertir à l'affichage avec le taux courant ferait varier un revenu passé à chaque
consultation : un don de 50 $ reçu en mars ne vaut pas ce qu'il vaudrait aujourd'hui.

Tous les cumuls, graphiques et parts par site sont en **euros**, la devise de référence —
additionner des euros et des dollars donnerait un nombre qui ne veut rien dire.

## Le tableau de bord

Deux filtres, en boutons plutôt qu'en sélecteurs de dates — on consulte un tableau de bord
pour répondre à « où j'en suis cette année », pas pour interroger une plage arbitraire :

- **période** : ce mois, cette année (défaut), 12 derniers mois, année dernière, depuis
  toujours. « Depuis toujours » démarre à la première écriture connue, sinon le graphe
  afficherait des siècles de mois vides ;
- **site** : tous, ou un seul. Filtré sur un site, tout ne compte que **sa part** — une
  dépense partagée ne doit pas apparaître en entier dans les chiffres d'un seul site.

Les deux choix sont **mémorisés** dans la table `preferences` et rétablis au lancement. Le
tableau attend de les avoir relus avant de charger : sinon il s'afficherait sur la période
par défaut puis sauterait sur celle enregistrée, avec deux requêtes au lieu d'une.

Un site mémorisé puis supprimé est confronté aux sites existants au démarrage, et le filtre
revient à « tous ». Sans ce contrôle, le tableau filtrerait sur un identifiant fantôme :
aucun chiffre affiché, et rien pour comprendre pourquoi.

Deux graphes, qui ne disent pas la même chose :

- **cumul sur la période** : deux courbes qui ne peuvent que monter. Ce qui compte est
  l'écart entre elles et le moment où les revenus rattrapent les dépenses ;
- **mois par mois** : dépenses ponctuelles et abonnements empilés, revenus à côté.

Le calcul des cumuls vit dans [`src/lib/series.js`](src/lib/series.js), pas dans le
composant : accumuler pendant le rendu donnerait des totaux différents à chaque re-rendu,
et c'est le genre d'erreur qui produit des chiffres faux sans rien casser visiblement.

## Les abonnements dans les graphes

Les abonnements ne vivent pas dans la table `depenses` : ce sont des prélèvements récurrents
déduits d'une date de début, d'une périodicité et d'un historique de tarifs. Le tableau de
bord les **recalcule à la volée** et les ajoute aux dépenses ponctuelles, en barres empilées
pour que la distinction reste lisible.

Ils ne sont pas matérialisés en lignes de dépenses : ce serait une seconde source de vérité
à resynchroniser à chaque correction de tarif ou de date, avec un risque de doublons.

Un piège que les tests verrouillent : un abonnement prélevé le 29 ne compte **pas** pour le
mois en cours tant que le 29 n'est pas passé. Compter le mois courant d'office gonflerait le
total d'une échéance.

## Supervision

Tant que l'appli est ouverte, elle rejoue **tous les checks actifs** à la fréquence réglée
dans les préférences (30 s à 1 h, **1 minute** par défaut) et affiche l'état de chaque site
en première ligne du tableau de bord :

| Icône | Signification |
|---|---|
| cercle coché, vert | tous les checks du site passent |
| triangle d'alerte, orange | une partie des checks échoue |
| croix cerclée, rouge | tous les checks échouent |
| cercle pointillé, gris | aucun check, ou aucun encore exécuté |

L'état passe par la **forme** de l'icône, pas seulement par la couleur : celle-ci sert déjà
à identifier les sites, et ne distingue rien pour un daltonien. La couleur du site est donc
une **barre verticale** sur le bord de la carte — deux pastilles rondes côte à côte se
lisaient comme la même information.

Un clic sur une carte ouvre le détail du site : disponibilité sur 24 h, courbe de latence,
liste des checks avec leur dernier résultat, incidents récents et dernières dépenses.

Les requêtes HTTP partent **du code Rust**, pas de la WebView : depuis le front, un `fetch`
vers tes sites serait bloqué par CORS et ne donnerait jamais le vrai code de statut.

Un check ne demande que le **chemin** : l'URL de base vient du site et s'affiche en préfixe
non modifiable. Une URL absolue reste acceptée, pour viser une API sur un autre domaine.

Un site créé avec une URL reçoit automatiquement un check sur sa page d'accueil. L'écran de
détail propose ensuite un **catalogue de checks courants en un clic**
([`src/lib/checksSuggeres.js`](src/lib/checksSuggeres.js)), tiré de ce qui est réellement
déployé sur Denivio et HistorySite :

| Check | Chemin | Contenu vérifié |
|---|---|---|
| Page d'accueil | `/` | — |
| Configuration runtime | `/config.js` | `window.` |
| Santé de l'API | `/healthz` | — |
| Sitemap | `/sitemap.xml` | `<urlset` |
| robots.txt | `/robots.txt` | `User-agent` |
| Manifest PWA | `/manifest.webmanifest` | — |
| Certificat TLS | (le domaine) | expiration |

Le `doitContenir` compte autant que le statut. Le cas qui a motivé le catalogue est
`/config.js` : le conteneur le réécrit à chaque démarrage depuis son `.env`
(`docker-entrypoint.sh`). Si l'entrypoint échoue, nginx sert quand même un **200** sur un
fichier vide — et le symptôme est une carte muette, pas une erreur. Même logique pour un
sitemap proxyfié qui renvoie 200 avec une page d'erreur HTML.

Une suggestion déjà surveillée disparaît de la liste. Les checks sur mesure s'ajoutent
toujours par le formulaire en dessous.

### Diagnostiquer un check qui échoue

La loupe à côté d'un check rejoue l'URL et montre **tout ce qui explique un échec** :

- la **requête** envoyée (méthode, URL, en-têtes) ;
- les **redirections** suivies, saut par saut — reqwest les avale silencieusement, alors
  qu'un saut inattendu (`http` → `https`, ajout de `www`) est souvent l'explication ;
- la **réponse** : statut et libellé, version HTTP, tous les en-têtes, taille, durée ;
- le **certificat TLS** quand l'URL est en https — inutile d'ouvrir un second écran pour
  savoir que la panne vient d'une expiration ;
- le **corps** de la réponse (4 000 premiers caractères, troncature signalée).

Le bouton **« Copier le rapport »** met tout ça dans le presse-papiers en texte brut, prêt à
coller dans un ticket ou un message. Le format est plat — pas de tableau, pas de couleur,
rien qui se perde à la copie — et l'ordre suit le sens du débogage : ce qu'on a demandé, où
on a été redirigé, ce qu'on a reçu.

Un « fragment absent » ne dit pas si la page est vide, si c'est une erreur déguisée en 200,
ou si un SPA a servi son `index.html` pour une URL inconnue. Le `content-type` tranche en
une seconde — et quand il vaut `text/html` alors qu'on attendait autre chose, le panneau le
signale explicitement.

Le message d'échec donne la **priorité au statut**. Sur un 404, le fragment est forcément
absent puisque la page n'existe pas : annoncer « fragment absent » enverrait chercher un
problème de contenu là où il n'y a pas de fichier.

### Icônes des sites

L'icône est récupérée **automatiquement à la création** d'un site qui a une URL — après coup
et non pendant, pour que le site n'attende pas un aller-retour réseau pour apparaître. Un
échec est sans conséquence : le bouton « Icône » relance la recherche
(`<link rel="icon">` de la page, sinon `/favicon.ico`). Les octets sont stockés en data URI dans `sites.favicon` : une URL distante
afficherait une image cassée pendant une panne, c'est-à-dire au moment précis où on regarde
le tableau de bord. Si la récupération échoue, le bouton à côté importe une image locale.

Un garde-fou : une réponse dont le `content-type` n'est pas `image/*` est rejetée, sinon un
repli SPA ferait stocker une page HTML en guise d'icône.

### Expiration des certificats

Un check de type `tls` ouvre une connexion, lit le certificat présenté et compte les jours
restants. En dessous du seuil (**21 jours** par défaut, soit de la marge sur un cycle
Let's Encrypt de 90 jours), le check **échoue volontairement** : le site passe en orange
*avant* de tomber, ce qui est tout l'intérêt — un certificat qui expire est l'une des rares
pannes entièrement prévisibles.

L'inspection utilise un vérificateur TLS permissif, et **uniquement pour cette lecture** :
un certificat déjà expiré fait échouer une poignée de main normale, on ne pourrait alors
rien en dire de précis. En acceptant la chaîne sans la valider, on peut toujours annoncer
« expiré depuis 3 jours ». Aucune donnée n'est envoyée sur cette connexion. Les checks HTTP,
eux, passent par reqwest avec la validation complète.

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

## Préférences

La fréquence de vérification se règle entre 30 secondes et 1 heure, dans une liste fermée
plutôt qu'un champ libre : une valeur de 2 secondes saisie par mégarde enverrait 1800
requêtes par heure sur chaque site. Le changement prend effet sans redémarrer.

Une fréquence élevée ne détecte pas mieux les pannes durables — elle ne raccourcit que le
délai avant de les voir.

## Où sont mes données ?

Le chemin du fichier `.db` est affiché en bas de la barre latérale
(typiquement `%APPDATA%\com.cedklein.sitedashboard\sitedashboard.db`).
Pour sauvegarder : copier ce fichier.

## Tests

`npm run test` couvre deux niveaux :

- la **logique pure** (répartition au centime, états de supervision, verdict sur certificat,
  formats) ;
- les **requêtes SQL réelles** ([`src/lib/queries.test.js`](src/lib/queries.test.js)) : le
  module `db` est remplacé par un adaptateur vers `node:sqlite`, et les vraies fonctions de
  `queries.js` tournent sur le schéma produit par les **vraies migrations**, en mémoire. Une
  jointure cassée ou une colonne renommée fait donc échouer les tests.

Côté Rust, `cargo test` couvre le parsing des attributs HTML et la priorité des messages
d'échec. Trois tests réseau sont marqués `#[ignore]` pour que la suite reste hors ligne ;
`cargo test -- --ignored` les lance et vérifie la récupération réelle d'une icône,
l'inspection complète d'une URL et le suivi des redirections.

Ce qui n'est **pas** couvert : le parcours à la souris dans l'application.

## Suite envisagée

- **Icône en zone de notification + démarrage automatique** : aujourd'hui la supervision ne
  tourne que fenêtre ouverte, donc une panne nocturne passe inaperçue
- Alertes système au changement d'état (et seulement au changement, sinon c'est du bruit)
- Import CSV par fournisseur (la plupart exportent du CSV) → `source = 'csv'`
- Connecteurs API là où ça vaut le coup (Stripe, facturation cloud) → `source = 'api'`
