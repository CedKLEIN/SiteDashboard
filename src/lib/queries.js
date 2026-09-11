import { execute, select } from "./db";
import { partsPourSites, redistribuer } from "./repartition";

/* ---------------------------------------------------------------- sites */

export function listerSites() {
  return select("SELECT * FROM sites ORDER BY actif DESC, nom");
}

export async function creerSite({ nom, url, couleur }) {
  const res = await execute("INSERT INTO sites (nom, url, couleur) VALUES ($1, $2, $3)", [
    nom,
    url || null,
    couleur || "#6366f1",
  ]);

  // Un site avec une URL est supervise des sa creation: sans ce check par defaut,
  // il resterait gris sur l'accueil tant qu'on n'a pas pense a en ajouter un.
  if (url) {
    await creerCheck({ siteId: res.lastInsertId, libelle: "Page d'accueil", url });
  }
  return res;
}

export function majSite(id, { nom, url, couleur, actif }) {
  return execute(
    "UPDATE sites SET nom = $1, url = $2, couleur = $3, actif = $4 WHERE id = $5",
    [nom, url || null, couleur, actif ? 1 : 0, id],
  );
}

export function majFaviconSite(id, favicon) {
  return execute("UPDATE sites SET favicon = $1 WHERE id = $2", [favicon, id]);
}

export function supprimerSite(id) {
  return execute("DELETE FROM sites WHERE id = $1", [id]);
}

/* --------------------------------------------------------- fournisseurs */

export function listerFournisseurs() {
  return select("SELECT * FROM fournisseurs ORDER BY nom");
}

/**
 * Cree le fournisseur s'il n'existe pas, et renvoie son id dans tous les cas.
 * L'URL fournie complete un fournisseur qui n'en avait pas encore, sans jamais
 * ecraser celle deja enregistree.
 */
export async function trouverOuCreerFournisseur(nom, categorie = "autre", url = null) {
  const propre = String(nom || "").trim();
  if (!propre) return null;

  const existant = await select("SELECT id, url FROM fournisseurs WHERE nom = $1", [propre]);
  if (existant.length > 0) {
    if (url && !existant[0].url) {
      await execute("UPDATE fournisseurs SET url = $1 WHERE id = $2", [url, existant[0].id]);
    }
    return existant[0].id;
  }

  const res = await execute(
    "INSERT INTO fournisseurs (nom, categorie, url) VALUES ($1, $2, $3)",
    [propre, categorie, url || null],
  );
  return res.lastInsertId;
}

export function majFaviconFournisseur(id, favicon) {
  return execute("UPDATE fournisseurs SET favicon = $1 WHERE id = $2", [favicon, id]);
}

/* ------------------------------------------------------------- depenses */

/** Noms des sites concernes, en une colonne, pour l'affichage en liste. */
const SITES_DE_LA_DEPENSE = `
  (SELECT group_concat(s.nom, ' + ')
     FROM depense_sites x JOIN sites s ON s.id = x.site_id
    WHERE x.depense_id = d.id) AS sites_noms,
  (SELECT COUNT(*) FROM depense_sites WHERE depense_id = d.id) AS nb_sites`;

export function listerDepenses({ siteId = null, limite = 200 } = {}) {
  // Filtre par site: on renvoie en plus `part_cents`, la portion qui incombe a
  // CE site, qui n'est pas le montant total quand la depense est partagee.
  if (siteId) {
    return select(
      `SELECT d.*, f.nom AS fournisseur_nom, ds.part_cents, ${SITES_DE_LA_DEPENSE}
       FROM depenses d
       JOIN depense_sites ds ON ds.depense_id = d.id AND ds.site_id = $1
       LEFT JOIN fournisseurs f ON f.id = d.fournisseur_id
       ORDER BY d.date DESC, d.id DESC
       LIMIT $2`,
      [siteId, limite],
    );
  }

  return select(
    `SELECT d.*, f.nom AS fournisseur_nom, NULL AS part_cents, ${SITES_DE_LA_DEPENSE}
     FROM depenses d
     LEFT JOIN fournisseurs f ON f.id = d.fournisseur_id
     ORDER BY d.date DESC, d.id DESC
     LIMIT $1`,
    [limite],
  );
}

