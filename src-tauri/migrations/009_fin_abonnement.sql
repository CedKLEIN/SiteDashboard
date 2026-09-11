-- Date de fin d'un abonnement resilie.
--
-- Sans elle, impossible de compter correctement un abonnement arrete: soit on
-- le fait courir indefiniment et on inventerait des prelevements, soit on
-- l'exclut et ses paiements passes disparaitraient du cumul. Le drapeau `actif`
-- ne sert qu'a l'affichage, il ne dit pas QUAND ca s'est arrete.
ALTER TABLE abonnements ADD COLUMN fin TEXT;
