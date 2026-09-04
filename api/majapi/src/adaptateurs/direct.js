/* ============================================================
   Prélèvement direct : nous appelons l'interface de l'opérateur,
   il prélève, puis confirme par un rappel.
   L'abonné ne quitte jamais le portail.
   ============================================================ */
const crypto = require('crypto');

module.exports = {
  type: 'direct',

  instructions(marche, pass) {
    return {
      titre: 'Confirme ton abonnement',
      texte: `Le montant sera prélevé sur ton crédit ${marche.operateur || 'téléphonique'} ` +
             `ou ton mobile money. Tu recevras un SMS de confirmation.`
    };
  },

  async demarrer(marche, telephone, montant, pass, conf) {
    if (!conf.url) {
      /* Sans accès opérateur : simulation. Rien n'est encaissé, tout est tracé. */
      return { reference: 'sim-' + crypto.randomUUID(), statut: 'en_attente', simulation: true };
    }
    const r = await fetch(conf.url + '/paiements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + conf.cle },
      body: JSON.stringify({
        msisdn: telephone,
        amount: montant,
        currency: marche.devise === 'F CFA' ? 'XOF' : marche.devise,
        reference: crypto.randomUUID(),
        description: 'AfriKfables — pass ' + pass
      })
    });
    if (!r.ok) throw new Error(`passerelle ${marche.operateur} : ${r.status}`);
    const d = await r.json();
    return {
      reference: d.reference || d.transactionId,
      statut: normaliser(d.status)
    };
  },

  lireRappel(corps) {
    if (!corps) return null;
    const reference = corps.reference || corps.transactionId || corps.txnId;
    if (!reference) return null;
    return {
      reference,
      statut: normaliser(corps.status || corps.statut),
      pass: corps.pass || (corps.description || '').split('pass ')[1],
      message: corps.message || corps.reason
    };
  },

  verifierCode() { return null; }   /* sans objet pour ce parcours */
};

function normaliser(s) {
  const v = String(s || '').toUpperCase();
  if (['SUCCESS', 'SUCCESSFUL', 'OK', 'COMPLETED', 'REUSSI'].includes(v)) return 'reussi';
  if (['FAILED', 'ERROR', 'REJECTED', 'ECHEC'].includes(v)) return 'echec';
  return 'en_attente';
}
