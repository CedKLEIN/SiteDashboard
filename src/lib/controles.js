/**
 * Planning des controles automatiques (dossier controles/ du depot).
 *
 * Chaque tache a un horaire cron (modele, ou agent qui le precise : voir
 * controles/lib/registre.mjs, lu au lancement par la commande registre_agents).
 * Elle est due quand son dernier passage prevu est posterieur a son dernier
 * lancement : une tache manquee parce que l'appli etait fermee est rattrapee a
 * la reouverture, une seule fois. Fonctions pures ; le lancement est dans
 * useControles.js.
 */
import { heurePrevue } from "./tachesPlanifiees";

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

/**
 * Le registre avec les reglages de l'utilisateur : horaire modifie (`horaires` :
 * id -> cron) et agents desactives (`desactives` : liste d'id). Le registre du
 * depot garde les horaires par defaut.
 */
export function appliquerReglages(controles, { horaires = {}, desactives = [] } = {}) {
  return controles.map((c) => ({
    ...c,
    cronParDefaut: c.cron,
    cron: horaires[c.id] || c.cron,
    actif: !desactives.includes(c.id),
  }));
}

/**
 * Une tache que SiteDashboard voit pour la premiere fois n'est pas rattrapee :
 * on note sa date d'ajout comme dernier lancement, son premier passage sera le
 * prochain de son horaire. Sans ca, l'installation lancerait d'un coup des
 * sessions Claude deja faites par l'ancienne tache (ou couteuses et inutiles).
 * Renvoie null si rien n'est nouveau.
 */
export function enregistrerNouvelles(controles, derniers = {}, maintenant = new Date()) {
  const nouvelles = controles.filter((c) => !derniers[c.id]);
  if (nouvelles.length === 0) return null;
  return { ...derniers, ...Object.fromEntries(nouvelles.map((c) => [c.id, maintenant.toISOString()])) };
}

/** File d'attente d'un controle : les agents Claude, longs, ne bloquent pas les scripts. */
export function file(controle) {
  return controle.type === "claude" ? "claude" : "script";
}

/** Controles dus, dans l'ordre du registre. `derniers` : id -> ISO du dernier lancement. */
export function controlesDus(controles, derniers = {}, maintenant = new Date()) {
  return controles.filter((c) => {
    // Une tache mal configuree est lancee quand meme : son rapport en echec le dit
    if (c.actif === false) return false;
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
  if (jour === "1-5") return `du lundi au vendredi à ${hh}`;
  if (jour === "0,6" || jour === "6,0") return `le week-end à ${hh}`;
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
      enabled: c.actif !== false,
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

/** Choix proposes pour les jours, et leur champ cron. */
export const JOURS_PROPOSES = [
  { valeur: "*", libelle: "Tous les jours" },
  { valeur: "1-5", libelle: "Du lundi au vendredi" },
  { valeur: "0,6", libelle: "Le week-end" },
  { valeur: "1", libelle: "Le lundi" },
  { valeur: "2", libelle: "Le mardi" },
  { valeur: "3", libelle: "Le mercredi" },
  { valeur: "4", libelle: "Le jeudi" },
  { valeur: "5", libelle: "Le vendredi" },
  { valeur: "6", libelle: "Le samedi" },
  { valeur: "0", libelle: "Le dimanche" },
];

/** '30 7 * * 1' -> { heure: '07:30', jours: '1' } */
export function decomposerCron(cron) {
  const [minute, heure, , , jours] = String(cron).split(/\s+/);
  return { heure: `${heure.padStart(2, "0")}:${minute.padStart(2, "0")}`, jours };
}

/** ('07:30', '1') -> '30 7 * * 1' ; null si l'heure est illisible. */
export function composerCron(heure, jours) {
  const correspondance = /^(\d{1,2}):(\d{2})$/.exec(String(heure));
  if (!correspondance) return null;
  const [h, m] = [Number(correspondance[1]), Number(correspondance[2])];
  if (h > 23 || m > 59) return null;
  return `${m} ${h} * * ${jours}`;
}
