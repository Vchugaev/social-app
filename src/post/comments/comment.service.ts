import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/storage/storage.service';
import { NotificationService } from 'src/notification/notification.service';
import { Request } from 'express';

@Injectable()
export class CommentService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    private notificationService: NotificationService,
  ) {}

  async getComments(req: Request, postId: number) {
    const comments = await this.prisma.comment.findMany({
      where: {
        postId: postId,
      },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: {
              select: {
                bucket: true,
                key: true,
              },
            },
          },
        },
        likes: {
          select: {
            userId: true,
          },
        },
        _count: {
          select: {
            likes: true,
          },
        },
      },
      orderBy: {
        likes: {
          _count: 'desc',
        },
      },
    });

    const commentsWithUrls = await Promise.all(
      comments.map(async (comment) => {
        let avatarUrl: string | null = null;
        if (comment.author.avatar?.bucket && comment.author.avatar?.key) {
          try {
            avatarUrl = await this.storageService.getPresignedUrl(
              comment.author.avatar.bucket,
              comment.author.avatar.key,
              60 * 60, // 1 час
            );
          } catch (error) {
            // Игнорируем ошибки получения аватара
          }
        }

        const isLiked = comment.likes.some(
          (like) => like.userId === req.user.id,
        );
        const likesCount = comment._count.likes;

        return {
          id: comment.id,
          content: comment.content,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
          author: {
            id: comment.author.id,
            username: comment.author.username,
            firstName: comment.author.firstName,
            lastName: comment.author.lastName,
            avatarUrl,
          },
          likesCount,
          isLiked,
        };
      }),
    );

    return commentsWithUrls;
  }

  async createComment(req: Request, postId: number, content: string) {
    if (!content || content.trim().length === 0) {
      throw new BadRequestException('Comment content cannot be empty');
    }

    if (content.length > 2000) {
      throw new BadRequestException(
        'Comment content is too long. Maximum length is 2000 characters',
      );
    }

    // Получаем информацию о посте и его авторе
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { authorId: true },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const comment = await this.prisma.comment.create({
      data: {
        postId: postId,
        authorId: req.user.id,
        content: content.trim(),
      },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: {
              select: {
                bucket: true,
                key: true,
              },
            },
          },
        },
        _count: {
          select: {
            likes: true,
          },
        },
      },
    });

    // Отправляем уведомление автору поста (если это не он сам)
    if (post.authorId !== req.user.id) {
      await this.notificationService.notifyPostComment(
        post.authorId,
        req.user.id,
        `${comment.author.firstName} ${comment.author.lastName}`,
        postId,
      );
    }

    let avatarUrl: string | null = null;
    if (comment.author.avatar?.bucket && comment.author.avatar?.key) {
      try {
        avatarUrl = await this.storageService.getPresignedUrl(
          comment.author.avatar.bucket,
          comment.author.avatar.key,
          60 * 60,
        );
      } catch (error) {
        // Игнорируем ошибки получения аватара
      }
    }

    return {
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      author: {
        id: comment.author.id,
        username: comment.author.username,
        firstName: comment.author.firstName,
        lastName: comment.author.lastName,
        avatarUrl,
      },
      likesCount: comment._count.likes,
      isLiked: false,
    };
  }

  async editComment(req: Request, commentId: number, content: string) {
    if (!content || content.trim().length === 0) {
      throw new BadRequestException('Comment content cannot be empty');
    }

    if (content.length > 2000) {
      throw new BadRequestException(
        'Comment content is too long. Maximum length is 2000 characters',
      );
    }

    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    if (comment.authorId !== req.user.id) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    const updatedComment = await this.prisma.comment.update({
      where: { id: commentId },
      data: {
        content: content.trim(),
      },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: {
              select: {
                bucket: true,
                key: true,
              },
            },
          },
        },
        likes: {
          select: {
            userId: true,
          },
        },
        _count: {
          select: {
            likes: true,
          },
        },
      },
    });

    let avatarUrl: string | null = null;
    if (updatedComment.author.avatar?.bucket && updatedComment.author.avatar?.key) {
      try {
        avatarUrl = await this.storageService.getPresignedUrl(
          updatedComment.author.avatar.bucket,
          updatedComment.author.avatar.key,
          60 * 60, // 1 час
        );
      } catch (error) {
        // Игнорируем ошибки получения аватара
      }
    }

    const isLiked = updatedComment.likes.some(
      (like) => like.userId === req.user.id,
    );
    const likesCount = updatedComment._count.likes;

    return {
      id: updatedComment.id,
      content: updatedComment.content,
      createdAt: updatedComment.createdAt,
      updatedAt: updatedComment.updatedAt,
      author: {
        id: updatedComment.author.id,
        username: updatedComment.author.username,
        firstName: updatedComment.author.firstName,
        lastName: updatedComment.author.lastName,
        avatarUrl,
      },
      likesCount,
      isLiked,
    };
  }

  async deleteComment(req: Request, commentId: number) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        post: {
          select: {
            authorId: true,
          },
        },
      },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    // Пользователь может удалить свой комментарий или комментарий в своем посте
    if (
      comment.authorId !== req.user.id &&
      comment.post.authorId !== req.user.id
    ) {
      throw new ForbiddenException(
        'You can only delete your own comments or comments on your posts',
      );
    }

    // Удаляем связанные записи в транзакции
    await this.prisma.$transaction(async (tx) => {
      // Удаляем все лайки комментария
      await tx.commentLike.deleteMany({
        where: { commentId: commentId },
      });

      // Удаляем уведомления, связанные с этим комментарием
      await tx.notification.deleteMany({
        where: {
          sourceId: commentId.toString(),
          type: 'comment',
        },
      });

      // Удаляем сам комментарий
      await tx.comment.delete({
        where: { id: commentId },
      });
    });

    return true;
  }

  async likeComment(req: Request, commentId: number) {
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

    // Получаем обновленное количество лайков
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        _count: {
          select: {
            likes: true,
          },
        },
        likes: {
          where: {
            userId: req.user.id,
          },
        },
      },
    });

    return {
      isLiked: (comment?.likes?.length ?? 0) > 0,
      likesCount: comment?._count?.likes ?? 0,
    };
  }
}
