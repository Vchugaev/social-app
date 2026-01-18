# 🚀 CI/CD для LinkUp Backend

## 📋 Что было создано

### GitHub Actions Workflows

1. **ci-cd.yml** - Основной CI/CD pipeline
   - ✅ Линтинг (ESLint + Prettier)
   - ✅ Тестирование с покрытием
   - ✅ Сборка приложения
   - ✅ Автодеплой в staging (develop)
   - ✅ Автодеплой в production (main)

2. **docker.yml** - Docker сборка и публикация
   - ✅ Сборка образа
   - ✅ Push в GitHub Container Registry
   - ✅ Кеширование слоев

3. **release.yml** - Автоматические релизы
   - ✅ Создание релизов по тегам
   - ✅ Генерация changelog
   - ✅ Информация о Docker образе

### Docker

- **Dockerfile** - Оптимизированный multi-stage build
- **docker-compose.yml** - Полное окружение (Backend + PostgreSQL + Redis + MinIO)
- **.dockerignore** - Исключение ненужных файлов

### Конфигурация

- **ecosystem.config.js** - PM2 конфигурация для production
- **.env.example** - Пример переменных окружения
- **Makefile** - Удобные команды для разработки

### Скрипты

- **scripts/deploy.sh** - Ручной деплой
- **scripts/health-check.sh** - Проверка здоровья

### Документация

- **CI_CD_SETUP.md** - Полная документация
- **DEPLOYMENT_QUICKSTART.md** - Быстрый старт

### Код

- **Health endpoint** - `/health` для мониторинга

## 🎯 Быстрый старт

### 1. Локальная разработка

```bash
# Установка
make install

# Запуск
make dev

# Тесты
make test

# Линтинг
make lint
```

### 2. Docker локально

```bash
# Запуск всех сервисов
make docker-up

# Логи
make docker-logs

# Остановка
make docker-down
```

### 3. Настройка CI/CD

#### Шаг 1: GitHub Secrets

Добавьте в Settings → Secrets and variables → Actions:

```
STAGING_HOST=your-staging-server.com
STAGING_USER=deploy
STAGING_SSH_KEY=<ваш приватный SSH ключ>

PRODUCTION_HOST=your-production-server.com
PRODUCTION_USER=deploy
PRODUCTION_SSH_KEY=<ваш приватный SSH ключ>
```

#### Шаг 2: GitHub Environments

Создайте в Settings → Environments:
- `staging` (без защиты)
- `production` (с reviewers)

#### Шаг 3: Подготовка сервера

```bash
# На сервере
sudo apt update
sudo apt install -y nodejs npm postgresql redis-server

# PM2
sudo npm install -g pm2

# Клонирование
cd /var/www
git clone <your-repo> linkup-backend
cd linkup-backend/back

# Настройка
cp .env.example .env
nano .env

# Первый запуск
npm ci --production
npx prisma generate
npx prisma migrate deploy
npm run build
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

#### Шаг 4: Деплой

```bash
# Staging (автоматически)
git push origin develop

# Production (автоматически)
git push origin main

# Или создайте релиз
git tag v1.0.0
git push origin v1.0.0
```

## 📊 Мониторинг

### Health Check

```bash
curl http://localhost:3001/health
```

Ответ:
```json
{
  "status": "ok",
  "timestamp": "2026-01-18T...",
  "uptime": 123.45,
  "environment": "production"
}
```

### PM2

```bash
pm2 status          # Статус
pm2 logs            # Логи
pm2 monit           # Метрики
pm2 restart all     # Перезапуск
```

### Docker

```bash
docker ps                        # Контейнеры
docker logs linkup-backend       # Логи
docker stats linkup-backend      # Метрики
```

## 🔄 Workflow

### Feature разработка

```bash
# Создать ветку
git checkout -b feature/new-feature

# Разработка
# ... код ...

# Тесты
make test
make lint

# Коммит
git add .
git commit -m "feat: add new feature"

# Push
git push origin feature/new-feature

# Создать PR в develop
```

### Staging деплой

```bash
# Мерж в develop
git checkout develop
git merge feature/new-feature
git push origin develop

# CI/CD автоматически задеплоит в staging
```

### Production деплой

```bash
# Мерж в main
git checkout main
git merge develop
git push origin main

# CI/CD автоматически задеплоит в production
# (после подтверждения reviewers)
```

### Создание релиза

```bash
# Создать тег
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0

# GitHub Actions создаст релиз автоматически
```

## 🛠️ Полезные команды

```bash
# Разработка
make dev              # Запуск dev сервера
make test             # Тесты
make test-cov         # Тесты с покрытием
make lint             # Линтинг
make format           # Форматирование

# Docker
make docker-build     # Сборка образа
make docker-up        # Запуск compose
make docker-down      # Остановка compose
make docker-logs      # Логи

# Prisma
make prisma-generate  # Генерация клиента
make prisma-migrate   # Миграции
make prisma-studio    # Prisma Studio

# PM2
make pm2-start        # Запуск
make pm2-restart      # Перезапуск
make pm2-logs         # Логи
make pm2-monit        # Мониторинг

# Деплой
make deploy-staging   # Деплой в staging
make deploy-prod      # Деплой в production
make health-check     # Проверка здоровья
```

## 🔧 Troubleshooting

### CI/CD не запускается

1. Проверьте, что workflows в `.github/workflows/`
2. Проверьте права Actions в Settings → Actions → General
3. Проверьте логи в Actions tab

### Деплой падает

1. Проверьте SSH ключи в Secrets
2. Проверьте доступ к серверу: `ssh user@server`
3. Проверьте логи в Actions

### Docker не собирается

1. Проверьте Dockerfile синтаксис
2. Очистите кеш: `docker system prune -a`
3. Пересоберите: `make docker-build`

### Миграции не применяются

1. Проверьте DATABASE_URL
2. Проверьте доступ к БД
3. Сбросьте (только dev!): `npx prisma migrate reset`

## 📚 Документация

- [CI_CD_SETUP.md](./CI_CD_SETUP.md) - Полная документация
- [DEPLOYMENT_QUICKSTART.md](./DEPLOYMENT_QUICKSTART.md) - Быстрый старт

## 🎉 Готово!

Теперь у вас есть полноценный CI/CD pipeline:

✅ Автоматическое тестирование  
✅ Автоматический линтинг  
✅ Автоматическая сборка  
✅ Автоматический деплой  
✅ Docker поддержка  
✅ Мониторинг и health checks  
✅ PM2 для production  
✅ Автоматические релизы  

Просто пушьте код и наслаждайтесь! 🚀
