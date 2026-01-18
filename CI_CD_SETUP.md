# CI/CD Setup для Backend

## Обзор

Проект использует GitHub Actions для автоматизации тестирования, сборки и деплоя.

## Workflows

### 1. CI/CD Pipeline (`ci-cd.yml`)

Запускается при:
- Push в ветки `main` или `develop`
- Pull Request в эти ветки
- Изменениях в папке `back/`

**Этапы:**

#### Lint
- Проверка кода с помощью ESLint
- Проверка форматирования с Prettier

#### Test
- Запуск unit тестов с покрытием
- Использует PostgreSQL и Redis из Docker
- Загружает отчеты покрытия в Codecov

#### Build
- Сборка приложения
- Генерация Prisma Client
- Сохранение артефактов

#### Deploy Staging
- Автоматический деплой в staging при push в `develop`
- Использует SSH для подключения к серверу

#### Deploy Production
- Автоматический деплой в production при push в `main`
- Требует подтверждения через GitHub Environments

### 2. Docker Build (`docker.yml`)

Запускается при:
- Push в `main` или `develop`
- Создании тегов `v*`

**Действия:**
- Сборка Docker образа
- Push в GitHub Container Registry
- Кеширование слоев для ускорения

## Настройка

### GitHub Secrets

Добавьте следующие секреты в Settings → Secrets and variables → Actions:

#### Staging
```
STAGING_HOST - IP или домен staging сервера
STAGING_USER - SSH пользователь
STAGING_SSH_KEY - Приватный SSH ключ
```

#### Production
```
PRODUCTION_HOST - IP или домен production сервера
PRODUCTION_USER - SSH пользователь
PRODUCTION_SSH_KEY - Приватный SSH ключ
```

### GitHub Environments

Создайте environments в Settings → Environments:

1. **staging**
   - URL: https://staging-api.yourdomain.com
   - Без защиты (автодеплой)

2. **production**
   - URL: https://api.yourdomain.com
   - С защитой: требуется подтверждение
   - Reviewers: добавьте ответственных

### Подготовка сервера

На сервере должно быть установлено:

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2
sudo npm install -g pm2

# PostgreSQL
sudo apt-get install -y postgresql postgresql-contrib

# Redis
sudo apt-get install -y redis-server

# Клонирование репозитория
cd /var/www
git clone <your-repo-url> linkup-backend
cd linkup-backend/back

# Установка зависимостей
npm ci --production

# Настройка .env
cp .env.example .env
nano .env

# Миграции
npx prisma generate
npx prisma migrate deploy

# Запуск с PM2
pm2 start dist/main.js --name linkup-backend
pm2 save
pm2 startup
```

## Docker

### Локальная разработка

```bash
# Запуск всех сервисов
docker-compose up -d

# Просмотр логов
docker-compose logs -f backend

# Остановка
docker-compose down

# Пересборка
docker-compose up -d --build
```

### Production с Docker

```bash
# Pull образа
docker pull ghcr.io/<your-username>/linkup/backend:main

# Запуск
docker run -d \
  --name linkup-backend \
  -p 3001:3001 \
  --env-file .env \
  ghcr.io/<your-username>/linkup/backend:main
```

## Мониторинг

### Health Check

Endpoint: `GET /health`

```bash
curl http://localhost:3001/health
```

### PM2 Monitoring

```bash
# Статус
pm2 status

# Логи
pm2 logs linkup-backend

# Метрики
pm2 monit
```

## Rollback

### С PM2

```bash
cd /var/www/linkup-backend
git checkout <previous-commit>
npm ci --production
npx prisma generate
pm2 restart linkup-backend
```

### С Docker

```bash
docker pull ghcr.io/<your-username>/linkup/backend:<previous-tag>
docker stop linkup-backend
docker rm linkup-backend
docker run -d --name linkup-backend ... <previous-tag>
```

## Troubleshooting

### Ошибки миграций

```bash
# Сброс базы (только для dev!)
npx prisma migrate reset

# Применить миграции
npx prisma migrate deploy

# Проверить статус
npx prisma migrate status
```

### Проблемы с зависимостями

```bash
# Очистка и переустановка
rm -rf node_modules package-lock.json
npm install
```

### Docker проблемы

```bash
# Очистка
docker-compose down -v
docker system prune -a

# Пересборка без кеша
docker-compose build --no-cache
```

## Best Practices

1. **Всегда тестируйте локально** перед push
2. **Используйте feature branches** для новых функций
3. **Создавайте PR** вместо прямого push в main
4. **Проверяйте логи CI** перед мержем
5. **Делайте теги** для production релизов: `git tag v1.0.0`
6. **Мониторьте метрики** после деплоя
7. **Делайте бэкапы БД** перед миграциями

## Полезные команды

```bash
# Локальный запуск тестов как в CI
npm run lint
npm run test -- --coverage

# Сборка
npm run build

# Проверка Docker образа
docker build -t linkup-backend .
docker run -p 3001:3001 linkup-backend

# Проверка миграций
npx prisma migrate diff \
  --from-schema-datamodel prisma/schema.prisma \
  --to-schema-datasource prisma/schema.prisma
```
