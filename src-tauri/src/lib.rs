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

    ResultatCheck {
        ok: statut_ok && erreur_contenu.is_none(),
        statut: Some(statut.as_u16()),
        latence_ms: debut.elapsed().as_millis() as u64,
        erreur: message_echec(statut_ok, statut.as_u16(), erreur_contenu),
    }
}

/// Choisit le message d'echec le plus utile.
///
/// L'ordre compte: sur un 404, le fragment est forcement absent puisque la page
/// n'existe pas. Annoncer "fragment absent" masquerait la cause reelle et
/// enverrait chercher un probleme de contenu la ou il n'y a pas de fichier.
fn message_echec(statut_ok: bool, statut: u16, erreur_contenu: Option<String>) -> Option<String> {
    if !statut_ok {
        return Some(format!("statut HTTP {statut}"));
    }
    erreur_contenu
}

const TAILLE_EXTRAIT: usize = 4000;
const TAILLE_MAX_ICONE: usize = 200 * 1024;
const MAX_REDIRECTIONS: usize = 10;

#[derive(serde::Serialize, Default)]
pub struct Inspection {
    url_demandee: String,
    methode: String,
    entetes_requete: Vec<(String, String)>,
    /// Chaque saut de redirection: "301 https://a -> https://b"
    redirections: Vec<String>,
    statut: Option<u16>,
    statut_texte: Option<String>,
    version_http: Option<String>,
    entetes_reponse: Vec<(String, String)>,
    content_type: Option<String>,
    taille: Option<usize>,
    duree_ms: u64,
    url_finale: Option<String>,
    extrait: Option<String>,
    tronque: bool,
    certificat: Option<ResultatCertificat>,
    erreur: Option<String>,
}

/// Rejoue une URL et renvoie TOUT ce qui aide a comprendre un echec:
/// requete envoyee, redirections suivies, reponse complete et certificat.
///
/// Un "fragment absent" ne dit pas si la page est vide, si c'est une erreur
/// deguisee en 200, ou si un SPA a renvoye son index.html pour une URL inconnue.
/// Les en-tetes et le debut du corps tranchent immediatement.
#[tauri::command]
async fn inspecter_url(url: String) -> Inspection {
    let debut = Instant::now();
    let agent = concat!("SiteDashboard/", env!("CARGO_PKG_VERSION"));

    let mut vue = Inspection {
        url_demandee: url.clone(),
        methode: "GET".to_string(),
        entetes_requete: vec![
            ("user-agent".to_string(), agent.to_string()),
            ("accept".to_string(), "*/*".to_string()),
        ],
        ..Default::default()
    };

    // Redirections suivies a la main: reqwest les avale silencieusement, alors
    // qu'un saut inattendu (http -> https, ajout de www) est souvent l'explication.
    let client = match reqwest::Client::builder()
        .timeout(DELAI_CHECK)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(agent)
        .build()
    {
        Ok(client) => client,
        Err(e) => {
            vue.erreur = Some(e.to_string());
            return vue;
        }
    };

    let mut courante = url.clone();
    let reponse = loop {
        let reponse = match client.get(&courante).header("accept", "*/*").send().await {
            Ok(reponse) => reponse,
            Err(e) => {
                vue.erreur = Some(message_erreur(&e));
                vue.duree_ms = debut.elapsed().as_millis() as u64;
                return vue;
            }
        };

        if !reponse.status().is_redirection() {
            break reponse;
        }

        let cible = reponse
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);

        let Some(cible) = cible else {
            break reponse;
        };

        let absolue = url::Url::parse(&courante)
            .ok()
            .and_then(|base| base.join(&cible).ok())
            .map(|u| u.to_string())
            .unwrap_or(cible);

        vue.redirections
            .push(format!("{} {} -> {}", reponse.status().as_u16(), courante, absolue));

        if vue.redirections.len() >= MAX_REDIRECTIONS {
            vue.erreur = Some(format!("plus de {MAX_REDIRECTIONS} redirections"));
            vue.duree_ms = debut.elapsed().as_millis() as u64;
            return vue;
        }
        courante = absolue;
    };

    let statut = reponse.status();
    vue.statut = Some(statut.as_u16());
    vue.statut_texte = statut.canonical_reason().map(str::to_string);
    vue.version_http = Some(format!("{:?}", reponse.version()));
    vue.url_finale = Some(reponse.url().to_string());
    vue.entetes_reponse = reponse
        .headers()
        .iter()
        .map(|(nom, valeur)| {
            (
                nom.to_string(),
                valeur.to_str().unwrap_or("(valeur non textuelle)").to_string(),
            )
        })
        .collect();
    vue.content_type = reponse
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    // Le certificat fait partie des "infos utiles": inutile d'ouvrir un second
    // ecran pour savoir que la panne vient d'une expiration.
    if courante.starts_with("https://") {
        vue.certificat = lire_certificat(&courante).await.ok();
    }

    match reponse.text().await {
        Ok(corps) => {
            // On tronque sur une frontiere de caractere: un index d'octet
            // couperait un caractere accentue en deux et produirait du charabia.
            let extrait: String = corps.chars().take(TAILLE_EXTRAIT).collect();
            vue.tronque = extrait.len() < corps.len();
            vue.taille = Some(corps.len());
            vue.extrait = Some(extrait);
        }
        Err(e) => vue.erreur = Some(message_erreur(&e)),
    }

    vue.duree_ms = debut.elapsed().as_millis() as u64;
    vue
}

