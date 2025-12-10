import { Module } from '@nestjs/common';
import { PostService } from './post.service';
import { PostController } from './post.controller';
import { CommentService } from './comments/comment.service';
import { CommentController } from './comments/comment.controller';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StorageModule } from 'src/storage/storage.module';

@Module({
  imports: [PrismaModule, StorageModule],
  providers: [PostService, CommentService, AuthGuard],
  controllers: [PostController, CommentController],
})
export class PostModule {}
