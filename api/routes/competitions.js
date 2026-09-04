/* ============================================================
   Compétitions — classement par mérite.

   Deux formats seulement, et aucun hasard :
   - points      : total accumulé sur la période
   - regularite  : nombre de jours distincts où l'on a écouté

   Un tirage au sort relèverait du régulateur des jeux dans
   plusieurs pays. On récompense la performance, jamais la chance.
   ============================================================ */
const express = require('express');
const { q, transaction } = require('../lib/bd');
const { protege, role, tracer } = require('../lib/auth');

const r = express.Router();

/* ---- La compétition en cours dans un pays ---- */
async function courante(pays) {
  const { rows } = await q(
    `SELECT * FROM competitions
      WHERE pays=$1 AND active=TRUE
        AND current_date BETWEEN debut AND fin
      ORDER BY debut DESC LIMIT 1`, [pays]);
  return rows[0] || null;
}

/* ---- Ce que le portail affiche : règles, lots, classement ---- */
r.get('/competition', async (req, res) => {
  const pays = req.query.pays;
  if (!pays) return res.status(400).json({ erreur: 'Pays attendu' });
  try {
    const c = await courante(pays);
    if (!c) return res.json({ active: false });

    const [lots, classement] = await Promise.all([
      q(`SELECT rang, intitule, valeur FROM lots
          WHERE competition_id=$1 ORDER BY rang`, [c.id]),
      classementDe(c, 20)
    ]);

    res.json({
      active: true,
      nom: c.nom, format: c.format, periode: c.periode,
      debut: c.debut, fin: c.fin, qui: c.qui,
      bareme: { conte: c.pts_conte, quiz: c.pts_quiz, serie: c.pts_serie },
      gagnants: c.gagnants, minimum: c.minimum,
      reglement: c.reglement,
      lots: lots.rows,
      classement: classement
    });
  } catch (e) {
    console.error('[competition] :', e.message);
    res.status(500).json({ erreur: 'Lecture impossible' });
  }
});

/* Le classement, calculé selon le format. Seuls les pseudonymes sortent. */
async function classementDe(c, limite) {
  const ou = c.qui === 'abonnes'
    ? `AND EXISTS (SELECT 1 FROM abonnements ab
                    WHERE ab.abonne_id = a.id AND ab.statut='actif' AND ab.fin > now())`
    : '';

  const mesure = c.format === 'regularite'
    ? 'count(DISTINCT p.jour)::int'
    : 'COALESCE(sum(p.points),0)::int';

  const { rows } = await q(
    `SELECT a.id, COALESCE(a.pseudo, 'Veilleur ' || a.id) AS pseudo,
            ${mesure} AS score,
            count(DISTINCT p.reference) FILTER (WHERE p.motif='conte')::int AS contes
       FROM abonnes a
       JOIN points p ON p.abonne_id = a.id AND p.competition_id = $1
      WHERE TRUE ${ou}
      GROUP BY a.id, a.pseudo
     HAVING ${mesure} >= $2
      ORDER BY score DESC, min(p.cree_le) ASC
      LIMIT $3`, [c.id, c.minimum, limite || 20]);
  return rows;
}

/* ---- Le portail signale un point gagné ----
   Le barème est appliqué côté serveur : on ne fait pas confiance
   au nombre de points envoyé par un téléphone. */
r.post('/competition/point', async (req, res) => {
  const { telephone, pays, motif, reference } = req.body || {};
  if (!telephone || !pays || !motif) return res.status(400).end();
  if (!['conte', 'quiz', 'serie'].includes(motif)) return res.status(400).end();

  try {
    const c = await courante(pays);
    if (!c) return res.json({ compte: false });

    const { rows } = await q('SELECT id FROM abonnes WHERE telephone=$1',
      [String(telephone).replace(/\s/g, '')]);
    if (!rows.length) return res.json({ compte: false });

    const pts = motif === 'conte' ? c.pts_conte
              : motif === 'quiz'  ? c.pts_quiz
              : c.pts_serie;

    await q(
      `INSERT INTO points (abonne_id, competition_id, motif, reference, points)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING`,
      [rows[0].id, c.id, motif, reference || null, pts]);

    res.json({ compte: true, points: pts });
  } catch (e) {
    console.error('[competition] point :', e.message);
    res.status(500).end();
  }
});

/* ================= CÔTÉ ÉQUIPE ================= */

r.get('/admin/competitions', protege, role('admin','editeur','finance'), async (_req, res) => {
  const { rows } = await q(
    `SELECT c.*,
            (SELECT count(*)::int FROM lots WHERE competition_id=c.id) AS nb_lots,
            (SELECT count(DISTINCT abonne_id)::int FROM points WHERE competition_id=c.id) AS participants
       FROM competitions c ORDER BY debut DESC LIMIT 50`);
  res.json(rows);
});

