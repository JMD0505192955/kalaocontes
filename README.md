# AfriKfables — assemblage Docker

Trois conteneurs, une seule commande, une seule entrée publique.

```
        ┌─────────── port 80/443 ───────────┐
        │              web                  │   nginx : sert le portail,
        │   portail  ·  /api → api          │   relaie /api, protège l'admin
        └───────────────┬───────────────────┘
                        │ réseau interne
                ┌───────┴────────┐
                │      api       │           Node : contenu, abonnements
                └───────┬────────┘
                        │
                ┌───────┴────────┐
                │      base      │           PostgreSQL, jamais exposée
                └────────────────┘
```

**Le portail et l'API sont sur la même adresse.** Plus de question d'origine croisée, un seul certificat, une seule chose à surveiller.

---

## Installation

Sur le VPS, avec Docker installé :

```bash
git clone <votre-depot> afrikfables && cd afrikfables
cp .env.example .env
nano .env          # remplir les trois secrets
make demarrer
make migrer        # crée le compte administrateur
make motdepasse    # protège le back office
```

Vérifier : `curl http://localhost/api/sante` doit répondre `{"etat":"ok","base":"jointe"}`.

Les trois secrets à générer :

```bash
openssl rand -hex 24   # POSTGRES_PASSWORD
openssl rand -hex 48   # JWT_SECRET
openssl rand -hex 32   # WEBHOOK_SECRET
```

---

## Où se trouve quoi

| Quoi | Adresse | Accès |
|---|---|---|
| **Le portail** | `https://afrikfables.com/` | public |
| **Le back office** | `https://afrikfables.com/admin.html` | mot de passe |
| **Le portail partenaire** | `https://afrikfables.com/partenaire.html` | mot de passe + compte opérateur |
| L'API | `https://afrikfables.com/api/…` | jeton |
| État du serveur | `https://afrikfables.com/api/sante` | public |

**Le back office et le portail partenaire sont protégés par mot de passe au niveau du serveur**, avant même d'atteindre la page. C'est `make motdepasse` qui l'installe. Sans cela, n'importe qui connaissant l'adresse pourrait ouvrir le back office.

**Deux niveaux pour le portail partenaire** : le mot de passe du serveur, puis un compte partenaire rattaché à un pays. Le premier empêche d'arriver sur la page, le second borne ce qu'on y voit.

---

## Le back office trouve l'API tout seul

Rien à configurer. Au démarrage, il interroge `/api/sante` :

- l'API répond → il s'y connecte, les modules Abonnés, Finances et Support se remplissent
- elle ne répond pas → il travaille sur `contenu.json` et le brouillon local, comme avant

Le même fichier fonctionne donc sur Netlify sans serveur et sur le VPS avec.

---

## Publier une nouvelle version du portail

Le dossier `portail/` est monté dans le conteneur, pas copié dans l'image :

```bash
# remplacer les fichiers dans portail/
make publier
```

Pas de reconstruction, pas de coupure.

---

## Les commandes

| Commande | Effet |
|---|---|
| `make demarrer` | construit et lance les trois services |
| `make migrer` | applique le schéma, crée l'administrateur |
| `make motdepasse` | protège le back office et le portail partenaire |
| `make etat` | état des conteneurs |
| `make journaux` | suit les journaux en direct |
| `make sauver` | sauvegarde la base immédiatement |
| `make publier` | recharge le portail |
| `make arreter` | arrête tout |

---

## HTTPS

Le conteneur `web` écoute en clair sur le port 80. Deux façons de le chiffrer.

**Le plus simple** : nginx et certbot sur la machine, devant Docker.

```bash
apt install -y nginx certbot python3-certbot-nginx
```

Un site qui relaie tout vers `http://127.0.0.1:80`, puis :

```bash
certbot --nginx -d afrikfables.com
```

Dans ce cas, mettre `PORT_PUBLIC=8080` dans `.env` pour libérer le port 80.

---

## Sauvegardes

`make sauver` écrit dans `sauvegardes/`. **Ce dossier est sur la même machine que la base** : cela ne protège de rien si le VPS tombe.

Pour une vraie sauvegarde, une tâche quotidienne qui envoie la copie ailleurs :

```
0 3 * * * cd /opt/afrikfables && make sauver && \
  rclone copy sauvegardes/ distant:afrikfables/ --max-age 25h
```

Restauration :

```bash
docker compose exec -T base pg_restore -U afrik -d afrikfables --clean --if-exists \
  < sauvegardes/afrikfables_2026-09-06_0300.dump
```

---

## Où mettre les fichiers lourds

Les voix et les images font 19 Mo. Deux possibilités.

**Tout sur le VPS** — c'est ce que fait cet assemblage. Simple, une seule adresse. Suffisant pour démarrer, mais chaque écoute passe par votre machine.

**Le portail sur Netlify, l'API sur le VPS** — les fichiers sont servis par un réseau mondial, plus proche des utilisateurs à Ouagadougou ou Lomé. Dans ce cas, renseigner `API.base` dans `admin.html` avec l'adresse du VPS, et déclarer le domaine Netlify dans `ORIGINES`.

Les deux fonctionnent. Le second est plus rapide pour l'utilisateur, le premier plus simple à administrer.

---

## Ce qui n'est pas dans l'image

`.env`, les sauvegardes, le fichier de mots de passe et les fichiers de voix sont exclus du dépôt. Un secret déposé une fois reste dans l'historique, même effacé ensuite.
