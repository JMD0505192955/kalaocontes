-- ============================================================
-- Contes Faso — schéma initial
-- Les noms sont en français : ce sont les mêmes mots que dans le back office.
-- ============================================================

CREATE TABLE IF NOT EXISTS administrateurs (
  id            SERIAL PRIMARY KEY,
  courriel      TEXT UNIQUE NOT NULL,
  motdepasse    TEXT NOT NULL,                    -- empreinte bcrypt, jamais le mot de passe
  nom           TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'editeur',  -- admin | editeur | support | lecture
  actif         BOOLEAN NOT NULL DEFAULT TRUE,
  cree_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
  vu_le         TIMESTAMPTZ
);

-- Le contenu éditorial, section par section : contes, bientot, marches,
-- conteurs, cats, pays, docs, lexique…
-- L'enregistrement par section évite qu'un éditeur écrase le travail d'un autre.
CREATE TABLE IF NOT EXISTS contenu (
  section       TEXT PRIMARY KEY,
  valeur        JSONB NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  modifie_le    TIMESTAMPTZ NOT NULL DEFAULT now(),
  modifie_par   INTEGER REFERENCES administrateurs(id)
);

-- Chaque version est conservée : on peut revenir en arrière.
CREATE TABLE IF NOT EXISTS contenu_versions (
  id            BIGSERIAL PRIMARY KEY,
  section       TEXT NOT NULL,
  valeur        JSONB NOT NULL,
  version       INTEGER NOT NULL,
  modifie_le    TIMESTAMPTZ NOT NULL DEFAULT now(),
  modifie_par   INTEGER REFERENCES administrateurs(id)
);
CREATE INDEX IF NOT EXISTS idx_versions_section ON contenu_versions(section, version DESC);

-- ---------------- Abonnés ----------------
CREATE TABLE IF NOT EXISTS abonnes (
  id            BIGSERIAL PRIMARY KEY,
  telephone     TEXT UNIQUE NOT NULL,             -- format international, +226…
  pays          TEXT NOT NULL,                    -- déduit de l'indicatif
  operateur     TEXT,
  pseudo        TEXT,
  statut        TEXT NOT NULL DEFAULT 'essai',    -- essai | actif | suspendu | resilie
  cree_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
  vu_le         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_abonnes_pays ON abonnes(pays, statut);

CREATE TABLE IF NOT EXISTS abonnements (
  id            BIGSERIAL PRIMARY KEY,
  abonne_id     BIGINT NOT NULL REFERENCES abonnes(id) ON DELETE CASCADE,
  pass          TEXT NOT NULL,                    -- jour | semaine | mois
  prix          INTEGER NOT NULL,
  devise        TEXT NOT NULL DEFAULT 'XOF',
  debut         TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin           TIMESTAMPTZ NOT NULL,
  reconduction  BOOLEAN NOT NULL DEFAULT TRUE,
  statut        TEXT NOT NULL DEFAULT 'actif',    -- actif | expire | annule | echec
  cree_le       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_abo_actifs ON abonnements(abonne_id, statut, fin DESC);

CREATE TABLE IF NOT EXISTS prelevements (
  id            BIGSERIAL PRIMARY KEY,
  abonnement_id BIGINT REFERENCES abonnements(id) ON DELETE SET NULL,
  abonne_id     BIGINT NOT NULL REFERENCES abonnes(id) ON DELETE CASCADE,
  montant       INTEGER NOT NULL,
  devise        TEXT NOT NULL DEFAULT 'XOF',
  operateur     TEXT NOT NULL,
  reference     TEXT,                             -- identifiant côté opérateur
  statut        TEXT NOT NULL,                    -- reussi | echec | en_attente
  message       TEXT,
  cree_le       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prel_date ON prelevements(cree_le DESC);
-- Empêche de compter deux fois le même prélèvement si l'opérateur renvoie le rappel.
CREATE UNIQUE INDEX IF NOT EXISTS idx_prel_ref ON prelevements(operateur, reference)
  WHERE reference IS NOT NULL;

-- ---------------- Usage ----------------
-- Volontairement pauvre : un compteur par conte et par jour, pas un traçage individuel.
CREATE TABLE IF NOT EXISTS ecoutes (
  id            BIGSERIAL PRIMARY KEY,
  conte         TEXT NOT NULL,
  pays          TEXT,
  jour          DATE NOT NULL DEFAULT CURRENT_DATE,
  nombre        INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ecoutes_jour ON ecoutes(conte, pays, jour);

-- ---------------- Journal d'audit ----------------
CREATE TABLE IF NOT EXISTS journal (
  id            BIGSERIAL PRIMARY KEY,
  qui           INTEGER REFERENCES administrateurs(id),
  action        TEXT NOT NULL,
  cible         TEXT,
  details       JSONB,
  ip            TEXT,
  quand         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal(quand DESC);
