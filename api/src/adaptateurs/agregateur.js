/* ============================================================
   Agrégateur mobile money — Babimo (B-Pay).

   L'abonné paie depuis son portefeuille : Wave, Orange Money,
   MTN MoMo ou Moov Money. Une seule intégration couvre les quatre.

   Particularité qui change le produit : aucun prélèvement
   récurrent. Chaque paiement est unique et demande une action
   de l'abonné. C'est pourquoi les marchés servis par cette voie
   proposent l'achat définitif plutôt que l'abonnement reconductible.
   ============================================================ */
const crypto = require('crypto');

/* Le jeton vaut une heure : on le garde plutôt que de le redemander. */
let jeton = null, jetonExpire = 0;

async function connexion(conf) {
  if (jeton && Date.now() < jetonExpire) return jeton;
  if (!conf.url || !conf.cle || !conf.secret)
    throw new Error('accès agrégateur non configurés');

  const r = await fetch(conf.url + '/oauth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: conf.cle, password: conf.secret })
  });
  if (!r.ok) throw new Error('agrégateur : connexion refusée (' + r.status + ')');
  const d = await r.json();
  const t = d.authorisation && d.authorisation.token;
  if (!t) throw new Error('agrégateur : jeton absent de la réponse');
  jeton = t;
  jetonExpire = Date.now() + 55 * 60 * 1000;
  return jeton;
}

const PORTEFEUILLES = {
  wave: { code: 'WAVE_CI', nom: 'Wave' },
  om:   { code: 'OM_CI',   nom: 'Orange Money' },
  mtn:  { code: 'MTN_CI',  nom: 'MTN MoMo' },
  moov: { code: 'MOOV_CI', nom: 'Moov Money' }
};

function normaliser(s) {
  const v = String(s || '').toUpperCase();
  if (['SUCCESS','SUCCESSFULL','SUCCESSFUL','COMPLETED','PAID'].includes(v)) return 'reussi';
  if (['FAILED','ERROR','CANCELLED','CANCELED','EXPIRED'].includes(v)) return 'echec';
  return 'en_attente';
}

module.exports = {
  type: 'agregateur',
  portefeuilles: PORTEFEUILLES,

  instructions(marche) {
    return {
      titre: 'Choisis ton moyen de paiement',
      texte: "Wave, Orange Money, MTN ou Moov. Tu valides depuis ton téléphone, " +
             "et l'accès s'ouvre aussitôt.",
      portefeuilles: Object.keys(PORTEFEUILLES).map(k => ({ id: k, nom: PORTEFEUILLES[k].nom }))
    };
  },

  async demarrer(marche, telephone, montant, quoi, conf) {
    const ref = 'AF-' + crypto.randomUUID().slice(0, 18);
    const p = (conf.portefeuille && PORTEFEUILLES[conf.portefeuille]) || PORTEFEUILLES.wave;

    if (!conf.url) return { reference: ref, statut: 'en_attente', simulation: true };

    const t = await connexion(conf);
    const r = await fetch(conf.url + '/paiement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t },
      body: JSON.stringify({
        currency: 'XOF',
        payment_method: p.code,
        merchant_transaction_id: ref,
        amount: montant,
        telephone: String(telephone).replace(/[^\d]/g, ''),
        success_url: conf.retour + '/paiement/ok?ref=' + ref,
        failed_url:  conf.retour + '/paiement/echec?ref=' + ref,
        notify_url:  conf.retour + '/api/rappel/agregateur'
      })
    });
    if (!r.ok) throw new Error('agrégateur : paiement refusé (' + r.status + ')');
    const d = await r.json();
    const dd = d.data || {};
    return {
      reference: ref,
      jeton: dd.pay_token,
      statut: normaliser(dd.status),
      /* Wave renvoie une page ; les autres poussent sur le téléphone. */
      url: dd.payment_url || null,
      portefeuille: p.nom
    };
  },

  lireRappel(corps) {
    if (!corps) return null;
    const reference = corps.merchant_transaction_id || corps.reference || corps.pay_token;
    if (!reference) return null;
    return {
      reference,
      jeton: corps.pay_token,
      statut: normaliser(corps.statut || corps.status),
      message: corps.message
    };
  },

  /* Un rappel peut se perdre : on sait aussi demander le statut. */
  async verifierStatut(jetonPaiement, conf) {
    if (!conf.url) return null;
    const t = await connexion(conf);
    const r = await fetch(conf.url + '/check-status/' + jetonPaiement, {
      headers: { 'Authorization': 'Bearer ' + t }
    });
    if (!r.ok) return null;
    const d = await r.json();
    return { statut: normaliser(d.statut || d.status), message: d.message };
  },

  verifierCode() { return null; }
};
