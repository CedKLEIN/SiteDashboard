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

const AGENT: &str = concat!("SiteDashboard/", env!("CARGO_PKG_VERSION"));

/// Client HTTP commun a tous les checks. `suivre` a false coupe le suivi
/// automatique des redirections, indispensable des qu'on veut les OBSERVER:
/// reqwest les avale sinon, et rapporte le statut final.
fn client_http(suivre: bool) -> Result<reqwest::Client, String> {
    let politique = if suivre {
        reqwest::redirect::Policy::default()
    } else {
        reqwest::redirect::Policy::none()
    };
    reqwest::Client::builder()
        .timeout(DELAI_CHECK)
        .redirect(politique)
        .user_agent(AGENT)
        .build()
        .map_err(|e| e.to_string())
}

fn entetes_de(entetes: &reqwest::header::HeaderMap) -> Vec<(String, String)> {
    entetes
        .iter()
        .map(|(nom, valeur)| {
            (
                nom.to_string(),
                valeur.to_str().unwrap_or("(valeur non textuelle)").to_string(),
            )
        })
        .collect()
}

/// Resout un `Location` relatif contre l'URL qui l'a renvoye.
fn resoudre_cible(base: &str, cible: &str) -> String {
    url::Url::parse(base)
        .ok()
        .and_then(|base| base.join(cible).ok())
        .map(|u| u.to_string())
        .unwrap_or_else(|| cible.to_string())
}

/// Les FAITS d'une reponse HTTP: statut, en-tetes, taille, occurrences.
///
/// Aucun verdict ici. Rust constate, JS juge (voir `src/lib/assertions.js`).
/// C'est deja le partage de `verifier_certificat` + `evaluerCertificat`, et
/// c'est lui qui rend toutes les regles testables sans reseau, dans vitest.
#[derive(serde::Serialize, Default)]
pub struct ReponseCheck {
    statut: Option<u16>,
    latence_ms: u64,
    /// Erreur RESEAU uniquement: une assertion en defaut n'en est pas une ici.
    erreur: Option<String>,
    entetes: Vec<(String, String)>,
    /// Taille du corps DECODE, renseignee seulement si le corps a ete lu.
    taille: Option<usize>,
    /// Nombre d'apparitions de `doit_contenir`, si un fragment a ete demande.
    occurrences: Option<usize>,
}

/// Execute un check HTTP. Ne renvoie jamais Err: un site injoignable est un
/// resultat de supervision normal, pas une erreur de l'appli.
#[tauri::command]
async fn executer_check(
    url: String,
    doit_contenir: Option<String>,
    lire_corps: bool,
) -> ReponseCheck {
    let debut = Instant::now();

    let client = match client_http(true) {
        Ok(client) => client,
        Err(e) => {
            return ReponseCheck {
                erreur: Some(e),
                ..Default::default()
            }
        }
    };

    let reponse = match client.get(&url).send().await {
        Ok(reponse) => reponse,
        Err(e) => {
            return ReponseCheck {
                latence_ms: debut.elapsed().as_millis() as u64,
                erreur: Some(message_erreur(&e)),
                ..Default::default()
            }
        }
    };

    let mut vue = ReponseCheck {
        statut: Some(reponse.status().as_u16()),
        entetes: entetes_de(reponse.headers()),
        ..Default::default()
    };

    // Le corps n'etait telecharge que si un fragment etait attendu. Une taille
    // minimale seule serait alors silencieusement ignoree: `lire_corps` dit
    // qu'une assertion porte dessus, meme sans fragment.
    let fragment = doit_contenir.filter(|f| !f.is_empty());
    if lire_corps || fragment.is_some() {
        match reponse.text().await {
            Ok(corps) => {
                // Comptage non chevauchant, c'est ce qu'on veut compter ici.
                vue.occurrences = fragment.as_deref().map(|f| corps.matches(f).count());
                // Octets du corps DECODE: gzip est actif et Content-Length est
                // absent en chunked, comparer l'en-tete serait un piege.
                vue.taille = Some(corps.len());
            }
            Err(e) => vue.erreur = Some(message_erreur(&e)),
        }
    }

    vue.latence_ms = debut.elapsed().as_millis() as u64;
    vue
}

