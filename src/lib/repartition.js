/**
 * Repartit un montant entre plusieurs sites, en centimes entiers.
 *
 * Le reste de la division est distribue un centime a la fois aux premiers sites,
 * pour que la somme des parts soit TOUJOURS egale au montant d'origine.
 * Un simple `montant / nb` arrondi a l'affichage ferait disparaitre des centimes:
 * 11,00 EUR sur 3 sites donnerait 3 x 3,67 = 11,01, ou 3 x 3,66 = 10,98.
 */
export function repartir(montantCents, nbSites) {
  if (!Number.isInteger(montantCents)) {
    throw new TypeError("repartir attend un montant en centimes entiers");
  }
  if (nbSites <= 0) return [];

  const base = Math.trunc(montantCents / nbSites);
  const reste = montantCents - base * nbSites;

  return Array.from({ length: nbSites }, (_, i) => base + (i < reste ? 1 : 0));
}

/** Associe a chaque id de site sa part en centimes. */
export function repartirEntreSites(montantCents, siteIds) {
  const parts = repartir(montantCents, siteIds.length);
  return siteIds.map((siteId, i) => ({ siteId, partCents: parts[i] }));
}
