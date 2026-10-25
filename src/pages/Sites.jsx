import { useEffect, useState } from "react";
import { ExternalLink, ImageIcon, RefreshCw, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Bouton, Carte, Champ, EtatVide, Pastille } from "../components/ui";
import { choisirImageLocale } from "../lib/icones";
import {
  creerSite,
  listerSites,
  majFaviconSite,
  majSite,
  supprimerSite,
} from "../lib/queries";

const FORMULAIRE_VIDE = { nom: "", url: "", couleur: "#6366f1" };

export default function Sites({ onModification }) {
  const [sites, setSites] = useState([]);
  const [formulaire, setFormulaire] = useState(FORMULAIRE_VIDE);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(null);

  async function recharger() {
    setSites(await listerSites());
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

    if (!formulaire.nom.trim()) {
      setErreur("Le nom est obligatoire.");
      return;
    }

    let cree;
    try {
      cree = await creerSite({ ...formulaire, nom: formulaire.nom.trim() });
    } catch {
      // Le seul cas realiste ici est la violation de la contrainte UNIQUE sur le nom
      setErreur("Un site porte déjà ce nom.");
      return;
    }

    const url = formulaire.url.trim();
    setFormulaire(FORMULAIRE_VIDE);
    await recharger();
    onModification?.();

    // L'icone est recuperee apres coup, pas pendant la creation: elle demande un
    // aller-retour reseau, et le site ne doit pas attendre une icone pour
    // apparaitre. Un echec est sans consequence, le bouton d'import reste la.
    if (url && cree?.lastInsertId) {
      setEnCours(cree.lastInsertId);
      try {
        const favicon = await invoke("recuperer_favicon", { url }).catch(() => null);
        if (favicon) {
          await majFaviconSite(cree.lastInsertId, favicon);
          await recharger();
          onModification?.();
        }
      } finally {
        setEnCours(null);
      }
    }
  }

  async function recupererIcone(site) {
    setErreur("");
    if (!site.url) {
      setErreur(`${site.nom} n'a pas d'URL : importe une image a la place.`);
      return;
    }

    setEnCours(site.id);
    try {
      const favicon = await invoke("recuperer_favicon", { url: site.url });
      if (!favicon) {
        setErreur(`Aucune icône trouvée pour ${site.nom} : importe une image a la place.`);
        return;
      }
      await majFaviconSite(site.id, favicon);
      await recharger();
      onModification?.();
    } finally {
      setEnCours(null);
    }
  }

  async function importerIcone(site) {
    setErreur("");
    try {
      const favicon = await choisirImageLocale();
      if (!favicon) return;

      await majFaviconSite(site.id, favicon);
      await recharger();
      onModification?.();
    } catch (e) {
      setErreur(String(e));
    }
  }

  async function basculerActif(site) {
    await majSite(site.id, { ...site, actif: !site.actif });
    await recharger();
    onModification?.();
  }

  async function retirer(site) {
    const confirme = window.confirm(
      `Supprimer « ${site.nom} » ? Ses dépenses et revenus seront supprimés aussi.`,
    );
    if (!confirme) return;
    await supprimerSite(site.id);
    await recharger();
    onModification?.();
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold">Sites</h1>

      <Carte titre="Nouveau site">
        <form onSubmit={enregistrer} className="flex flex-wrap items-end gap-3">
          <Champ
            label="Nom"
            placeholder="Denivio"
            value={formulaire.nom}
            onChange={(e) => maj("nom", e.target.value)}
            className="w-52"
          />
          <Champ
            label="URL"
            placeholder="https://..."
            value={formulaire.url}
            onChange={(e) => maj("url", e.target.value)}
            className="min-w-56 flex-1"
          />
          <Champ
            label="Couleur"
            type="color"
            value={formulaire.couleur}
            onChange={(e) => maj("couleur", e.target.value)}
            className="w-20"
          />
          <Bouton type="submit">Ajouter</Bouton>
        </form>
        {erreur && <p className="mt-2 text-xs text-depense">{erreur}</p>}
      </Carte>

      <Carte titre={`Sites suivis (${sites.length})`}>
        {sites.length === 0 ? (
          <EtatVide>Aucun site. Ajoute le premier ci-dessus.</EtatVide>
        ) : (
          <ul className="flex flex-col divide-y divide-bord/50">
            {sites.map((site) => (
              <li
                key={site.id}
                className={`flex items-center gap-3 py-2.5 ${site.actif ? "" : "opacity-50"}`}
              >
                <label
                  className="flex items-center gap-1.5 text-[11px] text-texte-doux"
                  title="Un site non suivi n'est plus vérifié et sort du tableau de bord"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(site.actif)}
                    onChange={() => basculerActif(site)}
                  />
                  Suivi
                </label>
                {site.favicon ? (
                  <img src={site.favicon} alt="" className="size-5 rounded" aria-hidden="true" />
                ) : (
                  <Pastille couleur={site.couleur} />
                )}
                <span className="font-medium">{site.nom}</span>
                {site.url && (
                  <button
                    type="button"
                    onClick={() => openUrl(site.url)}
                    className="flex items-center gap-1 text-xs text-texte-doux hover:text-accent"
                  >
                    {site.url}
                    <ExternalLink size={12} />
                  </button>
                )}
                <Bouton
                  variante="fantome"
                  className="ml-auto flex items-center gap-1.5 px-2 py-1 text-xs"
                  disabled={enCours === site.id}
                  title="Récupérer l'icône depuis le site"
                  onClick={() => recupererIcone(site)}
                >
                  <RefreshCw size={13} className={enCours === site.id ? "animate-spin" : ""} />
                  Icône depuis le site
                </Bouton>
                <Bouton
                  variante="fantome"
                  className="flex items-center gap-1.5 px-2 py-1 text-xs"
                  title="Choisir une image sur le disque"
                  onClick={() => importerIcone(site)}
                >
                  <ImageIcon size={14} />
                  Importer une image
                </Bouton>
                <Bouton
                  variante="danger"
                  className="px-1.5 py-1"
                  title="Supprimer"
                  onClick={() => retirer(site)}
                >
                  <Trash2 size={14} />
                </Bouton>
              </li>
            ))}
          </ul>
        )}
      </Carte>
    </div>
  );
}
