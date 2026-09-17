-- Cadence propre a chaque check.
--
-- Le cycle tourne a la minute. Interroger RDAP 1440 fois par jour pour une date
-- qui bouge une fois par an est abusif et se fait rate-limiter. Le meme reproche
-- vaut pour le check TLS existant: une poignee de main complete toutes les
-- minutes pour une date qui change tous les 90 jours.
--
-- Un check qui ne tourne pas a ce cycle GARDE son dernier resultat: l'etat d'un
-- site se lit sur la derniere verification de chaque check, pas sur son age.

-- Intervalle minimal entre deux executions, en secondes. NULL = a chaque cycle.
ALTER TABLE checks ADD COLUMN intervalle_min_s INTEGER;

-- Les checks TLS existants passent a 6 h.
UPDATE checks SET intervalle_min_s = 21600 WHERE type = 'tls' AND intervalle_min_s IS NULL;
