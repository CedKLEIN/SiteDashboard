import { Bot, Play, RefreshCw } from "lucide-react";
import { Bouton, Carte } from "./ui";
import { REGISTRE, horaireLisible } from "../lib/controles";
import { couleurEtat } from "../lib/statut";

const ETATS = { ok: "ok", attention: "partiel", echec: "ko" };
const LIBELLES = { ok: "OK", attention: "à regarder", echec: "en échec" };
const CLAUDE = {
  appele: "analysé par Claude",
  reprise: "analyse précédente reprise",
  erreur: "analyse Claude impossible",
};

function dernierPassage(iso) {
  if (!iso) return "jamais lancé";
  const date = new Date(iso);
  const jour = date.toLocaleDateString("fr-FR");
  const heure = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return jour === new Date().toLocaleDateString("fr-FR") ? `aujourd'hui à ${heure}` : `le ${jour} à ${heure}`;
}

/**
 * Les controles faits par script (dossier controles/) : horaire, dernier
 * passage, et lancement a la demande. Claude n'est appele qu'en cas d'anomalie.
 */
export default function ControlesAutomatiques({ controles }) {
  if (!controles) return null;
  const { derniers, enCours, resultats, lancer } = controles;

  return (
    <Carte>
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Contrôles automatiques</h2>
        <span className="text-[11px] text-texte-doux">
          lancés par SiteDashboard ; Claude n&apos;est appelé qu&apos;en cas d&apos;anomalie
        </span>
      </div>
      <ul className="mt-2 flex flex-col divide-y divide-bord/50">
        {REGISTRE.map((c) => {
          const resultat = resultats[c.id];
          const actif = enCours === c.id;
          return (
            <li key={c.id} className="flex items-center gap-3 py-2">
              <Bot size={16} className="shrink-0 text-texte-doux" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-medium">{c.titre}</span>
                  <span className="ml-2 text-texte-doux">{c.site}</span>
                </p>
                <p className="text-[11px] text-texte-doux">
                  {horaireLisible(c.cron)} · dernier passage {dernierPassage(derniers[c.id])}
                  {resultat && (
                    <>
                      {" · "}
                      <span style={{ color: couleurEtat(ETATS[resultat.statut] ?? "inconnu") }}>
                        {LIBELLES[resultat.statut] ?? resultat.statut}
                      </span>
                      {CLAUDE[resultat.claude] && ` · ${CLAUDE[resultat.claude]}`}
                      {resultat.erreur && ` · ${resultat.erreur}`}
                    </>
                  )}
                </p>
              </div>
              <Bouton
                variante="fantome"
                className="flex shrink-0 items-center gap-1.5 px-2 py-1 text-xs"
                disabled={Boolean(enCours)}
                onClick={() => lancer(c.id)}
                title={enCours && !actif ? "Un autre contrôle tourne" : "Lancer ce contrôle maintenant"}
              >
                {actif ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
                {actif ? "En cours..." : "Lancer maintenant"}
              </Bouton>
            </li>
          );
        })}
      </ul>
    </Carte>
  );
}