fn data_uri(type_mime: &str, octets: &[u8]) -> String {
    use base64::Engine;
    format!(
        "data:{};base64,{}",
        type_mime,
        base64::engine::general_purpose::STANDARD.encode(octets)
    )
}

async fn telecharger_icone(client: &reqwest::Client, url: &url::Url) -> Option<String> {
    let reponse = client.get(url.clone()).send().await.ok()?;
    if !reponse.status().is_success() {
        return None;
    }

    let type_mime = reponse
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or(v).trim().to_string())
        .unwrap_or_else(|| "image/x-icon".to_string());

    // Un SPA renvoie souvent son index.html pour une URL inconnue: sans ce
    // garde-fou on stockerait une page HTML en guise d'icone.
    if !type_mime.starts_with("image/") {
        return None;
    }

    let octets = reponse.bytes().await.ok()?;
    if octets.is_empty() || octets.len() > TAILLE_MAX_ICONE {
        return None;
    }
    Some(data_uri(&type_mime, &octets))
}

/// Recupere l'icone d'un site: `<link rel="icon">` de la page, sinon /favicon.ico.
#[tauri::command]
async fn recuperer_favicon(url: String) -> Option<String> {
    let base = url::Url::parse(&url).ok()?;
    let client = reqwest::Client::builder()
        .timeout(DELAI_CHECK)
        .user_agent(concat!("SiteDashboard/", env!("CARGO_PKG_VERSION")))
        .build()
        .ok()?;

    // Lecture volontairement sommaire du HTML: on cherche un <link rel=...icon...>
    // sans embarquer un parseur complet. En cas d'echec, /favicon.ico prend le relais.
    if let Ok(reponse) = client.get(base.clone()).send().await {
        if let Ok(html) = reponse.text().await {
            for balise in html.split('<').filter(|b| b.to_lowercase().starts_with("link")) {
                let minuscule = balise.to_lowercase();
                if !minuscule.contains("icon") {
                    continue;
                }
                if let Some(href) = valeur_attribut(balise, "href") {
                    if let Ok(cible) = base.join(&href) {
                        if let Some(icone) = telecharger_icone(&client, &cible).await {
                            return Some(icone);
                        }
                    }
                }
            }
        }
    }

    let defaut = base.join("/favicon.ico").ok()?;
    telecharger_icone(&client, &defaut).await
}

/// Extrait la valeur d'un attribut HTML, en gerant guillemets simples et doubles.
fn valeur_attribut(balise: &str, attribut: &str) -> Option<String> {
    let minuscule = balise.to_lowercase();
    let debut = minuscule.find(&format!("{attribut}="))? + attribut.len() + 1;
    let reste = &balise[debut..];
    let delimiteur = reste.chars().next()?;

    if delimiteur == '"' || delimiteur == '\'' {
        let fin = reste[1..].find(delimiteur)?;
        Some(reste[1..=fin].to_string())
    } else {
        Some(
            reste
                .split([' ', '>', '\n', '\t'])
                .next()
                .unwrap_or("")
                .to_string(),
        )
    }
}

/// Importe une image locale comme icone, quand la recuperation automatique echoue.
#[tauri::command]
fn importer_image(chemin: String) -> Result<String, String> {
    let octets = std::fs::read(&chemin).map_err(|e| e.to_string())?;
    if octets.len() > TAILLE_MAX_ICONE {
        return Err(format!(
            "image trop lourde ({} Ko, maximum {} Ko)",
            octets.len() / 1024,
            TAILLE_MAX_ICONE / 1024
        ));
    }

    let type_mime = match std::path::Path::new(&chemin)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("svg") => "image/svg+xml",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        _ => return Err("format non supporte (png, jpg, svg, gif, webp, ico)".to_string()),
    };

    Ok(data_uri(type_mime, &octets))
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

