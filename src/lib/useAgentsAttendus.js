import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { JOURS_HISTORIQUE, dateDepuis, lireRapport } from "./rapportsAgents";
import { agentsAttendus } from "./tachesPlanifiees";
import { REGISTRE, fusionnerTaches } from "./controles";
import { tracer } from "./trace";

/**
 * Agents attendus aujourd'hui, relus a chaque `rafraichissement` (le cycle de
 * supervision) : un agent qui se bloque passe en retard sans rien toucher.
 *
 * Charge au niveau de l'application, pas de la page Agents, pour que le menu
 * puisse signaler un retard quel que soit l'onglet ouvert.
 */
export function useAgentsAttendus(rafraichissement, controles = REGISTRE, derniersControles = {}) {
  const [etat, setEtat] = useState({ attendus: [], configTrouvee: true });
  // Chaine stable : un nouvel objet identique ne doit pas relancer la lecture
  const cle = JSON.stringify({ controles, derniers: derniersControles });

  useEffect(() => {
    let annule = false;
    Promise.all([
      invoke("lire_taches_planifiees"),
      invoke("lire_rapports_agents", { depuis: dateDepuis(JOURS_HISTORIQUE) }),
    ])
      .then(([taches, dossier]) => {
        if (annule) return;
        // Les controles automatiques sont attendus comme des agents
        const reglages = JSON.parse(cle);
        const fusion = fusionnerTaches(taches, reglages.controles, reglages.derniers);
        setEtat({
          attendus: agentsAttendus({
            taches: fusion.taches,
            config: fusion.config,
            rapports: dossier.fichiers.map(lireRapport),
          }),
          configTrouvee: Boolean(taches.config) || REGISTRE.length > 0,
        });
      })
      .catch((e) => tracer("agents", `lecture des taches planifiees impossible: ${e}`));
    return () => {
      annule = true;
    };
  }, [rafraichissement, cle]);

  return etat;
}
