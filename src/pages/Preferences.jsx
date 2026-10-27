import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Download, FolderOpen, HardDriveDownload, Monitor, Moon, RefreshCw, Sun } from "lucide-react";
import { avancementMiseAJour, commitCourt, lancerMiseAJour, lireJournalMiseAJour, resumeMiseAJour } from "../lib/miseAJour";
import { Bouton, BoutonCopier, Carte, Interrupteur, Segments, Selecteur } from "../components/ui";
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

/** Delai entre deux lectures du journal de mise a jour. */
const LECTURE_JOURNAL_MS = 1500;

/**
 * Plein ecran pendant la mise a jour : l'etape en cours, lue dans le journal
 * du script. La compilation prend quelques minutes, puis le script ferme
 * l'appli, installe et la relance. En cas d'echec, la fin de la sortie.
 */
function EcranMiseAJour({ onFermer }) {
  const [avancement, setAvancement] = useState(() => avancementMiseAJour(""));

  useEffect(() => {
    let annule = false;
    const lire = () =>
      lireJournalMiseAJour()
        .then((journal) => !annule && setAvancement(avancementMiseAJour(journal)))
        .catch((e) => tracer("mise-a-jour", `journal illisible: ${e}`));
    lire();
    const minuterie = setInterval(lire, LECTURE_JOURNAL_MS);
    return () => {
      annule = true;
      clearInterval(minuterie);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-fond/95 p-4" role="dialog" aria-modal="true" aria-label="Mise à jour">
      <div className="flex w-full max-w-lg flex-col items-center gap-4 text-center">
        {avancement.echec ? (
          <>
            <p className="text-base font-semibold text-ko">La mise à jour a échoué</p>
            <pre className="max-h-64 w-full overflow-auto rounded-lg bg-surface p-3 text-left font-mono text-[11px] whitespace-pre-wrap text-texte-doux">
              {avancement.fin}
            </pre>
            <Bouton variante="fantome" onClick={onFermer}>
              Fermer
            </Bouton>
          </>
        ) : (
          <>
            <RefreshCw size={32} className="animate-spin text-accent" aria-hidden="true" />
            <p className="text-base font-semibold">Mise à jour en cours</p>
            <p className="text-sm text-texte-doux">{avancement.etape}</p>
            <p className="text-xs text-texte-doux">L'appli va se fermer puis se rouvrir toute seule.</p>
          </>
        )}
      </div>
    </div>
  );
}

/** Version installee, commits plus recents du depot, et lancement de l'installeur. */
function MiseAJour({ etat, verifier }) {
  const [lancee, setLancee] = useState(false);
  // Retour visible du bouton « Verifier » : sans changement, rien ne bougeait a l'ecran
  const [verification, setVerification] = useState(null);

  async function verifierMaintenant() {
    setVerification("en_cours");
    await verifier();
    setVerification(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
  }
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
        <span className="flex items-center gap-2">
          {verification && verification !== "en_cours" && <span className="text-[11px] text-pale">vérifié à {verification}</span>}
          <Bouton variante="fantome" className="px-2 py-1 text-xs" onClick={verifierMaintenant} disabled={verification === "en_cours"}>
            <span className="flex items-center gap-1.5">
              <RefreshCw size={12} className={verification === "en_cours" ? "animate-spin" : ""} />
              Vérifier
            </span>
          </Bouton>
        </span>
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
      </div>
      {erreur && <p className="mt-2 text-xs text-ko">{erreur}</p>}
      {lancee && <EcranMiseAJour onFermer={() => setLancee(false)} />}
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
      <Interrupteur actif={Boolean(actif)} disabled={actif === null} onChanger={basculer} className="text-sm">
        Démarrer SiteDashboard avec Windows
      </Interrupteur>
      <p className="mt-2 text-xs text-texte-doux">
        La supervision, les contrôles et les agents ne tournent que pendant que l&apos;application
        est ouverte : la lancer avec Windows évite de rater un passage.
      </p>
      {erreur && <p className="mt-2 text-xs text-ko">{erreur}</p>}
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
      <Interrupteur actif={actives} onChanger={basculer} className="text-sm">
        Notifier dans Windows quand un site tombe ou revient, et quand un agent est bloqué, pas
        lancé ou en échec
      </Interrupteur>
      <p className="mt-2 text-xs text-texte-doux">
        Une seule notification par changement : un site en panne ne sonne pas à chaque minute.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <Bouton variante="fantome" onClick={tester}>
          Envoyer une notification de test
        </Bouton>
        {essai === "envoyee" && <span className="text-xs text-ok">Envoyée</span>}
        {essai === "coupees" && (
          <span className="text-xs text-ko">
            Non envoyée : les notifications sont coupées pour toutes les applis dans Paramètres &gt;
            Système &gt; Notifications
          </span>
        )}
        {essai === "refusee" && (
          <span className="text-xs text-ko">
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
        <p className={`mt-2 text-xs break-all ${message.ok ? "text-ok" : "text-ko"}`}>
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

const THEMES = [
  { cle: "systeme", libelle: "Système", Icone: Monitor },
  { cle: "sombre", libelle: "Sombre", Icone: Moon },
  { cle: "clair", libelle: "Clair", Icone: Sun },
];

export default function Preferences({ onModification, cheminBase, miseAJour, theme = "systeme", onChangerTheme }) {
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
    <div className="grid gap-5 xl:grid-cols-2">
      <div className="flex flex-col gap-5">
      {miseAJour && <MiseAJour etat={miseAJour.etat} verifier={miseAJour.verifier} />}

      {onChangerTheme && (
        <Carte titre="Apparence">
          <Segments options={THEMES} valeur={theme} onChanger={onChangerTheme} taille="text-[13px]" />
          <p className="mt-3 text-xs text-texte-doux">« Système » suit le thème clair ou sombre de Windows.</p>
        </Carte>
      )}

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
          {enregistre && <span className="pb-2 text-xs text-ok">Enregistré</span>}
        </div>

        <p className="mt-3 text-xs text-texte-doux">
          Chaque check actif est rejoué à cette fréquence, soit{" "}
          <span className="text-texte">{parHeure} requête(s) par heure et par check</span>.
        </p>
      </Carte>

      <Demarrage />
      </div>

      <div className="flex flex-col gap-5">
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
    </div>
  );
}
