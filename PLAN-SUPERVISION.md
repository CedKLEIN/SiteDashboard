# Plan — cinq angles morts de la supervision

> **Appliqué.** Les trois lots sont livrés (migrations `010` à `013`). Ce document reste la
> trace du raisonnement ; l'état courant se lit dans la section « Supervision » du
> [README](README.md). Deux écarts par rapport au plan ci-dessous :
>
> - un **quatrième opérateur** d'en-tête, `ne_contient_pas`, a été ajouté : avec les trois
>   prévus (`présent`, `absent`, `contient`), la règle qui a motivé toute la proposition —
>   « `Server` ne contenant pas `/` » — n'était pas exprimable ;
> - les checks `valeur` sont aussi exclus de `historiqueSite`, pas seulement de
>   `etatsDesSites` : toujours OK, ils gonflaient le taux de disponibilité sur 24 h.

Cinq ajouts au catalogue de checks. Ils ont un point commun : **chacun correspond à une
panne réellement constatée sur l'infrastructure, qu'aucun check actuel n'aurait signalée.**
Ce n'est pas une liste générique de supervision.

Le modèle actuel assied un check sur deux assertions : `statut_attendu` (après redirections)
et `doit_contenir`. C'est exactement ce périmètre qui laisse passer les cinq cas.

## Ce qui passe devant

L'**icône en zone de notification** (déjà dans la suite envisagée du README). Tant que la
supervision ne tourne que fenêtre ouverte, ces cinq checks ne verront que ce qui casse
pendant qu'on regarde. Aucun de ces cinq ajouts ne vaut d'être livré avant elle.

---

## 1. Assertions sur les en-têtes de réponse

**Ce qui s'est passé.** Le durcissement du proxy (`server_tokens off`, limitation de débit)
était commité depuis des jours mais **jamais monté sur le VPS**. Le site répondait 200,
servait ses pages, rien ne clochait. Le seul témoin visible était l'en-tête
`Server: nginx/1.18.0 (Ubuntu)` au lieu de `nginx`.

**Pourquoi le modèle actuel passe à côté.** Un check ne lit que le statut et le corps. Une
protection qui disparaît ne change ni l'un ni l'autre. C'est la catégorie la plus rentable,
parce qu'une régression de sécurité est **par nature silencieuse**.

**Schéma.** Une table plutôt qu'une colonne JSON : plusieurs règles par check, requêtables,
et cohérent avec `abonnement_tarifs` — on ne stocke pas une structure dans une colonne quand
le reste du schéma est normalisé.

```sql
CREATE TABLE IF NOT EXISTS check_entetes (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    check_id  INTEGER NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
    nom       TEXT    NOT NULL,
    -- 'present' | 'absent' | 'contient'
    operateur TEXT    NOT NULL,
    -- NULL pour 'present' et 'absent'
    valeur    TEXT
);
CREATE INDEX IF NOT EXISTS idx_check_entetes ON check_entetes(check_id);
```

**Rust.** Les en-têtes sont déjà capturés pour le panneau de diagnostic — il ne s'agit pas
d'aller les chercher. `executer_check` renvoie en plus `entetes: Vec<(String, String)>` ; il
ne juge pas (voir « où se décide le verdict »).

**Comparaison.** Nom et valeur **insensibles à la casse** : reqwest normalise déjà les noms
en minuscules, et `nginx` / `Nginx` en valeur ne veut rien dire de différent.

**Chargement.** `checksActifs()` fait une **seconde requête** qui remonte toutes les règles
d'un coup, groupées par `check_id` en mémoire. Une jointure sur la requête principale
dupliquerait chaque check autant de fois qu'il a de règles, et un aller-retour par check
serait un N+1 sur un cycle qui tourne toutes les minutes.

**Règles qui auraient sonné sur Denivio :**

| Nom | Opérateur | Valeur |
|---|---|---|
| `strict-transport-security` | présent | — |
| `content-security-policy` | présent | — |
| `server` | ne contient pas | `/` |

À ajouter au catalogue de [`checksSuggeres.js`](src/lib/checksSuggeres.js) sous une entrée
« En-têtes de sécurité », posée sur `/`.

---

## 2. Redirection attendue plutôt que suivie en silence

