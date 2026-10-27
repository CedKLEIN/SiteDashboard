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
npm run app:build  # build release : installeurs .msi et -setup.exe dans src-tauri/target/release/bundle
```

### Tâches planifiées : modèles appliqués à des sites

Toutes les tâches sont lancées par SiteDashboard, à leur horaire (un passage manqué
appli fermée est rattrapé à la réouverture). Chacune est un **modèle** appliqué à un
**site** :

- `controles/modeles/<id>.json` (dans le dépôt) : un script (`sante-prod`, `audit-hebdo`,
  `bing`) ou une consigne Claude générique (`indexation-seo.md`, `idees-hebdo.md`), son
  horaire par défaut et les champs qu'il demande à la fiche du site (`requis`) ;
- `%USERPROFILE%\.sitedashboard\sites\<cle>.json` (hors du dépôt public) : la fiche du
  site — URL, dossier du projet, description, commandes de vérification, pages et API
  surveillées (`sante`), audit (`audit`, avec une extension de données
  `controles/extensions/<nom>.mjs` au besoin)… ;
- `%USERPROFILE%\.sitedashboard\agents.json` : les agents, `{ id, modele, site }` plus,
  au besoin, `cron`, `titre` et `parametres` ; `agents\<id>.md` : précisions propres à un
  agent Claude (adresses des consoles, faux positifs, priorités), ajoutées à sa consigne.

Le registre est lu au lancement : « Ajouter une tâche » (onglet Agents) applique un
modèle à un site sans réinstaller ; une fiche à laquelle il manque un champ requis rend
le site indisponible pour ce modèle.

```bash
node controles/registre.mjs liste                      # agents composés, modèles applicables
node controles/lancer.mjs idees-hebdo-denivio --essai  # affiche la consigne complète d'un agent
```

Les scripts de contrôle (santé prod, audit hebdo, soumission Bing) remplacent des agents
Claude qui faisaient un travail mécanique.
Ils écrivent le même rapport que les agents (`~/.claude/rapports-agents/…`) : onglet
Agents, notifications et historique inchangés. **Claude n'est appelé qu'en cas d'anomalie
nouvelle** (`claude -p`, lecture seule, dans le dossier du projet) ; tout vert, il n'est
pas contacté.

```bash
node controles/lancer.mjs sante-prod-denivio-quotidienne --essai   # affiche, n'écrit rien
node controles/lancer.mjs audit-hebdo-roisempereurs --sans-claude  # passage réel, sans Claude
```

**Correctifs de dépendances** (`correctifs`, sans horaire) : lancé à la main, ou après
l'audit hebdomadaire quand il trouve une vulnérabilité haute ou critique corrigeable sans
version majeure (pas deux fois pour la même liste ; décocher la tâche coupe ce
déclenchement). Sur un dépôt propre seulement : `npm audit fix` (sans `--force`) sur une
branche `correctifs/<jour>`, puis les vérifications de la fiche (`correctifs.verifications`).
Si l'une échoue, une session Claude reçoit l'erreur et adapte le code ; SiteDashboard
relance lui-même les vérifications. Tout passe : commit local sur la branche, à fusionner
soi-même (rien n'est poussé). Sinon : tout est annulé, le dépôt revient à son état de départ.

Prérequis : Node et Edge (navigateur des mesures, toujours présent sous Windows) ;
Claude Code en ligne de commande pour les analyses (`npm install -g @anthropic-ai/claude-code`
puis `claude` une fois pour se connecter, **depuis un terminal Windows**, pas depuis l'appli
Claude) ; pour Bing, `%USERPROFILE%\.sitedashboard\bing.json` = `{"cle": "<clé API Bing Webmaster>"}`.

### Voir l'interface dans un navigateur (aperçu) et la capturer

```bash
npm.cmd run apercu                 # copie la dernière sauvegarde + les rapports, lance Vite (port 1420)
npm.cmd run captures -- avant      # dans un 2e terminal : un PNG par écran dans captures/
```

Dans l'aperçu, `localStorage['apercu:pannes']` (bouts d'URL, en JSON) simule des checks en
503 et `localStorage['apercu:certificats']` des certificats qui expirent, pour voir les
écrans d'alerte.

Hors de Tauri, `src/apercu.js` simule les appels à Rust : le SQL tourne sur une **copie** de
la base chargée dans sql.js, rien ne touche la vraie. Les données préparées vont dans `.apercu/`,
servies en dev seulement par `vite.config.js` (jamais copiées dans l'appli compilée) ; `.apercu/`
et `captures/` sont ignorés par git.

### Installer ou mettre à jour l'appli

```bash
npm.cmd run installer               # compile, ferme l'appli, installe sans fenêtre, relance
npm.cmd run installer -- --sans-build  # réinstalle le dernier installeur produit
```

Depuis l'appli : quand le dépôt local a des commits plus récents que la version installée,
la barre latérale affiche **« Mise à jour prête »** et **Réglages › Mise à jour** les liste.
Le bouton **Mettre à jour** ouvre une console qui lance `npm.cmd run installer` ; l'appli
se ferme puis se rouvre quelques minutes plus tard. Le commit compilé est gravé dans l'appli
par `src-tauri/build.rs` et comparé au `HEAD` du dépôt au démarrage puis toutes les 15 min.
Rien n'est téléchargé : c'est le code local, commité, qui est recompilé.

L'appli s'installe dans `%LOCALAPPDATA%\SiteDashboard` (entrée « SiteDashboard » du menu
Démarrer) ; ses données restent dans `%APPDATA%\com.cedklein.sitedashboard`, que
l'installeur ne touche pas.

> À lancer depuis un terminal Windows ordinaire, **pas depuis l'appli Claude** : Claude
> tourne dans un paquet du Store dont Windows redirige les écritures dans `AppData`.
> Lancé de là, l'installeur poserait l'appli (et elle sa base) dans l'espace privé de
> Claude, invisible du reste de Windows.

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
| `checks` | ce qu'on vérifie sur un site : une URL, un statut attendu, un fragment de texte, une taille minimale, une cible de redirection, un domaine… |
| `check_entetes` | les en-têtes qu'une réponse doit (ou ne doit pas) porter |
| `check_valeurs` | une ligne par **changement** de valeur lue (version déployée), jamais purgée |
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

### Arrêter un abonnement

Le bouton d'état (« En cours ») demande une **date d'arrêt**, puis fige l'abonnement à
partir de cette date. Les échéances antérieures restent comptées partout — cumul, graphes,
répartition par site : ce qui a été payé l'a été. « Arrêté » redevient cliquable pour
reprendre.

La date est **exclusive** : « arrêté à partir du 1er avril » signifie que le prélèvement du
1er avril n'a pas lieu. Une borne inclusive facturerait un mois de trop à chaque résiliation.

`fin` et `actif` sont toujours écrits **ensemble**, jamais séparément : les graphes se basent
sur `fin` et l'affichage sur `actif`. Les laisser diverger donnait une case décochée pendant
que les montants continuaient de monter — on croyait avoir arrêté, et les chiffres disaient
le contraire. Le drapeau « actif » dit *que* c'est arrêté, la date dit *quand*.

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

## L'interface

Quatre entrées, organisées par usage plutôt que par table : **Vue d'ensemble**, **Sites**,
**Finances** (transactions, abonnements) et **Réglages** (général, agents). La barre latérale
liste aussi chaque site avec son état, pour l'ouvrir en un clic.

- **« + Nouveau »** (et `N` au clavier) ouvre la saisie dans un **panneau latéral** :
  dépense, revenu, abonnement ou site. Les formulaires ne squattent plus le haut des pages.
- **`Ctrl+K`** ouvre la palette : actions, sites, transactions (recherche sans accents) et
  navigation, au clavier.
- Les actions secondaires d'une ligne passent dans un menu **⋯** ; un clic sur la ligne la
  modifie. Toute suppression demande confirmation.
- **Thème** clair, sombre ou celui de Windows (Réglages › Apparence, ou l'icône en bas de la
  barre latérale).

**Couleurs** : deux familles qui ne se croisent jamais. Les **états** (vert OK, orange
dégradé, rouge en panne, bleu info) disent la santé ; les **données financières** (turquoise
revenus, rose dépenses, violet abonnements) disent l'argent. Avant, « revenu » et « site OK »
partageaient le même vert, et une dépense ressemblait à une panne. Tout passe par les
variables CSS de [`src/index.css`](src/index.css), graphes compris.

### Vue d'ensemble

- **les sites** : état, disponibilité des 24 dernières heures en barres (une par heure),
  latence ;
- **les indicateurs** de la période, avec leur courbe et l'écart avec **la même période un an
  plus tôt** (janvier–octobre contre janvier–octobre, pas contre l'année entière) ;
- **flux mensuels** : revenus au-dessus de zéro, dépenses et abonnements en dessous, et la
  marge cumulée en courbe ;
- **À traiter** ([`src/lib/aTraiter.js`](src/lib/aTraiter.js)) : checks en échec (avec
  « depuis quand »), certificats et domaines qui expirent, points des agents du jour,
  prélèvements des 7 prochains jours. La pastille du menu compte ce qui demande un geste ;
- **rentabilité par site** : revenus, coûts (dépenses et abonnements, en parts) et marge.

La **période** se choisit en boutons — on consulte un tableau de bord pour répondre à « où
j'en suis cette année », pas pour interroger une plage arbitraire — et elle est **mémorisée**
dans la table `preferences`. « Depuis toujours » démarre à la première écriture connue,
sinon le graphe afficherait des siècles de mois vides. Le bilan
([`src/lib/bilan.js`](src/lib/bilan.js)) est partagé par la vue d'ensemble, Finances et la
fiche d'un site ; les cumuls vivent dans [`src/lib/series.js`](src/lib/series.js), pas dans
un composant : accumuler pendant le rendu donnerait des totaux différents à chaque re-rendu.

### Fiche d'un site

Onglets **Santé** (disponibilité sur 24 h, 7 j ou 30 j — l'historique est purgé à 30 jours —,
latence médiane et 95e centile par demi-heure, checks, catalogue, informations suivies),
**Finances** (ses transactions, pour **sa part** : une dépense partagée ne compte qu'à
hauteur de ce qui lui revient), **Agents** et **Réglages** (nom, URL, couleur, icône, suivi,
suppression).

### Finances

Dépenses et revenus dans **un seul fil**, regroupés par mois avec leur solde, filtrables par
type, site, catégorie et période, avec une recherche. « CSV » copie les lignes affichées, à
coller dans un tableur. Une dépense peut être saisie en **dollars** comme un revenu (migration
014) : convertie au taux du jour de l'opération, ses parts par site sont en euros.

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
sur la vue d'ensemble et dans la barre latérale :

| Icône | Signification |
|---|---|
| cercle coché, vert | tous les checks du site passent |
| triangle d'alerte, orange | une partie des checks échoue |
| croix cerclée, rouge | tous les checks échouent |
| cercle pointillé, gris | aucun check, ou aucun encore exécuté |

L'état passe par la **forme** de l'icône, pas seulement par la couleur : celle-ci sert déjà
à identifier les sites, et ne distingue rien pour un daltonien. La couleur du site teinte
donc son **monogramme** (ou son favicon), jamais un indicateur d'état.

Un clic sur une carte ouvre la fiche du site (voir « L'interface »).

Les requêtes HTTP partent **du code Rust**, pas de la WebView : depuis le front, un `fetch`
vers tes sites serait bloqué par CORS et ne donnerait jamais le vrai code de statut.

Un check ne demande que le **chemin** : l'URL de base vient du site et s'affiche en préfixe
non modifiable. Une URL absolue reste acceptée, pour viser une API sur un autre domaine.

Un site créé avec une URL reçoit automatiquement un check sur sa page d'accueil. L'écran de
détail propose ensuite un **catalogue de checks courants en un clic**
([`src/lib/checksSuggeres.js`](src/lib/checksSuggeres.js)), tiré de ce qui est réellement
déployé sur Denivio et HistorySite :

| Check | Cible | Ce qui est vérifié |
|---|---|---|
| Page d'accueil | `/` | le site répond et sert sa page |
| Configuration runtime | `/config.js` | contient `window.`, et pèse plus de 64 o |
| Santé de l'API | `/healthz` | — |
| Sitemap | `/sitemap.xml` | contient `<urlset`, et pèse plus de 1 Ko |
| robots.txt | `/robots.txt` | `User-agent` |
| Manifest PWA | `/manifest.webmanifest` | — |
| En-têtes de sécurité | `/` | HSTS et CSP présents, `Server` sans version |
| Redirection www | l'autre forme du domaine | redirige bien vers le site |
| Bascule en https | `http://…` | redirige bien vers `https://` |
| Certificat TLS | (le domaine) | expiration |
| Nom de domaine | (le domaine) | où il pointe, et quand il expire |
| Version déployée | `/version.json` | affiche le `buildId` — sans verdict |

