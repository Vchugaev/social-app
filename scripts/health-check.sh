#!/bin/bash

# Скрипт для проверки здоровья приложения
# Использование: ./scripts/health-check.sh [url]

URL=${1:-http://localhost:3001}
MAX_RETRIES=30
RETRY_INTERVAL=2

echo "🏥 Checking health of $URL..."

for i in $(seq 1 $MAX_RETRIES); do
    if curl -f -s "$URL/health" > /dev/null; then
        echo "✅ Application is healthy!"
        exit 0
    fi
    
    echo "⏳ Attempt $i/$MAX_RETRIES failed, retrying in ${RETRY_INTERVAL}s..."
    sleep $RETRY_INTERVAL
done

echo "❌ Application is not responding after $MAX_RETRIES attempts"
exit 1
