#!/usr/bin/env bash
# Sauvegarde quotidienne de la base, chiffrée et envoyée hors de la machine.
# C'est le seul point sur lequel il ne faut pas transiger : une machine qui
# tombe avec sa seule copie de la base, ce sont tous les abonnements perdus.
set -euo pipefail

DEST="${DOSSIER_SAUVEGARDE:-/var/sauvegardes/contesfaso}"
GARDE_JOURS="${GARDE_JOURS:-30}"
HORO=$(date +%Y-%m-%d_%H%M)
mkdir -p "$DEST"

echo "[$(date)] sauvegarde en cours…"
pg_dump "$DATABASE_URL" --format=custom --compress=9 \
  --file="$DEST/contesfaso_$HORO.dump"

# Chiffrement si une phrase de passe est fournie
if [ -n "${PHRASE_SAUVEGARDE:-}" ]; then
  gpg --batch --yes --passphrase "$PHRASE_SAUVEGARDE" \
      --symmetric --cipher-algo AES256 "$DEST/contesfaso_$HORO.dump"
  rm -f "$DEST/contesfaso_$HORO.dump"
  FICHIER="$DEST/contesfaso_$HORO.dump.gpg"
else
  FICHIER="$DEST/contesfaso_$HORO.dump"
  echo "  (non chiffrée : définir PHRASE_SAUVEGARDE)"
fi

# Envoi hors de la machine — indispensable
if [ -n "${DEST_DISTANTE:-}" ]; then
  rclone copy "$FICHIER" "$DEST_DISTANTE" && echo "  copie distante faite"
else
  echo "  ATTENTION : aucune destination distante. La sauvegarde reste sur la machine."
fi

find "$DEST" -name 'contesfaso_*' -mtime +"$GARDE_JOURS" -delete
echo "[$(date)] terminé : $(basename "$FICHIER")"
