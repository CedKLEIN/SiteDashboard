/**
 * Rapports des agents planifies (Claude Code) : lecture, validation et verdict.
 *
 * Chaque agent depose un fichier JSON par passage dans
 * `~/.claude/rapports-agents/<site>/<AAAA-MM-JJ>/<agent>.json`. Le code Rust ne
 * fait que lire les fichiers; tout ce qui juge vit ici, testable sans disque.
 */

/** Statut d'un rapport, tel que l'ecrit l'agent. */
export const STATUTS_RAPPORT = {
  ok: { libelle: "OK", etat: "ok" },
  attention: { libelle: "A regarder", etat: "partiel" },
  echec: { libelle: "Echec", etat: "ko" },
};

/** Profondeur par defaut de l'historique affiche. */
export const JOURS_HISTORIQUE = 30;

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** 'C:\a\denivio.fr\2026-10-24\sante.json' -> { site, date, agent } d'apres le chemin. */
export function decouperChemin(chemin) {
  const morceaux = String(chemin ?? "").split(/[\\/]/).filter(Boolean);
  const nom = morceaux.at(-1) ?? "";
  return {
    agent: nom.replace(/\.json$/i, ""),
    date: morceaux.at(-2) ?? "",
    site: morceaux.at(-3) ?? "",
  };
}

function texte(valeur) {
  return typeof valeur === "string" ? valeur.trim() : "";
}

function normaliserPoints(points) {
  if (!Array.isArray(points)) return [];
  return points
    .map((p) => {
      if (typeof p === "string") return { niveau: "ok", texte: p.trim() };
      const niveau = STATUTS_RAPPORT[p?.niveau] ? p.niveau : "attention";
      return { niveau, texte: texte(p?.texte) };
    })
    .filter((p) => p.texte);
}

/**
 * Transforme un fichier brut (renvoye par `lire_rapports_agents`) en rapport.
 *
 * Un fichier illisible ou au statut inconnu devient un rapport en echec plutot
 * que d'etre ignore : un agent qui ecrit n'importe quoi est un agent qui a casse.
 * Le site, la date et l'agent viennent du chemin quand le JSON ne les donne pas,
 * pour qu'un rapport incomplet reste au moins range au bon endroit.
 */
export function lireRapport({ chemin, contenu, erreur } = {}) {
  const duChemin = decouperChemin(chemin);
  const base = {
    cle: chemin,
    chemin,
    site: duChemin.site,
    date: duChemin.date,
    agent: duChemin.agent,
    titre: duChemin.agent,
    debut: null,
    fin: null,
    resume: "",
    points: [],
    fichierSuivi: null,
  };

  if (erreur || contenu == null) {
    return { ...base, statut: "echec", resume: `Rapport illisible : ${erreur ?? "fichier vide"}` };
  }

  let donnees;
  try {
    donnees = JSON.parse(contenu);
  } catch (e) {
    return { ...base, statut: "echec", resume: `Rapport illisible : JSON invalide (${e.message})` };
  }
  if (!donnees || typeof donnees !== "object" || Array.isArray(donnees)) {
    return { ...base, statut: "echec", resume: "Rapport illisible : objet JSON attendu" };
  }

  const statutLu = texte(donnees.statut).toLowerCase();
  const statutConnu = Boolean(STATUTS_RAPPORT[statutLu]);
  const date = DATE_ISO.test(texte(donnees.date)) ? texte(donnees.date) : base.date;
  const resume = texte(donnees.resume);

  return {
    ...base,
    site: texte(donnees.site) || base.site,
    date,
    agent: texte(donnees.agent) || base.agent,
    titre: texte(donnees.titre) || texte(donnees.agent) || base.titre,
    debut: texte(donnees.debut) || null,
    fin: texte(donnees.fin) || null,
    statut: statutConnu ? statutLu : "echec",
    resume: statutConnu
      ? resume
      : `Statut inconnu « ${texte(donnees.statut) || "absent"} »${resume ? ` — ${resume}` : ""}`,
    points: normaliserPoints(donnees.points),
    fichierSuivi: texte(donnees.fichier) || null,
  };
}

/**
 * Verdict d'une journee pour un site.
 *
 * - vert (`ok`) : tous les rapports sont OK ;
 * - rouge (`ko`) : au moins la moitie des rapports sont en echec ;
 * - orange (`partiel`) : tout le reste — un point a regarder, ou un echec isole.
 *
 * Un « a regarder » ne rend jamais la journee rouge : l'agent a fait son travail,
 * il signale seulement quelque chose. Seuls les echecs comptent pour le rouge.
 */
