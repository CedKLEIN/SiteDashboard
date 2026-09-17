import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Bouton, Carte, Champ, EtatVide, Kpi, Selecteur } from "../components/ui";
import {
  basculerCheck,
  coutFixeDuSite,
  creerCheck,
  historiqueSite,
  listerChecks,
  listerDepenses,
  supprimerCheck,
} from "../lib/queries";
import {
  couleurEtat,
  etatSite,
  libelleEtat,
  SEUIL_CERT_JOURS,
  tauxDisponibilite,
} from "../lib/statut";
import { parserRegles, SEUIL_DOMAINE_JOURS } from "../lib/assertions";
import { suggestionsRestantes, urlDepuisChemin } from "../lib/checksSuggeres";
import Diagnostic from "../components/Diagnostic";
import { formatMontant, joursDepuis } from "../lib/format";

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

const LIBELLES_TYPE = {
  http: "HTTP",
  redirection: "REDIR",
  tls: "TLS",
  domaine: "DNS",
  valeur: "VALEUR",
};

function heure(horodatage) {
  return String(horodatage ?? "").slice(11, 16);
}

/** Ce que le check verifie, en une ligne, sous son libelle. */
function resumeAssertions(check) {
  const bouts = [];
  if (check.statut_attendu) bouts.push(`statut ${check.statut_attendu}`);
  if (check.doit_contenir) {
    bouts.push(
      check.occurrences_min > 1
        ? `${check.occurrences_min}x "${check.doit_contenir}"`
        : `contient "${check.doit_contenir}"`,
    );
  }
  if (check.taille_min_octets) bouts.push(`≥ ${check.taille_min_octets} o`);
  if (check.entetes?.length) bouts.push(`${check.entetes.length} en-tete(s)`);
  if (check.cible_attendue) bouts.push(`vers ${check.cible_attendue}`);
  if (check.domaine) bouts.push(check.domaine);
  return bouts.join(" · ");
}

/**
 * Le dernier resultat, en clair.
 *
 * Les types qui n'ont pas de statut HTTP rangent leur message dans `erreur`,
 * y compris quand tout va bien: "valide encore 68 jours" ou "301 vers
 * https://denivio.fr/" est l'information utile, pas un code.
 */
function dernierResultat(check) {
  if (!check.dernier_ok) return check.derniere_erreur ?? "echec";
  if (check.type === "tls") return `valide encore ${check.derniers_jours} jour(s)`;
  if (check.type === "redirection" || check.type === "domaine") {
    return check.derniere_erreur ?? "OK";
  }
  return `HTTP ${check.dernier_statut}`;
}

