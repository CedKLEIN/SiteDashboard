import { useEffect, useState } from "react";
import { Bouton, Carte, Champ, EtatVide, Pastille, Selecteur } from "../components/ui";
import { ajouterRevenu, listerRevenus, listerSites } from "../lib/queries";
import { aujourdhuiIso, formatMontant, parseMontant } from "../lib/format";

const FORMULAIRE_VIDE = {
  siteId: "",
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

  async function enregistrer(evenement) {
    evenement.preventDefault();
    setErreur("");

    const montantCents = parseMontant(formulaire.montant);
    if (montantCents === null || montantCents <= 0) {
      setErreur("Montant invalide.");
      return;
    }
    if (!formulaire.siteId) {
      setErreur("Choisis un site.");
      return;
    }

    await ajouterRevenu({
      siteId: Number(formulaire.siteId),
      date: formulaire.date,
      montantCents,
      libelle: formulaire.libelle,
    });

    setFormulaire({ ...FORMULAIRE_VIDE, siteId: formulaire.siteId });
    await recharger();
    onModification?.();
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold">Revenus</h1>

      {sites.length > 0 && (
        <Carte titre="Nouveau revenu">
          <form onSubmit={enregistrer} className="flex flex-wrap items-end gap-3">
            <Selecteur
              label="Site"
              value={formulaire.siteId}
              onChange={(e) => maj("siteId", e.target.value)}
              className="w-44"
            >
              <option value="">—</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nom}
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
                <th className="py-2 font-medium">Site</th>
                <th className="py-2 font-medium">Libelle</th>
                <th className="py-2 text-right font-medium">Montant</th>
              </tr>
            </thead>
            <tbody>
              {revenus.map((r) => (
                <tr key={r.id} className="border-b border-bord/50 last:border-0">
                  <td className="py-2 tabular-nums text-texte-doux">{r.date}</td>
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      <Pastille couleur={r.site_couleur} />
                      {r.site_nom ?? "—"}
                    </span>
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
