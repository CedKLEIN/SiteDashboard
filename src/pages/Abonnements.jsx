import { Fragment, useEffect, useState } from "react";
import { History, Image as ImageIcon, Pencil, Play, Square, Trash2, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Bouton, Carte, Champ, EtatVide, Kpi, Selecteur } from "../components/ui";
import RepartitionSites, { partsCentsDepuisSaisie } from "../components/RepartitionSites";
import HistoriqueTarifs from "../components/HistoriqueTarifs";
import {
  ajouterAbonnement,
  arreterAbonnement,
  reprendreAbonnement,
  majAbonnement,
  partsAbonnement,
  listerAbonnements,
  listerFournisseurs,
  listerSites,
  listerTarifs,
  majFaviconFournisseur,
  supprimerAbonnement,
  trouverOuCreerFournisseur,
} from "../lib/queries";
import { choisirImageLocale } from "../lib/icones";
import { coutMensuelEquivalent, echeanceSuivante, totalPaye } from "../lib/abonnements";
import { aujourdhuiIso, dateFr, formatMontant, parseMontant } from "../lib/format";

// Une fonction et non une constante : l'appli reste ouverte des jours, la date
// du jour doit etre celle du moment ou le formulaire est vide, pas du lancement.
function formulaireVide() {
  return {
    siteIds: [],
    parts: null,
    fournisseur: "",
    fournisseurUrl: "",
    libelle: "",
    montant: "",
    periodicite: "mensuel",
    debut: aujourdhuiIso(),
    fin: "",
    prochaineEcheance: "",
  };
}

