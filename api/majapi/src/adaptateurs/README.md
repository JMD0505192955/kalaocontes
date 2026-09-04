# Adaptateurs opérateurs

Un fichier par opérateur. Chacun traduit ses particularités vers un vocabulaire commun,
pour que le reste du serveur n'ait jamais à les connaître.

## Trois familles de parcours

**`direct`** — nous appelons leur interface, ils prélèvent, ils confirment par un rappel.
C'est le cas le plus courant. L'abonné ne quitte pas le portail.

**`code`** — l'abonné envoie un mot-clé au numéro court depuis son téléphone.
L'opérateur prélève, génère un code d'accès et le lui envoie par SMS.
L'abonné revient saisir ce code chez nous. C'est le parcours de Moov Togo.

**`redirection`** — nous envoyons l'abonné sur une page de l'opérateur, il paie,
il revient avec un jeton de retour.

## Ce qu'un adaptateur doit fournir

```js
module.exports = {
  type: 'direct' | 'code' | 'redirection',

  /* Ce que le portail doit afficher à l'abonné après le choix du pass. */
  instructions(marche, pass) -> { titre, texte, motCle?, courtCode? },

  /* Démarre le paiement. Selon le type :
     - direct      : appelle leur interface, renvoie une référence
     - code        : ne fait rien côté serveur, l'abonné agit lui-même
     - redirection : renvoie l'adresse où envoyer l'abonné */
  demarrer(marche, telephone, montant, pass) -> { reference, statut, url? },

  /* Traduit un rappel entrant vers notre vocabulaire.
     Chaque opérateur nomme ses champs à sa façon. */
  lireRappel(corps) -> { reference, statut, pass, message, code? },

  /* Pour le type 'code' : vérifie le code saisi par l'abonné. */
  verifierCode(marche, telephone, code) -> { valide, pass, fin } | null
};
```

## Ajouter un opérateur

Créer `<pays>-<operateur>.js` dans ce dossier, l'exporter dans `index.js`,
et renseigner `type` dans la ligne du marché depuis le back office.

Rien d'autre ne change : ni la base, ni les routes, ni le back office.
