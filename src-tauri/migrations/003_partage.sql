-- Une depense ou un abonnement peut etre partage entre plusieurs sites.
-- Exemple: un hebergement Ionos a 11 EUR qui sert a deux sites.
--
-- La part de chaque site est stockee en CENTIMES et calculee a l'ecriture:
-- la somme des parts est donc toujours EXACTEMENT egale au montant total,
-- ce qu'un simple partage a l'affichage (montant / nb_sites) ne garantit pas.

CREATE TABLE IF NOT EXISTS depense_sites (
    depense_id INTEGER NOT NULL REFERENCES depenses(id) ON DELETE CASCADE,
    site_id    INTEGER NOT NULL REFERENCES sites(id)    ON DELETE CASCADE,
    part_cents INTEGER NOT NULL,
    PRIMARY KEY (depense_id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_depense_sites_site ON depense_sites(site_id);

CREATE TABLE IF NOT EXISTS abonnement_sites (
    abonnement_id INTEGER NOT NULL REFERENCES abonnements(id) ON DELETE CASCADE,
    site_id       INTEGER NOT NULL REFERENCES sites(id)       ON DELETE CASCADE,
    part_cents    INTEGER NOT NULL,
    PRIMARY KEY (abonnement_id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_abonnement_sites_site ON abonnement_sites(site_id);

-- Reprise de l'existant: chaque ligne deja rattachee a un site lui reste
-- rattachee, pour la totalite de son montant.
INSERT INTO depense_sites (depense_id, site_id, part_cents)
SELECT id, site_id, montant_cents FROM depenses WHERE site_id IS NOT NULL;

INSERT INTO abonnement_sites (abonnement_id, site_id, part_cents)
SELECT id, site_id, montant_cents FROM abonnements WHERE site_id IS NOT NULL;

-- Les colonnes site_id deviennent la seule source de verite concurrente de la
-- table de liaison: on les supprime pour qu'aucun code ne puisse les diverger.
DROP INDEX IF EXISTS idx_depenses_site;
ALTER TABLE depenses DROP COLUMN site_id;
ALTER TABLE abonnements DROP COLUMN site_id;
