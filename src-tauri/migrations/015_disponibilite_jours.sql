-- Disponibilite resumee par jour et par check, gardee bien au-dela des 30 jours
-- de `verifications` (purgee : une ligne par check et par minute).
--
-- Sans ce resume, la fiche d'un site ne pouvait pas remonter au-dela d'un mois :
-- une panne de debut de trimestre disparaissait de l'historique. Un jour se
-- consolide une fois termine (voir `consoliderJours`) ; la ligne du jour en
-- cours se lit toujours dans `verifications`.
CREATE TABLE IF NOT EXISTS disponibilite_jours (
    check_id           INTEGER NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
    jour               TEXT    NOT NULL,
    total              INTEGER NOT NULL,
    ok                 INTEGER NOT NULL,
    latence_moyenne_ms INTEGER,
    PRIMARY KEY (check_id, jour)
);

-- Les jours deja termines encore presents dans l'historique
INSERT OR REPLACE INTO disponibilite_jours (check_id, jour, total, ok, latence_moyenne_ms)
SELECT check_id, substr(verifie_le, 1, 10), COUNT(*),
       SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END), CAST(AVG(latence_ms) AS INTEGER)
FROM verifications
WHERE substr(verifie_le, 1, 10) < date('now', 'localtime')
GROUP BY check_id, substr(verifie_le, 1, 10);
