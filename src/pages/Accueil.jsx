import { useEffect, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  CircleCheck,
  CircleX,
  Globe,
  Repeat,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { BarresDispo, Carte, EtatVide, Kpi, Monogramme, Segments } from "../components/ui";
import ListeATraiter from "../components/ListeATraiter";
import { chargerBilan, ecart } from "../lib/bilan";
import { disponibiliteParTranche, echeancesProches, ecrirePreference, lirePreference } from "../lib/queries";
import { formatMontant } from "../lib/format";
import { PERIODE_DEFAUT } from "../lib/periodes";
import { CLE_PERIODE, periodeValide } from "../lib/preferencesTableau";
import { coutMensuelEquivalent } from "../lib/abonnements";
import { formatTaux, tauxTranches, tranchesCompletes } from "../lib/tranches";
import { quandEcheance } from "../lib/aTraiter";
import { couleurEtat, etatSite } from "../lib/statut";
import { etatCombine } from "../lib/vueAgents";
import { formatAxe, formatInfobulle, STYLE_INFOBULLE } from "../lib/graphes";

export const PERIODES_COURTES = [
  { cle: "mois", libelle: "Mois" },
  { cle: "annee", libelle: "Année" },
  { cle: "12mois", libelle: "12 mois" },
  { cle: "annee_precedente", libelle: "N-1" },
  { cle: "toujours", libelle: "Tout" },
];


/** Courbe d'un indicateur : un point par mois, seulement s'il y en a au moins deux. */
function points(serie, cle) {
  return serie.length > 1 ? serie.map((p) => p[cle]) : null;
}

/** Ecart avec la meme periode un an plus tot ; une hausse des couts n'est pas « bonne ». */
function comparaison({ actuel, reference, hausseBonne }) {
  const texte = ecart(actuel, reference);
  if (!texte) return null;
  return { delta: texte, bon: (actuel >= reference) === hausseBonne };
}

function CarteSite({ site, statutAgents, tranches, onOuvrir }) {
  const { etat, libelle } = etatCombine(etatSite(site), statutAgents);
  const taux = tauxTranches(tranches);
  const probleme = etat === "partiel" || etat === "ko";
  return (
    <button
      type="button"
      onClick={() => onOuvrir(site.id)}
      title={`${site.nom} — ${libelle}`}
      className={`rounded-2xl bg-surface p-4 text-left ring-1 transition hover:ring-accent ${probleme ? "ring-alerte/40" : "ring-bord"}`}
    >
      <div className="flex items-center gap-3">
        <Monogramme site={site} taille={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{site.nom}</p>
          <p className="truncate text-[11px] text-pale">{site.url?.replace(/^https?:\/\//, "") ?? "sans URL"}</p>
        </div>
        {etat === "ok" ? (
          <CircleCheck size={18} style={{ color: couleurEtat(etat) }} aria-label={libelle} />
        ) : etat === "ko" ? (
          <CircleX size={18} style={{ color: couleurEtat(etat) }} aria-label={libelle} />
        ) : etat === "partiel" ? (
          <TriangleAlert size={18} style={{ color: couleurEtat(etat) }} aria-label={libelle} />
        ) : null}
      </div>
      <div className="mt-4">
        <BarresDispo tranches={tranches} titre={`Disponibilité de ${site.nom} sur 24 h`} />
      </div>
      <div className="mt-2.5 flex justify-between text-[11px] text-texte-doux">
        <span className="chiffres">{formatTaux(taux)}</span>
        <span className="chiffres">
          {site.latence_moyenne != null && etat !== "ko" ? `${Math.round(site.latence_moyenne)} ms` : "—"}
        </span>
      </div>
    </button>
  );
}

export default function Accueil({ rafraichissement, sites, vuesAgents = [], aTraiter, onOuvrirCible, onOuvrirSite, onNaviguer }) {
  const [periode, setPeriode] = useState(null);
  const [bilan, setBilan] = useState(null);
  const [dispo, setDispo] = useState([]);
  const [echeances, setEcheances] = useState([]);

  // La periode est memorisee : on la relit avant le premier chargement, sinon
  // le tableau s'afficherait sur la periode par defaut puis sauterait.
  useEffect(() => {
    lirePreference(CLE_PERIODE, PERIODE_DEFAUT)
      .then((p) => setPeriode(periodeValide(p)))
      .catch(() => setPeriode(PERIODE_DEFAUT));
  }, []);

  useEffect(() => {
    if (!periode) return undefined;
    let annule = false;
    Promise.all([chargerBilan({ periode }), disponibiliteParTranche({ heures: 24 }), echeancesProches(31)])
      .then(([b, d, e]) => {
        if (annule) return;
        setBilan(b);
        setDispo(d);
        setEcheances(e);
      })
      .catch(() => {});
    return () => {
      annule = true;
    };
  }, [periode, rafraichissement]);

  function changerPeriode(cle) {
    setPeriode(cle);
    ecrirePreference(CLE_PERIODE, cle).catch(() => {});
  }

  if (!bilan) return <EtatVide>Chargement…</EtatVide>;

  const { totaux, precedent, points: serie, parSite, abonnements } = bilan;
  const actifs = abonnements.filter((a) => a.actif);
  const recurrent = actifs.reduce((t, a) => t + coutMensuelEquivalent(a), 0);
  const nomsSites = new Map(sites.map((s) => [s.id, s]));
  const rentabilite = parSite
    .filter((s) => nomsSites.has(s.id) && (s.revenus || s.couts))
    .sort((a, b) => b.marge - a.marge);
  const echelle = Math.max(1, ...rentabilite.map((s) => Math.abs(s.marge)));

  return (
    <>
      {sites.length === 0 ? (
        <Carte>
          <EtatVide Icone={Globe}>Aucun site suivi : ajoute le premier avec « Nouveau ».</EtatVide>
        </Carte>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}>
          {sites.map((s) => (
            <CarteSite
              key={s.id}
              site={s}
              statutAgents={vuesAgents.find((v) => v.siteId === s.id)?.statut}
              tranches={tranchesCompletes(dispo.filter((d) => d.site_id === s.id), { n: 24 })}
              onOuvrir={onOuvrirSite}
            />
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi
          libelle="Revenus"
          valeur={formatMontant(totaux.revenus)}
          ton="revenu"
          Icone={ArrowDownRight}
          points={points(serie, "revenus")}
          detail={precedent ? "vs N-1" : null}
          {...comparaison({ actuel: totaux.revenus, reference: precedent?.revenus, hausseBonne: true })}
        />
        <Kpi
          libelle="Dépenses"
          valeur={formatMontant(totaux.depenses)}
          ton="depense"
          Icone={ArrowUpRight}
          points={serie.length > 1 ? serie.map((p) => p.depenses + p.abonnements) : null}
          detail={precedent ? "vs N-1" : `dont ${formatMontant(totaux.abonnements)} d'abonnements`}
          {...comparaison({ actuel: totaux.depenses, reference: precedent?.depenses, hausseBonne: false })}
        />
        <Kpi
          libelle="Marge"
          valeur={formatMontant(totaux.marge)}
          ton={totaux.marge >= 0 ? "revenu" : "depense"}
          valeurColoree
          Icone={Wallet}
          points={points(serie, "marge")}
          detail={precedent ? "vs N-1" : null}
          {...comparaison({ actuel: totaux.marge, reference: precedent?.marge, hausseBonne: true })}
        />
        <Kpi
          libelle="Récurrent / mois"
          valeur={formatMontant(recurrent)}
          ton="abonnement"
          Icone={Repeat}
          detail={`${actifs.length} abonnement(s) actif(s)`}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Carte
          className="xl:col-span-2"
          titre="Flux mensuels"
          action={<Segments options={PERIODES_COURTES} valeur={periode} onChanger={changerPeriode} />}
        >
          {serie.length === 0 ? (
            <EtatVide>Aucune écriture sur cette période.</EtatVide>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap gap-4 text-[11px] text-texte-doux">
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-revenu" />Revenus</span>
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-depense" />Dépenses</span>
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-abonnement" />Abonnements</span>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-texte" />Marge cumulée</span>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={serie} stackOffset="sign" margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--color-bord)" vertical={false} />
                    <XAxis dataKey="mois" stroke="var(--color-pale)" fontSize={11} tickLine={false} axisLine={false} minTickGap={16} />
                    <YAxis stroke="var(--color-pale)" fontSize={11} tickLine={false} axisLine={false} width={60} tickFormatter={formatAxe} />
                    <Tooltip contentStyle={STYLE_INFOBULLE} cursor={{ fill: "var(--color-surface-2)" }} formatter={formatInfobulle} />
                    <Bar dataKey="revenus" name="Revenus" stackId="flux" fill="var(--color-revenu)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                    <Bar dataKey="sortiesPonctuelles" name="Dépenses" stackId="flux" fill="var(--color-depense)" maxBarSize={22} />
                    <Bar dataKey="sortiesAbonnements" name="Abonnements" stackId="flux" fill="var(--color-abonnement)" radius={[0, 0, 4, 4]} maxBarSize={22} />
                    <Line dataKey="marge" name="Marge cumulée" stroke="var(--color-texte)" strokeWidth={2} dot={false} type="monotone" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </Carte>

        <Carte
          titre="À traiter"
          action={aTraiter.length > 0 && <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-texte-doux">{aTraiter.length}</span>}
        >
          <ListeATraiter liste={aTraiter} onOuvrirCible={onOuvrirCible} className="max-h-80" />
        </Carte>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Carte
          className="xl:col-span-2"
          titre="Rentabilité par site"
          action={
            <button type="button" onClick={() => onNaviguer("finances")} className="flex items-center gap-1 text-xs font-medium text-texte-doux hover:text-texte">
              Finances <ChevronRight size={13} />
            </button>
          }
        >
          {rentabilite.length === 0 ? (
            <EtatVide>Aucune écriture rattachée à un site sur cette période.</EtatVide>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] text-pale">
                  <th className="pb-2 font-medium">Site</th>
                  <th className="pb-2 text-right font-medium">Revenus</th>
                  <th className="pb-2 text-right font-medium">Coûts</th>
                  <th className="pb-2 pl-6 font-medium">Marge</th>
                </tr>
              </thead>
              <tbody>
                {rentabilite.map((s) => (
                  <tr key={s.id} className="cursor-pointer border-t border-bord/70 hover:bg-surface-2/50" onClick={() => onOuvrirSite(s.id, "finances")}>
                    <td className="py-2.5">
                      <span className="flex items-center gap-2.5">
                        <Monogramme site={nomsSites.get(s.id)} taille={24} />
                        {s.nom}
                      </span>
                    </td>
                    <td className="chiffres py-2.5 text-right text-texte-doux">{formatMontant(s.revenus)}</td>
                    <td className="chiffres py-2.5 text-right text-texte-doux">{formatMontant(s.couts)}</td>
                    <td className="py-2.5 pl-6">
                      <span className="flex items-center justify-end gap-3">
                        <span className="relative h-1.5 w-28 rounded-full bg-surface-3" aria-hidden="true">
                          <span
                            className={`absolute inset-y-0 rounded-full ${s.marge >= 0 ? "left-1/2 bg-revenu" : "right-1/2 bg-depense"}`}
                            style={{ width: `${(Math.abs(s.marge) / echelle) * 50}%` }}
                          />
                        </span>
                        <span className={`chiffres w-24 text-right font-medium ${s.marge >= 0 ? "text-revenu" : "text-depense"}`}>
                          {s.marge > 0 ? "+" : ""}
                          {formatMontant(s.marge)}
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Carte>

        <Carte
          titre="Prochains prélèvements"
          action={
            <button
              type="button"
              onClick={() => onNaviguer("finances", { onglet: "abonnements" })}
              className="flex items-center gap-1 text-xs font-medium text-texte-doux hover:text-texte"
            >
              Abonnements <ChevronRight size={13} />
            </button>
          }
        >
          {echeances.length === 0 ? (
            <EtatVide>Aucun prélèvement dans le mois.</EtatVide>
          ) : (
            <ul className="flex flex-col gap-3">
              {echeances.slice(0, 5).map((e) => (
                <li key={e.id} className="flex items-center gap-3 text-[13px]">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-abonnement/12 text-xs font-semibold text-abonnement">
                    {(e.fournisseur_nom ?? e.libelle).charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{e.libelle}</span>
                    <span className="block truncate text-[11px] text-pale">{e.fournisseur_nom ?? "—"}</span>
                  </span>
                  <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-texte-doux">
                    {quandEcheance(e.prochaine_echeance, bilan.aujourdhui)}
                  </span>
                  <span className="chiffres w-20 text-right font-medium">{formatMontant(e.montant_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Carte>
      </div>
    </>
  );
}
