import { useState } from "react";
import { Bot, Clock, Play, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
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

/** Choix d'un modele et d'un site : cree l'agent avec l'horaire par defaut du modele. */
function AjouterTache({ modeles, onAjouter, onFermer }) {
  const [modeleId, setModeleId] = useState(modeles[0]?.id ?? "");
  const modele = modeles.find((m) => m.id === modeleId);
  const possibles = (modele?.sites ?? []).filter((s) => !s.deja && s.manquants.length === 0);
  const [siteCle, setSiteCle] = useState("");
  const site = possibles.some((s) => s.cle === siteCle) ? siteCle : (possibles[0]?.cle ?? "");
  const [erreur, setErreur] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  async function ajouter() {
    setEnvoi(true);
    setErreur(null);
    try {
      await onAjouter(modeleId, site);
      onFermer();
    } catch (e) {
      setErreur(String(e));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg bg-surface-2/50 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5">
          Modèle
          <select
            value={modeleId}
            onChange={(e) => setModeleId(e.target.value)}
            className="rounded border border-bord bg-surface px-1.5 py-1 text-texte"
          >
            {modeles.map((m) => (
              <option key={m.id} value={m.id}>
                {m.titre} ({m.type === "claude" ? "agent Claude" : "script"})
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Site
          <select
            value={site}
            onChange={(e) => setSiteCle(e.target.value)}
            className="rounded border border-bord bg-surface px-1.5 py-1 text-texte"
          >
            {(modele?.sites ?? []).map((s) => (
              <option key={s.cle} value={s.cle} disabled={s.deja || s.manquants.length > 0}>
                {s.nom}
                {s.deja ? " — déjà en place" : s.manquants.length ? ` — fiche incomplète (${s.manquants.join(", ")})` : ""}
              </option>
            ))}
          </select>
        </label>
        <Bouton className="px-2 py-1 text-xs" disabled={!site || envoi} onClick={ajouter}>
          Ajouter
        </Bouton>
        <Bouton variante="fantome" className="px-2 py-1 text-xs" onClick={onFermer}>
          Annuler
        </Bouton>
      </div>
      {modele && (
        <p className="text-texte-doux">
          {modele.description}
          {modele.cron && ` Horaire par défaut : ${horaireLisible(modele.cron)}, réglable ensuite.`}
        </p>
      )}
      {modele && possibles.length === 0 && (
        <p className="text-texte-doux">Aucun site disponible pour ce modèle : déjà en place partout, ou fiche de site incomplète.</p>
      )}
      {erreur && <p style={{ color: couleurEtat("ko") }}>{erreur}</p>}
    </div>
  );
}

function LigneTache({ controle, dernier, resultat, enCours, onLancer, onHoraire, onActiver, onRetirer }) {
  const [edition, setEdition] = useState(false);
  const [retrait, setRetrait] = useState(false);
  const actif = enCours[file(controle)] === controle.id;
  const fileOccupee = Boolean(enCours[file(controle)]);
  const Icone = controle.type === "claude" ? Sparkles : Bot;
  // Sans horaire : la case coupe seulement le declenchement par un autre controle
  const aLaDemande = !controle.cronParDefaut;
  const declencheur = controle.declenchePar === "audit-hebdo" ? "l'audit hebdomadaire" : controle.declenchePar;
  const planning = aLaDemande
    ? controle.declenchePar && controle.actif
      ? `à la demande, et lancée après ${declencheur} s'il le demande`
      : "à la demande seulement"
    : controle.actif
      ? horaireLisible(controle.cron)
      : "désactivée";

  return (
    <li className={`py-2 ${controle.actif || aLaDemande ? "" : "opacity-50"}`}>
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={controle.actif}
          disabled={aLaDemande && !controle.declenchePar}
          onChange={(e) => onActiver(controle.id, e.target.checked)}
          title={
            aLaDemande
              ? controle.actif
                ? `Ne plus la lancer automatiquement après ${declencheur}`
                : `La lancer automatiquement après ${declencheur}`
              : controle.actif
                ? "Désactiver cette tâche"
                : "Activer cette tâche"
          }
          aria-label={`Activer ${controle.titre} (${controle.site})`}
        />
        <Icone size={16} className="shrink-0 text-texte-doux" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-medium">{controle.titre}</span>
            <span className="ml-2 text-texte-doux">{controle.site}</span>
          </p>
          {controle.erreur && (
            <p className="text-[11px]" style={{ color: couleurEtat("ko") }}>
              {controle.erreur}
            </p>
          )}
          <p className="text-[11px] text-texte-doux">
            {planning}
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
        {!aLaDemande && (
          <Bouton
            variante="fantome"
            className="shrink-0 px-2 py-1 text-xs"
            onClick={() => setEdition((e) => !e)}
            aria-expanded={edition}
            title="Modifier l'horaire"
            aria-label={`Modifier l'horaire de ${controle.titre} (${controle.site})`}
          >
            <Clock size={13} />
          </Bouton>
        )}
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
        {retrait ? (
          <span className="flex shrink-0 items-center gap-1">
            <Bouton variante="danger" className="px-2 py-1 text-xs" onClick={() => onRetirer(controle.id)}>
              Retirer
            </Bouton>
            <Bouton variante="fantome" className="px-2 py-1 text-xs" onClick={() => setRetrait(false)}>
              Garder
            </Bouton>
          </span>
        ) : (
          <Bouton
            variante="fantome"
            className="shrink-0 px-2 py-1 text-xs"
            disabled={actif}
            onClick={() => setRetrait(true)}
            title="Retirer cette tâche et son historique"
            aria-label={`Retirer ${controle.titre} (${controle.site})`}
          >
            <Trash2 size={13} />
          </Bouton>
        )}
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
 * par passage). Horaire reglable et activation par tache ; « Ajouter une tache »
 * applique un modele a un site (voir controles/modeles).
 */
export default function ControlesAutomatiques({ controles }) {
  const [ajout, setAjout] = useState(false);
  if (!controles) return null;
  const groupes = [
    { type: "script", titre: "Contrôles par script", aide: "Claude n'est appelé qu'en cas d'anomalie" },
    { type: "claude", titre: "Agents Claude", aide: "une session Claude par passage" },
  ];

  return (
    <Carte>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Tâches planifiées</h2>
        {controles.modeles.length > 0 && !ajout && (
          <Bouton variante="fantome" className="flex items-center gap-1.5 px-2 py-1 text-xs" onClick={() => setAjout(true)}>
            <Plus size={13} />
            Ajouter une tâche
          </Bouton>
        )}
      </div>
      {ajout && <AjouterTache modeles={controles.modeles} onAjouter={controles.ajouter} onFermer={() => setAjout(false)} />}
      {controles.erreurRegistre && (
        <p className="mt-2 text-xs" style={{ color: couleurEtat("ko") }}>
          Registre des tâches illisible : {controles.erreurRegistre}
        </p>
      )}
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
                  onRetirer={controles.retirer}
                />
              ))}
          </ul>
        </div>
      ))}
    </Carte>
  );
}