#[derive(serde::Serialize, Default)]
pub struct ReponseRedirection {
    statut: Option<u16>,
    /// `Location` du PREMIER saut, resolu en absolu.
    cible: Option<String>,
    latence_ms: u64,
    erreur: Option<String>,
}

/// Observe la redirection d'une URL, sans la suivre.
///
/// Le cas qui a motive ce type de check: www.denivio.fr servait le site en 200
/// au lieu de rediriger. Un check HTTP classique serait passe au vert - le bug
/// ETAIT le 200 - et `statut_attendu = 301` n'y aurait rien change, puisque
/// reqwest suit les redirections et rapporte le statut final.
///
/// Un seul saut, volontairement: le defaut qu'on traque est "ca ne redirige
/// plus du tout", et une assertion sur la destination finale masquerait un saut
/// intermediaire ajoute entre-temps. Une cible egale a l'URL de depart est une
/// boucle, detectee gratuitement cote JS.
#[tauri::command]
async fn executer_redirection(url: String) -> ReponseRedirection {
    let debut = Instant::now();

    let client = match client_http(false) {
        Ok(client) => client,
        Err(e) => {
            return ReponseRedirection {
                erreur: Some(e),
                ..Default::default()
            }
        }
    };

    let reponse = match client.get(&url).send().await {
        Ok(reponse) => reponse,
        Err(e) => {
            return ReponseRedirection {
                latence_ms: debut.elapsed().as_millis() as u64,
                erreur: Some(message_erreur(&e)),
                ..Default::default()
            }
        }
    };

    let cible = reponse
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .map(|cible| resoudre_cible(&url, cible));

    ReponseRedirection {
        statut: Some(reponse.status().as_u16()),
        cible,
        latence_ms: debut.elapsed().as_millis() as u64,
        erreur: None,
    }
}

#[derive(serde::Serialize, Default)]
pub struct ReponseValeur {
    valeur: Option<String>,
    statut: Option<u16>,
    latence_ms: u64,
    erreur: Option<String>,
}

/// Extrait une chaine d'une reponse: `json:chemin.pointe` ou `regex:motif`.
///
/// Pour une expression reguliere, c'est le groupe capturant n.1 qui est lu -
/// la correspondance entiere a defaut de groupe. Un motif sans groupe reste
/// donc utilisable pour une valeur qui se suffit a elle-meme.
fn extraire_valeur(corps: &str, extracteur: &str) -> Result<String, String> {
    if let Some(chemin) = extracteur.strip_prefix("json:") {
        let racine: serde_json::Value =
            serde_json::from_str(corps).map_err(|e| format!("JSON illisible: {e}"))?;
        let mut courant = &racine;
        for cle in chemin.split('.') {
            courant = courant
                .get(cle)
                .ok_or_else(|| format!("champ absent: {chemin}"))?;
        }
        return Ok(match courant {
            // Une chaine JSON rendue par `to_string` arriverait entre guillemets.
            serde_json::Value::String(texte) => texte.clone(),
            autre => autre.to_string(),
        });
    }

    if let Some(motif) = extracteur.strip_prefix("regex:") {
        let expression =
            regex::Regex::new(motif).map_err(|e| format!("motif invalide: {e}"))?;
        let capture = expression
            .captures(corps)
            .ok_or_else(|| "motif introuvable".to_string())?;
        let trouvee = capture.get(1).or_else(|| capture.get(0));
        return trouvee
            .map(|m| m.as_str().to_string())
            .ok_or_else(|| "motif introuvable".to_string());
    }

    Err(format!(
        "extracteur inconnu: {extracteur} (attendu 'json:...' ou 'regex:...')"
    ))
}

