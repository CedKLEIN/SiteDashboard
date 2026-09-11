-- Icone du site, stockee en data URI (data:image/png;base64,...).
--
-- On stocke les octets plutot qu'une URL: l'icone doit s'afficher meme quand le
-- site est injoignable - c'est precisement le moment ou on regarde le tableau
-- de bord. Une URL distante afficherait une image cassee pendant la panne.
ALTER TABLE sites ADD COLUMN favicon TEXT;
