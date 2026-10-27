import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Globe,
  LayoutDashboard,
  Moon,
  Plus,
  Repeat,
  Rocket,
  Search,
  Settings,
  Sun,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { Monogramme } from "./ui";
import ListeATraiter from "./ListeATraiter";
import { couleurEtat, etatSite } from "../lib/statut";

const NAV = [
  { cle: "accueil", libelle: "Vue d'ensemble", Icone: LayoutDashboard },
  { cle: "sites", libelle: "Sites", Icone: Globe },
  { cle: "finances", libelle: "Finances", Icone: Wallet },
  { cle: "reglages", libelle: "Réglages", Icone: Settings },
];

/**
 * La cloche : ouvre la liste « A traiter » sur place, quel que soit l'ecran.
 * Avant, elle menait a la vue d'ensemble — et ne faisait rien quand on y etait.
 */
function PanneauATraiter({ liste, nombre, onOuvrirCible, onToutVoir }) {
  const [ouvert, setOuvert] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!ouvert) return undefined;
    const dehors = (e) => !ref.current?.contains(e.target) && setOuvert(false);
    const echap = (e) => e.key === "Escape" && setOuvert(false);
    document.addEventListener("mousedown", dehors);
    window.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("mousedown", dehors);
      window.removeEventListener("keydown", echap);
    };
  }, [ouvert]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        className={`relative grid size-9 place-items-center rounded-lg ring-1 ring-bord transition hover:bg-surface-2 hover:text-texte ${ouvert ? "bg-surface-2 text-texte" : "text-texte-doux"}`}
        title={nombre > 0 ? `${nombre} point(s) à traiter` : "Rien à traiter"}
        aria-label="À traiter"
      >
        <Bell size={16} />
        {nombre > 0 && (
          <span className="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-alerte px-1 text-[10px] font-bold text-black">{nombre}</span>
        )}
      </button>
      {ouvert && (
        <div
          role="dialog"
          aria-label="À traiter"
          className="absolute top-full right-0 z-30 mt-2 w-[380px] rounded-2xl bg-surface p-4 shadow-2xl ring-1 ring-bord"
          style={{ animation: "apparaitre 120ms ease-out" }}
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold">À traiter</h2>
            <button
              type="button"
              onClick={() => {
                setOuvert(false);
                onToutVoir();
              }}
              className="text-xs font-medium text-texte-doux hover:text-texte"
            >
              Vue d&apos;ensemble
            </button>
          </div>
          <ListeATraiter
            liste={liste}
            className="max-h-96"
            onOuvrirCible={(cible) => {
              setOuvert(false);
              onOuvrirCible(cible);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Bouton « + Nouveau » et son menu : ce qu'on saisit le plus, a un clic de partout. */
function BoutonNouveau({ onNouveau }) {
  const [ouvert, setOuvert] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!ouvert) return undefined;
    const dehors = (e) => !ref.current?.contains(e.target) && setOuvert(false);
    document.addEventListener("mousedown", dehors);
    return () => document.removeEventListener("mousedown", dehors);
  }, [ouvert]);

  const choix = [
    ["depense", "Dépense", ArrowUpRight, "text-depense"],
    ["revenu", "Revenu", ArrowDownRight, "text-revenu"],
    ["abonnement", "Abonnement", Repeat, "text-abonnement"],
    ["site", "Site", Globe, "text-accent-2"],
  ];
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-semibold text-white shadow-lg shadow-accent/25 transition hover:brightness-110"
      >
        <Plus size={16} strokeWidth={2.5} />
        Nouveau
      </button>
      {ouvert && (
        <div
          role="menu"
          className="absolute top-full right-0 z-30 mt-1.5 w-48 rounded-xl bg-surface-2 p-1.5 shadow-2xl ring-1 ring-bord"
          style={{ animation: "apparaitre 120ms ease-out" }}
        >
          {choix.map(([cle, libelle, Icone, couleur]) => (
            <button
              key={cle}
              type="button"
              role="menuitem"
              onClick={() => {
                setOuvert(false);
                onNouveau(cle);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-surface-3"
            >
              <Icone size={15} className={couleur} />
              {libelle}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Coquille({
  page,
  siteActif = null,
  titre,
  sites = [],
  aTraiter = 0,
  listeATraiter = [],
  onOuvrirCible,
  miseAJour = null,
  verificationEnCours = false,
  intervalleS,
  theme,
  onBasculerTheme,
  onNaviguer,
  onOuvrirSite,
  onNouveau,
  onPalette,
  bandeau = null,
  children,
}) {
  return (
    <div className="flex h-full bg-fond text-texte">
      <nav className="flex w-60 shrink-0 flex-col border-r border-bord bg-surface/60 px-3 py-4">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-accent to-info text-white shadow-lg shadow-accent/25">
            <Activity size={17} strokeWidth={2.5} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">SiteDashboard</span>
        </div>

        <div className="flex flex-col gap-0.5">
          {NAV.map(({ cle, libelle, Icone }) => {
            const actif = page === cle;
            return (
              <button
                key={cle}
                type="button"
                onClick={() => onNaviguer(cle)}
                aria-current={actif ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium transition ${
                  actif ? "bg-accent/12 text-texte" : "text-texte-doux hover:bg-surface-2 hover:text-texte"
                }`}
              >
                <Icone size={17} className={actif ? "text-accent-2" : ""} />
                {libelle}
                {cle === "accueil" && aTraiter > 0 && (
                  <span className="ml-auto rounded-full bg-alerte/15 px-1.5 text-[11px] font-semibold text-alerte" title={`${aTraiter} point(s) à traiter`}>
                    {aTraiter}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {sites.length > 0 && (
          <>
            <p className="mt-7 mb-2 px-2.5 text-[11px] font-medium tracking-wider text-pale uppercase">Mes sites</p>
            <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
              {sites.map((s) => {
                const etat = etatSite(s);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onOuvrirSite(s.id)}
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition ${
                      siteActif === s.id ? "bg-surface-3 text-texte" : "text-texte-doux hover:bg-surface-2 hover:text-texte"
                    }`}
                  >
                    <Monogramme site={s} taille={20} />
                    <span className="min-w-0 flex-1 truncate">{s.nom}</span>
                    {etat === "ok" || etat === "aucun" || etat === "inconnu" ? (
                      <span className="size-1.5 shrink-0 rounded-full" style={{ background: couleurEtat(etat) }} />
                    ) : (
                      <TriangleAlert size={13} className="shrink-0" style={{ color: couleurEtat(etat) }} aria-label="Problème" />
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="mt-auto flex flex-col gap-2 pt-4">
          {miseAJour?.disponible && (
            <button
              type="button"
              onClick={() => onNaviguer("reglages")}
              className="flex items-center gap-2.5 rounded-xl bg-accent/10 px-3 py-2.5 text-left ring-1 ring-accent/25 transition hover:bg-accent/15"
              title="Voir la mise à jour dans les Réglages"
            >
              <Rocket size={15} className="shrink-0 text-accent-2" />
              <span className="text-xs leading-tight">
                Mise à jour prête
                <span className="block text-[11px] text-texte-doux">{miseAJour.libelle}</span>
              </span>
            </button>
          )}
          <div className="flex items-center justify-between px-2.5 text-[11px] text-pale">
            <span className="flex items-center gap-1.5" title={`Vérification toutes les ${intervalleS} s`}>
              <span className="relative flex size-2">
                {verificationEnCours && <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />}
                <span className="relative inline-flex size-2 rounded-full bg-ok" />
              </span>
              {verificationEnCours ? "Vérification…" : "Supervision active"}
            </span>
            <button
              type="button"
              onClick={onBasculerTheme}
              className="rounded-md p-1 hover:bg-surface-2 hover:text-texte"
              title={theme === "clair" ? "Passer en thème sombre" : "Passer en thème clair"}
              aria-label="Changer de thème"
            >
              {theme === "clair" ? <Moon size={14} /> : <Sun size={14} />}
            </button>
          </div>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-4 border-b border-bord px-8">
          <div className="min-w-0 flex-1">{titre}</div>
          <button
            type="button"
            onClick={onPalette}
            className="flex w-72 items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-pale ring-1 ring-bord transition hover:ring-accent"
          >
            <Search size={15} />
            Rechercher, aller à…
            <span className="ml-auto rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-texte-doux">Ctrl K</span>
          </button>
          <PanneauATraiter
            liste={listeATraiter}
            nombre={aTraiter}
            onOuvrirCible={onOuvrirCible}
            onToutVoir={() => onNaviguer("accueil")}
          />
          <BoutonNouveau onNouveau={onNouveau} />
        </header>
        {bandeau}
        <main className="flex-1 overflow-y-auto px-8 py-7">
          <div className="mx-auto flex max-w-[1280px] flex-col gap-5">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** Titre de page dans la barre du haut : un titre et, au besoin, une ligne de contexte. */
export function TitrePage({ titre, sousTitre = null, children = null }) {
  return (
    <div className="flex items-center gap-6">
      <div className="min-w-0">
        <h1 className="truncate text-[17px] font-semibold tracking-tight">{titre}</h1>
        {sousTitre && <p className="truncate text-xs text-texte-doux">{sousTitre}</p>}
      </div>
      {children}
    </div>
  );
}
