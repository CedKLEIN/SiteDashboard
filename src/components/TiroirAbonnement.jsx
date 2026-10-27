import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bouton, Champ, Segments, Tiroir } from "./ui";
import RepartitionSites, { partsCentsDepuisSaisie } from "./RepartitionSites";
import {
  ajouterAbonnement,
  listerFournisseurs,
  listerSites,
  majAbonnement,
  majFaviconFournisseur,
  partsAbonnement,
  trouverOuCreerFournisseur,
} from "../lib/queries";
import { aujourdhuiIso, parseMontant } from "../lib/format";

const PERIODICITES = [
  { cle: "mensuel", libelle: "Mensuel" },
  { cle: "annuel", libelle: "Annuel" },
];

// Une fonction et non une constante : la date du jour est celle de l'ouverture
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

/** Creation ou correction d'un abonnement. Le prix d'un abonnement existant vit dans son historique de tarifs. */
export default function TiroirAbonnement({ ouvert, edition = null, onFermer, onEnregistre }) {
  const [sites, setSites] = useState([]);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [formulaire, setFormulaire] = useState(formulaireVide);
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);

  // Monte a chaque ouverture (voir App) : la saisie repart de zero
  useEffect(() => {
    let annule = false;
    (async () => {
      const [s, f] = await Promise.all([listerSites(), listerFournisseurs()]);
      let depart = formulaireVide();
      if (edition) {
        const parts = await partsAbonnement(edition.id);
        depart = {
          siteIds: parts.map((p) => p.site_id),
          // Parts egales a la reouverture : les parts existantes sont deja coherentes
          parts: null,
          fournisseur: edition.fournisseur_nom ?? "",
          fournisseurUrl: edition.fournisseur_url ?? "",
          libelle: edition.libelle,
          montant: ((edition.montant_cents ?? 0) / 100).toFixed(2).replace(".", ","),
          periodicite: edition.periodicite,
          debut: edition.debut ?? aujourdhuiIso(),
          fin: edition.fin ?? "",
          prochaineEcheance: edition.prochaine_echeance ?? "",
        };
      }
      if (annule) return;
      setSites(s.filter((x) => x.actif));
      setFournisseurs(f);
      setFormulaire(depart);
    })().catch((e) => !annule && setErreur(String(e?.message ?? e)));
    return () => {
      annule = true;
    };
  }, [edition]);

  function maj(champ, valeur) {
    setFormulaire((f) => ({ ...f, [champ]: valeur }));
  }

  function basculerSite(id) {
    setFormulaire((f) => ({
      ...f,
      siteIds: f.siteIds.includes(id) ? f.siteIds.filter((x) => x !== id) : [...f.siteIds, id],
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
    if (!formulaire.libelle.trim()) {
      setErreur("Donne un libellé à cet abonnement.");
      return;
    }
    if (!formulaire.debut) {
      setErreur("Indique depuis quand tu paies cet abonnement.");
      return;
    }

    setEnvoi(true);
    let fournisseurId;
    try {
      fournisseurId = await trouverOuCreerFournisseur(formulaire.fournisseur, "saas", formulaire.fournisseurUrl.trim() || null);
      const commun = {
        fournisseurId,
        libelle: formulaire.libelle.trim(),
        periodicite: formulaire.periodicite,
        debut: formulaire.debut,
        prochaineEcheance: formulaire.prochaineEcheance || null,
        siteIds: formulaire.siteIds,
        partsCents: partsCentsDepuisSaisie(formulaire.siteIds, formulaire.parts),
      };
      if (edition) {
        // Le montant ne se modifie pas ici : il vit dans l'historique des tarifs,
        // ou une correction garde la trace de ce qui a reellement ete paye.
        await majAbonnement(edition.id, { ...commun, fin: formulaire.fin || null });
      } else {
        await ajouterAbonnement({ ...commun, montantCents });
      }
    } catch (e) {
      setErreur(String(e?.message ?? e));
      setEnvoi(false);
      return;
    }

    // L'icone est rattachee au fournisseur ; une icone manquante n'empeche rien
    const url = formulaire.fournisseurUrl.trim();
    if (fournisseurId && url && !fournisseurs.find((f) => f.id === fournisseurId)?.favicon) {
      const favicon = await invoke("recuperer_favicon", { url }).catch(() => null);
      if (favicon) await majFaviconFournisseur(fournisseurId, favicon).catch(() => {});
    }
    setEnvoi(false);
    onEnregistre?.();
    onFermer();
  }

  return (
    <Tiroir
      titre={edition ? "Modifier l'abonnement" : "Nouvel abonnement"}
      ouvert={ouvert}
      onFermer={onFermer}
      pied={
        <>
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
        <Champ label="Libellé" placeholder="VPS, nom de domaine…" value={formulaire.libelle} onChange={(e) => maj("libelle", e.target.value)} autoFocus />

        <div className="grid grid-cols-2 gap-3">
          <Champ
            label="Fournisseur"
            list="fournisseurs-abonnement"
            placeholder="OVH, OpenAI…"
            value={formulaire.fournisseur}
            onChange={(e) => maj("fournisseur", e.target.value)}
          />
          <datalist id="fournisseurs-abonnement">
            {fournisseurs.map((f) => (
              <option key={f.id} value={f.nom} />
            ))}
          </datalist>
          <Champ
            label="Site du fournisseur"
            placeholder="https://ovh.com"
            value={formulaire.fournisseurUrl}
            onChange={(e) => maj("fournisseurUrl", e.target.value)}
            title="Sert à récupérer son icône"
          />
        </div>

        <div className="flex items-end gap-3">
          <Champ
            label="Montant (€)"
            inputMode="decimal"
            placeholder="5,99"
            value={formulaire.montant}
            onChange={(e) => maj("montant", e.target.value)}
            disabled={Boolean(edition)}
            title={edition ? "Le prix se change dans l'historique des tarifs, pour garder trace de ce qui a été payé" : undefined}
            className="flex-1"
          />
          <Segments options={PERIODICITES} valeur={formulaire.periodicite} onChanger={(p) => maj("periodicite", p)} className="mb-[3px]" />
        </div>
        {edition && <p className="-mt-3 text-[11px] text-pale">Le prix se change dans « Historique des tarifs ».</p>}

        <div className="grid grid-cols-2 gap-3">
          <Champ label="Payé depuis le" type="date" value={formulaire.debut} onChange={(e) => maj("debut", e.target.value)} />
          <Champ
            label="Prochaine échéance"
            type="date"
            value={formulaire.prochaineEcheance}
            onChange={(e) => maj("prochaineEcheance", e.target.value)}
            title="Seulement si elle ne se déduit pas de la date de premier paiement"
          />
        </div>

        {edition && (
          <Champ
            label="Arrêté le"
            type="date"
            value={formulaire.fin}
            onChange={(e) => maj("fin", e.target.value)}
            title="Vider ce champ remet l'abonnement en cours"
          />
        )}

        <RepartitionSites
          sites={sites}
          selection={formulaire.siteIds}
          onBasculerSite={basculerSite}
          montantCents={parseMontant(formulaire.montant)}
          parts={formulaire.parts}
          onChangerParts={(parts) => maj("parts", parts)}
          aideVide="Aucun site coché : coût transverse"
        />

        {erreur && <p className="rounded-lg bg-ko/10 px-3 py-2 text-xs text-ko">{erreur}</p>}
        <button type="submit" hidden aria-hidden="true" />
      </form>
    </Tiroir>
  );
}
