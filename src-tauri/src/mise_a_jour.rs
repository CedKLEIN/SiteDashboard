//! Mise a jour de l'appli depuis son propre depot : y a-t-il des commits plus
//! recents que la version installee, et lancement de `npm.cmd run installer`.
//!
//! Le depot est celui qui a servi a compiler (son chemin est grave a la
//! compilation) : l'appli ne telecharge rien, elle recompile le code local.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Commit compile, grave par build.rs ; vide hors d'un depot git.
const COMMIT_INSTALLE: &str = env!("SITEDASHBOARD_COMMIT");

/// Pas de fenetre de console, pour git comme pour l'installeur (drapeau de CreateProcess).
#[cfg(windows)]
pub(crate) const SANS_FENETRE: u32 = 0x0800_0000;

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

/// Derniere ligne du journal quand le script echoue : l'ecran de mise a jour la guette.
const MARQUE_ECHEC: &str = "MISE_A_JOUR_ECHEC";

/// Journal de la derniere mise a jour : `~/.sitedashboard/journaux/mise-a-jour.log`.
fn journal() -> PathBuf {
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_default();
    home.join(".sitedashboard").join("journaux").join("mise-a-jour.log")
}

/// Lance `npm.cmd run installer` sans fenetre, sa sortie dans le journal, que
/// l'ecran de mise a jour suit (`journal_mise_a_jour`). Le processus est
/// detache : le script ferme l'appli pour installer, il doit lui survivre.
#[tauri::command]
pub fn lancer_mise_a_jour() -> Result<(), String> {
    let depot = depot();
    if !depot.join("package.json").exists() {
        return Err(format!("depot introuvable : {}", depot.display()));
    }
    let journal = journal();
    if let Some(dossier) = journal.parent() {
        std::fs::create_dir_all(dossier).map_err(|e| e.to_string())?;
    }
    std::fs::write(&journal, "").map_err(|e| format!("journal impossible: {e}"))?;
    let mut commande = Command::new("cmd.exe");
    commande.current_dir(&depot);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // raw_arg : cmd /c lit ses guillemets lui-meme, sans l'echappement de Rust
        commande.raw_arg(format!(
            "/c \"npm.cmd run installer >> \"{j}\" 2>&1 || echo {MARQUE_ECHEC} >> \"{j}\"\"",
            j = journal.display()
        ));
        commande.creation_flags(SANS_FENETRE);
    }
    commande
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("lancement impossible: {e}"))
}

/// La fin du journal de mise a jour (les 4 derniers Ko suffisent a l'ecran).
#[tauri::command]
pub fn journal_mise_a_jour() -> String {
    let texte = std::fs::read(journal()).unwrap_or_default();
    let debut = texte.len().saturating_sub(4096);
    String::from_utf8_lossy(&texte[debut..]).into_owned()
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
