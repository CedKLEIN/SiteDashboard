-- Suivi de la version deployee (type 'valeur').
--
-- On extrait une chaine d'une reponse et on l'affiche AVEC sa date de dernier
-- changement, sans verdict: un retard de deploiement n'est pas une panne, c'est
-- une information. Denivio sert /version.json avec son buildId; la carte du
-- site affiche alors "build du 17/09, inchange depuis 3 j".

-- 'json:chemin.pointe' ou 'regex:motif' (groupe capturant n.1)
ALTER TABLE checks ADD COLUMN extracteur TEXT;

-- Une ligne par CHANGEMENT de valeur, pas par verification.
--
-- `verifications` est purgee a 30 jours: un build inchange depuis six semaines
-- afficherait "inchange depuis 30 jours", un chiffre faux qui a l'air vrai.
-- Cette table-ci est minuscule (une ligne par deploiement) et n'est jamais purgee.
CREATE TABLE IF NOT EXISTS check_valeurs (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    check_id INTEGER NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
    valeur   TEXT    NOT NULL,
    depuis   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_check_valeurs ON check_valeurs(check_id, depuis DESC);
