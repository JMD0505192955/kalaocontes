/* ============================================================
   Redirection : l'abonné est envoyé sur une page de l'opérateur,
   il paie, puis revient sur le portail avec un jeton de retour.
   ============================================================ */
const crypto = require('crypto');

module.exports = {
  type: 'redirection',

  instructions(marche) {
    return {
      titre: 'Tu vas être redirigé',
      texte: `Le paiement se fait sur la page sécurisée de ${marche.operateur}. ` +
             `Tu reviendras ici automatiquement.`
    };
  },

  async demarrer(marche, telephone, montant, pass, conf) {
    const reference = crypto.randomUUID();
    if (!conf.url) return { reference, statut: 'en_attente', simulation: true };
    return {
      reference,
      statut: 'en_attente',
      url: `${conf.url}/payer?ref=${reference}&montant=${montant}&msisdn=${encodeURIComponent(telephone)}`
    };
  },

  lireRappel(corps) {
    if (!corps) return null;
    const reference = corps.reference || corps.order_id;
    if (!reference) return null;
    return {
      reference,
      statut: String(corps.status || '').toUpperCase() === 'PAID' ? 'reussi' : 'echec',
      pass: corps.pass,
      message: corps.message
    };
  },

  verifierCode() { return null; }
};