export async function ajouterDepense({
  siteIds = [],
  partsCents = null,
  fournisseurId,
  date,
  montantCents,
  devise = "EUR",
  libelle = "",
  categorie = "autre",
  source = "manuel",
  refExterne = null,
}) {
  // Les parts sont calculees et validees AVANT d'inserer la depense: sinon une
  // somme incoherente laisserait une ligne orpheline, rattachee a aucun site.
  const parts = partsPourSites(montantCents, siteIds, partsCents);

  const res = await execute(
    `INSERT INTO depenses
       (fournisseur_id, date, montant_cents, devise, libelle, categorie, source, ref_externe)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [fournisseurId, date, montantCents, devise, libelle, categorie, source, refExterne],
  );

  for (const { siteId, partCents } of parts) {
    await execute(
      "INSERT INTO depense_sites (depense_id, site_id, part_cents) VALUES ($1, $2, $3)",
      [res.lastInsertId, siteId, partCents],
    );
  }
  return res;
}

export function supprimerDepense(id) {
  return execute("DELETE FROM depenses WHERE id = $1", [id]);
}

/* -------------------------------------------------------------- revenus */

const SITES_DU_REVENU = `
  (SELECT group_concat(s.nom, ' + ')
     FROM revenu_sites x JOIN sites s ON s.id = x.site_id
    WHERE x.revenu_id = r.id) AS sites_noms,
  (SELECT COUNT(*) FROM revenu_sites WHERE revenu_id = r.id) AS nb_sites`;

export function listerRevenus({ limite = 200 } = {}) {
  return select(
    `SELECT r.*, ${SITES_DU_REVENU}
     FROM revenus r
     ORDER BY r.date DESC, r.id DESC LIMIT $1`,
    [limite],
  );
}

export async function ajouterRevenu({
  siteIds = [],
  partsCents = null,
  date,
  montantCents,
  devise = "EUR",
  libelle = "",
  source = "manuel",
}) {
  const parts = partsPourSites(montantCents, siteIds, partsCents);

  const res = await execute(
    `INSERT INTO revenus (date, montant_cents, devise, libelle, source)
     VALUES ($1, $2, $3, $4, $5)`,
    [date, montantCents, devise, libelle, source],
  );

  for (const { siteId, partCents } of parts) {
    await execute(
      "INSERT INTO revenu_sites (revenu_id, site_id, part_cents) VALUES ($1, $2, $3)",
      [res.lastInsertId, siteId, partCents],
    );
  }
  return res;
}

/* ---------------------------------------------------------- abonnements */

const SITES_DE_L_ABONNEMENT = `
  (SELECT group_concat(s.nom, ' + ')
     FROM abonnement_sites x JOIN sites s ON s.id = x.site_id
    WHERE x.abonnement_id = a.id) AS sites_noms,
  (SELECT COUNT(*) FROM abonnement_sites WHERE abonnement_id = a.id) AS nb_sites`;

/**
 * Tarif en vigueur aujourd'hui: le dernier dont la date d'entree en vigueur est
 * passee. C'est la seule source de verite du prix courant, `montant_cents`
 * ayant ete supprime de la table pour eviter deux verites concurrentes.
 */
const TARIF_COURANT = `
  (SELECT t.montant_cents FROM abonnement_tarifs t
    WHERE t.abonnement_id = a.id AND t.debut <= date('now', 'localtime')
    ORDER BY t.debut DESC, t.id DESC LIMIT 1) AS montant_cents`;

export function listerAbonnements() {
  return select(
    `SELECT a.*, f.nom AS fournisseur_nom, f.url AS fournisseur_url,
            f.favicon AS fournisseur_favicon,
            ${TARIF_COURANT}, ${SITES_DE_L_ABONNEMENT}
     FROM abonnements a
     LEFT JOIN fournisseurs f ON f.id = a.fournisseur_id
     ORDER BY a.actif DESC, a.prochaine_echeance IS NULL, a.prochaine_echeance`,
  );
}

/** Tous les tarifs, a regrouper par abonnement pour calculer les cumuls. */
export function listerTarifs() {
  return select("SELECT * FROM abonnement_tarifs ORDER BY abonnement_id, debut, id");
}

/**
 * Ajoute un tarif et reajuste les parts entre sites.
 *
 * Sans ce reajustement, les parts resteraient calculees sur l'ancien prix et la
 * somme des parts ne ferait plus le montant - les totaux par site deviendraient
 * silencieusement faux.
 */
export async function ajouterTarif(abonnementId, { debut, montantCents }) {
  await execute(
    "INSERT INTO abonnement_tarifs (abonnement_id, debut, montant_cents) VALUES ($1, $2, $3)",
    [abonnementId, debut, montantCents],
  );

  const parts = await select(
    "SELECT site_id, part_cents FROM abonnement_sites WHERE abonnement_id = $1 ORDER BY site_id",
    [abonnementId],
  );
  if (parts.length === 0) return;

  const nouvelles = redistribuer(
    parts.map((p) => p.part_cents),
    montantCents,
  );
  for (const [i, part] of parts.entries()) {
    await execute(
      "UPDATE abonnement_sites SET part_cents = $1 WHERE abonnement_id = $2 AND site_id = $3",
      [nouvelles[i], abonnementId, part.site_id],
    );
  }
}

export function supprimerTarif(id) {
  return execute("DELETE FROM abonnement_tarifs WHERE id = $1", [id]);
}

export async function ajouterAbonnement({
  siteIds = [],
  partsCents = null,
  fournisseurId,
  libelle,
  montantCents,
  devise = "EUR",
  periodicite = "mensuel",
  debut,
  prochaineEcheance = null,
}) {
  const parts = partsPourSites(montantCents, siteIds, partsCents);

  const res = await execute(
    `INSERT INTO abonnements
       (fournisseur_id, libelle, devise, periodicite, debut, prochaine_echeance)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [fournisseurId, libelle, devise, periodicite, debut, prochaineEcheance],
  );

  // Le prix de depart devient le premier tarif de l'historique
  await execute(
    "INSERT INTO abonnement_tarifs (abonnement_id, debut, montant_cents) VALUES ($1, $2, $3)",
    [res.lastInsertId, debut, montantCents],
  );

  for (const { siteId, partCents } of parts) {
    await execute(
      "INSERT INTO abonnement_sites (abonnement_id, site_id, part_cents) VALUES ($1, $2, $3)",
      [res.lastInsertId, siteId, partCents],
    );
  }
  return res;
}

