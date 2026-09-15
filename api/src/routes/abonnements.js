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
    const e = await ops.lireRappel(req.params.operateur, req.body);
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

/* --- vue du back office, avec segmentation ---
   Les segments servent aux campagnes : on ne parle pas de la même façon
   à quelqu'un qui vient de s'inscrire et à un ancien abonné qui a résilié. */
r.get('/admin/abonnes', protege, role('admin','support','finance'), async (req, res) => {
  const segment = req.query.segment || null;
  const pays = req.query.pays || null;
  const p = [];
  let ou = '';
  if (pays) { p.push(pays); ou += ` AND a.pays=$${p.length}`; }

  const { rows } = await q(
    `WITH base AS (
       SELECT a.id, a.telephone, a.pays, a.operateur, a.statut, a.cree_le, a.vu_le,
              ab.pass, ab.fin, ab.reconduction,
              (SELECT count(*)::int FROM abonnements x WHERE x.abonne_id=a.id) AS nb_abos,
              (SELECT count(*)::int FROM prelevements x
                WHERE x.abonne_id=a.id AND x.statut='reussi') AS nb_paiements,
              (SELECT COALESCE(sum(montant),0)::int FROM prelevements x
                WHERE x.abonne_id=a.id AND x.statut='reussi') AS total_paye,
              (SELECT count(*)::int FROM prelevements x
                WHERE x.abonne_id=a.id AND x.statut='echec'
                  AND x.cree_le > now() - interval '30 days') AS echecs_recents
         FROM abonnes a
         LEFT JOIN LATERAL (
           SELECT pass, fin, reconduction FROM abonnements
            WHERE abonne_id=a.id AND statut='actif' AND fin > now()
            ORDER BY fin DESC LIMIT 1) ab ON TRUE
        WHERE TRUE ${ou}
     )
     SELECT *,
       CASE
         WHEN echecs_recents > 0 AND fin IS NULL           THEN 'echec_paiement'
         WHEN fin IS NOT NULL AND nb_abos = 1              THEN 'nouveau_payant'
         WHEN fin IS NOT NULL AND nb_abos > 1              THEN 'fidele'
         WHEN fin IS NULL AND nb_abos > 0                  THEN 'ancien'
         WHEN cree_le > now() - interval '7 days'          THEN 'nouveau'
         ELSE 'inscrit_dormant'
       END AS segment
       FROM base
      ORDER BY cree_le DESC LIMIT 500`, p);

  const L = segment ? rows.filter(x => x.segment === segment) : rows;
  const compte = {};
  rows.forEach(x => { compte[x.segment] = (compte[x.segment] || 0) + 1; });

  res.json({ total: rows.length, segments: compte, abonnes: L });
});

/* --- fiche détaillée d'un abonné --- */
r.get('/admin/abonnes/:id', protege, role('admin','support','finance'), async (req, res) => {
  const id = req.params.id;
  try {
    const [fiche, abos, prels] = await Promise.all([
      q(`SELECT id, telephone, pays, operateur, statut, cree_le, vu_le
           FROM abonnes WHERE id=$1`, [id]),
      q(`SELECT pass, prix, devise, debut, fin, reconduction, statut, cree_le
           FROM abonnements WHERE abonne_id=$1 ORDER BY cree_le DESC LIMIT 50`, [id]),
      q(`SELECT montant, devise, operateur, reference, statut, message, cree_le
           FROM prelevements WHERE abonne_id=$1 ORDER BY cree_le DESC LIMIT 50`, [id])
    ]);
    if (!fiche.rows.length) return res.status(404).json({ erreur: 'Abonné inconnu' });

    const paye = prels.rows.filter(x => x.statut === 'reussi');
    res.json({
      ...fiche.rows[0],
      abonnements: abos.rows,
      prelevements: prels.rows,
      resume: {
        nb_abonnements: abos.rows.length,
        nb_paiements: paye.length,
        total_paye: paye.reduce((s, x) => s + x.montant, 0),
        echecs: prels.rows.filter(x => x.statut === 'echec').length
      }
    });
  } catch (e) {
    console.error('[abonnes] fiche :', e.message);
    res.status(500).json({ erreur: 'Lecture impossible' });
  }
});

/* ---- Inscription : on enregistre le strict nécessaire ----
   Numéro, pays, date. Ni prénom, ni avatar, ni historique d'écoute :
   ces informations restent sur le téléphone de la famille. */
