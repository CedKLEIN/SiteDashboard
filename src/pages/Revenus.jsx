import { useEffect, useState } from "react";
import { Bouton, Carte, Champ, EtatVide } from "../components/ui";
import RepartitionSites, { partsCentsDepuisSaisie } from "../components/RepartitionSites";
import { ajouterRevenu, listerRevenus, listerSites } from "../lib/queries";
import { aujourdhuiIso, formatMontant, parseMontant } from "../lib/format";

const FORMULAIRE_VIDE = {
  siteIds: [],
  parts: null,
  date: aujourdhuiIso(),
  montant: "",
  libelle: "",
};

export default function Revenus({ onModification }) {
  const [sites, setSites] = useState([]);
  const [revenus, setRevenus] = useState([]);
  const [formulaire, setFormulaire] = useState(FORMULAIRE_VIDE);
  const [erreur, setErreur] = useState("");

  async function recharger() {
    const [s, r] = await Promise.all([listerSites(), listerRevenus({})]);
    setSites(s);
    setRevenus(r);
  }

  useEffect(() => {
    // recharger() est async: les setState ont lieu apres await, pas pendant le rendu
    // oxlint-disable-next-line react/set-state-in-effect
    recharger();
  }, []);

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
      await ajouterRevenu({
        siteIds: formulaire.siteIds,
        partsCents: partsCentsDepuisSaisie(formulaire.siteIds, formulaire.parts),
        date: formulaire.date,
        montantCents,
        libelle: formulaire.libelle,
      });
    } catch (e) {
      setErreur(String(e.message ?? e));
      return;
    }

    setFormulaire({ ...FORMULAIRE_VIDE, siteIds: formulaire.siteIds });
    await recharger();
    onModification?.();
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold">Revenus</h1>

      {sites.length > 0 && (
        <Carte titre="Nouveau revenu">
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
              label="Montant (€)"
              inputMode="decimal"
              placeholder="49,90"
              value={formulaire.montant}
              onChange={(e) => maj("montant", e.target.value)}
              className="w-28"
            />
            <Champ
              label="Libelle"
              placeholder="Abonnements Stripe"
              value={formulaire.libelle}
              onChange={(e) => maj("libelle", e.target.value)}
              className="min-w-48 flex-1"
            />
            <Bouton type="submit">Ajouter</Bouton>
          </form>
          {erreur && <p className="mt-2 text-xs text-depense">{erreur}</p>}
        </Carte>
      )}

      <Carte titre={`Historique (${revenus.length})`}>
        {revenus.length === 0 ? (
          <EtatVide>Aucun revenu enregistre.</EtatVide>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-bord text-left text-xs uppercase text-texte-doux">
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Sites</th>
                <th className="py-2 font-medium">Libelle</th>
                <th className="py-2 text-right font-medium">Montant</th>
              </tr>
            </thead>
            <tbody>
              {revenus.map((r) => (
                <tr key={r.id} className="border-b border-bord/50 last:border-0">
                  <td className="py-2 tabular-nums text-texte-doux">{r.date}</td>
                  <td className="py-2">
                    {r.sites_noms ?? <span className="text-texte-doux">non rattache</span>}
                    {r.nb_sites > 1 && (
                      <span className="ml-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-texte-doux">
                        partage
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-texte-doux">{r.libelle}</td>
                  <td className="py-2 text-right tabular-nums text-revenu">
                    {formatMontant(r.montant_cents, r.devise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Carte>
    </div>
  );
}
