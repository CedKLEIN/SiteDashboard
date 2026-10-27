import { useState } from "react";
import { Bot, Clock, Play, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Bouton, Interrupteur } from "./ui";
import { PastilleStatut } from "./AgentsDuSite";
import { JOURS_PROPOSES, composerCron, decomposerCron, file, horaireLisible } from "../lib/controles";
import { couleurEtat } from "../lib/statut";
import { STATUTS_SITE } from "../lib/vueAgents";
import { manquesParSite } from "../lib/reglagesAgents";

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
  const claude = controle.type === "claude";
  const Icone = claude ? Sparkles : Bot;
  // Sans horaire : l'interrupteur coupe seulement le declenchement par un autre controle
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
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        <Interrupteur
          actif={controle.actif}
          disabled={aLaDemande && !controle.declenchePar}
          onChanger={(v) => onActiver(controle.id, v)}
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
        <div className={`min-w-0 flex-1 ${controle.actif || aLaDemande ? "" : "opacity-50"}`}>
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
            <span className="font-medium">{controle.titre}</span>
            <span
              className="flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-texte-doux"
              title={claude ? "Une session Claude par passage" : "Script : Claude n'est appelé qu'en cas d'anomalie"}
            >
              <Icone size={11} aria-hidden="true" />
              {claude ? "agent Claude" : "script"}
            </span>
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
 * Ce que les autres sites ont et que celui-ci n'a pas : un clic aligne. Le
 * modele « Bing » en est l'exemple : sans lui, l'agent SEO fait Google ET Bing
 * dans Chrome ; avec lui, Bing passe par l'API et l'agent ne fait que Google.
 */
function Alignement({ manques, onAjouter }) {
  const [erreur, setErreur] = useState(null);
  const [envoi, setEnvoi] = useState(null);
  if (manques.length === 0) return null;
  async function ajouter(m) {
    setEnvoi(m.id);
    setErreur(null);
    try {
      await onAjouter(m.id, m.siteCle);
    } catch (e) {
      setErreur(String(e));
    } finally {
      setEnvoi(null);
    }
  }
  return (
    <div className="mt-2 rounded-lg border border-dashed border-bord p-2.5 text-xs">
      <p className="mb-1.5 text-texte-doux">Les autres sites ont aussi :</p>
      <div className="flex flex-wrap gap-2">
        {manques.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={m.manquants.length > 0 || envoi !== null}
            onClick={() => ajouter(m)}
            title={m.manquants.length > 0 ? `Fiche du site incomplète : ${m.manquants.join(", ")}` : m.description}
            className="flex items-center gap-1.5 rounded-lg border border-bord px-2.5 py-1.5 text-texte-doux transition hover:border-accent hover:text-texte disabled:opacity-40"
          >
            <Plus size={12} />
            {m.titre}
            {m.manquants.length > 0 && <span className="text-[10px]">(fiche incomplète)</span>}
          </button>
        ))}
      </div>
      {erreur && <p className="mt-1.5" style={{ color: couleurEtat("ko") }}>{erreur}</p>}
    </div>
  );
}

/** Un site : sa barre de couleur, son statut du jour, ses taches et ce qui lui manque. */
function GroupeSite({ groupe, controles, manques }) {
  const statut = groupe.vue ? STATUTS_SITE[groupe.vue.statut] : null;
  return (
    <section className="relative overflow-hidden rounded-xl border border-bord bg-surface p-4 pl-5 shadow-sm">
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: groupe.couleur ?? "#3a4570" }} aria-hidden="true" />
      <header className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{groupe.nom}</h2>
        {groupe.domaine !== groupe.nom && <span className="text-xs text-texte-doux">{groupe.domaine}</span>}
        <span className="text-xs text-texte-doux">· {groupe.controles.length} tâche(s)</span>
        {statut && (
          <span className="ml-auto" title="Statut du jour : le détail est dans la fiche du site">
            <PastilleStatut etat={statut.etat}>{statut.libelle}</PastilleStatut>
          </span>
        )}
      </header>
      <ul className="flex flex-col divide-y divide-bord/50">
        {groupe.controles.map((c) => (
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
      <Alignement manques={manques} onAjouter={controles.ajouter} />
    </section>
  );
}

/**
 * Toutes les taches planifiees, site par site : les controles par script
 * (Claude seulement en cas d'anomalie) et les agents Claude (une session par
 * passage). Activation, horaire, lancement et retrait par tache ; « Ajouter une
 * tache » applique un modele a un site (voir controles/modeles).
 */
export default function ControlesAutomatiques({ controles, groupes }) {
  const [ajout, setAjout] = useState(false);
  if (!controles) return null;
  const manques = manquesParSite(controles.controles, controles.modeles);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-texte-doux">
          Les statuts du jour et l&apos;historique des passages sont dans la fiche de chaque site (tableau de bord).
        </p>
        {controles.modeles.length > 0 && !ajout && (
          <Bouton className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs" onClick={() => setAjout(true)}>
            <Plus size={13} />
            Ajouter une tâche
          </Bouton>
        )}
      </div>
      {ajout && <AjouterTache modeles={controles.modeles} onAjouter={controles.ajouter} onFermer={() => setAjout(false)} />}
      {controles.erreurRegistre && (
        <p className="text-xs" style={{ color: couleurEtat("ko") }}>
          Registre des tâches illisible : {controles.erreurRegistre}
        </p>
      )}
      {groupes.map((g) => (
        <GroupeSite key={g.cle} groupe={g} controles={controles} manques={manques.get(g.cle) ?? []} />
      ))}
    </div>
  );
}
