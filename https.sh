#!/usr/bin/env bash
# Met le site en HTTPS.  Usage :  bash https.sh afrikfables.com
# À lancer seulement quand le domaine pointe déjà vers cette machine.
set -euo pipefail
D="${1:?Indiquez le domaine : bash https.sh afrikfables.com}"

echo "Vérification que $D pointe bien ici…"
IP_MACHINE=$(curl -s -4 ifconfig.me)
IP_DOMAINE=$(getent hosts "$D" | awk '{print $1}' | head -1 || true)
if [ "$IP_DOMAINE" != "$IP_MACHINE" ]; then
  echo "  $D pointe vers ${IP_DOMAINE:-rien} au lieu de $IP_MACHINE."
  echo "  Corrigez l'enregistrement A chez LWS, attendez quelques minutes, et relancez."
  exit 1
fi

apt-get install -y -qq nginx certbot python3-certbot-nginx

# Le conteneur libère le port 80 pour le nginx de la machine.
cd /opt/afrikfables
sed -i 's|^PORT_PUBLIC=.*|PORT_PUBLIC=8080|' .env
docker compose up -d

cat > /etc/nginx/sites-available/afrikfables <<CONF
server {
  listen 80;
  server_name $D www.$D;
  client_max_body_size 12M;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
CONF
ln -sf /etc/nginx/sites-available/afrikfables /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

certbot --nginx -d "$D" -d "www.$D" --agree-tos --redirect -m "contact@alphabet-digital.com" --non-interactive

echo
echo "  https://$D est en ligne. Le certificat se renouvelle tout seul."
