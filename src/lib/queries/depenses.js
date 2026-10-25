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
  // Tout est valide AVANT d'inserer la depense: une somme incoherente ou un
  // site disparu laisserait sinon une ligne orpheline, rattachee a aucun site.
  await verifierSitesExistants(siteIds);
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
