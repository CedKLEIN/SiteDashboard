/**
 * Maquettes de la refonte UX/UI, a valider avant implementation.
 * Donnees de demonstration en dur ; rien ne touche la base.
 *
 *   npm run dev  puis  http://127.0.0.1:1420/maquettes/?ecran=cockpit&theme=clair
 *
 * Ecrans : cockpit, site, transactions, abonnements, palette.
 */
import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Bot,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock,
  CornerDownLeft,
  Cpu,
  Ellipsis,
  ExternalLink,
  Globe,
  History,
  Image,
  LayoutDashboard,
  Lock,
  Megaphone,
  Moon,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Repeat,
  Rocket,
  Search,
  Server,
  Settings,
  Sparkles,
  Square,
  Tag,
  Trash2,
  TriangleAlert,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import "./maquettes.css";

/* ------------------------------------------------------------------ donnees */

const SITES = [
  { id: 1, nom: "Denivio", url: "denivio.fr", couleur: "#22c55e", etat: "ok", dispo: "99,98", latence: 182, marge: 412.3, rev: 1058.4, dep: 646.1 },
  { id: 2, nom: "HistorySite", url: "historysite.fr", couleur: "#f59e0b", etat: "alerte", dispo: "99,21", latence: 241, marge: 214.9, rev: 621.3, dep: 406.4 },
  { id: 3, nom: "RoisEmpereurs", url: "roisempereurs.fr", couleur: "#a855f7", etat: "ok", dispo: "100", latence: 133, marge: -96.2, rev: 371.5, dep: 467.7 },
  { id: 4, nom: "SiteWatcher", url: "sitewatcher.io", couleur: "#3b82f6", etat: "ok", dispo: "99,95", latence: 98, marge: -267.4, rev: 0, dep: 267.4 },
];

const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct."];
const FLUX = MOIS.map((mois, i) => {
  const rev = [312, 370, 178, 52, 424, 138, 305, 33, 137, 98][i];
  const dep = [88, 312, 318, 256, 30, 210, 52, 52, 40, 176][i];
  const abo = 134;
  return { mois, rev, dep: -dep, abo: -abo };
});
let cumul = 0;
for (const p of FLUX) {
  cumul += p.rev + p.dep + p.abo;
  p.marge = cumul;
}

const LATENCE = Array.from({ length: 48 }, (_, i) => ({
  h: `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
  p50: Math.round(200 + 40 * Math.sin(i / 5) + (i > 40 ? 60 : 0)),
  p95: Math.round(330 + 60 * Math.sin(i / 4) + (i > 40 ? 140 : 0)),
}));

const ETATS = {
  ok: { libelle: "Opérationnel", Icone: CircleCheck, classe: "text-ok", fond: "bg-ok/12" },
  alerte: { libelle: "Dégradé", Icone: TriangleAlert, classe: "text-alerte", fond: "bg-alerte/12" },
  ko: { libelle: "Hors ligne", Icone: CircleX, classe: "text-ko", fond: "bg-ko/12" },
};

const euros = (v, signe = false) =>
  `${signe && v > 0 ? "+" : ""}${new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(v)}`;

/* ------------------------------------------------------------- briques UI */

function Monogramme({ site, taille = "size-8", texte = "text-sm" }) {
  return (
    <span
      className={`${taille} ${texte} grid shrink-0 place-items-center rounded-lg font-semibold`}
      style={{ background: `${site.couleur}22`, color: site.couleur, boxShadow: `inset 0 0 0 1px ${site.couleur}33` }}
    >
      {site.nom.charAt(0)}
    </span>
  );
}

function PastilleEtat({ etat, libelle }) {
  const e = ETATS[etat];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${e.classe} ${e.fond}`}>
      <e.Icone size={12} strokeWidth={2.5} />
      {libelle ?? e.libelle}
    </span>
  );
}

