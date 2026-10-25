import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ChevronDown, ChevronRight, CircleDashed, FolderOpen, RefreshCw } from "lucide-react";
import { ICONES } from "../components/CarteSite";
import { Bouton, BoutonCopier, Carte, EtatVide } from "../components/ui";
import { couleurEtat, iconeEtat, libelleEtat } from "../lib/statut";
import {
  JOURS_HISTORIQUE,
  STATUTS_RAPPORT,
  dateDepuis,
  domaine,
  heureRapport,
  lireRapport,
  rattacherSite,
  regrouperParJournee,
  texteJournee,
  texteRapport,
} from "../lib/rapportsAgents";
import { SITUATIONS, texteAttendu } from "../lib/tachesPlanifiees";
import { tracer } from "../lib/trace";

const LIBELLES_VERDICT = {
  ok: "Tout s'est bien passe",
  partiel: "Des points a regarder",
  ko: "Trop d'agents ont echoue",
};

/** '2026-10-24' -> 'samedi 24 octobre 2026' */
function jourLisible(dateIso) {
  const [a, m, j] = dateIso.split("-").map(Number);
  if (!a || !m || !j) return dateIso;
  return new Date(a, m - 1, j).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function IconeEtat({ etat, taille = 18 }) {
  const Icone = ICONES[iconeEtat(etat)] ?? CircleDashed;
  return (
    <Icone
      size={taille}
      strokeWidth={2.25}
      style={{ color: couleurEtat(etat) }}
      className="shrink-0"
      aria-hidden="true"
    />
  );
}

function resumeCompte({ ok, attention, echec }) {
  const morceaux = [];
  if (ok) morceaux.push(`${ok} OK`);
  if (attention) morceaux.push(`${attention} a regarder`);
  if (echec) morceaux.push(`${echec} en echec`);
  return morceaux.join(" · ");
}

function DetailRapport({ rapport }) {
  const etat = STATUTS_RAPPORT[rapport.statut].etat;
  const heure = heureRapport(rapport.debut) ?? heureRapport(rapport.fin);
  const fichier = rapport.fichierSuivi ?? rapport.chemin;

  return (
    <li className="flex gap-3 rounded-lg border border-bord bg-surface-2/40 p-3">
      <IconeEtat etat={etat} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-semibold text-texte">{rapport.titre}</p>
          <p className="flex items-center gap-1 text-[11px] text-texte-doux tabular-nums">
            <span style={{ color: couleurEtat(etat) }}>
              {STATUTS_RAPPORT[rapport.statut].libelle}
            </span>
            {heure && ` · ${heure}`}
            <BoutonCopier texte={() => texteRapport(rapport)} titre="Copier ce rapport" />
          </p>
        </div>
        {rapport.resume && <p className="mt-1 text-xs text-texte-doux">{rapport.resume}</p>}
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
          onClick={() =>
            revealItemInDir(fichier).catch((e) => tracer("agents", `ouverture impossible: ${e}`))
          }
          className="mt-2 flex items-center gap-1.5 text-[11px] text-texte-doux hover:text-texte"
          title={fichier}
        >
          <FolderOpen size={12} />
          {rapport.fichierSuivi ? "Voir le fichier de suivi" : "Voir le rapport"}
        </button>
      </div>
    </li>
  );
}

function LigneJournee({ ligne, site, ouverte, onBasculer }) {
  const Chevron = ouverte ? ChevronDown : ChevronRight;
  return (
    <li className="overflow-hidden rounded-xl border border-bord bg-surface">
      <button
        type="button"
        onClick={onBasculer}
        aria-expanded={ouverte}
        title={`${libelleEtat(ligne.verdict)} — ${LIBELLES_VERDICT[ligne.verdict] ?? ""}`}
        className="relative flex w-full items-center gap-3 py-3 pr-3 pl-5 text-left transition hover:bg-surface-2"
      >
        {/* La couleur identifie le site, l'icone porte le verdict (voir CarteSite) */}
        <span
          className="absolute inset-y-0 left-0 w-1.5"
          style={{ background: site?.couleur ?? "#3a4570" }}
          aria-hidden="true"
        />
        <IconeEtat etat={ligne.verdict} taille={20} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-texte">
            {site?.nom ?? ligne.site}
            <span className="ml-2 font-normal text-texte-doux">{jourLisible(ligne.date)}</span>
          </p>
          <p className="truncate text-[11px] text-texte-doux">
            {ligne.rapports.length} rapport(s) · {resumeCompte(ligne.compte)}
          </p>
        </div>
        <Chevron size={16} className="shrink-0 text-texte-doux" />
      </button>
      {ouverte && (
        <div className="border-t border-bord p-3">
          <div className="mb-2 flex justify-end">
            <span className="flex items-center gap-1 text-[11px] text-texte-doux">
              Copier toute la journee
              <BoutonCopier texte={() => texteJournee(ligne)} titre="Copier tous les rapports du jour" />
            </span>
          </div>
          <ul className="flex flex-col gap-2">
            {ligne.rapports.map((r) => (
              <DetailRapport key={r.cle} rapport={r} />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

/** Un agent attendu aujourd'hui: rapport recu, en cours, bloque, pas lance ou a venir. */
function LigneAttendu({ attendu, site }) {
  const { rapport, situation } = attendu;
  const etat = rapport ? STATUTS_RAPPORT[rapport.statut].etat : SITUATIONS[situation].etat;
  const libelle = rapport ? STATUTS_RAPPORT[rapport.statut].libelle : SITUATIONS[situation].libelle;
  const enRetard = situation === "bloque" || situation === "non_lance";

  return (
    <li className="flex items-start gap-3 py-2">
      <IconeEtat etat={etat} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="text-sm font-semibold text-texte">
            {attendu.titre}
            <span className="ml-2 font-normal text-texte-doux">{site?.nom ?? attendu.site}</span>
          </p>
          <p className="flex items-center gap-1 text-[11px] tabular-nums" style={{ color: couleurEtat(etat) }}>
            {libelle}
            {attendu.heure && <span className="text-texte-doux"> · {attendu.heure}</span>}
            <BoutonCopier
              texte={() => (rapport ? texteRapport(rapport) : texteAttendu(attendu))}
              titre="Copier"
            />
          </p>
        </div>
        <p className={`text-xs ${enRetard ? "text-texte" : "text-texte-doux"}`}>{attendu.message}</p>
      </div>
    </li>
  );
}

function AttendusAujourdhui({ attendus, configTrouvee, sites }) {
  if (!configTrouvee) {
    return (
      <Carte>
        <p className="text-xs text-texte-doux">
          Horaires des taches planifiees introuvables : impossible de dire quels rapports
          manquent aujourd'hui.
        </p>
      </Carte>
    );
  }
  if (attendus.length === 0) return null;

  return (
    <Carte>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Attendus aujourd'hui</h2>
        <BoutonCopier
          texte={() => attendus.map(texteAttendu).join("\n")}
          titre="Copier la liste des agents attendus"
        />
      </div>
      <ul className="mt-1 flex flex-col divide-y divide-bord">
        {attendus.map((a) => (
          <LigneAttendu key={a.id} attendu={a} site={rattacherSite(a.site, sites)} />
        ))}
      </ul>
    </Carte>
  );
}

export default function Agents({
  sites = [],
  rafraichissement,
  attendus = [],
  configTrouvee = true,
}) {
  const [dossier, setDossier] = useState({ dossier: "", existe: true, fichiers: [] });
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [filtre, setFiltre] = useState(null);
  const [ouvertes, setOuvertes] = useState(() => new Set());

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

  const lignes = useMemo(
    () => regrouperParJournee(dossier.fichiers.map(lireRapport)),
    [dossier.fichiers],
  );

  // Les sites proposes au filtre sont ceux qui ont des rapports, pas tous les sites suivis
  const sitesAvecRapports = useMemo(() => {
    const vus = new Map();
    for (const l of lignes) {
      const cle = domaine(l.site) || l.site;
      if (!vus.has(cle)) vus.set(cle, { cle, site: rattacherSite(l.site, sites), nom: l.site });
    }
    return [...vus.values()];
  }, [lignes, sites]);

  const lignesVisibles = filtre
    ? lignes.filter((l) => (domaine(l.site) || l.site) === filtre)
    : lignes;

  function basculer(cle) {
    setOuvertes((avant) => {
      const apres = new Set(avant);
      if (apres.has(cle)) apres.delete(cle);
      else apres.add(cle);
      return apres;
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Agents</h1>
          <p className="text-xs text-texte-doux">
            Rapports des taches planifiees, sur les {JOURS_HISTORIQUE} derniers jours
          </p>
        </div>
        <Bouton variante="fantome" onClick={charger} disabled={chargement}>
          <span className="flex items-center gap-1.5">
            <RefreshCw size={14} className={chargement ? "animate-spin" : ""} />
            Actualiser
          </span>
        </Bouton>
      </div>

      <AttendusAujourdhui attendus={attendus} configTrouvee={configTrouvee} sites={sites} />

      {sitesAvecRapports.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {[{ cle: null, nom: "Tous" }, ...sitesAvecRapports].map((s) => (
            <button
              key={s.cle ?? "tous"}
              type="button"
              onClick={() => setFiltre(s.cle)}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition ${
                filtre === s.cle
                  ? "border-accent bg-accent/15 text-texte"
                  : "border-bord text-texte-doux hover:border-accent"
              }`}
            >
              {s.cle && (
                <span
                  className="size-2 rounded-full"
                  style={{ background: s.site?.couleur ?? "#3a4570" }}
                />
              )}
              {s.site?.nom ?? s.nom}
            </button>
          ))}
        </div>
      )}

      {erreur && (
        <Carte>
          <p className="text-sm text-depense">Lecture des rapports impossible : {erreur}</p>
        </Carte>
      )}

      {!erreur && lignesVisibles.length === 0 && !chargement && (
        <Carte>
          <EtatVide>
            {dossier.existe
              ? "Aucun rapport sur la periode."
              : "Aucun agent n'a encore depose de rapport."}
          </EtatVide>
        </Carte>
      )}

      {lignesVisibles.length > 0 && (
        <ul className="flex flex-col gap-2">
          {lignesVisibles.map((ligne) => (
            <LigneJournee
              key={ligne.cle}
              ligne={ligne}
              site={rattacherSite(ligne.site, sites)}
              ouverte={ouvertes.has(ligne.cle)}
              onBasculer={() => basculer(ligne.cle)}
            />
          ))}
        </ul>
      )}

      {dossier.dossier && (
        <p className="text-[11px] break-all text-texte-doux">
          Dossier des rapports&nbsp;: {dossier.dossier}
        </p>
      )}
    </div>
  );
}
