//! Controles automatiques (dossier controles/ du depot) : SiteDashboard les
//! lance a heure fixe, a la place d'agents Claude qui faisaient un travail
//! mecanique. Le script n'appelle Claude qu'en cas d'anomalie nouvelle.
//!
//! Rust se contente de lancer `node controles/lancer.mjs <id>` sans fenetre et
//! de rendre sa sortie : le planning et l'affichage vivent cote JS.

use std::path::Path;
use std::process::Command;

use crate::mise_a_jour::depot;

#[derive(serde::Serialize, Default)]
pub struct ResultatControle {
    code: Option<i32>,
    /// Derniere ligne JSON du lanceur : { id, statut, rapport, claude }.
    resume: Option<serde_json::Value>,
    /// Fin de la sortie d'erreur, pour comprendre un plantage.
    erreurs: String,
}

/// Identifiants connus du registre : seul l'un d'eux peut etre lance.
fn identifiants(depot: &Path) -> Result<Vec<String>, String> {
    let texte = std::fs::read_to_string(depot.join("controles").join("registre.json"))
        .map_err(|e| format!("registre des controles illisible : {e}"))?;
    let registre: serde_json::Value = serde_json::from_str(&texte).map_err(|e| e.to_string())?;
    Ok(registre
        .as_array()
        .map(|liste| {
            liste
                .iter()
                .filter_map(|c| c.get("id").and_then(|v| v.as_str()).map(str::to_string))
                .collect()
        })
        .unwrap_or_default())
}

/// Lance un controle et attend sa fin (de quelques secondes a quelques
/// minutes, davantage si Claude analyse une anomalie).
#[tauri::command]
pub async fn lancer_controle(id: String) -> Result<ResultatControle, String> {
    let depot = depot();
    if !identifiants(&depot)?.contains(&id) {
        return Err(format!("controle inconnu : {id}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut commande = Command::new("node");
        commande
            .current_dir(&depot)
            // L'audit de Denivio lit un seed de 90 Mo
            .args(["--max-old-space-size=4096", "controles/lancer.mjs", &id]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            commande.creation_flags(crate::mise_a_jour::SANS_FENETRE);
        }
        let sortie = commande
            .output()
            .map_err(|e| format!("node introuvable ou injoignable : {e}"))?;
        let texte = String::from_utf8_lossy(&sortie.stdout);
        let resume = texte
            .lines()
            .rev()
            .find_map(|ligne| serde_json::from_str::<serde_json::Value>(ligne.trim()).ok());
        let erreurs = String::from_utf8_lossy(&sortie.stderr);
        let fin = erreurs.len().saturating_sub(800);
        Ok(ResultatControle {
            code: sortie.status.code(),
            resume,
            erreurs: erreurs.get(fin..).unwrap_or_default().to_string(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_registre_liste_controles_et_agents() {
        let ids = identifiants(&depot()).unwrap();
        assert!(ids.contains(&"sante-prod-denivio-quotidienne".to_string()));
        assert!(ids.contains(&"bing-denivio-quotidien".to_string()));
        assert_eq!(ids.len(), 9);
    }

    #[tokio::test]
    async fn refuse_un_controle_hors_registre() {
        let erreur = lancer_controle("rm -rf".to_string()).await.err().unwrap();
        assert!(erreur.contains("inconnu"));
    }
}
