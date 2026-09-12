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

/* ---- Le parcours dépend de l'opérateur ----
   Le socle ne connaît que trois verbes : instructions, démarrer, lire un rappel.
   Chaque adaptateur traduit les particularités de son opérateur. */
const adaptateurs = require('../adaptateurs');

function adaptateur(marche) { return adaptateurs.pour(marche); }

/* Ce que le portail affiche après le choix du pass. */
function instructions(marche, pass) {
  return adaptateur(marche).instructions(marche, pass);
}

async function prelever(marche, telephone, montant, pass) {
  return adaptateur(marche).demarrer(marche, telephone, montant, pass, configuration(marche));
}

/* Pour les parcours par code : vérifie celui que l'abonné saisit. */
async function verifierCode(marche, telephone, code) {
  const a = adaptateur(marche);
  return a.verifierCode ? a.verifierCode(marche, telephone, code) : null;
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
   L'adaptateur du marché traduit ; le socle ne voit qu'un vocabulaire commun. */
async function lireRappel(cle, corps) {
  if (!corps) return null;
  /* la clé du rappel désigne le marché : 'orange-bf', 'moov-tg'… */
  const pays = String(cle || '').split('-').pop();
  const m = await marche(pays);
  const lu = adaptateur(m).lireRappel(corps);
  if (!lu) return null;
  lu.operateur = (m && m.operateur) || cle;
  return lu;
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

/* Retrouve le marché à partir de l'indicatif d'un numéro.
   C'est la seule façon fiable de savoir qui peut facturer ce numéro :
   un pays déclaré se change, un indicatif non. */
async function marcheParIndicatif(telephone) {
  const t = String(telephone || '').replace(/\s/g, '');
  if (!t.startsWith('+')) return null;
  const { rows } = await q(
    `SELECT valeur FROM contenu WHERE section='marches'`);
  const L = rows[0] ? rows[0].valeur : [];
  /* l'indicatif le plus long qui correspond gagne : +225 avant +22 */
  let trouve = null;
  for (const m of L) {
    if (!m.ind) continue;
    const ind = String(m.ind).replace(/\s/g, '');
    if (t.startsWith(ind) && (!trouve || ind.length > String(trouve.ind).length))
      trouve = m;
  }
  return trouve;
}

module.exports = { marche, marcheParIndicatif, prelever, lireRappel, instructions, verifierCode,
                   garderBrut, signatureValide, adaptateur };
