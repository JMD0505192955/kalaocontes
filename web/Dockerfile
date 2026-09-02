FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Le portail lui-même est monté au démarrage, pas copié :
# publier une nouvelle version ne demande pas de reconstruire l'image.
HEALTHCHECK --interval=30s --timeout=4s CMD wget -qO- http://localhost/ >/dev/null || exit 1
