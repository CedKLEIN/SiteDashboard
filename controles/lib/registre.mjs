/**
 * Registre des taches : des MODELES generiques appliques a des SITES.
 *
 *  - modele (controles/modeles/<id>.json, dans le depot) : un script ou une
 *    consigne Claude, son horaire par defaut, ce qu'il demande a la fiche du site ;
 *  - fiche de site (%USERPROFILE%\.sitedashboard\sites\<cle>.json, hors du depot
 *    public : chemins locaux, pages, API) ;
 *  - agent (%USERPROFILE%\.sitedashboard\agents.json) : un modele applique a un
 *    site, avec son identifiant, et au besoin son horaire et ses parametres.
 *
 * Tout est lu au lancement : ajouter un agent ne demande pas de reinstaller.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const DOSSIER_CONFIG = path.join(os.homedir(), ".sitedashboard");
export const DOSSIER_SITES = path.join(DOSSIER_CONFIG, "sites");
export const FICHIER_AGENTS = path.join(DOSSIER_CONFIG, "agents.json");
export const DOSSIER_MODELES = path.join(import.meta.dirname, "..", "modeles");

/* ------------------------------------------------------- fonctions pures */

/** Valeur d'un chemin pointe ('sante.pages') dans un objet. */
export function valeur(objet, chemin) {
  return chemin.split(".").reduce((o, cle) => (o == null ? undefined : o[cle]), objet);
}

/** '{{site.cle}}' -> valeur ; les variables inconnues restent vides. */
export function remplir(texte, contexte) {
  return String(texte).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, chemin) => valeur(contexte, chemin) ?? "");
}

/**
 * Consigne d'un modele : `{{chemin}}` et `{{#si chemin}}...{{#sinon}}...{{/si}}`
 * (le bloc est garde si la valeur est renseignee et non fausse).
 */
