import { useEffect, useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { AfficherPlus, Bouton, Carte, Champ, EtatVide, Selecteur } from "../components/ui";
import RepartitionSites, { partsCentsDepuisSaisie } from "../components/RepartitionSites";
import {
  ajouterDepense,
  compterDepenses,
  listerDepenses,
  listerFournisseurs,
  listerSites,
  majDepense,
  partsDepense,
  supprimerDepense,
  trouverOuCreerFournisseur,
} from "../lib/queries";
import { aujourdhuiIso, dateFr, formatMontant, parseMontant } from "../lib/format";
import { CATEGORIES, libelleCategorie } from "../lib/categories";
import { DEVISES, DEVISE_REFERENCE, mentionConversion } from "../lib/devises";
import { convertirVersReference, partsEnReference } from "../lib/conversion";

/** Lignes chargees a la fois dans l'historique. */
const PAGE = 100;

// Une fonction et non une constante : l'appli reste ouverte des jours, la date
// du jour doit etre celle du moment ou le formulaire est vide, pas du lancement.
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

export default function Depenses({ onModification }) {
  const [sites, setSites] = useState([]);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [depenses, setDepenses] = useState([]);
  const [total, setTotal] = useState(0);
  const [limite, setLimite] = useState(PAGE);
  const [filtreSite, setFiltreSite] = useState("");
  const [formulaire, setFormulaire] = useState(formulaireVide);
  const [enEdition, setEnEdition] = useState(null);
  const [erreur, setErreur] = useState("");

  async function recharger() {
    const siteId = filtreSite ? Number(filtreSite) : null;
    try {
      const [s, f, d, n] = await Promise.all([
        listerSites(),
        listerFournisseurs(),
        listerDepenses({ siteId, limite }),
        compterDepenses({ siteId }),
      ]);
      setSites(s);
      setFournisseurs(f);
      setDepenses(d);
      setTotal(n);
      // Un site supprime entre-temps laisserait un identifiant invisible dans la
      // selection: on ne peut pas deselectionner une pastille qui n'existe plus.
      setFormulaire((f) => ({
        ...f,
        siteIds: f.siteIds.filter((id) => s.some((site) => site.id === id)),
      }));
    } catch (e) {
      setErreur(String(e?.message ?? e));
    }
  }

  useEffect(() => {
    recharger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtreSite, limite]);

  function maj(champ, valeur) {
    setFormulaire((f) => ({ ...f, [champ]: valeur }));
  }

  function basculerSite(id) {
    setFormulaire((f) => ({
      ...f,
      siteIds: f.siteIds.includes(id)
        ? f.siteIds.filter((x) => x !== id)
        : [...f.siteIds, id],
      // Changer la liste des sites invalide une repartition manuelle: on
      // repart de parts egales plutot que de garder des montants incoherents.
      parts: null,
    }));
  }

  const montantSaisiCents = parseMontant(formulaire.montant);

  async function editer(depense) {
    setErreur("");
    try {
      const parts = await partsDepense(depense.id);
      setEnEdition(depense.id);
      setFormulaire({
        siteIds: parts.map((p) => p.site_id),
        // Parts egales a la reouverture : les parts enregistrees sont en euros,
        // les reproposer sur un montant en dollars serait trompeur.
        parts: null,
        fournisseur: depense.fournisseur_nom ?? "",
        date: depense.date,
        montant: (depense.montant_cents / 100).toFixed(2),
        devise: depense.devise ?? DEVISE_REFERENCE,
        libelle: depense.libelle ?? "",
        categorie: depense.categorie ?? "autre",
      });
      globalThis.scrollTo?.({ top: 0, behavior: "smooth" });
    } catch (e) {
      setErreur(String(e?.message ?? e));
    }
  }

  function annulerEdition() {
    setEnEdition(null);
    setFormulaire(formulaireVide());
    setErreur("");
  }

  async function enregistrer(evenement) {
    evenement.preventDefault();
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

    try {
      const { taux, montantEurCents } = await convertirVersReference({
        montantCents,
        devise: formulaire.devise,
        date: formulaire.date,
      });
      const fournisseurId = await trouverOuCreerFournisseur(
        formulaire.fournisseur,
        formulaire.categorie,
      );
      const donnees = {
        siteIds: formulaire.siteIds,
        partsCents: partsEnReference(
          partsCentsDepuisSaisie(formulaire.siteIds, formulaire.parts),
          montantCents,
          montantEurCents,
        ),
        fournisseurId,
        date: formulaire.date,
        montantCents,
        devise: formulaire.devise,
        taux,
        montantEurCents,
        libelle: formulaire.libelle,
        categorie: formulaire.categorie,
      };
      if (enEdition) await majDepense(enEdition, donnees);
      else await ajouterDepense(donnees);
    } catch (e) {
      // Typiquement: la somme des parts saisies ne fait pas le montant total
      setErreur(String(e?.message ?? e));
      return;
    }

    setEnEdition(null);
    setFormulaire(formulaireVide(formulaire.siteIds));
    await recharger();
    onModification?.();
  }

  async function retirer(depense) {
    const confirme = window.confirm(
      `Supprimer la dépense « ${depense.libelle || depense.fournisseur_nom || dateFr(depense.date)} » (${formatMontant(depense.montant_cents, depense.devise)}) ?`,
    );
    if (!confirme) return;
    try {
      await supprimerDepense(depense.id);
      if (enEdition === depense.id) annulerEdition();
      await recharger();
      onModification?.();
    } catch (e) {
      setErreur(String(e?.message ?? e));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold">Dépenses</h1>

      {sites.length === 0 ? (
        <Carte>
          <EtatVide>Commence par créer un site dans l&apos;onglet « Sites ».</EtatVide>
        </Carte>
      ) : (
        <Carte
          titre={enEdition ? "Modifier la dépense" : "Nouvelle dépense"}
          action={
            enEdition && (
              <Bouton
                variante="fantome"
                className="flex items-center gap-1 px-2 py-1 text-xs"
                onClick={annulerEdition}
              >
                <X size={13} />
                Annuler
              </Bouton>
            )
          }
        >
          <form onSubmit={enregistrer} className="flex flex-wrap items-end gap-3">
            <RepartitionSites
              sites={sites}
              selection={formulaire.siteIds}
              onBasculerSite={basculerSite}
              montantCents={montantSaisiCents}
              parts={formulaire.parts}
              onChangerParts={(parts) => maj("parts", parts)}
            />

            <Champ
              label="Fournisseur"
              list="liste-fournisseurs"
              placeholder="OVH, Stripe, ..."
              value={formulaire.fournisseur}
              onChange={(e) => maj("fournisseur", e.target.value)}
              className="w-44"
            />
            <datalist id="liste-fournisseurs">
              {fournisseurs.map((f) => (
                <option key={f.id} value={f.nom} />
              ))}
            </datalist>

            <Selecteur
              label="Catégorie"
              value={formulaire.categorie}
              onChange={(e) => maj("categorie", e.target.value)}
              className="w-36"
            >
              {CATEGORIES.map((c) => (
                <option key={c.cle} value={c.cle}>
                  {c.libelle}
                </option>
              ))}
            </Selecteur>

            <Champ
              label="Date"
              type="date"
              value={formulaire.date}
              onChange={(e) => maj("date", e.target.value)}
              className="w-40"
            />

            <Champ
              label="Montant"
              inputMode="decimal"
              placeholder="12,50"
              value={formulaire.montant}
              onChange={(e) => maj("montant", e.target.value)}
              className="w-28"
            />

            <Selecteur
              label="Devise"
              value={formulaire.devise}
              onChange={(e) => maj("devise", e.target.value)}
              className="w-24"
            >
              {DEVISES.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.code}
                </option>
              ))}
            </Selecteur>

            <Champ
              label="Libellé"
              placeholder="Facture septembre"
              value={formulaire.libelle}
              onChange={(e) => maj("libelle", e.target.value)}
              className="min-w-48 flex-1"
            />

            <Bouton type="submit">{enEdition ? "Enregistrer" : "Ajouter"}</Bouton>
          </form>
          {erreur && <p className="mt-2 text-xs text-depense">{erreur}</p>}
        </Carte>
      )}

      <Carte
        titre={`Historique (${total})`}
        action={
          <Selecteur
            label=""
            value={filtreSite}
            onChange={(e) => setFiltreSite(e.target.value)}
          >
            <option value="">Tous les sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nom}
              </option>
            ))}
          </Selecteur>
        }
      >
        {depenses.length === 0 ? (
          <EtatVide>Aucune dépense enregistrée.</EtatVide>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bord text-left text-xs uppercase text-texte-doux">
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">Sites</th>
                  <th className="py-2 font-medium">Fournisseur</th>
                  <th className="py-2 font-medium">Catégorie</th>
                  <th className="py-2 font-medium">Libellé</th>
                  <th className="py-2 text-right font-medium">Montant</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {depenses.map((d) => (
                  <tr
                    key={d.id}
                    className={`border-b border-bord/50 last:border-0 ${enEdition === d.id ? "bg-accent/10" : ""}`}
                  >
                    <td className="py-2 tabular-nums text-texte-doux">{dateFr(d.date)}</td>
                    <td className="py-2">
                      {d.sites_noms ?? <span className="text-texte-doux">non rattachée</span>}
                      {d.nb_sites > 1 && (
                        <span className="ml-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-texte-doux">
                          partagée
                        </span>
                      )}
                    </td>
                    <td className="py-2">{d.fournisseur_nom ?? "—"}</td>
                    <td className="py-2 text-texte-doux">{libelleCategorie(d.categorie)}</td>
                    <td className="py-2 text-texte-doux">{d.libelle}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatMontant(d.montant_eur_cents ?? d.montant_cents)}
                      {mentionConversion(d) && (
                        <span className="block text-[11px] text-texte-doux">{mentionConversion(d)}</span>
                      )}
                      {d.part_cents != null && d.nb_sites > 1 && (
                        <span className="block text-[11px] text-texte-doux">
                          dont {formatMontant(d.part_cents)} pour ce site
                        </span>
                      )}
                    </td>
                    <td className="py-2 pl-2 text-right whitespace-nowrap">
                      <Bouton
                        variante="fantome"
                        className="mr-1 px-1.5 py-1"
                        title="Modifier"
                        aria-label="Modifier"
                        onClick={() => editer(d)}
                      >
                        <Pencil size={14} />
                      </Bouton>
                      <Bouton
                        variante="danger"
                        className="px-1.5 py-1"
                        title="Supprimer"
                        aria-label="Supprimer"
                        onClick={() => retirer(d)}
                      >
                        <Trash2 size={14} />
                      </Bouton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <AfficherPlus affichees={depenses.length} total={total} onPlus={() => setLimite((l) => l + PAGE)} />
          </>
        )}
      </Carte>
    </div>
  );
}