**Ce qui s'est passé.** `www.denivio.fr` servait le site en 200 au lieu de rediriger, depuis
la mise en ligne. 4417 URL publiées à deux adresses.

**Pourquoi le modèle actuel passe à côté — le cas le plus retors.** Un check sur
`https://www.denivio.fr` aurait répondu **200 et serait passé au vert**. Le bug *était* le
200. Et régler `statut_attendu = 301` n'y changerait rien : reqwest suit les redirections et
rapporte le statut final. Le README le note déjà — « reqwest les avale silencieusement ».

**Schéma.**

```sql
ALTER TABLE checks ADD COLUMN cible_attendue TEXT;  -- type 'redirection'
```

Le type `redirection` rejoint `http` et `tls` dans la colonne `type`.

**Rust.** `executer_redirection(url, cible_attendue, statut_attendu)` : client en
`redirect::Policy::none()`, **un seul saut**, on renvoie le statut et le `Location` résolu en
absolu. La boucle de suivi existe déjà dans `inspecter_url` — on en extrait une fonction
`suivre_redirections` partagée, elle ne devient qu'une assertion.

**Un seul saut, volontairement.** Le défaut qu'on traque est « ça ne redirige plus du tout ».
Une assertion sur le premier saut est précise et casse bruyamment si la chaîne change ; une
assertion sur la destination finale masquerait un saut intermédiaire ajouté entre-temps.

**Comparaison de la cible.** Résolution en URL absolue, puis comparaison exacte à
`cible_attendue` — schéma et hôte insensibles à la casse, slash final ignoré **seulement**
quand le chemin est vide. Au-delà, `/a` et `/a/` ne sont pas la même ressource et faire
semblant du contraire laisserait passer une vraie régression.

**Bonus non négligeable.** Une cible égale à l'URL de départ est une **boucle** : détectée
gratuitement. Et un `http://` qui cesserait de basculer en `https://` tombe sous la même
règle.

---

## 3. Taille minimale et nombre d'occurrences

**Le raisonnement est déjà celui du catalogue**, on ne fait que l'étendre. Le check
`/config.js` existe parce qu'un entrypoint en échec fait servir un **200 sur un fichier
vide**. Le même piège existe en version dégradée : un 200 sur un contenu *rétréci*.

`sitemap.xml` est généré depuis la base et porte 4417 URL. Si le catalogue se vidait, il
répondrait 200, contiendrait toujours `<urlset`, et le check resterait vert avec 5 URL.

**Schéma.**

```sql
ALTER TABLE checks ADD COLUMN taille_min_octets INTEGER;
ALTER TABLE checks ADD COLUMN occurrences_min   INTEGER;  -- exige doit_contenir
```

**Rust.** `executer_check` renvoie `taille` et `occurrences` (comptage non chevauchant de
`doit_contenir`). Coût dérisoire : le corps est déjà lu.

**Deux pièges à ne pas se prendre :**

- le corps n'est aujourd'hui téléchargé **que si** `doit_contenir` est renseigné. Il faut le
  lire dès que l'une des deux nouvelles colonnes l'est, sinon `taille_min_octets` seul serait
  silencieusement ignoré ;
- la taille comparée est celle du **corps décodé**, pas le `Content-Length` : gzip est activé
  et l'en-tête est absent sur une réponse en chunked. À dire dans le libellé du champ, sinon
  on comparera un jour deux grandeurs différentes sans le voir.

`occurrences_min` sans `doit_contenir` n'a pas de sens : refus **à l'écriture**, dans
`creerCheck`, pas seulement dans le formulaire — même logique que `partsPourSites`.

---

## 4. Suivi de la version déployée

**Ce qui s'est passé.** Établir que la production datait du 14/09 alors que `main` avait trois
jours d'avance — dont un changement de comportement sur la confirmation d'adresse — a pris un
vrai moment. Le site allait parfaitement bien ; il était simplement en retard.

**Schéma.** Un type `valeur`, qui extrait une chaîne et l'**affiche avec sa date de dernier
changement**, sans verdict.

