-- Trois assertions que le couple (statut, doit_contenir) laisse passer.
--
-- Chacune correspond a une panne reellement constatee et qu'aucun check
-- existant n'aurait signalee:
--   * un durcissement nginx jamais monte sur le VPS: le site repondait 200,
--     seul l'en-tete Server trahissait la regression;
--   * www.denivio.fr qui servait le site en 200 au lieu de rediriger: le bug
--     ETAIT le 200, et reqwest avale les redirections;
--   * un sitemap genere depuis la base qui repondrait 200 avec 5 URL au lieu
--     de 4417, en contenant toujours <urlset.

-- 1. Assertions sur les en-tetes de reponse.
--
-- Une table plutot qu'une colonne JSON: plusieurs regles par check, requetables,
-- et coherent avec abonnement_tarifs. On ne stocke pas une structure dans une
-- colonne quand le reste du schema est normalise.
CREATE TABLE IF NOT EXISTS check_entetes (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    check_id  INTEGER NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
    nom       TEXT    NOT NULL,
    -- 'present' | 'absent' | 'contient' | 'ne_contient_pas'
    --
    -- Les deux dernieres sont indispensables au cas qui a motive la table:
    -- "Server ne contient pas /" est la seule facon d'exprimer qu'on ne veut
    -- plus voir "nginx/1.18.0 (Ubuntu)" sans figer la valeur attendue.
    operateur TEXT    NOT NULL,
    -- NULL pour 'present' et 'absent'
    valeur    TEXT
);

CREATE INDEX IF NOT EXISTS idx_check_entetes ON check_entetes(check_id);

-- 2. Redirection attendue (type 'redirection'): l'URL cible du premier saut.
ALTER TABLE checks ADD COLUMN cible_attendue TEXT;

-- 3. Taille minimale du corps, en octets DECODES (gzip est actif et
-- Content-Length est absent en chunked: on ne compare pas l'en-tete).
ALTER TABLE checks ADD COLUMN taille_min_octets INTEGER;

-- Nombre minimal d'apparitions de doit_contenir. Sans doit_contenir, la colonne
-- n'a pas de sens: le refus est fait a l'ecriture, dans creerCheck.
ALTER TABLE checks ADD COLUMN occurrences_min INTEGER;

-- Ce qu'on a reellement mesure, pour afficher "1 occurrence sur 10 attendues"
-- plutot qu'un echec sans chiffre.
ALTER TABLE verifications ADD COLUMN taille INTEGER;
ALTER TABLE verifications ADD COLUMN occurrences INTEGER;
