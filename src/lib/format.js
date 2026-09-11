/**
 * Les montants transitent en CENTIMES (entiers) partout dans l'appli.
 * On ne convertit en flottant qu'au moment de l'affichage.
 */

export function formatMontant(cents, devise = "EUR") {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: devise,
    maximumFractionDigits: 2,
  }).format((cents ?? 0) / 100);
}

/**
 * Convertit une saisie utilisateur ("12,50", "12.5", "1 200 €") en centimes.
 * Retourne null si la saisie n'est pas un montant exploitable.
 */
export function parseMontant(saisie) {
  if (typeof saisie === "number") {
    return Number.isFinite(saisie) ? Math.round(saisie * 100) : null;
  }
  if (typeof saisie !== "string") return null;

  const nettoye = saisie
    .replace(/\s| /g, "")
    .replace(/[€$£]/g, "")
    .replace(",", ".");
  if (nettoye === "" || !/^-?\d*\.?\d*$/.test(nettoye)) return null;

  const valeur = Number.parseFloat(nettoye);
  if (!Number.isFinite(valeur)) return null;
  // L'arrondi evite les 1234.9999999 de la virgule flottante
  return Math.round(valeur * 100);
}

/** '2026-09-11' -> '2026-09' */
export function moisIso(dateIso) {
  return String(dateIso).slice(0, 7);
}

/** '2026-09' -> 'sept. 26' */
export function moisLisible(mois) {
  const [annee, m] = mois.split("-");
  const libelle = new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(
    new Date(Number(annee), Number(m) - 1, 1),
  );
  return `${libelle} ${annee.slice(2)}`;
}

/** Les n derniers mois, du plus ancien au plus recent: ['2025-10', ..., '2026-09'] */
export function derniersMois(n, aujourdhui = new Date()) {
  const mois = [];
  const curseur = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), 1);
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(curseur.getFullYear(), curseur.getMonth() - i, 1);
    mois.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return mois;
}

/** Date du jour au format ISO court, en heure locale (pas UTC). */
export function aujourdhuiIso(date = new Date()) {
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mois}-${jour}`;
}

/** Ramene un abonnement a son cout mensuel equivalent, en centimes. */
export function coutMensuelEquivalent({ montant_cents, periodicite }) {
  if (periodicite === "annuel") return Math.round(montant_cents / 12);
  return montant_cents;
}
