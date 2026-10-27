import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronLeft, CircleCheck, CircleDashed, CircleX, ExternalLink, ImageIcon, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { Bouton, Carte, Champ, Interrupteur, Monogramme, Onglets } from "../components/ui";
import SanteSite from "../components/SanteSite";
import AgentsDuSite, { PastilleStatut } from "../components/AgentsDuSite";
import ControlesAutomatiques from "../components/ControlesAutomatiques";
import Transactions from "./Transactions";
import { STATUTS_SITE } from "../lib/vueAgents";
import { groupesParSite } from "../lib/reglagesAgents";
import { majFaviconSite, majSite, supprimerSite } from "../lib/queries";
import { choisirImageLocale } from "../lib/icones";
import { couleurEtat, etatSite, teinte } from "../lib/statut";

const LIBELLES_ETAT = {
  ok: "Opérationnel",
  partiel: "Dégradé",
  ko: "Hors ligne",
  inconnu: "Jamais vérifié",
  aucun: "Aucun check",
};
const ICONES_ETAT = { ok: CircleCheck, partiel: TriangleAlert, ko: CircleX };

/** Onglet Reglages du site : identite, suivi, icone, suppression. */
function ReglagesSite({ site, onModification, onSupprime }) {
  const [formulaire, setFormulaire] = useState({ nom: site.nom, url: site.url ?? "", couleur: site.couleur });
  const [message, setMessage] = useState(null);
  const [icone, setIcone] = useState(false);
  const modifie = formulaire.nom !== site.nom || formulaire.url !== (site.url ?? "") || formulaire.couleur !== site.couleur;

  async function agir(action, succes = null) {
    setMessage(null);
    try {
      await action();
      if (succes) setMessage({ ok: true, texte: succes });
      onModification();
    } catch (e) {
      const texte = String(e?.message ?? e);
      setMessage({ ok: false, texte: /unique/i.test(texte) ? "Un site porte déjà ce nom." : texte });
    }
  }

  function enregistrer(e) {
    e.preventDefault();
    if (!formulaire.nom.trim()) {
      setMessage({ ok: false, texte: "Le nom est obligatoire." });
      return;
    }
    agir(() => majSite(site.id, { ...site, nom: formulaire.nom.trim(), url: formulaire.url.trim() || null, couleur: formulaire.couleur }), "Enregistré.");
  }

  async function iconeDepuisLeSite() {
    if (!site.url) {
      setMessage({ ok: false, texte: "Pas d'URL : importe une image à la place." });
      return;
    }
    setIcone(true);
    await agir(async () => {
      const favicon = await invoke("recuperer_favicon", { url: site.url });
      if (!favicon) throw new Error("Aucune icône trouvée sur le site : importe une image à la place.");
      await majFaviconSite(site.id, favicon);
    }, "Icône mise à jour.");
    setIcone(false);
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Carte titre="Identité">
        <form onSubmit={enregistrer} className="flex flex-col gap-4">
          <Champ label="Nom" value={formulaire.nom} onChange={(e) => setFormulaire((f) => ({ ...f, nom: e.target.value }))} />
          <Champ label="URL" placeholder="https://…" value={formulaire.url} onChange={(e) => setFormulaire((f) => ({ ...f, url: e.target.value }))} />
          <label className="flex items-center gap-3">
            <input
              type="color"
              value={formulaire.couleur}
              onChange={(e) => setFormulaire((f) => ({ ...f, couleur: e.target.value }))}
              className="h-9 w-12 cursor-pointer rounded-lg bg-surface-2 ring-1 ring-bord"
              aria-label="Couleur du site"
            />
            <span className="text-xs text-texte-doux">Couleur du site, pour le reconnaître dans les listes et graphes</span>
          </label>
          <div className="flex items-center gap-3">
            <Bouton type="submit" disabled={!modifie}>
              Enregistrer
            </Bouton>
            {message && <span className={`text-xs ${message.ok ? "text-ok" : "text-ko"}`}>{message.texte}</span>}
          </div>
        </form>
      </Carte>

      <div className="flex flex-col gap-5">
        <Carte titre="Icône">
          <div className="flex items-center gap-4">
            <Monogramme site={site} taille={48} />
            <div className="flex flex-wrap gap-2">
              <Bouton variante="fantome" className="flex items-center gap-1.5" disabled={icone} onClick={iconeDepuisLeSite}>
                <RefreshCw size={14} className={icone ? "animate-spin" : ""} />
                Depuis le site
              </Bouton>
              <Bouton
                variante="fantome"
                className="flex items-center gap-1.5"
                onClick={() =>
                  agir(async () => {
                    const image = await choisirImageLocale();
                    if (image) await majFaviconSite(site.id, image);
                  })
                }
              >
                <ImageIcon size={14} />
                Importer une image
              </Bouton>
            </div>
          </div>
        </Carte>

        <Carte titre="Suivi">
          <Interrupteur actif={Boolean(site.actif)} onChanger={(actif) => agir(() => majSite(site.id, { ...site, actif }))}>
            <span className="text-[13px]">Superviser ce site</span>
            <span className="block text-xs text-pale">Un site non suivi n&apos;est plus vérifié et sort de la vue d&apos;ensemble.</span>
          </Interrupteur>
        </Carte>

        <Carte titre="Zone sensible">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-texte-doux">Supprimer le site efface ses checks, son historique, et ses dépenses et revenus.</p>
            <Bouton
              variante="danger"
              className="flex shrink-0 items-center gap-1.5 ring-1 ring-ko/40"
              onClick={() => {
                if (window.confirm(`Supprimer « ${site.nom} » ? Ses dépenses, revenus et checks seront supprimés aussi.`)) {
                  agir(async () => {
                    await supprimerSite(site.id);
                    onSupprime();
                  });
                }
              }}
            >
              <Trash2 size={14} />
              Supprimer le site
            </Bouton>
          </div>
        </Carte>
      </div>
    </div>
  );
}

