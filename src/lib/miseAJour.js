import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tracer } from "./trace";

/** Le depot local ne bouge que quand je commite : inutile de le relire chaque minute. */
export const INTERVALLE_VERIFICATION_MS = 15 * 60 * 1000;

/**
 * Ce que l'ecran doit dire de l'etat renvoye par `etat_mise_a_jour`.
 *
 * Une mise a jour n'est proposee que s'il y a des commits plus recents : des
 * modifications non commitees seules ne declenchent rien (elles seraient
 * compilees aussi, d'ou l'avertissement, mais ce n'est pas une nouvelle version).
 */
export function resumeMiseAJour(etat) {
  if (!etat) return { disponible: false, libelle: "Vérification..." };
  if (etat.erreur) return { disponible: false, libelle: `Vérification impossible : ${etat.erreur}` };
  const n = etat.nouveaux?.length ?? 0;
  if (n === 0) return { disponible: false, libelle: "À jour" };
  // Commits seulement sur le distant : la mise a jour commence par les recuperer
  const distants = etat.a_recuperer ? ` (dont ${etat.a_recuperer} à récupérer)` : "";
  return {
    disponible: true,
    libelle: `${n === 1 ? "1 nouveau commit" : `${n} nouveaux commits`}${distants}`,
  };
}

/** '3b08773fd2...' -> '3b08773' */
export function commitCourt(commit) {
  return commit ? String(commit).slice(0, 7) : "inconnu";
}

/** Etat de mise a jour, relu au montage puis toutes les 15 minutes, et a la demande. */
export function useMiseAJour() {
  const [etat, setEtat] = useState(null);

  const verifier = useCallback(async () => {
    try {
      setEtat(await invoke("etat_mise_a_jour"));
    } catch (e) {
      tracer("mise-a-jour", `verification impossible: ${e}`);
      setEtat({ erreur: String(e), nouveaux: [] });
    }
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    verifier();
    const minuterie = setInterval(verifier, INTERVALLE_VERIFICATION_MS);
    return () => clearInterval(minuterie);
  }, [verifier]);

  return { etat, verifier };
}

/** Lance la mise a jour, sans fenetre ; l'appli sera fermee puis relancee par le script. */
export function lancerMiseAJour() {
  return invoke("lancer_mise_a_jour");
}

/** Fin du journal de la mise a jour en cours (sortie de scripts/installer.mjs). */
export function lireJournalMiseAJour() {
  return invoke("journal_mise_a_jour");
}

/** Ecrit par la commande Rust quand le script echoue (voir mise_a_jour.rs). */
const MARQUE_ECHEC = "MISE_A_JOUR_ECHEC";

/**
 * Ce que l'ecran de mise a jour montre du journal : l'etape en cours (les
 * lignes « ==> ... » de scripts/installer.mjs), et en cas d'echec la fin de la sortie.
 */
export function avancementMiseAJour(journal) {
  const lignes = String(journal ?? "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean);
  const etapes = lignes.filter((l) => l.startsWith("==> ")).map((l) => l.slice(4));
  const echec = lignes.some((l) => l.trim() === MARQUE_ECHEC);
  return {
    etape: etapes.at(-1) ?? "Démarrage",
    echec,
    fin: echec ? lignes.filter((l) => l.trim() !== MARQUE_ECHEC).slice(-25).join("\n") : "",
    cause: echec ? causeProbable(lignes.join("\n")) : null,
  };
}

/**
 * La cause d'un echec en clair, d'apres le journal : la fin n'est souvent
 * qu'une pile Node, la vraie raison est plus haut (message de git, de npm...).
 */
export function causeProbable(journal) {
  const texte = String(journal ?? "");
  if (/would be overwritten by merge|Your local changes/i.test(texte)) {
    return "Des fichiers modifiés sur ce PC bloquent la récupération des commits (git pull).";
  }
  if (/Not possible to fast-forward|diverg/i.test(texte)) {
    return "La branche locale a divergé du dépôt : git pull --ff-only refuse de fusionner.";
  }
  if (/Could not resolve host|unable to access|Authentication failed|could not read Username/i.test(texte)) {
    return "Le dépôt GitHub est injoignable (réseau ou identifiants git).";
  }
  if (/failed to resolve import|Cannot find (package|module)|ERR_MODULE_NOT_FOUND/i.test(texte)) {
    return "Une dépendance npm manque : lance « npm.cmd ci --legacy-peer-deps » dans le dépôt.";
  }
  if (/error\[E\d+\]|could not compile/i.test(texte)) return "La compilation Rust a échoué.";
  if (/npm (ERR|error)/i.test(texte)) return "npm a échoué (installation des dépendances ou build).";
  if (/EBUSY|EPERM|being used by another process/i.test(texte)) {
    return "Un fichier est verrouillé par un autre programme (appli encore ouverte, antivirus…).";
  }
  return null;
}

/** Diagnostic complet (versions, etat du depot, journal entier), pret a coller. */
export function diagnosticMiseAJour() {
  return invoke("diagnostic_mise_a_jour");
}