export default function DetailSite({
  site,
  onRetour,
  onVerifierMaintenant,
  verificationEnCours,
  rafraichissement,
}) {
  const [checks, setChecks] = useState([]);
  const [historique, setHistorique] = useState([]);
  const [depenses, setDepenses] = useState([]);
  const [formulaire, setFormulaire] = useState(CHECK_VIDE);
  const [erreur, setErreur] = useState("");
  const [diagnostic, setDiagnostic] = useState(null);
  const [coutFixe, setCoutFixe] = useState(0);
  const [uniteCout, setUniteCout] = useState("mois");

  const recharger = useCallback(async () => {
    const [c, h, d, fixe] = await Promise.all([
      listerChecks(site.id),
      historiqueSite(site.id, 24),
      listerDepenses({ siteId: site.id, limite: 8 }),
      coutFixeDuSite(site.id),
    ]);
    setChecks(c);
    setHistorique(h);
    setDepenses(d);
    setCoutFixe(fixe);
  }, [site.id]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    recharger();
    // `rafraichissement` bouge a chaque cycle de supervision: sans lui, l'ecran
    // de detail resterait fige sur les resultats affiches a son ouverture.
  }, [recharger, rafraichissement]);

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
    await recharger();
  }

  async function ajouterSuggestion(suggestion) {
    await creerCheck({
      siteId: site.id,
      libelle: suggestion.libelle,
      url: suggestion.url,
      type: suggestion.type,
      doitContenir: suggestion.doitContenir ?? null,
      tailleMinOctets: suggestion.tailleMinOctets ?? null,
      occurrencesMin: suggestion.occurrencesMin ?? null,
      entetes: suggestion.entetes ?? [],
      cibleAttendue: suggestion.cibleAttendue ?? null,
      extracteur: suggestion.extracteur ?? null,
      domaine: suggestion.domaine ?? null,
      seuilJours:
        { tls: SEUIL_CERT_JOURS, domaine: SEUIL_DOMAINE_JOURS }[suggestion.type] ?? null,
    });
    await recharger();
  }

  async function inspecter(check) {
    setDiagnostic({ check, inspection: null, enCours: true });
    try {
      const inspection = await invoke("inspecter_url", { url: check.url });
      setDiagnostic({ check, inspection, enCours: false });
    } catch (e) {
      setDiagnostic({ check, inspection: { erreur: String(e) }, enCours: false });
    }
  }

  async function retirerCheck(id) {
    await supprimerCheck(id);
    await recharger();
  }

  async function basculer(check) {
    await basculerCheck(check.id, !check.actif);
    await recharger();
  }

  // Les checks `valeur` ne rendent aucun verdict: les compter ici diluerait
  // l'etat, exactement comme dans `etatsDesSites`.
  const supervises = checks.filter((c) => c.type !== "valeur");
  const informations = checks.filter((c) => c.type === "valeur");

  const etat = etatSite({
    nb_checks: supervises.filter((c) => c.actif).length,
    nb_resultats: supervises.filter((c) => c.actif && c.derniere_verif).length,
    nb_ok: supervises.filter((c) => c.actif && c.dernier_ok).length,
  });

  const suggestions = suggestionsRestantes(site.url, checks);

  const disponibilite = tauxDisponibilite(historique);
  const latences = historique.filter((v) => v.latence_ms != null);
  const latenceMoyenne =
    latences.length > 0
      ? Math.round(latences.reduce((t, v) => t + v.latence_ms, 0) / latences.length)
      : null;

  const serie = historique.map((v) => ({
    heure: heure(v.verifie_le),
    latence: v.ok ? v.latence_ms : null,
  }));

  const incidents = historique.filter((v) => !v.ok).slice(-10).reverse();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Bouton variante="fantome" onClick={onRetour} className="px-2 py-1.5">
          <ArrowLeft size={15} />
        </Bouton>
        <span className="size-3 rounded-full" style={{ background: couleurEtat(etat) }} />
        <h1 className="text-lg font-semibold">{site.nom}</h1>
        <span className="text-sm text-texte-doux">{libelleEtat(etat)}</span>
        {site.url && (
          <Bouton
            variante="fantome"
            className="flex items-center gap-1.5 text-xs"
            title={`Ouvrir ${site.url} dans le navigateur`}
            onClick={() => openUrl(site.url)}
          >
            <ExternalLink size={13} />
            Ouvrir le site
          </Bouton>
        )}
        <Bouton
          variante="fantome"
          onClick={onVerifierMaintenant}
          disabled={verificationEnCours}
          className="ml-auto flex items-center gap-2"
        >
          <RefreshCw size={14} className={verificationEnCours ? "animate-spin" : ""} />
          Verifier maintenant
        </Bouton>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi
          libelle="Disponibilite 24 h"
          valeur={disponibilite == null ? "—" : `${disponibilite.toFixed(1)} %`}
          detail={`${historique.length} verification(s)`}
          ton={disponibilite != null && disponibilite < 99 ? "depense" : "revenu"}
        />
        <Kpi
          libelle="Latence moyenne"
          valeur={latenceMoyenne == null ? "—" : `${latenceMoyenne} ms`}
        />
        <Kpi
          libelle={
            <span className="flex items-center gap-1.5">
              Cout fixe /
              <button
                type="button"
                onClick={() => setUniteCout(uniteCout === "mois" ? "an" : "mois")}
                className="rounded border border-bord px-1 text-[10px] uppercase hover:border-accent"
                title="Basculer entre mensuel et annuel"
              >
                {uniteCout}
              </button>
            </span>
          }
          valeur={formatMontant(uniteCout === "an" ? coutFixe * 12 : coutFixe)}
          detail="part des abonnements actifs"
          ton="depense"
        />
        <Kpi
          libelle="Depenses recentes"
          valeur={formatMontant(depenses.reduce((t, d) => t + (d.part_cents ?? d.montant_cents), 0))}
          detail={`${depenses.length} derniere(s) ligne(s)`}
          ton="depense"
        />
      </div>

      <Carte titre="Latence sur 24 h">
        {serie.length === 0 ? (
          <EtatVide>Aucune verification sur les dernieres 24 h.</EtatVide>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={serie} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="#2a3358" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="heure" stroke="#98a2c4" fontSize={11} tickLine={false} minTickGap={40} />
                <YAxis
                  stroke="#98a2c4"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={(v) => `${v} ms`}
                />
                <Tooltip
                  contentStyle={{
                    background: "#141a2e",
                    border: "1px solid #2a3358",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v) => [`${v} ms`, "Latence"]}
                />
                <Line
                  type="monotone"
                  dataKey="latence"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Carte>

      <Carte titre="Checks">
        {supervises.length === 0 ? (
          <EtatVide>Aucun check. Ajoute-en un ci-dessous.</EtatVide>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-bord text-left text-xs uppercase text-texte-doux">
                <th className="py-2 font-medium">Actif</th>
                <th className="py-2 font-medium">Libelle</th>
                <th className="py-2 font-medium">URL</th>
                <th className="py-2 font-medium">Dernier resultat</th>
                <th className="py-2 text-right font-medium">Latence</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {supervises.map((check) => (
                <tr
                  key={check.id}
                  className={`border-b border-bord/50 last:border-0 ${check.actif ? "" : "opacity-50"}`}
                >
                  <td className="py-2">
                    <input
                      type="checkbox"
                      checked={Boolean(check.actif)}
                      onChange={() => basculer(check)}
                    />
                  </td>
                  <td className="py-2">
                    {check.libelle}
                    {check.type !== "http" && (
                      <span className="ml-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-texte-doux">
                        {LIBELLES_TYPE[check.type] ?? check.type}
                      </span>
                    )}
                    {resumeAssertions(check) && (
                      <span className="block max-w-72 truncate text-[11px] text-texte-doux">
                        {resumeAssertions(check)}
                      </span>
                    )}
                  </td>
                  <td className="max-w-64 truncate py-2 text-texte-doux">{check.url}</td>
                  <td className="py-2">
                    {check.derniere_verif ? (
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: check.dernier_ok ? "#34d399" : "#f97362" }}
                        />
                        {dernierResultat(check)}
                        <span className="text-texte-doux">a {heure(check.derniere_verif)}</span>
                      </span>
                    ) : (
                      <span className="text-texte-doux">jamais verifie</span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums text-texte-doux">
                    {check.derniere_latence == null ? "—" : `${check.derniere_latence} ms`}
                  </td>
                  <td className="py-2 pl-2 text-right whitespace-nowrap">
                    <Bouton
                      variante="fantome"
                      className="mr-1 px-1.5 py-1"
                      title="Voir la requete, la reponse et le certificat"
                      onClick={() => inspecter(check)}
                    >
                      <Search size={14} />
                    </Bouton>
                    <Bouton
                      variante="danger"
                      className="px-1.5 py-1"
                      title="Supprimer"
                      onClick={() => retirerCheck(check.id)}
                    >
                      <Trash2 size={14} />
                    </Bouton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {diagnostic && (
          <div className="mt-4">
            <Diagnostic
              check={diagnostic.check}
              inspection={diagnostic.inspection}
              site={site}
              enCours={diagnostic.enCours}
              onFermer={() => setDiagnostic(null)}
            />
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="mt-4 border-t border-bord/50 pt-3">
            <p className="mb-2 text-xs text-texte-doux">
              Checks courants a ajouter en un clic :
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s.cle}
                  type="button"
                  onClick={() => ajouterSuggestion(s)}
                  title={`${s.description} — ${s.url}`}
                  className="flex items-center gap-1.5 rounded-lg border border-bord px-2.5 py-1.5 text-xs text-texte-doux transition hover:border-accent hover:text-texte"
                >
                  <Plus size={12} />
                  {s.libelle}
                  {s.doitContenir && (
                    <span className="rounded bg-surface-2 px-1 py-0.5 text-[10px]">
                      contenu verifie
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

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
      </Carte>

      {informations.length > 0 && (
        <Carte titre="Informations">
          <p className="mb-3 text-xs text-texte-doux">
            Ces checks n'emettent aucun verdict : un retard de deploiement n'est pas une panne,
            c'est une information.
          </p>
          <ul className="flex flex-col gap-2 text-sm">
            {informations.map((check) => {
              const jours = joursDepuis(check.valeur_depuis);
              return (
                <li key={check.id} className="flex items-center gap-2.5">
                  <span className="w-40 shrink-0 truncate text-texte-doux">{check.libelle}</span>
                  <span className="flex-1 truncate font-mono text-xs">
                    {check.valeur_courante ?? (check.derniere_erreur || "—")}
                  </span>
                  {check.valeur_depuis && (
                    <span className="shrink-0 text-xs text-texte-doux">
                      {jours === 0 ? "change aujourd'hui" : `inchange depuis ${jours} j`}
                    </span>
                  )}
                  <Bouton
                    variante="fantome"
                    className="px-1.5 py-1"
                    title="Voir la requete et la reponse"
                    onClick={() => inspecter(check)}
                  >
                    <Search size={14} />
                  </Bouton>
                  <Bouton
                    variante="danger"
                    className="px-1.5 py-1"
                    title="Supprimer"
                    onClick={() => retirerCheck(check.id)}
                  >
                    <Trash2 size={14} />
                  </Bouton>
                </li>
              );
            })}
          </ul>
        </Carte>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Carte titre="Incidents recents">
          {incidents.length === 0 ? (
            <EtatVide>Aucun incident sur 24 h.</EtatVide>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {incidents.map((incident, index) => (
                <li key={`${incident.verifie_le}-${index}`} className="flex items-center gap-2.5">
                  <span className="w-12 shrink-0 tabular-nums text-texte-doux">
                    {heure(incident.verifie_le)}
                  </span>
                  <span className="flex-1 truncate">{incident.check_libelle}</span>
                  <span className="truncate text-xs text-depense">
                    {incident.erreur ?? "echec"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Carte>

        <Carte titre="Dernieres depenses">
          {depenses.length === 0 ? (
            <EtatVide>Aucune depense pour ce site.</EtatVide>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {depenses.map((d) => (
                <li key={d.id} className="flex items-center gap-2.5">
                  <span className="w-20 shrink-0 tabular-nums text-texte-doux">{d.date}</span>
                  <span className="flex-1 truncate">
                    {d.fournisseur_nom ?? d.libelle ?? d.categorie}
                    {d.nb_sites > 1 && (
                      <span className="text-texte-doux"> · partagee ({d.sites_noms})</span>
                    )}
                  </span>
                  <span className="tabular-nums">
                    {formatMontant(d.part_cents ?? d.montant_cents, d.devise)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Carte>
      </div>
    </div>
  );
}
