import {
  BadgeEuro,
  Bot,
  Download,
  Globe,
  LayoutDashboard,
  Receipt,
  Repeat,
  Settings,
} from "lucide-react";
import { couleurEtat } from "../lib/statut";

const ONGLETS = [
  { cle: "dashboard", libelle: "Tableau de bord", Icone: LayoutDashboard },
  { cle: "depenses", libelle: "Dépenses", Icone: Receipt },
  { cle: "revenus", libelle: "Revenus", Icone: BadgeEuro },
  { cle: "abonnements", libelle: "Abonnements", Icone: Repeat },
  { cle: "sites", libelle: "Sites", Icone: Globe },
  { cle: "agents", libelle: "Agents", Icone: Bot },
  { cle: "preferences", libelle: "Préférences", Icone: Settings },
];

export default function Layout({
  ongletActif,
  onChangerOnglet,
  verificationEnCours,
  intervalleS,
  alertes = {},
  miseAJour = null,
  children,
}) {
  return (
    <div className="flex h-full">
      <nav className="flex w-56 shrink-0 flex-col border-r border-bord bg-surface p-3">
        <div className="mb-5 px-2 pt-2">
          <p className="text-base font-semibold">SiteDashboard</p>
          <p className="text-xs text-texte-doux">Coûts &amp; revenus par site</p>
        </div>

        <div className="flex flex-col gap-1">
          {ONGLETS.map(({ cle, libelle, Icone }) => (
            <button
              key={cle}
              type="button"
              onClick={() => onChangerOnglet(cle)}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${
                ongletActif === cle
                  ? "bg-surface-2 text-texte"
                  : "text-texte-doux hover:bg-surface-2/60 hover:text-texte"
              }`}
            >
              <Icone size={16} />
              {libelle}
              {alertes[cle] > 0 && (
                <span
                  className="ml-auto rounded-full px-1.5 text-[10px] font-semibold text-black tabular-nums"
                  style={{ background: couleurEtat("partiel") }}
                  title={`${alertes[cle]} à regarder`}
                >
                  {alertes[cle]}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="mt-auto px-2 pt-4">
          {miseAJour?.disponible && (
            <button
              type="button"
              onClick={() => onChangerOnglet("preferences")}
              className="mb-3 flex w-full items-center gap-2 rounded-lg border border-accent/50 bg-accent/10 px-2.5 py-2 text-left text-xs text-texte transition hover:bg-accent/20"
              title="Voir la mise à jour dans les Préférences"
            >
              <Download size={14} className="shrink-0 text-accent" />
              <span>
                Mise à jour disponible
                <span className="block text-[10px] text-texte-doux">{miseAJour.libelle}</span>
              </span>
            </button>
          )}
          <p className="flex items-center gap-2 text-[11px] text-texte-doux">
            <span
              className={`size-1.5 rounded-full bg-accent ${verificationEnCours ? "animate-pulse" : "opacity-40"}`}
            />
            {verificationEnCours
              ? "Vérification en cours..."
              : `Supervision toutes les ${intervalleS} s`}
          </p>
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
