-- Un compte partenaire est un administrateur restreint à un pays.
-- C'est la colonne 'pays' qui fait la restriction : sans elle, aucune donnée.
ALTER TABLE administrateurs ADD COLUMN IF NOT EXISTS pays TEXT;

COMMENT ON COLUMN administrateurs.pays IS
  'Restreint un compte partenaire à un seul pays. NULL pour les comptes internes.';

-- Le relevé fourni par l'opérateur, pour la réconciliation.
CREATE TABLE IF NOT EXISTS releves_operateur (
  id            BIGSERIAL PRIMARY KEY,
  operateur     TEXT NOT NULL,
  pays          TEXT NOT NULL,
  periode       DATE NOT NULL,
  reference     TEXT NOT NULL,
  montant       INTEGER NOT NULL,
  statut        TEXT NOT NULL,
  depose_le     TIMESTAMPTZ NOT NULL DEFAULT now(),
  depose_par    INTEGER REFERENCES administrateurs(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_releve_ref ON releves_operateur(operateur, reference);
CREATE INDEX IF NOT EXISTS idx_releve_periode ON releves_operateur(pays, periode DESC);