export function verdictJournee(rapports) {
  if (!rapports || rapports.length === 0) return "aucun";
  const echecs = rapports.filter((r) => r.statut === "echec").length;
  if (echecs > 0 && echecs * 2 >= rapports.length) return "ko";
  if (rapports.every((r) => r.statut === "ok")) return "ok";
  return "partiel";
}

/** 'https://www.denivio.fr/x' -> 'denivio.fr' ; une chaine sans schema est acceptee. */
export function domaine(valeur) {
  const brut = texte(valeur).toLowerCase();
  if (!brut) return "";
  try {
    const url = new URL(brut.includes("://") ? brut : `https://${brut}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return brut.replace(/^www\./, "");
  }
}

/**
 * Retrouve le site du tableau de bord auquel appartient un rapport : par domaine
 * (le cas normal, les agents ecrivent `denivio.fr`), sinon par nom exact.
 */
export function rattacherSite(nomSite, sites = []) {
  const cible = domaine(nomSite);
  const parDomaine = sites.find((s) => s.url && domaine(s.url) === cible);
  if (parDomaine) return parDomaine;
  const nom = texte(nomSite).toLowerCase();
  return sites.find((s) => texte(s.nom).toLowerCase() === nom) ?? null;
}

/**
 * Regroupe les rapports en lignes (un site, un jour), les plus recentes d'abord.
 * Dans une ligne, les rapports suivent l'ordre de passage des agents.
 */
export function regrouperParJournee(rapports) {
  const groupes = new Map();
  for (const rapport of rapports) {
    const cle = `${rapport.date}|${domaine(rapport.site) || rapport.site}`;
    if (!groupes.has(cle)) {
      groupes.set(cle, { cle, date: rapport.date, site: rapport.site, rapports: [] });
    }
    groupes.get(cle).rapports.push(rapport);
  }

  return [...groupes.values()]
    .map((g) => {
      const tries = [...g.rapports].sort(
        (a, b) =>
          String(a.debut ?? a.fin ?? "").localeCompare(String(b.debut ?? b.fin ?? "")) ||
          a.titre.localeCompare(b.titre),
      );
      const compte = { ok: 0, attention: 0, echec: 0 };
      for (const r of tries) compte[r.statut] += 1;
      return { ...g, rapports: tries, compte, verdict: verdictJournee(tries) };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.site.localeCompare(b.site));
}

/** Date ISO du jour `jours` jours avant `aujourdhui` (date locale). */
export function dateDepuis(jours, aujourdhui = new Date()) {
  const d = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate() - jours);
  const mois = String(d.getMonth() + 1).padStart(2, "0");
  const jour = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mois}-${jour}`;
}

const MARQUES_POINT = { ok: "OK", attention: "A regarder", echec: "Echec" };

/** Un rapport en texte brut, pret a coller : titre, statut, resume, points et fichier. */
export function texteRapport(rapport) {
  const heure = heureRapport(rapport.debut) ?? heureRapport(rapport.fin);
  const lignes = [
    `${rapport.titre} — ${rapport.site} — ${rapport.date}${heure ? ` ${heure}` : ""} — ${STATUTS_RAPPORT[rapport.statut]?.libelle ?? rapport.statut}`,
  ];
  if (rapport.resume) lignes.push(rapport.resume);
  for (const point of rapport.points ?? []) {
    lignes.push(`- [${MARQUES_POINT[point.niveau] ?? point.niveau}] ${point.texte}`);
  }
  const fichier = rapport.fichierSuivi ?? rapport.chemin;
  if (fichier) lignes.push(`Fichier : ${fichier}`);
  return lignes.join("\n");
}

/** Tous les rapports d'une journee (une ligne de `regrouperParJournee`), separes par une ligne vide. */
export function texteJournee(ligne) {
  return ligne.rapports.map(texteRapport).join("\n\n");
}

/** '2026-10-24T09:12:00+02:00' -> '09:12' ; null si absent ou illisible. */
export function heureRapport(horodatage) {
  const correspondance = /T(\d{2}:\d{2})/.exec(String(horodatage ?? ""));
  return correspondance ? correspondance[1] : null;
}
