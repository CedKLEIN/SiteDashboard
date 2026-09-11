import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
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
import { Bouton, Carte, Champ, EtatVide, Kpi } from "../components/ui";
import {
  basculerCheck,
  creerCheck,
  historiqueSite,
  listerChecks,
  listerDepenses,
  supprimerCheck,
} from "../lib/queries";
import { couleurEtat, etatSite, libelleEtat, tauxDisponibilite } from "../lib/statut";
import { formatMontant } from "../lib/format";

const CHECK_VIDE = { libelle: "", url: "", statutAttendu: "", doitContenir: "" };

function heure(horodatage) {
  return String(horodatage ?? "").slice(11, 16);
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

  const recharger = useCallback(async () => {
    const [c, h, d] = await Promise.all([
      listerChecks(site.id),
      historiqueSite(site.id, 24),
      listerDepenses({ siteId: site.id, limite: 8 }),
    ]);
    setChecks(c);
    setHistorique(h);
    setDepenses(d);
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

    const url = formulaire.url.trim();
    if (!url) {
      setErreur("L'URL est obligatoire.");
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      setErreur("L'URL doit commencer par http:// ou https://");
      return;
    }

    const statut = formulaire.statutAttendu.trim();
    await creerCheck({
      siteId: site.id,
      libelle: formulaire.libelle.trim() || "Check",
      url,
      statutAttendu: statut ? Number(statut) : null,
      doitContenir: formulaire.doitContenir.trim() || null,
    });

    setFormulaire(CHECK_VIDE);
    await recharger();
  }

  async function retirerCheck(id) {
    await supprimerCheck(id);
    await recharger();
  }

  async function basculer(check) {
    await basculerCheck(check.id, !check.actif);
    await recharger();
  }

  const etat = etatSite({
    nb_checks: checks.filter((c) => c.actif).length,
    nb_resultats: checks.filter((c) => c.actif && c.derniere_verif).length,
    nb_ok: checks.filter((c) => c.actif && c.dernier_ok).length,
  });

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
        <Kpi libelle="Checks actifs" valeur={String(checks.filter((c) => c.actif).length)} />
        <Kpi
          libelle="Depenses recentes"
          valeur={formatMontant(depenses.reduce((t, d) => t + d.montant_cents, 0))}
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
        {checks.length === 0 ? (
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
              {checks.map((check) => (
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
                  <td className="py-2">{check.libelle}</td>
                  <td className="max-w-64 truncate py-2 text-texte-doux">{check.url}</td>
                  <td className="py-2">
                    {check.derniere_verif ? (
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2 rounded-full"
                          style={{ background: check.dernier_ok ? "#34d399" : "#f97362" }}
                        />
                        {check.dernier_ok
                          ? `HTTP ${check.dernier_statut}`
                          : (check.derniere_erreur ?? "echec")}
                        <span className="text-texte-doux">a {heure(check.derniere_verif)}</span>
                      </span>
                    ) : (
                      <span className="text-texte-doux">jamais verifie</span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums text-texte-doux">
                    {check.derniere_latence == null ? "—" : `${check.derniere_latence} ms`}
                  </td>
                  <td className="py-2 pl-2 text-right">
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

        <form onSubmit={ajouterCheck} className="mt-4 flex flex-wrap items-end gap-3">
          <Champ
            label="Libelle"
            placeholder="API sante"
            value={formulaire.libelle}
            onChange={(e) => maj("libelle", e.target.value)}
            className="w-40"
          />
          <Champ
            label="URL"
            placeholder="https://..."
            value={formulaire.url}
            onChange={(e) => maj("url", e.target.value)}
            className="min-w-56 flex-1"
          />
          <Champ
            label="Statut attendu"
            placeholder="200"
            inputMode="numeric"
            value={formulaire.statutAttendu}
            onChange={(e) => maj("statutAttendu", e.target.value)}
            className="w-32"
          />
          <Champ
            label="Doit contenir"
            placeholder="texte attendu"
            value={formulaire.doitContenir}
            onChange={(e) => maj("doitContenir", e.target.value)}
            className="w-44"
          />
          <Bouton type="submit">Ajouter un check</Bouton>
        </form>
        {erreur && <p className="mt-2 text-xs text-depense">{erreur}</p>}
      </Carte>

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
                  </span>
                  <span className="tabular-nums">{formatMontant(d.montant_cents, d.devise)}</span>
                </li>
              ))}
            </ul>
          )}
        </Carte>
      </div>
    </div>
  );
}
