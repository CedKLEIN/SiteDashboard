import { useMemo } from "react";
import ControlesAutomatiques from "../components/ControlesAutomatiques";
import { Carte, EtatVide } from "../components/ui";
import { groupesParSite } from "../lib/reglagesAgents";

/**
 * Onglet Agents : les reglages des taches planifiees, site par site
 * (activation, horaire, lancement, retrait, ajout, et ce qu'un site n'a pas
 * alors que les autres l'ont). Les statuts du jour et les rapports passes sont
 * dans la fiche de chaque site, ouverte depuis le tableau de bord.
 */
export default function Agents({ sites = [], vues = [], configTrouvee = true, dossierRapports = "", controles = null }) {
  const groupes = useMemo(() => groupesParSite(controles?.controles ?? [], sites, vues), [controles?.controles, sites, vues]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold">Agents</h1>

      {!configTrouvee && (
        <Carte>
          <p className="text-xs text-texte-doux">
            Horaires des tâches planifiées introuvables : impossible de dire quels rapports manquent aujourd'hui.
          </p>
        </Carte>
      )}

      {controles && <ControlesAutomatiques controles={controles} groupes={groupes} />}
      {controles && groupes.length === 0 && !controles.erreurRegistre && (
        <Carte>
          <EtatVide>Aucune tâche planifiée : « Ajouter une tâche » applique un modèle à un site.</EtatVide>
        </Carte>
      )}

      {dossierRapports && (
        <p className="text-[11px] break-all text-texte-doux">Dossier des rapports&nbsp;: {dossierRapports}</p>
      )}
    </div>
  );
}
