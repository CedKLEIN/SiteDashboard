//! Rapports des agents planifies et taches planifiees de Claude, lus sur le disque.

use tauri::Manager;

/// Un rapport d'agent depasse rarement quelques Ko: au-dela, c'est un fichier
/// qui n'a rien a faire la, et le lire bloquerait l'ecran pour rien.
pub(crate) const TAILLE_MAX_RAPPORT: u64 = 256 * 1024;

#[derive(serde::Serialize, Default)]
pub struct FichierRapport {
    chemin: String,
    contenu: Option<String>,
    erreur: Option<String>,
}

#[derive(serde::Serialize, Default)]
pub struct DossierRapports {
    dossier: String,
    existe: bool,
    fichiers: Vec<FichierRapport>,
}

/// Dossier commun ou les agents planifies deposent leurs rapports:
/// `~/.claude/rapports-agents/<site>/<AAAA-MM-JJ>/<agent>.json`.
pub(crate) fn dossier_rapports(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(home.join(".claude").join("rapports-agents"))
}

/// Les sous-dossiers d'un dossier, tries par nom. Un dossier illisible est
/// traite comme vide: un site sans rapport ne doit pas faire echouer les autres.
pub(crate) fn sous_dossiers(dossier: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut liste: Vec<_> = std::fs::read_dir(dossier)
        .map(|entrees| {
            entrees
                .filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect()
        })
        .unwrap_or_default();
    liste.sort();
    liste
}

/// Lit les rapports d'agents depuis `depuis` (date ISO incluse).
///
/// Rust constate, JS juge: on renvoie le texte brut de chaque fichier, et c'est
/// `src/lib/rapportsAgents.js` qui le valide et en tire un verdict. Un fichier
/// illisible remonte avec son erreur au lieu d'etre ignore: un agent qui ecrit
/// un rapport casse doit se voir, pas disparaitre de l'ecran.
#[tauri::command]
pub fn lire_rapports_agents(app: tauri::AppHandle, depuis: String) -> Result<DossierRapports, String> {
    Ok(lire_rapports(&dossier_rapports(&app)?, &depuis))
}

pub(crate) fn lire_rapports(racine: &std::path::Path, depuis: &str) -> DossierRapports {
    let mut resultat = DossierRapports {
        dossier: racine.to_string_lossy().into_owned(),
        existe: racine.is_dir(),
        ..Default::default()
    };

    for dossier_site in sous_dossiers(racine) {
        for dossier_jour in sous_dossiers(&dossier_site) {
            let jour = dossier_jour
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            // Les noms sont des dates ISO: l'ordre lexicographique est l'ordre chronologique
            if jour.len() != 10 || jour < depuis {
                continue;
            }
            let Ok(entrees) = std::fs::read_dir(&dossier_jour) else {
                continue;
            };
            for entree in entrees.filter_map(Result::ok) {
                let chemin = entree.path();
                let est_json = chemin
                    .extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| e.eq_ignore_ascii_case("json"));
                if !est_json || !chemin.is_file() {
                    continue;
                }
                let mut fichier = FichierRapport {
                    chemin: chemin.to_string_lossy().into_owned(),
                    ..Default::default()
                };
                match entree.metadata() {
                    Ok(m) if m.len() > TAILLE_MAX_RAPPORT => {
                        fichier.erreur = Some(format!("fichier trop lourd ({} Ko)", m.len() / 1024));
                    }
                    _ => match std::fs::read_to_string(&chemin) {
                        Ok(texte) => fichier.contenu = Some(texte),
                        Err(e) => fichier.erreur = Some(e.to_string()),
                    },
                }
                resultat.fichiers.push(fichier);
            }
        }
    }

    resultat
}

#[derive(serde::Serialize, Default)]
pub struct TachePlanifiee {
    id: String,
    skill: Option<String>,
}

#[derive(serde::Serialize, Default)]
pub struct TachesPlanifiees {
    /// Fichier ou l'appli Claude range horaires et derniers lancements, s'il a ete trouve
    config_chemin: Option<String>,
    config: Option<String>,
    taches: Vec<TachePlanifiee>,
}

/// Lit les taches planifiees de Claude, pour savoir quels rapports attendre.
///
/// Deux sources: les consignes (`~/.claude/scheduled-tasks/<id>/SKILL.md`), qui
/// disent si la tache depose un rapport, et le fichier ou l'appli Claude range
/// l'horaire et le dernier lancement de chacune. Ce second fichier est interne a
/// l'appli et son emplacement varie (installation classique ou paquet du Store):
/// on essaie les emplacements connus, et l'ecran sait faire sans.
#[tauri::command]
pub fn lire_taches_planifiees(app: tauri::AppHandle) -> Result<TachesPlanifiees, String> {
    let chemins = app.path();
    let home = chemins.home_dir().map_err(|e| e.to_string())?;
    let mut racines = Vec::new();
    if let Ok(local) = chemins.local_data_dir() {
        racines.push(local.join("Claude-Data"));
        for paquet in sous_dossiers(&local.join("Packages")) {
            let nom = paquet.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            if nom.starts_with("Claude_") {
                racines.push(paquet.join("LocalCache").join("Roaming").join("Claude"));
            }
        }
    }
    if let Ok(roaming) = chemins.data_dir() {
        racines.push(roaming.join("Claude"));
    }
    Ok(lire_taches(&home.join(".claude").join("scheduled-tasks"), &racines))
}

