import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Activity,
  CircleCheck,
  CircleDashed,
  CircleX,
  Copy,
  Info,
  Lock,
  Plus,
  Power,
  Rocket,
  Search,
  Trash2,
  Zap,
} from "lucide-react";
import { BarresDispo, Bouton, BoutonCopier, Carte, EtatVide, Kpi, MenuActions, Segments } from "./ui";
import Diagnostic from "./Diagnostic";
import FormulaireCheck from "./FormulaireCheck";
import { basculerCheck, creerCheck, disponibiliteParTranche, historiqueSite, listerChecks, supprimerCheck } from "../lib/queries";
import { SEUIL_CERT_JOURS } from "../lib/statut";
import { SEUIL_DOMAINE_JOURS } from "../lib/assertions";
import { suggestionsRestantes } from "../lib/checksSuggeres";
import { dernierResultat, heure, LIBELLES_TYPE, resumeAssertions, texteCheck } from "../lib/affichageChecks";
import { joursDepuis } from "../lib/format";
import { centile, formatTaux, latenceParDemiHeure, tauxTranches, tranchesCompletes } from "../lib/tranches";
import { STYLE_INFOBULLE } from "../lib/graphes";

const FENETRES = [
  { cle: "24h", libelle: "24 h", heures: 24, n: 24, parJour: false },
  { cle: "7j", libelle: "7 j", heures: 168, n: 168, parJour: false },
  { cle: "30j", libelle: "30 j", heures: 720, n: 30, parJour: true },
  { cle: "90j", libelle: "90 j", heures: 2160, n: 90, parJour: true },
];

/** Ce que vise un check, en court : le chemin sur le site, ou le domaine pour TLS et DNS. */
function cible(check, site) {
  if (check.type === "tls" || check.type === "domaine") {
    try {
      return check.domaine ?? new URL(check.url).hostname;
    } catch {
      return check.url;
    }
  }
  return (site.url ? check.url.replace(site.url.replace(/\/$/, ""), "") : check.url) || "/";
}

/** Tonalite d'une disponibilite : vert a 99 %, orange a 95 %, rouge en dessous. */
function tonTaux(taux) {
  if (taux == null) return "neutre";
  if (taux >= 99) return "ok";
  return taux >= 95 ? "alerte" : "ko";
}

/**
 * Onglet Sante de la fiche d'un site : disponibilite, latence, checks
 * (avec catalogue en un clic, check sur mesure, inspection) et informations.
 */