Le `doitContenir` compte autant que le statut. Le cas qui a motivé le catalogue est
`/config.js` : le conteneur le réécrit à chaque démarrage depuis son `.env`
(`docker-entrypoint.sh`). Si l'entrypoint échoue, nginx sert quand même un **200** sur un
fichier vide — et le symptôme est une carte muette, pas une erreur. Même logique pour un
sitemap proxyfié qui renvoie 200 avec une page d'erreur HTML.

Une suggestion déjà surveillée disparaît de la liste. Les checks sur mesure s'ajoutent
toujours par le formulaire en dessous.

### Ce qu'un statut et un fragment ne voient pas

Les cinq dernières entrées du catalogue existent parce qu'un 200 avec le bon contenu ne dit
toujours rien des en-têtes, des redirections ni de la version en ligne. Chacune vient d'une
panne réellement constatée, qu'aucun check ne signalait.

**Les en-têtes de réponse.** Un durcissement du proxy (`server_tokens off`, limitation de
débit) était commité depuis des jours mais jamais monté sur le VPS. Le site répondait 200 et
servait ses pages ; le seul témoin visible était `Server: nginx/1.18.0 (Ubuntu)` au lieu de
`nginx`. Une protection qui disparaît ne change ni le statut ni le corps — c'est la
catégorie la plus rentable, parce qu'une régression de sécurité est **par nature
silencieuse**. Les règles se saisissent une par ligne, le `!` niant la règle :

    strict-transport-security       -> doit être présent
    !x-powered-by                   -> doit être absent
    content-type: application/json  -> doit contenir cette valeur
    !server: /                      -> ne doit pas contenir cette valeur