```sql
ALTER TABLE checks ADD COLUMN extracteur TEXT;  -- 'json:buildId' ou 'regex:...'

-- Une ligne par CHANGEMENT de valeur, pas par verification.
CREATE TABLE IF NOT EXISTS check_valeurs (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    check_id INTEGER NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
    valeur   TEXT    NOT NULL,
    depuis   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_check_valeurs ON check_valeurs(check_id, depuis DESC);
```

**Pourquoi une table séparée, et pas une colonne sur `verifications`.** `verifications` est
**purgée à 30 jours**. Un build inchangé depuis six semaines afficherait « inchangé depuis
30 jours » — un chiffre faux qui a l'air vrai. La table des changements est minuscule (une
ligne par déploiement) et n'est jamais purgée. C'est le point de conception de cette
proposition.

On n'insère que lorsque la valeur diffère de la dernière ligne.

**Extraction.** `json:chemin.pointe` via `serde_json`, déjà en dépendance ; `regex:...` avec
le groupe capturant n°1, ce qui ajoute la crate `regex`. Denivio sert déjà `/version.json`
avec son `buildId` : la carte du site afficherait « build du 17/09, inchangé depuis 3 j ».

**Ce check ne produit jamais d'échec**, et c'est voulu : un retard de déploiement n'est pas
une panne, c'est une information.

**Conséquence à ne pas manquer.** `etatsDesSites()` compte tous les checks actifs. Un check
`valeur` toujours OK **diluerait** le ratio — un site avec un seul vrai check, en échec, plus
deux checks `valeur` passerait de rouge à orange. Il faut donc exclure `type = 'valeur'` de
`etatsDesSites()` et le présenter dans un bloc « Informations » distinct sur l'écran de
détail, pas dans la liste des checks.

---

## 5. Expiration de nom de domaine, et où pointe le DNS

**Ce qui s'est passé.** `cckmanagertool.fr`, qui n'est plus utilisé, résout toujours vers le
VPS et atterrit sur un vhost par défaut avec un certificat qui ne le couvre pas.

**L'argument est celui déjà écrit pour le TLS** dans
[`005_certificat.sql`](src-tauri/migrations/005_certificat.sql) : « un certificat qui expire
est l'une des rares pannes totalement prévisibles ». L'expiration d'un nom de domaine l'est
tout autant, et se répare beaucoup moins vite.

**Schéma.** Le type `domaine` **réutilise `seuil_jours`** (déjà là pour le TLS) et
`cible_attendue` (ajoutée en 2). Il ne reste qu'à savoir quel nom interroger :

```sql
ALTER TABLE checks ADD COLUMN domaine TEXT;  -- type 'domaine'
```

**Résolution DNS.** Commencer par `tokio::net::lookup_host` : **zéro dépendance nouvelle**,
la feature `net` de tokio est déjà activée. Elle donne les A/AAAA, ce qui suffit au cas
`cckmanagertool.fr`. `hickory-resolver` n'entre qu'au moment où on voudra réellement lire un
CNAME — pas avant.

À savoir : le résolveur système **cache**, un changement peut donc mettre un TTL à
apparaître. Ce n'est pas un bug à corriger, c'est une latence à documenter.

**Expiration.** RDAP, successeur de WHOIS : JSON, API publique, sans clé.
`https://rdap.org/domain/<nom>` redirige vers le registre compétent (reqwest suit les
redirections par défaut ici, et c'est ce qu'on veut). On lit l'événement
`events[]` dont `eventAction == "expiration"` → `eventDate`. Même seuil en jours et même
logique d'échec anticipé que le certificat.

Un TLD sans serveur RDAP renvoie 404 : l'expiration est alors « inconnue » et seul le verdict
DNS s'applique. Le check ne doit pas échouer pour ça — sinon il crie sur une absence de
donnée, pas sur un problème.

---

## Transversal : la cadence par type de check

**Nécessaire pour 5, et déjà utile aujourd'hui.** Le cycle tourne à la minute. Interroger
RDAP 1440 fois par jour pour une date qui bouge une fois par an est abusif et se fera
rate-limiter. Le même reproche vaut pour le check TLS **existant** : une poignée de main
complète toutes les minutes pour une date qui change tous les 90 jours.

```sql
-- Intervalle minimal entre deux executions. NULL = a chaque cycle.
ALTER TABLE checks ADD COLUMN intervalle_min_s INTEGER;
```

