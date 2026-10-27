//! Connecteurs (Stripe, Anthropic, OpenAI, OVH) : un appel HTTP generique pour
//! leurs API, et leurs cles, rangees hors de la base.
//!
//! Toute la logique (pagination, conversion, import) vit en JS, testable sans
//! reseau ; Rust ne fait que l'appel, que le front ne peut pas faire lui-meme
//! (CORS). Les cles vont dans `~/.sitedashboard/connecteurs.json`, comme la cle
//! Bing : jamais dans la base, donc jamais dans les sauvegardes du dossier Documents.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::reseau::AGENT;

const DELAI_API: Duration = Duration::from_secs(30);

#[derive(serde::Serialize)]
pub struct ReponseApi {
    statut: u16,
    corps: String,
}

/// Appelle une API HTTPS et renvoie statut et corps bruts. Une erreur reseau
/// est une Err (lisible) ; un statut 4xx/5xx n'en est pas une : le front lit
/// le message d'erreur de l'API dans le corps.
#[tauri::command]
pub async fn appel_api(
    methode: String,
    url: String,
    entetes: Vec<(String, String)>,
    corps: Option<String>,
) -> Result<ReponseApi, String> {
    if !url.starts_with("https://") {
        return Err("seules les URL https sont autorisees".into());
    }
    let methode = reqwest::Method::from_bytes(methode.to_uppercase().as_bytes()).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .timeout(DELAI_API)
        .user_agent(AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    let mut requete = client.request(methode, &url);
    for (nom, valeur) in entetes {
        requete = requete.header(nom, valeur);
    }
    if let Some(corps) = corps {
        requete = requete.body(corps);
    }
    let reponse = requete.send().await.map_err(|e| crate::reseau::message_erreur(&e))?;
    let statut = reponse.status().as_u16();
    let corps = reponse.text().await.map_err(|e| crate::reseau::message_erreur(&e))?;
    Ok(ReponseApi { statut, corps })
}

fn fichier_secrets(app: &AppHandle) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(home.join(".sitedashboard").join("connecteurs.json"))
}

fn lire(chemin: &PathBuf) -> Result<BTreeMap<String, serde_json::Value>, String> {
    match std::fs::read_to_string(chemin) {
        Ok(texte) => serde_json::from_str(&texte).map_err(|e| format!("connecteurs.json illisible : {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// Les cles de tous les connecteurs, par identifiant de connecteur.
#[tauri::command]
pub fn secrets_connecteurs(app: AppHandle) -> Result<BTreeMap<String, serde_json::Value>, String> {
    lire(&fichier_secrets(&app)?)
}

/// Enregistre (ou retire, avec `secret` nul) les cles d'un connecteur.
#[tauri::command]
pub fn enregistrer_secret_connecteur(app: AppHandle, id: String, secret: Option<serde_json::Value>) -> Result<(), String> {
    let chemin = fichier_secrets(&app)?;
    let mut tous = lire(&chemin)?;
    match secret {
        Some(valeur) => {
            tous.insert(id, valeur);
        }
        None => {
            tous.remove(&id);
        }
    }
    if let Some(dossier) = chemin.parent() {
        std::fs::create_dir_all(dossier).map_err(|e| e.to_string())?;
    }
    let texte = serde_json::to_string_pretty(&tous).map_err(|e| e.to_string())?;
    std::fs::write(&chemin, texte).map_err(|e| e.to_string())
}
