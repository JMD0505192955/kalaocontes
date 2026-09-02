/* ============================================================
   Le seul fichier à modifier quand Orange et Moov fourniront
   leur documentation technique. Tout le reste de l'API est
   indépendant de leurs particularités.
   ============================================================ */
const crypto = require('crypto');
const { q } = require('./bd');

/* Le marché vient du contenu éditorial : le back office le tient à jour. */
async function marche(pays) {
  const { rows } = await q(`SELECT valeur FROM contenu WHERE section='marches'`);
  const L = rows[0]?.valeur || [];
  return L.find(m => m.pays === pays && m.actif !== 0) || null;
}

/* ---- Demande de prélèvement ----
   Chaque opérateur a sa propre interface. Tant qu'elle n'est pas connue,
   on reste en simulation : rien n'est encaissé, tout est tracé. */
async function prelever(marche, telephone, montant, pass) {
  const conf = configuration(marche);

  if (!conf.url) {
    /* Mode simulation : le rappel devra être déclenché à la main. */
    return {
      reference: 'sim-' + crypto.randomUUID(),
      statut: 'en_attente',
      simulation: true
    };
  }

  const r = await fetch(conf.url + '/paiements', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + conf.cle
    },
    body: JSON.stringify({
      msisdn: telephone,
      amount: montant,
      currency: marche.devise === 'F CFA' ? 'XOF' : marche.devise,
      reference: crypto.randomUUID(),
      description: 'Contes Faso — pass ' + pass
    })
  });

  if (!r.ok) throw new Error('passerelle ' + marche.operateur + ' : ' + r.status);
  const d = await r.json();
  return {
    reference: d.reference || d.transactionId,
    statut: d.status === 'SUCCESS' ? 'reussi' : 'en_attente'
  };
}

function configuration(marche) {
  const p = (marche.pays || '').toUpperCase();
  if (p === 'BF') return {
    url: process.env.ORANGE_BF_URL, cle: process.env.ORANGE_BF_CLE,
    secret: process.env.ORANGE_BF_SECRET };
  if (p === 'TG') return {
    url: process.env.MOOV_TG_URL, cle: process.env.MOOV_TG_CLE,
    secret: process.env.MOOV_TG_SECRET };
  return {};
}

/* ---- Rappels entrants ----
   Chaque opérateur nomme ses champs à sa façon. On traduit ici, une fois,
   plutôt que partout ailleurs. */
function lireRappel(operateur, corps) {
  if (!corps) return null;
  const commun = {
    reference: corps.reference || corps.transactionId || corps.txnId,
    statut: normaliser(corps.status || corps.statut),
    pass: corps.pass || (corps.description || '').split('pass ')[1],
    message: corps.message || corps.reason
  };
  if (!commun.reference) return null;
  commun.operateur = operateur === 'orange-bf' ? 'Orange Burkina Faso'
                   : operateur === 'moov-tg'   ? 'Moov Africa Togo'
                   : operateur;
  return commun;
}

function normaliser(s) {
  const v = String(s || '').toUpperCase();
  if (['SUCCESS','SUCCESSFUL','OK','COMPLETED','REUSSI'].includes(v)) return 'reussi';
  if (['FAILED','ERROR','REJECTED','ECHEC'].includes(v)) return 'echec';
  return 'en_attente';
}

/* ---- Signature des rappels ----
   Sans cela, n'importe qui pourrait déclarer un paiement réussi. */
function garderBrut(req, _res, buf) { req.brut = buf; }

function signatureValide(req) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[webhook] WEBHOOK_SECRET absent : signature non vérifiée');
    return process.env.NODE_ENV !== 'production';
  }
  const recue = req.headers['x-signature'] || req.headers['x-hub-signature-256'] || '';
  if (!recue || !req.brut) return false;
  const attendue = crypto.createHmac('sha256', secret).update(req.brut).digest('hex');
  const a = Buffer.from(recue.replace(/^sha256=/, ''));
  const b = Buffer.from(attendue);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { marche, prelever, lireRappel, garderBrut, signatureValide };
