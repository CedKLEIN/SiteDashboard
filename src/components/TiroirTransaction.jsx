import { useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CircleHelp, Cpu, Globe, LayoutGrid, Megaphone, Server } from "lucide-react";
import { Bouton, Champ, Segments, Tiroir } from "./ui";
import RepartitionSites, { partsCentsDepuisSaisie } from "./RepartitionSites";
import {
  ajouterDepense,
  ajouterRevenu,
  listerFournisseurs,
  listerSites,
  majDepense,
  majRevenu,
  partsDepense,
  partsRevenu,
  trouverOuCreerFournisseur,
} from "../lib/queries";
import { aujourdhuiIso, parseMontant } from "../lib/format";
import { CATEGORIES } from "../lib/categories";
import { DEVISES, DEVISE_REFERENCE } from "../lib/devises";
import { convertirVersReference, partsEnReference } from "../lib/conversion";

export const ICONES_CATEGORIES = {
  hebergement: Server,
  domaine: Globe,
  api: Cpu,
  saas: LayoutGrid,
  marketing: Megaphone,
  autre: CircleHelp,
};

// Une fonction et non une constante : l'appli reste ouverte des jours, la date
// du jour doit etre celle de l'ouverture du panneau, pas du lancement.
function formulaireVide(siteIds = []) {
  return {
    siteIds,
    parts: null,
    fournisseur: "",
    date: aujourdhuiIso(),
    montant: "",
    devise: DEVISE_REFERENCE,
    libelle: "",
    categorie: "hebergement",
  };
}

/**
 * Saisie et correction d'une depense ou d'un revenu, dans un panneau lateral.
 * `edition` : la ligne a corriger (avec `sens`), ou null pour une creation.
 * `siteIdParDefaut` : le site pre-coche, quand on saisit depuis sa fiche.
 */
