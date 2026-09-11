-- Supervision: ce qu'on verifie (checks) et ce que ca a donne (verifications).

CREATE TABLE IF NOT EXISTS checks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id        INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    libelle        TEXT    NOT NULL,
    url            TEXT    NOT NULL,
    -- NULL = on accepte tout statut de succes (2xx apres redirections)
    statut_attendu INTEGER,
    -- fragment qui doit apparaitre dans le corps; NULL = on ne lit pas le corps
    doit_contenir  TEXT,
    actif          INTEGER NOT NULL DEFAULT 1,
    cree_le        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_checks_site ON checks(site_id);

CREATE TABLE IF NOT EXISTS verifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    check_id    INTEGER NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
    verifie_le  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    ok          INTEGER NOT NULL,
    statut_http INTEGER,
    latence_ms  INTEGER,
    erreur      TEXT
);

-- L'ecran de detail et le calcul d'etat lisent toujours "le dernier resultat
-- de ce check": cet index rend ces deux acces immediats.
CREATE INDEX IF NOT EXISTS idx_verifications_check
    ON verifications(check_id, verifie_le DESC);

-- Les sites qui ont deja une URL heritent d'un check sur leur page d'accueil
INSERT INTO checks (site_id, libelle, url)
SELECT id, 'Page d''accueil', url
FROM sites
WHERE url IS NOT NULL AND url <> '';
