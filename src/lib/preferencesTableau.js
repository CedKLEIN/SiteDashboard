import { PERIODES, PERIODE_DEFAUT } from "./periodes";

export const CLE_PERIODE = "tableau_periode";
export const CLE_SITE = "tableau_site";

/**
 * Valide une periode relue depuis les preferences.
 *
 * Une valeur enregistree par une version anterieure, ou un libelle renomme
 * depuis, ne doit pas laisser le tableau de bord sur une periode inexistante:
 * on retombe sur le defaut plutot que d'afficher une page vide.
 */
export function periodeValide(cle) {
  return PERIODES.some((p) => p.cle === cle) ? cle : PERIODE_DEFAUT;
}

/**
 * Valide un filtre de site relu depuis les preferences.
 *
 * Le site memorise a pu etre supprime entre-temps. Le rappeler filtrerait le
 * tableau de bord sur un identifiant fantome: aucun chiffre, et rien pour
 * comprendre pourquoi. On revient donc a "tous les sites".
 */
export function siteValide(valeurStockee, sites) {
  if (valeurStockee === null || valeurStockee === undefined || valeurStockee === "") return null;

  const id = Number(valeurStockee);
  if (!Number.isInteger(id)) return null;

  return sites.some((s) => s.id === id) ? id : null;
}

/** Valeur a ecrire en preference: la chaine vide represente "tous les sites". */
export function siteEnPreference(siteId) {
  return siteId === null || siteId === undefined ? "" : String(siteId);
}