Filtré directement dans `checksActifs()` :

```sql
AND (c.intervalle_min_s IS NULL
     OR COALESCE((SELECT MAX(verifie_le) FROM verifications WHERE check_id = c.id), '')
        < datetime('now', 'localtime', '-' || c.intervalle_min_s || ' seconds'))
```

Défauts proposés : `domaine` → 12 h, `tls` → 6 h, `valeur` → 15 min, `http` et `redirection`
→ à chaque cycle.

Un check qui ne tourne pas à ce cycle **garde son dernier résultat** : `etatsDesSites()` lit
le dernier résultat de chaque check, donc un domaine reste vert entre deux interrogations.
C'est le comportement voulu, pas un effet de bord.

---

## Transversal : où se décide le verdict

Aujourd'hui le verdict HTTP est rendu en Rust (`message_echec`), le verdict TLS en JS
(`evaluerCertificat`). Ajouter trois familles d'assertions des deux côtés ferait deux endroits
qui décident.

**Décision : Rust constate, JS juge.** C'est déjà le partage de `verifier_certificat` +
`evaluerCertificat`, et c'est celui qui rend tout testable sans réseau, dans vitest.

- `executer_check` renvoie les **faits** — statut, en-têtes, taille, occurrences — et plus de
  verdict ;
- un nouveau module `src/lib/assertions.js` porte `evaluerReponse()` : priorité des messages,
  agrégation, formatage ;
- `message_echec` disparaît de [`lib.rs`](src-tauri/src/lib.rs), et ses **deux tests cargo
  sont portés en vitest**. C'est le seul coût de ce choix, et il est payé une fois.

**Ordre de priorité des messages**, qui prolonge la règle déjà en place :

1. **statut** — sur un 404, tout le reste est mécaniquement faux ;
2. **contenu** (fragment, occurrences, taille) — une mauvaise page explique des en-têtes
   manquants, l'inverse n'est pas vrai ;
3. **en-têtes** — la règle en défaut, plus « +N autres » s'il y en a plusieurs. Lister trois
   en-têtes dans une carte de site la rendrait illisible ; le détail est dans le diagnostic.

---

## Ordre de livraison

| Lot | Migrations | Contenu |
|---|---|---|
| 1 | `010_assertions.sql` | en-têtes (1), redirection (2), taille et occurrences (3) |
| 2 | `011_valeurs.sql` | type `valeur` et table `check_valeurs` (4) |
| 3 | `012_cadence.sql` puis `013_domaine.sql` | cadence par type, puis type `domaine` (5) |

**Commencer par le lot 1.** Les trois partagent la même plomberie — une requête HTTP dont on
examine la réponse autrement —, tiennent dans **une seule migration additive**, et ce sont
ceux qui ont réellement laissé passer un défaut en production.

Le lot 3 est indivisible dans cet ordre : le type `domaine` sans la cadence enverrait 1440
requêtes RDAP par jour.

À chaque lot, une entrée `Migration` à ajouter dans [`lib.rs`](src-tauri/src/lib.rs). Les
tests de [`queries.test.js`](src/lib/queries.test.js) rejouent les **vraies migrations** lues
du dossier : un fichier ajouté est pris en compte sans rien déclarer. Restent à mettre à jour
[`rapport.js`](src/lib/rapport.js) (le rapport copiable doit montrer les nouvelles
assertions), [`checksSuggeres.js`](src/lib/checksSuggeres.js) et la section « Supervision »
du README.

---

## Ce que ce tableau de bord ne pourra pas voir

Autant le dire franchement, parce que c'est là qu'est le vrai risque ouvert : **la fraîcheur
des sauvegardes**, l'espace disque, la RAM. Les dumps vivent sur le même disque que la base et
la copie hors-site n'est pas active. Aucune de ces cinq propositions ne le détecterait :
elles passent toutes par HTTP, et ces signaux ne sont pas sur le web.

Le pont le moins coûteux serait un **endpoint d'état côté API Denivio** — date du dernier dump
réussi, espace libre — protégé par un jeton, que le check `valeur` (proposition 4) lirait.
Mais ça touche Denivio, pas SiteDashboard, et ça mérite d'être décidé à part.
