-- ============================================================
-- Achats définitifs : un conte payé une fois reste acquis.
-- Né du mobile money ivoirien, où le prélèvement récurrent
-- n'existe pas : un paiement unique doit donner quelque chose
-- de définitif.
-- ============================================================

CREATE TABLE IF NOT EXISTS achats (
  id            BIGSERIAL PRIMARY KEY,
  abonne_id     BIGINT NOT NULL REFERENCES abonnes(id) ON DELETE CASCADE,
  conte         TEXT NOT NULL,
  prix          INTEGER NOT NULL,
  devise        TEXT NOT NULL DEFAULT 'XOF',
  reference     TEXT,
  pays          TEXT,
  cree_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (abonne_id, conte)
);
CREATE INDEX IF NOT EXISTS idx_achats_abonne ON achats(abonne_id);
CREATE INDEX IF NOT EXISTS idx_achats_conte  ON achats(conte, cree_le DESC);

COMMENT ON TABLE achats IS
  'Contes acquis definitivement. Un achat ne s''annule pas et ne se revoque pas :
   le jour ou un marche passe a l''abonnement, ces contes restent accessibles.';
