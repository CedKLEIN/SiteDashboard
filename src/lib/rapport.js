/**
 * Met en forme un diagnostic en texte brut, pret a coller dans un ticket,
 * un message ou un terminal.
 *
 * Le format est volontairement plat: pas de tableau, pas de couleur, rien qui
 * se perde a la copie. Ce qui compte est que l'ordre raconte l'histoire dans le
 * sens du debogage: ce qu'on a demande, ou on a ete redirige, ce qu'on a recu.
 */
export function formaterRapport({ check, inspection, site }) {
  const lignes = [];
  const section = (titre) => lignes.push("", `## ${titre}`);
  const champ = (cle, valeur) => {
    if (valeur !== null && valeur !== undefined && valeur !== "") {
      lignes.push(`${cle}: ${valeur}`);
    }
  };

  lignes.push(`# Diagnostic — ${check.libelle}`);
  champ("Site", site?.nom);
  champ("Genere le", new Date().toISOString());

  section("Check configuré");
  champ("Type", check.type ?? "http");
  champ("URL", check.url);
  champ("Statut attendu", check.statut_attendu ?? "tout succès (2xx)");
  champ("Doit contenir", check.doit_contenir ?? "(rien)");
  champ("Seuil certificat (jours)", check.seuil_jours);
  champ("Actif", check.actif ? "oui" : "non");

  section("Dernier résultat enregistré");
  champ("Horodatage", check.derniere_verif ?? "jamais vérifié");
  if (check.derniere_verif) {
    champ("Verdict", check.dernier_ok ? "OK" : "ÉCHEC");
    champ("Statut HTTP", check.dernier_statut);
    champ("Latence (ms)", check.derniere_latence);
    champ("Jours restants (TLS)", check.derniers_jours);
    champ("Erreur", check.derniere_erreur);
  }

  if (!inspection) {
    lignes.push("", "(aucune inspection à la demande)");
    return lignes.join("\n");
  }

  section("Requête envoyée");
  champ("Méthode", inspection.methode);
  champ("URL", inspection.url_demandee);
  for (const [nom, valeur] of inspection.entetes_requete ?? []) {
    lignes.push(`  ${nom}: ${valeur}`);
  }

  if (inspection.redirections?.length > 0) {
    section("Redirections suivies");
    lignes.push(...inspection.redirections.map((r) => `  ${r}`));
  }

  section("Réponse");
  if (inspection.erreur) {
    champ("Erreur", inspection.erreur);
  }
  champ(
    "Statut",
    inspection.statut && `${inspection.statut} ${inspection.statut_texte ?? ""}`.trim(),
  );
  champ("Version HTTP", inspection.version_http);
  champ("URL finale", inspection.url_finale);
  champ("Durée (ms)", inspection.duree_ms);
  champ("Taille (octets)", inspection.taille);
  if (inspection.entetes_reponse?.length > 0) {
    lignes.push("En-têtes:");
    for (const [nom, valeur] of inspection.entetes_reponse) {
      lignes.push(`  ${nom}: ${valeur}`);
    }
  }

  if (inspection.certificat && !inspection.certificat.erreur) {
    section("Certificat TLS");
    champ("Jours restants", inspection.certificat.jours_restants);
    champ("Expire le", inspection.certificat.expire_le);
    champ("Émetteur", inspection.certificat.emetteur);
  }

  section("Corps de la réponse");
  lignes.push(inspection.extrait || "(vide)");
  if (inspection.tronque) {
    lignes.push("", `(tronqué — taille réelle ${inspection.taille} octets)`);
  }

  return lignes.join("\n");
}
