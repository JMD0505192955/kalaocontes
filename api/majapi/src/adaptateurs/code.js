/* ============================================================
   Code par SMS : l'abonné envoie un mot-clé au numéro court.
   L'opérateur prélève, génère un code d'accès et le lui envoie.
   L'abonné revient saisir ce code sur le portail.

   C'est le parcours décrit par Moov Africa Togo.
   Nous ne sommes pas dans la boucle du paiement : nous ne voyons
   que le code, qu'il faut pouvoir reconnaître.
   ============================================================ */
const { q } = require('../lib/bd');

/* Le mot-clé peut différer par pass. À renseigner dans le marché :
   motsCles: { jour:'JOUR', semaine:'SEM', mois:'MOIS' } */
function motCle(marche, pass) {
  const m = marche.motsCles || {};
  return m[pass] || marche.motCleUnique || 'CONTES';
}

module.exports = {
  type: 'code',

  instructions(marche, pass) {
    return {
      titre: 'Envoie le mot-clé',
      texte: `Depuis ton téléphone, envoie « ${motCle(marche, pass)} » au ` +
             `${marche.courtCode || 'numéro court'}. Tu recevras un code par SMS. ` +
             `Reviens ensuite le saisir ici.`,
      motCle: motCle(marche, pass),
      courtCode: marche.courtCode
    };
  },

  /* Rien à déclencher côté serveur : c'est l'abonné qui agit.
     On enregistre l'intention pour pouvoir rapprocher ensuite. */
  async demarrer(marche, telephone, montant, pass) {
    return {
      reference: 'attente-' + telephone + '-' + Date.now(),
      statut: 'en_attente',
      attendCode: true
    };
  },

  /* L'opérateur nous prévient de la facturation réussie et nous transmet le code. */
  lireRappel(corps) {
    if (!corps) return null;
    const code = corps.code || corps.accessCode || corps.token;
    const reference = corps.reference || corps.transactionId || code;
    if (!reference) return null;
    return {
      reference,
      code,
      telephone: corps.msisdn || corps.telephone,
      statut: String(corps.status || '').toUpperCase() === 'SUCCESS' ? 'reussi' : 'echec',
      pass: corps.pass || corps.offer,
      message: corps.message
    };
  },

  /* L'abonné saisit le code : on le cherche parmi ceux que l'opérateur nous a transmis. */
  async verifierCode(marche, telephone, code) {
    const { rows } = await q(
      `SELECT p.id, p.reference, p.message, p.cree_le, a.telephone
         FROM prelevements p JOIN abonnes a ON a.id = p.abonne_id
        WHERE p.operateur = $1 AND p.reference = $2 AND p.statut = 'reussi'
          AND p.cree_le > now() - interval '48 hours'
        LIMIT 1`, [marche.operateur, String(code).trim()]);
    if (!rows.length) return { valide: false };

    /* Le code n'est valable que pour le numéro auquel il a été envoyé. */
    if (rows[0].telephone && telephone &&
        rows[0].telephone.replace(/\s/g, '') !== telephone.replace(/\s/g, ''))
      return { valide: false, raison: 'code émis pour un autre numéro' };

    return { valide: true, prelevement: rows[0].id };
  }
};