#[derive(serde::Serialize, Default, Clone)]
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
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            chemin_base,
            executer_check,
            verifier_certificat,
            inspecter_url,
            recuperer_favicon,
            importer_image,
            tracer
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lit_un_attribut_entre_guillemets_doubles() {
        let balise = r#"link rel="icon" href="/favicon.png""#;
        assert_eq!(valeur_attribut(balise, "href").as_deref(), Some("/favicon.png"));
    }

    #[test]
    fn lit_un_attribut_entre_guillemets_simples() {
        let balise = "link rel='shortcut icon' href='/icone.ico'";
        assert_eq!(valeur_attribut(balise, "href").as_deref(), Some("/icone.ico"));
    }

    #[test]
    fn lit_un_attribut_sans_guillemets() {
        let balise = "link rel=icon href=/favicon.svg >";
        assert_eq!(valeur_attribut(balise, "href").as_deref(), Some("/favicon.svg"));
    }

    #[test]
    fn tolere_une_casse_inhabituelle() {
        let balise = r#"LINK REL="ICON" HREF="/Favicon.PNG""#;
        assert_eq!(valeur_attribut(balise, "href").as_deref(), Some("/Favicon.PNG"));
    }

    #[test]
    fn renvoie_none_quand_l_attribut_est_absent() {
        assert_eq!(valeur_attribut(r#"link rel="icon""#, "href"), None);
    }

    #[test]
    fn signale_le_statut_avant_le_fragment() {
        // Cas reel rencontre: un /config.js inexistant renvoyait 404, et le check
        // annoncait "fragment absent" - ce qui envoyait chercher un probleme de
        // contenu alors que le fichier n'existe simplement pas.
        let message = message_echec(false, 404, Some("fragment absent: window.".to_string()));
        assert_eq!(message.as_deref(), Some("statut HTTP 404"));
    }

    #[test]
    fn signale_le_fragment_quand_le_statut_est_bon() {
        let message = message_echec(true, 200, Some("fragment absent: window.".to_string()));
        assert_eq!(message.as_deref(), Some("fragment absent: window."));
    }

    #[test]
    fn ne_signale_rien_quand_tout_va_bien() {
        assert_eq!(message_echec(true, 200, None), None);
    }

    #[test]
    fn construit_un_data_uri_valide() {
        assert_eq!(data_uri("image/png", b"ab"), "data:image/png;base64,YWI=");
    }

    /// Reproduit le cas signale: un fichier attendu qui repond 200 en HTML.
    /// C'est exactement ce que le bouton de diagnostic doit rendre visible.
    #[tokio::test]
    #[ignore]
    async fn inspecte_une_vraie_url() {
        let vue = inspecter_url("https://example.com/".to_string()).await;

        assert_eq!(vue.statut, Some(200), "erreur: {:?}", vue.erreur);
        assert_eq!(vue.methode, "GET");
        assert!(vue.content_type.unwrap().contains("html"));
        assert!(vue.extrait.unwrap().contains("<"));

        // Tout ce qui doit se retrouver dans le rapport copie
        assert!(!vue.entetes_requete.is_empty(), "en-tetes de requete absents");
        assert!(!vue.entetes_reponse.is_empty(), "en-tetes de reponse absents");
        assert!(vue.statut_texte.is_some(), "libelle de statut absent");
        assert!(vue.version_http.is_some(), "version HTTP absente");
        assert!(vue.url_finale.is_some(), "URL finale absente");

        // En https, le certificat fait partie des informations utiles
        let cert = vue.certificat.expect("certificat non lu en https");
        assert!(cert.jours_restants.unwrap() > 0, "certificat deja expire ?");
    }

    /// Une redirection doit apparaitre dans la chaine, pas etre avalee.
    #[tokio::test]
    #[ignore]
    async fn trace_les_redirections() {
        let vue = inspecter_url("http://github.com/".to_string()).await;
        assert!(
            !vue.redirections.is_empty(),
            "aucune redirection tracee alors que http doit rediriger vers https"
        );
        assert!(vue.url_finale.unwrap().starts_with("https://"));
    }

    /// Test reseau: ignore par defaut pour que `cargo test` reste hors ligne.
    /// A lancer avec `cargo test -- --ignored` pour verifier le chemin reel.
    #[tokio::test]
    #[ignore]
    async fn recupere_une_vraie_icone() {
        let icone = recuperer_favicon("https://github.com".to_string()).await;
        let icone = icone.expect("aucune icone recuperee");
        assert!(icone.starts_with("data:image/"), "data URI inattendu: {}", &icone[..40]);
        assert!(icone.len() > 100);
    }
}
