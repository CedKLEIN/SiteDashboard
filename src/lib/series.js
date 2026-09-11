import { moisEntre, moisLisible } from "./format";

/**
 * Construit la serie mensuelle affichee: montants du mois et cumuls.
 *
 * Les cumuls sont calcules ici plutot que dans le composant: accumuler pendant
 * le rendu produirait des totaux differents a chaque re-rendu, et c'est le
 * genre d'erreur qui donne des chiffres faux sans rien casser visiblement.
 */
export function construireSerie({ debut, fin, parMois, aboParMois }) {
  const moisDebut = debut.slice(0, 7);
  const moisFin = fin.slice(0, 7);

  let cumulDepenses = 0;
  let cumulRevenus = 0;

  const points = moisEntre(debut, fin).map((m) => {
    const ligne = parMois.get(m);
    const depenses = ligne?.depense_cents ?? 0;
    // Les abonnements sont calcules sur tout l'historique: on ne retient que
    // les mois de la periode affichee.
    const abonnements = m >= moisDebut && m <= moisFin ? (aboParMois.get(m) ?? 0) : 0;
    const revenus = ligne?.revenu_cents ?? 0;

    cumulDepenses += depenses + abonnements;
    cumulRevenus += revenus;

    return {
      mois: moisLisible(m),
      depenses: depenses / 100,
      abonnements: abonnements / 100,
      revenus: revenus / 100,
      cumulDepenses: cumulDepenses / 100,
      cumulRevenus: cumulRevenus / 100,
    };
  });

  return {
    points,
    totalDepensesCents: cumulDepenses,
    totalRevenusCents: cumulRevenus,
    totalAbonnementsCents: points.reduce((t, p) => t + Math.round(p.abonnements * 100), 0),
  };
}