r.post('/admin/competitions', protege, role('admin'), async (req, res) => {
  const b = req.body || {};
  if (!b.pays || !b.nom || !b.debut || !b.fin)
    return res.status(400).json({ erreur: 'Pays, nom et dates attendus' });
  if (!['points','regularite'].includes(b.format || 'points'))
    return res.status(400).json({ erreur: 'Format inconnu' });
  if (new Date(b.fin) <= new Date(b.debut))
    return res.status(400).json({ erreur: 'La fin doit suivre le début' });

  const { rows } = await q(
    `INSERT INTO competitions
       (pays, nom, format, periode, debut, fin, qui, pts_conte, pts_quiz, pts_serie,
        gagnants, minimum, reglement, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,FALSE) RETURNING *`,
    [b.pays, b.nom, b.format || 'points', b.periode || 'semaine', b.debut, b.fin,
     b.qui || 'abonnes', b.pts_conte || 10, b.pts_quiz || 5, b.pts_serie || 15,
     b.gagnants || 3, b.minimum || 5, b.reglement || null]);
  await tracer(req, 'competition.creee', b.pays, { nom: b.nom });
  res.json(rows[0]);
});

r.post('/admin/competitions/:id', protege, role('admin'), async (req, res) => {
  const b = req.body || {};
  if (b.active === true) {
    /* Une compétition sans lots annoncés ne s'active pas : les familles
       doivent savoir ce qu'elles peuvent gagner avant de jouer. */
    const { rows } = await q('SELECT count(*)::int n FROM lots WHERE competition_id=$1',
      [req.params.id]);
    if (!rows[0].n)
      return res.status(400).json({ erreur: 'Annoncez au moins un lot avant d\'activer' });
  }
  const champs = [], vals = [];
  ['nom','format','periode','debut','fin','qui','pts_conte','pts_quiz','pts_serie',
   'gagnants','minimum','reglement','active'].forEach(k => {
    if (b[k] !== undefined) { vals.push(b[k]); champs.push(`${k}=$${vals.length}`); }
  });
  if (!champs.length) return res.status(400).json({ erreur: 'Rien à modifier' });
  vals.push(req.params.id);
  await q(`UPDATE competitions SET ${champs.join(', ')} WHERE id=$${vals.length}`, vals);
  await tracer(req, 'competition.modifiee', req.params.id, b);
  res.json({ id: +req.params.id });
});

r.post('/admin/competitions/:id/lots', protege, role('admin'), async (req, res) => {
  const { rang, intitule, valeur, finance_par } = req.body || {};
  if (!rang || !intitule) return res.status(400).json({ erreur: 'Rang et intitulé attendus' });
  await q(
    `INSERT INTO lots (competition_id, rang, intitule, valeur, finance_par)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (competition_id, rang) DO UPDATE
       SET intitule=$3, valeur=$4, finance_par=$5`,
    [req.params.id, rang, intitule, valeur || null, finance_par || 'partage']);
  res.json({ ok: true });
});

/* ---- Clôture : on fige le palmarès, on ne le recalcule plus jamais ---- */
r.post('/admin/competitions/:id/cloturer', protege, role('admin'), async (req, res) => {
  try {
    const { rows } = await q('SELECT * FROM competitions WHERE id=$1', [req.params.id]);
    const c = rows[0];
    if (!c) return res.status(404).json({ erreur: 'Compétition inconnue' });

    const dejaFige = await q('SELECT count(*)::int n FROM palmares WHERE competition_id=$1',
      [c.id]);
    if (dejaFige.rows[0].n)
      return res.status(409).json({ erreur: 'Palmarès déjà figé' });

    const gagnants = await classementDe(c, c.gagnants);
    const lots = await q('SELECT rang, intitule FROM lots WHERE competition_id=$1', [c.id]);
    const parRang = {};
    lots.rows.forEach(l => { parRang[l.rang] = l.intitule; });

    await transaction(async (t) => {
      for (let i = 0; i < gagnants.length; i++) {
        await t.query(
          `INSERT INTO palmares (competition_id, rang, abonne_id, pseudo, points, lot)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [c.id, i + 1, gagnants[i].id, gagnants[i].pseudo,
           gagnants[i].score, parRang[i + 1] || null]);
      }
      await t.query('UPDATE competitions SET active=FALSE WHERE id=$1', [c.id]);
    });

    await tracer(req, 'competition.cloturee', c.id, { gagnants: gagnants.length });
    res.json({ cloturee: true, gagnants: gagnants.length });
  } catch (e) {
    console.error('[competition] clôture :', e.message);
    res.status(500).json({ erreur: 'Clôture impossible' });
  }
});

r.get('/admin/competitions/:id/palmares', protege, role('admin','support','finance'), async (req, res) => {
  const { rows } = await q(
    `SELECT p.*, a.telephone FROM palmares p
       LEFT JOIN abonnes a ON a.id=p.abonne_id
      WHERE p.competition_id=$1 ORDER BY p.rang`, [req.params.id]);
  res.json(rows);
});

r.post('/admin/palmares/:id/remis', protege, role('admin','support'), async (req, res) => {
  await q('UPDATE palmares SET remis=TRUE WHERE id=$1', [req.params.id]);
  await tracer(req, 'lot.remis', req.params.id);
  res.json({ remis: true });
});

module.exports = r;
