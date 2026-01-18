.PHONY: help install dev build test lint format clean docker-build docker-up docker-down deploy-staging deploy-prod

help: ## Показать эту справку
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Установить зависимости
	npm ci
	npx prisma generate

dev: ## Запустить в режиме разработки
	npm run start:dev

build: ## Собрать проект
	npm run build

test: ## Запустить тесты
	npm run test

test-cov: ## Запустить тесты с покрытием
	npm run test:cov

lint: ## Проверить код линтером
	npm run lint

format: ## Форматировать код
	npm run format

clean: ## Очистить сборку
	rm -rf dist node_modules coverage

prisma-generate: ## Сгенерировать Prisma Client
	npx prisma generate

prisma-migrate: ## Применить миграции
	npx prisma migrate deploy

prisma-studio: ## Открыть Prisma Studio
	npx prisma studio

docker-build: ## Собрать Docker образ
	docker build -t linkup-backend .

docker-up: ## Запустить Docker Compose
	docker-compose up -d

docker-down: ## Остановить Docker Compose
	docker-compose down

docker-logs: ## Показать логи Docker
	docker-compose logs -f backend

deploy-staging: ## Деплой в staging
	./scripts/deploy.sh staging

deploy-prod: ## Деплой в production
	./scripts/deploy.sh production

health-check: ## Проверить здоровье приложения
	./scripts/health-check.sh

pm2-start: ## Запустить с PM2
	pm2 start ecosystem.config.js --env production

pm2-restart: ## Перезапустить PM2
	pm2 restart linkup-backend

pm2-stop: ## Остановить PM2
	pm2 stop linkup-backend

pm2-logs: ## Показать логи PM2
	pm2 logs linkup-backend

pm2-monit: ## Мониторинг PM2
	pm2 monit
