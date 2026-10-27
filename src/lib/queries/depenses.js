import { execute, select } from "../db";
import { partsPourSites } from "../repartition";
import { verifierSitesExistants } from "./communs";

/* ------------------------------------------------------------- depenses */

/** Noms des sites concernes, en une colonne, pour l'affichage en liste. */
const SITES_DE_LA_DEPENSE = `
  (SELECT group_concat(s.nom, ' + ')
     FROM depense_sites x JOIN sites s ON s.id = x.site_id
    WHERE x.depense_id = d.id) AS sites_noms,
  (SELECT COUNT(*) FROM depense_sites WHERE depense_id = d.id) AS nb_sites`;

export function listerDepenses({ siteId = null, limite = 200, depuis = null, jusqua = null } = {}) {
  // Filtre par site: on renvoie en plus `part_cents`, la portion qui incombe a
  // CE site, qui n'est pas le montant total quand la depense est partagee.
  if (siteId) {
    return select(
      `SELECT d.*, f.nom AS fournisseur_nom, f.favicon AS fournisseur_favicon, ds.part_cents, ${SITES_DE_LA_DEPENSE}
       FROM depenses d
       JOIN depense_sites ds ON ds.depense_id = d.id AND ds.site_id = $1
       LEFT JOIN fournisseurs f ON f.id = d.fournisseur_id
       WHERE ($3 IS NULL OR d.date >= $3) AND ($4 IS NULL OR d.date <= $4)
       ORDER BY d.date DESC, d.id DESC
       LIMIT $2`,
      [siteId, limite, depuis, jusqua],
    );
  }

  return select(
    `SELECT d.*, f.nom AS fournisseur_nom, f.favicon AS fournisseur_favicon, NULL AS part_cents, ${SITES_DE_LA_DEPENSE}
     FROM depenses d
     LEFT JOIN fournisseurs f ON f.id = d.fournisseur_id
     WHERE ($2 IS NULL OR d.date >= $2) AND ($3 IS NULL OR d.date <= $3)
     ORDER BY d.date DESC, d.id DESC
     LIMIT $1`,
    [limite, depuis, jusqua],
  );
}

export async function ajouterDepense({
  siteIds = [],
  partsCents = null,
  fournisseurId,
  date,
  montantCents,
  devise = "EUR",
  taux = 1,
  montantEurCents = null,
  libelle = "",
  categorie = "autre",
  source = "manuel",
  refExterne = null,
}) {
  // Tout est valide AVANT d'inserer la depense: une somme incoherente ou un
  // site disparu laisserait sinon une ligne orpheline, rattachee a aucun site.
  // Les parts sont en euros, comme pour les revenus.
  const montantRef = montantEurCents ?? montantCents;
  await verifierSitesExistants(siteIds);
  const parts = partsPourSites(montantRef, siteIds, partsCents);

  const res = await execute(
    `INSERT INTO depenses
       (fournisseur_id, date, montant_cents, devise, taux, montant_eur_cents, libelle, categorie,
        source, ref_externe)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [fournisseurId, date, montantCents, devise, taux, montantRef, libelle, categorie, source, refExterne],
  );

  await ecrireParts(res.lastInsertId, parts);
  return res;
}

async function ecrireParts(depenseId, parts) {
  for (const { siteId, partCents } of parts) {
    await execute(
      "INSERT INTO depense_sites (depense_id, site_id, part_cents) VALUES ($1, $2, $3)",
      [depenseId, siteId, partCents],
    );
  }
}

/** Sites d'une depense et leur part, pour rouvrir le formulaire en edition. */
export function partsDepense(id) {
  return select("SELECT site_id, part_cents FROM depense_sites WHERE depense_id = $1", [id]);
}

/**
 * Corrige une depense. Les parts sont recalculees sur le nouveau montant et
 * reecrites en entier : les garder sur l'ancien montant casserait l'invariant
 * "somme des parts = montant".
 */
export async function majDepense(
  id,
  {
    siteIds = [],
    partsCents = null,
    fournisseurId,
    date,
    montantCents,
    devise = "EUR",
    taux = 1,
    montantEurCents = null,
    libelle = "",
    categorie = "autre",
  },
) {
  const montantRef = montantEurCents ?? montantCents;
  await verifierSitesExistants(siteIds);
  const parts = partsPourSites(montantRef, siteIds, partsCents);

  await execute(
    `UPDATE depenses
        SET fournisseur_id = $1, date = $2, montant_cents = $3, devise = $4, taux = $5,
            montant_eur_cents = $6, libelle = $7, categorie = $8
      WHERE id = $9`,
    [fournisseurId, date, montantCents, devise, taux, montantRef, libelle, categorie, id],
  );
  await execute("DELETE FROM depense_sites WHERE depense_id = $1", [id]);
  await ecrireParts(id, parts);
}

export function supprimerDepense(id) {
  return execute("DELETE FROM depenses WHERE id = $1", [id]);
}

/** Nombre de depenses (d'un site, d'une periode au besoin) : l'historique est pagine. */
export async function compterDepenses({ siteId = null, depuis = null, jusqua = null } = {}) {
  const [ligne] = await select(
    `SELECT COUNT(*) AS n FROM depenses d
     WHERE ($1 IS NULL OR EXISTS (SELECT 1 FROM depense_sites x WHERE x.depense_id = d.id AND x.site_id = $1))
       AND ($2 IS NULL OR d.date >= $2) AND ($3 IS NULL OR d.date <= $3)`,
    [siteId, depuis, jusqua],
  );
  return ligne?.n ?? 0;
}
