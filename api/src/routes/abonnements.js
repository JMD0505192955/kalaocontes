/* Abonnements et prélèvements.
   Le dialogue technique avec chaque opérateur est isolé dans src/lib/operateurs.js :
   c'est le seul fichier à toucher quand Orange ou Moov fournissent leur documentation. */
const express = require('express');
const { q, transaction } = require('../lib/bd');
const { protege, role, tracer } = require('../lib/auth');
const ops = require('../lib/operateurs');

const r = express.Router();

const DUREES = { jour: 1, semaine: 7, mois: 30 };

/* --- demande d'abonnement, depuis le portail --- */
r.post('/abonnements', async (req, res) => {
  const { telephone, pass, pays } = req.body || {};
  if (!telephone || !DUREES[pass] || !pays)
    return res.status(400).json({ erreur: 'Numéro, pass et pays attendus' });

  try {
    const marche = await ops.marche(pays);
    if (!marche) return res.status(400).json({ erreur: 'Pays non desservi' });

    const prix = (marche.pass || []).find(p => p.id === pass)?.p;
    if (prix == null) return res.status(400).json({ erreur: 'Pass indisponible ici' });

    /* L'opérateur prélève. Tant qu'il n'a pas confirmé, rien n'est actif. */
    const dem = await ops.prelever(marche, telephone, prix, pass);

    const sortie = await transaction(async (c) => {
      const a = await c.query(
        `INSERT INTO abonnes (telephone, pays, operateur)
         VALUES ($1,$2,$3)
         ON CONFLICT (telephone) DO UPDATE SET vu_le=now()
         RETURNING id`, [telephone, pays, marche.operateur]);
      const abonneId = a.rows[0].id;

      await c.query(
        `INSERT INTO prelevements (abonne_id, montant, devise, operateur, reference, statut)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [abonneId, prix, marche.devise || 'XOF', marche.operateur, dem.reference, dem.statut]);

      return { abonneId, reference: dem.reference, statut: dem.statut };
    });

    res.json(sortie);
  } catch (e) {
    console.error('[abonnements] :', e.message);
    res.status(502).json({ erreur: 'La passerelle opérateur n\'a pas répondu' });
  }
});

/* --- rappel de l'opérateur : c'est lui qui confirme le paiement --- */
r.post('/webhooks/:operateur', express.json({ verify: ops.garderBrut }), async (req, res) => {
  if (!ops.signatureValide(req)) {
    console.warn('[webhook] signature refusée pour', req.params.operateur);
    return res.status(401).end();
  }

  try {
    const e = ops.lireRappel(req.params.operateur, req.body);
    if (!e) return res.status(400).json({ erreur: 'Rappel illisible' });

    await transaction(async (c) => {
      const p = await c.query(
        `UPDATE prelevements SET statut=$1, message=$2
          WHERE operateur=$3 AND reference=$4 RETURNING abonne_id, montant`,
        [e.statut, e.message || null, e.operateur, e.reference]);
      if (!p.rows.length) return;

      if (e.statut !== 'reussi') return;

      const jours = DUREES[e.pass] || 1;
      await c.query(
        `INSERT INTO abonnements (abonne_id, pass, prix, fin)
         VALUES ($1,$2,$3, now() + ($4 || ' days')::interval)`,
        [p.rows[0].abonne_id, e.pass, p.rows[0].montant, String(jours)]);
      await c.query(`UPDATE abonnes SET statut='actif' WHERE id=$1`, [p.rows[0].abonne_id]);
    });

    res.json({ recu: true });
  } catch (err) {
    console.error('[webhook] :', err.message);
    res.status(500).end();
  }
});

/* --- le portail demande si ce numéro a un abonnement en cours --- */
r.get('/abonnements/etat', async (req, res) => {
  const tel = req.query.telephone;
  if (!tel) return res.status(400).json({ erreur: 'Numéro attendu' });
  const { rows } = await q(
    `SELECT ab.pass, ab.fin, ab.reconduction
       FROM abonnements ab JOIN abonnes a ON a.id=ab.abonne_id
      WHERE a.telephone=$1 AND ab.statut='actif' AND ab.fin > now()
      ORDER BY ab.fin DESC LIMIT 1`, [tel]);
  res.json(rows.length ? { actif: true, ...rows[0] } : { actif: false });
});

/* --- résiliation --- */
r.post('/abonnements/resilier', async (req, res) => {
  const { telephone } = req.body || {};
  if (!telephone) return res.status(400).json({ erreur: 'Numéro attendu' });
  await q(
    `UPDATE abonnements SET reconduction=FALSE
      WHERE abonne_id=(SELECT id FROM abonnes WHERE telephone=$1) AND statut='actif'`,
    [telephone]);
  res.json({ resilie: true, message: 'Reconduction arrêtée. L\'accès reste ouvert jusqu\'à l\'échéance.' });
});

/* --- vue du back office --- */
r.get('/admin/abonnes', protege, role('admin','support','finance'), async (req, res) => {
  const { rows } = await q(
    `SELECT a.id, a.telephone, a.pays, a.operateur, a.statut, a.cree_le,
            ab.pass, ab.fin
       FROM abonnes a
       LEFT JOIN LATERAL (
         SELECT pass, fin FROM abonnements
          WHERE abonne_id=a.id AND statut='actif' ORDER BY fin DESC LIMIT 1) ab ON TRUE
      ORDER BY a.cree_le DESC LIMIT 200`);
  res.json(rows);
});

module.exports = r;
