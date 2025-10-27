import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  providers: [StorageService],
  exports: [StorageService],
  imports: [PrismaModule],
})
export class StorageModule {}
