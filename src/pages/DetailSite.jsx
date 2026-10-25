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
import { Bouton, BoutonCopier, Carte, EtatVide, Kpi } from "../components/ui";
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
import { SEUIL_DOMAINE_JOURS } from "../lib/assertions";
import { suggestionsRestantes } from "../lib/checksSuggeres";
import Diagnostic from "../components/Diagnostic";
import FormulaireCheck from "../components/FormulaireCheck";
import {
  dernierResultat,
  heure,
  LIBELLES_TYPE,
  regrouperIncidents,
  resumeAssertions,
  texteCheck,
  tonDisponibilite,
} from "../lib/affichageChecks";

/** '10:01' ou '09:52 → 10:01' pour un incident regroupe. */
function plageIncident({ debut, fin }) {
  return debut === fin ? heure(fin) : `${heure(debut)} → ${heure(fin)}`;
}
import { dateFr, formatMontant, joursDepuis } from "../lib/format";

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
  const [diagnostic, setDiagnostic] = useState(null);
  const [coutFixe, setCoutFixe] = useState(0);
  const [uniteCout, setUniteCout] = useState("mois");
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);

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

  // Toute la fenetre de 24 h, les echecs identiques consecutifs regroupes
  const incidents = regrouperIncidents(historique.filter((v) => !v.ok).reverse()).slice(0, 8);
  const checksActifs = supervises.filter((c) => c.actif && c.derniere_verif);
  const checksOk = checksActifs.filter((c) => c.dernier_ok).length;

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
          Vérifier maintenant
        </Bouton>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi
          libelle="Disponibilité 24 h"
          valeur={disponibilite == null ? "—" : `${disponibilite.toFixed(1).replace(".", ",")} %`}
          detail={`${historique.length} vérification(s)`}
          ton={tonDisponibilite(disponibilite)}
        />
        <Kpi
          libelle="Latence moyenne"
          valeur={latenceMoyenne == null ? "—" : `${latenceMoyenne} ms`}
        />
        <Kpi
          libelle={
            <span className="flex items-center gap-1.5">
              Coût fixe /
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
          libelle="Checks"
          valeur={checksActifs.length === 0 ? "—" : `${checksOk} / ${checksActifs.length} OK`}
          detail={
            checksActifs.length === 0
              ? "aucun check vérifié"
              : checksOk === checksActifs.length
                ? "tous au vert"
                : `${checksActifs.length - checksOk} en échec`
          }
          ton={checksActifs.length === 0 ? "neutre" : checksOk === checksActifs.length ? "revenu" : "depense"}
        />
      </div>

      <Carte titre="Latence sur 24 h">
        {serie.length === 0 ? (
          <EtatVide>Aucune vérification sur les dernières 24 h.</EtatVide>
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
                <th className="py-2 font-medium">Libellé</th>
                <th className="py-2 font-medium">URL</th>
                <th className="py-2 font-medium">Dernier résultat</th>
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
                        <span className="text-texte-doux">à {heure(check.derniere_verif)}</span>
                      </span>
                    ) : (
                      <span className="text-texte-doux">jamais vérifié</span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums text-texte-doux">
                    {check.derniere_latence == null ? "—" : `${check.derniere_latence} ms`}
                  </td>
                  <td className="py-2 pl-2 text-right whitespace-nowrap">
                    <BoutonCopier
                      texte={() => texteCheck(check)}
                      titre="Copier ce check et son résultat"
                      className="mr-1 align-middle"
                    />
                    <Bouton
                      variante="fantome"
                      className="mr-1 px-1.5 py-1"
                      title="Voir la requête, la réponse et le certificat"
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
              Checks courants à ajouter en un clic :
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
                      contenu vérifié
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 border-t border-bord/50 pt-3">
          {formulaireOuvert ? (
            <FormulaireCheck
              site={site}
              onAjoute={async () => {
                await recharger();
                setFormulaireOuvert(false);
              }}
            />
          ) : (
            <Bouton
              variante="fantome"
              className="flex items-center gap-1.5 text-xs"
              onClick={() => setFormulaireOuvert(true)}
            >
              <Plus size={13} />
              Ajouter un check personnalisé
            </Bouton>
          )}
        </div>
      </Carte>

      {informations.length > 0 && (
        <Carte titre="Informations">
          <p className="mb-3 text-xs text-texte-doux">
            Ces checks n'émettent aucun verdict : un retard de déploiement n'est pas une panne,
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
                      {jours === 0 ? "changé aujourd'hui" : `inchangé depuis ${jours} j`}
                    </span>
                  )}
                  <BoutonCopier
                    texte={() =>
                      `${check.libelle} — ${check.url} — ${check.valeur_courante ?? (check.derniere_erreur || "—")}`
                    }
                    titre="Copier cette information"
                  />
                  <Bouton
                    variante="fantome"
                    className="px-1.5 py-1"
                    title="Voir la requête et la réponse"
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
        <Carte
          titre="Incidents récents"
          action={
            incidents.length > 0 && (
              <BoutonCopier
                texte={() =>
                  incidents
                    .map((i) => `${plageIncident(i)} — ${i.check_libelle} — ${i.erreur}${i.nombre > 1 ? ` (x${i.nombre})` : ""}`)
                    .join("\n")
                }
                titre="Copier les incidents"
              />
            )
          }
        >
          {incidents.length === 0 ? (
            <EtatVide>Aucun incident sur 24 h.</EtatVide>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {incidents.map((incident) => (
                <li key={`${incident.fin}-${incident.check_libelle}`} className="flex items-center gap-2.5">
                  <span className="w-28 shrink-0 tabular-nums text-texte-doux">
                    {plageIncident(incident)}
                  </span>
                  <span className="flex-1 truncate">
                    {incident.check_libelle}
                    {incident.nombre > 1 && (
                      <span className="ml-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-texte-doux">
                        ×{incident.nombre}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs text-depense" title={incident.erreur}>
                    {incident.erreur}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Carte>

        <Carte titre="Dernières dépenses">
          {depenses.length === 0 ? (
            <EtatVide>Aucune dépense pour ce site.</EtatVide>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {depenses.map((d) => (
                <li key={d.id} className="flex items-center gap-2.5">
                  <span className="w-20 shrink-0 tabular-nums text-texte-doux">{dateFr(d.date)}</span>
                  <span className="flex-1 truncate">
                    {d.fournisseur_nom ?? d.libelle ?? d.categorie}
                    {d.nb_sites > 1 && (
                      <span className="text-texte-doux"> · partagée ({d.sites_noms})</span>
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
