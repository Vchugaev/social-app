import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PostService } from './post/post.service';
import { PostModule } from './post/post.module';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageService } from './storage/storage.service';
import { StorageModule } from './storage/storage.module';
import { UserModule } from './user/user.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [PostModule, AuthModule, PrismaModule, StorageModule, UserModule, ChatModule],
  controllers: [AppController],
  providers: [AppService, PostService, StorageService],
})
export class AppModule {}
