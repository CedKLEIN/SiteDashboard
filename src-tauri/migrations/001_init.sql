-- Schema initial de SiteDashboard.
-- Regle: tous les montants sont stockes en CENTIMES (INTEGER), jamais en flottant.
-- Regle: toutes les dates sont en ISO 'YYYY-MM-DD' (tri lexicographique == tri chronologique).

CREATE TABLE IF NOT EXISTS sites (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    nom     TEXT    NOT NULL UNIQUE,
    url     TEXT,
    couleur TEXT    NOT NULL DEFAULT '#6366f1',
    actif   INTEGER NOT NULL DEFAULT 1,
    note    TEXT,
    cree_le TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fournisseurs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nom       TEXT    NOT NULL UNIQUE,
    -- hebergement | domaine | api | saas | marketing | autre
    categorie TEXT    NOT NULL DEFAULT 'autre'
);

CREATE TABLE IF NOT EXISTS depenses (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id        INTEGER REFERENCES sites(id) ON DELETE CASCADE,
    fournisseur_id INTEGER REFERENCES fournisseurs(id) ON DELETE SET NULL,
    date           TEXT    NOT NULL,
    montant_cents  INTEGER NOT NULL,
    devise         TEXT    NOT NULL DEFAULT 'EUR',
    libelle        TEXT    NOT NULL DEFAULT '',
    categorie      TEXT    NOT NULL DEFAULT 'autre',
    -- manuel | csv | api : pose des le depart pour que les connecteurs
    -- n'obligent pas a casser le schema plus tard
    source         TEXT    NOT NULL DEFAULT 'manuel',
    -- identifiant de facture cote fournisseur, sert a dedoublonner les imports
    ref_externe    TEXT,
    cree_le        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_depenses_date ON depenses(date);
CREATE INDEX IF NOT EXISTS idx_depenses_site ON depenses(site_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_depenses_ref
    ON depenses(fournisseur_id, ref_externe) WHERE ref_externe IS NOT NULL;

CREATE TABLE IF NOT EXISTS revenus (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id       INTEGER REFERENCES sites(id) ON DELETE CASCADE,
    date          TEXT    NOT NULL,
    montant_cents INTEGER NOT NULL,
    devise        TEXT    NOT NULL DEFAULT 'EUR',
    libelle       TEXT    NOT NULL DEFAULT '',
    source        TEXT    NOT NULL DEFAULT 'manuel',
    ref_externe   TEXT,
    cree_le       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_revenus_date ON revenus(date);
CREATE INDEX IF NOT EXISTS idx_revenus_site ON revenus(site_id);

-- Couts recurrents: sert a projeter le budget et a alerter sur les renouvellements
CREATE TABLE IF NOT EXISTS abonnements (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id            INTEGER REFERENCES sites(id) ON DELETE CASCADE,
    fournisseur_id     INTEGER REFERENCES fournisseurs(id) ON DELETE SET NULL,
    libelle            TEXT    NOT NULL,
    montant_cents      INTEGER NOT NULL,
    devise             TEXT    NOT NULL DEFAULT 'EUR',
    -- mensuel | annuel
    periodicite        TEXT    NOT NULL DEFAULT 'mensuel',
    prochaine_echeance TEXT,
    actif              INTEGER NOT NULL DEFAULT 1,
    cree_le            TEXT    NOT NULL DEFAULT (datetime('now'))
);
