//! Checks de domaine : resolution DNS et expiration via RDAP.

use std::time::Instant;

use crate::reseau::*;

/// Jours ecoules depuis le 1970-01-01 pour une date civile.
///
/// Algorithme de Howard Hinnant (days_from_civil): trois soustractions ne
/// justifient pas d'embarquer une bibliotheque de dates.
pub(crate) fn jours_depuis_epoque(annee: i64, mois: i64, jour: i64) -> i64 {
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
pub(crate) fn jours_jusqua(date_iso: &str) -> Result<i64, String> {
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
pub(crate) async fn lire_expiration_rdap(
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
pub async fn verifier_domaine(domaine: String) -> ReponseDomaine {
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
