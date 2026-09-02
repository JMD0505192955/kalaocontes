/* ============================================================
   Contes Faso — API
   Une seule machine : ce serveur, sa base PostgreSQL, ses sauvegardes.
   C'est la seule brique qui a besoin d'une adresse IP fixe.
   ============================================================ */
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const limite = require('express-rate-limit');
const { q } = require('./lib/bd');

const app = express();
app.set('trust proxy', 1);            // derrière un reverse proxy
app.disable('x-powered-by');

app.use(helmet());
app.use(express.json({ limit: '8mb' }));   // le contenu éditorial est volumineux

/* Seuls le portail et le back office peuvent appeler l'API. */
const origines = (process.env.ORIGINES || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (o, cb) => (!o || origines.includes(o)) ? cb(null, true)
                                                  : cb(new Error('Origine refusée')),
  credentials: true
}));

app.use(limite({ windowMs: 60_000, max: 120 }));

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/contenu'));
app.use('/', require('./routes/abonnements'));
app.use('/', require('./routes/partenaire'));
app.use('/', require('./routes/pilotage'));

/* Vérification de santé : à surveiller depuis l'extérieur. */
app.get('/sante', async (_req, res) => {
  try {
    await q('SELECT 1');
    res.json({ etat: 'ok', base: 'jointe', heure: new Date().toISOString() });
  } catch {
    res.status(503).json({ etat: 'degrade', base: 'injoignable' });
  }
});

app.use((_req, res) => res.status(404).json({ erreur: 'Route inconnue' }));

app.use((e, _req, res, _suite) => {
  console.error('[erreur]', e.message);
  res.status(500).json({ erreur: 'Erreur interne' });
});

const port = process.env.PORT || 3000;
const serveur = app.listen(port, () => {
  console.log(`Contes Faso — API à l'écoute sur le port ${port}`);
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('remplacer'))
    console.warn('ATTENTION : JWT_SECRET n\'a pas été changé.');
});

/* Arrêt propre : on laisse les requêtes en cours se terminer. */
['SIGTERM','SIGINT'].forEach(s => process.on(s, () => {
  console.log('Arrêt demandé, fermeture…');
  serveur.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000);
}));

module.exports = app;
