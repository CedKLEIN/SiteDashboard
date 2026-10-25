import { echeanceAJour } from "../abonnements";
import { select } from "../db";
import { aujourdhuiIso } from "../format";
import { SITES_DE_L_ABONNEMENT, TARIF_COURANT } from "./communs";

/* ------------------------------------------------------------ agregats */

/**
 * Depenses et revenus par mois sur une periode, filtrables par site.
 *
 * Quand un site est demande, on somme les PARTS et non les montants: une
 * depense partagee ne doit compter que pour la fraction du site.
 */
export function seriesParMois(depuis, jusqua, siteId = null) {
  if (siteId) {
    return select(
      `SELECT mois, SUM(depense) AS depense_cents, SUM(revenu) AS revenu_cents FROM (
         SELECT substr(d.date, 1, 7) AS mois, ds.part_cents AS depense, 0 AS revenu
           FROM depenses d JOIN depense_sites ds ON ds.depense_id = d.id
          WHERE ds.site_id = $1 AND d.date >= $2 AND d.date <= $3
         UNION ALL
         SELECT substr(r.date, 1, 7) AS mois, 0 AS depense, rs.part_cents AS revenu
           FROM revenus r JOIN revenu_sites rs ON rs.revenu_id = r.id
          WHERE rs.site_id = $1 AND r.date >= $2 AND r.date <= $3
       )
       GROUP BY mois ORDER BY mois`,
      [siteId, depuis, jusqua],
    );
  }

  return select(
    `SELECT mois, SUM(depense) AS depense_cents, SUM(revenu) AS revenu_cents FROM (
       SELECT substr(date, 1, 7) AS mois, montant_cents AS depense, 0 AS revenu
         FROM depenses WHERE date >= $1 AND date <= $2
       UNION ALL
       SELECT substr(date, 1, 7) AS mois, 0 AS depense,
              COALESCE(montant_eur_cents, montant_cents) AS revenu
         FROM revenus WHERE date >= $1 AND date <= $2
     )
     GROUP BY mois ORDER BY mois`,
    [depuis, jusqua],
  );
}

/** Premiere date connue, toutes ecritures confondues: borne de "depuis toujours". */
export async function premiereDate() {
  const [ligne] = await select(
    `SELECT MIN(date) AS debut FROM (
       SELECT MIN(date) AS date FROM depenses
       UNION ALL SELECT MIN(date) FROM revenus
       UNION ALL SELECT MIN(debut) FROM abonnements
     ) WHERE date IS NOT NULL`,
  );
  return ligne?.debut ?? null;
}


/** Depenses et revenus agreges par mois, sur les n derniers mois. */
export function totauxParMois(nbMois = 12) {
  const depuis = `-${nbMois - 1} months`;
  return select(
    `SELECT mois, SUM(depense) AS depense_cents, SUM(revenu) AS revenu_cents FROM (
       SELECT substr(date, 1, 7) AS mois, montant_cents AS depense, 0 AS revenu FROM depenses
       UNION ALL
       SELECT substr(date, 1, 7) AS mois, 0 AS depense,
              COALESCE(montant_eur_cents, montant_cents) AS revenu FROM revenus
     )
     WHERE mois >= strftime('%Y-%m', date('now', 'start of month', $1))
     GROUP BY mois
     ORDER BY mois`,
    [depuis],
  );
}

/**
 * Depenses agregees par site sur une periode ('YYYY-MM-DD' incluse).
 * On somme les PARTS, pas les montants: une depense partagee entre deux sites
 * ne doit pas etre comptee deux fois en entier.
 */
export function depensesParSite(depuis, jusqua) {
  return select(
    `SELECT s.id, s.nom, s.couleur, COALESCE(SUM(p.part_cents), 0) AS total_cents
     FROM sites s
     LEFT JOIN (
       SELECT ds.site_id, ds.part_cents
       FROM depense_sites ds
       JOIN depenses d ON d.id = ds.depense_id
       WHERE d.date >= $1 AND d.date <= $2
     ) p ON p.site_id = s.id
     GROUP BY s.id
     ORDER BY total_cents DESC`,
    [depuis, jusqua],
  );
}


/** Totaux bruts sur une periode. */
export async function totauxPeriode(depuis, jusqua) {
  const [dep] = await select(
    "SELECT COALESCE(SUM(montant_cents), 0) AS total FROM depenses WHERE date >= $1 AND date <= $2",
    [depuis, jusqua],
  );
  const [rev] = await select(
    `SELECT COALESCE(SUM(COALESCE(montant_eur_cents, montant_cents)), 0) AS total
     FROM revenus WHERE date >= $1 AND date <= $2`,
    [depuis, jusqua],
  );
  return { depensesCents: dep.total, revenusCents: rev.total };
}

/**
 * Cout recurrent mensuel porte par un site: la somme de SES PARTS d'abonnements
 * actifs, ramenees au mois. Un abonnement partage ne compte donc que pour sa
 * fraction.
 */
export async function coutFixeDuSite(siteId) {
  const [ligne] = await select(
    `SELECT COALESCE(SUM(
       CASE WHEN a.periodicite = 'annuel' THEN lien.part_cents / 12.0 ELSE lien.part_cents END
     ), 0) AS total_cents
     FROM abonnement_sites lien
     JOIN abonnements a ON a.id = lien.abonnement_id
     WHERE lien.site_id = $1 AND a.actif = 1`,
    [siteId],
  );
  return Math.round(ligne.total_cents);
}

/**
 * Abonnements actifs a echeance dans les n prochains jours, l'echeance saisie
 * etant avancee au prochain renouvellement si elle est passee (voir
 * `echeanceAJour`). Le filtre se fait donc ici et non en SQL.
 */
export async function echeancesProches(jours = 45, aujourdhui = aujourdhuiIso()) {
  const abonnements = await select(
    `SELECT a.*, f.nom AS fournisseur_nom, ${TARIF_COURANT}, ${SITES_DE_L_ABONNEMENT}
     FROM abonnements a
     LEFT JOIN fournisseurs f ON f.id = a.fournisseur_id
     WHERE a.actif = 1 AND a.prochaine_echeance IS NOT NULL`,
  );
  const [a, m, j] = aujourdhui.split("-").map(Number);
  const limite = aujourdhuiIso(new Date(a, m - 1, j + jours));

  return abonnements
    .map((ab) => ({
      ...ab,
      prochaine_echeance: echeanceAJour(ab.prochaine_echeance, ab.periodicite, aujourdhui, ab.fin),
    }))
    .filter((ab) => ab.prochaine_echeance && ab.prochaine_echeance <= limite)
    .sort((x, y) => x.prochaine_echeance.localeCompare(y.prochaine_echeance));
}
