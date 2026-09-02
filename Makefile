# Raccourcis. « make aide » liste tout.

aide:
	@echo "  make demarrer   — construit et lance les trois services"
	@echo "  make migrer     — applique le schéma et crée l'administrateur"
	@echo "  make motdepasse — protège le back office par mot de passe"
	@echo "  make etat       — état des services"
	@echo "  make journaux   — suit les journaux en direct"
	@echo "  make sauver     — sauvegarde la base maintenant"
	@echo "  make publier    — recharge le portail sans couper le service"
	@echo "  make arreter    — arrête tout"

demarrer:
	docker compose up -d --build
	@echo "Prêt. Vérifier : curl http://localhost/api/sante"

migrer:
	@read -p "Courriel administrateur : " c; \
	 read -p "Mot de passe : " m; \
	 docker compose exec api npm run migrer -- "$$c" "$$m"

motdepasse:
	@read -p "Identifiant : " u; \
	 docker run --rm -it httpd:alpine htpasswd -Bn "$$u" > web/.htpasswd
	docker compose cp web/.htpasswd web:/etc/nginx/.htpasswd
	docker compose restart web

etat:
	docker compose ps

journaux:
	docker compose logs -f --tail=80

sauver:
	docker compose exec base pg_dump -U $${POSTGRES_USER:-afrik} -Fc $${POSTGRES_DB:-afrikfables} \
	  > sauvegardes/afrikfables_$$(date +%Y-%m-%d_%H%M).dump
	@echo "Sauvegarde écrite dans sauvegardes/"

publier:
	docker compose restart web
	@echo "Portail rechargé."

arreter:
	docker compose down

.PHONY: aide demarrer migrer motdepasse etat journaux sauver publier arreter