export default function TiroirTransaction({ ouvert, sens: sensInitial = "depense", edition = null, siteIdParDefaut = null, onFermer, onEnregistre }) {
  const [sens, setSens] = useState(edition?.sens ?? sensInitial);
  const [sites, setSites] = useState([]);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [formulaire, setFormulaire] = useState(formulaireVide);
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const champMontant = useRef(null);

  // Monte a chaque ouverture (voir App) : un panneau rouvert repart d'une saisie vierge
  useEffect(() => {
    let annule = false;
    (async () => {
      const [s, f] = await Promise.all([listerSites(), listerFournisseurs()]);
      const actifs = s.filter((x) => x.actif);
      let depart = formulaireVide(siteIdParDefaut ? [siteIdParDefaut] : actifs.length === 1 ? [actifs[0].id] : []);
      if (edition) {
        const parts = edition.sens === "revenu" ? await partsRevenu(edition.id) : await partsDepense(edition.id);
        depart = {
          siteIds: parts.map((p) => p.site_id),
          // Parts egales a la reouverture : celles enregistrees sont en euros,
          // les reproposer sur un montant en dollars serait trompeur.
          parts: null,
          fournisseur: edition.fournisseur_nom ?? "",
          date: edition.date,
          montant: (edition.montant_cents / 100).toFixed(2).replace(".", ","),
          devise: edition.devise ?? DEVISE_REFERENCE,
          libelle: edition.libelle ?? "",
          categorie: edition.categorie ?? "autre",
        };
      }
      if (annule) return;
      setSites(actifs);
      setFournisseurs(f);
      setFormulaire(depart);
      setTimeout(() => champMontant.current?.focus(), 50);
    })().catch((e) => !annule && setErreur(String(e?.message ?? e)));
    return () => {
      annule = true;
    };
  }, [edition, siteIdParDefaut]);

  function maj(champ, valeur) {
    setFormulaire((f) => ({ ...f, [champ]: valeur }));
  }

  function basculerSite(id) {
    setFormulaire((f) => ({
      ...f,
      siteIds: f.siteIds.includes(id) ? f.siteIds.filter((x) => x !== id) : [...f.siteIds, id],
      // Changer la liste des sites invalide une repartition manuelle
      parts: null,
    }));
  }

  async function enregistrer(evenement) {
    evenement?.preventDefault();
    setErreur("");
    const montantCents = parseMontant(formulaire.montant);
    if (montantCents === null || montantCents <= 0) {
      setErreur("Montant invalide.");
      return;
    }
    if (formulaire.siteIds.length === 0) {
      setErreur("Choisis au moins un site.");
      return;
    }

    setEnvoi(true);
    try {
      const { taux, montantEurCents } = await convertirVersReference({
        montantCents,
        devise: formulaire.devise,
        date: formulaire.date,
      });
      const commun = {
        siteIds: formulaire.siteIds,
        partsCents: partsEnReference(partsCentsDepuisSaisie(formulaire.siteIds, formulaire.parts), montantCents, montantEurCents),
        date: formulaire.date,
        montantCents,
        devise: formulaire.devise,
        taux,
        montantEurCents,
        libelle: formulaire.libelle.trim(),
      };
      if (sens === "revenu") {
        if (edition) await majRevenu(edition.id, commun);
        else await ajouterRevenu(commun);
      } else {
        const fournisseurId = await trouverOuCreerFournisseur(formulaire.fournisseur, formulaire.categorie);
        const depense = { ...commun, fournisseurId, categorie: formulaire.categorie };
        if (edition) await majDepense(edition.id, depense);
        else await ajouterDepense(depense);
      }
    } catch (e) {
      // Typiquement : la somme des parts saisies ne fait pas le montant
      setErreur(String(e?.message ?? e));
      setEnvoi(false);
      return;
    }
    setEnvoi(false);
    onEnregistre?.();
    onFermer();
  }

  const titre = edition
    ? sens === "revenu"
      ? "Modifier le revenu"
      : "Modifier la dépense"
    : "Nouvelle transaction";

  return (
    <Tiroir
      titre={titre}
      ouvert={ouvert}
      onFermer={onFermer}
      pied={
        <>
          <span className="mr-auto text-[11px] text-pale">
            <kbd className="rounded bg-surface-3 px-1">Ctrl</kbd> + <kbd className="rounded bg-surface-3 px-1">Entrée</kbd>
          </span>
          <Bouton variante="fantome" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton onClick={enregistrer} disabled={envoi}>
            {envoi ? "Enregistrement…" : "Enregistrer"}
          </Bouton>
        </>
      }
    >
      <form
        onSubmit={enregistrer}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) enregistrer(e);
        }}
        className="flex flex-col gap-5"
      >
        {!edition && (
          <div className="grid grid-cols-2 rounded-xl bg-surface-2 p-1 text-[13px] font-medium ring-1 ring-bord">
            {[
              ["depense", "Dépense", ArrowUpRight, "bg-depense/15 text-depense"],
              ["revenu", "Revenu", ArrowDownRight, "bg-revenu/15 text-revenu"],
            ].map(([cle, libelle, Icone, actif]) => (
              <button
                key={cle}
                type="button"
                aria-pressed={sens === cle}
                onClick={() => setSens(cle)}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 transition ${sens === cle ? actif : "text-texte-doux hover:text-texte"}`}
              >
                <Icone size={15} /> {libelle}
              </button>
            ))}
          </div>
        )}

        <div className="rounded-xl bg-surface-2 px-4 py-4 ring-1 ring-bord focus-within:ring-accent">
          <label htmlFor="montant-transaction" className="text-xs font-medium text-texte-doux">
            Montant
          </label>
          <div className="mt-1 flex items-center gap-3">
            <input
              id="montant-transaction"
              ref={champMontant}
              inputMode="decimal"
              placeholder="0,00"
              value={formulaire.montant}
              onChange={(e) => maj("montant", e.target.value)}
              className="chiffres min-w-0 flex-1 bg-transparent text-[32px] font-semibold tracking-tight text-texte outline-none placeholder:text-pale"
            />
            <Segments
              options={DEVISES.map((d) => ({ cle: d.code, libelle: d.symbole }))}
              valeur={formulaire.devise}
              onChanger={(d) => maj("devise", d)}
            />
          </div>
          {formulaire.devise !== DEVISE_REFERENCE && (
            <p className="mt-1 text-xs text-pale">Converti en euros au taux BCE du jour de l&apos;opération.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {sens === "depense" ? (
            <Champ
              label="Fournisseur"
              list="fournisseurs-tiroir"
              placeholder="OVH, Stripe…"
              value={formulaire.fournisseur}
              onChange={(e) => maj("fournisseur", e.target.value)}
            />
          ) : (
            <Champ
              label="Libellé"
              placeholder="AdSense, don…"
              value={formulaire.libelle}
              onChange={(e) => maj("libelle", e.target.value)}
            />
          )}
          <datalist id="fournisseurs-tiroir">
            {fournisseurs.map((f) => (
              <option key={f.id} value={f.nom} />
            ))}
          </datalist>
          <Champ label="Date" type="date" value={formulaire.date} onChange={(e) => maj("date", e.target.value)} />
        </div>

        {sens === "depense" && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-texte-doux">Catégorie</span>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => {
                const Icone = ICONES_CATEGORIES[c.cle];
                const choisie = formulaire.categorie === c.cle;
                return (
                  <button
                    key={c.cle}
                    type="button"
                    aria-pressed={choisie}
                    onClick={() => maj("categorie", c.cle)}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition ${
                      choisie ? "bg-accent/12 text-texte ring-accent" : "text-texte-doux ring-bord hover:ring-accent"
                    }`}
                  >
                    <Icone size={13} /> {c.libelle}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <RepartitionSites
          sites={sites}
          selection={formulaire.siteIds}
          onBasculerSite={basculerSite}
          montantCents={parseMontant(formulaire.montant)}
          parts={formulaire.parts}
          onChangerParts={(parts) => maj("parts", parts)}
        />

        {sens === "depense" && (
          <Champ
            label="Libellé"
            placeholder="Facture septembre"
            value={formulaire.libelle}
            onChange={(e) => maj("libelle", e.target.value)}
          />
        )}

        {erreur && <p className="rounded-lg bg-ko/10 px-3 py-2 text-xs text-ko">{erreur}</p>}
        <button type="submit" hidden aria-hidden="true" />
      </form>
    </Tiroir>
  );
}
