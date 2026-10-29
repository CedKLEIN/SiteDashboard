//! Taches automatiques (dossier controles/ du depot) : des modeles generiques
//! appliques a des sites (voir controles/lib/registre.mjs). SiteDashboard les
//! lance a heure fixe ; un script n'appelle Claude qu'en cas d'anomalie
//! nouvelle, un agent Claude ouvre une session complete.
//!
//! Rust se contente de lancer node sans fenetre et de rendre la derniere ligne
//! JSON de sa sortie : le registre, le planning et l'affichage vivent cote JS.
//!
//! Un passage en cours peut etre annule : tout l'arbre de processus part avec
//! node (le script, et la session Claude qu'il a lancee).

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::sync::{LazyLock, Mutex};

use crate::mise_a_jour::depot;

#[derive(serde::Serialize, Default)]
pub struct ResultatControle {
    code: Option<i32>,
    /// Arrete par l'utilisateur (bouton Annuler)
    annule: bool,
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

/// Passages en cours : id de la tache -> PID de node.
static EN_COURS: LazyLock<Mutex<HashMap<String, u32>>> = LazyLock::new(Default::default);
/// Passages annules, pour le dire au retour de `lancer_controle`.
static ANNULES: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

fn commande_node(depot: &Path, args: &[&str]) -> Command {
    let mut commande = Command::new("node");
    commande.current_dir(depot).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        commande.creation_flags(crate::mise_a_jour::SANS_FENETRE);
    }
    // Son propre groupe : l'annulation tue node et tout ce qu'il a lance
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        commande.process_group(0);
    }
    commande
}

fn node(depot: &Path, args: &[&str]) -> Result<Output, String> {
    commande_node(depot, args)
        .output()
        .map_err(|e| format!("node introuvable ou injoignable : {e}"))
}

/// Comme `node`, mais le PID reste connu le temps du passage (voir `annuler_controle`).
fn node_annulable(id: &str, depot: &Path, args: &[&str]) -> Result<Output, String> {
    let enfant = commande_node(depot, args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("node introuvable ou injoignable : {e}"))?;
    EN_COURS.lock().unwrap().insert(id.to_string(), enfant.id());
    let sortie = enfant.wait_with_output();
    EN_COURS.lock().unwrap().remove(id);
    sortie.map_err(|e| e.to_string())
}

/// Tue un processus et tous ses descendants (cmd, claude, navigateur ouvert par l'agent).
fn tuer_arbre(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    let sortie = {
        use std::os::windows::process::CommandExt;
        Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(crate::mise_a_jour::SANS_FENETRE)
            .output()
    };
    #[cfg(not(windows))]
    let sortie = Command::new("kill").args(["-s", "KILL", "--", &format!("-{pid}")]).output();
    let sortie = sortie.map_err(|e| e.to_string())?;
    if sortie.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&sortie.stderr).trim().to_string())
    }
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
        ANNULES.lock().unwrap().remove(&id);
        let sortie = node_annulable(&id, &depot, &["--max-old-space-size=4096", "controles/lancer.mjs", &id])?;
        let erreurs = String::from_utf8_lossy(&sortie.stderr);
        let fin = erreurs.len().saturating_sub(800);
        Ok(ResultatControle {
            code: sortie.status.code(),
            annule: ANNULES.lock().unwrap().remove(&id),
            resume: derniere_ligne_json(&sortie.stdout),
            erreurs: erreurs.get(fin..).unwrap_or_default().to_string(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Arrete un passage en cours : le script node et la session Claude qu'il a lancee.
#[tauri::command]
pub async fn annuler_controle(id: String) -> Result<(), String> {
    let pid = EN_COURS
        .lock()
        .unwrap()
        .get(&id)
        .copied()
        .ok_or("cette tâche ne tourne plus")?;
    ANNULES.lock().unwrap().insert(id);
    tauri::async_runtime::spawn_blocking(move || tuer_arbre(pid))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("arrêt impossible : {e}"))
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
    async fn annuler_une_tache_arretee_est_refuse() {
        assert!(annuler_controle("rien-en-cours".into()).await.is_err());
    }

    #[cfg(unix)]
    #[test]
    fn tuer_arbre_arrete_le_processus_et_ses_enfants() {
        let mut parent = Command::new("sh");
        {
            use std::os::unix::process::CommandExt;
            parent.args(["-c", "sleep 30 & sleep 30"]).process_group(0);
        }
        let mut enfant = parent.spawn().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(100));
        tuer_arbre(enfant.id()).unwrap();
        assert!(!enfant.wait().unwrap().success());
    }

    #[tokio::test]
    async fn refuse_une_action_ou_des_arguments_inconnus() {
        assert!(registre_agents("supprimer".into(), vec![]).await.is_err());
        assert!(registre_agents("ajouter".into(), vec!["a".into()]).await.is_err());
        assert!(registre_agents("retirer".into(), vec!["a b".into()]).await.is_err());
    }
}
