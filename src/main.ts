import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import session from 'express-session';
import Redis from 'ioredis';
import RedisStore from 'connect-redis';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.use(cookieParser());

  // Инициализация Redis клиента
  const redisClient = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB) || 0,
  });

  // Проверка подключения
  redisClient.on('connect', () => console.log('✅ Redis connected'));
  redisClient.on('error', (err) => console.error('❌ Redis error:', err));

  // Инициализация Redis Store
  const redisStore = new RedisStore({
    client: redisClient,
    prefix: 'sess:',
  });
  app.enableCors({
    origin: 'http://localhost:3000',
    credentials: true,
  });

  app.use(
    session({
      store: redisStore,
      secret: process.env.SESSION_SECRET || 'pass',
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 365, // 1 год в миллисекундах
        httpOnly: true,
        secure: false,
      },
    }),
  );

  await app.listen(process.env.PORT ?? 3001);
  console.log(`🚀 Server running on port ${process.env.PORT ?? 3001}`);
}

bootstrap();