export function basculerAbonnement(id, actif) {
  return execute("UPDATE abonnements SET actif = $1 WHERE id = $2", [actif ? 1 : 0, id]);
}

export function supprimerAbonnement(id) {
  return execute("DELETE FROM abonnements WHERE id = $1", [id]);
}

/* ------------------------------------------------------------ agregats */

/** Depenses et revenus agreges par mois, sur les n derniers mois. */
export function totauxParMois(nbMois = 12) {
  const depuis = `-${nbMois - 1} months`;
  return select(
    `SELECT mois, SUM(depense) AS depense_cents, SUM(revenu) AS revenu_cents FROM (
       SELECT substr(date, 1, 7) AS mois, montant_cents AS depense, 0 AS revenu FROM depenses
       UNION ALL
       SELECT substr(date, 1, 7) AS mois, 0 AS depense, montant_cents AS revenu FROM revenus
     )
     WHERE mois >= strftime('%Y-%m', date('now', 'start of month', $1))
     GROUP BY mois
     ORDER BY mois`,
    [depuis],
  );
}

/**
 * Depenses agregees par site sur une periode ('YYYY-MM-DD' incluse).
 * On somme les PARTS, pas les montants: une depense partagee entre deux sites
 * ne doit pas etre comptee deux fois en entier.
 */
export function depensesParSite(depuis, jusqua) {
  return select(
    `SELECT s.id, s.nom, s.couleur, COALESCE(SUM(p.part_cents), 0) AS total_cents
     FROM sites s
     LEFT JOIN (
       SELECT ds.site_id, ds.part_cents
       FROM depense_sites ds
       JOIN depenses d ON d.id = ds.depense_id
       WHERE d.date >= $1 AND d.date <= $2
     ) p ON p.site_id = s.id
     GROUP BY s.id
     ORDER BY total_cents DESC`,
    [depuis, jusqua],
  );
}


