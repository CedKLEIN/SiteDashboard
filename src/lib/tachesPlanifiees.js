/**
 * Agents attendus aujourd'hui : quelles taches planifiees doivent deposer un
 * rapport, a quelle heure, et lesquelles sont en retard.
 *
 * Un agent bloque (une autorisation en attente, une deconnexion) n'ecrit rien :
 * sans cette liste, il disparaitrait simplement de l'ecran. On compare donc ce
 * qui etait prevu avec ce qui est arrive. Le code Rust ne fait que lire les
 * fichiers (`lire_taches_planifiees`) ; tout ce qui juge vit ici.
 */

import { dateDepuis, heureRapport } from "./rapportsAgents";

/** Un agent sans rapport plus de 30 min apres son heure prevue n'a pas ete lance. */
export const MARGE_LANCEMENT_MIN = 30;

/**
 * Un agent lance depuis plus longtemps que ca, sans rapport, est presume bloque.
 * Le seuil s'allonge pour un agent qui a deja pris plus de temps (il attend un
 * quota, par exemple) : 1,5 fois sa plus longue duree connue.
 */
export const SEUIL_BLOCAGE_MIN = 45;

/** Libelle et etat de supervision (voir statut.js) de chaque situation. */
export const SITUATIONS = {
  recu: { libelle: "Rapport recu" },
  en_cours: { libelle: "En cours", etat: "inconnu" },
  bloque: { libelle: "Bloque ?", etat: "partiel" },
  non_lance: { libelle: "Pas lance", etat: "partiel" },
  prevu: { libelle: "Prevu", etat: "aucun" },
};

const RAPPORT_ATTENDU =
  /rapports-agents[\\/]+([^\\/\s<>]+)[\\/]+<AAAA-MM-JJ>[\\/]+([^\\/\s<>"`]+)\.json/i;

/**
 * Le rapport qu'une tache promet de deposer, lu dans ses consignes :
 * `...\rapports-agents\denivio.fr\<AAAA-MM-JJ>\sante.json` -> { site, agent }.
 * Une tache qui ne parle pas de rapport (un simple rappel) n'est pas attendue.
 */
export function rapportPromis(skill) {
  const trouve = RAPPORT_ATTENDU.exec(String(skill ?? ""));
  if (!trouve) return null;
  const titre = /"titre"\s*:\s*"([^"]+)"/.exec(skill);
  return { site: trouve[1], agent: trouve[2], titre: titre?.[1] ?? null };
}

/** Le fichier interne de l'appli Claude -> Map id -> { cron, actif, dernierLancement, nom }. */
export function lireConfigTaches(texte) {
  const config = new Map();
  let donnees;
  try {
    donnees = JSON.parse(texte ?? "");
  } catch {
    return config;
  }
  for (const t of Array.isArray(donnees?.scheduledTasks) ? donnees.scheduledTasks : []) {
    if (typeof t?.id !== "string") continue;
    config.set(t.id, {
      cron: typeof t.cronExpression === "string" ? t.cronExpression : null,
      actif: t.enabled !== false,
      dernierLancement: typeof t.lastRunAt === "string" ? t.lastRunAt : null,
      nom: typeof t.displayName === "string" ? t.displayName : null,
    });
  }
  return config;
}

/** Valeurs d'un champ cron : `*`, `5`, `1-5`, `*\/15`, `1,3,5`. null si illisible. */
function valeursChamp(champ, min, max) {
  const valeurs = new Set();
  for (const morceau of champ.split(",")) {
    const [plage, pasTexte] = morceau.split("/");
    const pas = pasTexte === undefined ? 1 : Number(pasTexte);
    let debut = min;
    let fin = max;
    if (plage !== "*") {
      const [a, b] = plage.split("-").map(Number);
      debut = a;
      fin = b === undefined ? (pasTexte === undefined ? a : max) : b;
    }
    if (![debut, fin, pas].every(Number.isInteger) || pas < 1 || debut < min || fin > max) {
      return null;
    }
    for (let v = debut; v <= fin; v += pas) valeurs.add(v);
  }
  return [...valeurs].sort((x, y) => x - y);
}

/**
 * Premiere heure de passage d'une expression cron le jour de `date` (heure
 * locale), 'HH:MM', ou null si elle ne tombe pas ce jour-la.
 *
 * Jour du mois et jour de semaine suivent la regle cron : quand les deux sont
 * restreints, l'un OU l'autre suffit.
 */
export function heurePrevue(cron, date = new Date()) {
  const champs = String(cron ?? "").trim().split(/\s+/);
  if (champs.length !== 5) return null;
  const [minutes, heures, joursMois, mois, joursSemaine] = [
    valeursChamp(champs[0], 0, 59),
    valeursChamp(champs[1], 0, 23),
    valeursChamp(champs[2], 1, 31),
    valeursChamp(champs[3], 1, 12),
    valeursChamp(champs[4], 0, 7),
  ];
  if (!minutes || !heures || !joursMois || !mois || !joursSemaine) return null;

  const semaine = joursSemaine.map((j) => j % 7);
  const bonMois = mois.includes(date.getMonth() + 1);
  const bonJourMois = joursMois.includes(date.getDate());
  const bonJourSemaine = semaine.includes(date.getDay());
  const restreints = champs[2] !== "*" && champs[4] !== "*";
  const bonJour = restreints ? bonJourMois || bonJourSemaine : bonJourMois && bonJourSemaine;
  if (!bonMois || !bonJour) return null;

  return `${String(heures[0]).padStart(2, "0")}:${String(minutes[0]).padStart(2, "0")}`;
}

function minutesDepuis(debut, maintenant) {
  return Math.floor((maintenant.getTime() - debut.getTime()) / 60000);
}

