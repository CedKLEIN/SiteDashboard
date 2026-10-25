//! Expiration du certificat TLS presente par un site.

use crate::reseau::DELAI_CHECK;

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
pub struct InspectionSansValidation;

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
    pub(crate) jours_restants: Option<i64>,
    pub(crate) expire_le: Option<String>,
    pub(crate) emetteur: Option<String>,
    pub(crate) erreur: Option<String>,
}

impl ResultatCertificat {
    fn echec(erreur: impl Into<String>) -> Self {
        Self {
            erreur: Some(erreur.into()),
            ..Default::default()
        }
    }
}

pub(crate) async fn lire_certificat(url: &str) -> Result<ResultatCertificat, String> {
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
pub async fn verifier_certificat(url: String) -> ResultatCertificat {
    match lire_certificat(&url).await {
        Ok(resultat) => resultat,
        Err(erreur) => ResultatCertificat::echec(erreur),
    }
}
