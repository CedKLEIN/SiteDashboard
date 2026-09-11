import { useEffect, useState } from "react";
import { Carte, Selecteur } from "../components/ui";
import { ecrirePreference, lirePreference } from "../lib/queries";

export const INTERVALLE_DEFAUT_S = 60;

/**
 * Choix volontairement discrets plutot qu'un champ libre: une valeur de 2 s
 * saisie par megarde enverrait 1800 requetes par heure sur chaque site.
 */
const INTERVALLES = [
  { valeur: 30, libelle: "30 secondes" },
  { valeur: 60, libelle: "1 minute" },
  { valeur: 300, libelle: "5 minutes" },
  { valeur: 900, libelle: "15 minutes" },
  { valeur: 1800, libelle: "30 minutes" },
  { valeur: 3600, libelle: "1 heure" },
];

export default function Preferences({ onModification, cheminBase }) {
  const [intervalle, setIntervalle] = useState(String(INTERVALLE_DEFAUT_S));
  const [enregistre, setEnregistre] = useState(false);

  useEffect(() => {
    let annule = false;
    lirePreference("intervalle_supervision_s", String(INTERVALLE_DEFAUT_S)).then((v) => {
      if (!annule) setIntervalle(v);
    });
    return () => {
      annule = true;
    };
  }, []);

  async function changer(valeur) {
    setIntervalle(valeur);
    await ecrirePreference("intervalle_supervision_s", valeur);
    setEnregistre(true);
    setTimeout(() => setEnregistre(false), 2000);
    // Le cycle de supervision relit l'intervalle: on previent l'application
    onModification?.();
  }

  const parHeure = Math.round(3600 / Number(intervalle));

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold">Preferences</h1>

      <Carte titre="Supervision">
        <div className="flex flex-wrap items-end gap-4">
          <Selecteur
            label="Frequence de verification"
            value={intervalle}
            onChange={(e) => changer(e.target.value)}
            className="w-48"
          >
            {INTERVALLES.map((i) => (
              <option key={i.valeur} value={String(i.valeur)}>
                {i.libelle}
              </option>
            ))}
          </Selecteur>
          {enregistre && <span className="pb-2 text-xs text-revenu">Enregistre</span>}
        </div>

        <p className="mt-3 text-xs text-texte-doux">
          Chaque check actif est rejoue a cette frequence, soit{" "}
          <span className="text-texte">{parHeure} requete(s) par heure et par check</span>. Une
          frequence elevee ne detecte pas mieux les pannes durables : elle ne raccourcit que le
          delai avant de les voir, au prix de requetes supplementaires sur tes sites.
        </p>
        <p className="mt-1 text-xs text-texte-doux">
          La supervision ne tourne que pendant que l&apos;application est ouverte.
        </p>
      </Carte>

      <Carte titre="Donnees">
        <p className="text-xs text-texte-doux">
          Toutes les donnees vivent dans un seul fichier SQLite. Pour sauvegarder, copie-le ;
          pour repartir de zero, supprime-le et relance l&apos;application.
        </p>
        {cheminBase && (
          <p className="mt-2 rounded-lg bg-fond px-2.5 py-2 text-[11px] break-all text-texte-doux">
            {cheminBase}
          </p>
        )}
        <p className="mt-3 text-xs text-texte-doux">
          L&apos;historique de supervision est purge au-dela de 30 jours.
        </p>
      </Carte>
    </div>
  );
}
