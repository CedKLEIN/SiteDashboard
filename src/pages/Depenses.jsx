import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Bouton, Carte, Champ, EtatVide, Pastille, Selecteur } from "../components/ui";
import {
  ajouterDepense,
  listerDepenses,
  listerFournisseurs,
  listerSites,
  supprimerDepense,
  trouverOuCreerFournisseur,
} from "../lib/queries";
import { aujourdhuiIso, formatMontant, parseMontant } from "../lib/format";

export const CATEGORIES = [
  "hebergement",
  "domaine",
  "api",
  "saas",
  "marketing",
  "autre",
];

const FORMULAIRE_VIDE = {
  siteId: "",
  fournisseur: "",
  date: aujourdhuiIso(),
  montant: "",
  libelle: "",
  categorie: "hebergement",
};

export default function Depenses({ onModification }) {
  const [sites, setSites] = useState([]);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [depenses, setDepenses] = useState([]);
  const [filtreSite, setFiltreSite] = useState("");
  const [formulaire, setFormulaire] = useState(FORMULAIRE_VIDE);
  const [erreur, setErreur] = useState("");

  async function recharger() {
    const [s, f, d] = await Promise.all([
      listerSites(),
      listerFournisseurs(),
      listerDepenses({ siteId: filtreSite ? Number(filtreSite) : null }),
    ]);
    setSites(s);
    setFournisseurs(f);
    setDepenses(d);
  }

  useEffect(() => {
    recharger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtreSite]);

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

    const fournisseurId = await trouverOuCreerFournisseur(
      formulaire.fournisseur,
      formulaire.categorie,
    );

    await ajouterDepense({
      siteId: Number(formulaire.siteId),
      fournisseurId,
      date: formulaire.date,
      montantCents,
      libelle: formulaire.libelle,
      categorie: formulaire.categorie,
    });

    setFormulaire({ ...FORMULAIRE_VIDE, siteId: formulaire.siteId });
    await recharger();
    onModification?.();
  }

  async function retirer(id) {
    await supprimerDepense(id);
    await recharger();
    onModification?.();
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold">Depenses</h1>

      {sites.length === 0 ? (
        <Carte>
          <EtatVide>
            Commence par creer un site dans l&apos;onglet « Sites ».
          </EtatVide>
        </Carte>
      ) : (
        <Carte titre="Nouvelle depense">
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
              label="Categorie"
              value={formulaire.categorie}
              onChange={(e) => maj("categorie", e.target.value)}
              className="w-36"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
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
              placeholder="12,50"
              value={formulaire.montant}
              onChange={(e) => maj("montant", e.target.value)}
              className="w-28"
            />

            <Champ
              label="Libelle"
              placeholder="Facture septembre"
              value={formulaire.libelle}
              onChange={(e) => maj("libelle", e.target.value)}
              className="min-w-48 flex-1"
            />

            <Bouton type="submit">Ajouter</Bouton>
          </form>
          {erreur && <p className="mt-2 text-xs text-depense">{erreur}</p>}
        </Carte>
      )}

      <Carte
        titre={`Historique (${depenses.length})`}
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
          <EtatVide>Aucune depense enregistree.</EtatVide>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-bord text-left text-xs uppercase text-texte-doux">
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Site</th>
                <th className="py-2 font-medium">Fournisseur</th>
                <th className="py-2 font-medium">Categorie</th>
                <th className="py-2 font-medium">Libelle</th>
                <th className="py-2 text-right font-medium">Montant</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {depenses.map((d) => (
                <tr key={d.id} className="border-b border-bord/50 last:border-0">
                  <td className="py-2 tabular-nums text-texte-doux">{d.date}</td>
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      <Pastille couleur={d.site_couleur} />
                      {d.site_nom ?? "—"}
                    </span>
                  </td>
                  <td className="py-2">{d.fournisseur_nom ?? "—"}</td>
                  <td className="py-2 text-texte-doux">{d.categorie}</td>
                  <td className="py-2 text-texte-doux">{d.libelle}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatMontant(d.montant_cents, d.devise)}
                  </td>
                  <td className="py-2 pl-2 text-right">
                    <Bouton
                      variante="danger"
                      className="px-1.5 py-1"
                      title="Supprimer"
                      onClick={() => retirer(d.id)}
                    >
                      <Trash2 size={14} />
                    </Bouton>
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
