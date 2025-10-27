import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/storage/storage.service';
import { Request } from 'express';

@Injectable()
export class CommentService {
  constructor(private prisma: PrismaService) {}

  async createComment(req: Request, postId: number, content: string) {
    const comment = await this.prisma.comment.create({
      data: {
        postId: postId,
        authorId: req.user.id,
        content: content,
      },
    });
    return comment;
  }

  async editComment(req: Request, commentId: number, content: string) {
    const updateComment = await this.prisma.comment.update({
      where: { id: commentId },
      data: {
        content: content,
      },
    });

    return updateComment;
  }

  async deleteComment(req: Request, commentId: number) {
    await this.prisma.comment.delete({
      where: { id: commentId },
    });

    return true;
  }

  async likeComment(req: Request, commentId: number, postId: number) {
    const commentLike = await this.prisma.commentLike.findFirst({
      where: {
        userId: req.user.id,
        commentId: commentId,
      },
    });
    if (commentLike) {
      await this.prisma.commentLike.delete({
        where: { id: commentLike.id },
      });
    } else {
      await this.prisma.commentLike.create({
        data: {
          userId: req.user.id,
          commentId: commentId,
        },
      });
    }

    return true;
  }
}