/// Lit une valeur publiee par un site - typiquement le `buildId` de /version.json.
/// Ne rend aucun verdict: un retard de deploiement est une information, pas une panne.
#[tauri::command]
async fn lire_valeur(url: String, extracteur: String) -> ReponseValeur {
    let debut = Instant::now();

    let client = match client_http(true) {
        Ok(client) => client,
        Err(e) => {
            return ReponseValeur {
                erreur: Some(e),
                ..Default::default()
            }
        }
    };

    let reponse = match client.get(&url).send().await {
        Ok(reponse) => reponse,
        Err(e) => {
            return ReponseValeur {
                latence_ms: debut.elapsed().as_millis() as u64,
                erreur: Some(message_erreur(&e)),
                ..Default::default()
            }
        }
    };

    let statut = reponse.status().as_u16();
    let (valeur, erreur) = match reponse.text().await {
        Ok(corps) => match extraire_valeur(&corps, &extracteur) {
            Ok(valeur) => (Some(valeur), None),
            Err(e) => (None, Some(e)),
        },
        Err(e) => (None, Some(message_erreur(&e))),
    };

    ReponseValeur {
        valeur,
        statut: Some(statut),
        latence_ms: debut.elapsed().as_millis() as u64,
        erreur,
    }
}

/// Jours ecoules depuis le 1970-01-01 pour une date civile.
///
/// Algorithme de Howard Hinnant (days_from_civil): trois soustractions ne
/// justifient pas d'embarquer une bibliotheque de dates.
fn jours_depuis_epoque(annee: i64, mois: i64, jour: i64) -> i64 {
    let annee = if mois <= 2 { annee - 1 } else { annee };
    let ere = if annee >= 0 { annee } else { annee - 399 } / 400;
    let annee_ere = annee - ere * 400; // [0, 399]
    let mois_decale = if mois > 2 { mois - 3 } else { mois + 9 };
    let jour_annee = (153 * mois_decale + 2) / 5 + jour - 1; // [0, 365]
    let jour_ere = annee_ere * 365 + annee_ere / 4 - annee_ere / 100 + jour_annee;
    ere * 146_097 + jour_ere - 719_468
}

/// Jours restants avant une date ISO 8601 ("2027-04-05T09:23:12Z").
/// Negatif si la date est passee, comme `ResultatCertificat::jours_restants`.
fn jours_jusqua(date_iso: &str) -> Result<i64, String> {
    let illisible = || format!("date illisible: {date_iso}");
    let jour = date_iso.get(..10).ok_or_else(illisible)?;
    let mut parties = jour.split('-').map(|p| p.parse::<i64>());

    let annee = parties.next().and_then(Result::ok).ok_or_else(illisible)?;
    let mois = parties.next().and_then(Result::ok).ok_or_else(illisible)?;
    let jour_du_mois = parties.next().and_then(Result::ok).ok_or_else(illisible)?;

    let aujourdhui = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64
        / 86_400;

    Ok(jours_depuis_epoque(annee, mois, jour_du_mois) - aujourdhui)
}

#[derive(serde::Serialize, Default)]
pub struct ReponseDomaine {
    /// Adresses A/AAAA resolues, dans l'ordre de reponse du resolveur.
    adresses: Vec<String>,
    expire_le: Option<String>,
    /// Negatif si le domaine est deja expire.
    jours_restants: Option<i64>,
    latence_ms: u64,
    /// Echec de resolution DNS: le domaine ne pointe nulle part.
    erreur: Option<String>,
    /// Echec cote RDAP seulement. Un TLD sans serveur RDAP n'est pas une panne
    /// du domaine: le verdict DNS doit continuer de s'appliquer.
    erreur_expiration: Option<String>,
}

