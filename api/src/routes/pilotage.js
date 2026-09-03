/* ============================================================
   Tableau de bord — vue d'ensemble du service.
   Une seule route qui rassemble tout ce que la base sait dire,
   pour éviter dix appels au chargement.
   ============================================================ */
const express = require('express');
const { q } = require('../lib/bd');
const { protege, role } = require('../lib/auth');

const r = express.Router();

r.get('/admin/pilotage', protege, role('admin','finance','support','editeur'), async (req, res) => {
  const j = Math.min(365, Math.max(1, parseInt(req.query.jours, 10) || 30));
  const paysFiltre = req.query.pays || null;
  const p = [String(j)];
  const ou = paysFiltre ? (p.push(paysFiltre), ' AND a.pays=$2') : '';

  try {
    const [
      abonnes, revenu, parPays, parOperateur, parPass,
      evolution, contes, echecs, catalogue
    ] = await Promise.all([

      /* Abonnés : total, actifs, nouveaux sur la période */
      q(`SELECT count(*)::int total,
                count(*) FILTER (WHERE a.statut='actif')::int actifs,
                count(*) FILTER (WHERE a.cree_le > now() - ($1||' days')::interval)::int nouveaux,
                count(*) FILTER (WHERE a.statut='resilie'
                  AND a.vu_le > now() - ($1||' days')::interval)::int resilies
           FROM abonnes a WHERE TRUE ${ou}`, p),

      /* Revenu encaissé et échecs */
      q(`SELECT COALESCE(sum(pr.montant) FILTER (WHERE pr.statut='reussi'),0)::int encaisse,
                count(*) FILTER (WHERE pr.statut='reussi')::int reussis,
                count(*) FILTER (WHERE pr.statut='echec')::int echecs
           FROM prelevements pr JOIN abonnes a ON a.id=pr.abonne_id
          WHERE pr.cree_le > now() - ($1||' days')::interval ${ou}`, p),

      q(`SELECT a.pays, count(DISTINCT a.id)::int abonnes,
                COALESCE(sum(pr.montant) FILTER (WHERE pr.statut='reussi'),0)::int revenu
           FROM abonnes a LEFT JOIN prelevements pr ON pr.abonne_id=a.id
            AND pr.cree_le > now() - ($1||' days')::interval
          WHERE TRUE ${ou} GROUP BY a.pays ORDER BY revenu DESC`, p),

      q(`SELECT COALESCE(a.operateur,'—') operateur, a.pays,
                count(DISTINCT a.id)::int abonnes,
                COALESCE(sum(pr.montant) FILTER (WHERE pr.statut='reussi'),0)::int revenu,
                count(*) FILTER (WHERE pr.statut='echec')::int echecs
           FROM abonnes a LEFT JOIN prelevements pr ON pr.abonne_id=a.id
            AND pr.cree_le > now() - ($1||' days')::interval
          WHERE TRUE ${ou} GROUP BY a.operateur, a.pays ORDER BY revenu DESC`, p),

      q(`SELECT ab.pass, count(*)::int nombre, COALESCE(sum(ab.prix),0)::int revenu
           FROM abonnements ab JOIN abonnes a ON a.id=ab.abonne_id
          WHERE ab.cree_le > now() - ($1||' days')::interval ${ou}
          GROUP BY ab.pass ORDER BY revenu DESC`, p),

      /* Courbe : revenu et nouveaux abonnés, jour par jour */
      q(`SELECT d::date jour,
                COALESCE(sum(pr.montant) FILTER (WHERE pr.statut='reussi'),0)::int revenu,
                count(DISTINCT a2.id)::int nouveaux
           FROM generate_series(now() - ($1||' days')::interval, now(), '1 day') d
           LEFT JOIN prelevements pr ON pr.cree_le::date = d::date
           LEFT JOIN abonnes a ON a.id=pr.abonne_id
           LEFT JOIN abonnes a2 ON a2.cree_le::date = d::date
          WHERE TRUE ${paysFiltre ? ' AND (a.pays=$2 OR a.pays IS NULL)' : ''}
          GROUP BY 1 ORDER BY 1`, p),

      /* Contes les plus écoutés */
      q(`SELECT conte, sum(nombre)::int ecoutes FROM ecoutes
          WHERE jour > current_date - ($1||' days')::interval
            ${paysFiltre ? ' AND pays=$2' : ''}
          GROUP BY conte ORDER BY ecoutes DESC LIMIT 10`, p),

      /* Derniers échecs, pour repérer un incident opérateur */
      q(`SELECT pr.operateur, count(*)::int n, max(pr.cree_le) dernier
           FROM prelevements pr JOIN abonnes a ON a.id=pr.abonne_id
          WHERE pr.statut='echec' AND pr.cree_le > now() - interval '24 hours' ${ou}
          GROUP BY pr.operateur ORDER BY n DESC`, p),

      /* État du catalogue, depuis le contenu éditorial */
      q(`SELECT valeur FROM contenu WHERE section IN ('contes','bientot')`)
    ]);

    const cat = catalogue.rows.map(x => x.valeur);
    const nbContes = (cat[0] || []).length + (cat[1] || []).length;

    res.json({
      jours: j, pays: paysFiltre,
      abonnes: abonnes.rows[0],
      revenu: revenu.rows[0],
      parPays: parPays.rows,
      parOperateur: parOperateur.rows,
      parPass: parPass.rows,
      evolution: evolution.rows,
      contes: contes.rows,
      incidents: echecs.rows,
      catalogue: { total: nbContes }
    });
  } catch (e) {
    console.error('[pilotage] :', e.message);
    res.status(500).json({ erreur: 'Lecture impossible' });
  }
});

