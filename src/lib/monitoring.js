import { invoke } from "@tauri-apps/api/core";
import {
  checksActifs,
  enregistrerValeur,
  enregistrerVerification,
  purgerVerifications,
  consoliderJours,
} from "./queries";
import { alerterBaseAbimee } from "./notifications";
import { sauvegarderSiBesoin } from "./sauvegarde";
import { tracer } from "./trace";
import { aujourdhuiIso } from "./format";
import { evaluerCertificat } from "./statut";
import { evaluerDomaine, evaluerRedirection, evaluerReponse } from "./assertions";

/**
 * Garde-fou contre le chevauchement: un cycle peut depasser l'intervalle
 * (chaque check a 15 s de timeout), et deux cycles en parallele doubleraient
 * les requetes envoyees aux sites pour rien.
 */
let enCours = false;

/** Jour (AAAA-MM-JJ) du dernier entretien de la base. */
let jourDernierEntretien = null;

/** Profondeur de l'historique des verifications, en jours. */
export const JOURS_HISTORIQUE_VERIFICATIONS = 30;

/**
 * Entretien de la base au premier cycle de chaque jour : sauvegarde si la
 * derniere date d'une semaine, puis purge de l'historique.
 *
 * La purge, faite seulement au demarrage, ne tournait jamais pour une appli
 * laissee ouverte des semaines : la table grossissait sans limite (une ligne
 * par check et par minute). La sauvegarde passe avant pour garder l'historique
 * le plus long. Un echec est trace sans bloquer le cycle.
 */
async function entretienQuotidien(maintenant) {
  // Jour LOCAL : en UTC, l'entretien passait a 1 h ou 2 h du matin, et la veille
  // restait non resumee jusque-la
  const jour = aujourdhuiIso(maintenant);
  if (jour === jourDernierEntretien) return;
  jourDernierEntretien = jour;
  try {
    const resultat = await sauvegarderSiBesoin(maintenant);
    if (resultat) {
      const { chemin, integrite } = resultat;
      tracer("sauvegarde", `base sauvegardee: ${chemin}`);
      if (integrite.repare) tracer("sauvegarde", `${integrite.avant} defaut(s) d'index repare(s)`);
      if (integrite.etat === "grave") {
        tracer("sauvegarde", `base abimee: ${integrite.messages.slice(0, 3).join(" | ")}`);
        await alerterBaseAbimee(integrite.messages);
      }
    }
  } catch (erreur) {
    tracer("sauvegarde", `sauvegarde impossible: ${erreur}`);
  }
  try {
    // Le resume par jour d'abord : la purge efface ce qu'il n'aurait pas encore lu
    await consoliderJours();
    await purgerVerifications(JOURS_HISTORIQUE_VERIFICATIONS);
  } catch (erreur) {
    tracer("supervision", `purge impossible: ${erreur}`);
  }
}

/**
 * Lance le bon type de verification et normalise le resultat pour la base.
 *
 * Aucun verdict n'est rendu ici ni cote Rust: les commandes renvoient des faits,
 * et ce sont les fonctions `evaluer*` qui decident. Un seul endroit a corriger
 * quand une regle change, et toutes sont testables sans reseau.
 */
async function executer(check) {
  if (check.type === "tls") {
    const brut = await invoke("verifier_certificat", { url: check.url });
    const verdict = evaluerCertificat(brut, check.seuil_jours ?? undefined);
    return {
      ok: verdict.ok,
      statut: null,
      latence_ms: null,
      jours_restants: brut.jours_restants ?? null,
      // On stocke le message meme quand tout va bien: l'ecran de detail affiche
      // "valide encore 68 jours", ce qui est l'information utile ici.
      erreur: verdict.ok ? null : verdict.message,
    };
  }

  if (check.type === "redirection") {
    const brut = await invoke("executer_redirection", { url: check.url });
    const verdict = evaluerRedirection(check, brut);
    return {
      ok: verdict.ok,
      statut: brut.statut ?? null,
      latence_ms: brut.latence_ms ?? null,
      erreur: verdict.message,
    };
  }

  if (check.type === "domaine") {
    const brut = await invoke("verifier_domaine", { domaine: check.domaine ?? "" });
    const verdict = evaluerDomaine(check, brut);
    return {
      ok: verdict.ok,
      statut: null,
      latence_ms: brut.latence_ms ?? null,
      jours_restants: brut.jours_restants ?? null,
      adresses: (brut.adresses ?? []).join(", ") || null,
      erreur: verdict.message,
    };
  }

  if (check.type === "valeur") {
    const brut = await invoke("lire_valeur", {
      url: check.url,
      extracteur: check.extracteur ?? "",
    });
    if (brut.valeur != null) await enregistrerValeur(check.id, brut.valeur);

    // Volontairement toujours OK: un retard de deploiement n'est pas une panne,
    // c'est une information. Meme une extraction ratee ne fait pas rougir le
    // site - le check d'accueil est la pour dire si le site repond.
    return {
      ok: true,
      statut: brut.statut ?? null,
      latence_ms: brut.latence_ms ?? null,
      erreur: brut.erreur ?? null,
    };
  }

  const brut = await invoke("executer_check", {
    url: check.url,
    doitContenir: check.doit_contenir ?? null,
    // Le corps n'etait lu que pour chercher un fragment: sans ce drapeau, une
    // taille minimale seule serait silencieusement ignoree.
    lireCorps: check.taille_min_octets != null || check.occurrences_min != null,
  });
  const verdict = evaluerReponse(check, brut);
  return {
    ok: verdict.ok,
    statut: brut.statut ?? null,
    latence_ms: brut.latence_ms ?? null,
    taille: brut.taille ?? null,
    occurrences: brut.occurrences ?? null,
    erreur: verdict.message,
  };
}

/** Execute tous les checks actifs, en serie, et enregistre chaque resultat. */
export async function lancerCycle() {
  if (enCours) return { ignore: true, checks: 0 };
  enCours = true;

  try {
    await entretienQuotidien(new Date());
    const checks = await checksActifs();

    // En serie volontairement: on supervise une poignee de sites, et on prefere
    // etaler les requetes plutot que de tout envoyer d'un coup.
    for (const check of checks) {
      try {
        await enregistrerVerification(check.id, await executer(check));
      } catch (erreur) {
        // Un check qui explose ne doit pas interrompre les suivants
        await enregistrerVerification(check.id, {
          ok: false,
          statut: null,
          latence_ms: null,
          erreur: String(erreur),
        });
      }
    }

    return { ignore: false, checks: checks.length };
  } finally {
    enCours = false;
  }
}
