import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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
  totauxParMois,
  totauxPeriode,
} from "../lib/queries";
import {
  coutMensuelEquivalent,
  derniersMois,
  formatMontant,
  moisLisible,
} from "../lib/format";

const NB_MOIS = 12;

function bornesMoisCourant(aujourdhui = new Date()) {
  const annee = aujourdhui.getFullYear();
  const mois = String(aujourdhui.getMonth() + 1).padStart(2, "0");
  const dernierJour = new Date(annee, aujourdhui.getMonth() + 1, 0).getDate();
  return [`${annee}-${mois}-01`, `${annee}-${mois}-${dernierJour}`];
}

export default function Dashboard({ rafraichissement, onOuvrirSite }) {
  const [donnees, setDonnees] = useState(null);

  useEffect(() => {
    let annule = false;

    async function charger() {
      const [debut, fin] = bornesMoisCourant();
      const [parMois, mois, parSite, abonnements, echeances, etats] = await Promise.all([
        totauxParMois(NB_MOIS),
        totauxPeriode(debut, fin),
        depensesParSite(debut, fin),
        listerAbonnements(),
        echeancesProches(45),
        etatsDesSites(),
      ]);
      if (!annule) setDonnees({ parMois, mois, parSite, abonnements, echeances, etats });
    }

    charger();
    return () => {
      annule = true;
    };
  }, [rafraichissement]);

  if (!donnees) return <EtatVide>Chargement...</EtatVide>;

  const { parMois, mois, parSite, abonnements, echeances, etats } = donnees;

  // On repart des 12 derniers mois pour afficher aussi les mois sans ecriture
  const parMoisIndexe = new Map(parMois.map((l) => [l.mois, l]));
  const serie = derniersMois(NB_MOIS).map((m) => ({
    mois: moisLisible(m),
    depenses: (parMoisIndexe.get(m)?.depense_cents ?? 0) / 100,
    revenus: (parMoisIndexe.get(m)?.revenu_cents ?? 0) / 100,
  }));

  const recurrentCents = abonnements
    .filter((a) => a.actif)
    .reduce((total, a) => total + coutMensuelEquivalent(a), 0);

  const margeCents = mois.revenusCents - mois.depensesCents;
  const sitesAvecDepenses = parSite.filter((s) => s.total_cents > 0);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold">Tableau de bord</h1>

      {etats.length === 0 ? (
        <Carte>
          <EtatVide>Aucun site actif. Ajoute-en un dans l&apos;onglet « Sites ».</EtatVide>
        </Carte>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
          {etats.map((site) => (
            <CarteSite key={site.id} site={site} onOuvrir={onOuvrirSite} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi
          libelle="Depenses ce mois"
          valeur={formatMontant(mois.depensesCents)}
          ton="depense"
        />
        <Kpi
          libelle="Revenus ce mois"
          valeur={formatMontant(mois.revenusCents)}
          ton="revenu"
        />
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

      <Carte titre={`Depenses et revenus sur ${NB_MOIS} mois`}>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={serie} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid stroke="#2a3358" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="mois" stroke="#98a2c4" fontSize={11} tickLine={false} />
              <YAxis
                stroke="#98a2c4"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={56}
                tickFormatter={(v) => `${v} €`}
              />
              <Tooltip
                contentStyle={{
                  background: "#141a2e",
                  border: "1px solid #2a3358",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v, nom) => [`${v.toFixed(2)} €`, nom]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="depenses" name="Depenses" fill="#f97362" radius={[4, 4, 0, 0]} />
              <Bar dataKey="revenus" name="Revenus" fill="#34d399" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Carte>

      <div className="grid gap-4 lg:grid-cols-2">
        <Carte titre="Depenses du mois par site">
          {sitesAvecDepenses.length === 0 ? (
            <EtatVide>Aucune depense enregistree ce mois-ci.</EtatVide>
          ) : (
            <ul className="flex flex-col gap-2">
              {sitesAvecDepenses.map((site) => (
                <li key={site.id} className="flex items-center gap-2.5 text-sm">
                  <Pastille couleur={site.couleur} />
                  <span className="flex-1 truncate">{site.nom}</span>
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
                    {e.site_nom && (
                      <span className="text-texte-doux"> · {e.site_nom}</span>
                    )}
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
