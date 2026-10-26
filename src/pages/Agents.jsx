import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ChevronDown, ChevronRight, CircleDashed, FolderOpen, Play, RefreshCw, Settings2 } from "lucide-react";
import { ICONES } from "../components/CarteSite";
import ControlesAutomatiques from "../components/ControlesAutomatiques";
import { Bouton, BoutonCopier, Carte, EtatVide } from "../components/ui";
import { couleurEtat, iconeEtat } from "../lib/statut";
import { file } from "../lib/controles";
import {
  JOURS_HISTORIQUE,
  STATUTS_RAPPORT,
  dateDepuis,
  heureRapport,
  lireRapport,
  texteRapport,
} from "../lib/rapportsAgents";
import {
  COULEUR_EN_COURS,
  RAPPORTS_MAX,
  STATUTS_SITE,
  dureeRapport,
  etatNiveau,
  etatRapport,
  libelleNiveau,
  vueParSite,
} from "../lib/vueAgents";
import { tracer } from "../lib/trace";

/** '2026-10-24' -> 'samedi 24 octobre' */
function jourLisible(dateIso) {
  const [a, m, j] = dateIso.split("-").map(Number);
  if (!a || !m || !j) return dateIso;
  return new Date(a, m - 1, j).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

function IconeEtat({ etat, taille = 18 }) {
  const Icone = ICONES[iconeEtat(etat)] ?? CircleDashed;
  return <Icone size={taille} strokeWidth={2.25} style={{ color: couleurEtat(etat) }} className="shrink-0" aria-hidden="true" />;
}

function PastilleStatut({ etat, couleur = couleurEtat(etat), children }) {
  return (
    <span className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium" style={{ color: couleur, background: `${couleur}22` }}>
      {children}
    </span>
  );
}

/** Les derniers jours d'une tache, un carre par jour (gris : pas de rapport, bleu : tourne). */
function Frise({ jours }) {
  return (
    <span className="flex shrink-0 gap-0.5" aria-label="Derniers jours">
      {jours.map((j) => (
        <span
          key={j.date}
          title={`${jourLisible(j.date)} : ${j.enCours ? "en cours" : j.statut ? STATUTS_RAPPORT[j.statut]?.libelle : "pas de rapport"}`}
          className={`size-3 rounded-[3px] ${j.enCours ? "animate-pulse" : ""}`}
          style={{
            background: j.enCours ? COULEUR_EN_COURS : j.statut ? couleurEtat(etatRapport(j.statut)) : "var(--color-bord)",
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

/** Niveau 1 : un site, son statut, son resume et une pastille par tache. */
function CarteSiteAgents({ vue, onOuvrir }) {
  const statut = STATUTS_SITE[vue.statut];
  return (
    <button
      type="button"
      onClick={onOuvrir}
      className="relative flex flex-col gap-2 overflow-hidden rounded-xl border bg-surface p-4 pl-5 text-left transition hover:bg-surface-2"
      style={{ borderColor: vue.statut === "action" ? couleurEtat("ko") : undefined }}
    >
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: vue.couleur ?? "#3a4570" }} aria-hidden="true" />
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-base font-semibold">
          <IconeEtat etat={statut.etat} taille={20} />
          {vue.nom}
        </span>
        <PastilleStatut etat={statut.etat}>{statut.libelle}</PastilleStatut>
      </div>
      <p className="text-sm text-texte-doux">{vue.resume}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {vue.taches.map((t) => (
          <span key={t.id} className="flex items-center gap-1.5 text-[11px] text-texte-doux">
            <span
              className={`size-2 rounded-full ${t.enCours ? "animate-pulse" : ""}`}
              style={{ background: t.enCours ? COULEUR_EN_COURS : couleurEtat(etatNiveau(t.niveau)) }}
            />
            {t.titre}
          </span>
        ))}
      </div>
    </button>
  );
}

/** Niveau 3 : une tache ouverte, ses actions et ses rapports passes. */
function DetailTache({ tache, controles }) {
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
      </div>
      {tache.rapports.length === 0 ? (
        <p className="text-xs text-texte-doux">Aucun rapport sur les {JOURS_HISTORIQUE} derniers jours.</p>
      ) : (
        <>
          <p className="mb-1.5 text-[11px] text-texte-doux">Les {RAPPORTS_MAX} derniers passages au plus</p>
          <Historique rapports={tache.rapports} />
        </>
      )}
    </div>
  );
}

function LigneTache({ tache, ouverte, onBasculer, controles }) {
  const Chevron = ouverte ? ChevronDown : ChevronRight;
  const etat = etatNiveau(tache.niveau);
  return (
    <li className="overflow-hidden rounded-xl border border-bord bg-surface">
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
        <Frise jours={tache.frise} />
      </button>
      {ouverte && <DetailTache tache={tache} controles={controles} />}
    </li>
  );
}

/** Niveau 2 : un site, ce qu'il y a a faire, puis ses taches. */
function DetailSiteAgents({ vue, controles, onRetour }) {
  const [ouvertes, setOuvertes] = useState(() => new Set());
  const statut = STATUTS_SITE[vue.statut];
  const basculer = (id) =>
    setOuvertes((avant) => {
      const apres = new Set(avant);
      if (apres.has(id)) apres.delete(id);
      else apres.add(id);
      return apres;
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onRetour} className="flex items-center gap-2 text-lg font-semibold hover:text-accent">
          <ArrowLeft size={18} />
          {vue.nom}
        </button>
        <PastilleStatut etat={statut.etat}>{statut.libelle}</PastilleStatut>
      </div>

      {vue.aFaire.length > 0 ? (
        <Carte titre="À faire">
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
        </Carte>
      ) : (
        <Carte>
          <p className="text-sm text-texte-doux">{vue.resume}</p>
        </Carte>
      )}

      <ul className="flex flex-col gap-2">
        {vue.taches.map((t) => (
          <LigneTache key={t.id} tache={t} ouverte={ouvertes.has(t.id)} onBasculer={() => basculer(t.id)} controles={controles} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Onglet Agents, par site : une carte par site (statut du jour et resume), un
 * clic ouvre le site (ce qui est a faire, ses taches et leurs derniers jours),
 * un clic sur une tache montre ses rapports. Les reglages des taches (horaires,
 * ajout) sont replies en bas : on y va rarement.
 */
export default function Agents({ sites = [], rafraichissement, attendus = [], configTrouvee = true, controles = null }) {
  const [dossier, setDossier] = useState({ dossier: "", existe: true, fichiers: [] });
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [siteOuvert, setSiteOuvert] = useState(null);
  const [reglages, setReglages] = useState(false);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      setDossier(await invoke("lire_rapports_agents", { depuis: dateDepuis(JOURS_HISTORIQUE) }));
      setErreur(null);
    } catch (e) {
      setErreur(String(e));
      tracer("agents", `lecture des rapports impossible: ${e}`);
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    // Synchronisation avec un systeme externe (le dossier des rapports)
    // oxlint-disable-next-line react/set-state-in-effect
    charger();
  }, [charger, rafraichissement]);

  const vues = useMemo(
    () =>
      vueParSite({
        rapports: dossier.fichiers.map(lireRapport),
        attendus,
        controles: controles?.controles ?? [],
        sites,
        enCours: Object.values(controles?.enCours ?? {}).filter(Boolean),
      }),
    [dossier.fichiers, attendus, controles?.controles, controles?.enCours, sites],
  );
  const vue = vues.find((v) => v.cle === siteOuvert);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Agents</h1>
          <p className="text-xs text-texte-doux">État du jour par site ; un clic pour le détail et l'historique</p>
        </div>
        <Bouton variante="fantome" onClick={charger} disabled={chargement}>
          <span className="flex items-center gap-1.5">
            <RefreshCw size={14} className={chargement ? "animate-spin" : ""} />
            Actualiser
          </span>
        </Bouton>
      </div>

      {erreur && (
        <Carte>
          <p className="text-sm text-depense">Lecture des rapports impossible : {erreur}</p>
        </Carte>
      )}
      {!configTrouvee && (
        <Carte>
          <p className="text-xs text-texte-doux">
            Horaires des tâches planifiées introuvables : impossible de dire quels rapports manquent aujourd'hui.
          </p>
        </Carte>
      )}

      {vue ? (
        <DetailSiteAgents key={vue.cle} vue={vue} controles={controles} onRetour={() => setSiteOuvert(null)} />
      ) : (
        <>
          {vues.length === 0 && !chargement && !erreur && (
            <Carte>
              <EtatVide>{dossier.existe ? "Aucun rapport sur la période." : "Aucun agent n'a encore déposé de rapport."}</EtatVide>
            </Carte>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {vues.map((v) => (
              <CarteSiteAgents key={v.cle} vue={v} onOuvrir={() => setSiteOuvert(v.cle)} />
            ))}
          </div>

          <div>
            <button
              type="button"
              onClick={() => setReglages((r) => !r)}
              aria-expanded={reglages}
              className="flex items-center gap-2 text-sm text-texte-doux hover:text-texte"
            >
              <Settings2 size={15} />
              Réglages des tâches (horaires, ajout, lancement)
              {reglages ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {reglages && (
              <div className="mt-3">
                <ControlesAutomatiques controles={controles} />
              </div>
            )}
          </div>

          {dossier.dossier && (
            <p className="text-[11px] break-all text-texte-doux">Dossier des rapports&nbsp;: {dossier.dossier}</p>
          )}
        </>
      )}
    </div>
  );
}
