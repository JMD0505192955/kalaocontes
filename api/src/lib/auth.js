/* Authentification du back office : jeton signé, rôles, journal. */
const jwt = require('jsonwebtoken');
const { q } = require('./bd');

const SECRET = process.env.JWT_SECRET;
const DUREE = process.env.JWT_DUREE || '12h';

function signer(admin) {
  return jwt.sign(
    { id: admin.id, courriel: admin.courriel, role: admin.role, nom: admin.nom, pays: admin.pays || null },
    SECRET, { expiresIn: DUREE }
  );
}

/* Vérifie le jeton. Sans lui, rien ne passe. */
function protege(req, res, suite) {
  const e = req.headers.authorization || '';
  const jeton = e.startsWith('Bearer ') ? e.slice(7) : null;
  if (!jeton) return res.status(401).json({ erreur: 'Jeton absent' });
  try {
    req.admin = jwt.verify(jeton, SECRET);
    suite();
  } catch {
    res.status(401).json({ erreur: 'Jeton invalide ou expiré' });
  }
}

/* Restreint une route à certains rôles. */
function role(...permis) {
  return (req, res, suite) => {
    if (!req.admin || !permis.includes(req.admin.role))
      return res.status(403).json({ erreur: 'Droits insuffisants' });
    suite();
  };
}

/* Trace ce qui a été fait, par qui, et depuis où. */
async function tracer(req, action, cible, details) {
  try {
    await q(
      'INSERT INTO journal (qui, action, cible, details, ip) VALUES ($1,$2,$3,$4,$5)',
      [req.admin ? req.admin.id : null, action, cible || null,
       details ? JSON.stringify(details) : null,
       req.headers['x-forwarded-for'] || req.socket.remoteAddress || null]
    );
  } catch (e) {
    console.error('[journal] écriture impossible :', e.message);
  }
}

module.exports = { signer, protege, role, tracer };
