-- ============================================================
-- Compétitions : classement par mérite, jamais de hasard.
-- Le tirage au sort relèverait du régulateur des jeux dans
-- plusieurs pays ; on ne récompense que la performance.
-- ============================================================

CREATE TABLE IF NOT EXISTS competitions (
  id            SERIAL PRIMARY KEY,
  pays          TEXT NOT NULL,
  nom           TEXT NOT NULL,
  format        TEXT NOT NULL DEFAULT 'points',  -- points | regularite
  periode       TEXT NOT NULL DEFAULT 'semaine', -- semaine | mois
  debut         DATE NOT NULL,
  fin           DATE NOT NULL,
  -- Qui participe : tous les inscrits, ou seulement les abonnés payants.
  qui           TEXT NOT NULL DEFAULT 'abonnes', -- tous | abonnes
  -- Barème, en points. Modifiable par pays.
  pts_conte     INTEGER NOT NULL DEFAULT 10,
  pts_quiz      INTEGER NOT NULL DEFAULT 5,
  pts_serie     INTEGER NOT NULL DEFAULT 15,
  -- Nombre de gagnants récompensés.
  gagnants      INTEGER NOT NULL DEFAULT 3,
  -- Seuil minimal pour figurer au classement : évite qu'un compte
  -- créé la veille rafle un lot avec deux contes.
  minimum       INTEGER NOT NULL DEFAULT 5,
  reglement     TEXT,
  active        BOOLEAN NOT NULL DEFAULT FALSE,
  cree_le       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comp_pays ON competitions(pays, active, fin DESC);

-- Les lots annoncés, par rang.
CREATE TABLE IF NOT EXISTS lots (
  id            SERIAL PRIMARY KEY,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  rang          INTEGER NOT NULL,
  intitule      TEXT NOT NULL,
  valeur        TEXT,
  finance_par   TEXT,          -- 'operateur' | 'plateforme' | 'partage'
  UNIQUE (competition_id, rang)
);

-- Les points gagnés, au fil de l'eau.
-- Une ligne par événement : on peut recalculer et justifier un classement.
CREATE TABLE IF NOT EXISTS points (
  id            BIGSERIAL PRIMARY KEY,
  abonne_id     BIGINT NOT NULL REFERENCES abonnes(id) ON DELETE CASCADE,
  competition_id INTEGER REFERENCES competitions(id) ON DELETE SET NULL,
  motif         TEXT NOT NULL,        -- conte | quiz | serie
  reference     TEXT,                 -- l'identifiant du conte, par exemple
  points        INTEGER NOT NULL,
  jour          DATE NOT NULL DEFAULT CURRENT_DATE,
  cree_le       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_points_comp ON points(competition_id, abonne_id);
-- Un même conte ne rapporte qu'une fois par compétition.
CREATE UNIQUE INDEX IF NOT EXISTS idx_points_unique
  ON points(abonne_id, competition_id, motif, reference)
  WHERE reference IS NOT NULL;

-- Les classements figés à la clôture : on ne recalcule jamais un palmarès publié.
CREATE TABLE IF NOT EXISTS palmares (
  id            BIGSERIAL PRIMARY KEY,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  rang          INTEGER NOT NULL,
  abonne_id     BIGINT REFERENCES abonnes(id) ON DELETE SET NULL,
  pseudo        TEXT,
  points        INTEGER NOT NULL,
  lot           TEXT,
  remis         BOOLEAN NOT NULL DEFAULT FALSE,
  fige_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (competition_id, rang)
);
