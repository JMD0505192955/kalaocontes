/* ============================================================
   Portail partenaire — accès opérateur.
   Chaque route est bornée au pays du compte. Un partenaire ne peut
   pas voir les données d'un autre, même en modifiant sa requête :
   le pays vient du jeton, jamais des paramètres.
   ============================================================ */
const express = require('express');
const { q } = require('../lib/bd');
const { protege, tracer } = require('../lib/auth');

const r = express.Router();

/* Le garde-fou central. Sans pays dans le jeton, rien ne passe. */
function partenaire(req, res, suite) {
  if (!req.admin) return res.status(401).json({ erreur: 'Non authentifié' });
  if (req.admin.role !== 'operateur' || !req.admin.pays)
    return res.status(403).json({ erreur: 'Ce compte n\'est pas un compte partenaire' });
  req.pays = req.admin.pays;
  suite();
}

function periode(req) {
  const j = Math.min(365, Math.max(1, parseInt(req.query.jours, 10) || 30));
  return j;
}

/* ---- Performances : abonnés, revenu, conversion ---- */
r.get('/partenaire/performances', protege, partenaire, async (req, res) => {
  const j = periode(req);
  try {
    const [abo, rev, parPass, serie] = await Promise.all([
      q(`SELECT count(*)::int n FROM abonnes WHERE pays=$1 AND statut='actif'`, [req.pays]),
      q(`SELECT COALESCE(sum(p.montant),0)::int total,
                count(*) FILTER (WHERE p.statut='reussi')::int reussis,
                count(*) FILTER (WHERE p.statut='echec')::int echecs
           FROM prelevements p JOIN abonnes a ON a.id=p.abonne_id
          WHERE a.pays=$1 AND p.cree_le > now() - ($2 || ' days')::interval
            AND p.statut='reussi'`, [req.pays, String(j)]),
      q(`SELECT ab.pass, count(*)::int n, COALESCE(sum(ab.prix),0)::int total
           FROM abonnements ab JOIN abonnes a ON a.id=ab.abonne_id
          WHERE a.pays=$1 AND ab.cree_le > now() - ($2 || ' days')::interval
          GROUP BY ab.pass ORDER BY total DESC`, [req.pays, String(j)]),
      q(`SELECT date_trunc('week', ab.cree_le)::date semaine, count(*)::int n
           FROM abonnements ab JOIN abonnes a ON a.id=ab.abonne_id
          WHERE a.pays=$1 AND ab.cree_le > now() - ($2 || ' days')::interval
          GROUP BY 1 ORDER BY 1`, [req.pays, String(j)])
    ]);
    await tracer(req, 'partenaire.performances', req.pays, { jours: j });
    res.json({
      pays: req.pays, jours: j,
      abonnesActifs: abo.rows[0].n,
      revenu: rev.rows[0].total,
      prelevements: { reussis: rev.rows[0].reussis, echecs: rev.rows[0].echecs },
      parPass: parPass.rows,
      parSemaine: serie.rows
    });
  } catch (e) {
    console.error('[partenaire] performances :', e.message);
    res.status(500).json({ erreur: 'Lecture impossible' });
  }
});

/* ---- Réconciliation : notre relevé face au leur ---- */
r.get('/partenaire/reconciliation', protege, partenaire, async (req, res) => {
  const mois = req.query.mois || new Date().toISOString().slice(0, 7);
  try {
    const { rows } = await q(
      `WITH nous AS (
         SELECT p.reference, p.montant, p.statut
           FROM prelevements p JOIN abonnes a ON a.id=p.abonne_id
          WHERE a.pays=$1 AND to_char(p.cree_le,'YYYY-MM')=$2
       ), eux AS (
         SELECT reference, montant, statut FROM releves_operateur
          WHERE pays=$1 AND to_char(periode,'YYYY-MM')=$2
       )
       SELECT COALESCE(n.reference, e.reference) reference,
              n.montant montant_nous, e.montant montant_eux,
              n.statut statut_nous, e.statut statut_eux,
              CASE
                WHEN n.reference IS NULL THEN 'absent chez nous'
                WHEN e.reference IS NULL THEN 'absent chez eux'
                WHEN n.montant <> e.montant THEN 'montant différent'
                WHEN n.statut <> e.statut THEN 'statut différent'
                ELSE 'concordant'
              END ecart
         FROM nous n FULL OUTER JOIN eux e ON n.reference=e.reference
        ORDER BY ecart, reference LIMIT 500`, [req.pays, mois]);

    const ecarts = rows.filter(x => x.ecart !== 'concordant');
    res.json({
      pays: req.pays, mois,
      total: rows.length,
      concordants: rows.length - ecarts.length,
      ecarts: ecarts.length,
      lignes: ecarts.slice(0, 200)
    });
  } catch (e) {
    console.error('[partenaire] réconciliation :', e.message);
    res.status(500).json({ erreur: 'Lecture impossible' });
  }
});

