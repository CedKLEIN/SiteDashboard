import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { JOURS_HISTORIQUE, dateDepuis, lireRapport } from "./rapportsAgents";
import { agentsAttendus } from "./tachesPlanifiees";
import { fusionnerTaches } from "./controles";
import { tracer } from "./trace";

/**
 * Agents attendus aujourd'hui, relus a chaque `rafraichissement` (le cycle de
 * supervision) : un agent qui se bloque passe en retard sans rien toucher.
 *
 * Charge au niveau de l'application, pas d'une page : le menu signale un
 * retard quel que soit l'onglet ouvert, et les rapports lus servent aussi aux
 * statuts des agents du tableau de bord et de la fiche de chaque site.
 */
export function useAgentsAttendus(rafraichissement, controles = [], derniersControles = {}, ajoutsControles = {}) {
  const [etat, setEtat] = useState({ attendus: [], configTrouvee: true, rapports: [], dossier: "", erreur: null });
  // Chaine stable : un nouvel objet identique ne doit pas relancer la lecture
  const cle = JSON.stringify({ controles, derniers: derniersControles, ajouts: ajoutsControles });

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
        const fusion = fusionnerTaches(taches, reglages.controles, reglages.derniers, reglages.ajouts);
        const rapports = dossier.fichiers.map(lireRapport);
        setEtat({
          attendus: agentsAttendus({ taches: fusion.taches, config: fusion.config, rapports }),
          configTrouvee: Boolean(taches.config) || reglages.controles.length > 0,
          rapports,
          dossier: dossier.dossier ?? "",
          erreur: null,
        });
      })
      .catch((e) => {
        tracer("agents", `lecture des taches planifiees impossible: ${e}`);
        if (!annule) setEtat((avant) => ({ ...avant, erreur: String(e) }));
      });
    return () => {
      annule = true;
    };
  }, [rafraichissement, cle]);

  return etat;
}
