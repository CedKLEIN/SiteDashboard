import { useEffect, useState } from "react";
import { Bot, CircleCheck, CircleX, Globe, Plus, TriangleAlert } from "lucide-react";
import { BarresDispo, Bouton, Carte, EtatVide, Monogramme } from "../components/ui";
import { disponibiliteParTranche, listerSites } from "../lib/queries";
import { formatTaux, tauxTranches, tranchesCompletes } from "../lib/tranches";
import { couleurEtat, etatSite } from "../lib/statut";
import { STATUTS_SITE, etatCombine } from "../lib/vueAgents";

/** Tous les sites : suivis en cartes (etat, disponibilite 7 jours, agents), puis ceux qui ne le sont plus. */
export default function ListeSites({ rafraichissement, etats = [], vuesAgents = [], onOuvrirSite, onNouveau }) {
  const [tous, setTous] = useState([]);
  const [dispo, setDispo] = useState([]);

  useEffect(() => {
    let annule = false;
    Promise.all([listerSites(), disponibiliteParTranche({ heures: 168, parJour: true })])
      .then(([s, d]) => {
        if (annule) return;
        setTous(s);
        setDispo(d);
      })
      .catch(() => {});
    return () => {
      annule = true;
    };
  }, [rafraichissement]);

  const nonSuivis = tous.filter((s) => !s.actif);

  return (
    <>
      {etats.length === 0 ? (
        <Carte>
          <EtatVide
            Icone={Globe}
            action={
              <Bouton className="flex items-center gap-1.5" onClick={onNouveau}>
                <Plus size={14} /> Ajouter un site
              </Bouton>
            }
          >
            Aucun site suivi.
          </EtatVide>
        </Carte>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
          {etats.map((site) => {
            const tranches = tranchesCompletes(dispo.filter((d) => d.site_id === site.id), { n: 7, parJour: true });
            const vue = vuesAgents.find((v) => v.siteId === site.id);
            const { etat, libelle } = etatCombine(etatSite(site), vue?.statut);
            const agents = vue ? STATUTS_SITE[vue.statut] : null;
            const IconeEtat = etat === "ok" ? CircleCheck : etat === "ko" ? CircleX : etat === "partiel" ? TriangleAlert : null;
            return (
              <button
                key={site.id}
                type="button"
                onClick={() => onOuvrirSite(site.id)}
                className="flex flex-col gap-4 rounded-2xl bg-surface p-5 text-left ring-1 ring-bord transition hover:ring-accent"
              >
                <div className="flex items-center gap-3">
                  <Monogramme site={site} taille={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold">{site.nom}</p>
                    <p className="truncate text-xs text-pale">{site.url?.replace(/^https?:\/\//, "") ?? "sans URL"}</p>
                  </div>
                  {IconeEtat && <IconeEtat size={20} style={{ color: couleurEtat(etat) }} aria-label={libelle} />}
                </div>
                <BarresDispo tranches={tranches} hauteur="h-8" titre={`Disponibilité de ${site.nom} sur 7 jours`} />
                <div className="flex items-center gap-4 text-xs text-texte-doux">
                  <span>
                    <span className="chiffres font-semibold text-texte">{formatTaux(tauxTranches(tranches))}</span> sur 7 j
                  </span>
                  <span>
                    <span className="chiffres font-semibold text-texte">
                      {site.latence_moyenne != null && etat !== "ko" ? `${Math.round(site.latence_moyenne)} ms` : "—"}
                    </span>
                  </span>
                  <span>
                    {site.nb_resultats > 0 ? `${site.nb_ok} / ${site.nb_resultats} checks OK` : `${site.nb_checks} check(s)`}
                  </span>
                  {agents && (
                    <span className="ml-auto flex items-center gap-1" style={{ color: couleurEtat(agents.etat) }} title={`Agents : ${agents.libelle}`}>
                      <Bot size={14} />
                      {agents.libelle}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          <button
            type="button"
            onClick={onNouveau}
            className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-bord text-[13px] font-medium text-texte-doux transition hover:border-accent hover:text-texte"
          >
            <Plus size={20} />
            Ajouter un site
          </button>
        </div>
      )}

      {nonSuivis.length > 0 && (
        <Carte titre="Non suivis">
          <ul className="flex flex-col divide-y divide-bord/60">
            {nonSuivis.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onOuvrirSite(s.id, "reglages")} className="flex w-full items-center gap-3 py-2.5 text-left text-[13px] opacity-70 hover:opacity-100">
                  <Monogramme site={s} taille={24} />
                  <span className="flex-1">{s.nom}</span>
                  <span className="text-xs text-pale">{s.url?.replace(/^https?:\/\//, "")}</span>
                </button>
              </li>
            ))}
          </ul>
        </Carte>
      )}
    </>
  );
}
