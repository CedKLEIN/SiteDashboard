import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Download, FolderOpen, HardDriveDownload, RefreshCw } from "lucide-react";
import { commitCourt, lancerMiseAJour, resumeMiseAJour } from "../lib/miseAJour";
import { Bouton, BoutonCopier, Carte, Selecteur } from "../components/ui";
import { ecrirePreference, lirePreference } from "../lib/queries";
import {
  JOURS_ENTRE_SAUVEGARDES,
  SAUVEGARDES_GARDEES,
  derniereSauvegarde,
  sauvegarder,
  verifierEtReparer,
} from "../lib/sauvegarde";
import { JOURS_HISTORIQUE_VERIFICATIONS } from "../lib/monitoring";
import { notificationTest } from "../lib/notifications";
import { CLE_NOTIFICATIONS, notificationsWindows } from "../lib/useNotifications";
import { tracer } from "../lib/trace";

/** Version installee, commits plus recents du depot, et lancement de l'installeur. */
function MiseAJour({ etat, verifier }) {
  const [lancee, setLancee] = useState(false);
  const [erreur, setErreur] = useState(null);
  const resume = resumeMiseAJour(etat);

  async function lancer() {
    setErreur(null);
    try {
      await lancerMiseAJour();
      setLancee(true);
    } catch (e) {
      setErreur(String(e));
    }
  }

  return (
    <Carte
      titre="Mise à jour"
      action={
        <Bouton variante="fantome" className="px-2 py-1 text-xs" onClick={verifier}>
          <span className="flex items-center gap-1.5">
            <RefreshCw size={12} />
            Vérifier
          </span>
        </Bouton>
      }
    >
      <p className="text-xs text-texte-doux">
        Version installée : <span className="font-mono text-texte">{commitCourt(etat?.commit_installe)}</span>
        {etat?.commit_depot && (
          <>
            {" "}
            · dépôt ({etat.branche ?? "?"}) :{" "}
            <span className="font-mono text-texte">{commitCourt(etat.commit_depot)}</span>
          </>
        )}
      </p>
      <p className={`mt-1 text-sm ${resume.disponible ? "text-texte" : "text-texte-doux"}`}>
        {resume.libelle}
      </p>

      {resume.disponible && (
        <ul className="mt-2 flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-lg bg-fond px-2.5 py-2 font-mono text-[11px]">
          {etat.nouveaux.map((ligne) => (
            <li key={ligne} className="truncate" title={ligne}>
              {ligne}
            </li>
          ))}
        </ul>
      )}
      {etat?.modifications_locales > 0 && (
        <p className="mt-2 text-xs text-texte-doux">
          {etat.modifications_locales} fichier(s) modifié(s) non commité(s) dans le dépôt : ils
          seraient compilés aussi.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Bouton onClick={lancer} disabled={!resume.disponible || lancee}>
          <span className="flex items-center gap-1.5">
            <Download size={14} />
            Mettre à jour
          </span>
        </Bouton>
        <p className="text-xs text-texte-doux">
          {lancee
            ? "Mise à jour lancée : suis la console. L'appli va se fermer puis se rouvrir (quelques minutes)."
            : "Compile le dépôt local, ferme l'appli, installe la nouvelle version et la relance."}
        </p>
      </div>
      {erreur && <p className="mt-2 text-xs text-depense">{erreur}</p>}
    </Carte>
  );
}

/**
 * Demarrage avec Windows. La supervision et les taches planifiees ne tournent
 * que si l'appli est ouverte : demarrer avec Windows evite les trous.
 */
function Demarrage() {
  const [actif, setActif] = useState(null);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    let annule = false;
    isEnabled()
      .then((v) => !annule && setActif(v))
      .catch((e) => !annule && setErreur(String(e)));
    return () => {
      annule = true;
    };
  }, []);

  async function basculer(valeur) {
    setErreur(null);
    try {
      await (valeur ? enable() : disable());
      setActif(await isEnabled());
    } catch (e) {
      setErreur(String(e));
    }
  }

  return (
    <Carte titre="Démarrage">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(actif)}
          disabled={actif === null}
          onChange={(e) => basculer(e.target.checked)}
        />
        Démarrer SiteDashboard avec Windows
      </label>
      <p className="mt-2 text-xs text-texte-doux">
        La supervision, les contrôles et les agents ne tournent que pendant que l&apos;application
        est ouverte : la lancer avec Windows évite de rater un passage.
      </p>
      {erreur && <p className="mt-2 text-xs text-depense">{erreur}</p>}
    </Carte>
  );
}

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
      // Windows accepte l'envoi meme quand il a coupe toutes les notifications : on le verifie
      if (!(await notificationsWindows())) setEssai("coupees");
      else setEssai((await notificationTest()) ? "envoyee" : "refusee");
    } catch (e) {
      tracer("notification", `essai impossible: ${e}`);
      setEssai("refusee");
    }
  }

  return (
    <Carte titre="Notifications">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={actives} onChange={(e) => basculer(e.target.checked)} />
        Notifier dans Windows quand un site tombe ou revient, et quand un agent est bloqué, pas
        lancé ou en échec
      </label>
      <p className="mt-2 text-xs text-texte-doux">
        Une seule notification par changement : un site en panne ne sonne pas à chaque minute.
        Comme la supervision, elles ne partent que pendant que l&apos;application est ouverte.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <Bouton variante="fantome" onClick={tester}>
          Envoyer une notification de test
        </Bouton>
        {essai === "envoyee" && <span className="text-xs text-revenu">Envoyée</span>}
        {essai === "coupees" && (
          <span className="text-xs text-depense">
            Non envoyée : les notifications sont coupées pour toutes les applis dans Paramètres &gt;
            Système &gt; Notifications
          </span>
        )}
        {essai === "refusee" && (
          <span className="text-xs text-depense">
            Refusée par Windows : vérifie Paramètres &gt; Système &gt; Notifications
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
      const integrite = await verifierEtReparer();
      const chemin = await sauvegarder();
      setDerniere(new Date().toISOString());
      const etat =
        integrite.etat === "grave"
          ? ` — attention, base abîmée : ${integrite.messages[0]}`
          : integrite.repare
            ? ` — ${integrite.avant} défaut(s) d'index réparé(s) avant la copie`
            : "";
      setMessage({ ok: integrite.etat !== "grave", texte: `Sauvegarde écrite : ${chemin}${etat}` });
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
        l&apos;application tourne ; les {SAUVEGARDES_GARDEES} plus récentes sont gardées.
        Pour restaurer : ferme l&apos;application et remplace le fichier de la base par une
        sauvegarde renommée <span className="font-mono">sitedashboard.db</span>.
      </p>
      <p className="mt-2 text-xs">
        Dernière sauvegarde :{" "}
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

export default function Preferences({ onModification, cheminBase, miseAJour }) {
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
      <h1 className="text-lg font-semibold">Préférences</h1>

      {miseAJour && <MiseAJour etat={miseAJour.etat} verifier={miseAJour.verifier} />}

      <Carte titre="Supervision">
        <div className="flex flex-wrap items-end gap-4">
          <Selecteur
            label="Fréquence de vérification"
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
          {enregistre && <span className="pb-2 text-xs text-revenu">Enregistré</span>}
        </div>

        <p className="mt-3 text-xs text-texte-doux">
          Chaque check actif est rejoué à cette fréquence, soit{" "}
          <span className="text-texte">{parHeure} requête(s) par heure et par check</span>. Une
          fréquence élevée ne détecte pas mieux les pannes durables : elle ne raccourcit que le
          délai avant de les voir, au prix de requêtes supplémentaires sur tes sites.
        </p>
        <p className="mt-1 text-xs text-texte-doux">
          La supervision ne tourne que pendant que l&apos;application est ouverte.
        </p>
      </Carte>

      <Demarrage />

      <Notifications />

      <Carte titre="Données">
        <p className="text-xs text-texte-doux">
          Toutes les données vivent dans un seul fichier SQLite ; pour repartir de zéro,
          supprime-le et relance l&apos;application.
        </p>
        {cheminBase && (
          <p className="mt-2 flex items-center gap-1 rounded-lg bg-fond px-2.5 py-2 text-[11px] break-all text-texte-doux">
            {cheminBase}
            <BoutonCopier texte={cheminBase} titre="Copier le chemin de la base" />
          </p>
        )}
        <p className="mt-3 text-xs text-texte-doux">
          L&apos;historique de supervision est purgé au-delà de {JOURS_HISTORIQUE_VERIFICATIONS}{" "}
          jours.
        </p>
        <Sauvegardes />
      </Carte>
    </div>
  );
}
