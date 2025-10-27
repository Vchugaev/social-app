import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { StorageModule } from 'src/storage/storage.module';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  controllers: [UserController],
  providers: [UserService],
  imports: [StorageModule, PrismaModule],
})
export class UserModule {}
