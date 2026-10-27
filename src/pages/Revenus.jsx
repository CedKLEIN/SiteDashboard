import { useEffect, useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { AfficherPlus, Bouton, Carte, Champ, EtatVide, Selecteur } from "../components/ui";
import RepartitionSites, { partsCentsDepuisSaisie } from "../components/RepartitionSites";
import {
  ajouterRevenu,
  compterRevenus,
  listerRevenus,
  listerSites,
  majRevenu,
  partsRevenu,
  supprimerRevenu,
} from "../lib/queries";
import { aujourdhuiIso, dateFr, formatMontant, parseMontant } from "../lib/format";
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
    devise: DEVISE_REFERENCE,
    date: aujourdhuiIso(),
    montant: "",
    libelle: "",
  };
}

export default function Revenus({ onModification }) {
  const [sites, setSites] = useState([]);
  const [revenus, setRevenus] = useState([]);
  const [total, setTotal] = useState(0);
  const [limite, setLimite] = useState(PAGE);
  const [formulaire, setFormulaire] = useState(formulaireVide);
  const [enEdition, setEnEdition] = useState(null);
  const [erreur, setErreur] = useState("");

  async function recharger() {
    try {
      const [s, r, n] = await Promise.all([listerSites(), listerRevenus({ limite }), compterRevenus()]);
      setSites(s);
      setRevenus(r);
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
    // recharger() est async: les setState ont lieu apres await, pas pendant le rendu
    // oxlint-disable-next-line react/set-state-in-effect
    recharger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limite]);

  function maj(champ, valeur) {
    setFormulaire((f) => ({ ...f, [champ]: valeur }));
  }

  function basculerSite(id) {
    setFormulaire((f) => ({
      ...f,
      siteIds: f.siteIds.includes(id)
        ? f.siteIds.filter((x) => x !== id)
        : [...f.siteIds, id],
      parts: null,
    }));
  }

  const montantSaisiCents = parseMontant(formulaire.montant);

  async function editer(revenu) {
    setErreur("");
    try {
      const parts = await partsRevenu(revenu.id);
      setEnEdition(revenu.id);
      setFormulaire({
        siteIds: parts.map((p) => p.site_id),
        parts: null,
        devise: revenu.devise ?? DEVISE_REFERENCE,
        date: revenu.date,
        montant: (revenu.montant_cents / 100).toFixed(2),
        libelle: revenu.libelle ?? "",
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
      const donnees = {
        siteIds: formulaire.siteIds,
        partsCents: partsEnReference(
          partsCentsDepuisSaisie(formulaire.siteIds, formulaire.parts),
          montantCents,
          montantEurCents,
        ),
        date: formulaire.date,
        montantCents,
        devise: formulaire.devise,
        taux,
        montantEurCents,
        libelle: formulaire.libelle,
      };
      if (enEdition) await majRevenu(enEdition, donnees);
      else await ajouterRevenu(donnees);
    } catch (e) {
      setErreur(String(e?.message ?? e));
      return;
    }

    setEnEdition(null);
    setFormulaire(formulaireVide(formulaire.siteIds));
    await recharger();
    onModification?.();
  }

  async function retirer(revenu) {
    const confirme = window.confirm(
      `Supprimer le revenu « ${revenu.libelle || dateFr(revenu.date)} » (${formatMontant(revenu.montant_eur_cents ?? revenu.montant_cents)}) ?`,
    );
    if (!confirme) return;
    try {
      await supprimerRevenu(revenu.id);
      if (enEdition === revenu.id) annulerEdition();
      await recharger();
      onModification?.();
    } catch (e) {
      setErreur(String(e?.message ?? e));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold">Revenus</h1>

      {sites.length === 0 ? (
        <Carte>
          <EtatVide>Commence par créer un site dans l&apos;onglet « Sites ».</EtatVide>
        </Carte>
      ) : (
        <Carte
          titre={enEdition ? "Modifier le revenu" : "Nouveau revenu"}
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
              label="Date"
              type="date"
              value={formulaire.date}
              onChange={(e) => maj("date", e.target.value)}
              className="w-40"
            />
            <Champ
              label="Montant"
              inputMode="decimal"
              placeholder="49,90"
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
              placeholder="Abonnements Stripe"
              value={formulaire.libelle}
              onChange={(e) => maj("libelle", e.target.value)}
              className="min-w-48 flex-1"
            />
            <Bouton type="submit">{enEdition ? "Enregistrer" : "Ajouter"}</Bouton>
          </form>
          {erreur && <p className="mt-2 text-xs text-depense">{erreur}</p>}
        </Carte>
      )}

      <Carte titre={`Historique (${total})`}>
        {revenus.length === 0 ? (
          <EtatVide>Aucun revenu enregistré.</EtatVide>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bord text-left text-xs uppercase text-texte-doux">
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">Sites</th>
                  <th className="py-2 font-medium">Libellé</th>
                  <th className="py-2 text-right font-medium">Montant</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {revenus.map((r) => (
                  <tr
                    key={r.id}
                    className={`border-b border-bord/50 last:border-0 ${enEdition === r.id ? "bg-accent/10" : ""}`}
                  >
                    <td className="py-2 tabular-nums text-texte-doux">{dateFr(r.date)}</td>
                    <td className="py-2">
                      {r.sites_noms ?? <span className="text-texte-doux">non rattaché</span>}
                      {r.nb_sites > 1 && (
                        <span className="ml-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-texte-doux">
                          partagé
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-texte-doux">{r.libelle}</td>
                    <td className="py-2 text-right tabular-nums text-revenu">
                      {formatMontant(r.montant_eur_cents ?? r.montant_cents)}
                      {mentionConversion(r) && (
                        <span className="block text-[11px] text-texte-doux">
                          {mentionConversion(r)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pl-2 text-right whitespace-nowrap">
                      <Bouton
                        variante="fantome"
                        className="mr-1 px-1.5 py-1"
                        title="Modifier"
                        aria-label="Modifier"
                        onClick={() => editer(r)}
                      >
                        <Pencil size={14} />
                      </Bouton>
                      <Bouton
                        variante="danger"
                        className="px-1.5 py-1"
                        title="Supprimer"
                        aria-label="Supprimer"
                        onClick={() => retirer(r)}
                      >
                        <Trash2 size={14} />
                      </Bouton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <AfficherPlus affichees={revenus.length} total={total} onPlus={() => setLimite((l) => l + PAGE)} />
          </>
        )}
      </Carte>
    </div>
  );
}
