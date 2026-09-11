import { Fragment, useEffect, useState } from "react";
import { History, Image as ImageIcon, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Bouton, Carte, Champ, EtatVide, Kpi, Selecteur } from "../components/ui";
import RepartitionSites, { partsCentsDepuisSaisie } from "../components/RepartitionSites";
import {
  ajouterAbonnement,
  ajouterTarif,
  basculerAbonnement,
  listerAbonnements,
  listerFournisseurs,
  listerSites,
  listerTarifs,
  majFaviconFournisseur,
  supprimerAbonnement,
  supprimerTarif,
  trouverOuCreerFournisseur,
} from "../lib/queries";
import { coutMensuelEquivalent, totalPaye } from "../lib/abonnements";
import { aujourdhuiIso, formatMontant, parseMontant } from "../lib/format";

const FORMULAIRE_VIDE = {
  siteIds: [],
  parts: null,
  fournisseur: "",
  fournisseurUrl: "",
  libelle: "",
  montant: "",
  periodicite: "mensuel",
  debut: aujourdhuiIso(),
  prochaineEcheance: "",
};

const TARIF_VIDE = { debut: aujourdhuiIso(), montant: "" };

export default function Abonnements({ onModification }) {
  const [sites, setSites] = useState([]);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [abonnements, setAbonnements] = useState([]);
  const [tarifs, setTarifs] = useState([]);
  const [formulaire, setFormulaire] = useState(FORMULAIRE_VIDE);
  const [erreur, setErreur] = useState("");
  const [historiqueOuvert, setHistoriqueOuvert] = useState(null);
  const [nouveauTarif, setNouveauTarif] = useState(TARIF_VIDE);

  async function recharger() {
    const [s, f, a, t] = await Promise.all([
      listerSites(),
      listerFournisseurs(),
      listerAbonnements(),
      listerTarifs(),
    ]);
    setSites(s);
    setFournisseurs(f);
    setAbonnements(a);
    setTarifs(t);
  }

  useEffect(() => {
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
  const aujourdhui = aujourdhuiIso();
  const tarifsDe = (id) => tarifs.filter((t) => t.abonnement_id === id);

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
    if (!formulaire.debut) {
      setErreur("Indique depuis quand tu paies cet abonnement.");
      return;
    }

    const fournisseurId = await trouverOuCreerFournisseur(
      formulaire.fournisseur,
      "saas",
      formulaire.fournisseurUrl.trim() || null,
    );

    try {
      await ajouterAbonnement({
        siteIds: formulaire.siteIds,
        partsCents: partsCentsDepuisSaisie(formulaire.siteIds, formulaire.parts),
        fournisseurId,
        libelle: formulaire.libelle.trim(),
        montantCents,
        periodicite: formulaire.periodicite,
        debut: formulaire.debut,
        prochaineEcheance: formulaire.prochaineEcheance || null,
      });
    } catch (e) {
      setErreur(String(e.message ?? e));
      return;
    }

    // L'icone est rattachee au fournisseur: deux abonnements du meme
    // fournisseur la partagent, inutile de la retelecharger.
    const url = formulaire.fournisseurUrl.trim();
    if (fournisseurId && url) {
      const deja = fournisseurs.find((f) => f.id === fournisseurId)?.favicon;
      if (!deja) {
        const favicon = await invoke("recuperer_favicon", { url }).catch(() => null);
        if (favicon) await majFaviconFournisseur(fournisseurId, favicon);
      }
    }

    setFormulaire(FORMULAIRE_VIDE);
    await recharger();
    onModification?.();
  }

  async function enregistrerTarif(abonnementId) {
    setErreur("");
    const montantCents = parseMontant(nouveauTarif.montant);
    if (montantCents === null || montantCents <= 0) {
      setErreur("Nouveau tarif invalide.");
      return;
    }
    await ajouterTarif(abonnementId, { debut: nouveauTarif.debut, montantCents });
    setNouveauTarif(TARIF_VIDE);
    await recharger();
    onModification?.();
  }

  async function retirerTarif(abonnementId, tarifId) {
    if (tarifsDe(abonnementId).length <= 1) {
      setErreur("Un abonnement doit garder au moins un tarif.");
      return;
    }
    await supprimerTarif(tarifId);
    await recharger();
    onModification?.();
  }

  async function recupererIconeFournisseur(abonnement) {
    setErreur("");
    if (!abonnement.fournisseur_url) {
      setErreur(`Aucune URL connue pour ${abonnement.fournisseur_nom ?? "ce fournisseur"}.`);
      return;
    }
    const favicon = await invoke("recuperer_favicon", {
      url: abonnement.fournisseur_url,
    }).catch(() => null);
    if (!favicon) {
      setErreur(`Aucune icone trouvee sur ${abonnement.fournisseur_url}.`);
      return;
    }
    await majFaviconFournisseur(abonnement.fournisseur_id, favicon);
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

  const actifs = abonnements.filter((a) => a.actif);
  const totalMensuel = actifs.reduce((total, a) => total + coutMensuelEquivalent(a), 0);
  // Cumul sur TOUS les abonnements, y compris resilies: ce qui a ete paye l'a ete
  const totalDepuisToujours = abonnements.reduce(
    (total, a) => total + totalPaye(a, tarifsDe(a.id), aujourdhui),
    0,
  );

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold">Abonnements</h1>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi
          libelle="Recurrent / mois"
          valeur={formatMontant(totalMensuel)}
          detail={`${actifs.length} actif(s)`}
        />
        <Kpi
          libelle="Recurrent / an"
          valeur={formatMontant(totalMensuel * 12)}
          detail="projection au tarif actuel"
        />
        <Kpi
          libelle="Total deja paye"
          valeur={formatMontant(totalDepuisToujours)}
          detail="depuis la premiere echeance"
          ton="depense"
        />
        <Kpi libelle="Abonnements suivis" valeur={String(abonnements.length)} />
      </div>

      <Carte titre="Nouvel abonnement">
        <form onSubmit={enregistrer} className="flex flex-wrap items-end gap-3">
          <RepartitionSites
            sites={sites}
            selection={formulaire.siteIds}
            onBasculerSite={basculerSite}
            montantCents={montantSaisiCents}
            parts={formulaire.parts}
            onChangerParts={(parts) => maj("parts", parts)}
            aideVide="aucun site coche = cout transverse"
          />

          <Champ
            label="Fournisseur"
            list="liste-fournisseurs-abo"
            placeholder="OpenAI, Ionos, ..."
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
            label="Site du fournisseur"
            placeholder="https://chatgpt.com"
            value={formulaire.fournisseurUrl}
            onChange={(e) => maj("fournisseurUrl", e.target.value)}
            className="w-52"
          />

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
            label="Paye depuis le"
            type="date"
            value={formulaire.debut}
            onChange={(e) => maj("debut", e.target.value)}
            className="w-40"
          />

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
                <th className="py-2 font-medium">Fournisseur</th>
                <th className="py-2 font-medium">Libelle</th>
                <th className="py-2 font-medium">Sites</th>
                <th className="py-2 font-medium">Depuis</th>
                <th className="py-2 font-medium">Echeance</th>
                <th className="py-2 text-right font-medium">Tarif actuel</th>
                <th className="py-2 text-right font-medium">≈ / mois</th>
                <th className="py-2 text-right font-medium">Total paye</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {abonnements.map((a) => {
                const sesTarifs = tarifsDe(a.id);
                const ouvert = historiqueOuvert === a.id;
                return (
                  <Fragment key={a.id}>
                    <tr className={`border-b border-bord/50 ${a.actif ? "" : "opacity-50"}`}>
                      <td className="py-2">
                        <input
                          type="checkbox"
                          checked={Boolean(a.actif)}
                          onChange={() => basculer(a)}
                        />
                      </td>
                      <td className="py-2">
                        <span className="flex items-center gap-2">
                          {a.fournisseur_favicon && (
                            <img
                              src={a.fournisseur_favicon}
                              alt=""
                              className="size-4 rounded"
                              aria-hidden="true"
                            />
                          )}
                          {a.fournisseur_nom ?? "—"}
                        </span>
                      </td>
                      <td className="py-2">{a.libelle}</td>
                      <td className="py-2 text-texte-doux">
                        {a.sites_noms ?? "transverse"}
                        {a.nb_sites > 1 && (
                          <span className="ml-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-[10px]">
                            partage
                          </span>
                        )}
                      </td>
                      <td className="py-2 tabular-nums text-texte-doux">{a.debut ?? "—"}</td>
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
                      <td className="py-2 text-right tabular-nums">
                        {formatMontant(totalPaye(a, sesTarifs, aujourdhui))}
                        <span className="block text-[11px] text-texte-doux">
                          {sesTarifs.length > 1 ? `${sesTarifs.length} tarifs` : ""}
                        </span>
                      </td>
                      <td className="py-2 pl-2 text-right whitespace-nowrap">
                        {a.fournisseur_url && !a.fournisseur_favicon && (
                          <Bouton
                            variante="fantome"
                            className="mr-1 px-1.5 py-1"
                            title="Recuperer l'icone du fournisseur"
                            onClick={() => recupererIconeFournisseur(a)}
                          >
                            <ImageIcon size={14} />
                          </Bouton>
                        )}
                        <Bouton
                          variante="fantome"
                          className="mr-1 px-1.5 py-1"
                          title="Historique des tarifs"
                          onClick={() => setHistoriqueOuvert(ouvert ? null : a.id)}
                        >
                          <History size={14} />
                        </Bouton>
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

                    {ouvert && (
                      <tr className="border-b border-bord/50">
                        <td colSpan={10} className="bg-surface-2/40 px-3 py-3">
                          <p className="mb-2 text-xs font-medium text-texte-doux">
                            Historique des tarifs — chaque ligne s&apos;applique a partir de sa
                            date, les echeances anterieures gardent l&apos;ancien prix
                          </p>
                          <ul className="mb-3 flex flex-col gap-1">
                            {sesTarifs.map((t) => (
                              <li key={t.id} className="flex items-center gap-3 text-sm">
                                <span className="w-24 tabular-nums text-texte-doux">
                                  {t.debut}
                                </span>
                                <span className="tabular-nums">
                                  {formatMontant(t.montant_cents, a.devise)}
                                </span>
                                <Bouton
                                  variante="danger"
                                  className="px-1.5 py-0.5"
                                  title="Supprimer ce tarif"
                                  onClick={() => retirerTarif(a.id, t.id)}
                                >
                                  <Trash2 size={12} />
                                </Bouton>
                              </li>
                            ))}
                          </ul>
                          <div className="flex flex-wrap items-end gap-3">
                            <Champ
                              label="A partir du"
                              type="date"
                              value={nouveauTarif.debut}
                              onChange={(e) =>
                                setNouveauTarif((t) => ({ ...t, debut: e.target.value }))
                              }
                              className="w-40"
                            />
                            <Champ
                              label="Nouveau montant (€)"
                              inputMode="decimal"
                              placeholder="11,00"
                              value={nouveauTarif.montant}
                              onChange={(e) =>
                                setNouveauTarif((t) => ({ ...t, montant: e.target.value }))
                              }
                              className="w-36"
                            />
                            <Bouton onClick={() => enregistrerTarif(a.id)}>
                              Ajouter ce tarif
                            </Bouton>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Carte>
    </div>
  );
}
