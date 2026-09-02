/* Accès à la base. Un seul pool, partagé par toute l'application. */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (e) => console.error('[bd] connexion perdue :', e.message));

async function q(texte, valeurs = []) {
  const t0 = Date.now();
  const r = await pool.query(texte, valeurs);
  const ms = Date.now() - t0;
  if (ms > 500) console.warn(`[bd] requête lente (${ms} ms) : ${texte.slice(0, 70)}`);
  return r;
}

/* Exécute plusieurs requêtes en une transaction : tout passe ou rien ne passe. */
async function transaction(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

module.exports = { q, transaction, pool };