/* Le portail signale une écoute. Volontairement anonyme : un compteur, pas un traçage. */
r.post('/ecoutes', async (req, res) => {
  const { conte, pays } = req.body || {};
  if (!conte) return res.status(400).end();
  try {
    await q(`INSERT INTO ecoutes (conte, pays, jour, nombre) VALUES ($1,$2,current_date,1)
             ON CONFLICT (conte, pays, jour) DO UPDATE SET nombre = ecoutes.nombre + 1`,
      [String(conte).slice(0, 60), pays ? String(pays).slice(0, 4) : null]);
    res.status(204).end();
  } catch { res.status(204).end(); }
});

/* Côté équipe : la file des demandes partenaires. */
r.get('/admin/demandes', protege, role('admin','finance','support'), async (req, res) => {
  const { rows } = await q(
    `SELECT d.*, a.nom AS traite_par_nom
       FROM demandes_partenaire d
       LEFT JOIN administrateurs a ON a.id=d.traitee_par
      WHERE ($1::text IS NULL OR d.statut=$1)
      ORDER BY d.cree_le DESC LIMIT 100`, [req.query.statut || null]);
  res.json(rows);
});

r.post('/admin/demandes/:id', protege, role('admin','finance','support'), async (req, res) => {
  const { statut, reponse } = req.body || {};
  if (!['en_cours','traitee','refusee'].includes(statut))
    return res.status(400).json({ erreur: 'Statut inconnu' });
  await q(`UPDATE demandes_partenaire
              SET statut=$1, reponse=$2, traitee_par=$3, traitee_le=now()
            WHERE id=$4`, [statut, reponse || null, req.admin.id, req.params.id]);
  res.json({ id: +req.params.id, statut });
});

/* ================= COMPTES D'ACCÈS =================
   Un compte partenaire est un administrateur borné à un pays.
   C'est la colonne 'pays' qui fait la restriction — sans elle, aucune donnée. */
const bcrypt = require('bcryptjs');

r.get('/admin/comptes', protege, role('admin'), async (_req, res) => {
  const { rows } = await q(
    `SELECT id, courriel, nom, role, pays, actif, cree_le, vu_le
       FROM administrateurs ORDER BY role, nom`);
  res.json(rows);
});

r.post('/admin/comptes', protege, role('admin'), async (req, res) => {
  const { courriel, nom, motdepasse, role: r2, pays } = req.body || {};
  if (!courriel || !nom || !motdepasse)
    return res.status(400).json({ erreur: 'Courriel, nom et mot de passe attendus' });
  if (String(motdepasse).length < 10)
    return res.status(400).json({ erreur: 'Mot de passe trop court (10 caractères minimum)' });
  if (!['admin', 'editeur', 'support', 'finance', 'operateur'].includes(r2))
    return res.status(400).json({ erreur: 'Rôle inconnu' });
  /* Un compte partenaire sans pays verrait tout : on refuse. */
  if (r2 === 'operateur' && !pays)
    return res.status(400).json({ erreur: 'Un compte partenaire doit être rattaché à un pays' });

  try {
    const { rows } = await q(
      `INSERT INTO administrateurs (courriel, motdepasse, nom, role, pays)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, courriel, nom, role, pays`,
      [String(courriel).toLowerCase().trim(), await bcrypt.hash(motdepasse, 12),
       nom, r2, r2 === 'operateur' ? pays : null]);
    await tracer(req, 'compte.cree', rows[0].courriel, { role: r2, pays: pays || null });
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ erreur: 'Ce courriel existe déjà' });
    console.error('[comptes] :', e.message);
    res.status(500).json({ erreur: 'Création impossible' });
  }
});

r.post('/admin/comptes/:id', protege, role('admin'), async (req, res) => {
  const { actif, motdepasse } = req.body || {};
  if (String(req.admin.id) === String(req.params.id) && actif === false)
    return res.status(400).json({ erreur: 'On ne suspend pas son propre compte' });
  try {
    if (motdepasse) {
      if (String(motdepasse).length < 10)
        return res.status(400).json({ erreur: 'Mot de passe trop court' });
      await q('UPDATE administrateurs SET motdepasse=$1 WHERE id=$2',
        [await bcrypt.hash(motdepasse, 12), req.params.id]);
      await tracer(req, 'compte.motdepasse', req.params.id);
    }
    if (actif != null) {
      await q('UPDATE administrateurs SET actif=$1 WHERE id=$2', [!!actif, req.params.id]);
      await tracer(req, actif ? 'compte.reactive' : 'compte.suspendu', req.params.id);
    }
    res.json({ id: +req.params.id, actif });
  } catch (e) {
    console.error('[comptes] :', e.message);
    res.status(500).json({ erreur: 'Modification impossible' });
  }
});

module.exports = r;
