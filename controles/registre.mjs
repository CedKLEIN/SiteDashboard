/**
 * Registre des taches pour SiteDashboard (voir lib/registre.mjs) :
 *   node controles/registre.mjs liste
 *   node controles/registre.mjs ajouter <modele> <site>
 *   node controles/registre.mjs retirer <agent>
 * Derniere ligne de la sortie : la reponse JSON, lue par SiteDashboard.
 */
import { pathToFileURL } from "node:url";
import { DOSSIER_SITES, FICHIER_AGENTS, ajouterAgent, applicables, chargerTout, composer, pourInterface, retirerAgent } from "./lib/registre.mjs";

export function liste(sources) {
  const tout = chargerTout(sources);
  return {
    controles: pourInterface(composer(tout)),
    modeles: applicables(tout),
    fichiers: { sites: DOSSIER_SITES, agents: FICHIER_AGENTS },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [action, ...args] = process.argv.slice(2);
  try {
    const actions = {
      liste: () => liste(),
      ajouter: () => ({ ajoute: ajouterAgent(args[0], args[1]) }),
      retirer: () => ({ retire: retirerAgent(args[0]) }),
    };
    if (!actions[action]) throw new Error(`action inconnue : ${action}`);
    console.log(JSON.stringify(actions[action]()));
  } catch (e) {
    console.log(JSON.stringify({ erreur: e.message }));
    process.exit(1);
  }
}
