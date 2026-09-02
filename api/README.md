# Contes Faso — API

Le serveur du portail : contenu éditorial, abonnements, dialogue avec les passerelles opérateurs.

C'est la **seule brique qui a besoin d'une adresse IP fixe**. Le portail, les contes et les voix restent sur Netlify.

---

## Ce qu'il contient

- **API** — contenu éditorial section par section, abonnements, rappels opérateurs
- **PostgreSQL** — sur la même machine, sans latence réseau
- **Sauvegardes** — copie quotidienne chiffrée, envoyée hors de la machine

---

## Installation

Il faut une machine avec une IP fixe, Docker et Docker Compose.

```bash
git clone <votre-depot> contes-faso-api
cd contes-faso-api
cp .env.example .env
```

Ouvrir `.env` et renseigner au minimum :

```bash
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 48)
WEBHOOK_SECRET=$(openssl rand -hex 32)
ORIGINES=https://votre-site.netlify.app
```

Puis :

```bash
docker compose up -d
docker compose exec api npm run migrer -- admin@exemple.bf "un mot de passe long"
```

Pour importer le contenu existant, poser `contenu.json` à la racine **avant** la migration : les sections seront reprises telles quelles.

Vérifier : `curl http://localhost:3000/sante`

---

## Brancher le back office

Dans `admin.html`, la couche d'accès attend deux valeurs :

```js
API.base  = 'https://api.votredomaine.bf';
API.jeton = '<obtenu à la connexion>';
```

Rien d'autre à changer : les modules du back office ne savent pas d'où viennent les données.

---

## Les routes

| Méthode | Route | Accès |
|---|---|---|
| `GET` | `/contenu` | public — ce que le portail charge |
| `GET` | `/contenu/:section` | public |
| `PUT` | `/contenu/:section` | admin, éditeur |
| `GET` | `/contenu/:section/versions` | authentifié |
| `POST` | `/contenu/:section/restaurer/:version` | admin |
| `POST` | `/auth/connexion` | public, cinq essais par quart d'heure |
| `POST` | `/abonnements` | public — demande de pass |
| `POST` | `/webhooks/:operateur` | signature obligatoire |
| `GET` | `/abonnements/etat` | public |
| `POST` | `/abonnements/resilier` | public |
| `GET` | `/admin/abonnes` | admin, support, finance |
| `GET` | `/sante` | public |

---

## Brancher les opérateurs

**Un seul fichier à modifier : `src/lib/operateurs.js`.** Tout le reste de l'API ignore les particularités d'Orange et de Moov.

Tant que `ORANGE_BF_URL` et `MOOV_TG_URL` sont vides, le serveur reste en **simulation** : les demandes sont enregistrées avec le statut « en attente », rien n'est encaissé.

Quand la documentation arrivera, trois choses à ajuster :

1. `configuration()` — adresse, clé et secret par pays
2. `prelever()` — format de la requête de paiement
3. `lireRappel()` — noms des champs du rappel entrant

L'adresse à leur déclarer est celle de cette machine, et le rappel doit pointer vers `/webhooks/orange-bf` ou `/webhooks/moov-tg`.

---

## Sauvegardes

**À mettre en place le premier jour, pas plus tard.** Une machine qui tombe avec sa seule copie de la base, ce sont tous les abonnements perdus.

```bash
crontab -e
```

```
0 3 * * * cd /chemin/contes-faso-api && \
  DATABASE_URL='postgres://…' \
  PHRASE_SAUVEGARDE='…' \
  DEST_DISTANTE='distant:contesfaso' \
  bash scripts/sauvegarde.sh >> /var/log/sauvegarde.log 2>&1
```

Sans `DEST_DISTANTE`, la sauvegarde reste sur la machine — ce qui ne protège de rien.

Restauration :

```bash
pg_restore --clean --if-exists -d "$DATABASE_URL" contesfaso_2026-09-01_0300.dump
```

---

## Sécurité

- Les mots de passe sont stockés en empreinte bcrypt, jamais en clair
- Les rappels opérateurs sont signés en HMAC-SHA256 et comparés en temps constant
- La base n'est pas exposée à l'extérieur : seule l'API la joint
- L'API n'écoute qu'en local ; un reverse proxy fournit le HTTPS
- Le conteneur ne tourne pas en root
- Chaque action du back office est tracée dans `journal`

**À faire côté machine** : pare-feu ouvert sur 22, 80 et 443 uniquement, connexion SSH par clé, mises à jour automatiques de sécurité.

---

## Ce qui n'est pas fait

- **Reconduction automatique** des abonnements — demande une tâche planifiée, à écrire quand le cycle de facturation sera connu
- **Envoi des SMS** de confirmation — dépend de l'interface opérateur
- **Statistiques d'écoute** — la table existe, le portail ne l'alimente pas encore
- **Rôles fins** — quatre rôles définis, seuls admin et éditeur sont utilisés

---

## Installation sur un VPS LWS

Testé pour la configuration : **VPS M, Ubuntu 24.04 LTS, 4 vCPU, 8 Go de RAM, 150 Go SSD**. Largement dimensionné : l'API et sa base tiennent dans moins de 1 Go.

**L'adresse IP du VPS est fixe.** C'est elle qu'il faudra déclarer à Orange et à Moov pour la liste blanche.

### 1. Préparer la machine

```bash
ssh root@<ip-du-vps>

apt update && apt upgrade -y
apt install -y docker.io docker-compose-v2 nginx certbot python3-certbot-nginx ufw

ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
systemctl enable --now docker
```

### 2. Le domaine

Chez LWS, faire pointer un sous-domaine vers l'IP du VPS :

```
Type A · api.afrikfables.com · <ip-du-vps>
```

Le domaine principal `afrikfables.com` reste sur Netlify pour le portail.

### 3. Déployer

```bash
mkdir -p /opt/afrikfables && cd /opt/afrikfables
git clone <votre-depot> .
cp .env.example .env
nano .env       # renseigner les secrets
docker compose up -d
docker compose exec api npm run migrer -- admin@afrikfables.com "un mot de passe long"
```

### 4. HTTPS et proxy

```bash
nano /etc/nginx/sites-available/api.afrikfables.com
```

```nginx
server {
  server_name api.afrikfables.com;
  client_max_body_size 12M;   # le contenu éditorial est volumineux
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

```bash
ln -s /etc/nginx/sites-available/api.afrikfables.com /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d api.afrikfables.com
```

Le certificat se renouvelle tout seul.

### 5. Sauvegardes

```bash
crontab -e
```

```
0 3 * * * cd /opt/afrikfables && DATABASE_URL='postgres://contes:...@localhost:5432/contesfaso' \
  PHRASE_SAUVEGARDE='...' DEST_DISTANTE='distant:afrikfables' \
  bash scripts/sauvegarde.sh >> /var/log/sauvegarde.log 2>&1
```

**La destination distante n'est pas optionnelle.** Une sauvegarde qui reste sur la machine ne protège de rien : si le VPS tombe, la base et sa copie disparaissent ensemble.

### 6. Brancher les portails

Dans `admin.html` et `partenaire.html` :

```js
API.base = 'https://api.afrikfables.com';
```

### 7. Vérifier

```bash
curl https://api.afrikfables.com/sante
```

Doit répondre `{"etat":"ok","base":"jointe"}`.
