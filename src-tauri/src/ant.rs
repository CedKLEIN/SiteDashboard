//! Connexion a Anthropic par le navigateur, sans cle Admin a creer : l'outil
//! `ant` d'Anthropic ouvre la page de connexion, garde le jeton (OAuth, droit
//! `org:admin`) et le rafraichit ; SiteDashboard lui demande un jeton frais a
//! chaque synchronisation.
//!
//! `ant` est installe par l'appli si besoin, dans son propre dossier
//! (`%LOCALAPPDATA%\com.cedklein.sitedashboard\outils`), depuis la derniere
//! version publiee sur GitHub. Un `ant` deja present dans le PATH sert aussi.

use std::io::Cursor;
use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::reseau::AGENT;

/// Profil `ant` reserve a SiteDashboard : il ne touche pas aux autres connexions.
const PROFIL: &str = "sitedashboard";
const DELAI_CONNEXION: Duration = Duration::from_secs(300);
const DEPOT: &str = "https://api.github.com/repos/anthropics/anthropic-cli/releases/latest";

fn exe() -> &'static str {
    if cfg!(windows) {
        "ant.exe"
    } else {
        "ant"
    }
}

fn dossier_outils(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("outils"))
}

/// `ant` a lancer : celui installe par l'appli, sinon celui du PATH.
fn chemin_ant(app: &AppHandle) -> Result<PathBuf, String> {
    let local = dossier_outils(app)?.join(exe());
    Ok(if local.exists() { local } else { PathBuf::from("ant") })
}

/// Commande `ant` sans fenetre de console, sans cle d'API heritee : une
/// variable ANTHROPIC_API_KEY du systeme passerait avant le profil.
fn commande(app: &AppHandle) -> Result<tokio::process::Command, String> {
    let mut c = tokio::process::Command::new(chemin_ant(app)?);
    c.env_remove("ANTHROPIC_API_KEY").env_remove("ANTHROPIC_AUTH_TOKEN").env_remove("ANTHROPIC_PROFILE");
    #[cfg(windows)]
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    Ok(c)
}

fn texte(octets: &[u8]) -> String {
    String::from_utf8_lossy(octets).trim().to_string()
}

#[derive(serde::Serialize)]
pub struct EtatAnt {
    installe: bool,
    version: Option<String>,
    /// Une connexion valide existe pour le profil de SiteDashboard
    connecte: bool,
}

/// `ant` est-il la, et deja connecte ?
#[tauri::command]
pub async fn ant_etat(app: AppHandle) -> Result<EtatAnt, String> {
    let version = match commande(&app)?.arg("--version").output().await {
        Ok(sortie) if sortie.status.success() => Some(texte(&sortie.stdout)),
        _ => None,
    };
    if version.is_none() {
        return Ok(EtatAnt { installe: false, version: None, connecte: false });
    }
    let connecte = ant_jeton(app).await.is_ok();
    Ok(EtatAnt { installe: true, version, connecte })
}

/// Telecharge la derniere version Windows de `ant` et l'installe dans le dossier de l'appli.
#[tauri::command]
pub async fn ant_installer(app: AppHandle) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .user_agent(AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    let publication: serde_json::Value = serde_json::from_str(
        &client
            .get(DEPOT)
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| crate::reseau::message_erreur(&e))?
            .text()
            .await
            .map_err(|e| crate::reseau::message_erreur(&e))?,
    )
    .map_err(|e| e.to_string())?;

    // Le paquet Windows 64 bits, quel que soit le nommage exact de la version
    let paquet = publication["assets"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|a| {
            let nom = a["name"].as_str().unwrap_or("").to_lowercase();
            nom.contains("windows") && (nom.contains("amd64") || nom.contains("x86_64")) && nom.ends_with(".zip")
        })
        .ok_or("Aucun paquet Windows trouvé dans la dernière version de ant : colle une clé Admin à la place.")?;
    let url = paquet["browser_download_url"].as_str().ok_or("lien de téléchargement absent")?;

    let octets = client
        .get(url)
        .send()
        .await
        .map_err(|e| crate::reseau::message_erreur(&e))?
        .bytes()
        .await
        .map_err(|e| crate::reseau::message_erreur(&e))?;
    let mut archive = zip::ZipArchive::new(Cursor::new(octets)).map_err(|e| format!("archive illisible : {e}"))?;
    let dossier = dossier_outils(&app)?;
    std::fs::create_dir_all(&dossier).map_err(|e| e.to_string())?;
    let cible = dossier.join(exe());
    for i in 0..archive.len() {
        let mut fichier = archive.by_index(i).map_err(|e| e.to_string())?;
        let nom = fichier.name().replace('\\', "/");
        if nom.rsplit('/').next() == Some(exe()) {
            let mut sortie = std::fs::File::create(&cible).map_err(|e| e.to_string())?;
            std::io::copy(&mut fichier, &mut sortie).map_err(|e| e.to_string())?;
            return Ok(publication["tag_name"].as_str().unwrap_or("").to_string());
        }
    }
    Err(format!("{} introuvable dans l'archive téléchargée", exe()))
}

/// Ouvre la page de connexion Anthropic dans le navigateur et attend qu'elle
/// soit validee (5 minutes au plus). Le droit `org:admin` est demande : il
/// donne acces au rapport de couts, et n'est accorde qu'a un administrateur.
#[tauri::command]
pub async fn ant_connexion(app: AppHandle) -> Result<(), String> {
    let mut c = commande(&app)?;
    c.args(["auth", "login", "--profile", PROFIL, "--scope", "org:admin"]).kill_on_drop(true);
    let sortie = tokio::time::timeout(DELAI_CONNEXION, c.output())
        .await
        .map_err(|_| "connexion abandonnée : la page n'a pas été validée dans les 5 minutes".to_string())?
        .map_err(|e| format!("ant introuvable ({e})"))?;
    if sortie.status.success() {
        Ok(())
    } else {
        let erreur = texte(&sortie.stderr);
        Err(if erreur.is_empty() { texte(&sortie.stdout) } else { erreur })
    }
}

/// Jeton d'acces frais du profil de SiteDashboard (`ant` le rafraichit au besoin).
#[tauri::command]
pub async fn ant_jeton(app: AppHandle) -> Result<String, String> {
    let sortie = commande(&app)?
        .args(["auth", "print-credentials", "--profile", PROFIL, "--access-token"])
        .output()
        .await
        .map_err(|e| format!("ant introuvable ({e})"))?;
    let jeton = texte(&sortie.stdout);
    if sortie.status.success() && !jeton.is_empty() && !jeton.starts_with('{') {
        Ok(jeton)
    } else {
        Err(format!(
            "Connexion Anthropic expirée ou absente : reconnecte-toi ({})",
            texte(&sortie.stderr).lines().next().unwrap_or("")
        ))
    }
}
