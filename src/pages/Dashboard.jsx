import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Carte, EtatVide, Kpi, Pastille } from "../components/ui";
import CarteSite from "../components/CarteSite";
import {
  depensesParSite,
  echeancesProches,
  etatsDesSites,
  listerAbonnements,
  listerPartsAbonnements,
  listerTarifs,
  premiereDate,
  seriesParMois,
} from "../lib/queries";
import { aujourdhuiIso, formatMontant } from "../lib/format";
import { construireSerie } from "../lib/series";
import { abonnementsParMois, abonnementsParSite, coutMensuelEquivalent } from "../lib/abonnements";
import { bornesPeriode, PERIODES, PERIODE_DEFAUT } from "../lib/periodes";

const COULEURS = {
  depenses: "#f97362",
  abonnements: "#c2410c",
  revenus: "#34d399",
  grille: "#2a3358",
  axe: "#98a2c4",
};

const STYLE_INFOBULLE = {
  background: "#141a2e",
  border: "1px solid #2a3358",
  borderRadius: 8,
  fontSize: 12,
};

function Onglets({ valeur, options, onChanger }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.cle}
          type="button"
          onClick={() => onChanger(o.cle)}
          className={`rounded-lg border px-2.5 py-1 text-xs transition ${
            valeur === o.cle
              ? "border-accent bg-accent/15 text-texte"
              : "border-bord text-texte-doux hover:border-accent"
          }`}
        >
          {o.libelle}
        </button>
      ))}
    </div>
  );
}

