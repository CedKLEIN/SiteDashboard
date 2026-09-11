/**
 * Etat de supervision d'un site, deduit du dernier resultat de chacun de ses checks.
 *
 * Un check qui n'a pas encore tourne ne rend pas le site orange: il est juste
 * inconnu. Sans ca, chaque nouveau check ferait clignoter le site en alerte
 * pendant la minute qui precede son premier passage.
 */
export function etatSite({ nb_checks = 0, nb_resultats = 0, nb_ok = 0 } = {}) {
  if (nb_checks === 0) return "aucun";
  if (nb_resultats === 0) return "inconnu";
  if (nb_ok === nb_resultats) return "ok";
  if (nb_ok === 0) return "ko";
  return "partiel";
}

export const ETATS = {
  ok: { libelle: "OK", couleur: "#34d399" },
  partiel: { libelle: "Partiel", couleur: "#fbbf24" },
  ko: { libelle: "KO", couleur: "#f97362" },
  inconnu: { libelle: "Jamais verifie", couleur: "#98a2c4" },
  aucun: { libelle: "Aucun check", couleur: "#3a4570" },
};

export function couleurEtat(etat) {
  return (ETATS[etat] ?? ETATS.inconnu).couleur;
}

export function libelleEtat(etat) {
  return (ETATS[etat] ?? ETATS.inconnu).libelle;
}

/** Pourcentage de checks reussis sur une serie de verifications. */
export function tauxDisponibilite(verifications) {
  if (!verifications || verifications.length === 0) return null;
  const reussis = verifications.filter((v) => v.ok).length;
  return (reussis / verifications.length) * 100;
}
