/** Categories de depense : la cle est stockee en base, le libelle est affiche. */
export const CATEGORIES = [
  { cle: "hebergement", libelle: "Hébergement" },
  { cle: "domaine", libelle: "Domaine" },
  { cle: "api", libelle: "API" },
  { cle: "saas", libelle: "SaaS" },
  { cle: "marketing", libelle: "Marketing" },
  { cle: "autre", libelle: "Autre" },
];

/** 'hebergement' -> 'Hébergement' ; une cle inconnue est rendue telle quelle. */
export function libelleCategorie(cle) {
  return CATEGORIES.find((c) => c.cle === cle)?.libelle ?? cle;
}