La dernière forme est indispensable : on veut interdire un numéro de version sans figer pour
autant la valeur attendue.

**La redirection, observée plutôt que suivie.** `www.denivio.fr` servait le site en 200 au
lieu de rediriger, depuis la mise en ligne : 4417 URL publiées à deux adresses. Un check
classique serait **passé au vert**, puisque le bug *était* le 200 — et régler
`statut_attendu = 301` n'y aurait rien changé, reqwest suivant les redirections pour ne
rapporter que le statut final. Le check `redirection` ne suit rien : il lit le code 3xx
**et** le `Location` du premier saut.

Un seul saut, volontairement : le défaut qu'on traque est « ça ne redirige plus du tout », et
une assertion sur la destination finale masquerait un saut intermédiaire ajouté entre-temps.
La cible est comparée **avant** le code exact — rediriger au mauvais endroit est plus grave
que rediriger au bon endroit en 302 plutôt qu'en 301. Une cible égale à l'URL de départ est
une boucle, détectée au passage.

**La taille et le nombre d'occurrences.** Le même piège que `/config.js`, en version
dégradée : un 200 sur un contenu *rétréci*. Le `sitemap.xml` est généré depuis la base et
porte 4417 URL ; s'il se vidait, il répondrait 200, contiendrait toujours `<urlset`, et
resterait vert avec 5 URL. La taille comparée est celle du **corps décodé**, pas le
`Content-Length` : gzip est actif et l'en-tête est absent sur une réponse en chunked.

