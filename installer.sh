#!/usr/bin/env bash
# ============================================================
# AfriKfables — installation complète sur un VPS Ubuntu neuf.
# À lancer en root :  bash installer.sh
# Le script s'arrête à la première erreur et dit ce qui n'a pas marché.
# ============================================================
set -euo pipefail

DOSSIER=/opt/afrikfables
DOMAINE=""   # laissé vide : on met le HTTPS dans un second temps

echo "═══ 1/6 · Mise à jour du système ═══"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

echo "═══ 2/6 · Installation de Docker ═══"
if ! command -v docker >/dev/null 2>&1; then
  apt-get install -y -qq ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
echo "  Docker $(docker --version | cut -d' ' -f3 | tr -d ,)"

echo "═══ 3/6 · Pare-feu ═══"
apt-get install -y -qq ufw
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp  >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
echo "  Ouverts : 22, 80, 443. Tout le reste est fermé."

echo "═══ 4/6 · Secrets ═══"
mkdir -p "$DOSSIER" && cd "$DOSSIER"
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 48)|"                .env
  sed -i "s|^WEBHOOK_SECRET=.*|WEBHOOK_SECRET=$(openssl rand -hex 32)|"        .env
  chmod 600 .env
  echo "  Trois secrets générés. Ils sont dans $DOSSIER/.env — ne le partagez jamais."
else
  echo "  .env existe déjà, on n'y touche pas."
fi

echo "═══ 5/6 · Démarrage des services ═══"
docker compose up -d --build
echo "  Attente de la base…"
for i in $(seq 1 30); do
  if curl -sf http://localhost/api/sante >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "═══ 6/6 · Vérification ═══"
if curl -sf http://localhost/api/sante | grep -q '"etat":"ok"'; then
  echo "  Le serveur répond."
else
  echo "  Le serveur ne répond pas encore. Voir :  cd $DOSSIER && docker compose logs api"
fi

IP=$(curl -s -4 ifconfig.me || echo "votre-ip")
cat <<MSG

════════════════════════════════════════════════════
  Installation terminée.

  Le portail        http://$IP/
  Le back office    http://$IP/admin.html
  Le partenaire     http://$IP/partenaire.html

  Il reste deux choses à faire :

  1) Créer votre compte administrateur
     cd $DOSSIER && make migrer

  2) Protéger le back office par mot de passe
     cd $DOSSIER && make motdepasse

  Puis, quand le domaine pointera vers cette machine :
     bash https.sh afrikfables.com

════════════════════════════════════════════════════
MSG
