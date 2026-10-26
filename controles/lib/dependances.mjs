/**
 * Vulnerabilites npm, lues dans `npm audit --json` : partage entre l'audit
 * hebdomadaire (qui les signale et demande un correctif) et la tache
 * « Correctifs de dependances » (qui les corrige).
 */

const GRAVES = new Set(["high", "critical"]);

/**
 * [{ nom, gravite, plage, correctif }] ; correctif : « compatible » (npm audit fix
 * suffit), « majeur » (il faudrait --force, donc une version majeure) ou « aucun ».
 */
export function vulnerabilites(audit) {
  return Object.entries(audit?.vulnerabilities ?? {}).map(([nom, d]) => {
    const fix = d.fixAvailable;
    const correctif = fix === true ? "compatible" : fix && typeof fix === "object" ? (fix.isSemVerMajor ? "majeur" : "compatible") : "aucun";
    return { nom, gravite: d.severity, plage: d.range ?? "", correctif };
  });
}

export const grave = (v) => GRAVES.has(v.gravite);

/**
 * Ce qui justifie de lancer le correctif : les vulnerabilites hautes ou critiques
 * corrigeables sans version majeure. Vide : rien a demander. La meme liste a une
 * semaine d'ecart donne la meme signature : le correctif n'est pas relance pour
 * ce qu'il a deja tente.
 */
export function signatureCorrectifs(vulns) {
  return vulns
    .filter((v) => grave(v) && v.correctif === "compatible")
    .map((v) => `${v.nom}@${v.plage}`)
    .sort()
    .join(",");
}
