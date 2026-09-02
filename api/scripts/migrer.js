/* Applique le schéma et crée le premier administrateur. */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { q, pool } = require('../src/lib/bd');

(async () => {
  try {
    const dossier = path.join(__dirname, '..', 'sql');
    for (const f of fs.readdirSync(dossier).filter(x => x.endsWith('.sql')).sort()) {
      console.log('→', f);
      await q(fs.readFileSync(path.join(dossier, f), 'utf8'));
    }

    const { rows } = await q('SELECT count(*)::int n FROM administrateurs');
    if (rows[0].n === 0) {
      const courriel = process.argv[2];
      const motdepasse = process.argv[3];
      if (!courriel || !motdepasse) {
        console.log('\nAucun administrateur. Pour en créer un :');
        console.log('  npm run migrer -- admin@exemple.bf "un mot de passe long"');
      } else {
        await q(
          'INSERT INTO administrateurs (courriel, motdepasse, nom, role) VALUES ($1,$2,$3,$4)',
          [courriel.toLowerCase(), await bcrypt.hash(motdepasse, 12), 'Administrateur', 'admin']);
        console.log('Administrateur créé :', courriel);
      }
    }

    /* Amorce le contenu depuis contenu.json s'il est présent à la racine. */
    const cj = path.join(__dirname, '..', 'contenu.json');
    if (fs.existsSync(cj)) {
      const d = JSON.parse(fs.readFileSync(cj, 'utf8'));
      let n = 0;
      for (const [section, valeur] of Object.entries(d)) {
        if (typeof valeur !== 'object' || valeur === null) continue;
        await q(`INSERT INTO contenu (section, valeur) VALUES ($1,$2)
                 ON CONFLICT (section) DO NOTHING`, [section, JSON.stringify(valeur)]);
        n++;
      }
      console.log(n, 'sections importées depuis contenu.json');
    }

    console.log('Migration terminée.');
  } catch (e) {
    console.error('Échec :', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
