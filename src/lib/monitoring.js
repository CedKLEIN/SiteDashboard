import { invoke } from "@tauri-apps/api/core";
import { checksActifs, enregistrerVerification } from "./queries";

/**
 * Garde-fou contre le chevauchement: un cycle peut depasser l'intervalle
 * (chaque check a 15 s de timeout), et deux cycles en parallele doubleraient
 * les requetes envoyees aux sites pour rien.
 */
let enCours = false;

/** Execute tous les checks actifs, en serie, et enregistre chaque resultat. */
export async function lancerCycle() {
  if (enCours) return { ignore: true, checks: 0 };
  enCours = true;

  try {
    const checks = await checksActifs();

    // En serie volontairement: on supervise une poignee de sites, et on prefere
    // etaler les requetes plutot que de tout envoyer d'un coup.
    for (const check of checks) {
      try {
        const resultat = await invoke("executer_check", {
          url: check.url,
          statutAttendu: check.statut_attendu ?? null,
          doitContenir: check.doit_contenir ?? null,
        });
        await enregistrerVerification(check.id, resultat);
      } catch (erreur) {
        // Un check qui explose ne doit pas interrompre les suivants
        await enregistrerVerification(check.id, {
          ok: false,
          statut: null,
          latence_ms: null,
          erreur: String(erreur),
        });
      }
    }

    return { ignore: false, checks: checks.length };
  } finally {
    enCours = false;
  }
}
