//! Icones des sites et des fournisseurs, stockees en data URI.

use crate::reseau::*;

pub(crate) const TAILLE_MAX_ICONE: usize = 200 * 1024;

pub(crate) fn data_uri(type_mime: &str, octets: &[u8]) -> String {
    use base64::Engine;
    format!(
        "data:{};base64,{}",
        type_mime,
        base64::engine::general_purpose::STANDARD.encode(octets)
    )
}

pub(crate) async fn telecharger_icone(client: &reqwest::Client, url: &url::Url) -> Option<String> {
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
pub async fn recuperer_favicon(url: String) -> Option<String> {
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
pub(crate) fn valeur_attribut(balise: &str, attribut: &str) -> Option<String> {
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
pub fn importer_image(chemin: String) -> Result<String, String> {
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
    fn construit_un_data_uri_valide() {
        assert_eq!(data_uri("image/png", b"ab"), "data:image/png;base64,YWI=");
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