r.post('/abonnes', async (req, res) => {
  const { telephone, pays } = req.body || {};
  if (!telephone || !pays)
    return res.status(400).json({ erreur: 'Numéro et pays attendus' });
  if (!/^\+\d{6,20}$/.test(String(telephone).replace(/\s/g, '')))
    return res.status(400).json({ erreur: 'Numéro mal formé' });

  try {
    const m = await ops.marche(pays);
    const { rows } = await q(
      `INSERT INTO abonnes (telephone, pays, operateur, statut)
       VALUES ($1,$2,$3,'essai')
       ON CONFLICT (telephone) DO UPDATE SET vu_le=now()
       RETURNING id, statut, cree_le`,
      [String(telephone).replace(/\s/g, ''), pays, m ? m.operateur : null]);
    res.json({ id: rows[0].id, statut: rows[0].statut });
  } catch (e) {
    console.error('[abonnes] inscription :', e.message);
    res.status(500).json({ erreur: 'Enregistrement impossible' });
  }
});

/* Les comptes jamais abonnés ne sont pas conservés indéfiniment.
   À appeler par une tâche planifiée ; le délai est en jours. */
r.post('/admin/purger-inscrits', protege, role('admin'), async (req, res) => {
  const jours = Math.max(30, parseInt(req.body?.jours, 10) || 180);
  const { rowCount } = await q(
    `DELETE FROM abonnes a
      WHERE a.statut='essai'
        AND a.cree_le < now() - ($1 || ' days')::interval
        AND NOT EXISTS (SELECT 1 FROM abonnements ab WHERE ab.abonne_id=a.id)`,
    [String(jours)]);
  await tracer(req, 'abonnes.purge', null, { jours, supprimes: rowCount });
  res.json({ supprimes: rowCount, jours });
});

/* ---- Ce que le portail doit afficher après le choix du pass ----
   Le texte dépend du parcours de l'opérateur : prélèvement direct,
   mot-clé à envoyer, ou redirection. */
r.get('/abonnements/instructions', async (req, res) => {
  const { pays, pass } = req.query;
  if (!pays || !pass) return res.status(400).json({ erreur: 'Pays et pass attendus' });
  const m = await ops.marche(pays);
  if (!m) return res.status(400).json({ erreur: 'Pays non desservi' });
  const a = ops.adaptateur(m);
  res.json(Object.assign({ type: a.type }, a.instructions(m, pass)));
});

/* ---- Parcours par code : l'abonné saisit celui reçu par SMS ---- */
r.post('/abonnements/code', async (req, res) => {
  const { telephone, pays, code } = req.body || {};
  if (!telephone || !pays || !code)
    return res.status(400).json({ erreur: 'Numéro, pays et code attendus' });
  try {
    const m = await ops.marche(pays);
    if (!m) return res.status(400).json({ erreur: 'Pays non desservi' });
    const v = await ops.verifierCode(m, telephone, code);
    if (!v) return res.status(400).json({ erreur: 'Ce marché n\'utilise pas de code' });
    if (!v.valide)
      return res.status(404).json({ erreur: v.raison || 'Code inconnu ou expiré' });
    res.json({ valide: true });
  } catch (e) {
    console.error('[abonnements] code :', e.message);
    res.status(500).json({ erreur: 'Vérification impossible' });
  }
});

/* ================= ACHAT DÉFINITIF D'UN CONTE =================
   Là où le prélèvement récurrent n'existe pas, un paiement unique
   doit donner quelque chose de définitif. Un conte acheté reste
   acquis : aucune échéance, aucune révocation. */

r.post('/achats/demarrer', async (req, res) => {
  const { telephone, pays, conte, portefeuille } = req.body || {};
  if (!telephone || !pays || !conte)
    return res.status(400).json({ erreur: 'Numéro, pays et conte attendus' });

  try {
    const m = await ops.marche(pays);
    if (!m) return res.status(400).json({ erreur: 'Pays non desservi' });
    const prix = (m.prixConte != null) ? m.prixConte : 200;

    const tel = String(telephone).replace(/\s/g, '');
    const { rows } = await q('SELECT id FROM abonnes WHERE telephone=$1', [tel]);
    if (!rows.length) return res.status(404).json({ erreur: 'Compte inconnu' });
    const abonneId = rows[0].id;

    /* Déjà acheté : on ne fait pas payer deux fois. */
    const deja = await q('SELECT 1 FROM achats WHERE abonne_id=$1 AND conte=$2',
      [abonneId, conte]);
    if (deja.rowCount)
      return res.json({ deja: true, message: 'Tu possèdes déjà ce conte.' });

    const conf = Object.assign({}, ops.configuration ? ops.configuration(m) : {},
      { portefeuille });
    const d = await ops.adaptateur(m).demarrer(m, tel, prix, 'conte:' + conte, conf);

    await q(
      `INSERT INTO prelevements (abonne_id, montant, devise, operateur, reference, statut, message)
       VALUES ($1,$2,$3,$4,$5,'en_attente',$6)`,
      [abonneId, prix, m.devise === 'F CFA' ? 'XOF' : m.devise,
       m.operateur || 'agrégateur', d.reference, 'achat conte ' + conte]);

    res.json({
      reference: d.reference, jeton: d.jeton, url: d.url,
      statut: d.statut, prix, devise: 'XOF',
      simulation: !!d.simulation, portefeuille: d.portefeuille
    });
  } catch (e) {
    console.error('[achats] démarrage :', e.message);
    res.status(500).json({ erreur: 'Paiement impossible pour le moment' });
  }
});