/// Date d'expiration d'un domaine via RDAP, successeur de WHOIS: JSON sur une
/// API publique, sans cle. `rdap.org` redirige vers le registre competent.
async fn lire_expiration_rdap(
    client: &reqwest::Client,
    domaine: &str,
) -> Result<(String, i64), String> {
    let reponse = client
        .get(format!("https://rdap.org/domain/{domaine}"))
        .header("accept", "application/rdap+json")
        .send()
        .await
        .map_err(|e| message_erreur(&e))?;

    if reponse.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("aucun serveur RDAP pour ce domaine".to_string());
    }
    if !reponse.status().is_success() {
        return Err(format!("RDAP a repondu {}", reponse.status().as_u16()));
    }

    let texte = reponse.text().await.map_err(|e| message_erreur(&e))?;
    let corps: serde_json::Value = serde_json::from_str(&texte).map_err(|e| e.to_string())?;

    let date = corps
        .get("events")
        .and_then(serde_json::Value::as_array)
        .and_then(|evenements| {
            evenements.iter().find(|e| {
                e.get("eventAction").and_then(serde_json::Value::as_str) == Some("expiration")
            })
        })
        .and_then(|e| e.get("eventDate"))
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "le registre ne publie pas de date d'expiration".to_string())?;

    Ok((date.to_string(), jours_jusqua(date)?))
}

