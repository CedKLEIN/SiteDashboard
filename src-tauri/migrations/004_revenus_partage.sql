-- Aligne les revenus sur le modele des depenses: un revenu peut lui aussi etre
-- porte par plusieurs sites. Sans ca, la table restait le seul endroit du
-- schema ou le rattachement etait mono-site.

CREATE TABLE IF NOT EXISTS revenu_sites (
    revenu_id  INTEGER NOT NULL REFERENCES revenus(id) ON DELETE CASCADE,
    site_id    INTEGER NOT NULL REFERENCES sites(id)   ON DELETE CASCADE,
    part_cents INTEGER NOT NULL,
    PRIMARY KEY (revenu_id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_revenu_sites_site ON revenu_sites(site_id);

INSERT INTO revenu_sites (revenu_id, site_id, part_cents)
SELECT id, site_id, montant_cents FROM revenus WHERE site_id IS NOT NULL;

DROP INDEX IF EXISTS idx_revenus_site;
ALTER TABLE revenus DROP COLUMN site_id;
