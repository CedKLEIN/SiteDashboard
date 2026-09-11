import { useEffect, useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Bouton, Carte, Champ, EtatVide, Pastille } from "../components/ui";
import { creerSite, listerSites, majSite, supprimerSite } from "../lib/queries";

const FORMULAIRE_VIDE = { nom: "", url: "", couleur: "#6366f1" };

export default function Sites({ onModification }) {
  const [sites, setSites] = useState([]);
  const [formulaire, setFormulaire] = useState(FORMULAIRE_VIDE);
  const [erreur, setErreur] = useState("");

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

    try {
      await creerSite({ ...formulaire, nom: formulaire.nom.trim() });
    } catch {
      // Le seul cas realiste ici est la violation de la contrainte UNIQUE sur le nom
      setErreur("Un site porte deja ce nom.");
      return;
    }

    setFormulaire(FORMULAIRE_VIDE);
    await recharger();
    onModification?.();
  }

  async function basculerActif(site) {
    await majSite(site.id, { ...site, actif: !site.actif });
    await recharger();
    onModification?.();
  }

  async function retirer(site) {
    const confirme = window.confirm(
      `Supprimer « ${site.nom} » ? Ses depenses et revenus seront supprimes aussi.`,
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
                <input
                  type="checkbox"
                  checked={Boolean(site.actif)}
                  onChange={() => basculerActif(site)}
                  title="Site actif"
                />
                <Pastille couleur={site.couleur} />
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
                  variante="danger"
                  className="ml-auto px-1.5 py-1"
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
