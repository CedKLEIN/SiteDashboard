-- Expiration du nom de domaine et cible du DNS (type 'domaine').
--
-- Meme argument que pour le certificat (voir 005_certificat.sql): l'expiration
-- d'un nom de domaine est entierement previsible, et se repare beaucoup moins
-- vite qu'un certificat. Le cas constate: un domaine qu'on n'utilise plus
-- resolvait toujours vers le VPS et atterrissait sur un vhost par defaut.
--
-- Le type reutilise deux colonnes existantes:
--   * seuil_jours    (005) - nombre de jours avant expiration sous lequel on alerte
--   * cible_attendue (010) - l'adresse vers laquelle le domaine doit resoudre

-- Le nom a interroger, sans schema ni chemin: checks.url reste l'URL du site.
ALTER TABLE checks ADD COLUMN domaine TEXT;

-- Adresses reellement resolues au dernier passage, pour afficher ce qu'on a vu
-- et pas seulement le verdict.
ALTER TABLE verifications ADD COLUMN adresses TEXT;
