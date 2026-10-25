//! Sauvegardes de la base : ou les ecrire, et lesquelles supprimer.
//!
//! La copie elle-meme est un `VACUUM INTO` joue par le front sur la connexion
//! SQLite de l'appli : il ecrit une base coherente meme pendant une ecriture,
//! sans fichier -wal a cote, ce qu'une copie de fichier ne garantit pas.

use tauri::Manager;

const PREFIXE: &str = "sitedashboard-";
const EXTENSION: &str = ".db";

/// `Documents\SiteDashboard\sauvegardes` : hors d'AppData, la ou on pense a
/// regarder, et hors de portee d'une desinstallation.
fn dossier(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let documents = app.path().document_dir().map_err(|e| e.to_string())?;
    let dossier = documents.join("SiteDashboard").join("sauvegardes");
    std::fs::create_dir_all(&dossier).map_err(|e| e.to_string())?;
    Ok(dossier)
}

/// Chemin du fichier a ecrire pour une sauvegarde horodatee `AAAA-MM-JJ_HHMM`.
///
/// L'horodatage vient du front (heure locale) : on le valide pour qu'il ne
/// puisse designer qu'un fichier de ce dossier.
#[tauri::command]
pub fn chemin_sauvegarde(app: tauri::AppHandle, horodatage: String) -> Result<String, String> {
    let valide = !horodatage.is_empty()
        && horodatage.len() <= 32
        && horodatage.chars().all(|c| c.is_ascii_digit() || c == '-' || c == '_');
    if !valide {
        return Err(format!("horodatage invalide: {horodatage}"));
    }
    let fichier = dossier(&app)?.join(format!("{PREFIXE}{horodatage}{EXTENSION}"));
    if fichier.exists() {
        return Err("une sauvegarde porte deja ce nom".to_string());
    }
    Ok(fichier.to_string_lossy().into_owned())
}

/// Les sauvegardes a supprimer pour n'en garder que `garder`, les plus recentes.
/// Les noms sont horodates : l'ordre alphabetique est l'ordre chronologique.
pub(crate) fn a_supprimer(mut noms: Vec<String>, garder: usize) -> Vec<String> {
    noms.retain(|n| n.starts_with(PREFIXE) && n.ends_with(EXTENSION));
    noms.sort();
    let surplus = noms.len().saturating_sub(garder);
    noms.into_iter().take(surplus).collect()
}

/// Supprime les sauvegardes les plus anciennes au-dela de `garder`.
/// Ne touche qu'aux fichiers `sitedashboard-*.db` du dossier de sauvegarde.
#[tauri::command]
pub fn nettoyer_sauvegardes(app: tauri::AppHandle, garder: usize) -> Result<usize, String> {
    let dossier = dossier(&app)?;
    let noms = std::fs::read_dir(&dossier)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|e| e.path().is_file())
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    let anciennes = a_supprimer(noms, garder.max(1));
    for nom in &anciennes {
        std::fs::remove_file(dossier.join(nom)).map_err(|e| e.to_string())?;
    }
    Ok(anciennes.len())
}

/// Le dossier des sauvegardes, pour l'afficher et l'ouvrir depuis l'appli.
#[tauri::command]
pub fn dossier_sauvegardes(app: tauri::AppHandle) -> Result<String, String> {
    Ok(dossier(&app)?.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn noms(liste: &[&str]) -> Vec<String> {
        liste.iter().map(|n| n.to_string()).collect()
    }

    #[test]
    fn garde_les_plus_recentes() {
        let liste = noms(&[
            "sitedashboard-2026-10-25_1200.db",
            "sitedashboard-2026-10-11_0900.db",
            "sitedashboard-2026-10-18_0900.db",
        ]);
        assert_eq!(a_supprimer(liste, 2), noms(&["sitedashboard-2026-10-11_0900.db"]));
    }

    #[test]
    fn ignore_les_fichiers_qui_ne_sont_pas_des_sauvegardes() {
        let liste = noms(&["notes.txt", "autre.db", "sitedashboard-2026-10-25_1200.db"]);
        assert!(a_supprimer(liste, 1).is_empty());
    }

    #[test]
    fn ne_supprime_rien_sous_le_seuil() {
        assert!(a_supprimer(noms(&["sitedashboard-2026-10-25_1200.db"]), 8).is_empty());
    }
}
