import { execute, select } from "../db";
import { partsPourSites, redistribuer } from "../repartition";
import { SITES_DE_L_ABONNEMENT, TARIF_COURANT, verifierSitesExistants } from "./communs";

/* ---------------------------------------------------------- abonnements */

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

/** Toutes les parts d'abonnements, pour imputer les prelevements aux sites. */
export function listerPartsAbonnements() {
  return select("SELECT * FROM abonnement_sites ORDER BY abonnement_id, site_id");
}

/** Tous les tarifs, a regrouper par abonnement pour calculer les cumuls. */
export function listerTarifs() {
  return select("SELECT * FROM abonnement_tarifs ORDER BY abonnement_id, debut, id");
}

/**
 * Reajuste les parts entre sites sur le tarif courant, en conservant leurs
 * proportions.
 *
 * Appele apres TOUTE modification de l'historique - ajout, correction ou
 * suppression - parce que chacune peut changer le prix en vigueur. Sans ca les
 * parts resteraient calculees sur un ancien prix et leur somme ne ferait plus
 * le montant: les totaux par site deviendraient silencieusement faux.
 */
async function recalculerParts(abonnementId) {
  const [courant] = await select(
    `SELECT montant_cents FROM abonnement_tarifs
      WHERE abonnement_id = $1 AND debut <= date('now', 'localtime')
      ORDER BY debut DESC, id DESC LIMIT 1`,
    [abonnementId],
  );
  if (!courant) return;

  const parts = await select(
    "SELECT site_id, part_cents FROM abonnement_sites WHERE abonnement_id = $1 ORDER BY site_id",
    [abonnementId],
  );
  if (parts.length === 0) return;

  const nouvelles = redistribuer(
    parts.map((p) => p.part_cents),
    courant.montant_cents,
  );
  for (const [i, part] of parts.entries()) {
    await execute(
      "UPDATE abonnement_sites SET part_cents = $1 WHERE abonnement_id = $2 AND site_id = $3",
      [nouvelles[i], abonnementId, part.site_id],
    );
  }
}

export async function ajouterTarif(abonnementId, { debut, montantCents }) {
  await execute(
    "INSERT INTO abonnement_tarifs (abonnement_id, debut, montant_cents) VALUES ($1, $2, $3)",
    [abonnementId, debut, montantCents],
  );
  await recalculerParts(abonnementId);
}

/** Corrige un tarif existant: une date de depart ou un montant saisi de travers. */
export async function majTarif(id, { debut, montantCents }) {
  const [tarif] = await select("SELECT abonnement_id FROM abonnement_tarifs WHERE id = $1", [id]);
  if (!tarif) return;

  await execute(
    "UPDATE abonnement_tarifs SET debut = $1, montant_cents = $2 WHERE id = $3",
    [debut, montantCents, id],
  );
  await recalculerParts(tarif.abonnement_id);
}

export async function supprimerTarif(id) {
  const [tarif] = await select("SELECT abonnement_id FROM abonnement_tarifs WHERE id = $1", [id]);
  await execute("DELETE FROM abonnement_tarifs WHERE id = $1", [id]);
  if (tarif) await recalculerParts(tarif.abonnement_id);
}

/**
 * Modifie un abonnement. Les sites sont remplaces en bloc: on ne sait pas quels
 * rattachements ont ete retires, et une mise a jour partielle laisserait des
 * parts orphelines dont la somme ne ferait plus le montant.
 */
export async function majAbonnement(
  id,
  {
    fournisseurId,
    libelle,
    periodicite,
    debut,
    fin = null,
    prochaineEcheance,
    siteIds = [],
    partsCents = null,
  },
) {
  const [courant] = await select(
    `SELECT montant_cents FROM abonnement_tarifs
      WHERE abonnement_id = $1 AND debut <= date('now', 'localtime')
      ORDER BY debut DESC, id DESC LIMIT 1`,
    [id],
  );
  const montantCents = courant?.montant_cents ?? 0;

  // Valide avant d'ecrire: une repartition refusee ne doit rien laisser a moitie fait
  await verifierSitesExistants(siteIds);
  const parts = partsPourSites(montantCents, siteIds, partsCents);

  await execute(
    `UPDATE abonnements
        SET fournisseur_id = $1, libelle = $2, periodicite = $3, debut = $4,
            fin = $5, prochaine_echeance = $6, actif = $7
      WHERE id = $8`,
    // `actif` suit `fin`: une date de fin corrigee a la main ne doit pas laisser
    // un abonnement affiche comme actif alors qu'il ne court plus.
    [fournisseurId, libelle, periodicite, debut, fin, prochaineEcheance, fin ? 0 : 1, id],
  );

  await execute("DELETE FROM abonnement_sites WHERE abonnement_id = $1", [id]);
  for (const { siteId, partCents } of parts) {
    await execute(
      "INSERT INTO abonnement_sites (abonnement_id, site_id, part_cents) VALUES ($1, $2, $3)",
      [id, siteId, partCents],
    );
  }
}

/** Les sites rattaches a un abonnement, avec leur part, pour pre-remplir l'edition. */
export function partsAbonnement(id) {
  return select(
    "SELECT site_id, part_cents FROM abonnement_sites WHERE abonnement_id = $1 ORDER BY site_id",
    [id],
  );
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
  await verifierSitesExistants(siteIds);
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

/**
 * Arrete un abonnement a une date donnee.
 *
 * `fin` et `actif` sont ecrits ENSEMBLE et jamais separement: les graphes se
 * basent sur `fin` et l'affichage sur `actif`. Les laisser diverger donnerait
 * une case decochee pendant que les montants continuent de monter - on croirait
 * avoir arrete, et les chiffres diraient le contraire.
 *
 * Les echeances anterieures a `fin` restent comptees: ce qui a ete paye l'a ete.
 */
export function arreterAbonnement(id, fin) {
  return execute("UPDATE abonnements SET fin = $1, actif = 0 WHERE id = $2", [fin, id]);
}

/** Reprend un abonnement arrete: la date de fin est effacee. */
export function reprendreAbonnement(id) {
  return execute("UPDATE abonnements SET fin = NULL, actif = 1 WHERE id = $1", [id]);
}

export function supprimerAbonnement(id) {
  return execute("DELETE FROM abonnements WHERE id = $1", [id]);
}