export function rendre(texte, contexte) {
  const bloc = /\{\{#si\s+([\w.]+)\s*\}\}((?:(?!\{\{#si\s)[\s\S])*?)\{\{\/si\}\}/;
  let resultat = String(texte);
  // Du plus interieur au plus exterieur : un bloc sans #si imbrique a chaque tour
  for (let m = bloc.exec(resultat); m; m = bloc.exec(resultat)) {
    const [alors, sinon = ""] = m[2].split("{{#sinon}}");
    const v = valeur(contexte, m[1]);
    const vrai = Boolean(v) && !(Array.isArray(v) && v.length === 0);
    resultat = resultat.slice(0, m.index) + (vrai ? alors : sinon) + resultat.slice(m.index + m[0].length);
  }
  return remplir(resultat, contexte);
}

/** Identifiant propose pour un modele applique a un site. */
export function identifiant(modele, site, existants = []) {
  const base = `${modele.id}-${site.cle}`;
  let id = base;
  for (let i = 2; existants.includes(id); i += 1) id = `${base}-${i}`;
  return id;
}

/** Champs requis par le modele absents de la fiche. */
export function manquants(modele, site) {
  return (modele.requis ?? []).filter((champ) => {
    const v = valeur(site, champ);
    return v == null || v === "" || (Array.isArray(v) && v.length === 0);
  });
}

/**
 * Les agents prets a lancer. Un agent dont le modele ou la fiche manque reste
 * dans la liste avec `erreur` : il doit se voir, pas disparaitre.
 */
export function composer({ modeles, sites, agents }) {
  const parModele = new Map(modeles.map((m) => [m.id, m]));
  const parSite = new Map(sites.map((s) => [s.cle, s]));
  return agents.map((agent) => {
    const modele = parModele.get(agent.modele);
    const site = parSite.get(agent.site);
    const base = { id: agent.id, modele: agent.modele, siteCle: agent.site, site: site?.domaine ?? agent.site };
    if (!modele) return { ...base, titre: agent.titre ?? agent.id, type: "script", cron: agent.cron ?? "0 7 * * *", erreur: `modèle inconnu : ${agent.modele}` };
    const commun = {
      ...base,
      titre: agent.titre ?? modele.titre,
      type: modele.type,
      // null : pas d'horaire, lancee a la main ou a la demande d'un autre controle
      cron: agent.cron ?? modele.cron ?? null,
      declenchePar: modele.declenchePar ?? null,
      chrome: Boolean(modele.chrome),
      dureeMaxMin: modele.dureeMaxMin,
      script: modele.script,
      consigne: modele.consigne,
      parametres: { ...modele.parametres, ...agent.parametres },
    };
    if (!site) return { ...commun, erreur: `fiche de site introuvable : ${agent.site}` };
    const absents = manquants(modele, site);
    return {
      ...commun,
      // Un agent Claude ne soumet rien a Bing si un controle Bing le fait deja pour ce site
      soumissionBingAuto: agents.some((a) => a.modele === "bing" && a.site === agent.site),
      projet: site.projet,
      fichierSuivi: modele.suivi ? path.join(site.projet ?? "", remplir(modele.suivi, { site })) : null,
      ...(absents.length ? { erreur: `fiche ${site.cle} incomplète : ${absents.join(", ")}` } : {}),
    };
  });
}

/**
 * Pour le choix « Ajouter une tache » : chaque modele, avec les sites ou il
 * s'applique, ceux ou il manque des champs, et ceux qui l'ont deja.
 */
export function applicables({ modeles, sites, agents }) {
  return modeles.map((modele) => ({
    id: modele.id,
    titre: modele.titre,
    description: modele.description,
    type: modele.type,
    cron: modele.cron,
    sites: sites.map((site) => ({
      cle: site.cle,
      nom: site.nom ?? site.domaine,
      domaine: site.domaine,
      manquants: manquants(modele, site),
      deja: agents.some((a) => a.modele === modele.id && a.site === site.cle),
    })),
  }));
}

/** Ce que l'interface recoit : sans les fiches completes. */
export function pourInterface(controles) {
  return controles.map(({ id, modele, siteCle, site, titre, type, cron, declenchePar, chrome, erreur }) => ({
    id, modele, siteCle, site, titre, type, cron, declenchePar: declenchePar ?? null, chrome, ...(erreur ? { erreur } : {}),
  }));
}

/* ------------------------------------------------------------- fichiers */

function lireJson(fichier, defaut) {
  try {
    return JSON.parse(readFileSync(fichier, "utf8").replace(/^﻿/, ""));
  } catch {
    return defaut;
  }
}

function lireDossier(dossier) {
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((n) => lireJson(path.join(dossier, n), null))
    .filter(Boolean);
}

export function chargerTout({ modeles = DOSSIER_MODELES, sites = DOSSIER_SITES, agents = FICHIER_AGENTS } = {}) {
  return { modeles: lireDossier(modeles), sites: lireDossier(sites), agents: lireJson(agents, []) };
}

/** Le registre complet, fiches comprises (pour lancer un agent). */
export function chargerRegistre(sources) {
  const tout = chargerTout(sources);
  const parSite = new Map(tout.sites.map((s) => [s.cle, s]));
  return composer(tout).map((c) => ({ ...c, fiche: parSite.get(c.siteCle) ?? null }));
}

export function ajouterAgent(modeleId, siteCle, sources = {}) {
  const tout = chargerTout(sources);
  const modele = tout.modeles.find((m) => m.id === modeleId);
  const site = tout.sites.find((s) => s.cle === siteCle);
  if (!modele) throw new Error(`modèle inconnu : ${modeleId}`);
  if (!site) throw new Error(`fiche de site introuvable : ${siteCle}`);
  const absents = manquants(modele, site);
  if (absents.length) throw new Error(`la fiche ${site.cle} ne renseigne pas : ${absents.join(", ")}`);
  const agent = { id: identifiant(modele, site, tout.agents.map((a) => a.id)), modele: modele.id, site: site.cle };
  ecrireAgents([...tout.agents, agent], sources.agents);
  return agent;
}

export function retirerAgent(id, sources = {}) {
  const { agents } = chargerTout(sources);
  if (!agents.some((a) => a.id === id)) throw new Error(`agent inconnu : ${id}`);
  ecrireAgents(agents.filter((a) => a.id !== id), sources.agents);
  return { id };
}

function ecrireAgents(agents, fichier = FICHIER_AGENTS) {
  mkdirSync(path.dirname(fichier), { recursive: true });
  writeFileSync(fichier, `${JSON.stringify(agents, null, 2)}\n`, "utf8");
}
