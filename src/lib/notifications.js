import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { etatSite } from "./statut";
import { tracer } from "./trace";

/**
 * Notifications Windows : un site qui tombe, un agent bloque ou en echec.
 *
 * On ne notifie que les CHANGEMENTS : un site en panne ne doit pas sonner a
 * chaque minute, seulement quand il tombe et quand il revient. Au demarrage,
 * l'etat precedent est suppose sain : ce qui va mal a l'ouverture est signale
 * une fois.
 */

/** Ce qui merite une alerte, pour un site : au moins un check en echec. */
function alerteSite(site) {
  const etat = etatSite(site);
  if (etat !== "ko" && etat !== "partiel") return null;
  const echecs = site.nb_resultats - site.nb_ok;
  return {
    titre: etat === "ko" ? `${site.nom} est en panne` : `${site.nom} : un check echoue`,
    corps:
      etat === "ko"
        ? `Tous ses checks echouent (${site.nb_resultats}).`
        : `${echecs} check(s) en echec sur ${site.nb_resultats}.`,
  };
}

/** Ce qui merite une alerte, pour un agent attendu : bloque, pas lance, ou rapport en echec. */
function alerteAgent(attendu) {
  const nom = `${attendu.titre} (${attendu.site})`;
  if (attendu.situation === "bloque") return { titre: `Agent bloque : ${nom}`, corps: attendu.message };
  if (attendu.situation === "non_lance") return { titre: `Agent pas lance : ${nom}`, corps: attendu.message };
  if (attendu.rapport?.statut === "echec") {
    return { titre: `Agent en echec : ${nom}`, corps: attendu.rapport.resume || attendu.message };
  }
  return null;
}

/**
 * Compare l'etat courant au precedent et renvoie les notifications a envoyer.
 *
 * `elements` : [{ cle, alerte: {titre, corps} | null, retour }] ; `precedent` :
 * Map cle -> titre de l'alerte en cours. Une alerte qui change de titre (un
 * site partiel qui tombe completement) est renotifiee ; un element qui va
 * mieux produit son message de `retour`, s'il en a un.
 */
export function changements(elements, precedent = new Map()) {
  const suivant = new Map();
  const aEnvoyer = [];
  for (const { cle, alerte, retour } of elements) {
    const avant = precedent.get(cle) ?? null;
    if (alerte) {
      suivant.set(cle, alerte.titre);
      if (alerte.titre !== avant) aEnvoyer.push(alerte);
    } else if (avant && retour) {
      aEnvoyer.push(retour);
    }
  }
  return { aEnvoyer, suivant };
}

export function elementsSites(etats) {
  return etats.map((site) => ({
    cle: `site:${site.id}`,
    alerte: alerteSite(site),
    retour: { titre: `${site.nom} est revenu`, corps: "Tous ses checks repassent au vert." },
  }));
}

export function elementsAgents(attendus) {
  // Pas de message de retour : un agent qui finit par rendre son rapport se
  // voit dans l'onglet Agents, inutile de sonner pour une bonne nouvelle.
  return attendus.map((a) => ({ cle: `agent:${a.id}`, alerte: alerteAgent(a) }));
}

let autorisation = null;

async function autorise() {
  if (autorisation === null) {
    autorisation = (async () => {
      if (await isPermissionGranted()) return true;
      return (await requestPermission()) === "granted";
    })().catch((e) => {
      tracer("notification", `autorisation impossible: ${e}`);
      return false;
    });
  }
  return autorisation;
}

/** Previent que la base est abimee au-dela d'un index : a restaurer depuis une sauvegarde. */
export async function alerterBaseAbimee(messages) {
  if (!(await autorise())) return;
  sendNotification({
    title: "SiteDashboard : base de donnees abimee",
    body: `${messages[0] ?? "controle d'integrite en echec"} - restaure une sauvegarde (Preferences > Donnees).`,
  });
}

/** Envoie une notification de test ; false si Windows ne l'autorise pas. */
export async function notificationTest() {
  if (!(await autorise())) return false;
  sendNotification({
    title: "SiteDashboard",
    body: "Les notifications fonctionnent : un site qui tombe ou un agent bloque s'affichera ici.",
  });
  return true;
}

/**
 * Un suivi par famille (sites, agents) : chacun garde ses alertes en cours et
 * n'envoie que les changements. `actives` permet de couper les notifications
 * sans perdre le suivi : les reactiver ne renotifie pas ce qui etait deja connu.
 */
export function creerSuivi() {
  let precedent = new Map();
  return async function notifier(elements, actives = true) {
    const { aEnvoyer, suivant } = changements(elements, precedent);
    precedent = suivant;
    if (!actives || aEnvoyer.length === 0 || !(await autorise())) return aEnvoyer;
    for (const { titre, corps } of aEnvoyer) {
      try {
        sendNotification({ title: titre, body: corps });
      } catch (e) {
        tracer("notification", `envoi impossible: ${e}`);
      }
    }
    return aEnvoyer;
  };
}