export default function Abonnements({ onModification }) {
  const [sites, setSites] = useState([]);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [abonnements, setAbonnements] = useState([]);
  const [tarifs, setTarifs] = useState([]);
  const [formulaire, setFormulaire] = useState(formulaireVide);
  const [erreur, setErreur] = useState("");
  const [historiqueOuvert, setHistoriqueOuvert] = useState(null);
  const [enEdition, setEnEdition] = useState(null);
  const [arretEnCours, setArretEnCours] = useState(null);

  async function recharger() {
    try {
      await chargerTout();
    } catch (e) {
      setErreur(String(e?.message ?? e));
    }
  }

  async function chargerTout() {
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
    // Un site supprime entre-temps laisserait un identifiant invisible dans la
    // selection: on ne peut pas deselectionner une pastille qui n'existe plus.
    setFormulaire((f) => ({
      ...f,
      siteIds: f.siteIds.filter((id) => s.some((site) => site.id === id)),
    }));
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

  async function editer(abonnement) {
    setErreur("");
    let parts;
    try {
      parts = await partsAbonnement(abonnement.id);
    } catch (e) {
      setErreur(String(e?.message ?? e));
      return;
    }
    setEnEdition(abonnement.id);
    setFormulaire({
      siteIds: parts.map((p) => p.site_id),
      // On repart de parts egales: les parts existantes sont deja coherentes, et
      // rouvrir la saisie manuelle a chaque edition serait penible pour rien.
      parts: null,
      fournisseur: abonnement.fournisseur_nom ?? "",
      fournisseurUrl: abonnement.fournisseur_url ?? "",
      libelle: abonnement.libelle,
      montant: ((abonnement.montant_cents ?? 0) / 100).toFixed(2),
      periodicite: abonnement.periodicite,
      debut: abonnement.debut ?? aujourdhuiIso(),
      fin: abonnement.fin ?? "",
      prochaineEcheance: abonnement.prochaine_echeance ?? "",
    });
    globalThis.scrollTo?.({ top: 0, behavior: "smooth" });
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
    if (!formulaire.libelle.trim()) {
      setErreur("Donne un libellé à cet abonnement.");
      return;
    }
    if (!formulaire.debut) {
      setErreur("Indique depuis quand tu paies cet abonnement.");
      return;
    }

    let fournisseurId;
    try {
      fournisseurId = await trouverOuCreerFournisseur(
        formulaire.fournisseur,
        "saas",
        formulaire.fournisseurUrl.trim() || null,
      );

      if (enEdition) {
        // Le montant ne se modifie pas ici: il vit dans l'historique des tarifs,
        // ou une correction garde la trace de ce qui a reellement ete paye.
        await majAbonnement(enEdition, {
          fournisseurId,
          libelle: formulaire.libelle.trim(),
          periodicite: formulaire.periodicite,
          debut: formulaire.debut,
          fin: formulaire.fin || null,
          prochaineEcheance: formulaire.prochaineEcheance || null,
          siteIds: formulaire.siteIds,
          partsCents: partsCentsDepuisSaisie(formulaire.siteIds, formulaire.parts),
        });
        setEnEdition(null);
        setFormulaire(formulaireVide());
        await recharger();
        onModification?.();
        return;
      }

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
    // Une icone manquante n'empeche rien : l'abonnement est deja enregistre.
    const url = formulaire.fournisseurUrl.trim();
    if (fournisseurId && url) {
      const deja = fournisseurs.find((f) => f.id === fournisseurId)?.favicon;
      if (!deja) {
        const favicon = await invoke("recuperer_favicon", { url }).catch(() => null);
        if (favicon) await majFaviconFournisseur(fournisseurId, favicon).catch(() => {});
      }
    }

    setFormulaire(formulaireVide());
    await recharger();
    onModification?.();
  }

  async function iconeFournisseur(abonnement) {
    setErreur("");
    if (!abonnement.fournisseur_id) {
      setErreur(`« ${abonnement.libelle} » n'a pas de fournisseur : renseigne-le d'abord (crayon).`);
      return;
    }

    const favicon = abonnement.fournisseur_url
      ? await invoke("recuperer_favicon", { url: abonnement.fournisseur_url }).catch(() => null)
      : null;

    try {
      const image = favicon ?? (await choisirImageLocale());
      // Selection annulee: on ne touche a rien et on ne crie pas.
      if (!image) return;

      await majFaviconFournisseur(abonnement.fournisseur_id, image);
      await recharger();
      onModification?.();
    } catch (e) {
      setErreur(String(e));
    }
  }

  async function confirmerArret(abonnementId) {
    setErreur("");
    if (!arretEnCours?.date) {
      setErreur("Indique la date d'arrêt.");
      return;
    }
    try {
      await arreterAbonnement(abonnementId, arretEnCours.date);
    } catch (e) {
      setErreur(String(e?.message ?? e));
      return;
    }
    setArretEnCours(null);
    await recharger();
    onModification?.();
  }

  async function reprendre(abonnement) {
    try {
      await reprendreAbonnement(abonnement.id);
    } catch (e) {
      setErreur(String(e?.message ?? e));
      return;
    }
    await recharger();
    onModification?.();
  }

  async function retirer(abonnement) {
    // Supprimer efface aussi tout l'historique de tarifs, donc le « total paye » :
    // pour un abonnement resilie, « Arreter » garde la trace de ce qui a ete paye.
    const confirme = window.confirm(
      `Supprimer « ${abonnement.libelle} » et tout son historique de paiements ?\n\nPour un abonnement résilié, préfère « Arrêter » : les paiements passés restent comptés.`,
    );
    if (!confirme) return;
    try {
      await supprimerAbonnement(abonnement.id);
    } catch (e) {
      setErreur(String(e?.message ?? e));
      return;
    }
    if (enEdition === abonnement.id) annulerEdition();
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
          libelle="Récurrent / mois"
          valeur={formatMontant(totalMensuel)}
          detail={`${actifs.length} actif(s)`}
        />
        <Kpi
          libelle="Récurrent / an"
          valeur={formatMontant(totalMensuel * 12)}
          detail="projection au tarif actuel"
        />
        <Kpi
          libelle="Total déjà payé"
          valeur={formatMontant(totalDepuisToujours)}
          detail="depuis la première échéance"
          ton="depense"
        />
        <Kpi libelle="Abonnements suivis" valeur={String(abonnements.length)} />
      </div>

      <Carte
        titre={enEdition ? "Modifier cet abonnement" : "Nouvel abonnement"}
        action={
          enEdition && (
            <Bouton variante="fantome" className="flex items-center gap-1 px-2 py-1 text-xs" onClick={annulerEdition}>
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
            aideVide="aucun site coché = coût transverse"
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
            label="Libellé"
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
            disabled={Boolean(enEdition)}
            title={
              enEdition
                ? "Le prix se change dans l'historique des tarifs, pour garder trace de ce qui a été payé"
                : undefined
            }
          />

          <Selecteur
            label="Périodicité"
            value={formulaire.periodicite}
            onChange={(e) => maj("periodicite", e.target.value)}
            className="w-32"
          >
            <option value="mensuel">mensuel</option>
            <option value="annuel">annuel</option>
          </Selecteur>

          <Champ
            label="Payé depuis le"
            type="date"
            value={formulaire.debut}
            onChange={(e) => maj("debut", e.target.value)}
            className="w-40"
          />

          <Champ
            label="Prochaine échéance (si autre)"
            type="date"
            value={formulaire.prochaineEcheance}
            onChange={(e) => maj("prochaineEcheance", e.target.value)}
            className="w-40"
          />

          {enEdition && (
            <Champ
              label="Arrêté le"
              type="date"
              value={formulaire.fin}
              onChange={(e) => maj("fin", e.target.value)}
              className="w-40"
              title="Vider ce champ remet l'abonnement en cours"
            />
          )}

          <Bouton type="submit">{enEdition ? "Enregistrer" : "Ajouter"}</Bouton>
        </form>
        {erreur && <p className="mt-2 text-xs text-depense">{erreur}</p>}
      </Carte>

      <Carte titre={`Suivis (${abonnements.length})`}>
        {abonnements.length === 0 ? (
          <EtatVide>Aucun abonnement suivi.</EtatVide>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-bord text-left text-xs whitespace-nowrap uppercase text-texte-doux">
                <th className="py-2 pr-4 font-medium">Abonnement</th>
                <th className="py-2 pr-4 font-medium">Sites</th>
                <th className="py-2 pr-4 font-medium">Période</th>
                <th className="py-2 pr-4 font-medium">Prochaine échéance</th>
                <th className="py-2 pr-4 text-right font-medium">Tarif actuel</th>
                <th className="py-2 pr-4 text-right font-medium">≈ / mois</th>
                <th className="py-2 pr-4 text-right font-medium">Total payé</th>
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
                      <td className="py-2 pr-4">
                        <span className="flex items-center gap-2.5">
                          {a.fournisseur_favicon ? (
                            <img
                              src={a.fournisseur_favicon}
                              alt=""
                              className="size-5 shrink-0 rounded"
                              aria-hidden="true"
                            />
                          ) : (
                            <span
                              className="flex size-5 shrink-0 items-center justify-center rounded bg-accent/20 text-[10px] font-semibold text-accent"
                              aria-hidden="true"
                            >
                              {(a.fournisseur_nom ?? a.libelle).charAt(0).toUpperCase()}
                            </span>
                          )}
                          <span className="min-w-0">
                            <span className="flex items-center gap-2 font-medium text-texte">
                              {a.libelle}
                              {a.fin && (
                                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-normal text-texte-doux">
                                  Arrêté
                                </span>
                              )}
                            </span>
                            <span className="block text-xs text-texte-doux">{a.fournisseur_nom ?? "—"}</span>
                          </span>
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-texte-doux">
                        {a.sites_noms ?? "transverse"}
                        {a.nb_sites > 1 && (
                          <span className="ml-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-[10px]">
                            partagé
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 tabular-nums whitespace-nowrap text-texte-doux">
                        {a.fin
                          ? `${dateFr(a.debut) ?? "?"} → ${dateFr(a.fin)}`
                          : `depuis le ${dateFr(a.debut) ?? "?"}`}
                      </td>
                      <td className="py-2 pr-4 tabular-nums whitespace-nowrap">
                        {dateFr(echeanceSuivante(a, aujourdhui)) ?? (
                          <span className="text-texte-doux">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums whitespace-nowrap">
                        {formatMontant(a.montant_cents, a.devise)}
                        <span className="text-texte-doux">
                          {" "}
                          /{a.periodicite === "annuel" ? "an" : "mois"}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-texte-doux">
                        {formatMontant(coutMensuelEquivalent(a))}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {formatMontant(totalPaye(a, sesTarifs, aujourdhui))}
                        <span className="block text-[11px] text-texte-doux">
                          {sesTarifs.length > 1 ? `${sesTarifs.length} tarifs` : ""}
                        </span>
                      </td>
                      <td className="py-2 pl-2 text-right whitespace-nowrap">
                        {/* Toujours affiche: le bouton servait aussi a REMPLACER
                            une icone mal devinee, et un fournisseur sans URL
                            n'avait aucun moyen d'en recevoir une. */}
                        {a.fin ? (
                          <Bouton
                            variante="fantome"
                            className="mr-1 px-1.5 py-1"
                            title="Reprendre cet abonnement"
                            onClick={() => reprendre(a)}
                          >
                            <Play size={14} />
                          </Bouton>
                        ) : (
                          <Bouton
                            variante="fantome"
                            className="mr-1 px-1.5 py-1"
                            title="Arrêter cet abonnement à une date donnée"
                            onClick={() => setArretEnCours({ id: a.id, date: aujourdhuiIso() })}
                          >
                            <Square size={14} />
                          </Bouton>
                        )}
                        <Bouton
                          variante="fantome"
                          className="mr-1 px-1.5 py-1"
                          title="Icône du fournisseur : cherchée sur son site, sinon à importer"
                          onClick={() => iconeFournisseur(a)}
                        >
                          <ImageIcon size={14} />
                        </Bouton>
                        <Bouton
                          variante="fantome"
                          className="mr-1 px-1.5 py-1"
                          title="Modifier cet abonnement"
                          onClick={() => editer(a)}
                        >
                          <Pencil size={14} />
                        </Bouton>
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
                          onClick={() => retirer(a)}
                        >
                          <Trash2 size={14} />
                        </Bouton>
                      </td>
                    </tr>

                    {arretEnCours?.id === a.id && (
                      <tr className="border-b border-bord/50">
                        <td colSpan={8} className="bg-surface-2/40 px-3 py-3">
                          <div className="flex flex-wrap items-end gap-3">
                            <Champ
                              label="Arrêter à partir du"
                              type="date"
                              value={arretEnCours.date}
                              onChange={(e) =>
                                setArretEnCours((x) => ({ ...x, date: e.target.value }))
                              }
                              className="w-40"
                            />
                            <Bouton onClick={() => confirmerArret(a.id)}>Arrêter</Bouton>
                            <Bouton variante="fantome" onClick={() => setArretEnCours(null)}>
                              Annuler
                            </Bouton>
                            <p className="text-xs text-texte-doux">
                              Les échéances antérieures à cette date restent comptées : ce qui a
                              été payé l&apos;a été.
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}

                    {ouvert && (
                      <tr className="border-b border-bord/50">
                        <td colSpan={8} className="bg-surface-2/40 px-3 py-3">
                          <HistoriqueTarifs
                            abonnement={a}
                            tarifs={sesTarifs}
                            onErreur={setErreur}
                            onModifie={async () => {
                              await recharger();
                              onModification?.();
                            }}
                          />
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
