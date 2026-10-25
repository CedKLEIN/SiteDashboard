/**
 * Planning des controles automatiques (dossier controles/ du depot).
 *
 * Chaque controle a un horaire cron (registre.json). Il est du quand son
 * dernier passage prevu est posterieur a son dernier lancement : un controle
 * manque parce que l'appli etait fermee est rattrape a la reouverture, une
 * seule fois. Fonctions pures ; le lancement est dans useControles.js.
 */
import registre from "../../controles/registre.json";
import { heurePrevue } from "./tachesPlanifiees";

export const REGISTRE = registre;

/** Jours remontes pour trouver le dernier passage prevu (un controle hebdomadaire). */
const JOURS_RECHERCHE = 8;

/** Dernier moment prevu par `cron` a ou avant `maintenant`, ou null. */
export function dernierPassagePrevu(cron, maintenant = new Date()) {
  for (let i = 0; i < JOURS_RECHERCHE; i += 1) {
    const jour = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate() - i);
    const heure = heurePrevue(cron, jour);
    if (!heure) continue;
    const [h, m] = heure.split(":").map(Number);
    const moment = new Date(jour.getFullYear(), jour.getMonth(), jour.getDate(), h, m);
    if (moment <= maintenant) return moment;
  }
  return null;
}

/** Controles dus, dans l'ordre du registre. `derniers` : id -> ISO du dernier lancement. */
export function controlesDus(controles, derniers = {}, maintenant = new Date()) {
  return controles.filter((c) => {
    const prevu = dernierPassagePrevu(c.cron, maintenant);
    if (!prevu) return false;
    const dernier = derniers[c.id] ? new Date(derniers[c.id]) : null;
    return !dernier || Number.isNaN(dernier.getTime()) || dernier < prevu;
  });
}

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** '30 7 * * *' -> 'tous les jours à 07:30' ; '0 7 * * 1' -> 'le lundi à 07:00'. */
export function horaireLisible(cron) {
  const [minute, heure, , , jour] = String(cron).split(/\s+/);
  const hh = `${heure.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  if (jour === "*") return `tous les jours à ${hh}`;
  return /^\d$/.test(jour) ? `le ${JOURS[Number(jour) % 7]} à ${hh}` : `${cron}`;
}

/**
 * Les controles vus comme des taches planifiees, pour « Attendus aujourd'hui » :
 * les memes consignes factices (chemin du rapport promis) et la meme forme de
 * config que l'appli Claude, sans toucher a la logique des agents attendus.
 */
export function commeTachesPlanifiees(controles, derniers = {}) {
  return {
    taches: controles.map((c) => ({
      id: c.id,
      skill: `rapports-agents\\${c.site}\\<AAAA-MM-JJ>\\${c.id}.json "titre":"${c.titre}"`,
    })),
    scheduledTasks: controles.map((c) => ({
      id: c.id,
      displayName: c.titre,
      cronExpression: c.cron,
      enabled: true,
      lastRunAt: derniers[c.id] ?? null,
    })),
  };
}

/**
 * Fusionne les controles dans les taches de Claude. Une tache Claude qui porte
 * le meme id (l'ancien agent, pas encore supprime) est remplacee.
 */
export function fusionnerTaches({ taches = [], config = null }, controles, derniers) {
  const scripts = commeTachesPlanifiees(controles, derniers);
  const ids = new Set(controles.map((c) => c.id));
  let claude = [];
  try {
    claude = JSON.parse(config ?? "").scheduledTasks ?? [];
  } catch {
    // config de Claude absente : les controles restent attendus
  }
  return {
    taches: [...taches.filter((t) => !ids.has(t.id)), ...scripts.taches],
    config: JSON.stringify({ scheduledTasks: [...claude.filter((t) => !ids.has(t.id)), ...scripts.scheduledTasks] }),
  };
}
