/**
 * Onglet Agents vu par site : un statut et un resume par site, ce qui demande
 * une action, et pour chaque tache son etat du jour et ses derniers jours.
 *
 * Fonctions pures : les rapports (rapportsAgents.js), les agents attendus
 * aujourd'hui (tachesPlanifiees.js) et le registre des taches (controles.js)
 * arrivent deja lus. Le resume est assemble a partir des rapports, sans IA :
 * le meme etat donne toujours le meme texte.
 */
import { STATUTS_RAPPORT, dateDepuis, domaine, momentRapport, rattacherSite } from "./rapportsAgents";
import { horaireLisible } from "./controles";

/** Passages gardes dans la frise et l'historique d'une tache. */
export const RAPPORTS_MAX = 7;

/** Une tache qui tourne en ce moment : bleu, distinct des etats et de l'accent. */
export const COULEUR_EN_COURS = "#38bdf8";

/** Duree d'un passage : '45 s', '12 min', '1 h 05' ; null sans debut ou fin lisibles. */
export function dureeRapport(debut, fin) {
  const ms = Date.parse(fin) - Date.parse(debut);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const secondes = Math.round(ms / 1000);
  if (secondes < 60) return `${secondes} s`;
  const minutes = Math.round(secondes / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

/** Statut d'un site, du pire au meilleur. */
export const STATUTS_SITE = {
  action: { libelle: "Action requise", etat: "ko" },
  attention: { libelle: "À regarder", etat: "partiel" },
  ok: { libelle: "Tout va bien", etat: "ok" },
  aucun: { libelle: "Rien aujourd'hui", etat: "aucun" },
};

const RANG = { aucun: 0, ok: 1, attention: 2, action: 3 };

/**
 * Niveau du jour d'une tache : `action` (echec, bloquee, pas lancee),
 * `attention`, `ok`, `en_cours`, `prevu`, ou `aucun` (rien attendu ni recu).
 */
export function niveauTache({ attendu, rapportDuJour, enCours }) {
  const rapport = attendu?.rapport ?? rapportDuJour ?? null;
  if (rapport) return rapport.statut === "echec" ? "action" : rapport.statut;
  if (enCours) return "en_cours";
  if (attendu?.situation === "bloque" || attendu?.situation === "non_lance") return "action";
  if (attendu?.situation === "en_cours") return "en_cours";
  if (attendu?.situation === "prevu") return "prevu";
  return "aucun";
}

/** Libelle court du niveau d'une tache, pour sa pastille. */
export function libelleNiveau(tache) {
  const { niveau, attendu } = tache;
  if (tache.enCours) return "En cours";
  if (attendu?.situation === "bloque") return "Bloquée ?";
  if (attendu?.situation === "non_lance") return "Pas lancée";
  if (niveau === "action") return "Échec";
  if (niveau === "attention") return "À regarder";
  if (niveau === "ok") return "OK";
  if (niveau === "en_cours") return "En cours";
  if (niveau === "prevu") return attendu?.prevueA ? `Prévue à ${attendu.prevueA}` : "Prévue";
  return "Rien aujourd'hui";
}

/** Etat de supervision (couleurs de statut.js) d'un niveau de tache. */
export function etatNiveau(niveau) {
  if (niveau === "action") return "ko";
  if (niveau === "attention") return "partiel";
  if (niveau === "ok") return "ok";
  return "aucun";
}

/**
 * Les derniers passages d'une tache, un carre chacun, du plus ancien au plus
 * recent : [{ cle, date, debut, statut } | { enCours: true } | null]. Un
 * carre est un passage, pas un jour : sept relances dans la journee remplissent
 * la frise. La tache qui tourne ajoute un carre a droite et pousse le plus ancien.
 * Moins de passages que de carres : des cases vides (null) a gauche.
 */
export function frise(rapportsRecentsDabord, { enCours = false, places = RAPPORTS_MAX } = {}) {
  const passages = rapportsRecentsDabord
    .slice(0, enCours ? places - 1 : places)
    .reverse()
    .map((r) => ({ cle: r.cle, date: r.date, debut: r.debut, statut: r.statut }));
  if (enCours) passages.push({ enCours: true });
  return [...Array(places - passages.length).fill(null), ...passages];
}

/**
 * Ce qui demande une action de l'utilisateur aujourd'hui : les points en echec
 * ou a regarder des rapports du jour, et les taches bloquees ou pas lancees.
 * Une meme phrase signalee par deux taches n'apparait qu'une fois.
 */
export function aFaire(taches) {
  const vus = new Set();
  const liste = [];
  const ajouter = (niveau, texte, tache) => {
    const cle = texte.trim().toLowerCase();
    if (!cle || vus.has(cle)) return;
    vus.add(cle);
    // `court` pour la liste (premiere phrase), `texte` en entier au survol
    liste.push({ niveau, texte: texte.trim(), court: phrase(texte, 180), tache: tache.titre, id: tache.id });
  };
  for (const tache of taches) {
    const { attendu, rapportDuJour } = tache;
    const rapport = attendu?.rapport ?? rapportDuJour;
    if (!rapport && (attendu?.situation === "bloque" || attendu?.situation === "non_lance")) {
      ajouter("echec", attendu.message, tache);
    }
    for (const point of rapport?.points ?? []) {
      if (point.niveau !== "ok") ajouter(point.niveau, point.texte, tache);
    }
    // Un echec sans point qui le dise : son resume en tient lieu
    if (rapport?.statut === "echec" && !(rapport.points ?? []).some((p) => p.niveau === "echec")) {
      ajouter("echec", rapport.resume || "Rapport en échec", tache);
    }
  }
  // Les echecs d'abord
  return liste.sort((a, b) => (a.niveau === "echec" ? 0 : 1) - (b.niveau === "echec" ? 0 : 1));
}

/**
 * La tache a-t-elle sa pastille sur la carte du site ? Une tache sans horaire
 * (les correctifs, lances a la demande) tourne rarement : sans passage du jour,
 * un « Rien aujourd'hui » de plus n'apprend rien.
 */
export function surLaCarte(tache) {
  const aLaDemande = tache.controle && !tache.controle.cron;
  return !aLaDemande || tache.enCours || tache.niveau !== "aucun";
}

/** Statut d'un site : le pire de ses taches du jour. */
export function statutSite(taches) {
  let pire = "aucun";
  for (const { niveau } of taches) {
    const n = niveau === "en_cours" || niveau === "prevu" ? "aucun" : niveau;
    if (RANG[n] > RANG[pire]) pire = n;
  }
  return pire;
}

/** Premiere phrase d'un texte, raccourcie. */
function phrase(texte, max = 140) {
  const premiere = String(texte ?? "").split(/(?<=[.!?])\s/)[0].trim();
  return premiere.length > max ? `${premiere.slice(0, max - 1)}…` : premiere;
}

/**
 * Resume d'une ou deux phrases pour la carte du site : la tache qui va le plus
 * mal d'abord (son resume), puis le compte des autres.
 */
export function resumeSite(taches) {
  const duJour = taches.filter((t) => ["action", "attention", "ok"].includes(t.niveau));
  if (duJour.length === 0) {
    const prochaine = taches.find((t) => t.niveau === "prevu" || t.niveau === "en_cours");
    if (prochaine?.niveau === "en_cours") return `${prochaine.titre} en cours.`;
    return prochaine ? `Rien encore aujourd'hui : ${prochaine.titre.toLowerCase()} ${libelleNiveau(prochaine).toLowerCase()}.` : "Aucune tâche aujourd'hui.";
  }
  const parGravite = [...duJour].sort((a, b) => RANG[b.niveau] - RANG[a.niveau]);
  const morceaux = [];
  for (const t of parGravite.filter((x) => x.niveau !== "ok").slice(0, 2)) {
    const rapport = t.attendu?.rapport ?? t.rapportDuJour;
    morceaux.push(`${t.titre} : ${phrase(rapport?.resume || t.attendu?.message || libelleNiveau(t))}`);
  }
  const ok = duJour.filter((t) => t.niveau === "ok").length;
  const autres = parGravite.filter((x) => x.niveau !== "ok").length - morceaux.length;
  if (autres > 0) morceaux.push(`${autres} autre(s) tâche(s) à regarder.`);
  if (ok > 0) morceaux.push(morceaux.length ? `${ok} autre(s) OK.` : `${ok === 1 ? "La tâche du jour est OK" : `Les ${ok} tâches du jour sont OK`}.`);
  return morceaux.map((m) => (/[.!?…]$/.test(m) ? m : `${m}.`)).join(" ");
}

/**
 * Tout l'onglet, site par site. Les taches d'un site : celles du registre
 * (controles), les taches planifiees attendues aujourd'hui, et les agents vus
 * dans les rapports recents (un ancien agent garde son historique).
 *
 * `enCours` : ids des taches lancees par l'appli qui tournent en ce moment.
 * Une tache qui tourne garde son niveau du jour (le rapport precedent compte
 * tant que le nouveau n'est pas ecrit) mais se montre en cours.
 *
 * Renvoie [{ cle, siteId, nom, couleur, statut, resume, aFaire, taches }], les sites
 * qui demandent une action d'abord.
 */
export function vueParSite({ rapports = [], attendus = [], controles = [], sites = [], enCours = [], aujourdhui = new Date() }) {
  const jour = dateDepuis(0, aujourdhui);
  const parSite = new Map();
  const tacheDe = (nomSite, id) => {
    const cle = domaine(nomSite) || nomSite;
    if (!parSite.has(cle)) parSite.set(cle, { cle, nomSite, taches: new Map() });
    const groupe = parSite.get(cle);
    if (!groupe.taches.has(id)) groupe.taches.set(id, { id, titre: id, rapports: [] });
    return groupe.taches.get(id);
  };

  for (const c of controles) {
    Object.assign(tacheDe(c.site, c.id), { titre: c.titre, controle: c, planning: horaireLisible(c.cron) });
  }
  for (const a of attendus) {
    const t = tacheDe(a.site, a.agent);
    t.attendu = { ...a };
    if (t.titre === t.id) t.titre = a.titre;
  }
  for (const r of rapports) {
    const t = tacheDe(r.site, r.agent);
    t.rapports.push(r);
    if (t.titre === t.id) t.titre = r.titre;
  }

  return [...parSite.values()]
    .map(({ cle, nomSite, taches }) => {
      const liste = [...taches.values()].map((t) => {
        // Un jour avant tout : un passage tardif range dans le dossier du lendemain reste a sa place
        const tries = [...t.rapports].sort((a, b) => b.date.localeCompare(a.date) || momentRapport(b) - momentRapport(a));
        // Le dernier passage du jour fait foi : une relance qui corrige un probleme l'efface de « À faire »
        const rapportDuJour = tries.find((r) => r.date === jour) ?? null;
        if (t.attendu && rapportDuJour) Object.assign(t.attendu, { rapport: rapportDuJour, situation: "recu" });
        const tourne = enCours.includes(t.id) || t.attendu?.situation === "en_cours";
        const tache = {
          ...t,
          rapports: tries.slice(0, RAPPORTS_MAX),
          rapportDuJour,
          frise: frise(tries, { enCours: tourne }),
          enCours: tourne,
        };
        return { ...tache, niveau: niveauTache(tache) };
      });
      // Les taches qui vont le plus mal en tete, puis par titre
      liste.sort((a, b) => RANG[etatVersRang(b.niveau)] - RANG[etatVersRang(a.niveau)] || a.titre.localeCompare(b.titre));
      const site = rattacherSite(nomSite, sites);
      return {
        cle,
        siteId: site?.id ?? null,
        nom: site?.nom ?? nomSite,
        couleur: site?.couleur ?? null,
        statut: statutSite(liste),
        resume: resumeSite(liste),
        aFaire: aFaire(liste),
        taches: liste,
      };
    })
    .sort((a, b) => RANG[b.statut] - RANG[a.statut] || a.nom.localeCompare(b.nom));
}

function etatVersRang(niveau) {
  return niveau === "en_cours" || niveau === "prevu" ? "aucun" : niveau;
}

/** Statut d'un rapport -> etat de supervision, pour les carres de la frise. */
export function etatRapport(statut) {
  return statut ? (STATUTS_RAPPORT[statut]?.etat ?? "ko") : "aucun";
}
