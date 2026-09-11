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

/** Associe a chaque id de site sa part en centimes, a parts egales. */
export function repartirEntreSites(montantCents, siteIds) {
  const parts = repartir(montantCents, siteIds.length);
  return siteIds.map((siteId, i) => ({ siteId, partCents: parts[i] }));
}

/**
 * Parts definitives a enregistrer: egales par defaut, ou celles saisies a la main.
 *
 * La verification de la somme est faite ICI, au moment de l'ecriture, et pas
 * seulement dans le formulaire: c'est le seul passage oblige. Une part saisie
 * de travers qui passerait a travers l'UI donnerait des totaux par site
 * silencieusement faux, le pire des bugs sur une appli de comptes.
 */
export function partsPourSites(montantCents, siteIds, partsCents = null) {
  if (partsCents == null) return repartirEntreSites(montantCents, siteIds);

  if (partsCents.length !== siteIds.length) {
    throw new Error(
      `${partsCents.length} part(s) fournie(s) pour ${siteIds.length} site(s)`,
    );
  }
  if (partsCents.some((p) => !Number.isInteger(p))) {
    throw new TypeError("les parts doivent etre des centimes entiers");
  }

  const somme = partsCents.reduce((total, p) => total + p, 0);
  if (somme !== montantCents) {
    throw new Error(
      `la somme des parts (${somme} centimes) doit faire exactement ${montantCents} centimes`,
    );
  }

  return siteIds.map((siteId, i) => ({ siteId, partCents: partsCents[i] }));
}
