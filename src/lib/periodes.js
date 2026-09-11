/**
 * Periodes predefinies du tableau de bord.
 *
 * Des boutons plutot qu'un selecteur de dates: on consulte un tableau de bord
 * pour repondre a "ou j'en suis cette annee", pas pour interroger une plage
 * arbitraire. Saisir deux dates a chaque fois serait du travail pour rien.
 */
export const PERIODES = [
  { cle: "mois", libelle: "Ce mois" },
  { cle: "annee", libelle: "Cette annee" },
  { cle: "12mois", libelle: "12 derniers mois" },
  { cle: "annee_precedente", libelle: "Annee derniere" },
  { cle: "toujours", libelle: "Depuis toujours" },
];

export const PERIODE_DEFAUT = "annee";

/** Borne basse conventionnelle: anterieure a toute donnee saisissable. */
const AUBE = "0001-01-01";

function iso(annee, mois, jour) {
  return `${String(annee).padStart(4, "0")}-${String(mois).padStart(2, "0")}-${String(
    jour,
  ).padStart(2, "0")}`;
}

function dernierJour(annee, mois) {
  return new Date(annee, mois, 0).getDate();
}

/**
 * Bornes ISO incluses d'une periode. `aujourdhui` est injecte pour que les
 * tests ne dependent pas de la date d'execution.
 */
export function bornesPeriode(cle, aujourdhui) {
  const [annee, mois] = aujourdhui.split("-").map(Number);

  switch (cle) {
    case "mois":
      return { debut: iso(annee, mois, 1), fin: iso(annee, mois, dernierJour(annee, mois)) };

    case "annee":
      return { debut: iso(annee, 1, 1), fin: iso(annee, 12, 31) };

    case "annee_precedente":
      return { debut: iso(annee - 1, 1, 1), fin: iso(annee - 1, 12, 31) };

    case "12mois": {
      // 12 mois glissants: on part du 1er du mois, onze mois en arriere, pour
      // que le graphe affiche douze barres completes et non onze et demie.
      const depart = new Date(annee, mois - 12, 1);
      return {
        debut: iso(depart.getFullYear(), depart.getMonth() + 1, 1),
        fin: iso(annee, mois, dernierJour(annee, mois)),
      };
    }

    case "toujours":
      return { debut: AUBE, fin: iso(annee, 12, 31) };

    default:
      return bornesPeriode(PERIODE_DEFAUT, aujourdhui);
  }
}

export function libellePeriode(cle) {
  return PERIODES.find((p) => p.cle === cle)?.libelle ?? cle;
}
