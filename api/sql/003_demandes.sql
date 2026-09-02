-- Demandes venant des partenaires opérateurs.
-- Le partenaire ne crée jamais rien directement : il demande, l'équipe tranche.
CREATE TABLE IF NOT EXISTS demandes_partenaire (
  id            BIGSERIAL PRIMARY KEY,
  type          TEXT NOT NULL,              -- ecart | pass
  pays          TEXT NOT NULL,
  operateur     TEXT NOT NULL,
  demandeur     INTEGER REFERENCES administrateurs(id),
  periode       TEXT,                       -- pour un écart : le mois concerné
  montant       INTEGER,                    -- écart signalé, ou prix envisagé
  intitule      TEXT,                       -- nom souhaité du pass
  duree         TEXT,                       -- durée souhaitée
  message       TEXT,
  statut        TEXT NOT NULL DEFAULT 'ouverte',   -- ouverte | en_cours | traitee | refusee
  reponse       TEXT,
  traitee_par   INTEGER REFERENCES administrateurs(id),
  traitee_le    TIMESTAMPTZ,
  cree_le       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_demandes_statut ON demandes_partenaire(statut, cree_le DESC);
CREATE INDEX IF NOT EXISTS idx_demandes_pays ON demandes_partenaire(pays, cree_le DESC);