export default function SanteSite({ site, rafraichissement }) {
  const [checks, setChecks] = useState([]);
  const [historique, setHistorique] = useState([]);
  const [fenetre, setFenetre] = useState("24h");
  const [tranches, setTranches] = useState([]);
  const [diagnostic, setDiagnostic] = useState(null);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [erreur, setErreur] = useState("");

  const choix = FENETRES.find((f) => f.cle === fenetre);

  const recharger = useCallback(async () => {
    try {
      const [c, h, d] = await Promise.all([
        listerChecks(site.id),
        historiqueSite(site.id, 24),
        disponibiliteParTranche({ heures: choix.heures, parJour: choix.parJour, siteId: site.id }),
      ]);
      setChecks(c);
      setHistorique(h);
      setTranches(tranchesCompletes(d, { n: choix.n, parJour: choix.parJour }));
    } catch (e) {
      setErreur(String(e?.message ?? e));
    }
  }, [site.id, choix]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    recharger();
    // `rafraichissement` bouge a chaque cycle de supervision : la fiche suit
  }, [recharger, rafraichissement]);

  async function agir(action) {
    setErreur("");
    try {
      await action();
      await recharger();
    } catch (e) {
      setErreur(String(e?.message ?? e));
    }
  }

  function ajouterSuggestion(suggestion) {
    return agir(() =>
      creerCheck({
        siteId: site.id,
        libelle: suggestion.libelle,
        url: suggestion.url,
        type: suggestion.type,
        doitContenir: suggestion.doitContenir ?? null,
        tailleMinOctets: suggestion.tailleMinOctets ?? null,
        occurrencesMin: suggestion.occurrencesMin ?? null,
        entetes: suggestion.entetes ?? [],
        cibleAttendue: suggestion.cibleAttendue ?? null,
        extracteur: suggestion.extracteur ?? null,
        domaine: suggestion.domaine ?? null,
        seuilJours: { tls: SEUIL_CERT_JOURS, domaine: SEUIL_DOMAINE_JOURS }[suggestion.type] ?? null,
      }),
    );
  }

  async function inspecter(check) {
    setDiagnostic({ check, inspection: null, enCours: true });
    try {
      const inspection = await invoke("inspecter_url", { url: check.url });
      setDiagnostic({ check, inspection, enCours: false });
    } catch (e) {
      setDiagnostic({ check, inspection: { erreur: String(e) }, enCours: false });
    }
  }

  function retirer(check) {
    if (window.confirm(`Supprimer le check « ${check.libelle} » et son historique ?`)) {
      agir(() => supprimerCheck(check.id));
    }
  }

  // Les checks `valeur` ne rendent aucun verdict : a part, sans compter dans l'etat
  const supervises = checks.filter((c) => c.type !== "valeur");
  const informations = checks.filter((c) => c.type === "valeur");
  const verifies = supervises.filter((c) => c.actif && c.derniere_verif);
  const enEchec = verifies.filter((c) => !c.dernier_ok).length;
  const suggestions = suggestionsRestantes(site.url, checks);

  const taux = tauxTranches(tranches);
  const latences = historique.filter((v) => v.ok && v.latence_ms != null).map((v) => v.latence_ms);
  const p50 = centile(latences, 50);
  const p95 = centile(latences, 95);
  const serieLatence = latenceParDemiHeure(historique);
  const tls = supervises.find((c) => c.type === "tls" && c.actif);
  const version = informations.find((c) => c.valeur_courante);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi
          libelle={`Disponibilité ${choix.libelle}`}
          valeur={formatTaux(taux)}
          ton={tonTaux(taux)}
          valeurColoree={taux != null && taux < 99}
          Icone={Activity}
          detail={`${tranches.reduce((t, x) => t + x.total, 0)} vérification(s)`}
        />
        <Kpi
          libelle="Latence p50 · p95"
          valeur={p50 == null ? "—" : `${p50} · ${p95} ms`}
          ton="info"
          Icone={Zap}
          detail="sur 24 h, vérifications réussies"
        />
        {tls ? (
          <Kpi
            libelle="Certificat TLS"
            valeur={tls.derniers_jours == null ? "—" : `${tls.derniers_jours} jours`}
            ton={tls.dernier_ok ? "ok" : "alerte"}
            Icone={Lock}
            detail={tls.dernier_ok ? "avant expiration" : dernierResultat(tls)}
          />
        ) : (
          <Kpi
            libelle="Checks"
            valeur={verifies.length === 0 ? "—" : `${verifies.length - enEchec} / ${verifies.length} OK`}
            ton={enEchec ? "ko" : "ok"}
            Icone={CircleCheck}
            detail={enEchec ? `${enEchec} en échec` : "tous au vert"}
          />
        )}
        {version ? (
          <Kpi
            libelle={version.libelle}
            valeur={(() => {
              const j = joursDepuis(version.valeur_depuis);
              return j == null ? "—" : j === 0 ? "aujourd'hui" : `il y a ${j} j`;
            })()}
            ton="neutre"
            Icone={Rocket}
            detail={version.valeur_courante}
          />
        ) : (
          <Kpi
            libelle="Checks"
            valeur={verifies.length === 0 ? "—" : `${verifies.length - enEchec} / ${verifies.length} OK`}
            ton={enEchec ? "ko" : "ok"}
            Icone={CircleCheck}
            detail={`${informations.length} information(s) suivie(s)`}
          />
        )}
      </div>

      <Carte
        titre={`Disponibilité · ${choix.libelle}`}
        action={<Segments options={FENETRES} valeur={fenetre} onChanger={setFenetre} />}
      >
        <BarresDispo tranches={tranches} hauteur="h-9" titre={`Disponibilité de ${site.nom}`} />
        <div className="mt-2 flex justify-between text-[11px] text-pale">
          <span>{tranches[0]?.libelle.split(" : ")[0]}</span>
          <span>Maintenant</span>
        </div>
      </Carte>

      <div className="grid gap-5 xl:grid-cols-5">
        <Carte className="xl:col-span-3" titre="Latence · 24 h">
          {serieLatence.length === 0 ? (
            <EtatVide>Aucune vérification réussie sur les dernières 24 h.</EtatVide>
          ) : (
            <>
              <div className="mb-2 flex gap-4 text-[11px] text-texte-doux">
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-info" />Médiane</span>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 border-t border-dashed border-pale" />95e centile</span>
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={serieLatence} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="degrade-latence" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-info)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--color-info)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--color-bord)" vertical={false} />
                    <XAxis dataKey="heure" stroke="var(--color-pale)" fontSize={11} tickLine={false} axisLine={false} minTickGap={40} />
                    <YAxis stroke="var(--color-pale)" fontSize={11} tickLine={false} axisLine={false} width={60} tickFormatter={(v) => `${v} ms`} />
                    <Tooltip contentStyle={STYLE_INFOBULLE} formatter={(v, nom) => [`${v} ms`, nom]} />
                    <Area dataKey="p95" name="95e centile" stroke="var(--color-pale)" strokeDasharray="4 4" fill="none" strokeWidth={1.5} type="monotone" />
                    <Area dataKey="p50" name="Médiane" stroke="var(--color-info)" fill="url(#degrade-latence)" strokeWidth={2} type="monotone" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </Carte>

        <Carte
          className="xl:col-span-2"
          titre="Checks"
          action={
            <span className={`text-xs ${enEchec ? "font-medium text-ko" : "text-texte-doux"}`}>
              {verifies.length === 0 ? "aucun vérifié" : `${verifies.length - enEchec} / ${verifies.length} OK`}
            </span>
          }
        >
          {supervises.length === 0 ? (
            <EtatVide>Aucun check : ajoute-en un ci-dessous.</EtatVide>
          ) : (
            <ul className="-mx-2 flex flex-col gap-0.5">
              {supervises.map((c) => {
                const echec = c.actif && c.derniere_verif && !c.dernier_ok;
                const Icone = !c.actif ? Power : !c.derniere_verif ? CircleDashed : c.dernier_ok ? CircleCheck : CircleX;
                const assertions = resumeAssertions(c);
                return (
                  <li
                    key={c.id}
                    className={`flex items-center gap-3 rounded-lg px-2 py-2 ${echec ? "bg-ko/8 ring-1 ring-ko/25" : ""} ${c.actif ? "" : "opacity-50"}`}
                    title={assertions ? `Vérifie : ${assertions}` : undefined}
                  >
                    <Icone size={16} className={`shrink-0 ${!c.actif || !c.derniere_verif ? "text-pale" : c.dernier_ok ? "text-ok" : "text-ko"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[13px] font-medium">
                        <span className="truncate">{c.libelle}</span>
                        {c.type !== "http" && (
                          <span className="rounded bg-surface-3 px-1 py-px text-[9px] font-semibold text-texte-doux">{LIBELLES_TYPE[c.type] ?? c.type}</span>
                        )}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-pale">{cible(c, site)}</span>
                    </span>
                    <span className={`chiffres max-w-40 truncate text-right text-xs ${echec ? "font-medium text-ko" : "text-texte-doux"}`} title={c.derniere_verif ? `${dernierResultat(c)} à ${heure(c.derniere_verif)}` : undefined}>
                      {!c.actif
                        ? "désactivé"
                        : !c.derniere_verif
                          ? "jamais vérifié"
                          : echec || c.type !== "http"
                            ? dernierResultat(c)
                            : c.derniere_latence != null
                              ? `${c.derniere_latence} ms`
                              : dernierResultat(c)}
                    </span>
                    <MenuActions
                      actions={[
                        { libelle: "Inspecter la requête", Icone: Search, onClick: () => inspecter(c) },
                        { libelle: "Copier ce check", Icone: Copy, onClick: () => writeText(texteCheck(c)).catch(() => {}) },
                        { libelle: c.actif ? "Désactiver" : "Activer", Icone: Power, onClick: () => agir(() => basculerCheck(c.id, !c.actif)) },
                        { libelle: "Supprimer", Icone: Trash2, onClick: () => retirer(c), danger: true, separe: true },
                      ]}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          {erreur && <p className="mt-2 text-xs text-ko">{erreur}</p>}
        </Carte>
      </div>

      {diagnostic && (
        <Diagnostic
          check={diagnostic.check}
          inspection={diagnostic.inspection}
          site={site}
          enCours={diagnostic.enCours}
          onFermer={() => setDiagnostic(null)}
        />
      )}

      <Carte titre="Ajouter des checks">
        {suggestions.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s.cle}
                type="button"
                onClick={() => ajouterSuggestion(s)}
                title={`${s.description} — ${s.url}`}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-texte-doux ring-1 ring-bord transition hover:text-texte hover:ring-accent"
              >
                <Plus size={12} />
                {s.libelle}
              </button>
            ))}
          </div>
        )}
        {formulaireOuvert ? (
          <FormulaireCheck
            site={site}
            onAjoute={async () => {
              await recharger();
              setFormulaireOuvert(false);
            }}
          />
        ) : (
          <Bouton variante="fantome" className="flex items-center gap-1.5 text-xs" onClick={() => setFormulaireOuvert(true)}>
            <Plus size={13} />
            Check personnalisé
          </Bouton>
        )}
      </Carte>

      {informations.length > 0 && (
        <Carte titre="Informations suivies" action={<Info size={14} className="text-pale" aria-label="Sans verdict : elles ne comptent pas dans la disponibilité" />}>
          <ul className="flex flex-col divide-y divide-bord/60">
            {informations.map((c) => {
              const jours = joursDepuis(c.valeur_depuis);
              return (
                <li key={c.id} className="flex items-center gap-3 py-2 text-[13px]">
                  <span className="w-44 shrink-0 truncate text-texte-doux">{c.libelle}</span>
                  <span className="flex-1 truncate font-mono text-xs">{c.valeur_courante ?? (c.derniere_erreur || "—")}</span>
                  {c.valeur_depuis && (
                    <span className="shrink-0 text-xs text-pale">{jours === 0 ? "changé aujourd'hui" : `inchangé depuis ${jours} j`}</span>
                  )}
                  <BoutonCopier texte={() => `${c.libelle} — ${c.url} — ${c.valeur_courante ?? (c.derniere_erreur || "—")}`} titre="Copier cette information" />
                  <MenuActions
                    actions={[
                      { libelle: "Inspecter la requête", Icone: Search, onClick: () => inspecter(c) },
                      { libelle: "Supprimer", Icone: Trash2, onClick: () => retirer(c), danger: true, separe: true },
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        </Carte>
      )}
    </>
  );
}
