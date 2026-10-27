import { intervalleParDefaut } from "../assertions";
import { execute, select } from "../db";

/* -------------------------------------------------------- supervision */

/**
 * Attache a chaque check ses regles d'en-tetes, en UNE requete.
 *
 * Une jointure sur la requete principale dupliquerait chaque check autant de
 * fois qu'il a de regles; un aller-retour par check serait un N+1 sur un cycle
 * qui tourne toutes les minutes. La table se compte en dizaines de lignes sur
 * une base locale: on la lit entiere et on regroupe en memoire.
 */
async function avecEntetes(checks) {
  if (checks.length === 0) return checks;

  const regles = await select(
    "SELECT check_id, nom, operateur, valeur FROM check_entetes ORDER BY check_id, id",
  );
  const parCheck = new Map();
  for (const regle of regles) {
    if (!parCheck.has(regle.check_id)) parCheck.set(regle.check_id, []);
    parCheck.get(regle.check_id).push(regle);
  }

  return checks.map((check) => ({ ...check, entetes: parCheck.get(check.id) ?? [] }));
}

export async function listerChecks(siteId) {
  const checks = await select(
    `SELECT c.*,
            v.ok          AS dernier_ok,
            v.statut_http AS dernier_statut,
            v.latence_ms  AS derniere_latence,
            v.erreur      AS derniere_erreur,
            v.jours_restants AS derniers_jours,
            v.taille      AS derniere_taille,
            v.occurrences AS dernieres_occurrences,
            v.adresses    AS dernieres_adresses,
            v.verifie_le  AS derniere_verif,
            cv.valeur     AS valeur_courante,
            cv.depuis     AS valeur_depuis
     FROM checks c
     LEFT JOIN verifications v ON v.id = (
       SELECT id FROM verifications
       WHERE check_id = c.id
       ORDER BY verifie_le DESC, id DESC
       LIMIT 1
     )
     LEFT JOIN check_valeurs cv ON cv.id = (
       SELECT id FROM check_valeurs
       WHERE check_id = c.id
       ORDER BY depuis DESC, id DESC
       LIMIT 1
     )
     WHERE c.site_id = $1
     ORDER BY c.id`,
    [siteId],
  );
  return avecEntetes(checks);
}

/**
 * Les checks a executer a ce cycle.
 *
 * Un check dote d'un `intervalle_min_s` est saute tant que son dernier passage
 * est trop recent - inutile d'interroger RDAP 1440 fois par jour pour une date
 * qui bouge une fois par an. Il GARDE son dernier resultat entre-temps:
 * `etatsDesSites` lit la derniere verification de chaque check, pas son age.
 */
export async function checksActifs() {
  const checks = await select(
    `SELECT c.id, c.url, c.type, c.seuil_jours, c.statut_attendu, c.doit_contenir,
            c.cible_attendue, c.taille_min_octets, c.occurrences_min,
            c.extracteur, c.domaine, c.intervalle_min_s,
            c.libelle, s.nom AS site_nom
     FROM checks c
     JOIN sites s ON s.id = c.site_id
     WHERE c.actif = 1 AND s.actif = 1
       AND (c.intervalle_min_s IS NULL
            OR COALESCE((SELECT MAX(verifie_le) FROM verifications WHERE check_id = c.id), '')
               < datetime('now', 'localtime', '-' || c.intervalle_min_s || ' seconds'))
     ORDER BY c.site_id, c.id`,
  );
  return avecEntetes(checks);
}

