import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FolderOpen, HardDriveDownload } from "lucide-react";
import { Bouton, BoutonCopier, Carte, Selecteur } from "../components/ui";
import { ecrirePreference, lirePreference } from "../lib/queries";
import {
  JOURS_ENTRE_SAUVEGARDES,
  SAUVEGARDES_GARDEES,
  derniereSauvegarde,
  sauvegarder,
} from "../lib/sauvegarde";
import { JOURS_HISTORIQUE_VERIFICATIONS } from "../lib/monitoring";
import { notificationTest } from "../lib/notifications";
import { CLE_NOTIFICATIONS } from "../lib/useNotifications";
import { tracer } from "../lib/trace";

/** Notifications Windows : activation et essai. */
function Notifications() {
  const [actives, setActives] = useState(true);
  const [essai, setEssai] = useState(null);

  useEffect(() => {
    let annule = false;
    lirePreference(CLE_NOTIFICATIONS, "1").then((v) => {
      if (!annule) setActives(v !== "0");
    });
    return () => {
      annule = true;
    };
  }, []);

  async function basculer(valeur) {
    setActives(valeur);
    await ecrirePreference(CLE_NOTIFICATIONS, valeur ? "1" : "0");
  }

  async function tester() {
    try {
      setEssai((await notificationTest()) ? "envoyee" : "refusee");
    } catch (e) {
      tracer("notification", `essai impossible: ${e}`);
      setEssai("refusee");
    }
  }

  return (
    <Carte titre="Notifications">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={actives} onChange={(e) => basculer(e.target.checked)} />
        Notifier dans Windows quand un site tombe ou revient, et quand un agent est bloque, pas
        lance ou en echec
      </label>
      <p className="mt-2 text-xs text-texte-doux">
        Une seule notification par changement : un site en panne ne sonne pas a chaque minute.
        Comme la supervision, elles ne partent que pendant que l&apos;application est ouverte.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <Bouton variante="fantome" onClick={tester}>
          Envoyer une notification de test
        </Bouton>
        {essai === "envoyee" && <span className="text-xs text-revenu">Envoyee</span>}
        {essai === "refusee" && (
          <span className="text-xs text-depense">
            Refusee par Windows : verifie Parametres &gt; Systeme &gt; Notifications
          </span>
        )}
      </div>
    </Carte>
  );
}

/** '2026-10-25T12:05:00.000Z' -> '25/10/2026 a 14:05' (heure locale) */
function dateLisible(iso) {
  const date = new Date(iso ?? "");
  if (Number.isNaN(date.getTime())) return null;
  return `${date.toLocaleDateString("fr-FR")} a ${date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/** Sauvegardes : derniere copie, dossier, et copie a la demande. */
function Sauvegardes() {
  const [derniere, setDerniere] = useState(null);
  const [dossier, setDossier] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let annule = false;
    Promise.all([derniereSauvegarde(), invoke("dossier_sauvegardes")])
      .then(([date, chemin]) => {
        if (annule) return;
        setDerniere(date);
        setDossier(chemin);
      })
      .catch((e) => tracer("sauvegarde", `lecture impossible: ${e}`));
    return () => {
      annule = true;
    };
  }, []);

  async function sauvegarderMaintenant() {
    setEnCours(true);
    setMessage(null);
    try {
      const chemin = await sauvegarder();
      setDerniere(new Date().toISOString());
      setMessage({ ok: true, texte: `Sauvegarde ecrite : ${chemin}` });
    } catch (e) {
      setMessage({ ok: false, texte: `Sauvegarde impossible : ${e}` });
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mt-4 border-t border-bord/50 pt-3">
      <p className="text-sm font-medium">Sauvegardes automatiques</p>
      <p className="mt-1 text-xs text-texte-doux">
        Une copie de la base tous les {JOURS_ENTRE_SAUVEGARDES} jours, pendant que
        l&apos;application tourne ; les {SAUVEGARDES_GARDEES} plus recentes sont gardees.
        Pour restaurer : ferme l&apos;application et remplace le fichier de la base par une
        sauvegarde renommee <span className="font-mono">sitedashboard.db</span>.
      </p>
      <p className="mt-2 text-xs">
        Derniere sauvegarde :{" "}
        <span className="text-texte">{dateLisible(derniere) ?? "aucune pour l'instant"}</span>
      </p>
      {dossier && (
        <p className="mt-1 flex items-center gap-1 text-[11px] break-all text-texte-doux">
          {dossier}
          <BoutonCopier texte={dossier} titre="Copier le chemin du dossier" />
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Bouton onClick={sauvegarderMaintenant} disabled={enCours}>
          <span className="flex items-center gap-1.5">
            <HardDriveDownload size={14} />
            {enCours ? "Sauvegarde..." : "Sauvegarder maintenant"}
          </span>
        </Bouton>
        {dossier && (
          <Bouton
            variante="fantome"
            onClick={() =>
              revealItemInDir(dossier).catch((e) => tracer("sauvegarde", `ouverture impossible: ${e}`))
            }
          >
            <span className="flex items-center gap-1.5">
              <FolderOpen size={14} />
              Ouvrir le dossier
            </span>
          </Bouton>
        )}
      </div>
      {message && (
        <p className={`mt-2 text-xs break-all ${message.ok ? "text-revenu" : "text-depense"}`}>
          {message.texte}
        </p>
      )}
    </div>
  );
}

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

      <Notifications />

      <Carte titre="Donnees">
        <p className="text-xs text-texte-doux">
          Toutes les donnees vivent dans un seul fichier SQLite ; pour repartir de zero,
          supprime-le et relance l&apos;application.
        </p>
        {cheminBase && (
          <p className="mt-2 flex items-center gap-1 rounded-lg bg-fond px-2.5 py-2 text-[11px] break-all text-texte-doux">
            {cheminBase}
            <BoutonCopier texte={cheminBase} titre="Copier le chemin de la base" />
          </p>
        )}
        <p className="mt-3 text-xs text-texte-doux">
          L&apos;historique de supervision est purge au-dela de {JOURS_HISTORIQUE_VERIFICATIONS}{" "}
          jours.
        </p>
        <Sauvegardes />
      </Carte>
    </div>
  );
}
