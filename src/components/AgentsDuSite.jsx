import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ChevronDown, ChevronRight, CircleDashed, FolderOpen, Play, RefreshCw, Trash2 } from "lucide-react";
import { ICONES } from "./CarteSite";
import { Bouton, BoutonCopier, EtatVide } from "./ui";
import { couleurEtat, iconeEtat } from "../lib/statut";
import { file } from "../lib/controles";
import { JOURS_HISTORIQUE, STATUTS_RAPPORT, heureRapport, texteRapport } from "../lib/rapportsAgents";
import { COULEUR_EN_COURS, dureeRapport, etatNiveau, etatRapport, libelleNiveau } from "../lib/vueAgents";
import { tracer } from "../lib/trace";

/** '2026-10-24' -> 'samedi 24 octobre' */
function jourLisible(dateIso) {
  const [a, m, j] = dateIso.split("-").map(Number);
  if (!a || !m || !j) return dateIso;
  return new Date(a, m - 1, j).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

export function IconeEtat({ etat, taille = 18 }) {
  const Icone = ICONES[iconeEtat(etat)] ?? CircleDashed;
  return <Icone size={taille} strokeWidth={2.25} style={{ color: couleurEtat(etat) }} className="shrink-0" aria-hidden="true" />;
}

export function PastilleStatut({ etat, couleur = couleurEtat(etat), children }) {
  return (
    <span className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium" style={{ color: couleur, background: `${couleur}22` }}>
      {children}
    </span>
  );
}

/** Libelle d'un carre de la frise, au survol. */
function titrePassage(p) {
  if (!p) return "Pas de passage";
  if (p.enCours) return "En cours";
  const heure = heureRapport(p.debut);
  return `${jourLisible(p.date)}${heure ? ` à ${heure}` : ""} : ${STATUTS_RAPPORT[p.statut]?.libelle}`;
}

/** Les derniers passages d'une tache, un carre chacun (gris : vide, bleu : tourne en ce moment). */
function Frise({ passages }) {
  return (
    <span className="flex shrink-0 gap-0.5" aria-label="Derniers passages">
      {passages.map((p, i) => (
        <span
          key={p?.cle ?? (p?.enCours ? "en-cours" : `vide-${i}`)}
          title={titrePassage(p)}
          className={`size-3 rounded-[3px] ${p?.enCours ? "animate-pulse" : ""}`}
          style={{
            background: p?.enCours ? COULEUR_EN_COURS : p ? couleurEtat(etatRapport(p.statut)) : "var(--color-bord)",
          }}
        />
      ))}
    </span>
  );
}

/** Un passage de la tache : replie, une ligne (jour, heure, duree, statut) ; ouvert, son detail. */
function DetailRapport({ rapport, ouvert, onBasculer }) {
  const etat = STATUTS_RAPPORT[rapport.statut].etat;
  const heure = heureRapport(rapport.debut) ?? heureRapport(rapport.fin);
  const duree = dureeRapport(rapport.debut, rapport.fin);
  const fichier = rapport.fichierSuivi ?? rapport.chemin;
  const Chevron = ouvert ? ChevronDown : ChevronRight;
  return (
    <li className="rounded-lg border border-bord bg-surface-2/40">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onBasculer}
          aria-expanded={ouvert}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Chevron size={14} className="shrink-0 text-texte-doux" />
          <IconeEtat etat={etat} taille={16} />
          <span className="truncate text-sm font-semibold capitalize text-texte">{jourLisible(rapport.date)}</span>
          <span className="shrink-0 text-[11px] text-texte-doux tabular-nums">
            {heure && `lancé à ${heure}`}
            {duree && ` · ${duree}`}
          </span>
        </button>
        <span className="shrink-0 text-[11px]" style={{ color: couleurEtat(etat) }}>
          {STATUTS_RAPPORT[rapport.statut].libelle}
        </span>
        <BoutonCopier texte={() => texteRapport(rapport)} titre="Copier ce rapport" />
      </div>
      {ouvert && (
        <div className="border-t border-bord px-3 pb-3 pl-9">
          {/* Un resume qui repete mot pour mot un point n'apporte rien */}
          {rapport.resume && !rapport.points.some((p) => p.texte === rapport.resume) && (
            <p className="mt-2 text-xs text-texte-doux">{rapport.resume}</p>
          )}
          {rapport.points.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {rapport.points.map((point, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-texte">
                  <span className="mt-0.5">
                    <IconeEtat etat={STATUTS_RAPPORT[point.niveau].etat} taille={13} />
                  </span>
                  <span>{point.texte}</span>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => revealItemInDir(fichier).catch((e) => tracer("agents", `ouverture impossible: ${e}`))}
            className="mt-2 flex items-center gap-1.5 text-[11px] text-texte-doux hover:text-texte"
            title={fichier}
          >
            <FolderOpen size={12} />
            {rapport.fichierSuivi ? "Voir le fichier de suivi" : "Voir le rapport"}
          </button>
        </div>
      )}
    </li>
  );
}

/** Les derniers passages : seul le plus recent est ouvert d'office. */
function Historique({ rapports }) {
  const [ouverts, setOuverts] = useState(() => new Set(rapports[0] ? [rapports[0].cle] : []));
  const basculer = (cle) =>
    setOuverts((avant) => {
      const apres = new Set(avant);
      if (apres.has(cle)) apres.delete(cle);
      else apres.add(cle);
      return apres;
    });
  return (
    <ul className="flex flex-col gap-1.5">
      {rapports.map((r) => (
        <DetailRapport key={r.cle} rapport={r} ouvert={ouverts.has(r.cle)} onBasculer={() => basculer(r.cle)} />
      ))}
    </ul>
  );
}

/**
 * Efface l'historique d'une tache hors du registre (une ancienne tache Claude) :
 * celles du registre perdent le leur en etant retirees dans les reglages.
 */
function EffacerHistorique({ tache, onEfface }) {
  const [confirmation, setConfirmation] = useState(false);
  const [erreur, setErreur] = useState(null);
  async function effacer() {
    try {
      await invoke("supprimer_rapports_agent", { agent: tache.id });
      onEfface();
    } catch (e) {
      setErreur(String(e));
      tracer("agents", `historique de ${tache.id} non efface: ${e}`);
    }
  }
  if (erreur) return <span className="text-depense">Effacement impossible : {erreur}</span>;
  return confirmation ? (
    <span className="flex items-center gap-1">
      <Bouton variante="danger" className="px-2 py-1 text-xs" onClick={effacer}>
        Effacer
      </Bouton>
      <Bouton variante="fantome" className="px-2 py-1 text-xs" onClick={() => setConfirmation(false)}>
        Garder
      </Bouton>
    </span>
  ) : (
    <Bouton
      variante="fantome"
      className="flex items-center gap-1.5 px-2 py-1 text-xs"
      onClick={() => setConfirmation(true)}
      title="Efface tous les rapports de cette tâche"
    >
      <Trash2 size={13} />
      Effacer l'historique
    </Bouton>
  );
}

/** Une tache ouverte, ses actions et ses rapports passes. */
function DetailTache({ tache, controles, onEfface }) {
  const controle = tache.controle;
  const voie = controle ? file(controle) : null;
  const enCours = voie && controles?.enCours[voie] === controle.id;
  const occupee = voie && Boolean(controles?.enCours[voie]);
  return (
    <div className="border-t border-bord p-3">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-texte-doux">
        {tache.planning && <span>Horaire : {tache.planning}</span>}
        {controle && (
          <Bouton
            variante="fantome"
            className="flex items-center gap-1.5 px-2 py-1 text-xs"
            disabled={occupee}
            onClick={() => controles.lancer(controle.id)}
            title={occupee && !enCours ? "Une autre tâche de ce type tourne" : "Lancer maintenant"}
          >
            {enCours ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
            {enCours ? "En cours..." : "Lancer maintenant"}
          </Bouton>
        )}
        {tache.attendu?.message && !tache.attendu.rapport && <span>{tache.attendu.message}</span>}
        {!controle && !tache.enCours && tache.rapports.length > 0 && <EffacerHistorique tache={tache} onEfface={onEfface} />}
      </div>
      {tache.rapports.length === 0 ? (
        <p className="text-xs text-texte-doux">Aucun rapport sur les {JOURS_HISTORIQUE} derniers jours.</p>
      ) : (
        // Un nouveau passage rouvre l'historique sur lui
        <Historique key={tache.rapports[0].cle} rapports={tache.rapports} />
      )}
    </div>
  );
}

function LigneTache({ tache, ouverte, onBasculer, controles, onEfface }) {
  const Chevron = ouverte ? ChevronDown : ChevronRight;
  const etat = etatNiveau(tache.niveau);
  return (
    <li className="overflow-hidden rounded-xl border border-bord bg-surface-2/30">
      <button
        type="button"
        onClick={onBasculer}
        aria-expanded={ouverte}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-surface-2"
      >
        <Chevron size={16} className="shrink-0 text-texte-doux" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{tache.titre}</span>
        <PastilleStatut etat={etat} couleur={tache.enCours ? COULEUR_EN_COURS : undefined}>
          {libelleNiveau(tache)}
          {!tache.enCours && tache.rapportDuJour && ` · ${heureRapport(tache.rapportDuJour.debut) ?? ""}`}
        </PastilleStatut>
        <span className="hidden w-40 shrink-0 truncate text-[11px] text-texte-doux sm:block">{tache.planning ?? ""}</span>
        <Frise passages={tache.frise} />
      </button>
      {ouverte && <DetailTache tache={tache} controles={controles} onEfface={onEfface} />}
    </li>
  );
}

/**
 * Les agents d'un site, dans sa fiche : ce qu'il y a a faire aujourd'hui, puis
 * chaque tache (statut du jour, derniers passages) ; un clic sur une tache
 * montre ses rapports. Les reglages (horaires, ajout, retrait) sont dans
 * l'onglet Agents.
 */
export default function AgentsDuSite({ vue, controles, onEfface }) {
  const [ouvertes, setOuvertes] = useState(() => new Set());
  if (!vue || vue.taches.length === 0) {
    return <EtatVide>Aucune tâche pour ce site : ajoute-en une dans l&apos;onglet Agents.</EtatVide>;
  }
  const basculer = (id) =>
    setOuvertes((avant) => {
      const apres = new Set(avant);
      if (apres.has(id)) apres.delete(id);
      else apres.add(id);
      return apres;
    });

  return (
    <div className="flex flex-col gap-3">
      {vue.aFaire.length > 0 ? (
        <div>
          <h3 className="mb-1.5 text-xs font-medium uppercase text-texte-doux">À faire</h3>
          <ol className="flex flex-col gap-1.5">
            {vue.aFaire.map((a, i) => (
              <li key={`${a.id}-${i}`} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5">
                  <IconeEtat etat={a.niveau === "echec" ? "ko" : "partiel"} taille={14} />
                </span>
                <span title={a.texte !== a.court ? a.texte : undefined}>
                  {a.court}
                  <span className="ml-2 text-[11px] text-texte-doux">{a.tache}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="text-sm text-texte-doux">{vue.resume}</p>
      )}

      <ul className="flex flex-col gap-2">
        {vue.taches.map((t) => (
          <LigneTache key={t.id} tache={t} ouverte={ouvertes.has(t.id)} onBasculer={() => basculer(t.id)} controles={controles} onEfface={onEfface} />
        ))}
      </ul>
    </div>
  );
}