export async function creerCheck({
  siteId,
  libelle,
  url,
  type = "http",
  statutAttendu = null,
  doitContenir = null,
  seuilJours = null,
  cibleAttendue = null,
  tailleMinOctets = null,
  occurrencesMin = null,
  extracteur = null,
  domaine = null,
  intervalleMinS,
  entetes = [],
}) {
  // Un nombre minimal d'occurrences sans fragment a chercher n'a pas de sens.
  // Le refus a lieu ici et pas seulement dans le formulaire: c'est le seul
  // passage oblige, comme pour les parts d'une depense.
  if (occurrencesMin != null && !doitContenir) {
    throw new Error("Un nombre minimal d'occurrences exige un fragment a chercher.");
  }

  const intervalle = intervalleMinS === undefined ? intervalleParDefaut(type) : intervalleMinS;

  const resultat = await execute(
    `INSERT INTO checks (site_id, libelle, url, type, statut_attendu, doit_contenir, seuil_jours,
                         cible_attendue, taille_min_octets, occurrences_min, extracteur, domaine,
                         intervalle_min_s)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      siteId,
      libelle,
      url,
      type,
      statutAttendu,
      doitContenir || null,
      seuilJours,
      cibleAttendue || null,
      tailleMinOctets,
      occurrencesMin,
      extracteur || null,
      domaine || null,
      intervalle,
    ],
  );

  for (const regle of entetes) {
    await execute(
      "INSERT INTO check_entetes (check_id, nom, operateur, valeur) VALUES ($1, $2, $3, $4)",
      [resultat.lastInsertId, regle.nom, regle.operateur, regle.valeur ?? null],
    );
  }

  return resultat;
}

export function supprimerCheck(id) {
  return execute("DELETE FROM checks WHERE id = $1", [id]);
}

export function basculerCheck(id, actif) {
  return execute("UPDATE checks SET actif = $1 WHERE id = $2", [actif ? 1 : 0, id]);
}

export function enregistrerVerification(
  checkId,
  {
    ok,
    statut,
    latence_ms,
    erreur,
    jours_restants = null,
    taille = null,
    occurrences = null,
    adresses = null,
  },
) {
  return execute(
    `INSERT INTO verifications (check_id, ok, statut_http, latence_ms, erreur, jours_restants,
                                taille, occurrences, adresses)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      checkId,
      ok ? 1 : 0,
      statut ?? null,
      latence_ms ?? null,
      erreur ?? null,
      jours_restants,
      taille,
      occurrences,
      adresses,
    ],
  );
}

/**
 * Enregistre la valeur lue par un check `valeur`, UNIQUEMENT si elle a change.
 *
 * C'est ce qui permet de dire "inchange depuis 3 jours" sans mentir: la table
 * `verifications` est purgee a 30 jours, un build inchange depuis six semaines
 * y afficherait "30 jours". Ici, une ligne par deploiement, jamais purgee.
 */
export async function enregistrerValeur(checkId, valeur) {
  const [derniere] = await select(
    "SELECT valeur FROM check_valeurs WHERE check_id = $1 ORDER BY depuis DESC, id DESC LIMIT 1",
    [checkId],
  );
  if (derniere?.valeur === valeur) return null;

  return execute("INSERT INTO check_valeurs (check_id, valeur) VALUES ($1, $2)", [checkId, valeur]);
}

/**
 * Etat courant de chaque site: on ne regarde que le DERNIER resultat de chaque
 * check actif, pas tout l'historique.
 *
 * Les checks `valeur` en sont exclus: ils ne produisent jamais d'echec, donc
 * ils diluteraient le ratio. Un site avec un seul vrai check, en echec, plus
 * deux checks `valeur` passerait de rouge a orange.
 */
export function etatsDesSites() {
  return select(
    `SELECT s.id, s.nom, s.url, s.couleur, s.favicon,
            COUNT(c.id)                                  AS nb_checks,
            COUNT(v.id)                                  AS nb_resultats,
            COALESCE(SUM(CASE WHEN v.ok = 1 THEN 1 ELSE 0 END), 0) AS nb_ok,
            MAX(v.verifie_le)                            AS derniere_verif,
            AVG(v.latence_ms)                            AS latence_moyenne
     FROM sites s
     LEFT JOIN checks c ON c.site_id = s.id AND c.actif = 1 AND c.type <> 'valeur'
     LEFT JOIN verifications v ON v.id = (
       SELECT id FROM verifications
       WHERE check_id = c.id
       ORDER BY verifie_le DESC, id DESC
       LIMIT 1
     )
     WHERE s.actif = 1
     GROUP BY s.id
     ORDER BY s.nom`,
  );
}

/**
 * Historique d'un site, tous checks de supervision confondus, pour le graphe de
 * latence et le taux de disponibilite.
 *
 * Les checks `valeur` en sont exclus pour la meme raison que dans
 * `etatsDesSites`: toujours OK, ils gonfleraient la disponibilite.
 */
export function historiqueSite(siteId, heures = 24) {
  return select(
    `SELECT v.verifie_le, v.ok, v.latence_ms, v.statut_http, v.erreur, c.libelle AS check_libelle
     FROM verifications v
     JOIN checks c ON c.id = v.check_id
     WHERE c.site_id = $1 AND c.type <> 'valeur'
       AND v.verifie_le >= datetime('now', 'localtime', $2)
     ORDER BY v.verifie_le`,
    [siteId, `-${heures} hours`],
  );
}

/**
 * Purge l'historique de supervision. A 1 verification par minute et par check,
 * la table grossit de ~1440 lignes par jour et par check: sans purge elle
 * finirait par peser plus lourd que tout le reste de la base.
 */
export function purgerVerifications(jours = 30) {
  return execute("DELETE FROM verifications WHERE verifie_le < datetime('now', 'localtime', $1)", [
    `-${jours} days`,
  ]);
}

