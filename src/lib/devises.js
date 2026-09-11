/**
 * Conversion des montants en devise etrangere.
 *
 * La devise de reference est l'euro: tous les cumuls et graphiques y sont
 * ramenes, sinon additionner des euros et des dollars donnerait un nombre qui
 * ne veut rien dire.
 */
export const DEVISE_REFERENCE = "EUR";

export const DEVISES = [
  { code: "EUR", symbole: "€" },
  { code: "USD", symbole: "$" },
];

/**
 * Convertit un montant en centimes vers la devise de reference.
 *
 * L'arrondi se fait une seule fois, a la fin: arrondir le taux puis multiplier
 * ferait deriver les gros montants.
 */
export function versReference(montantCents, taux) {
  if (!Number.isFinite(taux) || taux <= 0) return null;
  return Math.round(montantCents * taux);
}

/** Formate un montant dans sa propre devise. */
export function formatDevise(cents, devise = DEVISE_REFERENCE) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: devise,
    maximumFractionDigits: 2,
  }).format((cents ?? 0) / 100);
}

/**
 * Texte affiche a cote d'un revenu en devise etrangere.
 * Renvoie null pour un montant deja en euros: afficher "50,00 € = 50,00 €"
 * serait du bruit.
 */
export function mentionConversion(ligne) {
  if (!ligne || ligne.devise === DEVISE_REFERENCE) return null;
  return `${formatDevise(ligne.montant_cents, ligne.devise)} au taux de ${ligne.taux}`;
}
