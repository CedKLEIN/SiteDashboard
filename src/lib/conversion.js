import { invoke } from "@tauri-apps/api/core";
import { DEVISE_REFERENCE, versReference } from "./devises";
import { redistribuer } from "./repartition";

/**
 * Montant saisi -> montant en euros, au taux DU JOUR de l'operation (pas du jour
 * de la saisie) : une ecriture passee ne doit pas changer de valeur parce qu'on
 * la consulte plus tard. Leve une erreur lisible si le taux est indisponible.
 */
export async function convertirVersReference({ montantCents, devise, date }) {
  let taux = 1;
  if (devise !== DEVISE_REFERENCE) {
    try {
      taux = await invoke("taux_change", { date, de: devise, vers: DEVISE_REFERENCE });
    } catch (e) {
      throw new Error(`Taux de change indisponible (${e}). Réessaie ou saisis en euros.`, { cause: e });
    }
  }
  const montantEurCents = versReference(montantCents, taux);
  if (montantEurCents === null) throw new Error("Taux de change invalide.");
  return { taux, montantEurCents };
}

/**
 * Parts saisies dans la devise de l'operation -> parts en euros.
 *
 * Les parts se saisissent sur le montant affiche (en dollars pour une facture
 * en dollars) mais s'enregistrent en euros : sans cette conversion, des parts
 * en dollars ne tombaient jamais sur le total converti et l'ecriture etait
 * refusee. Les proportions sont conservees au centime pres.
 */
export function partsEnReference(partsCents, montantCents, montantEurCents) {
  if (partsCents == null || montantEurCents === montantCents) return partsCents;
  const somme = partsCents.reduce((total, p) => total + p, 0);
  if (somme !== montantCents) {
    throw new Error("La somme des parts doit faire exactement le montant saisi.");
  }
  return redistribuer(partsCents, montantEurCents);
}
