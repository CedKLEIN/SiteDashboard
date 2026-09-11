-- Surveillance de l'expiration des certificats TLS.
--
-- Un certificat qui expire est l'une des rares pannes totalement previsibles:
-- le renouvellement automatique marche, jusqu'au jour ou il echoue en silence.
-- On veut donc alerter AVANT l'expiration, pas constater la panne.

-- 'http' = requete HTTP classique, 'tls' = inspection du certificat
ALTER TABLE checks ADD COLUMN type TEXT NOT NULL DEFAULT 'http';

-- Nombre de jours restants en dessous duquel le check echoue (checks 'tls').
-- 21 jours laisse le temps de reagir sur un cycle Let's Encrypt de 90 jours.
ALTER TABLE checks ADD COLUMN seuil_jours INTEGER;

-- Renseigne uniquement par les checks 'tls'
ALTER TABLE verifications ADD COLUMN jours_restants INTEGER;
