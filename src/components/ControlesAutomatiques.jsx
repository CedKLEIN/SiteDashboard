import { useState } from "react";
import { Bot, Clock, Play, RefreshCw, Sparkles } from "lucide-react";
import { Bouton, Carte } from "./ui";
import { JOURS_PROPOSES, composerCron, decomposerCron, file, horaireLisible } from "../lib/controles";
import { couleurEtat } from "../lib/statut";

const ETATS = { ok: "ok", attention: "partiel", echec: "ko" };
const LIBELLES = { ok: "OK", attention: "à regarder", echec: "en échec" };
const CLAUDE = {
  appele: "analysé par Claude",
  reprise: "analyse précédente reprise",
  erreur: "analyse Claude impossible",
};

function dernierPassage(iso) {
  if (!iso) return "jamais lancé";
  const date = new Date(iso);
  const jour = date.toLocaleDateString("fr-FR");
  const heure = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return jour === new Date().toLocaleDateString("fr-FR") ? `aujourd'hui à ${heure}` : `le ${jour} à ${heure}`;
}

/** Edition de l'horaire d'une tache : heure et jours. */
function EditeurHoraire({ controle, onEnregistrer, onFermer }) {
  const depart = decomposerCron(controle.cron);
  const [heure, setHeure] = useState(depart.heure);
  const [jours, setJours] = useState(
    JOURS_PROPOSES.some((j) => j.valeur === depart.jours) ? depart.jours : "*",
  );
  const cron = composerCron(heure, jours);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-surface-2/50 p-2 text-xs">
      <label className="flex items-center gap-1.5">
        Heure
        <input
          type="time"
          value={heure}
          onChange={(e) => setHeure(e.target.value)}
          className="rounded border border-bord bg-surface px-1.5 py-1 text-texte"
        />
      </label>
      <select
        value={jours}
        onChange={(e) => setJours(e.target.value)}
        className="rounded border border-bord bg-surface px-1.5 py-1 text-texte"
        aria-label="Jours"
      >
        {JOURS_PROPOSES.map((j) => (
          <option key={j.valeur} value={j.valeur}>
            {j.libelle}
          </option>
        ))}
      </select>
      <Bouton className="px-2 py-1 text-xs" disabled={!cron} onClick={() => onEnregistrer(cron)}>
        Enregistrer
      </Bouton>
      {controle.cron !== controle.cronParDefaut && (
        <Bouton variante="fantome" className="px-2 py-1 text-xs" onClick={() => onEnregistrer(null)}>
          Horaire par défaut ({horaireLisible(controle.cronParDefaut)})
        </Bouton>
      )}
      <Bouton variante="fantome" className="px-2 py-1 text-xs" onClick={onFermer}>
        Annuler
      </Bouton>
    </div>
  );
}

function LigneTache({ controle, dernier, resultat, enCours, onLancer, onHoraire, onActiver }) {
  const [edition, setEdition] = useState(false);
  const actif = enCours[file(controle)] === controle.id;
  const fileOccupee = Boolean(enCours[file(controle)]);
  const Icone = controle.type === "claude" ? Sparkles : Bot;

  return (
    <li className={`py-2 ${controle.actif ? "" : "opacity-50"}`}>
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={controle.actif}
          onChange={(e) => onActiver(controle.id, e.target.checked)}
          title={controle.actif ? "Désactiver cette tâche" : "Activer cette tâche"}
          aria-label={`Activer ${controle.titre} (${controle.site})`}
        />
        <Icone size={16} className="shrink-0 text-texte-doux" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-medium">{controle.titre}</span>
            <span className="ml-2 text-texte-doux">{controle.site}</span>
          </p>
          <p className="text-[11px] text-texte-doux">
            {controle.actif ? horaireLisible(controle.cron) : "désactivée"}
            {controle.cron !== controle.cronParDefaut && " (modifié)"}
            {" · "}dernier passage {dernierPassage(dernier)}
            {resultat && (
              <>
                {" · "}
                <span style={{ color: couleurEtat(ETATS[resultat.statut] ?? "inconnu") }}>
                  {LIBELLES[resultat.statut] ?? resultat.statut}
                </span>
                {CLAUDE[resultat.claude] && ` · ${CLAUDE[resultat.claude]}`}
                {resultat.erreur && ` · ${resultat.erreur}`}
              </>
            )}
          </p>
        </div>
        <Bouton
          variante="fantome"
          className="flex shrink-0 items-center gap-1.5 px-2 py-1 text-xs"
          onClick={() => setEdition((e) => !e)}
          title="Modifier l'horaire"
        >
          <Clock size={13} />
          Horaire
        </Bouton>
        <Bouton
          variante="fantome"
          className="flex shrink-0 items-center gap-1.5 px-2 py-1 text-xs"
          disabled={fileOccupee}
          onClick={() => onLancer(controle.id)}
          title={fileOccupee && !actif ? "Une autre tâche de ce type tourne" : "Lancer maintenant"}
        >
          {actif ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
          {actif ? "En cours..." : "Lancer maintenant"}
        </Bouton>
      </div>
      {edition && (
        <EditeurHoraire
          controle={controle}
          onFermer={() => setEdition(false)}
          onEnregistrer={async (cron) => {
            await onHoraire(controle.id, cron);
            setEdition(false);
          }}
        />
      )}
    </li>
  );
}

/**
 * Toutes les taches planifiees, lancees par SiteDashboard : les controles par
 * script (Claude seulement en cas d'anomalie) et les agents Claude (une session
 * par passage). Horaire reglable et activation par tache.
 */
export default function ControlesAutomatiques({ controles }) {
  if (!controles) return null;
  const groupes = [
    { type: "script", titre: "Contrôles par script", aide: "Claude n'est appelé qu'en cas d'anomalie" },
    { type: "claude", titre: "Agents Claude", aide: "une session Claude par passage" },
  ];

  return (
    <Carte>
      <h2 className="text-sm font-semibold">Tâches planifiées</h2>
      {groupes.map((g) => (
        <div key={g.type} className="mt-3">
          <p className="text-xs font-medium text-texte-doux">
            {g.titre} <span className="font-normal">— {g.aide}</span>
          </p>
          <ul className="flex flex-col divide-y divide-bord/50">
            {controles.controles
              .filter((c) => file(c) === g.type)
              .map((c) => (
                <LigneTache
                  key={c.id}
                  controle={c}
                  dernier={controles.derniers[c.id]}
                  resultat={controles.resultats[c.id]}
                  enCours={controles.enCours}
                  onLancer={controles.lancer}
                  onHoraire={controles.modifierHoraire}
                  onActiver={controles.activer}
                />
              ))}
          </ul>
        </div>
      ))}
    </Carte>
  );
}