**La version déployée.** Établir que la production datait du 14/09 alors que `main` avait
trois jours d'avance a pris un vrai moment — le site allait très bien, il était seulement en
retard. Un check `valeur` extrait une chaîne (`json:buildId` ou `regex:motif`) et l'affiche
avec sa date de dernier changement, **sans rendre de verdict** : un retard de déploiement
n'est pas une panne, c'est une information.

Les valeurs vivent dans `check_valeurs`, une ligne par changement, et pas dans
`verifications` — qui est purgée à 30 jours. Un build inchangé depuis six semaines y
afficherait « inchangé depuis 30 jours », un chiffre faux qui a l'air vrai. Ces checks sont
aussi **exclus** de l'état des sites et du taux de disponibilité : toujours OK, ils
diluteraient le ratio — un site avec un seul vrai check en échec et deux checks `valeur`
passerait de rouge à orange.

**Le nom de domaine.** Un domaine qu'on n'utilise plus résolvait toujours vers le VPS, et
atterrissait sur un vhost par défaut avec un certificat qui ne le couvre pas. L'argument est
celui du certificat : l'expiration d'un nom de domaine est entièrement prévisible, et se
répare beaucoup moins vite. Le check compare les adresses A/AAAA à une cible attendue, et lit
la date d'expiration par **RDAP** — le successeur de WHOIS, qui répond en JSON sur une API
publique, sans clé.

