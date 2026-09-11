import { BadgeEuro, LayoutDashboard, Receipt, Repeat, Globe } from "lucide-react";

const ONGLETS = [
  { cle: "dashboard", libelle: "Tableau de bord", Icone: LayoutDashboard },
  { cle: "depenses", libelle: "Depenses", Icone: Receipt },
  { cle: "revenus", libelle: "Revenus", Icone: BadgeEuro },
  { cle: "abonnements", libelle: "Abonnements", Icone: Repeat },
  { cle: "sites", libelle: "Sites", Icone: Globe },
];

export default function Layout({ ongletActif, onChangerOnglet, cheminBase, children }) {
  return (
    <div className="flex h-full">
      <nav className="flex w-56 shrink-0 flex-col border-r border-bord bg-surface p-3">
        <div className="mb-5 px-2 pt-2">
          <p className="text-base font-semibold">SiteDashboard</p>
          <p className="text-xs text-texte-doux">Couts &amp; revenus par site</p>
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
            </button>
          ))}
        </div>

        {cheminBase && (
          <p
            className="mt-auto px-2 pt-4 text-[10px] leading-relaxed break-all text-texte-doux"
            title={cheminBase}
          >
            Base locale&nbsp;:<br />
            {cheminBase}
          </p>
        )}
      </nav>

      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
