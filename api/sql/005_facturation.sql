-- ============================================================
-- Facturation : le numéro qui paie n'est pas forcément celui
-- de l'inscription. Une famille a plusieurs lignes, et seule
-- celle d'un opérateur sous contrat peut être prélevée.
-- ============================================================

ALTER TABLE abonnes
  ADD COLUMN IF NOT EXISTS tel_facturation TEXT,
  ADD COLUMN IF NOT EXISTS tel_facturation_valide BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_abonnes_facturation ON abonnes(tel_facturation);

-- Mode d'abonnement : le mot-clé porte le choix (FABLE30R / FABLE30).
ALTER TABLE abonnements
  ADD COLUMN IF NOT EXISTS canal TEXT,              -- web | ussd | sms
  ADD COLUMN IF NOT EXISTS mot_cle TEXT,
  ADD COLUMN IF NOT EXISTS arret_demande_le TIMESTAMPTZ;

COMMENT ON COLUMN abonnements.reconduction IS
  'true = renouvelable à échéance. Passe à false si l''abonné arrête la reconduction.';
COMMENT ON COLUMN abonnements.arret_demande_le IS
  'Date à laquelle l''abonné a demandé l''arrêt. L''accès court jusqu''à la date de fin.';
