/**
 * Mise en forme d'un check pour l'ecran de detail d'un site : type, ce qu'il
 * verifie, dernier resultat, et une ligne de texte prete a coller.
 */

export const LIBELLES_TYPE = {
  http: "HTTP",
  redirection: "REDIR",
  tls: "TLS",
  domaine: "DNS",
  valeur: "VALEUR",
};

export function heure(horodatage) {
  return String(horodatage ?? "").slice(11, 16);
}

/** Ce que le check verifie, en une ligne, sous son libelle. */
export function resumeAssertions(check) {
  const bouts = [];
  if (check.statut_attendu) bouts.push(`statut ${check.statut_attendu}`);
  if (check.doit_contenir) {
    bouts.push(
      check.occurrences_min > 1
        ? `${check.occurrences_min}x "${check.doit_contenir}"`
        : `contient "${check.doit_contenir}"`,
    );
  }
  if (check.taille_min_octets) bouts.push(`≥ ${check.taille_min_octets} o`);
  if (check.entetes?.length) bouts.push(`${check.entetes.length} en-tete(s)`);
  if (check.cible_attendue) bouts.push(`vers ${check.cible_attendue}`);
  if (check.domaine) bouts.push(check.domaine);
  return bouts.join(" · ");
}

/**
 * Le dernier resultat, en clair.
 *
 * Les types qui n'ont pas de statut HTTP rangent leur message dans `erreur`,
 * y compris quand tout va bien: "valide encore 68 jours" ou "301 vers
 * https://denivio.fr/" est l'information utile, pas un code.
 */
export function dernierResultat(check) {
  if (!check.dernier_ok) return check.derniere_erreur ?? "echec";
  if (check.type === "tls") return `valide encore ${check.derniers_jours} jour(s)`;
  if (check.type === "redirection" || check.type === "domaine") {
    return check.derniere_erreur ?? "OK";
  }
  return `HTTP ${check.dernier_statut}`;
}

/** Un check et son dernier resultat en une ligne, pret a coller. */
export function texteCheck(check) {
  const bouts = [check.libelle, check.url];
  const assertions = resumeAssertions(check);
  if (assertions) bouts.push(assertions);
  if (check.derniere_verif) {
    bouts.push(`${check.dernier_ok ? "OK" : "ECHEC"} : ${dernierResultat(check)} a ${heure(check.derniere_verif)}`);
  } else {
    bouts.push("jamais verifie");
  }
  if (check.derniere_latence != null) bouts.push(`${check.derniere_latence} ms`);
  return bouts.join(" — ");
}
