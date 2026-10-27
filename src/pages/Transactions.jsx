import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ClipboardCopy, Pencil, Receipt, Search, Trash2, Wallet } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { AfficherPlus, Bouton, Carte, EtatVide, Kpi, MenuActions, Segments, Selecteur } from "../components/ui";
import { ICONES_CATEGORIES } from "../components/TiroirTransaction";
import {
  compterDepenses,
  compterRevenus,
  listerDepenses,
  listerRevenus,
  restaurer,
  supprimerAnnulable,
} from "../lib/queries";
import { useSuppressionAnnulable } from "../components/Toasts";
import { bornesPeriode } from "../lib/periodes";
import { chargerBilan } from "../lib/bilan";
import { aujourdhuiIso, dateFr, formatMontant } from "../lib/format";
import { CATEGORIES, libelleCategorie } from "../lib/categories";
import { mentionConversion } from "../lib/devises";
import { PERIODES_COURTES } from "./Accueil";

/** Lignes chargees a la fois, de chaque cote. */
const PAGE = 100;

const SENS = [
  { cle: "tout", libelle: "Tout" },
  { cle: "depense", libelle: "Dépenses" },
  { cle: "revenu", libelle: "Revenus" },
];

/** '2026-10' -> 'Octobre 2026' */
function moisLong(mois) {
  const [a, m] = mois.split("-").map(Number);
  const texte = new Date(a, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

/** '2026-10-21' -> '21 oct.' */
function jourCourt(date) {
  const [a, m, j] = date.split("-").map(Number);
  return new Date(a, m - 1, j).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

/** Montant en euros d'une ligne ; filtre par site : la part de ce site. */
function montantLigne(ligne, siteId) {
  if (siteId && ligne.part_cents != null) return ligne.part_cents;
  return ligne.montant_eur_cents ?? ligne.montant_cents;
}

function sansAccents(texte) {
  return String(texte ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Depenses et revenus dans un seul fil, regroupes par mois. Sert aussi a la
 * fiche d'un site (`siteIdFixe`) : seules ses ecritures, pour sa part.
 */
export default function Transactions({ rafraichissement, sites = [], siteIdFixe = null, onModifier, onModification }) {
  const [periode, setPeriode] = useState("annee");
  const [sens, setSens] = useState("tout");
  const [siteChoisi, setSiteChoisi] = useState("");
  const [categorie, setCategorie] = useState("");
  const [recherche, setRecherche] = useState("");
  const [limite, setLimite] = useState(PAGE);
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState("");
  const [copie, setCopie] = useState(false);
  const supprimerAvecAnnulation = useSuppressionAnnulable(onModification);

  const siteId = siteIdFixe ?? (siteChoisi ? Number(siteChoisi) : null);

  useEffect(() => {
    let annule = false;
    const aujourdhui = aujourdhuiIso();
    const { debut, fin } = bornesPeriode(periode, aujourdhui);
    const filtre = { siteId, depuis: periode === "toujours" ? null : debut, jusqua: fin };
    Promise.all([
      listerDepenses({ ...filtre, limite }),
      listerRevenus({ ...filtre, limite }),
      compterDepenses(filtre),
      compterRevenus(filtre),
      chargerBilan({ periode, siteId, aujourdhui }),
    ])
      .then(([depenses, revenus, nbDepenses, nbRevenus, bilan]) => {
        if (!annule) setDonnees({ depenses, revenus, nbDepenses, nbRevenus, bilan });
      })
      .catch((e) => !annule && setErreur(String(e?.message ?? e)));
    return () => {
      annule = true;
    };
  }, [periode, siteId, limite, rafraichissement]);

  const lignes = useMemo(() => {
    if (!donnees) return [];
    const toutes = [
      ...(sens === "revenu" ? [] : donnees.depenses.map((d) => ({ ...d, sens: "depense" }))),
      ...(sens === "depense" || categorie ? [] : donnees.revenus.map((r) => ({ ...r, sens: "revenu" }))),
    ].filter((l) => !categorie || l.categorie === categorie);
    const mots = sansAccents(recherche).split(/\s+/).filter(Boolean);
    const trouvees = mots.length
      ? toutes.filter((l) => {
          const texte = sansAccents(
            [l.libelle, l.fournisseur_nom, l.sites_noms, libelleCategorie(l.categorie), (montantLigne(l, siteId) / 100).toFixed(2).replace(".", ",")].join(" "),
          );
          return mots.every((m) => texte.includes(m));
        })
      : toutes;
    return trouvees.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, limite);
  }, [donnees, sens, categorie, recherche, limite, siteId]);

  const groupes = useMemo(() => {
    const parMois = new Map();
    for (const l of lignes) {
      const mois = l.date.slice(0, 7);
      if (!parMois.has(mois)) parMois.set(mois, { mois, lignes: [], solde: 0 });
      const g = parMois.get(mois);
      g.lignes.push(l);
      g.solde += (l.sens === "revenu" ? 1 : -1) * montantLigne(l, siteId);
    }
    return [...parMois.values()];
  }, [lignes, siteId]);

  // Sans confirmation : la suppression s'annule depuis le message qui la suit
  function supprimer(ligne) {
    const revenu = ligne.sens === "revenu";
    const nom = ligne.libelle || ligne.fournisseur_nom || dateFr(ligne.date);
    supprimerAvecAnnulation(
      `${revenu ? "Revenu" : "Dépense"} « ${nom} » supprimé${revenu ? "" : "e"}`,
      () => supprimerAnnulable(revenu ? "revenus" : "depenses", ligne.id),
      restaurer,
    );
  }

  async function copierCsv() {
    const entete = "date;type;libellé;fournisseur;catégorie;sites;montant (€)";
    const corps = lignes.map((l) =>
      [
        l.date,
        l.sens === "revenu" ? "revenu" : "dépense",
        l.libelle,
        l.fournisseur_nom ?? "",
        l.sens === "revenu" ? "" : libelleCategorie(l.categorie),
        l.sites_noms ?? "",
        ((l.sens === "revenu" ? 1 : -1) * montantLigne(l, siteId) / 100).toFixed(2).replace(".", ","),
      ]
        .map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`)
        .join(";"),
    );
    try {
      await writeText([entete, ...corps].join("\n"));
      setCopie(true);
      setTimeout(() => setCopie(false), 1500);
    } catch (e) {
      setErreur(String(e));
    }
  }

  if (!donnees) return erreur ? <p className="text-sm text-ko">{erreur}</p> : <EtatVide>Chargement…</EtatVide>;

  const { totaux } = donnees.bilan;
  const total = (sens === "revenu" ? 0 : donnees.nbDepenses) + (sens === "depense" || categorie ? 0 : donnees.nbRevenus);
  const filtresActifs = Boolean(recherche || categorie);

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Kpi libelle="Entrées" valeur={formatMontant(totaux.revenus)} ton="revenu" Icone={ArrowDownRight} detail={`${donnees.nbRevenus} revenu(s)`} />
        <Kpi
          libelle="Sorties"
          valeur={formatMontant(totaux.depenses)}
          ton="depense"
          Icone={ArrowUpRight}
          detail={`${donnees.nbDepenses} dépense(s) + ${formatMontant(totaux.abonnements)} d'abonnements`}
        />
        <Kpi libelle="Solde" valeur={formatMontant(totaux.marge)} ton={totaux.marge >= 0 ? "revenu" : "depense"} valeurColoree Icone={Wallet} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex w-56 items-center gap-2 rounded-lg bg-surface px-3 py-2 text-[13px] ring-1 ring-bord focus-within:ring-accent">
          <Search size={15} className="text-pale" />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Libellé, fournisseur, montant…"
            className="min-w-0 flex-1 bg-transparent text-texte outline-none placeholder:text-pale"
            aria-label="Rechercher une transaction"
          />
        </label>
        <Segments options={SENS} valeur={sens} onChanger={setSens} />
        {!siteIdFixe && (
          <Selecteur value={siteChoisi} onChange={(e) => setSiteChoisi(e.target.value)} aria-label="Site" className="w-36">
            <option value="">Tous les sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nom}
              </option>
            ))}
          </Selecteur>
        )}
        <Selecteur value={categorie} onChange={(e) => setCategorie(e.target.value)} aria-label="Catégorie" className="w-36">
          <option value="">Catégories</option>
          {CATEGORIES.map((c) => (
            <option key={c.cle} value={c.cle}>
              {c.libelle}
            </option>
          ))}
        </Selecteur>
        <Segments options={PERIODES_COURTES} valeur={periode} onChanger={setPeriode} />
        <Bouton
          variante="discret"
          className="ml-auto flex items-center gap-1.5 text-xs"
          onClick={copierCsv}
          disabled={lignes.length === 0}
          title="Copier les lignes affichées en CSV, à coller dans un tableur"
          aria-label="Copier en CSV"
        >
          <ClipboardCopy size={14} />
          {copie ? "Copié !" : "CSV"}
        </Bouton>
      </div>

      {erreur && <p className="rounded-lg bg-ko/10 px-3 py-2 text-xs text-ko">{erreur}</p>}

      <Carte sansMarge className="overflow-hidden">
        {groupes.length === 0 ? (
          <EtatVide Icone={Receipt}>{filtresActifs ? "Aucune transaction ne correspond." : "Aucune transaction sur cette période."}</EtatVide>
        ) : (
          groupes.map((groupe) => (
            <div key={groupe.mois}>
              <div className="flex justify-between border-b border-bord bg-surface-2/60 px-5 py-2 text-xs font-medium text-texte-doux">
                <span>{moisLong(groupe.mois)}</span>
                <span className="chiffres">
                  {groupe.solde > 0 ? "+" : ""}
                  {formatMontant(groupe.solde)}
                </span>
              </div>
              {groupe.lignes.map((l) => {
                const entree = l.sens === "revenu";
                const Icone = entree ? ArrowDownRight : (ICONES_CATEGORIES[l.categorie] ?? Receipt);
                const montant = montantLigne(l, siteId);
                const conversion = mentionConversion(l);
                return (
                  <div
                    key={`${l.sens}-${l.id}`}
                    className="group flex cursor-pointer items-center gap-4 border-b border-bord/60 px-5 py-3 transition last:border-0 hover:bg-surface-2/50"
                    onClick={() => onModifier(l)}
                  >
                    {!entree && l.fournisseur_favicon ? (
                      <img src={l.fournisseur_favicon} alt="" aria-hidden="true" className="size-9 shrink-0 rounded-xl bg-surface-2 object-contain p-1.5 ring-1 ring-bord" />
                    ) : (
                      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${entree ? "bg-revenu/12 text-revenu" : "bg-surface-3 text-texte-doux"}`}>
                        <Icone size={16} />
                      </span>
                    )}
                    <span className="w-60 min-w-0">
                      <span className="block truncate text-[13px] font-medium">{l.libelle || l.fournisseur_nom || (entree ? "Revenu" : "Dépense")}</span>
                      <span className="block truncate text-xs text-pale">
                        {entree ? "Revenu" : [l.fournisseur_nom, libelleCategorie(l.categorie)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                      {(l.sites_noms ?? "").split(" + ").filter(Boolean).map((nom) => {
                        const site = sites.find((s) => s.nom === nom);
                        return (
                          <span key={nom} className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 text-[11px] text-texte-doux">
                            <span className="size-1.5 rounded-full" style={{ background: site?.couleur ?? "var(--color-pale)" }} />
                            {nom}
                          </span>
                        );
                      })}
                      {l.nb_sites > 1 && <span className="text-[11px] text-pale">partagé</span>}
                    </span>
                    <span className="w-16 shrink-0 text-xs text-pale">{jourCourt(l.date)}</span>
                    <span className="w-36 shrink-0 text-right">
                      <span className={`chiffres block text-[13px] font-semibold ${entree ? "text-revenu" : "text-texte"}`}>
                        {entree ? "+" : "−"}
                        {formatMontant(montant)}
                      </span>
                      {conversion && <span className="block truncate text-[11px] text-pale">{conversion}</span>}
                      {siteId && l.nb_sites > 1 && (
                        <span className="block text-[11px] text-pale">sur {formatMontant(l.montant_eur_cents ?? l.montant_cents)}</span>
                      )}
                    </span>
                    <span onClick={(e) => e.stopPropagation()}>
                      <MenuActions
                        actions={[
                          { libelle: "Modifier", Icone: Pencil, onClick: () => onModifier(l) },
                          { libelle: "Supprimer", Icone: Trash2, onClick: () => supprimer(l), danger: true, separe: true },
                        ]}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </Carte>
      {!filtresActifs && <AfficherPlus affichees={lignes.length} total={total} onPlus={() => setLimite((l) => l + PAGE)} />}
    </>
  );
}