/// Ou pointe un domaine, et quand il expire.
///
/// L'argument est celui du certificat: l'expiration d'un nom de domaine est
/// entierement previsible, et se repare beaucoup moins vite.
///
/// La resolution passe par `tokio::net::lookup_host`, donc par le resolveur du
/// systeme: il CACHE, un changement peut mettre un TTL a apparaitre. C'est une
/// latence a connaitre, pas un bug a corriger.
#[tauri::command]
async fn verifier_domaine(domaine: String) -> ReponseDomaine {
    let debut = Instant::now();
    let mut vue = ReponseDomaine::default();

    // Le port n'a aucune importance ici: `lookup_host` exige une paire.
    match tokio::time::timeout(DELAI_CHECK, tokio::net::lookup_host((domaine.as_str(), 443))).await {
        Ok(Ok(adresses)) => {
            for adresse in adresses {
                let ip = adresse.ip().to_string();
                if !vue.adresses.contains(&ip) {
                    vue.adresses.push(ip);
                }
            }
            if vue.adresses.is_empty() {
                vue.erreur = Some("le domaine ne resout vers aucune adresse".to_string());
            }
        }
        Ok(Err(e)) => vue.erreur = Some(format!("resolution impossible: {e}")),
        Err(_) => vue.erreur = Some("delai depasse".to_string()),
    }

    match client_http(true) {
        Ok(client) => match lire_expiration_rdap(&client, &domaine).await {
            Ok((date, jours)) => {
                vue.expire_le = Some(date);
                vue.jours_restants = Some(jours);
            }
            Err(e) => vue.erreur_expiration = Some(e),
        },
        Err(e) => vue.erreur_expiration = Some(e),
    }

    vue.latence_ms = debut.elapsed().as_millis() as u64;
    vue
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

    let mut vue = Inspection {
        url_demandee: url.clone(),
        methode: "GET".to_string(),
        entetes_requete: vec![
            ("user-agent".to_string(), AGENT.to_string()),
            ("accept".to_string(), "*/*".to_string()),
        ],
        ..Default::default()
    };

    // Redirections suivies a la main: reqwest les avale silencieusement, alors
    // qu'un saut inattendu (http -> https, ajout de www) est souvent l'explication.
    let client = match client_http(false) {
        Ok(client) => client,
        Err(e) => {
            vue.erreur = Some(e);
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

        let absolue = resoudre_cible(&courante, &cible);

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
    vue.entetes_reponse = entetes_de(reponse.headers());
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

/// Taux de change a une date donnee, via l'API Frankfurter (donnees BCE).
///
/// On demande le taux DU JOUR DE LA TRANSACTION et non le taux courant: un
/// revenu passe ne doit pas changer de valeur a chaque consultation.
/// L'API renvoie le dernier jour ouvre si la date tombe un week-end.
#[tauri::command]
async fn taux_change(date: String, de: String, vers: String) -> Result<f64, String> {
    if de == vers {
        return Ok(1.0);
    }

    let client = client_http(true)?;

    let url = format!("https://api.frankfurter.app/{date}?from={de}&to={vers}");
    let reponse = client.get(&url).send().await.map_err(|e| message_erreur(&e))?;

    if !reponse.status().is_success() {
        return Err(format!("taux indisponible (HTTP {})", reponse.status().as_u16()));
    }

    // On passe par le texte plutot que par `Response::json`, qui exige la
    // feature `json` de reqwest desactivee ici; serde_json est deja present.
    let texte = reponse.text().await.map_err(|e| message_erreur(&e))?;
    let corps: serde_json::Value = serde_json::from_str(&texte).map_err(|e| e.to_string())?;
    corps
        .get("rates")
        .and_then(|r| r.get(&vers))
        .and_then(serde_json::Value::as_f64)
        .ok_or_else(|| format!("aucun taux {de} vers {vers} pour le {date}"))
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
    let client = client_http(true).ok()?;

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

/// Un rapport d'agent depasse rarement quelques Ko: au-dela, c'est un fichier
/// qui n'a rien a faire la, et le lire bloquerait l'ecran pour rien.
const TAILLE_MAX_RAPPORT: u64 = 256 * 1024;

#[derive(serde::Serialize, Default)]
struct FichierRapport {
    chemin: String,
    contenu: Option<String>,
    erreur: Option<String>,
}

#[derive(serde::Serialize, Default)]
struct DossierRapports {
    dossier: String,
    existe: bool,
    fichiers: Vec<FichierRapport>,
}

/// Dossier commun ou les agents planifies deposent leurs rapports:
/// `~/.claude/rapports-agents/<site>/<AAAA-MM-JJ>/<agent>.json`.
fn dossier_rapports(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(home.join(".claude").join("rapports-agents"))
}

/// Les sous-dossiers d'un dossier, tries par nom. Un dossier illisible est
/// traite comme vide: un site sans rapport ne doit pas faire echouer les autres.
fn sous_dossiers(dossier: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut liste: Vec<_> = std::fs::read_dir(dossier)
        .map(|entrees| {
            entrees
                .filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect()
        })
        .unwrap_or_default();
    liste.sort();
    liste
}

/// Lit les rapports d'agents depuis `depuis` (date ISO incluse).
///
/// Rust constate, JS juge: on renvoie le texte brut de chaque fichier, et c'est
/// `src/lib/rapportsAgents.js` qui le valide et en tire un verdict. Un fichier
/// illisible remonte avec son erreur au lieu d'etre ignore: un agent qui ecrit
/// un rapport casse doit se voir, pas disparaitre de l'ecran.
#[tauri::command]
fn lire_rapports_agents(app: tauri::AppHandle, depuis: String) -> Result<DossierRapports, String> {
    Ok(lire_rapports(&dossier_rapports(&app)?, &depuis))
}

fn lire_rapports(racine: &std::path::Path, depuis: &str) -> DossierRapports {
    let mut resultat = DossierRapports {
        dossier: racine.to_string_lossy().into_owned(),
        existe: racine.is_dir(),
        ..Default::default()
    };

    for dossier_site in sous_dossiers(racine) {
        for dossier_jour in sous_dossiers(&dossier_site) {
            let jour = dossier_jour
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            // Les noms sont des dates ISO: l'ordre lexicographique est l'ordre chronologique
            if jour.len() != 10 || jour < depuis {
                continue;
            }
            let Ok(entrees) = std::fs::read_dir(&dossier_jour) else {
                continue;
            };
            for entree in entrees.filter_map(Result::ok) {
                let chemin = entree.path();
                let est_json = chemin
                    .extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| e.eq_ignore_ascii_case("json"));
                if !est_json || !chemin.is_file() {
                    continue;
                }
                let mut fichier = FichierRapport {
                    chemin: chemin.to_string_lossy().into_owned(),
                    ..Default::default()
                };
                match entree.metadata() {
                    Ok(m) if m.len() > TAILLE_MAX_RAPPORT => {
                        fichier.erreur = Some(format!("fichier trop lourd ({} Ko)", m.len() / 1024));
                    }
                    _ => match std::fs::read_to_string(&chemin) {
                        Ok(texte) => fichier.contenu = Some(texte),
                        Err(e) => fichier.erreur = Some(e.to_string()),
                    },
                }
                resultat.fichiers.push(fichier);
            }
        }
    }

    resultat
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
            executer_redirection,
            lire_valeur,
            verifier_domaine,
            verifier_certificat,
            inspecter_url,
            recuperer_favicon,
            importer_image,
            lire_rapports_agents,
            taux_change,
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
    fn lit_les_rapports_d_agents_depuis_une_date() {
        let racine = std::env::temp_dir().join(format!("rapports-agents-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&racine);
        let ecrire = |chemin: &str, contenu: &str| {
            let p = racine.join(chemin);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, contenu).unwrap();
        };
        ecrire("denivio.fr/2026-10-24/sante.json", r#"{"statut":"ok"}"#);
        ecrire("denivio.fr/2026-10-24/notes.md", "pas un rapport");
        ecrire("denivio.fr/2026-09-01/ancien.json", r#"{"statut":"ok"}"#);
        ecrire("denivio.fr/brouillon/x.json", "{}");

        let resultat = lire_rapports(&racine, "2026-10-01");
        let _ = std::fs::remove_dir_all(&racine);

        assert!(resultat.existe);
        assert_eq!(resultat.fichiers.len(), 1);
        assert!(resultat.fichiers[0].chemin.ends_with("sante.json"));
        assert_eq!(resultat.fichiers[0].contenu.as_deref(), Some(r#"{"statut":"ok"}"#));
    }

    #[test]
    fn un_dossier_de_rapports_absent_n_est_pas_une_erreur() {
        let resultat = lire_rapports(std::path::Path::new("Z:/n-existe/pas"), "2026-01-01");
        assert!(!resultat.existe);
        assert!(resultat.fichiers.is_empty());
    }

    #[test]
    fn construit_un_data_uri_valide() {
        assert_eq!(data_uri("image/png", b"ab"), "data:image/png;base64,YWI=");
    }

    // La priorite des messages d'echec vit desormais dans src/lib/assertions.js,
    // avec les autres assertions: Rust constate, JS juge. Les tests
    // correspondants sont dans src/lib/assertions.test.js.

    #[test]
    fn resout_une_cible_relative_contre_son_origine() {
        assert_eq!(
            resoudre_cible("https://www.denivio.fr/a/b", "/c"),
            "https://www.denivio.fr/c"
        );
    }

    #[test]
    fn laisse_une_cible_absolue_intacte() {
        assert_eq!(
            resoudre_cible("https://www.denivio.fr/", "https://denivio.fr/"),
            "https://denivio.fr/"
        );
    }

    #[test]
    fn lit_une_valeur_json_en_profondeur() {
        let corps = r#"{"build": {"id": "a1b2c3"}, "n": 7}"#;
        assert_eq!(extraire_valeur(corps, "json:build.id").unwrap(), "a1b2c3");
        // Un nombre ne doit pas revenir entoure de guillemets
        assert_eq!(extraire_valeur(corps, "json:n").unwrap(), "7");
    }

    #[test]
    fn signale_un_champ_json_absent_sans_paniquer() {
        let erreur = extraire_valeur(r#"{"a": 1}"#, "json:b.c").unwrap_err();
        assert!(erreur.contains("champ absent"), "message inattendu: {erreur}");
    }

    #[test]
    fn lit_le_premier_groupe_capturant() {
        let corps = "window.__BUILD__ = \"2026-09-17.4\";";
        let valeur = extraire_valeur(corps, r#"regex:__BUILD__ = "([^"]+)""#).unwrap();
        assert_eq!(valeur, "2026-09-17.4");
    }

    #[test]
    fn refuse_un_extracteur_sans_prefixe_connu() {
        assert!(extraire_valeur("{}", "buildId").is_err());
    }

    #[test]
    fn compte_les_jours_depuis_l_epoque() {
        assert_eq!(jours_depuis_epoque(1970, 1, 1), 0);
        assert_eq!(jours_depuis_epoque(1970, 1, 2), 1);
        // 2024 est bissextile: le 29 fevrier doit exister
        assert_eq!(
            jours_depuis_epoque(2024, 3, 1) - jours_depuis_epoque(2024, 2, 28),
            2
        );
        assert_eq!(jours_depuis_epoque(2000, 1, 1), 10_957);
    }

    #[test]
    fn mesure_l_ecart_a_une_date_iso() {
        let aujourdhui = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
            / 86_400;
        let dans_dix_jours = aujourdhui + 10;
        // On reconstruit une date civile a partir du jour vise, pour ne pas
        // ecrire une date en dur qui perimerait.
        let (annee, mois, jour) = date_civile(dans_dix_jours);
        let iso = format!("{annee:04}-{mois:02}-{jour:02}T00:00:00Z");
        assert_eq!(jours_jusqua(&iso).unwrap(), 10);
    }

    #[test]
    fn rejette_une_date_illisible() {
        assert!(jours_jusqua("bientot").is_err());
    }

    /// Inverse de `jours_depuis_epoque`, utilise uniquement par les tests.
    fn date_civile(jours: i64) -> (i64, i64, i64) {
        let jours = jours + 719_468;
        let ere = if jours >= 0 { jours } else { jours - 146_096 } / 146_097;
        let jour_ere = jours - ere * 146_097;
        let annee_ere =
            (jour_ere - jour_ere / 1460 + jour_ere / 36524 - jour_ere / 146_096) / 365;
        let annee = annee_ere + ere * 400;
        let jour_annee = jour_ere - (365 * annee_ere + annee_ere / 4 - annee_ere / 100);
        let mois_decale = (5 * jour_annee + 2) / 153;
        let jour = jour_annee - (153 * mois_decale + 2) / 5 + 1;
        let mois = if mois_decale < 10 {
            mois_decale + 3
        } else {
            mois_decale - 9
        };
        (if mois <= 2 { annee + 1 } else { annee }, mois, jour)
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

    /// Taux de change reel: on verifie qu'on interroge bien la date demandee.
    #[tokio::test]
    #[ignore]
    async fn recupere_un_vrai_taux() {
        let taux = taux_change("2026-03-02".to_string(), "USD".to_string(), "EUR".to_string())
            .await
            .expect("taux indisponible");
        // Un taux USD/EUR plausible: le test doit echouer si l'API change de
        // format et qu'on lit un champ qui n'a rien a voir.
        assert!(taux > 0.5 && taux < 1.5, "taux aberrant: {taux}");
    }

    #[tokio::test]
    async fn taux_identique_sans_appel_reseau() {
        let taux = taux_change("2026-03-02".to_string(), "EUR".to_string(), "EUR".to_string())
            .await
            .unwrap();
        assert_eq!(taux, 1.0);
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

    /// La redirection doit etre OBSERVEE, pas suivie: c'est tout l'interet du
    /// type, et ce qu'un check HTTP classique ne sait pas voir.
    #[tokio::test]
    #[ignore]
    async fn observe_une_vraie_redirection_sans_la_suivre() {
        let vue = executer_redirection("http://github.com/".to_string()).await;

        assert_eq!(vue.erreur, None);
        let statut = vue.statut.expect("aucun statut");
        assert!((300..400).contains(&statut), "statut inattendu: {statut}");
        assert!(
            vue.cible.unwrap().starts_with("https://"),
            "la cible devrait etre l'URL en https"
        );
    }

    /// Resolution DNS et expiration RDAP sur un domaine qui existera encore
    /// longtemps.
    #[tokio::test]
    #[ignore]
    async fn resout_un_vrai_domaine() {
        let vue = verifier_domaine("github.com".to_string()).await;

        assert_eq!(vue.erreur, None, "resolution DNS echouee");
        assert!(!vue.adresses.is_empty(), "aucune adresse resolue");
        assert!(
            vue.jours_restants.unwrap_or(0) > 0,
            "expiration non lue: {:?}",
            vue.erreur_expiration
        );
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