export default function FicheSite({
  site,
  etat: etatSupervision = null,
  onglet,
  onChangerOnglet,
  onRetour,
  onVerifierMaintenant,
  verificationEnCours,
  rafraichissement,
  vueAgents = null,
  controles = null,
  erreurAgents = null,
  sites = [],
  onModifierTransaction,
  onModification,
}) {
  const etat = etatSupervision ? etatSite(etatSupervision) : "aucun";
  const IconeEtat = ICONES_ETAT[etat] ?? CircleDashed;
  const groupes = useMemo(
    () => groupesParSite(controles?.controles ?? [], sites).filter((g) => g.nom === site.nom),
    [controles?.controles, sites, site.nom],
  );
  const statutAgents = vueAgents ? STATUTS_SITE[vueAgents.statut] : null;
  const aRegarder = vueAgents?.aFaire?.length ?? 0;

  // Revenir en haut en changeant d'onglet ou de site
  useEffect(() => {
    document.querySelector("main")?.scrollTo?.({ top: 0 });
  }, [onglet, site.id]);

  return (
    <>
      <div className="flex items-center gap-4">
        <button type="button" onClick={onRetour} className="grid size-9 place-items-center rounded-lg text-texte-doux ring-1 ring-bord hover:bg-surface-2 hover:text-texte" aria-label="Retour aux sites">
          <ChevronLeft size={16} />
        </button>
        <Monogramme site={site} taille={48} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-[22px] font-semibold tracking-tight">{site.nom}</h1>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ color: couleurEtat(etat), background: teinte(couleurEtat(etat)) }}
            >
              <IconeEtat size={12} strokeWidth={2.5} />
              {site.actif ? LIBELLES_ETAT[etat] : "Non suivi"}
            </span>
          </div>
          {site.url && (
            <button type="button" onClick={() => openUrl(site.url)} className="mt-0.5 flex items-center gap-1 text-[13px] text-texte-doux hover:text-accent-2">
              {site.url.replace(/^https?:\/\//, "")} <ExternalLink size={12} />
            </button>
          )}
        </div>
        <Bouton variante="fantome" onClick={onVerifierMaintenant} disabled={verificationEnCours} className="flex items-center gap-2">
          <RefreshCw size={14} className={verificationEnCours ? "animate-spin" : ""} />
          Vérifier
        </Bouton>
      </div>

      <Onglets
        valeur={onglet}
        onChanger={onChangerOnglet}
        options={[
          { cle: "sante", libelle: "Santé" },
          { cle: "finances", libelle: "Finances" },
          { cle: "agents", libelle: "Agents", compte: aRegarder || vueAgents?.taches?.length || 0, alerte: aRegarder > 0 },
          { cle: "reglages", libelle: "Réglages" },
        ]}
      />

      {onglet === "sante" && <SanteSite key={site.id} site={site} rafraichissement={rafraichissement} />}

      {onglet === "finances" && (
        <Transactions rafraichissement={rafraichissement} sites={sites} siteIdFixe={site.id} onModifier={onModifierTransaction} onModification={onModification} />
      )}

      {onglet === "agents" && (
        <>
          <Carte titre="Aujourd'hui" action={statutAgents && <PastilleStatut etat={statutAgents.etat}>{statutAgents.libelle}</PastilleStatut>}>
            {erreurAgents && <p className="mb-2 text-xs text-ko">Lecture des rapports impossible : {erreurAgents}</p>}
            <AgentsDuSite key={vueAgents?.cle} vue={vueAgents} controles={controles} onEfface={onModification} />
          </Carte>
          {controles && groupes.length > 0 && (
            <Carte titre="Réglages des tâches">
              <ControlesAutomatiques controles={controles} groupes={groupes} />
            </Carte>
          )}
        </>
      )}

      {onglet === "reglages" && <ReglagesSite key={site.id} site={site} onModification={onModification} onSupprime={onRetour} />}
    </>
  );
}
