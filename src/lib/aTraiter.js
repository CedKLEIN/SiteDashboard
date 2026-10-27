/**
 * « A traiter » : tout ce qui demande un geste, rassemble en une liste sur la
 * vue d'ensemble — checks en echec (certificats et domaines qui expirent
 * compris), points des agents du jour, prelevements des 7 prochains jours.
 * Fonction pure : les donnees arrivent deja lues.
 */
import { formatMontant } from "./format";

/** '2026-10-27 14:08:00' -> minutes ecoulees jusqu'a `maintenant`. */
function minutesDepuis(horodatage, maintenant) {
  const [jour, heure = "00:00:00"] = String(horodatage ?? "").split(" ");
  const [a, m, j] = jour.split("-").map(Number);
  const [h, mi, s] = heure.split(":").map(Number);
  const date = new Date(a, (m ?? 1) - 1, j ?? 1, h ?? 0, mi ?? 0, s ?? 0);
  const ms = maintenant - date;
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60000)) : null;
}

/** 5 -> '5 min', 190 -> '3 h', 3000 -> '2 j'. */
export function dureeCourte(minutes) {
  if (minutes == null) return null;
  if (minutes < 1) return "moins d'une minute";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / 1440)} j`;
}

/** Jours entre deux dates ISO (YYYY-MM-DD). */
function joursEntre(de, a) {
  const [y1, m1, d1] = de.split("-").map(Number);
  const [y2, m2, d2] = a.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** « aujourd'hui », « demain », « samedi », « dans 9 j ». */
export function quandEcheance(date, aujourdhui) {
  const n = joursEntre(aujourdhui, date);
  if (n <= 0) return "aujourd'hui";
  if (n === 1) return "demain";
  if (n < 7) {
    const [a, m, j] = date.split("-").map(Number);
    return new Date(a, m - 1, j).toLocaleDateString("fr-FR", { weekday: "long" });
  }
  return `dans ${n} j`;
}

/** Ce qu'un check en echec dit de lui en quelques mots. */
function detailEchec(check, maintenant) {
  const cause = check.erreur || (check.statut_http ? `HTTP ${check.statut_http}` : "en échec");
  const duree = dureeCourte(minutesDepuis(check.depuis ?? check.verifie_le, maintenant));
  return duree ? `${cause} · depuis ${duree}` : cause;
}

export function construireATraiter({ echecs = [], vuesAgents = [], echeances = [], aujourdhui, maintenant = new Date() }) {
  const liste = [];

  for (const c of echecs) {
    const expiration = c.type === "tls" || c.type === "domaine";
    liste.push({
      cle: `check-${c.id}`,
      ton: expiration && c.jours_restants != null && c.jours_restants >= 0 ? "alerte" : "ko",
      icone: c.type === "tls" ? "certificat" : c.type === "domaine" ? "domaine" : "check",
      titre: `${c.site_nom} · ${c.libelle}`,
      detail: detailEchec(c, maintenant),
      cible: { page: "site", siteId: c.site_id, onglet: "sante" },
    });
  }

  for (const vue of vuesAgents) {
    for (const point of vue.aFaire ?? []) {
      liste.push({
        cle: `agent-${vue.cle}-${point.id}-${point.court}`,
        ton: point.niveau === "echec" ? "ko" : "alerte",
        icone: "agent",
        titre: `${vue.nom} · ${point.tache}`,
        detail: point.court,
        texte: point.texte,
        cible: vue.siteId ? { page: "site", siteId: vue.siteId, onglet: "agents" } : { page: "reglages", onglet: "agents" },
      });
    }
  }

  for (const e of echeances) {
    if (joursEntre(aujourdhui, e.prochaine_echeance) > 7) continue;
    liste.push({
      cle: `echeance-${e.id}`,
      ton: "info",
      icone: "abonnement",
      titre: e.fournisseur_nom ? `${e.libelle} · ${e.fournisseur_nom}` : e.libelle,
      detail: `Prélèvement de ${formatMontant(e.montant_cents)} ${quandEcheance(e.prochaine_echeance, aujourdhui)}`,
      cible: { page: "finances", onglet: "abonnements" },
    });
  }

  // Les pannes d'abord, puis ce qui est a regarder, puis l'information
  const rang = { ko: 0, alerte: 1, info: 2 };
  return liste.sort((a, b) => rang[a.ton] - rang[b.ton]);
}

/** Ce qui compte dans la pastille du menu : pas les simples informations. */
export function nbATraiter(liste) {
  return liste.filter((x) => x.ton !== "info").length;
}
