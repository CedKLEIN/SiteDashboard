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

/**
 * Chaque etat a une icone en plus de sa couleur.
 *
 * La couleur seule ne suffit pas: elle est deja utilisee pour identifier les
 * sites, et elle ne distingue rien pour un daltonien. L'icone porte donc le
 * sens, la couleur ne fait que le renforcer.
 */
export const ETATS = {
  ok: { libelle: "OK", couleur: "#34d399", icone: "ok" },
  partiel: { libelle: "Partiel", couleur: "#fbbf24", icone: "alerte" },
  ko: { libelle: "KO", couleur: "#f97362", icone: "ko" },
  inconnu: { libelle: "Jamais verifie", couleur: "#98a2c4", icone: "inconnu" },
  aucun: { libelle: "Aucun check", couleur: "#3a4570", icone: "aucun" },
};

export function iconeEtat(etat) {
  return (ETATS[etat] ?? ETATS.inconnu).icone;
}

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

/** Seuil par defaut: 21 jours laissent le temps de reagir sur un cycle Let's Encrypt de 90 jours. */
export const SEUIL_CERT_JOURS = 21;

/**
 * Traduit le resultat brut d'une inspection de certificat en verdict de supervision.
 *
 * Un certificat qui expire dans 10 jours n'est pas encore une panne, mais c'en
 * est une programmee: on le traite comme un echec pour qu'il remonte en orange
 * AVANT que le site tombe, ce qui est tout l'interet de ce check.
 */
export function evaluerCertificat({ jours_restants, erreur } = {}, seuilJours = SEUIL_CERT_JOURS) {
  if (erreur) return { ok: false, message: erreur };
  if (jours_restants == null) return { ok: false, message: "certificat illisible" };
  if (jours_restants < 0) {
    return { ok: false, message: `certificat expire depuis ${-jours_restants} jour(s)` };
  }
  if (jours_restants <= seuilJours) {
    return { ok: false, message: `certificat expire dans ${jours_restants} jour(s)` };
  }
  return { ok: true, message: `valide encore ${jours_restants} jour(s)` };
}
