import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bot,
  CornerDownLeft,
  Globe,
  LayoutDashboard,
  Plug,
  Plus,
  Receipt,
  RefreshCw,
  Repeat,
  Search,
  Settings,
  SunMoon,
  Wallet,
} from "lucide-react";
import { Monogramme } from "./ui";
import { listerDepenses, listerRevenus } from "../lib/queries";
import { formatMontant } from "../lib/format";

function normaliser(texte) {
  return String(texte ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Tous les mots de la recherche doivent apparaitre, dans n'importe quel ordre. */
function correspond(texte, mots) {
  const t = normaliser(texte);
  return mots.every((m) => t.includes(m));
}

/**
 * Palette de commandes (Ctrl+K) : actions, navigation, sites et transactions,
 * au clavier. Fleches pour choisir, Entree pour lancer, Echap pour fermer.
 */
export default function Palette({ ouvert, onFermer, sites = [], onAction }) {
  const [recherche, setRecherche] = useState("");
  const [actif, setActif] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const champ = useRef(null);
  const liste = useRef(null);

  // Montee a chaque ouverture (voir App) : recherche vierge, transactions relues
  useEffect(() => {
    champ.current?.focus();
    Promise.all([listerDepenses({ limite: 300 }), listerRevenus({ limite: 300 })])
      .then(([d, r]) => setTransactions([...d.map((x) => ({ ...x, sens: "depense" })), ...r.map((x) => ({ ...x, sens: "revenu" }))]))
      .catch(() => setTransactions([]));
  }, []);

  const groupes = useMemo(() => {
    const mots = normaliser(recherche).split(/\s+/).filter(Boolean);
    const filtrer = (items) => items.filter((i) => correspond(`${i.libelle} ${i.motsCles ?? ""}`, mots));
    const actions = filtrer([
      { cle: "nouveau:depense", libelle: "Nouvelle dépense", Icone: ArrowUpRight, raccourci: "N", motsCles: "ajouter facture" },
      { cle: "nouveau:revenu", libelle: "Nouveau revenu", Icone: ArrowDownRight, motsCles: "ajouter recette" },
      { cle: "nouveau:abonnement", libelle: "Nouvel abonnement", Icone: Repeat, motsCles: "ajouter recurrent" },
      { cle: "nouveau:site", libelle: "Nouveau site", Icone: Plus, motsCles: "ajouter" },
      { cle: "verifier", libelle: "Vérifier tous les sites maintenant", Icone: RefreshCw, motsCles: "supervision checks" },
      { cle: "theme", libelle: "Changer de thème", Icone: SunMoon, motsCles: "clair sombre apparence" },
    ]);
    const navigation = filtrer([
      { cle: "aller:accueil", libelle: "Vue d'ensemble", Icone: LayoutDashboard, motsCles: "accueil tableau de bord a traiter" },
      { cle: "aller:sites", libelle: "Sites", Icone: Globe },
      { cle: "aller:finances", libelle: "Finances › Transactions", Icone: Wallet, motsCles: "depenses revenus" },
      { cle: "aller:abonnements", libelle: "Finances › Abonnements", Icone: Repeat },
      { cle: "aller:agents", libelle: "Réglages › Agents", Icone: Bot, motsCles: "taches planifiees" },
      { cle: "aller:connecteurs", libelle: "Réglages › Connecteurs", Icone: Plug, motsCles: "stripe anthropic openai import api" },
      { cle: "aller:reglages", libelle: "Réglages", Icone: Settings, motsCles: "preferences mise a jour sauvegardes notifications" },
    ]);
    const lesSites = filtrer(sites.map((s) => ({ cle: `site:${s.id}`, libelle: s.nom, site: s, motsCles: s.url })));
    const trouvees =
      mots.length === 0
        ? []
        : transactions
            .filter((t) => correspond([t.libelle, t.fournisseur_nom, t.sites_noms, (t.montant_cents / 100).toFixed(2).replace(".", ",")].join(" "), mots))
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 6)
            .map((t) => ({
              cle: `transaction:${t.sens}:${t.id}`,
              libelle: [t.libelle, t.fournisseur_nom].filter(Boolean).join(" · ") || (t.sens === "revenu" ? "Revenu" : "Dépense"),
              Icone: t.sens === "revenu" ? ArrowDownRight : Receipt,
              montant: `${t.sens === "revenu" ? "+" : "−"}${formatMontant(t.montant_eur_cents ?? t.montant_cents)}`,
              transaction: t,
            }));
    return [
      { titre: "Actions", items: actions },
      { titre: "Sites", items: lesSites },
      { titre: "Transactions", items: trouvees },
      { titre: "Aller à", items: navigation },
    ].filter((g) => g.items.length > 0);
  }, [recherche, sites, transactions]);

  const plats = groupes.flatMap((g) => g.items);

  useEffect(() => {
    liste.current?.querySelector(`[data-index="${actif}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [actif]);

  if (!ouvert) return null;

  function lancer(item) {
    if (!item) return;
    onFermer();
    onAction(item);
  }

  function touche(e) {
    if (e.key === "Escape") onFermer();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActif((i) => Math.min(plats.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActif((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      lancer(plats[actif]);
    }
  }

  let index = -1;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Palette de commandes">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onFermer} />
      <div
        className="absolute top-24 left-1/2 w-[600px] max-w-[calc(100%-2rem)] -translate-x-1/2 overflow-hidden rounded-2xl bg-surface text-texte shadow-2xl ring-1 ring-bord"
        style={{ animation: "apparaitre 120ms ease-out" }}
      >
        <div className="flex items-center gap-3 border-b border-bord px-5 py-4">
          <Search size={18} className="text-texte-doux" />
          <input
            ref={champ}
            value={recherche}
            onChange={(e) => {
              setRecherche(e.target.value);
              setActif(0);
            }}
            onKeyDown={touche}
            placeholder="Rechercher une action, un site, une transaction…"
            className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-pale"
            aria-label="Rechercher"
          />
          <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-texte-doux">Échap</span>
        </div>
        <div ref={liste} className="max-h-[420px] overflow-y-auto p-2">
          {plats.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-texte-doux">Aucun résultat.</p>}
          {groupes.map((g) => (
            <div key={g.titre}>
              <p className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wider text-pale uppercase">{g.titre}</p>
              {g.items.map((item) => {
                index += 1;
                const i = index;
                const choisi = i === actif;
                return (
                  <button
                    key={item.cle}
                    type="button"
                    data-index={i}
                    onMouseEnter={() => setActif(i)}
                    onClick={() => lancer(item)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] ${choisi ? "bg-accent/12" : ""}`}
                  >
                    {item.site ? (
                      <Monogramme site={item.site} taille={28} />
                    ) : (
                      <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${choisi ? "bg-accent text-white" : "bg-surface-3 text-texte-doux"}`}>
                        {item.Icone ? <item.Icone size={14} /> : <ArrowRight size={14} />}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{item.libelle}</span>
                    {item.montant && <span className="chiffres text-texte-doux">{item.montant}</span>}
                    {item.raccourci && <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-texte-doux">{item.raccourci}</span>}
                    {choisi && <CornerDownLeft size={14} className="text-texte-doux" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