/// Cherche `claude-code-sessions/<compte>/<organisation>/scheduled-tasks.json`
/// sous chaque racine, ou sous un de ses sous-dossiers de profil. Plusieurs
/// candidats: le plus recemment modifie est celui de l'appli en service.
pub(crate) fn trouver_config_taches(racines: &[std::path::PathBuf]) -> Option<std::path::PathBuf> {
    let mut candidats = Vec::new();
    for racine in racines {
        let mut profils = vec![racine.clone()];
        profils.extend(sous_dossiers(racine));
        for profil in profils {
            for compte in sous_dossiers(&profil.join("claude-code-sessions")) {
                for organisation in sous_dossiers(&compte) {
                    let fichier = organisation.join("scheduled-tasks.json");
                    if let Ok(modifie) = std::fs::metadata(&fichier).and_then(|m| m.modified()) {
                        candidats.push((modifie, fichier));
                    }
                }
            }
        }
    }
    candidats.into_iter().max_by_key(|(modifie, _)| *modifie).map(|(_, f)| f)
}

pub(crate) fn lire_taches(dossier_taches: &std::path::Path, racines: &[std::path::PathBuf]) -> TachesPlanifiees {
    let mut resultat = TachesPlanifiees::default();
    if let Some(fichier) = trouver_config_taches(racines) {
        resultat.config = std::fs::read_to_string(&fichier).ok();
        resultat.config_chemin = Some(fichier.to_string_lossy().into_owned());
    }
    for dossier in sous_dossiers(dossier_taches) {
        let id = dossier.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
        let skill = dossier.join("SKILL.md");
        let lisible = std::fs::metadata(&skill).is_ok_and(|m| m.len() <= TAILLE_MAX_RAPPORT);
        resultat.taches.push(TachePlanifiee {
            id,
            skill: if lisible { std::fs::read_to_string(&skill).ok() } else { None },
        });
    }
    resultat
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lit_les_rapports_d_agents_depuis_une_date() {
        let racine = std::env::temp_dir().join(format!("rapports-agents-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&racine);
        let ecrire = |chemin: &str, contenu: &str| {
            let p = racine.join(chemin);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, contenu).unwrap();
        };
        ecrire("denivio.fr/2026-10-24/sante.json", r#"{"statut":"ok"}"#);
        ecrire("denivio.fr/2026-10-24/notes.md", "pas un rapport");
        ecrire("denivio.fr/2026-09-01/ancien.json", r#"{"statut":"ok"}"#);
        ecrire("denivio.fr/brouillon/x.json", "{}");

        let resultat = lire_rapports(&racine, "2026-10-01");
        let _ = std::fs::remove_dir_all(&racine);

        assert!(resultat.existe);
        assert_eq!(resultat.fichiers.len(), 1);
        assert!(resultat.fichiers[0].chemin.ends_with("sante.json"));
        assert_eq!(resultat.fichiers[0].contenu.as_deref(), Some(r#"{"statut":"ok"}"#));
    }

    #[test]
    fn un_dossier_de_rapports_absent_n_est_pas_une_erreur() {
        let resultat = lire_rapports(std::path::Path::new("Z:/n-existe/pas"), "2026-01-01");
        assert!(!resultat.existe);
        assert!(resultat.fichiers.is_empty());
    }

    #[test]
    fn lit_les_taches_planifiees_et_trouve_leur_config() {
        let racine = std::env::temp_dir().join(format!("taches-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&racine);
        let ecrire = |chemin: &str, contenu: &str| {
            let p = racine.join(chemin);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, contenu).unwrap();
        };
        ecrire("taches/sante/SKILL.md", "consignes");
        std::fs::create_dir_all(racine.join("taches/vide")).unwrap();
        ecrire(
            "Claude-Data/profil/claude-code-sessions/compte/org/scheduled-tasks.json",
            r#"{"scheduledTasks":[]}"#,
        );

        let resultat = lire_taches(
            &racine.join("taches"),
            &[racine.join("Claude-Data"), racine.join("absent")],
        );
        let _ = std::fs::remove_dir_all(&racine);

        assert_eq!(resultat.taches.len(), 2);
        assert_eq!(resultat.taches[0].id, "sante");
        assert_eq!(resultat.taches[0].skill.as_deref(), Some("consignes"));
        assert!(resultat.taches[1].skill.is_none());
        assert!(resultat.config_chemin.unwrap().ends_with("scheduled-tasks.json"));
        assert_eq!(resultat.config.as_deref(), Some(r#"{"scheduledTasks":[]}"#));
    }
}
