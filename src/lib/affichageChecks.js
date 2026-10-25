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

/**
 * Regroupe les incidents identiques qui se suivent (meme check, meme erreur).
 *
 * Un check en echec pendant dix minutes produisait dix lignes identiques, et
 * noyait les autres incidents. `incidents` est trie du plus recent au plus
 * ancien ; chaque groupe garde son premier et son dernier horodatage.
 */
export function regrouperIncidents(incidents) {
  const groupes = [];
  for (const incident of incidents) {
    const erreur = incident.erreur ?? "echec";
    const dernier = groupes.at(-1);
    if (dernier && dernier.check_libelle === incident.check_libelle && dernier.erreur === erreur) {
      dernier.debut = incident.verifie_le;
      dernier.nombre += 1;
    } else {
      groupes.push({
        check_libelle: incident.check_libelle,
        erreur,
        debut: incident.verifie_le,
        fin: incident.verifie_le,
        nombre: 1,
      });
    }
  }
  return groupes;
}

/** Disponibilite -> ton du KPI : vert a 99 % et plus, orange a 95 %, rouge en dessous. */
export function tonDisponibilite(pourcentage) {
  if (pourcentage == null) return "neutre";
  if (pourcentage >= 99) return "revenu";
  return pourcentage >= 95 ? "alerte" : "depense";
}

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
  if (check.entetes?.length) bouts.push(`${check.entetes.length} en-tête(s)`);
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
    bouts.push(`${check.dernier_ok ? "OK" : "ÉCHEC"} : ${dernierResultat(check)} à ${heure(check.derniere_verif)}`);
  } else {
    bouts.push("jamais vérifié");
  }
  if (check.derniere_latence != null) bouts.push(`${check.derniere_latence} ms`);
  return bouts.join(" — ");
}
