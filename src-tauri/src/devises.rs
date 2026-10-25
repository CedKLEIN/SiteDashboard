//! Taux de change des revenus en devise etrangere.

use crate::reseau::*;

/// Taux de change a une date donnee, via l'API Frankfurter (donnees BCE).
///
/// On demande le taux DU JOUR DE LA TRANSACTION et non le taux courant: un
/// revenu passe ne doit pas changer de valeur a chaque consultation.
/// L'API renvoie le dernier jour ouvre si la date tombe un week-end.
#[tauri::command]
pub async fn taux_change(date: String, de: String, vers: String) -> Result<f64, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
