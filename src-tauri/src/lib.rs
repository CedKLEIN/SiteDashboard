use std::time::{Duration, Instant};

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

const DB_URL: &str = "sqlite:sitedashboard.db";
const DELAI_CHECK: Duration = Duration::from_secs(15);

/// Chemin absolu du fichier SQLite, affiche dans l'UI pour faciliter les sauvegardes.
#[tauri::command]
fn chemin_base(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("sitedashboard.db").to_string_lossy().into_owned())
}

/// Renvoie une trace du front vers le terminal. Dans une WebView, une erreur JS
/// est invisible depuis `tauri dev`: sans ce relais, un cycle de supervision qui
/// echoue ne laisse aucune trace exploitable.
#[tauri::command]
fn tracer(niveau: String, message: String) {
    println!("[{niveau}] {message}");
}

#[derive(serde::Serialize)]
pub struct ResultatCheck {
    ok: bool,
    statut: Option<u16>,
    latence_ms: u64,
    erreur: Option<String>,
}

impl ResultatCheck {
    fn echec(latence_ms: u64, erreur: String) -> Self {
        Self {
            ok: false,
            statut: None,
            latence_ms,
            erreur: Some(erreur),
        }
    }
}

/// Traduit les erreurs reseau en message court et lisible dans l'UI:
/// `reqwest::Error` en Debug est une chaine interminable inexploitable telle quelle.
fn message_erreur(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "delai depasse".to_string()
    } else if e.is_connect() {
        "connexion impossible".to_string()
    } else if e.is_redirect() {
        "trop de redirections".to_string()
    } else {
        e.to_string()
    }
}

/// Execute un check HTTP. Ne renvoie jamais Err: un site injoignable est un
/// resultat de supervision normal, pas une erreur de l'appli.
#[tauri::command]
async fn executer_check(
    url: String,
    statut_attendu: Option<u16>,
    doit_contenir: Option<String>,
) -> ResultatCheck {
    let debut = Instant::now();

    let client = match reqwest::Client::builder()
        .timeout(DELAI_CHECK)
        .user_agent(concat!("SiteDashboard/", env!("CARGO_PKG_VERSION")))
        .build()
    {
        Ok(client) => client,
        Err(e) => return ResultatCheck::echec(0, e.to_string()),
    };

    let reponse = match client.get(&url).send().await {
        Ok(reponse) => reponse,
        Err(e) => {
            return ResultatCheck::echec(debut.elapsed().as_millis() as u64, message_erreur(&e))
        }
    };

    let statut = reponse.status();
    let statut_ok = match statut_attendu {
        Some(attendu) => statut.as_u16() == attendu,
        None => statut.is_success(),
    };

    // On ne telecharge le corps que si un fragment est attendu: inutile de tirer
    // toute la page pour un simple controle de disponibilite.
    let erreur_contenu = match doit_contenir.as_deref().filter(|f| !f.is_empty()) {
        Some(fragment) => match reponse.text().await {
            Ok(corps) if corps.contains(fragment) => None,
            Ok(_) => Some(format!("fragment absent: {fragment}")),
            Err(e) => Some(message_erreur(&e)),
        },
        None => None,
    };

    let ok = statut_ok && erreur_contenu.is_none();
    let erreur = if ok {
        None
    } else {
        erreur_contenu.or_else(|| Some(format!("statut HTTP {}", statut.as_u16())))
    };

    ResultatCheck {
        ok,
        statut: Some(statut.as_u16()),
        latence_ms: debut.elapsed().as_millis() as u64,
        erreur,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "schema initial: sites, fournisseurs, depenses, revenus, abonnements",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "supervision: checks et verifications",
            sql: include_str!("../migrations/002_monitoring.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "partage d'une depense ou d'un abonnement entre plusieurs sites",
            sql: include_str!("../migrations/003_partage.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![chemin_base, executer_check, tracer])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
