//! Taches automatiques (dossier controles/ du depot) : des modeles generiques
//! appliques a des sites (voir controles/lib/registre.mjs). SiteDashboard les
//! lance a heure fixe ; un script n'appelle Claude qu'en cas d'anomalie
//! nouvelle, un agent Claude ouvre une session complete.
//!
//! Rust se contente de lancer node sans fenetre et de rendre la derniere ligne
//! JSON de sa sortie : le registre, le planning et l'affichage vivent cote JS.

use std::path::Path;
use std::process::{Command, Output};

use crate::mise_a_jour::depot;

#[derive(serde::Serialize, Default)]
pub struct ResultatControle {
    code: Option<i32>,
    /// Derniere ligne JSON du lanceur : { id, statut, rapport, claude }.
    resume: Option<serde_json::Value>,
    /// Fin de la sortie d'erreur, pour comprendre un plantage.
    erreurs: String,
}

/// Identifiants d'agent, de modele et de site : minuscules, chiffres et tirets.
/// node les recoit en arguments (sans shell) ; on refuse tout le reste quand meme.
pub(crate) fn identifiant_valide(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn node(depot: &Path, args: &[&str]) -> Result<Output, String> {
    let mut commande = Command::new("node");
    commande.current_dir(depot).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        commande.creation_flags(crate::mise_a_jour::SANS_FENETRE);
    }
    commande
        .output()
        .map_err(|e| format!("node introuvable ou injoignable : {e}"))
}

fn derniere_ligne_json(sortie: &[u8]) -> Option<serde_json::Value> {
    String::from_utf8_lossy(sortie)
        .lines()
        .rev()
        .find_map(|ligne| serde_json::from_str::<serde_json::Value>(ligne.trim()).ok())
}

/// Lance un controle ou un agent et attend sa fin (de quelques secondes a
/// quelques heures pour un agent Claude).
#[tauri::command]
pub async fn lancer_controle(id: String) -> Result<ResultatControle, String> {
    if !identifiant_valide(&id) {
        return Err(format!("controle inconnu : {id}"));
    }
    let depot = depot();
    tauri::async_runtime::spawn_blocking(move || {
        // L'audit de Denivio lit un seed de 90 Mo
        let sortie = node(&depot, &["--max-old-space-size=4096", "controles/lancer.mjs", &id])?;
        let erreurs = String::from_utf8_lossy(&sortie.stderr);
        let fin = erreurs.len().saturating_sub(800);
        Ok(ResultatControle {
            code: sortie.status.code(),
            resume: derniere_ligne_json(&sortie.stdout),
            erreurs: erreurs.get(fin..).unwrap_or_default().to_string(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Registre des taches : `liste`, `ajouter <modele> <site>`, `retirer <agent>`.
#[tauri::command]
pub async fn registre_agents(action: String, args: Vec<String>) -> Result<serde_json::Value, String> {
    let attendus = match action.as_str() {
        "liste" => 0,
        "ajouter" => 2,
        "retirer" => 1,
        _ => return Err(format!("action inconnue : {action}")),
    };
    if args.len() != attendus || !args.iter().all(|a| identifiant_valide(a)) {
        return Err("arguments invalides".to_string());
    }
    let depot = depot();
    tauri::async_runtime::spawn_blocking(move || {
        let mut tout = vec!["controles/registre.mjs", action.as_str()];
        tout.extend(args.iter().map(String::as_str));
        let sortie = node(&depot, &tout)?;
        let reponse = derniere_ligne_json(&sortie.stdout)
            .ok_or_else(|| format!("registre illisible : {}", String::from_utf8_lossy(&sortie.stderr)))?;
        match reponse.get("erreur").and_then(|e| e.as_str()) {
            Some(erreur) => Err(erreur.to_string()),
            None => Ok(reponse),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepte_seulement_des_identifiants_simples() {
        assert!(identifiant_valide("sante-prod-denivio-quotidienne"));
        assert!(!identifiant_valide("rm -rf"));
        assert!(!identifiant_valide("../x"));
        assert!(!identifiant_valide(""));
    }

    #[tokio::test]
    async fn refuse_un_controle_mal_forme() {
        let erreur = lancer_controle("rm -rf".to_string()).await.err().unwrap();
        assert!(erreur.contains("inconnu"));
    }

    #[tokio::test]
    async fn refuse_une_action_ou_des_arguments_inconnus() {
        assert!(registre_agents("supprimer".into(), vec![]).await.is_err());
        assert!(registre_agents("ajouter".into(), vec!["a".into()]).await.is_err());
        assert!(registre_agents("retirer".into(), vec!["a b".into()]).await.is_err());
    }
}