function Carte({ titre, action, children, className = "", sansMarge = false }) {
  return (
    <section className={`rounded-2xl bg-surface ring-1 ring-ligne ${sansMarge ? "" : "p-5"} ${className}`}>
      {(titre || action) && (
        <header className={`flex items-center justify-between gap-3 ${sansMarge ? "px-5 pt-5" : ""} mb-4`}>
          <h2 className="text-[13px] font-semibold tracking-tight text-texte">{titre}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

function LienDiscret({ children }) {
  return (
    <button type="button" className="flex items-center gap-1 text-xs font-medium text-doux hover:text-texte">
      {children}
      <ChevronRight size={13} />
    </button>
  );
}

function Segments({ options, actif }) {
  return (
    <div className="inline-flex rounded-lg bg-surface-2 p-0.5 ring-1 ring-ligne">
      {options.map((o) => (
        <span
          key={o}
          className={`rounded-md px-3 py-1 text-xs font-medium ${
            o === actif ? "bg-surface-3 text-texte shadow-sm" : "text-doux"
          }`}
        >
          {o}
        </span>
      ))}
    </div>
  );
}

function BarresDispo({ n = 24, incidents = [], hauteur = "h-5", largeur = "w-1" }) {
  return (
    <div className="flex items-end gap-[2px]">
      {Array.from({ length: n }, (_, i) => {
        const inc = incidents.find((x) => x.i === i);
        const couleur = inc ? (inc.grave ? "bg-ko" : "bg-alerte") : "bg-ok/70";
        return <span key={i} className={`${largeur} ${hauteur} rounded-[2px] ${couleur}`} />;
      })}
    </div>
  );
}

function Sparkline({ points, couleur }) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const d = points
    .map((v, i) => `${(i / (points.length - 1)) * 100},${28 - ((v - min) / (max - min || 1)) * 24}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 30" className="h-8 w-24" preserveAspectRatio="none">
      <polyline points={d} fill="none" stroke={couleur} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Kpi({ libelle, valeur, delta, bon, couleur, points, Icone }) {
  const Fleche = delta?.startsWith("−") ? ArrowDownRight : ArrowUpRight;
  return (
    <div className="rounded-2xl bg-surface p-4 ring-1 ring-ligne">
      <div className="flex items-center gap-2 text-xs font-medium text-doux">
        <span className="grid size-6 place-items-center rounded-md" style={{ background: `color-mix(in srgb, ${couleur} 15%, transparent)`, color: couleur }}>
          <Icone size={13} />
        </span>
        {libelle}
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <p className="chiffres text-[26px] font-semibold leading-none tracking-tight">{valeur}</p>
          {delta && (
            <p className={`mt-2 flex items-center gap-0.5 text-xs font-medium ${bon ? "text-ok" : "text-ko"}`}>
              <Fleche size={13} />
              {delta}
              <span className="ml-1 font-normal text-pale">vs 2025</span>
            </p>
          )}
        </div>
        {points && <Sparkline points={points} couleur={couleur} />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- coquille */

const NAV = [
  { cle: "cockpit", libelle: "Vue d'ensemble", Icone: LayoutDashboard },
  { cle: "site", libelle: "Sites", Icone: Globe },
  { cle: "transactions", libelle: "Finances", Icone: Wallet },
  { cle: "reglages", libelle: "Réglages", Icone: Settings },
];

function Coquille({ actif, siteActif, titre, children }) {
  return (
    <div className="flex h-full bg-fond text-texte">
      <nav className="flex w-60 shrink-0 flex-col border-r border-ligne bg-surface/60 px-3 py-4">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-accent to-[#38bdf8] text-white shadow-lg shadow-accent/25">
            <Activity size={17} strokeWidth={2.5} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">SiteDashboard</span>
        </div>

        <div className="flex flex-col gap-0.5">
          {NAV.map(({ cle, libelle, Icone }) => (
            <span
              key={cle}
              className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium ${
                actif === cle ? "bg-accent/12 text-texte" : "text-doux"
              }`}
            >
              <Icone size={17} className={actif === cle ? "text-accent-2" : ""} />
              {libelle}
              {cle === "cockpit" && (
                <span className="ml-auto rounded-full bg-alerte/15 px-1.5 text-[11px] font-semibold text-alerte">3</span>
              )}
            </span>
          ))}
        </div>

        <p className="mt-7 mb-2 px-2.5 text-[11px] font-medium uppercase tracking-wider text-pale">Mes sites</p>
        <div className="flex flex-col gap-0.5">
          {SITES.map((s) => (
            <span
              key={s.id}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] ${
                siteActif === s.id ? "bg-surface-3 text-texte" : "text-doux"
              }`}
            >
              <Monogramme site={s} taille="size-5" texte="text-[10px]" />
              {s.nom}
              <span className={`ml-auto size-1.5 rounded-full ${s.etat === "ok" ? "bg-ok" : "bg-alerte"}`} />
            </span>
          ))}
        </div>

        <div className="mt-auto flex flex-col gap-2">
          <div className="flex items-center gap-2.5 rounded-xl bg-accent/10 px-3 py-2.5 ring-1 ring-accent/25">
            <Rocket size={15} className="shrink-0 text-accent-2" />
            <span className="text-xs leading-tight">
              Mise à jour prête
              <span className="block text-[11px] text-doux">3 nouveautés</span>
            </span>
          </div>
          <div className="flex items-center justify-between px-2.5 text-[11px] text-pale">
            <span className="flex items-center gap-1.5">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-50" />
                <span className="relative inline-flex size-2 rounded-full bg-ok" />
              </span>
              Supervision active
            </span>
            <Moon size={14} />
          </div>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-4 border-b border-ligne px-8">
          <div className="min-w-0 flex-1">{titre}</div>
          <div className="flex w-80 items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-pale ring-1 ring-ligne">
            <Search size={15} />
            Rechercher, aller à…
            <span className="ml-auto rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-doux">Ctrl K</span>
          </div>
          <button type="button" className="relative grid size-9 place-items-center rounded-lg text-doux ring-1 ring-ligne">
            <Bell size={16} />
            <span className="absolute top-2 right-2 size-1.5 rounded-full bg-alerte" />
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-semibold text-white shadow-lg shadow-accent/25"
          >
            <Plus size={16} strokeWidth={2.5} />
            Nouveau
          </button>
        </header>
        <main className="flex-1 overflow-y-auto px-8 py-7">{children}</main>
      </div>
    </div>
  );
}

const STYLE_INFOBULLE = {
  background: "var(--color-surface-2)",
  border: "1px solid var(--color-ligne)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--color-texte)",
};

/* ------------------------------------------------------------------ cockpit */

const A_TRAITER = [
  { Icone: CircleX, ton: "ko", titre: "HistorySite · Santé de l'API", detail: "/healthz répond 503 depuis 12 min", action: "Voir" },
  { Icone: Bot, ton: "alerte", titre: "Agent SEO Denivio en retard", detail: "Prévu à 9 h 00, pas encore passé", action: "Lancer" },
  { Icone: Lock, ton: "alerte", titre: "Certificat sitewatcher.io", detail: "Expire dans 9 jours", action: "Voir" },
  { Icone: Repeat, ton: "info", titre: "VPS · OVH", detail: "Prélèvement de 11,99 € samedi", action: null },
];

const TONS = {
  ko: "bg-ko/12 text-ko",
  alerte: "bg-alerte/12 text-alerte",
  info: "bg-info/12 text-info",
  ok: "bg-ok/12 text-ok",
};

function Cockpit() {
  return (
    <Coquille
      actif="cockpit"
      titre={
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">Vue d&apos;ensemble</h1>
          <p className="text-xs text-doux">Mardi 27 octobre · 3 points à traiter</p>
        </div>
      }
    >
      <div className="mx-auto flex max-w-[1240px] flex-col gap-5">
        {/* Etat des sites */}
        <div className="grid grid-cols-4 gap-3">
          {SITES.map((s) => (
            <div key={s.id} className="rounded-2xl bg-surface p-4 ring-1 ring-ligne">
              <div className="flex items-center gap-3">
                <Monogramme site={s} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold">{s.nom}</p>
                  <p className="truncate text-[11px] text-pale">{s.url}</p>
                </div>
                {s.etat === "ok" ? (
                  <CircleCheck size={18} className="text-ok" />
                ) : (
                  <TriangleAlert size={18} className="text-alerte" />
                )}
              </div>
              <div className="mt-4">
                <BarresDispo
                  n={36}
                  largeur="flex-1"
                  hauteur="h-6"
                  incidents={s.etat === "alerte" ? [{ i: 34 }, { i: 35, grave: true }] : s.id === 4 ? [{ i: 12 }] : []}
                />
              </div>
              <div className="mt-2.5 flex justify-between text-[11px] text-doux">
                <span className="chiffres">{s.dispo} %</span>
                <span className="chiffres">{s.latence} ms</span>
              </div>
            </div>
          ))}
        </div>

        {/* Indicateurs */}
        <div className="grid grid-cols-4 gap-3">
          <Kpi libelle="Revenus" valeur="2 057,99 €" delta="+18 %" bon couleur="var(--color-revenu)" Icone={ArrowDownRight} points={[3, 5, 4, 6, 5, 7, 6, 8, 7, 9]} />
          <Kpi libelle="Dépenses" valeur="2 888,04 €" delta="+6 %" couleur="var(--color-depense)" Icone={ArrowUpRight} points={[4, 6, 6, 5, 4, 5, 4, 5, 5, 6]} />
          <Kpi libelle="Marge" valeur="−830,05 €" delta="−12 %" bon couleur="var(--color-accent-2)" Icone={Wallet} points={[1, 2, 1, 0, 2, 1, 2, 1, 0, -1]} />
          <Kpi libelle="Récurrent / mois" valeur="133,91 €" couleur="var(--color-abonnement)" Icone={Repeat} points={[110, 110, 120, 120, 130, 130, 134, 134, 134, 134]} />
        </div>

        <div className="grid grid-cols-3 gap-5">
          <Carte
            className="col-span-2"
            titre="Flux mensuels"
            action={<Segments options={["Mois", "Année", "12 mois", "Tout"]} actif="Année" />}
          >
            <div className="mb-2 flex gap-4 text-[11px] text-doux">
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-revenu" />Revenus</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-depense" />Dépenses</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-abonnement" />Abonnements</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-texte" />Marge cumulée</span>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={FLUX} stackOffset="sign" margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--color-ligne)" vertical={false} />
                  <XAxis dataKey="mois" stroke="var(--color-pale)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--color-pale)" fontSize={11} tickLine={false} axisLine={false} width={52} tickFormatter={(v) => `${v} €`} />
                  <Tooltip contentStyle={STYLE_INFOBULLE} cursor={{ fill: "var(--color-surface-2)" }} />
                  <Bar dataKey="rev" stackId="a" fill="var(--color-revenu)" radius={[4, 4, 0, 0]} barSize={18} />
                  <Bar dataKey="dep" stackId="a" fill="var(--color-depense)" barSize={18} />
                  <Bar dataKey="abo" stackId="a" fill="var(--color-abonnement)" radius={[0, 0, 4, 4]} barSize={18} />
                  <Line dataKey="marge" stroke="var(--color-texte)" strokeWidth={2} dot={false} type="monotone" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Carte>

          <Carte titre="À traiter" action={<span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-doux">4</span>}>
            <ul className="-mx-2 flex flex-col">
              {A_TRAITER.map((t) => (
                <li key={t.titre} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-surface-2">
                  <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${TONS[t.ton]}`}>
                    <t.Icone size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{t.titre}</span>
                    <span className="block truncate text-xs text-doux">{t.detail}</span>
                  </span>
                  {t.action && (
                    <span className="rounded-md bg-surface-3 px-2 py-1 text-[11px] font-medium text-texte">{t.action}</span>
                  )}
                </li>
              ))}
            </ul>
          </Carte>
        </div>

        <div className="grid grid-cols-3 gap-5">
          <Carte className="col-span-2" titre="Rentabilité par site" action={<LienDiscret>Détail</LienDiscret>}>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] text-pale">
                  <th className="pb-2 font-medium">Site</th>
                  <th className="pb-2 text-right font-medium">Revenus</th>
                  <th className="pb-2 text-right font-medium">Coûts</th>
                  <th className="pb-2 pl-6 font-medium">Marge</th>
                </tr>
              </thead>
              <tbody>
                {SITES.map((s) => (
                  <tr key={s.id} className="border-t border-ligne/70">
                    <td className="py-2.5">
                      <span className="flex items-center gap-2.5">
                        <Monogramme site={s} taille="size-6" texte="text-[11px]" />
                        {s.nom}
                      </span>
                    </td>
                    <td className="chiffres py-2.5 text-right text-doux">{euros(s.rev)}</td>
                    <td className="chiffres py-2.5 text-right text-doux">{euros(s.dep)}</td>
                    <td className="py-2.5 pl-6">
                      <span className="flex items-center gap-3">
                        <span className="relative h-1.5 w-32 rounded-full bg-surface-3">
                          <span
                            className={`absolute inset-y-0 rounded-full ${s.marge >= 0 ? "left-1/2 bg-revenu" : "right-1/2 bg-depense"}`}
                            style={{ width: `${Math.min(50, Math.abs(s.marge) / 9)}%` }}
                          />
                        </span>
                        <span className={`chiffres w-24 text-right font-medium ${s.marge >= 0 ? "text-revenu" : "text-depense"}`}>
                          {euros(s.marge, true)}
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Carte>

          <Carte titre="Prochains prélèvements" action={<LienDiscret>Abonnements</LienDiscret>}>
            <ul className="flex flex-col gap-3">
              {[
                ["VPS", "OVH", "J-5", "11,99 €"],
                ["ChatGPT Plus", "OpenAI", "J-5", "20,00 €"],
                ["Claude Max", "Anthropic", "J-9", "90,00 €"],
                ["Hébergement", "Ionos", "J-14", "11,00 €"],
              ].map(([lib, f, j, m]) => (
                <li key={lib} className="flex items-center gap-3 text-[13px]">
                  <span className="grid size-8 place-items-center rounded-lg bg-abonnement/12 text-xs font-semibold text-abonnement">{f[0]}</span>
                  <span className="flex-1">
                    {lib}
                    <span className="block text-[11px] text-pale">{f}</span>
                  </span>
                  <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-doux">{j}</span>
                  <span className="chiffres w-16 text-right font-medium">{m}</span>
                </li>
              ))}
            </ul>
          </Carte>
        </div>
      </div>
    </Coquille>
  );
}

/* --------------------------------------------------------------- fiche site */

const CHECKS = [
  { nom: "Page d'accueil", cible: "/", ok: true, ms: 182, Icone: Globe },
  { nom: "Santé de l'API", cible: "/healthz", ok: false, ms: null, Icone: Activity, erreur: "503 · depuis 12 min" },
  { nom: "Sitemap", cible: "/sitemap.xml", ok: true, ms: 240, Icone: Server, detail: "4 417 URL" },
  { nom: "En-têtes de sécurité", cible: "/", ok: true, ms: 175, Icone: Lock, detail: "HSTS · CSP" },
  { nom: "Certificat TLS", cible: "historysite.fr", ok: true, Icone: Lock, detail: "64 jours" },
  { nom: "Version déployée", cible: "/version.json", ok: true, Icone: Rocket, detail: "a1b2c3d · il y a 3 j" },
];

const AGENTS = [
  { nom: "Santé prod", horaire: "Tous les jours · 7 h 30", passes: "oooooao", claude: false },
  { nom: "Audit hebdo", horaire: "Lundi · 6 h 00", passes: "ooooooo", claude: false },
  { nom: "Idées de contenu", horaire: "Samedi · 10 h 00", passes: "ooaoooo", claude: true },
];

function FicheSite() {
  const site = SITES[1];
  return (
    <Coquille
      actif="site"
      siteActif={site.id}
      titre={
        <div className="flex items-center gap-1.5 text-[13px] text-doux">
          <span>Sites</span>
          <ChevronRight size={14} />
          <span className="font-medium text-texte">{site.nom}</span>
        </div>
      }
    >
      <div className="mx-auto flex max-w-[1240px] flex-col gap-5">
        <div className="flex items-center gap-4">
          <button type="button" className="grid size-9 place-items-center rounded-lg text-doux ring-1 ring-ligne">
            <ChevronLeft size={16} />
          </button>
          <Monogramme site={site} taille="size-12" texte="text-xl" />
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-[22px] font-semibold tracking-tight">{site.nom}</h1>
              <PastilleEtat etat="alerte" libelle="1 check en échec" />
            </div>
            <p className="mt-0.5 flex items-center gap-1 text-[13px] text-doux">
              https://{site.url} <ExternalLink size={12} />
            </p>
          </div>
          <button type="button" className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium ring-1 ring-ligne">
            <RefreshCw size={14} /> Vérifier
          </button>
          <button type="button" className="grid size-9 place-items-center rounded-lg text-doux ring-1 ring-ligne">
            <Ellipsis size={16} />
          </button>
        </div>

        <div className="flex gap-6 border-b border-ligne text-[13px] font-medium">
          {["Santé", "Finances", "Agents", "Réglages"].map((o, i) => (
            <span key={o} className={`-mb-px pb-3 ${i === 0 ? "border-b-2 border-accent text-texte" : "text-doux"}`}>
              {o}
              {o === "Agents" && <span className="ml-1.5 rounded-full bg-surface-3 px-1.5 text-[11px]">3</span>}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-4 gap-3">
          {[
            ["Disponibilité 30 j", "99,21 %", "2 incidents", Activity, "var(--color-ok)"],
            ["Latence p50 · p95", "212 · 380 ms", "+18 % sur 24 h", Zap, "var(--color-info)"],
            ["Certificat TLS", "64 jours", "Let's Encrypt", Lock, "var(--color-ok)"],
            ["Dernier déploiement", "il y a 3 j", "build a1b2c3d", Rocket, "var(--color-accent-2)"],
          ].map(([lib, val, det, Icone, c]) => (
            <div key={lib} className="rounded-2xl bg-surface p-4 ring-1 ring-ligne">
              <p className="flex items-center gap-2 text-xs font-medium text-doux">
                <Icone size={14} style={{ color: c }} /> {lib}
              </p>
              <p className="chiffres mt-2.5 text-xl font-semibold tracking-tight">{val}</p>
              <p className="mt-1 text-[11px] text-pale">{det}</p>
            </div>
          ))}
        </div>

        <Carte titre="Disponibilité · 90 jours" action={<Segments options={["24 h", "30 j", "90 j"]} actif="90 j" />}>
          <BarresDispo n={90} largeur="flex-1" hauteur="h-9" incidents={[{ i: 23 }, { i: 61 }, { i: 88 }, { i: 89, grave: true }]} />
          <div className="mt-2 flex justify-between text-[11px] text-pale">
            <span>29 juil.</span>
            <span>Aujourd&apos;hui</span>
          </div>
        </Carte>

        <div className="grid grid-cols-5 gap-5">
          <Carte className="col-span-3" titre="Latence · 24 h">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={LATENCE} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="lat" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-info)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-info)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-ligne)" vertical={false} />
                  <XAxis dataKey="h" stroke="var(--color-pale)" fontSize={11} tickLine={false} axisLine={false} interval={7} />
                  <YAxis stroke="var(--color-pale)" fontSize={11} tickLine={false} axisLine={false} width={60} tickFormatter={(v) => `${v} ms`} />
                  <Tooltip contentStyle={STYLE_INFOBULLE} />
                  <Area dataKey="p95" stroke="var(--color-pale)" strokeDasharray="4 4" fill="none" strokeWidth={1.5} type="monotone" />
                  <Area dataKey="p50" stroke="var(--color-info)" fill="url(#lat)" strokeWidth={2} type="monotone" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Carte>

          <Carte className="col-span-2" titre="Checks" action={<span className="text-xs text-doux">5 / 6 OK</span>}>
            <ul className="-mx-2 flex flex-col">
              {CHECKS.map((c) => (
                <li
                  key={c.nom}
                  className={`flex items-center gap-3 rounded-lg px-2 py-2 ${c.ok ? "" : "bg-ko/8 ring-1 ring-ko/25"}`}
                >
                  {c.ok ? <CircleCheck size={16} className="text-ok" /> : <CircleX size={16} className="text-ko" />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">{c.nom}</span>
                    <span className="block truncate font-mono text-[11px] text-pale">{c.cible}</span>
                  </span>
                  <span className={`chiffres text-xs ${c.ok ? "text-doux" : "font-medium text-ko"}`}>
                    {c.erreur ?? c.detail ?? `${c.ms} ms`}
                  </span>
                </li>
              ))}
            </ul>
          </Carte>
        </div>

        <Carte titre="Agents" action={<LienDiscret>Onglet Agents</LienDiscret>}>
          <ul className="flex flex-col divide-y divide-ligne/70">
            {AGENTS.map((a) => (
              <li key={a.nom} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                <span className="grid size-9 place-items-center rounded-xl bg-accent/12 text-accent-2">
                  {a.claude ? <Sparkles size={16} /> : <Cpu size={16} />}
                </span>
                <span className="flex-1">
                  <span className="block text-[13px] font-medium">{a.nom}</span>
                  <span className="block text-xs text-doux">{a.horaire}</span>
                </span>
                <span className="flex items-center gap-1">
                  {[...a.passes].map((p, i) => (
                    <span key={i} className={`size-2.5 rounded-full ${p === "o" ? "bg-ok" : "bg-alerte"} ${i === 6 ? "ring-2 ring-offset-2 ring-offset-surface ring-ok/40" : ""}`} />
                  ))}
                </span>
                <span className="w-28 text-right text-xs text-doux">Dernier : 07:31</span>
              </li>
            ))}
          </ul>
        </Carte>
      </div>
    </Coquille>
  );
}

/* ------------------------------------------------------------- transactions */

const CATS = {
  hebergement: { libelle: "Hébergement", Icone: Server },
  api: { libelle: "API", Icone: Cpu },
  marketing: { libelle: "Marketing", Icone: Megaphone },
  domaine: { libelle: "Domaine", Icone: Globe },
  revenu: { libelle: "Revenu", Icone: ArrowDownRight },
};

const TRANSACTIONS = [
  {
    mois: "Octobre 2026",
    total: "−142,48 €",
    lignes: [
      ["21 oct.", "Licence", "Ionos", "hebergement", [2], -66.12],
      ["19 oct.", "AdSense", "Google", "revenu", [1], 98.4],
      ["19 oct.", "Serveur", "OVH", "hebergement", [2], -40.1],
      ["11 oct.", "Crédits API", "Anthropic", "api", [1, 3], -18.42, "20,00 $ · taux 0,921"],
      ["04 oct.", "Campagne automne", "Google Ads", "marketing", [1], -71.95],
    ],
  },
  {
    mois: "Septembre 2026",
    total: "+96,36 €",
    lignes: [
      ["29 sept.", "Don", "Ko-fi", "revenu", [2], 136.77],
      ["30 sept.", "Nom de domaine", "OVH", "domaine", [4], -4.93],
      ["12 sept.", "Crédits API", "OpenAI", "api", [3], -35.48],
    ],
  },
];

function Transactions() {
  return (
    <Coquille
      actif="transactions"
      titre={
        <div className="flex items-center gap-6">
          <h1 className="text-[17px] font-semibold tracking-tight">Finances</h1>
          <div className="flex gap-5 text-[13px] font-medium">
            <span className="text-texte">Transactions</span>
            <span className="text-doux">Abonnements</span>
          </div>
        </div>
      }
    >
      <div className="relative mx-auto flex max-w-[1240px] flex-col gap-5">
        <div className="grid grid-cols-3 gap-3">
          {[
            ["Entrées", "+2 057,99 €", "text-revenu", "30 transactions"],
            ["Sorties", "−2 888,04 €", "text-depense", "40 dépenses · 5 abonnements"],
            ["Solde", "−830,05 €", "text-depense", "Cette année"],
          ].map(([l, v, c, d]) => (
            <div key={l} className="rounded-2xl bg-surface px-5 py-4 ring-1 ring-ligne">
              <p className="text-xs font-medium text-doux">{l}</p>
              <p className={`chiffres mt-1.5 text-2xl font-semibold tracking-tight ${c}`}>{v}</p>
              <p className="mt-1 text-[11px] text-pale">{d}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex w-72 items-center gap-2 rounded-lg bg-surface px-3 py-2 text-[13px] text-pale ring-1 ring-ligne">
            <Search size={15} /> Libellé, fournisseur, montant…
          </div>
          <Segments options={["Tout", "Dépenses", "Revenus"]} actif="Tout" />
          {["Tous les sites", "Catégorie", "Cette année"].map((f) => (
            <span key={f} className="flex items-center gap-1.5 rounded-lg bg-surface px-3 py-1.5 text-xs font-medium text-doux ring-1 ring-ligne">
              {f === "Cette année" ? <Calendar size={13} /> : f === "Catégorie" ? <Tag size={13} /> : <Globe size={13} />}
              {f}
              <ChevronDown size={13} />
            </span>
          ))}
          <span className="ml-auto text-xs text-pale">Exporter CSV</span>
        </div>

        <Carte sansMarge>
          {TRANSACTIONS.map((groupe) => (
            <div key={groupe.mois}>
              <div className="flex justify-between border-b border-ligne bg-surface-2/60 px-5 py-2 text-xs font-medium text-doux first:rounded-t-2xl">
                <span>{groupe.mois}</span>
                <span className="chiffres">{groupe.total}</span>
              </div>
              {groupe.lignes.map(([date, lib, four, cat, sites, montant, devise]) => {
                const c = CATS[cat];
                const entree = montant > 0;
                return (
                  <div key={lib + date} className="flex items-center gap-4 border-b border-ligne/60 px-5 py-3 last:border-0">
                    <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${entree ? "bg-revenu/12 text-revenu" : "bg-surface-3 text-doux"}`}>
                      <c.Icone size={16} />
                    </span>
                    <span className="w-56 min-w-0">
                      <span className="block truncate text-[13px] font-medium">{lib}</span>
                      <span className="block truncate text-xs text-pale">
                        {four} · {c.libelle}
                      </span>
                    </span>
                    <span className="flex flex-1 gap-1.5">
                      {sites.map((id) => {
                        const s = SITES.find((x) => x.id === id);
                        return (
                          <span key={id} className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 text-[11px] text-doux">
                            <span className="size-1.5 rounded-full" style={{ background: s.couleur }} />
                            {s.nom}
                          </span>
                        );
                      })}
                      {sites.length > 1 && <span className="text-[11px] text-pale">partagé</span>}
                    </span>
                    <span className="w-16 text-xs text-pale">{date}</span>
                    <span className="w-36 text-right">
                      <span className={`chiffres block text-[13px] font-semibold ${entree ? "text-revenu" : "text-texte"}`}>
                        {euros(montant, true).replace("-", "−")}
                      </span>
                      {devise && <span className="block text-[11px] text-pale">{devise}</span>}
                    </span>
                    <Ellipsis size={16} className="text-pale" />
                  </div>
                );
              })}
            </div>
          ))}
        </Carte>
      </div>

      {/* Panneau de saisie */}
      {new URLSearchParams(location.search).get("tiroir") !== "0" && (
      <>
      <div className="fixed inset-0 z-10 bg-black/40 backdrop-blur-[2px]" />
      <aside className="fixed inset-y-0 right-0 z-20 flex w-[440px] flex-col border-l border-ligne bg-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-ligne px-6 py-4">
          <h2 className="text-[15px] font-semibold">Nouvelle transaction</h2>
          <X size={18} className="text-doux" />
        </header>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-2 rounded-xl bg-surface-2 p-1 text-[13px] font-medium ring-1 ring-ligne">
            <span className="flex items-center justify-center gap-1.5 rounded-lg bg-depense/15 py-2 text-depense">
              <ArrowUpRight size={15} /> Dépense
            </span>
            <span className="flex items-center justify-center gap-1.5 py-2 text-doux">
              <ArrowDownRight size={15} /> Revenu
            </span>
          </div>

          <div className="rounded-xl bg-surface-2 px-4 py-4 ring-1 ring-ligne">
            <p className="text-xs font-medium text-doux">Montant</p>
            <div className="mt-1 flex items-center gap-3">
              <span className="chiffres flex-1 text-[34px] font-semibold tracking-tight">20,00</span>
              <div className="flex rounded-lg bg-surface-3 p-0.5 text-xs font-semibold">
                <span className="rounded-md px-2.5 py-1 text-doux">€</span>
                <span className="rounded-md bg-surface px-2.5 py-1 text-texte shadow-sm">$</span>
              </div>
            </div>
            <p className="mt-1 text-xs text-pale">≈ 18,42 € au taux BCE du 11/10/2026</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-doux">Fournisseur</span>
              <span className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] ring-1 ring-accent">
                <span className="grid size-5 place-items-center rounded bg-[#d97757]/20 text-[10px] font-bold text-[#d97757]">A</span>
                Anthropic
              </span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-doux">Date</span>
              <span className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] ring-1 ring-ligne">
                <Calendar size={14} className="text-doux" /> 11/10/2026
              </span>
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-doux">Catégorie</span>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(CATS)
                .filter(([k]) => k !== "revenu")
                .map(([k, c]) => (
                  <span
                    key={k}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 ${
                      k === "api" ? "bg-accent/12 text-texte ring-accent" : "text-doux ring-ligne"
                    }`}
                  >
                    <c.Icone size={13} /> {c.libelle}
                  </span>
                ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="flex justify-between text-xs font-medium text-doux">
              Sites <span className="text-accent-2">Répartir à la main</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {SITES.map((s) => {
                const choisi = s.id === 1 || s.id === 3;
                return (
                  <span
                    key={s.id}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 ${
                      choisi ? "bg-accent/12 text-texte ring-accent" : "text-doux ring-ligne"
                    }`}
                  >
                    <span className="size-1.5 rounded-full" style={{ background: s.couleur }} />
                    {s.nom}
                  </span>
                );
              })}
            </div>
            <div className="mt-1 flex h-2 overflow-hidden rounded-full">
              <span className="w-1/2" style={{ background: SITES[0].couleur }} />
              <span className="w-1/2" style={{ background: SITES[2].couleur }} />
            </div>
            <p className="flex justify-between text-[11px] text-pale">
              <span>Denivio 9,21 €</span>
              <span>RoisEmpereurs 9,21 €</span>
            </p>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-doux">Libellé</span>
            <span className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] ring-1 ring-ligne">Crédits API</span>
          </label>
        </div>
        <footer className="flex items-center justify-between border-t border-ligne px-6 py-4">
          <span className="text-[11px] text-pale">
            <kbd className="rounded bg-surface-3 px-1">Ctrl</kbd> + <kbd className="rounded bg-surface-3 px-1">Entrée</kbd>
          </span>
          <div className="flex gap-2">
            <button type="button" className="rounded-lg px-4 py-2 text-[13px] font-medium text-doux ring-1 ring-ligne">
              Annuler
            </button>
            <button type="button" className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white">
              Enregistrer
            </button>
          </div>
        </footer>
      </aside>
      </>
      )}
    </Coquille>
  );
}

/* ------------------------------------------------------------- abonnements */

const ABONNEMENTS = [
  { lib: "Claude Max", four: "Anthropic", c: "#d97757", sites: [], tarif: "90,00 €", per: "mois", jours: 9, paye: "1 980 €" },
  { lib: "ChatGPT Plus", four: "OpenAI", c: "#10a37f", sites: [], tarif: "20,00 €", per: "mois", jours: 5, paye: "420 €" },
  { lib: "VPS", four: "OVH", c: "#3b82f6", sites: [1, 2], tarif: "11,99 €", per: "mois", jours: 5, paye: "383,68 €" },
  { lib: "Hébergement", four: "Ionos", c: "#1d4ed8", sites: [3, 4], tarif: "11,00 €", per: "mois", jours: 14, paye: "319 €" },
  { lib: "denivio.fr", four: "OVH", c: "#3b82f6", sites: [1], tarif: "11,00 €", per: "an", jours: 125, paye: "33 €" },
];

function Abonnements() {
  return (
    <Coquille
      actif="transactions"
      titre={
        <div className="flex items-center gap-6">
          <h1 className="text-[17px] font-semibold tracking-tight">Finances</h1>
          <div className="flex gap-5 text-[13px] font-medium">
            <span className="text-doux">Transactions</span>
            <span className="text-texte">Abonnements</span>
          </div>
        </div>
      }
    >
      <div className="mx-auto flex max-w-[1240px] flex-col gap-5">
        <div className="grid grid-cols-4 gap-3">
          <Kpi libelle="Par mois" valeur="133,91 €" couleur="var(--color-abonnement)" Icone={Repeat} />
          <Kpi libelle="Par an" valeur="1 606,92 €" couleur="var(--color-abonnement)" Icone={Calendar} />
          <Kpi libelle="Total déjà payé" valeur="3 135,68 €" couleur="var(--color-depense)" Icone={Receipt} />
          <Kpi libelle="Actifs" valeur="5" couleur="var(--color-accent-2)" Icone={CircleCheck} />
        </div>

        <Carte titre="Les 30 prochains jours">
          <div className="relative h-16">
            <div className="absolute inset-x-0 top-8 h-px bg-ligne" />
            {[
              [16, "VPS · ChatGPT", "32,00 €"],
              [30, "Claude Max", "90,00 €"],
              [46, "Hébergement", "11,00 €"],
              [96, "VPS · ChatGPT", "32,00 €"],
            ].map(([x, l, m]) => (
              <div key={x} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: `${x}%` }}>
                <span className="chiffres text-[11px] font-semibold">{m}</span>
                <span className="my-1 size-3 rounded-full bg-abonnement ring-4 ring-abonnement/20" />
                <span className="text-[11px] whitespace-nowrap text-doux">{l}</span>
              </div>
            ))}
            <span className="absolute top-6 left-0 text-[10px] font-medium text-accent-2">Aujourd&apos;hui</span>
          </div>
        </Carte>

        <Carte sansMarge titre="5 abonnements" action={<Segments options={["Actifs", "Arrêtés", "Tous"]} actif="Actifs" />}>
          <div className="relative">
            {ABONNEMENTS.map((a, i) => (
              <div key={a.lib} className="flex items-center gap-4 border-t border-ligne/70 px-5 py-3.5">
                <span
                  className="grid size-10 shrink-0 place-items-center rounded-xl text-sm font-bold"
                  style={{ background: `${a.c}22`, color: a.c }}
                >
                  {a.four[0]}
                </span>
                <span className="w-52">
                  <span className="block text-[13px] font-semibold">{a.lib}</span>
                  <span className="block text-xs text-pale">{a.four}</span>
                </span>
                <span className="flex flex-1 gap-1.5">
                  {a.sites.length === 0 ? (
                    <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] text-pale">Transverse</span>
                  ) : (
                    a.sites.map((id) => {
                      const s = SITES.find((x) => x.id === id);
                      return (
                        <span key={id} className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 text-[11px] text-doux">
                          <span className="size-1.5 rounded-full" style={{ background: s.couleur }} />
                          {s.nom}
                        </span>
                      );
                    })
                  )}
                </span>
                <span className="w-28">
                  <span className={`block text-xs font-medium ${a.jours <= 7 ? "text-alerte" : "text-doux"}`}>
                    <Clock size={12} className="mr-1 inline" />
                    {a.jours <= 31 ? `dans ${a.jours} j` : "1er mars"}
                  </span>
                </span>
                <span className="w-32 text-right">
                  <span className="chiffres block text-[13px] font-semibold">
                    {a.tarif}
                    <span className="font-normal text-pale"> /{a.per}</span>
                  </span>
                  <span className="block text-[11px] text-pale">{a.paye} payés</span>
                </span>
                <span className={`grid size-8 place-items-center rounded-lg ${i === 2 ? "bg-surface-3 text-texte" : "text-pale"}`}>
                  <Ellipsis size={16} />
                </span>
              </div>
            ))}

            {/* Menu d'actions ouvert sur le VPS */}
            <div className="absolute top-[188px] right-5 z-10 w-56 rounded-xl bg-surface-2 p-1.5 shadow-2xl ring-1 ring-ligne">
              {[
                [Pencil, "Modifier"],
                [History, "Historique des tarifs"],
                [Image, "Changer l'icône"],
                [Square, "Arrêter l'abonnement"],
              ].map(([I, l]) => (
                <span key={l} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] ${l === "Modifier" ? "bg-surface-3" : ""}`}>
                  <I size={14} className="text-doux" /> {l}
                </span>
              ))}
              <div className="my-1 h-px bg-ligne" />
              <span className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ko">
                <Trash2 size={14} /> Supprimer
              </span>
            </div>
          </div>
        </Carte>
      </div>
    </Coquille>
  );
}

/* ------------------------------------------------------------------ palette */

function Palette() {
  return (
    <div className="relative h-full">
      <Cockpit />
      <div className="fixed inset-0 z-10 bg-black/50 backdrop-blur-sm" />
      <div className="fixed top-28 left-1/2 z-20 w-[600px] -translate-x-1/2 overflow-hidden rounded-2xl bg-surface text-texte shadow-2xl ring-1 ring-ligne">
        <div className="flex items-center gap-3 border-b border-ligne px-5 py-4">
          <Search size={18} className="text-doux" />
          <span className="flex-1 text-[15px]">
            dép<span className="animate-pulse text-accent">|</span>
          </span>
          <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-doux">Échap</span>
        </div>
        <div className="p-2">
          <p className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-pale">Actions</p>
          {[
            [Plus, "Nouvelle dépense", "N", true],
            [Repeat, "Nouvel abonnement", ""],
            [RefreshCw, "Vérifier tous les sites maintenant", ""],
          ].map(([I, l, k, actif]) => (
            <div key={l} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] ${actif ? "bg-accent/12" : ""}`}>
              <span className={`grid size-7 place-items-center rounded-lg ${actif ? "bg-accent text-white" : "bg-surface-3 text-doux"}`}>
                <I size={14} />
              </span>
              <span className="flex-1">{l}</span>
              {k && <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-doux">{k}</span>}
              {actif && <CornerDownLeft size={14} className="text-doux" />}
            </div>
          ))}
          <p className="px-3 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-pale">Dépenses récentes</p>
          {[
            ["Licence · Ionos", "66,12 €"],
            ["Serveur · OVH", "40,10 €"],
          ].map(([l, m]) => (
            <div key={l} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px]">
              <span className="grid size-7 place-items-center rounded-lg bg-surface-3 text-doux">
                <Receipt size={14} />
              </span>
              <span className="flex-1">{l}</span>
              <span className="chiffres text-doux">{m}</span>
            </div>
          ))}
          <p className="px-3 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-pale">Aller à</p>
          <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px]">
            <span className="grid size-7 place-items-center rounded-lg bg-surface-3 text-doux">
              <ArrowRight size={14} />
            </span>
            <span className="flex-1">Finances › Transactions › Dépenses</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- choix */

const ECRANS = { cockpit: Cockpit, site: FicheSite, transactions: Transactions, abonnements: Abonnements, palette: Palette };

function Maquette() {
  const params = new URLSearchParams(location.search);
  const Ecran = ECRANS[params.get("ecran")] ?? Cockpit;
  const [theme] = useState(params.get("theme") === "clair" ? "clair" : "sombre");
  return (
    <div className={`${theme} h-full`}>
      <Ecran />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Maquette />);
