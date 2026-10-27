import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bouton, Champ, Tiroir } from "./ui";
import { creerSite, majFaviconSite } from "../lib/queries";

/** Couleurs proposees a la creation : distinctes, lisibles dans les deux themes. */
const COULEURS = ["#22c55e", "#f59e0b", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6", "#ef4444", "#64748b"];

/** Creation d'un site. Un site avec URL recoit un check d'accueil, puis son icone. */
export default function TiroirSite({ ouvert, onFermer, onCree }) {
  // Monte a chaque ouverture (voir App) : une couleur au hasard, la saisie vierge
  const [formulaire, setFormulaire] = useState(() => ({ nom: "", url: "", couleur: COULEURS[Math.floor(Math.random() * COULEURS.length)] }));
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function enregistrer(e) {
    e?.preventDefault();
    setErreur("");
    const nom = formulaire.nom.trim();
    if (!nom) {
      setErreur("Le nom est obligatoire.");
      return;
    }
    let url = formulaire.url.trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;

    setEnvoi(true);
    let cree;
    try {
      cree = await creerSite({ nom, url, couleur: formulaire.couleur });
    } catch (e2) {
      const message = String(e2?.message ?? e2);
      setErreur(/unique/i.test(message) ? "Un site porte déjà ce nom." : message);
      setEnvoi(false);
      return;
    }
    setEnvoi(false);
    onCree?.(cree?.lastInsertId ?? null);
    onFermer();

    // L'icone arrive apres coup : le site n'attend pas un aller-retour reseau pour exister
    if (url && cree?.lastInsertId) {
      const favicon = await invoke("recuperer_favicon", { url }).catch(() => null);
      if (favicon) {
        await majFaviconSite(cree.lastInsertId, favicon).catch(() => {});
        onCree?.(cree.lastInsertId, { icone: true });
      }
    }
  }

  return (
    <Tiroir
      titre="Nouveau site"
      ouvert={ouvert}
      onFermer={onFermer}
      largeur="w-[420px]"
      pied={
        <>
          <Bouton variante="fantome" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton onClick={enregistrer} disabled={envoi}>
            Créer le site
          </Bouton>
        </>
      }
    >
      <form onSubmit={enregistrer} className="flex flex-col gap-5">
        <Champ label="Nom" placeholder="Denivio" value={formulaire.nom} onChange={(e) => setFormulaire((f) => ({ ...f, nom: e.target.value }))} autoFocus />
        <Champ label="URL" placeholder="https://…" value={formulaire.url} onChange={(e) => setFormulaire((f) => ({ ...f, url: e.target.value }))} />
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-texte-doux">Couleur</span>
          <div className="flex flex-wrap gap-2">
            {COULEURS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Couleur ${c}`}
                aria-pressed={formulaire.couleur === c}
                onClick={() => setFormulaire((f) => ({ ...f, couleur: c }))}
                className={`size-8 rounded-lg transition ${formulaire.couleur === c ? "ring-2 ring-texte ring-offset-2 ring-offset-surface" : ""}`}
                style={{ background: c }}
              />
            ))}
            <input
              type="color"
              value={formulaire.couleur}
              onChange={(e) => setFormulaire((f) => ({ ...f, couleur: e.target.value }))}
              className="h-8 w-10 cursor-pointer rounded-lg bg-surface-2 ring-1 ring-bord"
              aria-label="Autre couleur"
            />
          </div>
        </div>
        <p className="text-xs text-pale">Avec une URL, la page d&apos;accueil est surveillée tout de suite et l&apos;icône du site récupérée.</p>
        {erreur && <p className="rounded-lg bg-ko/10 px-3 py-2 text-xs text-ko">{erreur}</p>}
        <button type="submit" hidden aria-hidden="true" />
      </form>
    </Tiroir>
  );
}
