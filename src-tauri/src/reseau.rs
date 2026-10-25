//! Le client HTTP partage par tous les checks, et les petits outils reseau communs.

use std::sync::OnceLock;
use std::time::Duration;

pub(crate) const DELAI_CHECK: Duration = Duration::from_secs(15);

/// Traduit les erreurs reseau en message court et lisible dans l'UI:
/// `reqwest::Error` en Debug est une chaine interminable inexploitable telle quelle.
pub(crate) fn message_erreur(e: &reqwest::Error) -> String {
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

pub(crate) const AGENT: &str = concat!("SiteDashboard/", env!("CARGO_PKG_VERSION"));

/// Clients HTTP partages, un par politique de redirection.
///
/// Un client neuf a chaque check ouvrait une connexion et refaisait une poignee
/// de main TLS complete, pour chaque check et chaque minute. Un `reqwest::Client`
/// garde ses connexions ouvertes (90 s sans activite) : avec un cycle a la
/// minute, les checks suivants les reutilisent. Le cloner ne coute qu'un compteur.
static CLIENT_SUIVI: OnceLock<reqwest::Client> = OnceLock::new();
static CLIENT_SANS_SUIVI: OnceLock<reqwest::Client> = OnceLock::new();

/// Client HTTP commun a tous les checks. `suivre` a false coupe le suivi
/// automatique des redirections, indispensable des qu'on veut les OBSERVER:
/// reqwest les avale sinon, et rapporte le statut final.
pub(crate) fn client_http(suivre: bool) -> Result<reqwest::Client, String> {
    let cellule = if suivre { &CLIENT_SUIVI } else { &CLIENT_SANS_SUIVI };
    if let Some(client) = cellule.get() {
        return Ok(client.clone());
    }
    let politique = if suivre {
        reqwest::redirect::Policy::default()
    } else {
        reqwest::redirect::Policy::none()
    };
    // Un echec de construction n'est pas memorise : le prochain appel reessaie.
    let client = reqwest::Client::builder()
        .timeout(DELAI_CHECK)
        .redirect(politique)
        .user_agent(AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(cellule.get_or_init(|| client).clone())
}

pub(crate) fn entetes_de(entetes: &reqwest::header::HeaderMap) -> Vec<(String, String)> {
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
pub(crate) fn resoudre_cible(base: &str, cible: &str) -> String {
    url::Url::parse(base)
        .ok()
        .and_then(|base| base.join(cible).ok())
        .map(|u| u.to_string())
        .unwrap_or_else(|| cible.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
