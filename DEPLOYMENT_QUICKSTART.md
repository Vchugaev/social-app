# Быстрый старт деплоя

## 🚀 Автоматический деплой через GitHub Actions

### Шаг 1: Настройка GitHub Secrets

Перейдите в Settings → Secrets and variables → Actions и добавьте:

**Для Staging:**
- `STAGING_HOST` - IP сервера (например: `192.168.1.100`)
- `STAGING_USER` - SSH пользователь (например: `deploy`)
- `STAGING_SSH_KEY` - Приватный SSH ключ

**Для Production:**
- `PRODUCTION_HOST`
- `PRODUCTION_USER`
- `PRODUCTION_SSH_KEY`

### Шаг 2: Создание SSH ключа

```bash
# На вашем компьютере
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github_actions

# Скопируйте публичный ключ на сервер
ssh-copy-id -i ~/.ssh/github_actions.pub user@server

# Скопируйте приватный ключ в GitHub Secrets
cat ~/.ssh/github_actions
```

### Шаг 3: Настройка Environments

1. Перейдите в Settings → Environments
2. Создайте `staging` и `production`
3. Для production добавьте reviewers

### Шаг 4: Push и деплой

```bash
# Staging (автоматически)
git push origin develop

# Production (автоматически)
git push origin main
```

## 🐳 Docker деплой

### Локально

```bash
cd back
docker-compose up -d
```

### На сервере

```bash
# Pull образа
docker pull ghcr.io/your-username/linkup/backend:main

# Запуск
docker run -d \
  --name linkup-backend \
  -p 3001:3001 \
  --env-file .env \
  --restart unless-stopped \
  ghcr.io/your-username/linkup/backend:main
```

## 📦 Ручной деплой с PM2

### На сервере

```bash
# Первый раз
cd /var/www
git clone <repo-url> linkup-backend
cd linkup-backend/back
npm ci --production
cp .env.example .env
nano .env  # Настройте переменные
npx prisma generate
npx prisma migrate deploy
npm run build
pm2 start ecosystem.config.js --env production
pm2 save

# Обновление
cd /var/www/linkup-backend
git pull
cd back
npm ci --production
npx prisma generate
npx prisma migrate deploy
npm run build
pm2 restart linkup-backend
```

## ✅ Проверка

```bash
# Health check
curl http://localhost:3001/health

# PM2 статус
pm2 status

# Логи
pm2 logs linkup-backend

# Docker логи
docker logs linkup-backend
```

## 🔄 Rollback

```bash
# PM2
cd /var/www/linkup-backend
git checkout <commit-hash>
npm ci --production
pm2 restart linkup-backend

# Docker
docker stop linkup-backend
docker rm linkup-backend
docker run -d ... ghcr.io/.../backend:<old-tag>
```

## 📊 Мониторинг

```bash
# PM2 метрики
pm2 monit

# Docker статистика
docker stats linkup-backend

# Логи в реальном времени
pm2 logs --lines 100
```

## 🆘 Помощь

Полная документация: [CI_CD_SETUP.md](./CI_CD_SETUP.md)