/** Totaux bruts sur une periode. */
export async function totauxPeriode(depuis, jusqua) {
  const [dep] = await select(
    "SELECT COALESCE(SUM(montant_cents), 0) AS total FROM depenses WHERE date >= $1 AND date <= $2",
    [depuis, jusqua],
  );
  const [rev] = await select(
    "SELECT COALESCE(SUM(montant_cents), 0) AS total FROM revenus WHERE date >= $1 AND date <= $2",
    [depuis, jusqua],
  );
  return { depensesCents: dep.total, revenusCents: rev.total };
}

/** Abonnements actifs a echeance dans les n prochains jours. */
export function echeancesProches(jours = 45) {
  return select(
    `SELECT a.*, f.nom AS fournisseur_nom, ${TARIF_COURANT}, ${SITES_DE_L_ABONNEMENT}
     FROM abonnements a
     LEFT JOIN fournisseurs f ON f.id = a.fournisseur_id
     WHERE a.actif = 1
       AND a.prochaine_echeance IS NOT NULL
       AND a.prochaine_echeance <= date('now', $1)
     ORDER BY a.prochaine_echeance`,
    [`+${jours} days`],
  );
}

/* -------------------------------------------------------- supervision */

export function listerChecks(siteId) {
  return select(
    `SELECT c.*,
            v.ok          AS dernier_ok,
            v.statut_http AS dernier_statut,
            v.latence_ms  AS derniere_latence,
            v.erreur      AS derniere_erreur,
            v.jours_restants AS derniers_jours,
            v.verifie_le  AS derniere_verif
     FROM checks c
     LEFT JOIN verifications v ON v.id = (
       SELECT id FROM verifications
       WHERE check_id = c.id
       ORDER BY verifie_le DESC, id DESC
       LIMIT 1
     )
     WHERE c.site_id = $1
     ORDER BY c.id`,
    [siteId],
  );
}

/** Les checks a executer a chaque cycle de supervision. */
export function checksActifs() {
  return select(
    `SELECT c.id, c.url, c.type, c.seuil_jours, c.statut_attendu, c.doit_contenir,
            c.libelle, s.nom AS site_nom
     FROM checks c
     JOIN sites s ON s.id = c.site_id
     WHERE c.actif = 1 AND s.actif = 1
     ORDER BY c.site_id, c.id`,
  );
}

export function creerCheck({
  siteId,
  libelle,
  url,
  type = "http",
  statutAttendu = null,
  doitContenir = null,
  seuilJours = null,
}) {
  return execute(
    `INSERT INTO checks (site_id, libelle, url, type, statut_attendu, doit_contenir, seuil_jours)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [siteId, libelle, url, type, statutAttendu, doitContenir || null, seuilJours],
  );
}

export function supprimerCheck(id) {
  return execute("DELETE FROM checks WHERE id = $1", [id]);
}

export function basculerCheck(id, actif) {
  return execute("UPDATE checks SET actif = $1 WHERE id = $2", [actif ? 1 : 0, id]);
}

export function enregistrerVerification(
  checkId,
  { ok, statut, latence_ms, erreur, jours_restants = null },
) {
  return execute(
    `INSERT INTO verifications (check_id, ok, statut_http, latence_ms, erreur, jours_restants)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [checkId, ok ? 1 : 0, statut ?? null, latence_ms ?? null, erreur ?? null, jours_restants],
  );
}

/**
 * Etat courant de chaque site: on ne regarde que le DERNIER resultat de chaque
 * check actif, pas tout l'historique.
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
     LEFT JOIN checks c ON c.site_id = s.id AND c.actif = 1
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

/** Historique d'un site, tous checks confondus, pour le graphe de latence. */
export function historiqueSite(siteId, heures = 24) {
  return select(
    `SELECT v.verifie_le, v.ok, v.latence_ms, v.statut_http, v.erreur, c.libelle AS check_libelle
     FROM verifications v
     JOIN checks c ON c.id = v.check_id
     WHERE c.site_id = $1 AND v.verifie_le >= datetime('now', 'localtime', $2)
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
