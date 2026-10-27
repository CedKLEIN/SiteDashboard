/**
 * Bilan financier d'une periode, partage par la vue d'ensemble, Finances et
 * la fiche d'un site : serie mensuelle, totaux, comparaison avec la meme
 * periode un an plus tot, et rentabilite par site.
 */
import { abonnementsParMois, abonnementsParSite } from "./abonnements";
import { bornesPeriode } from "./periodes";
import { construireSerie } from "./series";
import { aujourdhuiIso } from "./format";
import {
  depensesParSite,
  listerAbonnements,
  listerPartsAbonnements,
  listerTarifs,
  premiereDate,
  revenusParSite,
  seriesParMois,
} from "./queries";

/** La meme date un an plus tot ('2026-02-29' -> '2025-02-28'). */
export function unAnAvant(dateIso) {
  const [a, m, j] = dateIso.split("-").map(Number);
  const dernier = new Date(a - 1, m, 0).getDate();
  return `${String(a - 1).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(j, dernier)).padStart(2, "0")}`;
}

/**
 * Ecart en pourcentage entre deux montants, formate (« +18 % », « −6 % ») ;
 * null quand la reference est nulle : un ecart a partir de zero ne veut rien dire.
 */
export function ecart(actuel, reference) {
  if (!reference) return null;
  const pct = Math.round(((actuel - reference) / Math.abs(reference)) * 100);
  return `${pct > 0 ? "+" : pct < 0 ? "−" : "±"}${Math.abs(pct)} %`;
}

function totaux(serie) {
  return {
    revenus: serie.totalRevenusCents,
    depenses: serie.totalDepensesCents,
    abonnements: serie.totalAbonnementsCents,
    ponctuelles: serie.totalDepensesCents - serie.totalAbonnementsCents,
    marge: serie.totalRevenusCents - serie.totalDepensesCents,
  };
}

export async function chargerBilan({ periode, siteId = null, aujourdhui = aujourdhuiIso() }) {
  const { debut, fin } = bornesPeriode(periode, aujourdhui);
  // « Depuis toujours » part de la premiere ecriture connue : sinon des siecles de mois vides
  const debutReel = periode === "toujours" ? ((await premiereDate()) ?? aujourdhui) : debut;
  // Inutile d'afficher les mois a venir d'une annee en cours
  const finReelle = fin > aujourdhui ? aujourdhui : fin;
  // Meme duree un an plus tot : janvier-octobre 2026 contre janvier-octobre 2025
  const comparable = periode !== "toujours";
  const debutAvant = unAnAvant(debutReel);
  const finAvant = unAnAvant(finReelle);

  const [series, seriesAvant, abonnements, tarifs, parts, depSites, revSites] = await Promise.all([
    seriesParMois(debutReel, finReelle, siteId),
    comparable ? seriesParMois(debutAvant, finAvant, siteId) : [],
    listerAbonnements(),
    listerTarifs(),
    listerPartsAbonnements(),
    depensesParSite(debutReel, finReelle),
    revenusParSite(debutReel, finReelle),
  ]);

  const aboParMois = abonnementsParMois(abonnements, tarifs, aujourdhui, { parts, siteId });
  const serie = construireSerie({
    debut: debutReel,
    fin: finReelle,
    parMois: new Map(series.map((l) => [l.mois, l])),
    aboParMois,
  });
  const precedent = comparable
    ? totaux(
        construireSerie({
          debut: debutAvant,
          fin: finAvant,
          parMois: new Map(seriesAvant.map((l) => [l.mois, l])),
          aboParMois,
        }),
      )
    : null;

  // Rentabilite par site : revenus et couts (depenses + abonnements) en PARTS
  const aboParSite = abonnementsParSite(abonnements, tarifs, parts, debutReel, finReelle);
  const revenusDe = new Map(revSites.map((r) => [r.id, r.total_cents]));
  const parSite = depSites.map((s) => {
    const couts = s.total_cents + (aboParSite.get(s.id) ?? 0);
    const revenus = revenusDe.get(s.id) ?? 0;
    return { id: s.id, nom: s.nom, couleur: s.couleur, revenus, couts, marge: revenus - couts };
  });

  return {
    debut: debutReel,
    fin: finReelle,
    aujourdhui,
    points: serie.points.map((p) => ({
      ...p,
      // Barres de part et d'autre de zero : les sorties en negatif
      sortiesPonctuelles: -p.depenses,
      sortiesAbonnements: -p.abonnements,
      marge: Math.round((p.cumulRevenus - p.cumulDepenses) * 100) / 100,
    })),
    totaux: totaux(serie),
    precedent,
    parSite,
    abonnements,
    tarifs,
    parts,
  };
}