Deux limites assumées : le résolveur du système **cache**, donc un changement peut mettre un
TTL à apparaître ; et un TLD sans serveur RDAP ne fait pas échouer le check — crier sur une
absence de donnée userait l'alerte pour rien.

### Où se décide le verdict

**Rust constate, JS juge.** Les commandes renvoient les *faits* d'une réponse — statut,
en-têtes, taille, occurrences, cible de redirection — et ne décident rien. Les verdicts
vivent dans [`src/lib/assertions.js`](src/lib/assertions.js).

C'était déjà le partage de `verifier_certificat` + `evaluerCertificat`. L'étendre aux trois
nouvelles familles d'assertions évite d'avoir **deux endroits qui décident**, donc deux
endroits à corriger quand une règle change — et rend toutes les règles testables sans réseau.

L'ordre des messages d'échec prolonge la règle en place depuis le début :

1. **statut** — sur un 404, tout le reste est mécaniquement faux ;
2. **contenu** (fragment, occurrences, taille) — une mauvaise page explique des en-têtes
   manquants, l'inverse n'est pas vrai ;
3. **en-têtes** — la règle en défaut, plus « +N autres » s'il y en a plusieurs. Lister trois
   en-têtes dans une carte de site la rendrait illisible ; le détail est dans le diagnostic.

### La cadence de chaque check

Le cycle tourne à la minute, mais tous les checks n'ont pas à tourner aussi souvent :
interroger RDAP 1440 fois par jour pour une date qui bouge une fois par an est abusif et se
fait rate-limiter. Une poignée de main TLS complète chaque minute, pour une date qui change
tous les 90 jours, ne valait pas mieux.

| Type | Intervalle minimal |
|---|---|
| `http`, `redirection` | à chaque cycle |
| `valeur` | 15 min |
| `tls` | 6 h |
| `domaine` | 12 h |

Un check sauté **garde son dernier résultat** : l'état d'un site se lit sur la dernière
vérification de chaque check, pas sur son âge. Un domaine reste donc vert entre deux
interrogations.

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
la vue d'ensemble. Si la récupération échoue, le bouton à côté importe une image locale.

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

## Rapports des agents

Les statuts des agents (indexation, santé de la prod, tri Sentry, audit hebdomadaire…) sont
dans la **fiche de chaque site** : l'onglet Agents de la fiche d'un site montre ce qu'il y a
à faire, l'état du jour de chaque tâche et ses derniers passages (sa carte porte une petite
icône d'état des agents). **Réglages › Agents** ne garde que les réglages, site par site :
activation, horaire, lancement, retrait, ajout, et les tâches que les autres sites ont et
pas celui-ci (un clic les ajoute). Ainsi, un site sans la tâche « Bing : soumission et
suivi » a un agent « SEO Google + Bing » qui fait les deux consoles dans Chrome ; avec elle,
Bing passe par l'API et l'agent s'appelle « SEO Google ».

Chaque passage d'un agent dépose un fichier JSON :

    ~/.claude/rapports-agents/<site>/<AAAA-MM-JJ>/<agent>.json

```json
{
  "site": "denivio.fr",
  "agent": "sante-prod-denivio-quotidienne",
  "titre": "Santé de la prod",
  "date": "2026-10-24",
  "debut": "2026-10-24T07:41:00+02:00",
  "fin": "2026-10-24T07:52:00+02:00",
  "statut": "ok",
  "resume": "Tout répond, certificat valide encore 61 jours.",
  "points": [{ "niveau": "attention", "texte": "/catalogs en 2,8 s (×2 depuis hier)" }],
  "fichier": "C:\\Users\\cedao\\Documents\\Projet\\SportSite\\sante-prod-denivio.md"
}
```

`statut` (et `niveau` d'un point) vaut `ok`, `attention` (l'agent a fait son travail et
signale quelque chose à regarder) ou `echec` (l'agent n'a pas pu faire son travail, ou a
trouvé une panne). `fichier` pointe vers le journal détaillé de l'agent, qu'un clic ouvre
dans l'explorateur.

Une ligne par **site et par jour**, la plus récente d'abord, avec un verdict
([`src/lib/rapportsAgents.js`](src/lib/rapportsAgents.js)) :

| Icône | Verdict |
|---|---|
| cercle coché, vert | tous les rapports sont OK |
| triangle d'alerte, orange | un point à regarder, ou un échec isolé |
| croix cerclée, rouge | au moins la moitié des rapports sont en échec |