/* Le paiement a abouti : on inscrit l'achat. Appelé par le rappel,
   ou par la vérification de statut si le rappel s'est perdu. */
async function inscrireAchat(reference) {
  const { rows } = await q(
    `SELECT p.abonne_id, p.montant, p.devise, p.message, a.pays
       FROM prelevements p JOIN abonnes a ON a.id=p.abonne_id
      WHERE p.reference=$1`, [reference]);
  if (!rows.length) return null;
  const x = rows[0];
  const m = /achat conte (.+)$/.exec(x.message || '');
  if (!m) return null;

  await q(
    `INSERT INTO achats (abonne_id, conte, prix, devise, reference, pays)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (abonne_id, conte) DO NOTHING`,
    [x.abonne_id, m[1], x.montant, x.devise, reference, x.pays]);
  await q(`UPDATE prelevements SET statut='reussi' WHERE reference=$1`, [reference]);
  return m[1];
}

/* Le portail demande où en est son paiement. */
r.get('/achats/statut', async (req, res) => {
  const { reference, jeton, pays } = req.query;
  if (!reference) return res.status(400).json({ erreur: 'Référence attendue' });
  try {
    const { rows } = await q('SELECT statut FROM prelevements WHERE reference=$1', [reference]);
    if (!rows.length) return res.status(404).json({ erreur: 'Référence inconnue' });

    if (rows[0].statut === 'reussi') {
      const c = await q('SELECT conte FROM achats WHERE reference=$1', [reference]);
      return res.json({ statut: 'reussi', conte: c.rows[0] && c.rows[0].conte });
    }

    /* Toujours en attente : on interroge l'agrégateur, le rappel a pu se perdre. */
    if (jeton && pays) {
      const m = await ops.marche(pays);
      const a = ops.adaptateur(m);
      if (a.verifierStatut) {
        const v = await a.verifierStatut(jeton,
          ops.configuration ? ops.configuration(m) : {});
        if (v && v.statut === 'reussi') {
          const conte = await inscrireAchat(reference);
          return res.json({ statut: 'reussi', conte });
        }
        if (v && v.statut === 'echec') {
          await q(`UPDATE prelevements SET statut='echec' WHERE reference=$1`, [reference]);
          return res.json({ statut: 'echec' });
        }
      }
    }
    res.json({ statut: 'en_attente' });
  } catch (e) {
    console.error('[achats] statut :', e.message);
    res.status(500).json({ erreur: 'Vérification impossible' });
  }
});

/* La liste des contes possédés, que le portail consulte au démarrage. */
r.get('/achats', async (req, res) => {
  const tel = String(req.query.telephone || '').replace(/\s/g, '');
  if (!tel) return res.status(400).json({ erreur: 'Numéro attendu' });
  const { rows } = await q(
    `SELECT ac.conte, ac.cree_le FROM achats ac
       JOIN abonnes a ON a.id=ac.abonne_id
      WHERE a.telephone=$1 ORDER BY ac.cree_le DESC`, [tel]);
  res.json({ contes: rows.map(x => x.conte), detail: rows });
});

/* Le rappel de l'agrégateur. */
r.post('/rappel/agregateur', async (req, res) => {
  try {
    const a = require('../adaptateurs/agregateur');
    const lu = a.lireRappel(req.body);
    if (!lu) return res.status(400).json({ erreur: 'Rappel illisible' });

    if (lu.statut === 'reussi') await inscrireAchat(lu.reference);
    else if (lu.statut === 'echec')
      await q(`UPDATE prelevements SET statut='echec', message=COALESCE($2,message)
                WHERE reference=$1`, [lu.reference, lu.message]);

    res.json({ recu: true });
  } catch (e) {
    console.error('[rappel] agrégateur :', e.message);
    res.status(500).json({ erreur: 'Traitement impossible' });
  }
});

module.exports = r;