export default function Dashboard({ rafraichissement, onOuvrirSite }) {
  const [periode, setPeriode] = useState(PERIODE_DEFAUT);
  const [siteFiltre, setSiteFiltre] = useState(null);
  const [donnees, setDonnees] = useState(null);

  useEffect(() => {
    let annule = false;

    async function charger() {
      const aujourdhui = aujourdhuiIso();
      const { debut, fin } = bornesPeriode(periode, aujourdhui);

      // "Depuis toujours" part de la premiere ecriture connue: sinon le graphe
      // afficherait des siecles de mois vides.
      const debutReel = periode === "toujours" ? ((await premiereDate()) ?? debut) : debut;
      // Inutile d'afficher les mois a venir d'une annee en cours
      const finReelle = fin > aujourdhui ? aujourdhui : fin;

      const [series, parSite, abonnements, tarifs, parts, echeances, etats] = await Promise.all([
        seriesParMois(debutReel, finReelle, siteFiltre),
        depensesParSite(debutReel, finReelle),
        listerAbonnements(),
        listerTarifs(),
        listerPartsAbonnements(),
        echeancesProches(45),
        etatsDesSites(),
      ]);

      if (!annule) {
        setDonnees({
          series,
          parSite,
          abonnements,
          tarifs,
          parts,
          echeances,
          etats,
          debut: debutReel,
          fin: finReelle,
          aujourdhui,
        });
      }
    }

    charger();
    return () => {
      annule = true;
    };
  }, [rafraichissement, periode, siteFiltre]);

  if (!donnees) return <EtatVide>Chargement...</EtatVide>;

  const { series, parSite, abonnements, tarifs, parts, echeances, etats, debut, fin, aujourdhui } =
    donnees;

  // Les abonnements ne vivent pas dans la table depenses: sans cet apport, un an
  // de VPS paye n'apparaitrait nulle part dans les graphes.
  const aboParMois = abonnementsParMois(abonnements, tarifs, aujourdhui, {
    parts,
    siteId: siteFiltre,
  });
  const aboParSite = abonnementsParSite(abonnements, tarifs, parts, debut, fin);

  const { points: serie, totalDepensesCents, totalRevenusCents, totalAbonnementsCents } =
    construireSerie({
      debut,
      fin,
      parMois: new Map(series.map((l) => [l.mois, l])),
      aboParMois,
    });

  const margeCents = totalRevenusCents - totalDepensesCents;

  const recurrentCents = abonnements
    .filter((a) => a.actif)
    .reduce((total, a) => total + coutMensuelEquivalent(a), 0);

  // Meme apport cote repartition par site, sinon un site dont le seul cout est
  // un abonnement partage n'apparaitrait pas du tout.
  const sitesAvecDepenses = parSite
    .map((s) => ({ ...s, total_cents: s.total_cents + (aboParSite.get(s.id) ?? 0) }))
    .filter((s) => s.total_cents > 0)
    .sort((a, b) => b.total_cents - a.total_cents);

  const siteChoisi = etats.find((s) => s.id === siteFiltre);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">
          Tableau de bord
          {siteChoisi && <span className="text-texte-doux"> · {siteChoisi.nom}</span>}
        </h1>
        <Onglets valeur={periode} options={PERIODES} onChanger={setPeriode} />
      </div>

      {etats.length === 0 ? (
        <Carte>
          <EtatVide>Aucun site actif. Ajoute-en un dans l&apos;onglet « Sites ».</EtatVide>
        </Carte>
      ) : (
        <>
          <Onglets
            valeur={siteFiltre ?? "tous"}
            options={[
              { cle: "tous", libelle: "Tous les sites" },
              ...etats.map((s) => ({ cle: s.id, libelle: s.nom })),
            ]}
            onChanger={(cle) => setSiteFiltre(cle === "tous" ? null : cle)}
          />

          {/*
            auto-fit plutot qu'un nombre de colonnes fixe: avec deux sites, les
            cartes occupent toute la largeur au lieu de laisser un grand vide.
          */}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
          >
            {etats.map((site) => (
              <CarteSite key={site.id} site={site} onOuvrir={onOuvrirSite} />
            ))}
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi
          libelle="Depenses"
          valeur={formatMontant(totalDepensesCents)}
          detail={`dont ${formatMontant(totalAbonnementsCents)} d'abonnements`}
          ton="depense"
        />
        <Kpi libelle="Revenus" valeur={formatMontant(totalRevenusCents)} ton="revenu" />
        <Kpi
          libelle="Marge"
          valeur={formatMontant(margeCents)}
          ton={margeCents >= 0 ? "revenu" : "depense"}
        />
        <Kpi
          libelle="Recurrent / mois"
          valeur={formatMontant(recurrentCents)}
          detail={`${abonnements.filter((a) => a.actif).length} abonnement(s) actif(s)`}
        />
      </div>

      <Carte titre="Cumul sur la periode">
        {serie.length === 0 ? (
          <EtatVide>Aucune ecriture sur cette periode.</EtatVide>
        ) : (
          <>
            <p className="mb-2 text-xs text-texte-doux">
              Les deux courbes ne peuvent que monter : ce qui compte est l&apos;ecart entre elles,
              et le moment ou les revenus rattrapent les depenses.
            </p>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={serie} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke={COULEURS.grille} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="mois"
                    stroke={COULEURS.axe}
                    fontSize={11}
                    tickLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    stroke={COULEURS.axe}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={64}
                    tickFormatter={(v) => `${v} €`}
                  />
                  <Tooltip
                    contentStyle={STYLE_INFOBULLE}
                    formatter={(v, nom) => [`${v.toFixed(2)} €`, nom]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="cumulDepenses"
                    name="Depenses cumulees"
                    stroke={COULEURS.depenses}
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="cumulRevenus"
                    name="Revenus cumules"
                    stroke={COULEURS.revenus}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </Carte>

      <Carte titre="Mois par mois">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={serie} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid stroke={COULEURS.grille} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="mois"
                stroke={COULEURS.axe}
                fontSize={11}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                stroke={COULEURS.axe}
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={64}
                tickFormatter={(v) => `${v} €`}
              />
              <Tooltip
                contentStyle={STYLE_INFOBULLE}
                formatter={(v, nom) => [`${v.toFixed(2)} €`, nom]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar
                dataKey="depenses"
                name="Depenses ponctuelles"
                stackId="depenses"
                fill={COULEURS.depenses}
              />
              <Bar
                dataKey="abonnements"
                name="Abonnements"
                stackId="depenses"
                fill={COULEURS.abonnements}
                radius={[4, 4, 0, 0]}
              />
              <Bar dataKey="revenus" name="Revenus" fill={COULEURS.revenus} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Carte>

      <div className="grid gap-4 lg:grid-cols-2">
        <Carte titre="Depenses de la periode par site">
          {sitesAvecDepenses.length === 0 ? (
            <EtatVide>Aucune depense sur cette periode.</EtatVide>
          ) : (
            <ul className="flex flex-col gap-2">
              {sitesAvecDepenses.map((site) => (
                <li key={site.id} className="flex items-center gap-2.5 text-sm">
                  <Pastille couleur={site.couleur} />
                  <button
                    type="button"
                    onClick={() => setSiteFiltre(site.id)}
                    className="flex-1 truncate text-left hover:text-accent"
                    title="Filtrer le tableau de bord sur ce site"
                  >
                    {site.nom}
                  </button>
                  <span className="tabular-nums text-texte-doux">
                    {formatMontant(site.total_cents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Carte>

        <Carte titre="Echeances sous 45 jours">
          {echeances.length === 0 ? (
            <EtatVide>Aucun renouvellement a venir.</EtatVide>
          ) : (
            <ul className="flex flex-col gap-2">
              {echeances.map((e) => (
                <li key={e.id} className="flex items-center gap-2.5 text-sm">
                  <span className="w-20 shrink-0 tabular-nums text-texte-doux">
                    {e.prochaine_echeance}
                  </span>
                  <span className="flex-1 truncate">
                    {e.libelle}
                    {e.sites_noms && <span className="text-texte-doux"> · {e.sites_noms}</span>}
                  </span>
                  <span className="tabular-nums">{formatMontant(e.montant_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Carte>
      </div>
    </div>
  );
}
