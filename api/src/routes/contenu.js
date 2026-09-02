/* Le contenu éditorial : lecture publique, écriture réservée au back office.
   L'écriture se fait section par section — c'est ce qu'attend la couche
   d'accès posée dans admin.html. */
const express = require('express');
const { q, transaction } = require('../lib/bd');
const { protege, role, tracer } = require('../lib/auth');

const r = express.Router();

const SECTIONS = ['contes','bientot','marches','conteurs','cats','pays','docs',
                  'lexique','jaquettes','aide','descriptions','voixDispo',
                  'attribution','editeur','pass','faq','images'];

/* --- lecture : publique, c'est ce que le portail charge au démarrage --- */
r.get('/contenu', async (_req, res) => {
  try {
    const { rows } = await q('SELECT section, valeur FROM contenu');
    const d = {};
    rows.forEach(x => { d[x.section] = x.valeur; });
    d.genere = new Date().toISOString();
    res.set('Cache-Control', 'public, max-age=60');
    res.json(d);
  } catch (e) {
    console.error('[contenu] lecture :', e.message);
    res.status(500).json({ erreur: 'Lecture impossible' });
  }
});

/* --- une seule section --- */
r.get('/contenu/:section', async (req, res) => {
  const s = req.params.section;
  if (!SECTIONS.includes(s)) return res.status(404).json({ erreur: 'Section inconnue' });
  const { rows } = await q('SELECT valeur, version, modifie_le FROM contenu WHERE section=$1', [s]);
  if (!rows.length) return res.json({ valeur: null, version: 0 });
  res.json(rows[0]);
});

/* --- écriture : back office authentifié --- */
r.put('/contenu/:section', protege, role('admin','editeur'), async (req, res) => {
  const s = req.params.section;
  if (!SECTIONS.includes(s)) return res.status(404).json({ erreur: 'Section inconnue' });

  try {
    const sortie = await transaction(async (c) => {
      const cur = await c.query('SELECT version FROM contenu WHERE section=$1 FOR UPDATE', [s]);
      const v = (cur.rows[0]?.version || 0) + 1;

      await c.query(
        `INSERT INTO contenu (section, valeur, version, modifie_le, modifie_par)
         VALUES ($1,$2,$3,now(),$4)
         ON CONFLICT (section) DO UPDATE
           SET valeur=$2, version=$3, modifie_le=now(), modifie_par=$4`,
        [s, JSON.stringify(req.body), v, req.admin.id]
      );
      /* on garde l'ancienne version pour pouvoir revenir en arrière */
      await c.query(
        `INSERT INTO contenu_versions (section, valeur, version, modifie_par)
         VALUES ($1,$2,$3,$4)`,
        [s, JSON.stringify(req.body), v, req.admin.id]
      );
      return { section: s, version: v };
    });

    await tracer(req, 'contenu.modifie', s, { version: sortie.version });
    res.json(sortie);
  } catch (e) {
    console.error('[contenu] écriture :', e.message);
    res.status(500).json({ erreur: 'Enregistrement impossible' });
  }
});

/* --- historique et retour arrière --- */
r.get('/contenu/:section/versions', protege, async (req, res) => {
  const { rows } = await q(
    `SELECT v.version, v.modifie_le, a.nom
       FROM contenu_versions v LEFT JOIN administrateurs a ON a.id=v.modifie_par
      WHERE v.section=$1 ORDER BY v.version DESC LIMIT 50`, [req.params.section]);
  res.json(rows);
});

r.post('/contenu/:section/restaurer/:version', protege, role('admin'), async (req, res) => {
  const { section, version } = req.params;
  const { rows } = await q(
    'SELECT valeur FROM contenu_versions WHERE section=$1 AND version=$2',
    [section, version]);
  if (!rows.length) return res.status(404).json({ erreur: 'Version introuvable' });

  const nouvelle = await transaction(async (c) => {
    const cur = await c.query('SELECT version FROM contenu WHERE section=$1 FOR UPDATE', [section]);
    const v = (cur.rows[0]?.version || 0) + 1;
    await c.query('UPDATE contenu SET valeur=$1, version=$2, modifie_le=now(), modifie_par=$3 WHERE section=$4',
      [rows[0].valeur, v, req.admin.id, section]);
    await c.query('INSERT INTO contenu_versions (section, valeur, version, modifie_par) VALUES ($1,$2,$3,$4)',
      [section, rows[0].valeur, v, req.admin.id]);
    return v;
  });

  await tracer(req, 'contenu.restaure', section, { depuis: version, vers: nouvelle });
  res.json({ section, version: nouvelle, restaure_depuis: +version });
});

module.exports = r;
