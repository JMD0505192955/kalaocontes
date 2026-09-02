/* Connexion du back office. */
const express = require('express');
const bcrypt = require('bcryptjs');
const limite = require('express-rate-limit');
const { q } = require('../lib/bd');
const { signer, protege, tracer } = require('../lib/auth');

const r = express.Router();

/* Cinq essais par quart d'heure et par adresse : de quoi décourager la force brute. */
const brute = limite({ windowMs: 15 * 60 * 1000, max: 5,
  message: { erreur: 'Trop de tentatives. Réessaie dans un quart d\'heure.' } });

r.post('/auth/connexion', brute, async (req, res) => {
  const { courriel, motdepasse } = req.body || {};
  if (!courriel || !motdepasse)
    return res.status(400).json({ erreur: 'Courriel et mot de passe attendus' });

  const { rows } = await q('SELECT * FROM administrateurs WHERE courriel=$1 AND actif=TRUE',
    [String(courriel).toLowerCase().trim()]);

  /* Même message et même délai dans les deux cas : on ne dit pas si le compte existe. */
  const ok = rows.length && await bcrypt.compare(motdepasse, rows[0].motdepasse);
  if (!ok) {
    await new Promise(s => setTimeout(s, 400));
    return res.status(401).json({ erreur: 'Identifiants incorrects' });
  }

  await q('UPDATE administrateurs SET vu_le=now() WHERE id=$1', [rows[0].id]);
  req.admin = rows[0];
  await tracer(req, 'auth.connexion', rows[0].courriel);

  res.json({
    jeton: signer(rows[0]),
    admin: { nom: rows[0].nom, courriel: rows[0].courriel, role: rows[0].role }
  });
});

r.get('/auth/moi', protege, (req, res) => res.json(req.admin));

module.exports = r;
