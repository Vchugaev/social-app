import { Module, forwardRef } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { StorageModule } from 'src/storage/storage.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationModule } from 'src/notification/notification.module';
import { ChatModule } from 'src/chat/chat.module';

@Module({
  controllers: [UserController],
  providers: [UserService],
  imports: [
    StorageModule,
    PrismaModule,
    NotificationModule,
    forwardRef(() => ChatModule),
  ],
  exports: [UserService],
})
export class UserModule {}
