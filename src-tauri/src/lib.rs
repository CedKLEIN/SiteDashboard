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

/// Verificateur permissif, utilise UNIQUEMENT pour inspecter un certificat.
///
/// Un certificat deja expire fait echouer la poignee de main standard: on ne
/// pourrait alors rien en dire de precis, juste "connexion impossible". En
/// acceptant la chaine sans la valider, on peut toujours LIRE la date
/// d'expiration et annoncer "expire depuis 3 jours".
///
/// Aucune donnee n'est envoyee sur cette connexion: on fait la poignee de main,
/// on lit le certificat, on ferme. Les checks HTTP, eux, passent par reqwest
/// avec la validation complete - une usurpation y serait donc bien detectee.
#[derive(Debug)]
struct InspectionSansValidation;

impl rustls::client::danger::ServerCertVerifier for InspectionSansValidation {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

#[derive(serde::Serialize, Default)]
pub struct ResultatCertificat {
    /// Negatif si le certificat est deja expire.
    jours_restants: Option<i64>,
    expire_le: Option<String>,
    emetteur: Option<String>,
    erreur: Option<String>,
}

impl ResultatCertificat {
    fn echec(erreur: impl Into<String>) -> Self {
        Self {
            erreur: Some(erreur.into()),
            ..Default::default()
        }
    }
}

async fn lire_certificat(url: &str) -> Result<ResultatCertificat, String> {
    let analysee = url::Url::parse(url).map_err(|e| e.to_string())?;
    if analysee.scheme() != "https" {
        return Err("le certificat ne se verifie qu'en https".to_string());
    }
    let hote = analysee.host_str().ok_or("URL sans hote")?.to_string();
    let port = analysee.port().unwrap_or(443);

    let config = rustls::ClientConfig::builder_with_provider(std::sync::Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|e| e.to_string())?
    .dangerous()
    .with_custom_certificate_verifier(std::sync::Arc::new(InspectionSansValidation))
    .with_no_client_auth();

    let nom = rustls::pki_types::ServerName::try_from(hote.clone()).map_err(|e| e.to_string())?;
    let flux = tokio::time::timeout(
        DELAI_CHECK,
        tokio::net::TcpStream::connect((hote.as_str(), port)),
    )
    .await
    .map_err(|_| "delai depasse".to_string())?
    .map_err(|e| e.to_string())?;

    let connecteur = tokio_rustls::TlsConnector::from(std::sync::Arc::new(config));
    let tls = tokio::time::timeout(DELAI_CHECK, connecteur.connect(nom, flux))
        .await
        .map_err(|_| "delai depasse pendant la poignee de main".to_string())?
        .map_err(|e| e.to_string())?;

    let chaine = tls
        .get_ref()
        .1
        .peer_certificates()
        .ok_or("le serveur n'a presente aucun certificat")?
        .to_vec();
    let feuille = chaine.first().ok_or("chaine de certificats vide")?;

    let (_, certificat) =
        x509_parser::parse_x509_certificate(feuille.as_ref()).map_err(|e| e.to_string())?;

    let expiration = certificat.validity().not_after;
    let maintenant = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64;

    Ok(ResultatCertificat {
        jours_restants: Some((expiration.timestamp() - maintenant) / 86_400),
        expire_le: Some(expiration.to_string()),
        emetteur: Some(certificat.issuer().to_string()),
        erreur: None,
    })
}

/// Lit la date d'expiration du certificat TLS presente par un site.
/// Comme `executer_check`, ne renvoie jamais Err: un echec est un resultat.
#[tauri::command]
async fn verifier_certificat(url: String) -> ResultatCertificat {
    match lire_certificat(&url).await {
        Ok(resultat) => resultat,
        Err(erreur) => ResultatCertificat::echec(erreur),
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
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            chemin_base,
            executer_check,
            verifier_certificat,
            tracer
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
