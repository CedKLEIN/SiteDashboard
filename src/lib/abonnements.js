import { redistribuer } from "./repartition";

/**
 * Calculs sur les abonnements: echeances passees, tarif en vigueur, cumul paye.
 *
 * Tout est ici en fonctions pures pour etre testable: une erreur sur les dates
 * ne se voit pas a l'oeil nu, elle se traduit juste par un total legerement
 * faux qu'on ne remarque jamais.
 */

/** Ajoute n mois a une date ISO en bornant au dernier jour du mois cible. */
export function ajouterMois(dateIso, n) {
  const [annee, mois, jour] = dateIso.split("-").map(Number);
  const cible = new Date(annee, mois - 1 + n, 1);
  // Le 31 janvier + 1 mois n'existe pas: on borne au 28/29 fevrier plutot que
  // de deborder sur mars, ce que ferait un setMonth naif.
  const dernierJour = new Date(cible.getFullYear(), cible.getMonth() + 1, 0).getDate();
  const jourBorne = Math.min(jour, dernierJour);
  return `${cible.getFullYear()}-${String(cible.getMonth() + 1).padStart(2, "0")}-${String(
    jourBorne,
  ).padStart(2, "0")}`;
}

const PAS = { mensuel: 1, annuel: 12 };

/**
 * Dates de tous les prelevements deja survenus, du debut jusqu'a aujourd'hui inclus.
 * Le premier paiement compte: on paie a la souscription, pas un mois apres.
 */
export function echeancesPassees(debut, periodicite, aujourdhui) {
  if (!debut || !aujourdhui || debut > aujourdhui) return [];

  const pas = PAS[periodicite] ?? PAS.mensuel;
  const dates = [];
  for (let i = 0; ; i += 1) {
    const date = ajouterMois(debut, i * pas);
    if (date > aujourdhui) break;
    dates.push(date);
    // Garde-fou: une periodicite inconnue ou une date aberrante ne doit pas
    // faire tourner la boucle indefiniment.
    if (dates.length > 2000) break;
  }
  return dates;
}

/** Tarif en vigueur a une date donnee: le dernier dont le debut precede cette date. */
export function tarifApplicable(tarifs, date) {
  const candidats = tarifs
    .filter((t) => t.debut <= date)
    .sort((a, b) => (a.debut < b.debut ? -1 : a.debut > b.debut ? 1 : 0));

  if (candidats.length > 0) return candidats[candidats.length - 1].montant_cents;

  // Avant le premier tarif connu: on applique le plus ancien plutot que zero,
  // sinon une reprise de donnees incomplete ferait disparaitre des paiements.
  const parDate = [...tarifs].sort((a, b) => (a.debut < b.debut ? -1 : 1));
  return parDate[0]?.montant_cents ?? 0;
}

/** Total reellement paye depuis le debut, tarif par tarif. */
export function totalPaye({ debut, periodicite }, tarifs, aujourdhui) {
  if (!tarifs || tarifs.length === 0) return 0;
  return echeancesPassees(debut, periodicite, aujourdhui).reduce(
    (total, date) => total + tarifApplicable(tarifs, date),
    0,
  );
}

/** Cout mensuel equivalent du tarif courant, pour comparer mensuel et annuel. */
export function coutMensuelEquivalent({ montant_cents, periodicite }) {
  if (periodicite === "annuel") return Math.round((montant_cents ?? 0) / 12);
  return montant_cents ?? 0;
}

/** Prochaine echeance deduite du debut et de la periodicite. */
export function prochaineEcheance(debut, periodicite, aujourdhui) {
  if (!debut) return null;
  const passees = echeancesPassees(debut, periodicite, aujourdhui);
  const pas = PAS[periodicite] ?? PAS.mensuel;
  if (passees.length === 0) return debut;
  return ajouterMois(debut, passees.length * pas);
}

/**
 * Borne haute des prelevements d'un abonnement: sa date de fin s'il est resilie,
 * sinon aujourd'hui. Le drapeau `actif` ne suffit pas: il dit QUE c'est arrete,
 * pas QUAND, et l'exclure ferait disparaitre ses paiements passes du cumul.
 */
function jusqua(abonnement, aujourdhui) {
  const fin = abonnement.fin;
  return fin && fin < aujourdhui ? fin : aujourdhui;
}

/**
 * Prelevements d'abonnements, regroupes par mois ('YYYY-MM' -> centimes).
 *
 * Avec `siteId`, on ne compte que la part de ce site: un abonnement partage ne
 * doit pas apparaitre en entier dans les chiffres d'un seul site.
 */
export function abonnementsParMois(
  abonnements,
  tarifs,
  aujourdhui,
  { parts = [], siteId = null } = {},
) {
  const parMois = new Map();

  for (const abonnement of abonnements) {
    const sesTarifs = tarifs.filter((t) => t.abonnement_id === abonnement.id);
    if (sesTarifs.length === 0) continue;

    const sesParts = parts.filter((p) => p.abonnement_id === abonnement.id);
    if (siteId && !sesParts.some((p) => p.site_id === siteId)) continue;

    for (const date of echeancesPassees(
      abonnement.debut,
      abonnement.periodicite,
      jusqua(abonnement, aujourdhui),
    )) {
      const total = tarifApplicable(sesTarifs, date);
      const montant = siteId ? partDuSite(sesParts, total, siteId) : total;
      if (montant === 0) continue;

      const mois = date.slice(0, 7);
      parMois.set(mois, (parMois.get(mois) ?? 0) + montant);
    }
  }
  return parMois;
}

/** Part d'un site dans une echeance, les parts etant reproportionnees au tarif. */
function partDuSite(sesParts, montant, siteId) {
  const index = sesParts.findIndex((p) => p.site_id === siteId);
  if (index === -1) return 0;
  return redistribuer(
    sesParts.map((p) => p.part_cents),
    montant,
  )[index];
}

/**
 * Prelevements d'abonnements imputes a chaque site sur une periode
 * ('siteId' -> centimes). Un abonnement partage ne compte que pour la fraction
 * de chaque site, et les parts sont reproportionnees au tarif de l'echeance.
 */
export function abonnementsParSite(abonnements, tarifs, parts, depuis, jusquA) {
  const parSite = new Map();

  for (const abonnement of abonnements) {
    const sesParts = parts.filter((p) => p.abonnement_id === abonnement.id);
    const sesTarifs = tarifs.filter((t) => t.abonnement_id === abonnement.id);
    // Aucun site rattache: cout transverse, imputable a personne
    if (sesParts.length === 0 || sesTarifs.length === 0) continue;

    const echeances = echeancesPassees(
      abonnement.debut,
      abonnement.periodicite,
      jusqua(abonnement, jusquA),
    ).filter((date) => date >= depuis && date <= jusquA);

    for (const date of echeances) {
      const montant = tarifApplicable(sesTarifs, date);
      const repartis = redistribuer(
        sesParts.map((p) => p.part_cents),
        montant,
      );
      sesParts.forEach((p, i) => {
        parSite.set(p.site_id, (parSite.get(p.site_id) ?? 0) + repartis[i]);
      });
    }
  }
  return parSite;
}
