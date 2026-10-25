import { useState } from "react";
import { Bouton, Champ, Selecteur } from "./ui";
import { creerCheck } from "../lib/queries";
import { parserRegles, SEUIL_DOMAINE_JOURS } from "../lib/assertions";
import { urlDepuisChemin } from "../lib/checksSuggeres";

const CHECK_VIDE = {
  type: "http",
  libelle: "",
  chemin: "",
  statutAttendu: "",
  doitContenir: "",
  occurrencesMin: "",
  tailleMin: "",
  entetes: "",
  cibleAttendue: "",
  extracteur: "",
  domaine: "",
};

/**
 * Formulaire d'ajout d'un check sur un site. Le chemin se saisit apres l'URL
 * du site ; les champs proposes dependent du type. `onAjoute` est appele une
 * fois le check enregistre.
 */
export default function FormulaireCheck({ site, onAjoute }) {
  const [formulaire, setFormulaire] = useState(CHECK_VIDE);
  const [erreur, setErreur] = useState("");

  function maj(champ, valeur) {
    setFormulaire((f) => ({ ...f, [champ]: valeur }));
  }

  async function ajouterCheck(evenement) {
    evenement.preventDefault();
    setErreur("");

    const { type } = formulaire;

    // L'URL de base vient du site: on ne saisit que ce qui vient apres.
    const url = urlDepuisChemin(site.url, formulaire.chemin);
    if (!url) {
      setErreur(
        site.url
          ? "Chemin invalide."
          : "Ce site n'a pas d'URL : renseigne-la d'abord dans l'onglet « Sites ».",
      );
      return;
    }

    const manquant = {
      redirection: !formulaire.cibleAttendue.trim() && "Indique vers quelle URL rediriger.",
      valeur: !formulaire.extracteur.trim() && "Indique quoi extraire, par exemple json:buildId.",
      domaine: !formulaire.domaine.trim() && "Indique le nom de domaine a surveiller.",
    }[type];
    if (manquant) {
      setErreur(manquant);
      return;
    }

    const entier = (saisie) => (saisie.trim() ? Number(saisie.trim()) : null);
    const siHttp = (valeur) => (type === "http" ? valeur : null);

    try {
      await creerCheck({
        siteId: site.id,
        libelle: formulaire.libelle.trim() || "Check",
        url,
        type,
        statutAttendu:
          type === "http" || type === "redirection" ? entier(formulaire.statutAttendu) : null,
        doitContenir: siHttp(formulaire.doitContenir.trim() || null),
        occurrencesMin: siHttp(entier(formulaire.occurrencesMin)),
        tailleMinOctets: siHttp(entier(formulaire.tailleMin)),
        entetes: type === "http" ? parserRegles(formulaire.entetes) : [],
        cibleAttendue: type === "redirection" ? formulaire.cibleAttendue.trim() : null,
        extracteur: type === "valeur" ? formulaire.extracteur.trim() : null,
        domaine: type === "domaine" ? formulaire.domaine.trim() : null,
        seuilJours: type === "domaine" ? SEUIL_DOMAINE_JOURS : null,
      });
    } catch (e) {
      // creerCheck refuse par exemple un nombre d'occurrences sans fragment:
      // le controle est en base, pas seulement ici.
      setErreur(String(e?.message ?? e));
      return;
    }

    setFormulaire(CHECK_VIDE);
    await onAjoute?.();
  }

  return (
    <>
      <form onSubmit={ajouterCheck} className="mt-4 flex flex-wrap items-end gap-3">
        <Selecteur
          label="Type"
          value={formulaire.type}
          onChange={(e) => maj("type", e.target.value)}
          className="w-36"
        >
          <option value="http">HTTP</option>
          <option value="redirection">Redirection</option>
          <option value="valeur">Valeur</option>
          <option value="domaine">Domaine</option>
        </Selecteur>
        <Champ
          label="Libelle"
          placeholder="API sante"
          value={formulaire.libelle}
          onChange={(e) => maj("libelle", e.target.value)}
          className="w-40"
        />
        <label className="flex min-w-56 flex-1 flex-col gap-1">
          <span className="text-xs text-texte-doux">Chemin</span>
          <span className="flex items-stretch overflow-hidden rounded-lg border border-bord bg-surface-2 focus-within:border-accent">
            <span
              className="flex shrink-0 items-center bg-surface px-2.5 text-sm text-texte-doux"
              title="URL de base du site, non modifiable ici"
            >
              {site.url?.replace(/\/$/, "") ?? "(site sans URL)"}
            </span>
            <input
              placeholder="/api/health"
              value={formulaire.chemin}
              onChange={(e) => maj("chemin", e.target.value)}
              className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-sm text-texte outline-none"
            />
          </span>
        </label>

        {(formulaire.type === "http" || formulaire.type === "redirection") && (
          <Champ
            label="Statut attendu"
            placeholder={formulaire.type === "redirection" ? "301" : "200"}
            inputMode="numeric"
            value={formulaire.statutAttendu}
            onChange={(e) => maj("statutAttendu", e.target.value)}
            className="w-32"
          />
        )}

        {formulaire.type === "http" && (
          <>
            <Champ
              label="Doit contenir"
              placeholder="texte attendu"
              value={formulaire.doitContenir}
              onChange={(e) => maj("doitContenir", e.target.value)}
              className="w-44"
            />
            <Champ
              label="Occurrences min"
              placeholder="1"
              inputMode="numeric"
              title="Nombre minimal d'apparitions du texte attendu"
              value={formulaire.occurrencesMin}
              onChange={(e) => maj("occurrencesMin", e.target.value)}
              className="w-32"
            />
            <Champ
              label="Taille min (octets)"
              placeholder="1024"
              inputMode="numeric"
              title="Taille du corps decode, pas le Content-Length"
              value={formulaire.tailleMin}
              onChange={(e) => maj("tailleMin", e.target.value)}
              className="w-36"
            />
            <label className="flex w-full flex-col gap-1">
              <span className="text-xs text-texte-doux">
                En-tetes attendus — une regle par ligne : <code>nom</code> present,{" "}
                <code>!nom</code> absent, <code>nom: valeur</code> contient,{" "}
                <code>!nom: valeur</code> ne contient pas
              </span>
              <textarea
                rows={3}
                spellCheck={false}
                placeholder={"strict-transport-security\ncontent-security-policy\n!server: /"}
                value={formulaire.entetes}
                onChange={(e) => maj("entetes", e.target.value)}
                className="rounded-lg border border-bord bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-texte outline-none focus:border-accent"
              />
            </label>
          </>
        )}

        {formulaire.type === "redirection" && (
          <Champ
            label="Doit rediriger vers"
            placeholder="https://denivio.fr/"
            value={formulaire.cibleAttendue}
            onChange={(e) => maj("cibleAttendue", e.target.value)}
            className="w-72"
          />
        )}

        {formulaire.type === "valeur" && (
          <Champ
            label="Extracteur"
            placeholder="json:buildId"
            title="json:chemin.pointe ou regex:motif (groupe capturant n.1)"
            value={formulaire.extracteur}
            onChange={(e) => maj("extracteur", e.target.value)}
            className="w-56"
          />
        )}

        {formulaire.type === "domaine" && (
          <>
            <Champ
              label="Domaine"
              placeholder="denivio.fr"
              value={formulaire.domaine}
              onChange={(e) => maj("domaine", e.target.value)}
              className="w-48"
            />
            <Champ
              label="Doit resoudre vers"
              placeholder="51.83.12.4 (facultatif)"
              value={formulaire.cibleAttendue}
              onChange={(e) => maj("cibleAttendue", e.target.value)}
              className="w-56"
            />
          </>
        )}

        <Bouton type="submit">Ajouter un check</Bouton>
      </form>
      {erreur && <p className="mt-2 text-xs text-depense">{erreur}</p>}
    </>
  );
}
