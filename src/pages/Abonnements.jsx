import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Bouton, Carte, Champ, EtatVide, Pastille, Selecteur } from "../components/ui";
import {
  ajouterAbonnement,
  basculerAbonnement,
  listerAbonnements,
  listerFournisseurs,
  listerSites,
  supprimerAbonnement,
  trouverOuCreerFournisseur,
} from "../lib/queries";
import { coutMensuelEquivalent, formatMontant, parseMontant } from "../lib/format";

const FORMULAIRE_VIDE = {
  siteId: "",
  fournisseur: "",
  libelle: "",
  montant: "",
  periodicite: "mensuel",
  prochaineEcheance: "",
};

export default function Abonnements({ onModification }) {
  const [sites, setSites] = useState([]);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [abonnements, setAbonnements] = useState([]);
  const [formulaire, setFormulaire] = useState(FORMULAIRE_VIDE);
  const [erreur, setErreur] = useState("");

  async function recharger() {
    const [s, f, a] = await Promise.all([
      listerSites(),
      listerFournisseurs(),
      listerAbonnements(),
    ]);
    setSites(s);
    setFournisseurs(f);
    setAbonnements(a);
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
    if (!formulaire.libelle.trim()) {
      setErreur("Donne un libelle a cet abonnement.");
      return;
    }

    const fournisseurId = await trouverOuCreerFournisseur(formulaire.fournisseur);

    await ajouterAbonnement({
      siteId: formulaire.siteId ? Number(formulaire.siteId) : null,
      fournisseurId,
      libelle: formulaire.libelle.trim(),
      montantCents,
      periodicite: formulaire.periodicite,
      prochaineEcheance: formulaire.prochaineEcheance || null,
    });

    setFormulaire(FORMULAIRE_VIDE);
    await recharger();
    onModification?.();
  }

  async function basculer(abonnement) {
    await basculerAbonnement(abonnement.id, !abonnement.actif);
    await recharger();
    onModification?.();
  }

  async function retirer(id) {
    await supprimerAbonnement(id);
    await recharger();
    onModification?.();
  }

  const totalMensuel = abonnements
    .filter((a) => a.actif)
    .reduce((total, a) => total + coutMensuelEquivalent(a), 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Abonnements</h1>
        <p className="text-sm text-texte-doux">
          Cout recurrent :{" "}
          <span className="font-semibold text-texte">{formatMontant(totalMensuel)}</span> / mois
        </p>
      </div>

      <Carte titre="Nouvel abonnement">
        <form onSubmit={enregistrer} className="flex flex-wrap items-end gap-3">
          <Selecteur
            label="Site"
            value={formulaire.siteId}
            onChange={(e) => maj("siteId", e.target.value)}
            className="w-40"
          >
            <option value="">Transverse</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nom}
              </option>
            ))}
          </Selecteur>

          <Champ
            label="Fournisseur"
            list="liste-fournisseurs-abo"
            value={formulaire.fournisseur}
            onChange={(e) => maj("fournisseur", e.target.value)}
            className="w-40"
          />
          <datalist id="liste-fournisseurs-abo">
            {fournisseurs.map((f) => (
              <option key={f.id} value={f.nom} />
            ))}
          </datalist>

          <Champ
            label="Libelle"
            placeholder="VPS, nom de domaine, ..."
            value={formulaire.libelle}
            onChange={(e) => maj("libelle", e.target.value)}
            className="min-w-44 flex-1"
          />

          <Champ
            label="Montant (€)"
            inputMode="decimal"
            placeholder="5,99"
            value={formulaire.montant}
            onChange={(e) => maj("montant", e.target.value)}
            className="w-28"
          />

          <Selecteur
            label="Periodicite"
            value={formulaire.periodicite}
            onChange={(e) => maj("periodicite", e.target.value)}
            className="w-32"
          >
            <option value="mensuel">mensuel</option>
            <option value="annuel">annuel</option>
          </Selecteur>

          <Champ
            label="Prochaine echeance"
            type="date"
            value={formulaire.prochaineEcheance}
            onChange={(e) => maj("prochaineEcheance", e.target.value)}
            className="w-40"
          />

          <Bouton type="submit">Ajouter</Bouton>
        </form>
        {erreur && <p className="mt-2 text-xs text-depense">{erreur}</p>}
      </Carte>

      <Carte titre={`Suivis (${abonnements.length})`}>
        {abonnements.length === 0 ? (
          <EtatVide>Aucun abonnement suivi.</EtatVide>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-bord text-left text-xs uppercase text-texte-doux">
                <th className="py-2 font-medium">Actif</th>
                <th className="py-2 font-medium">Site</th>
                <th className="py-2 font-medium">Libelle</th>
                <th className="py-2 font-medium">Fournisseur</th>
                <th className="py-2 font-medium">Echeance</th>
                <th className="py-2 text-right font-medium">Montant</th>
                <th className="py-2 text-right font-medium">≈ / mois</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {abonnements.map((a) => (
                <tr
                  key={a.id}
                  className={`border-b border-bord/50 last:border-0 ${a.actif ? "" : "opacity-50"}`}
                >
                  <td className="py-2">
                    <input
                      type="checkbox"
                      checked={Boolean(a.actif)}
                      onChange={() => basculer(a)}
                    />
                  </td>
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      <Pastille couleur={a.site_couleur} />
                      {a.site_nom ?? "transverse"}
                    </span>
                  </td>
                  <td className="py-2">{a.libelle}</td>
                  <td className="py-2 text-texte-doux">{a.fournisseur_nom ?? "—"}</td>
                  <td className="py-2 tabular-nums text-texte-doux">
                    {a.prochaine_echeance ?? "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatMontant(a.montant_cents, a.devise)}
                    <span className="text-texte-doux">
                      {" "}
                      /{a.periodicite === "annuel" ? "an" : "mois"}
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums text-texte-doux">
                    {formatMontant(coutMensuelEquivalent(a))}
                  </td>
                  <td className="py-2 pl-2 text-right">
                    <Bouton
                      variante="danger"
                      className="px-1.5 py-1"
                      title="Supprimer"
                      onClick={() => retirer(a.id)}
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
