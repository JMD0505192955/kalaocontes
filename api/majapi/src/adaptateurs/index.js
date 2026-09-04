/* Choix de l'adaptateur selon le marché.
   Le type est déclaré dans la ligne du marché ; à défaut, prélèvement direct. */
const direct = require('./direct');
const code = require('./code');
const redirection = require('./redirection');

const PAR_TYPE = { direct, code, redirection };

/* Un opérateur peut avoir son propre fichier, qui prime sur le type générique. */
const SPECIFIQUES = {
  // 'tg-moov': require('./tg-moov'),
  // 'bf-orange': require('./bf-orange'),
};

function pour(marche) {
  if (!marche) return direct;
  const cle = (marche.pays || '') + '-' + (marche.adaptateur || '');
  if (SPECIFIQUES[cle]) return SPECIFIQUES[cle];
  return PAR_TYPE[marche.type] || direct;
}

module.exports = { pour, PAR_TYPE };
