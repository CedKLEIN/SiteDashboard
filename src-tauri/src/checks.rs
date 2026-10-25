//! Les checks HTTP : statut et corps, redirection observee, valeur extraite, inspection complete.

use std::time::Instant;

use crate::certificat::{lire_certificat, ResultatCertificat};
use crate::reseau::*;

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
pub async fn executer_check(
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
pub async fn executer_redirection(url: String) -> ReponseRedirection {
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
pub(crate) fn extraire_valeur(corps: &str, extracteur: &str) -> Result<String, String> {
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
pub async fn lire_valeur(url: String, extracteur: String) -> ReponseValeur {
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

pub(crate) const TAILLE_EXTRAIT: usize = 4000;
pub(crate) const MAX_REDIRECTIONS: usize = 10;

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
pub async fn inspecter_url(url: String) -> Inspection {
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
