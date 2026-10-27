-- Depenses en devise etrangere, comme les revenus (008).
--
-- Anthropic et OpenAI facturent en dollars : sans conversion, une facture de
-- 20 USD etait saisie 20 EUR, ou convertie a la main sans trace du taux. On
-- stocke le montant d'origine, le taux du jour de la depense et le converti ;
-- les parts par site (depense_sites) sont en euros.
ALTER TABLE depenses ADD COLUMN taux REAL NOT NULL DEFAULT 1.0;
ALTER TABLE depenses ADD COLUMN montant_eur_cents INTEGER;

UPDATE depenses SET montant_eur_cents = montant_cents WHERE montant_eur_cents IS NULL;
