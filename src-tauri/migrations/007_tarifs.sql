-- Un abonnement a une date de debut et un HISTORIQUE de tarifs.
--
-- Un nom de domaine a 6 EUR la premiere annee puis 11 EUR: ecraser le montant
-- ferait disparaitre ce qui a reellement ete paye, et rendrait tout cumul faux.
-- On garde donc chaque tarif avec sa date d'entree en vigueur.

ALTER TABLE abonnements ADD COLUMN debut TEXT;

CREATE TABLE IF NOT EXISTS abonnement_tarifs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    abonnement_id INTEGER NOT NULL REFERENCES abonnements(id) ON DELETE CASCADE,
    -- date a partir de laquelle ce tarif s'applique
    debut         TEXT    NOT NULL,
    montant_cents INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tarifs_abonnement
    ON abonnement_tarifs(abonnement_id, debut);

-- Reprise: le montant actuel devient le tarif initial, a partir de la date de
-- creation faute de mieux.
UPDATE abonnements SET debut = date(cree_le) WHERE debut IS NULL;

INSERT INTO abonnement_tarifs (abonnement_id, debut, montant_cents)
SELECT id, debut, montant_cents FROM abonnements;

-- montant_cents deviendrait une seconde source de verite concurrente de
-- l'historique: on la supprime, le tarif courant se lit dans abonnement_tarifs.
ALTER TABLE abonnements DROP COLUMN montant_cents;

-- L'icone est portee par le fournisseur et non par l'abonnement: deux
-- abonnements OpenAI partagent la meme icone.
ALTER TABLE fournisseurs ADD COLUMN url TEXT;
ALTER TABLE fournisseurs ADD COLUMN favicon TEXT;
