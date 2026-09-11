-- 1. Le trou signale: sans index unique, un ré-import de dons creerait des
--    doublons silencieux. Les depenses l'avaient, les revenus non.
CREATE UNIQUE INDEX IF NOT EXISTS idx_revenus_ref
    ON revenus(source, ref_externe) WHERE ref_externe IS NOT NULL;

-- 2. Revenus en devise etrangere.
--
-- On stocke les trois: le montant d'origine (ce qui a reellement ete recu), le
-- taux applique, et le converti. Reconvertir a l'affichage avec le taux du jour
-- ferait varier un revenu passe a chaque consultation - un don de 50 USD recu
-- en mars ne vaut pas ce qu'il vaudrait aujourd'hui.
ALTER TABLE revenus ADD COLUMN taux REAL NOT NULL DEFAULT 1.0;
ALTER TABLE revenus ADD COLUMN montant_eur_cents INTEGER;

UPDATE revenus SET montant_eur_cents = montant_cents WHERE montant_eur_cents IS NULL;

-- 3. Preferences de l'application, en cle/valeur: une table par reglage serait
--    une migration par reglage.
CREATE TABLE IF NOT EXISTS preferences (
    cle    TEXT PRIMARY KEY,
    valeur TEXT NOT NULL
);

-- 60 s par defaut, reglable pour ne pas matraquer les sites supervises
INSERT OR IGNORE INTO preferences (cle, valeur) VALUES ('intervalle_supervision_s', '60');