/** 95 -> '1 h 35' ; 40 -> '40 min'. */
export function duree(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const reste = minutes % 60;
  return `${Math.floor(minutes / 60)} h${reste ? ` ${String(reste).padStart(2, "0")}` : ""}`;
}

/** Plus longue duree (minutes) entre debut et fin parmi les rapports deja recus d'un agent. */
export function plusLongueDuree(rapports, agent) {
  let max = 0;
  for (const r of rapports) {
    if (r.agent !== agent || !r.debut || !r.fin) continue;
    const minutes = minutesDepuis(new Date(r.debut), new Date(r.fin));
    if (Number.isFinite(minutes) && minutes > max) max = minutes;
  }
  return max;
}

function heureLocale(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * La situation d'un agent attendu aujourd'hui.
 *
 * - `recu` : son rapport du jour est la (son statut dit le reste) ;
 * - `en_cours` / `bloque` : lance aujourd'hui, pas encore de rapport ; bloque
 *   au-dela du seuil, parce qu'un agent qui attend une autorisation ne le dit pas ;
 * - `non_lance` : l'heure prevue est passee depuis la marge, et rien n'a demarre ;
 * - `prevu` : son heure n'est pas encore venue.
 */
export function situationAgent({ prevueA, lanceA, rapport, dureeMaxMin = 0, maintenant }) {
  if (rapport) return { situation: "recu", message: rapport.resume || "Rapport recu" };

  if (lanceA) {
    const ecoule = minutesDepuis(lanceA, maintenant);
    const seuil = Math.max(SEUIL_BLOCAGE_MIN, Math.round(dureeMaxMin * 1.5));
    if (ecoule > seuil) {
      return {
        situation: "bloque",
        message: `Lance a ${heureLocale(lanceA)}, toujours sans rapport apres ${duree(ecoule)} : il attend peut-etre une autorisation`,
      };
    }
    return { situation: "en_cours", message: `Lance a ${heureLocale(lanceA)}` };
  }

  if (prevueA) {
    const [h, m] = prevueA.split(":").map(Number);
    const prevue = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate(), h, m);
    if (minutesDepuis(prevue, maintenant) > MARGE_LANCEMENT_MIN) {
      return { situation: "non_lance", message: `Prevu a ${prevueA}, pas encore lance` };
    }
    return { situation: "prevu", message: `Prevu a ${prevueA}` };
  }
  return { situation: "prevu", message: "Horaire inconnu" };
}

/**
 * Tous les agents attendus aujourd'hui, avec leur situation.
 *
 * Un agent est attendu s'il promet un rapport et que son horaire tombe
 * aujourd'hui, ou qu'il a ete lance aujourd'hui (rattrapage d'un passage
 * manque). Sans le fichier de config de Claude, on ne sait rien des horaires :
 * on n'invente pas d'attente, la liste reste vide.
 */
export function agentsAttendus({ taches = [], config = "", rapports = [], maintenant = new Date() }) {
  const parId = lireConfigTaches(config);
  const aujourdhui = dateDepuis(0, maintenant);
  const attendus = [];

  for (const tache of taches) {
    const promis = rapportPromis(tache.skill);
    const reglage = parId.get(tache.id);
    if (!promis || !reglage?.actif) continue;

    const prevueA = heurePrevue(reglage.cron, maintenant);
    const lancement = reglage.dernierLancement ? new Date(reglage.dernierLancement) : null;
    const lanceA =
      lancement && !Number.isNaN(lancement.getTime()) && dateDepuis(0, lancement) === aujourdhui
        ? lancement
        : null;
    if (!prevueA && !lanceA) continue;

    const rapport = rapports.find((r) => r.agent === promis.agent && r.date === aujourdhui) ?? null;
    const { situation, message } = situationAgent({
      prevueA,
      lanceA,
      rapport,
      dureeMaxMin: plusLongueDuree(rapports, promis.agent),
      maintenant,
    });

    attendus.push({
      id: tache.id,
      site: promis.site,
      agent: promis.agent,
      titre: rapport?.titre || promis.titre || reglage.nom || tache.id,
      prevueA,
      // L'heure du rapport d'abord: un agent relance apres un blocage a son
      // vrai passage plus tard que le lancement retenu par Claude
      heure:
        heureRapport(rapport?.debut) ??
        heureRapport(rapport?.fin) ??
        (lanceA ? heureLocale(lanceA) : prevueA),
      situation,
      message,
      rapport,
    });
  }

  return attendus.sort((a, b) => String(a.prevueA ?? "").localeCompare(String(b.prevueA ?? "")));
}

const STATUTS_RECUS = { ok: "OK", attention: "a regarder", echec: "en echec" };

/**
 * Le libelle d'un agent attendu. Un rapport recu le dit toujours: afficher son
 * seul statut ("A regarder") le faisait passer pour un agent qui n'a pas fini.
 */
export function libelleAttendu(attendu) {
  if (!attendu.rapport) return SITUATIONS[attendu.situation].libelle;
  return `Recu · ${STATUTS_RECUS[attendu.rapport.statut] ?? attendu.rapport.statut}`;
}

/** Un agent attendu en une ligne de texte, pret a coller. */
export function texteAttendu(attendu) {
  const libelle = libelleAttendu(attendu);
  const heure = attendu.heure ? ` (${attendu.heure})` : "";
  return `${attendu.titre} — ${attendu.site} — ${libelle}${heure} : ${attendu.message}`;
}

/** Nombre d'agents qui demandent un regard : bloques ou jamais lances. */
export function nbAgentsEnRetard(attendus) {
  return attendus.filter((a) => a.situation === "bloque" || a.situation === "non_lance").length;
}
