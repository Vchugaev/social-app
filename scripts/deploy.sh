#!/bin/bash

# Скрипт для ручного деплоя
# Использование: ./scripts/deploy.sh [staging|production]

set -e

ENVIRONMENT=${1:-staging}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🚀 Deploying to $ENVIRONMENT..."

# Проверка окружения
if [ "$ENVIRONMENT" != "staging" ] && [ "$ENVIRONMENT" != "production" ]; then
    echo "❌ Invalid environment. Use 'staging' or 'production'"
    exit 1
fi

# Проверка изменений
if [ -n "$(git status --porcelain)" ]; then
    echo "⚠️  Warning: You have uncommitted changes"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Запуск тестов
echo "🧪 Running tests..."
cd "$PROJECT_DIR"
npm run test

# Линтинг
echo "🔍 Running linter..."
npm run lint

# Сборка
echo "🔨 Building application..."
npm run build

# Генерация Prisma Client
echo "📦 Generating Prisma Client..."
npx prisma generate

# Деплой
if [ "$ENVIRONMENT" = "staging" ]; then
    echo "📤 Deploying to staging..."
    # Добавьте команды для staging деплоя
    # Например: rsync, scp, или git pull на сервере
    
elif [ "$ENVIRONMENT" = "production" ]; then
    echo "📤 Deploying to production..."
    read -p "⚠️  Are you sure you want to deploy to PRODUCTION? (yes/no) " -r
    if [ "$REPLY" != "yes" ]; then
        echo "Deployment cancelled"
        exit 1
    fi
    # Добавьте команды для production деплоя
fi

echo "✅ Deployment completed successfully!"
