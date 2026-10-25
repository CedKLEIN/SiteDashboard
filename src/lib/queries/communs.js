import { select } from "../db";

/**
 * Morceaux de requetes partages entre plusieurs fichiers de `queries/`.
 * Internes : `queries.js` ne les reexporte pas.
 */

/**
 * Verifie que tous les sites vises existent encore.
 *
 * Sans ce controle, l'INSERT parent passe et c'est le rattachement qui echoue
 * sur la cle etrangere: on se retrouve avec une ligne orpheline, rattachee a
 * aucun site, et un message SQLite brut ("code 787") incomprehensible.
 * Ces ecritures ne sont pas dans une transaction - le pool de connexions rend
 * un BEGIN/COMMIT manuel peu fiable - donc on valide AVANT d'ecrire.
 */
export async function verifierSitesExistants(siteIds) {
  if (siteIds.length === 0) return;

  const lignes = await select(
    `SELECT id FROM sites WHERE id IN (${siteIds.map((_, i) => `$${i + 1}`).join(", ")})`,
    siteIds,
  );
  const connus = new Set(lignes.map((l) => l.id));
  const inconnus = siteIds.filter((id) => !connus.has(id));

  if (inconnus.length > 0) {
    throw new Error(
      inconnus.length === siteIds.length
        ? "Aucun des sites selectionnes n'existe encore : recree-les dans l'onglet Sites."
        : `${inconnus.length} site(s) selectionne(s) n'existent plus : reselectionne les sites.`,
    );
  }
}

export const SITES_DE_L_ABONNEMENT = `
  (SELECT group_concat(s.nom, ' + ')
     FROM abonnement_sites x JOIN sites s ON s.id = x.site_id
    WHERE x.abonnement_id = a.id) AS sites_noms,
  (SELECT COUNT(*) FROM abonnement_sites WHERE abonnement_id = a.id) AS nb_sites`;

/**
 * Tarif en vigueur aujourd'hui: le dernier dont la date d'entree en vigueur est
 * passee. C'est la seule source de verite du prix courant, `montant_cents`
 * ayant ete supprime de la table pour eviter deux verites concurrentes.
 */
export const TARIF_COURANT = `
  (SELECT t.montant_cents FROM abonnement_tarifs t
    WHERE t.abonnement_id = a.id AND t.debut <= date('now', 'localtime')
    ORDER BY t.debut DESC, t.id DESC LIMIT 1) AS montant_cents`;