Un « à regarder » ne rend jamais la journée rouge : seuls les échecs comptent pour le rouge.
Un fichier illisible (JSON invalide, statut inconnu, plus de 256 Ko) n'est **pas** ignoré :
il devient un rapport en échec — un agent qui écrit n'importe quoi est un agent qui a cassé.
Le site, la date et l'agent sont repris du chemin quand le JSON les omet, et un rapport se
rattache à un site suivi par son **domaine** (`denivio.fr` ↔ `https://www.denivio.fr`), à
défaut par son nom.

Même partage que la supervision : Rust lit les fichiers (`lire_rapports_agents`, 30 derniers
jours), JS valide et juge. Aucun rapport n'est copié en base — le dossier fait foi, et
supprimer un fichier le retire de l'écran. Limite assumée : un agent qui n'a **pas tourné**
ne laisse aucun fichier, donc rien ne le signale encore ; il faudrait connaître le calendrier
de chaque tâche pour le voir manquer.

## Réglages

Réglages › Général : mise à jour, apparence (thème), supervision, démarrage avec Windows,
notifications, données et sauvegardes.

La fréquence de vérification se règle entre 30 secondes et 1 heure, dans une liste fermée
plutôt qu'un champ libre : une valeur de 2 secondes saisie par mégarde enverrait 1800
requêtes par heure sur chaque site. Le changement prend effet sans redémarrer.

Une fréquence élevée ne détecte pas mieux les pannes durables — elle ne raccourcit que le
délai avant de les voir.

## Où sont mes données ?

Le chemin du fichier `.db` est affiché dans Réglages › Données
(typiquement `%APPDATA%\com.cedklein.sitedashboard\sitedashboard.db`).
Pour sauvegarder : copier ce fichier.

## Tests

`npm run test` couvre deux niveaux :

- la **logique pure** (répartition au centime, états de supervision, verdicts d'assertion —
  en-têtes, redirections, taille, domaine —, verdict sur certificat, formats) ;
- les **requêtes SQL réelles** ([`src/lib/queries.test.js`](src/lib/queries.test.js)) : le
  module `db` est remplacé par un adaptateur vers `node:sqlite`, et les vraies fonctions de
  `queries.js` tournent sur le schéma produit par les **vraies migrations**, en mémoire. Une
  jointure cassée ou une colonne renommée fait donc échouer les tests ;
- le **rendu des agents** avec Testing Library : statuts et rapports dans la fiche du site
  ([`src/components/AgentsDuSite.test.jsx`](src/components/AgentsDuSite.test.jsx)), réglages
  de l'onglet Agents ([`src/pages/Agents.test.jsx`](src/pages/Agents.test.jsx)).

Côté Rust, `cargo test` couvre le parsing des attributs HTML, la résolution d'une cible de
redirection, l'extraction d'une valeur (`json:` et `regex:`) et le calcul de jours entre deux
dates. Les tests réseau sont marqués `#[ignore]` pour que la suite reste hors ligne ;
`cargo test -- --ignored` les lance et vérifie la récupération réelle d'une icône,
l'inspection complète d'une URL, le suivi des redirections, une redirection observée sans
être suivie et la résolution d'un vrai domaine.

Ce qui n'est **pas** couvert : le parcours à la souris dans l'application.

## Suite envisagée

- **Icône en zone de notification + démarrage automatique** : aujourd'hui la supervision ne
  tourne que fenêtre ouverte, donc une panne nocturne passe inaperçue — et tant que ce n'est
  pas fait, les checks ne voient que ce qui casse pendant qu'on regarde. Ça passe devant tout
  le reste
- **Fraîcheur des sauvegardes, espace disque, RAM** : le vrai risque ouvert, et le seul que
  ce tableau de bord ne peut pas voir — tout passe par HTTP ici, et ces signaux ne sont pas
  sur le web. Le pont le moins coûteux serait un endpoint d'état côté API, protégé par un
  jeton, que le check `valeur` lirait ; mais ça touche le site supervisé, pas SiteDashboard
- Alertes système au changement d'état (et seulement au changement, sinon c'est du bruit)
- Import CSV par fournisseur (la plupart exportent du CSV) → `source = 'csv'`
- Connecteurs API là où ça vaut le coup (Stripe, facturation cloud) → `source = 'api'`