/**
 * Verifications regroupees par tranche (heure ou jour) et par site, pour les
 * barres de disponibilite. Les checks `valeur` sont exclus, comme partout.
 * `tranche` vaut 'YYYY-MM-DD HH' a l'heure, 'YYYY-MM-DD' au jour.
 *
 * Au jour, les jours termines viennent du resume `disponibilite_jours`, qui
 * survit a la purge ; seul le jour en cours se lit dans `verifications`.
 */
export function disponibiliteParTranche({ heures = 24, parJour = false, siteId = null } = {}) {
  if (parJour) {
    return select(
      `SELECT site_id, tranche, SUM(total) AS total, SUM(ok) AS ok FROM (
         SELECT c.site_id, d.jour AS tranche, d.total, d.ok
         FROM disponibilite_jours d
         JOIN checks c ON c.id = d.check_id
         WHERE c.type <> 'valeur' AND c.actif = 1
           AND d.jour >= date('now', 'localtime', $1) AND d.jour < date('now', 'localtime')
           AND ($2 IS NULL OR c.site_id = $2)
         UNION ALL
         SELECT c.site_id, substr(v.verifie_le, 1, 10), 1, CASE WHEN v.ok = 1 THEN 1 ELSE 0 END
         FROM verifications v
         JOIN checks c ON c.id = v.check_id
         WHERE c.type <> 'valeur' AND c.actif = 1
           AND v.verifie_le >= date('now', 'localtime')
           AND ($2 IS NULL OR c.site_id = $2)
       )
       GROUP BY site_id, tranche`,
      [`-${Math.ceil(heures / 24)} days`, siteId],
    );
  }
  return select(
    `SELECT c.site_id, substr(v.verifie_le, 1, 13) AS tranche,
            COUNT(*) AS total, SUM(CASE WHEN v.ok = 1 THEN 1 ELSE 0 END) AS ok
     FROM verifications v
     JOIN checks c ON c.id = v.check_id
     WHERE c.type <> 'valeur' AND c.actif = 1
       AND v.verifie_le >= datetime('now', 'localtime', $1)
       AND ($2 IS NULL OR c.site_id = $2)
     GROUP BY c.site_id, tranche`,
    [`-${heures} hours`, siteId],
  );
}

/** Jours de resume gardes : un an et un peu plus. */
export const JOURS_RESUME_DISPONIBILITE = 400;

/**
 * Resume les jours termines dans `disponibilite_jours`, AVANT que la purge ne
 * les efface de `verifications`. Le dernier jour deja resume est recalcule
 * (sans effet s'il etait complet) ; les plus vieux resumes sont oublies.
 */
export async function consoliderJours() {
  await execute(
    `INSERT OR REPLACE INTO disponibilite_jours (check_id, jour, total, ok, latence_moyenne_ms)
     SELECT check_id, substr(verifie_le, 1, 10), COUNT(*),
            SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END), CAST(AVG(latence_ms) AS INTEGER)
     FROM verifications
     WHERE verifie_le >= COALESCE((SELECT MAX(jour) FROM disponibilite_jours), '')
       AND substr(verifie_le, 1, 10) < date('now', 'localtime')
     GROUP BY check_id, substr(verifie_le, 1, 10)`,
  );
  await execute("DELETE FROM disponibilite_jours WHERE jour < date('now', 'localtime', $1)", [
    `-${JOURS_RESUME_DISPONIBILITE} days`,
  ]);
}

/**
 * Checks actifs dont le DERNIER resultat est un echec, avec le debut de la
 * serie d'echecs en cours (premier echec apres le dernier succes) : « 503
 * depuis 12 min » dit plus qu'un simple « KO ».
 */
export function checksEnEchec() {
  return select(
    `SELECT c.id, c.site_id, c.libelle, c.url, c.type, s.nom AS site_nom,
            v.statut_http, v.erreur, v.jours_restants, v.verifie_le,
            (SELECT MIN(x.verifie_le) FROM verifications x
              WHERE x.check_id = c.id
                AND x.verifie_le > COALESCE(
                  (SELECT MAX(y.verifie_le) FROM verifications y WHERE y.check_id = c.id AND y.ok = 1), '')
            ) AS depuis
     FROM checks c
     JOIN sites s ON s.id = c.site_id AND s.actif = 1
     JOIN verifications v ON v.id = (
       SELECT id FROM verifications WHERE check_id = c.id ORDER BY verifie_le DESC, id DESC LIMIT 1
     )
     WHERE c.actif = 1 AND c.type <> 'valeur' AND v.ok = 0
     ORDER BY s.nom, c.id`,
  );
}
