//! SiteDashboard : point d'entree Tauri. Les commandes vivent dans un module par theme.

mod agents;
mod certificat;
mod controles;
mod checks;
mod devises;
mod domaine;
mod icones;
mod mise_a_jour;
mod notifications;
mod reseau;
mod sauvegarde;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

const DB_URL: &str = "sqlite:sitedashboard.db";

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

/// Ramene la fenetre principale au premier plan, meme reduite ou cachee.
fn montrer_fenetre(app: &tauri::AppHandle) {
    if let Some(fenetre) = app.webview_windows().values().next() {
        let _ = fenetre.unminimize();
        let _ = fenetre.show();
        let _ = fenetre.set_focus();
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
        Migration {
            version: 4,
            description: "partage des revenus entre plusieurs sites",
            sql: include_str!("../migrations/004_revenus_partage.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "checks de type tls: expiration des certificats",
            sql: include_str!("../migrations/005_certificat.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "icone du site, stockee en data URI",
            sql: include_str!("../migrations/006_favicon.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "historique de tarifs des abonnements et icone des fournisseurs",
            sql: include_str!("../migrations/007_tarifs.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "devises des revenus, preferences et dedoublonnage des revenus",
            sql: include_str!("../migrations/008_devises_prefs.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "date de fin d'un abonnement resilie",
            sql: include_str!("../migrations/009_fin_abonnement.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "assertions: en-tetes, redirection attendue, taille et occurrences",
            sql: include_str!("../migrations/010_assertions.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "checks de type valeur: suivi de la version deployee",
            sql: include_str!("../migrations/011_valeurs.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "cadence propre a chaque check",
            sql: include_str!("../migrations/012_cadence.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "checks de type domaine: resolution DNS et expiration RDAP",
            sql: include_str!("../migrations/013_domaine.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        // Une seule instance (enregistre en premier, comme le demande le plugin) :
        // relancer SiteDashboard ramene au premier plan la fenetre deja ouverte
        // au lieu d'ouvrir une deuxieme appli qui lancerait les taches en double.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _dossier| {
            montrer_fenetre(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        // Demarrage avec Windows (cle Run de l'utilisateur), active depuis les Preferences
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            chemin_base,
            checks::executer_check,
            checks::executer_redirection,
            checks::lire_valeur,
            checks::inspecter_url,
            domaine::verifier_domaine,
            certificat::verifier_certificat,
            icones::recuperer_favicon,
            icones::importer_image,
            agents::lire_rapports_agents,
            agents::lire_taches_planifiees,
            agents::supprimer_rapports_agent,
            devises::taux_change,
            sauvegarde::chemin_sauvegarde,
            sauvegarde::nettoyer_sauvegardes,
            sauvegarde::dossier_sauvegardes,
            mise_a_jour::etat_mise_a_jour,
            mise_a_jour::lancer_mise_a_jour,
            controles::lancer_controle,
            controles::registre_agents,
            notifications::notifications_windows,
            tracer
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
