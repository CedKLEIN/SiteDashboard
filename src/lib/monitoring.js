import { invoke } from "@tauri-apps/api/core";
import { checksActifs, enregistrerVerification } from "./queries";
import { evaluerCertificat } from "./statut";

/**
 * Garde-fou contre le chevauchement: un cycle peut depasser l'intervalle
 * (chaque check a 15 s de timeout), et deux cycles en parallele doubleraient
 * les requetes envoyees aux sites pour rien.
 */
let enCours = false;

/** Lance le bon type de verification et normalise le resultat pour la base. */
async function executer(check) {
  if (check.type === "tls") {
    const brut = await invoke("verifier_certificat", { url: check.url });
    const verdict = evaluerCertificat(brut, check.seuil_jours ?? undefined);
    return {
      ok: verdict.ok,
      statut: null,
      latence_ms: null,
      jours_restants: brut.jours_restants ?? null,
      // On stocke le message meme quand tout va bien: l'ecran de detail affiche
      // "valide encore 68 jours", ce qui est l'information utile ici.
      erreur: verdict.ok ? null : verdict.message,
    };
  }

  return invoke("executer_check", {
    url: check.url,
    statutAttendu: check.statut_attendu ?? null,
    doitContenir: check.doit_contenir ?? null,
  });
}

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
        await enregistrerVerification(check.id, await executer(check));
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