/* ---- Dépôt du relevé opérateur ---- */
r.post('/partenaire/releve', protege, partenaire, async (req, res) => {
  const lignes = Array.isArray(req.body?.lignes) ? req.body.lignes : null;
  const mois = req.body?.mois;
  if (!lignes || !mois) return res.status(400).json({ erreur: 'Mois et lignes attendus' });
  if (lignes.length > 20000) return res.status(413).json({ erreur: 'Relevé trop volumineux' });

  try {
    let n = 0;
    for (const l of lignes) {
      if (!l.reference) continue;
      await q(
        `INSERT INTO releves_operateur (operateur, pays, periode, reference, montant, statut, depose_par)
         VALUES ($1,$2,$3::date,$4,$5,$6,$7)
         ON CONFLICT (operateur, reference) DO UPDATE
           SET montant=$5, statut=$6, depose_le=now()`,
        [req.admin.nom, req.pays, mois + '-01', String(l.reference),
         parseInt(l.montant, 10) || 0, String(l.statut || 'reussi'), req.admin.id]);
      n++;
    }
    await tracer(req, 'partenaire.releve', req.pays, { mois, lignes: n });
    res.json({ deposees: n, mois });
  } catch (e) {
    console.error('[partenaire] dépôt relevé :', e.message);
    res.status(500).json({ erreur: 'Dépôt impossible' });
  }
});

/* ---- Les pass proposés dans ce pays ---- */
r.get('/partenaire/pass', protege, partenaire, async (req, res) => {
  const { rows } = await q(`SELECT valeur FROM contenu WHERE section='marches'`);
  const m = (rows[0]?.valeur || []).find(x => x.pays === req.pays);
  if (!m) return res.status(404).json({ erreur: 'Marché introuvable' });
  res.json({
    pays: m.pays, nom: m.nom, operateur: m.operateur, devise: m.devise,
    courtCode: m.courtCode, motStop: m.motStop, pass: m.pass || []
  });
});

/* ---- Le partenaire signale, il ne modifie pas ----
   Deux demandes possibles : un écart de facturation, ou un nouveau pass.
   Dans les deux cas, c'est l'équipe qui tranche. */
r.post('/partenaire/demandes', protege, partenaire, async (req, res) => {
  const { type, periode, montant, intitule, duree, message } = req.body || {};
  if (!['ecart', 'pass'].includes(type))
    return res.status(400).json({ erreur: 'Type de demande inconnu' });
  if (type === 'ecart' && !periode)
    return res.status(400).json({ erreur: 'Période attendue' });
  if (type === 'pass' && !intitule)
    return res.status(400).json({ erreur: 'Nom du pass attendu' });

  try {
    const { rows } = await q(
      `INSERT INTO demandes_partenaire
         (type, pays, operateur, demandeur, periode, montant, intitule, duree, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, cree_le`,
      [type, req.pays, req.admin.nom, req.admin.id, periode || null,
       parseInt(montant, 10) || null, intitule || null, duree || null,
       (message || '').slice(0, 2000)]);

    await tracer(req, 'partenaire.demande', req.pays, { type, id: rows[0].id });
    res.json({
      id: rows[0].id, statut: 'ouverte',
      message: type === 'ecart'
        ? "Écart signalé. L'équipe finance vous répondra après vérification."
        : "Demande transmise. L'équipe produit vous répondra après étude."
    });
  } catch (e) {
    console.error('[partenaire] demande :', e.message);
    res.status(500).json({ erreur: 'Envoi impossible' });
  }
});

/* Le partenaire suit ses propres demandes. */
r.get('/partenaire/demandes', protege, partenaire, async (req, res) => {
  const { rows } = await q(
    `SELECT id, type, periode, montant, intitule, message, statut, reponse, cree_le
       FROM demandes_partenaire WHERE pays=$1 ORDER BY cree_le DESC LIMIT 50`, [req.pays]);
  res.json(rows);
});

module.exports = r;
