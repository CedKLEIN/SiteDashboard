import { execute, select } from "../db";
import { partsPourSites } from "../repartition";
import { verifierSitesExistants } from "./communs";

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

/** Revenus d'un site, avec la part qui lui revient (en devise de reference). */
export function revenusDuSite(siteId, limite = 8) {
  return select(
    `SELECT r.*, rs.part_cents, ${SITES_DU_REVENU}
     FROM revenus r
     JOIN revenu_sites rs ON rs.revenu_id = r.id AND rs.site_id = $1
     ORDER BY r.date DESC, r.id DESC LIMIT $2`,
    [siteId, limite],
  );
}

export async function ajouterRevenu({
  siteIds = [],
  partsCents = null,
  date,
  montantCents,
  devise = "EUR",
  taux = 1,
  montantEurCents = null,
  libelle = "",
  source = "manuel",
  refExterne = null,
}) {
  // Les parts sont exprimees dans la devise de reference: c'est elle qui sert a
  // tous les cumuls par site, additionner des dollars et des euros n'aurait
  // aucun sens.
  const montantRef = montantEurCents ?? montantCents;
  await verifierSitesExistants(siteIds);
  const parts = partsPourSites(montantRef, siteIds, partsCents);

  const res = await execute(
    `INSERT INTO revenus
       (date, montant_cents, devise, taux, montant_eur_cents, libelle, source, ref_externe)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [date, montantCents, devise, taux, montantRef, libelle, source, refExterne],
  );

  await ecrireParts(res.lastInsertId, parts);
  return res;
}

async function ecrireParts(revenuId, parts) {
  for (const { siteId, partCents } of parts) {
    await execute(
      "INSERT INTO revenu_sites (revenu_id, site_id, part_cents) VALUES ($1, $2, $3)",
      [revenuId, siteId, partCents],
    );
  }
}

/** Sites d'un revenu et leur part, pour rouvrir le formulaire en edition. */
export function partsRevenu(id) {
  return select("SELECT site_id, part_cents FROM revenu_sites WHERE revenu_id = $1", [id]);
}

/** Corrige un revenu ; les parts sont recalculees sur le nouveau montant (en euros). */
export async function majRevenu(
  id,
  { siteIds = [], partsCents = null, date, montantCents, devise = "EUR", taux = 1, montantEurCents = null, libelle = "" },
) {
  const montantRef = montantEurCents ?? montantCents;
  await verifierSitesExistants(siteIds);
  const parts = partsPourSites(montantRef, siteIds, partsCents);

  await execute(
    `UPDATE revenus
        SET date = $1, montant_cents = $2, devise = $3, taux = $4, montant_eur_cents = $5, libelle = $6
      WHERE id = $7`,
    [date, montantCents, devise, taux, montantRef, libelle, id],
  );
  await execute("DELETE FROM revenu_sites WHERE revenu_id = $1", [id]);
  await ecrireParts(id, parts);
}

export function supprimerRevenu(id) {
  return execute("DELETE FROM revenus WHERE id = $1", [id]);
}

/** Nombre total de revenus : l'historique est pagine. */
export async function compterRevenus() {
  const [ligne] = await select("SELECT COUNT(*) AS n FROM revenus");
  return ligne?.n ?? 0;
}
