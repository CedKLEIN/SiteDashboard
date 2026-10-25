//! Mise a jour de l'appli depuis son propre depot : y a-t-il des commits plus
//! recents que la version installee, et lancement de `npm.cmd run installer`.
//!
//! Le depot est celui qui a servi a compiler (son chemin est grave a la
//! compilation) : l'appli ne telecharge rien, elle recompile le code local.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Commit compile, grave par build.rs ; vide hors d'un depot git.
const COMMIT_INSTALLE: &str = env!("SITEDASHBOARD_COMMIT");

/// Fenetre de console masquee pour les appels a git, nouvelle console visible
/// pour l'installeur (drapeaux de CreateProcess).
#[cfg(windows)]
pub(crate) const SANS_FENETRE: u32 = 0x0800_0000;
#[cfg(windows)]
const NOUVELLE_CONSOLE: u32 = 0x0000_0010;

pub(crate) fn depot() -> PathBuf {
    // CARGO_MANIFEST_DIR = <depot>/src-tauri au moment de la compilation
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default()
}

fn git(depot: &Path, args: &[&str]) -> Result<String, String> {
    let mut commande = Command::new("git");
    commande.arg("-C").arg(depot).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        commande.creation_flags(SANS_FENETRE);
    }
    let sortie = commande
        .output()
        .map_err(|e| format!("git introuvable: {e}"))?;
    if !sortie.status.success() {
        return Err(String::from_utf8_lossy(&sortie.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&sortie.stdout).trim().to_string())
}

#[derive(serde::Serialize, Default)]
pub struct EtatMiseAJour {
    depot: String,
    commit_installe: String,
    commit_depot: Option<String>,
    branche: Option<String>,
    /// Commits du depot absents de la version installee, du plus recent au plus ancien.
    nouveaux: Vec<String>,
    /// Fichiers modifies non commites : ils seraient compiles eux aussi.
    modifications_locales: usize,
    erreur: Option<String>,
}

/// Compare la version installee au depot. Ne renvoie jamais Err : un depot
/// absent ou git introuvable est un etat a afficher, pas une panne.
#[tauri::command]
pub fn etat_mise_a_jour() -> EtatMiseAJour {
    let depot = depot();
    let mut etat = EtatMiseAJour {
        depot: depot.to_string_lossy().into_owned(),
        commit_installe: COMMIT_INSTALLE.to_string(),
        ..Default::default()
    };
    if !depot.join(".git").exists() {
        etat.erreur = Some("depot introuvable : l'appli a ete compilee ailleurs".to_string());
        return etat;
    }

    match git(&depot, &["rev-parse", "HEAD"]) {
        Ok(commit) => etat.commit_depot = Some(commit),
        Err(e) => {
            etat.erreur = Some(e);
            return etat;
        }
    }
    etat.branche = git(&depot, &["rev-parse", "--abbrev-ref", "HEAD"]).ok();
    etat.modifications_locales = git(&depot, &["status", "--porcelain"])
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
        .unwrap_or(0);

    if COMMIT_INSTALLE.is_empty() {
        etat.erreur = Some("version installee sans commit connu (compilee hors de git)".to_string());
        return etat;
    }
    let plage = format!("{COMMIT_INSTALLE}..HEAD");
    match git(&depot, &["log", "--format=%h %s", &plage]) {
        Ok(liste) => etat.nouveaux = liste.lines().map(str::to_string).collect(),
        Err(e) => etat.erreur = Some(e),
    }
    etat
}

/// Lance `npm.cmd run installer` dans une nouvelle console visible, detachee :
/// le script ferme l'appli pour installer, la console doit lui survivre. En cas
/// d'echec la console reste ouverte sur l'erreur (`pause`).
#[tauri::command]
pub fn lancer_mise_a_jour() -> Result<(), String> {
    let depot = depot();
    if !depot.join("package.json").exists() {
        return Err(format!("depot introuvable : {}", depot.display()));
    }
    let mut commande = Command::new("cmd.exe");
    commande
        .current_dir(&depot)
        .args(["/c", "title Mise a jour de SiteDashboard && npm.cmd run installer || pause"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        commande.creation_flags(NOUVELLE_CONSOLE);
    }
    commande
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("lancement impossible: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_depot_de_compilation_est_ce_depot() {
        assert!(depot().join("package.json").exists());
        assert!(depot().join("src-tauri").join("Cargo.toml").exists());
    }

    #[test]
    fn compare_au_depot_sans_erreur() {
        let etat = etat_mise_a_jour();
        assert_eq!(etat.erreur, None);
        assert!(etat.commit_depot.is_some());
        // build.rs a bien grave le commit compile
        assert_eq!(etat.commit_installe.len(), 40, "commit grave: {:?}", etat.commit_installe);
    }
}
