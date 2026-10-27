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
    fin: echec ? lignes.filter((l) => l.trim() !== MARQUE_ECHEC).slice(-12).join("\n") : "",
  };
}
