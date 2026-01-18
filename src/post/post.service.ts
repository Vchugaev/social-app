import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/storage/storage.service';
import { NotificationService } from 'src/notification/notification.service';
import { CreateDto } from './dto/createDto';
import { Request } from 'express';
import { UpdatePostDto } from './dto/updateDto';

@Injectable()
export class PostService {
  private readonly logger = new Logger(PostService.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    private notificationService: NotificationService,
  ) {}

  async createPost(
    user: User,
    dto: CreateDto,
    files?: Express.Multer.File[],
  ) {
    const bucket = 'posts';
    const isPublished = dto.isPublished ?? false;

    this.logger.log(
      `Creating post for user id=${user.id}, files count=${files?.length || 0}`,
    );

    // Сохраняем файлы, если они есть
    let savedFiles: any[] = [];
    if (files && files.length > 0) {
      try {
        this.logger.debug(`Uploading ${files.length} file(s) to bucket ${bucket}`);

        savedFiles = await Promise.all(
          files.map(async (file, index) => {
            try {
              if (!file || !file.buffer || !file.originalname) {
                throw new BadRequestException(
                  `Invalid file data at index ${index}: missing buffer or originalname`,
                );
              }

              // Проверяем размер файла (например, максимум 10MB)
              const maxSize = 10 * 1024 * 1024; // 10MB
              if (file.size && file.size > maxSize) {
                throw new BadRequestException(
                  `File "${file.originalname}" is too large. Maximum size is 10MB`,
                );
              }

              const key = `users/${user.id}/${file.originalname}`;
              this.logger.debug(
                `Uploading file: ${file.originalname} (${file.size} bytes)`,
              );

              const uploadedFile = await this.storageService.upload(
                user.id,
                bucket,
                file,
                key,
              );

              this.logger.debug(
                `File uploaded successfully: ${file.originalname}, fileId=${uploadedFile.id}`,
              );

              return uploadedFile;
            } catch (error: any) {
              const errorMessage =
                error.message ||
                error.response?.message ||
                error.toString() ||
                'Unknown error';
              const errorStack = error.stack || 'No stack trace';

              this.logger.error(
                `Failed to upload file "${file?.originalname || 'unknown'}": ${errorMessage}`,
              );
              this.logger.debug(`Error stack: ${errorStack}`);

              // Если это уже HTTP исключение, пробрасываем его дальше
              if (
                error instanceof BadRequestException ||
                error instanceof InternalServerErrorException
              ) {
                throw error;
              }

              // Иначе оборачиваем в BadRequestException
              throw new BadRequestException(
                `Failed to upload file "${file?.originalname || 'unknown'}": ${errorMessage}`,
              );
            }
          }),
        );

        this.logger.log(
          `Successfully uploaded ${savedFiles.length} file(s) for user id=${user.id}`,
        );
      } catch (error: any) {
        const errorMessage =
          error.message ||
          error.response?.message ||
          error.toString() ||
          'Unknown error';
        const errorStack = error.stack || 'No stack trace';

        this.logger.error(
          `Error uploading files for user id=${user.id}: ${errorMessage}`,
        );
        this.logger.debug(`Error stack: ${errorStack}`);

        // Если уже загружены некоторые файлы, пытаемся их удалить
        if (savedFiles.length > 0) {
          this.logger.warn(
            `Cleaning up ${savedFiles.length} uploaded file(s) due to error`,
          );
          try {
            await Promise.all(
              savedFiles.map(async (file) => {
                if (file?.bucket && file?.key) {
                  await this.storageService.deleteFile(file.bucket, file.key);
                }
              }),
            );
          } catch (cleanupError: any) {
            this.logger.error(
              `Failed to cleanup uploaded files: ${cleanupError.message || cleanupError}`,
            );
          }
        }

        // Пробрасываем ошибку дальше
        if (
          error instanceof BadRequestException ||
          error instanceof InternalServerErrorException
        ) {
          throw error;
        }

        throw new BadRequestException(
          `Failed to upload files: ${errorMessage}`,
        );
      }
    }

    // Создаем пост с медиафайлами или без них
    try {
      this.logger.debug(
        `Creating post in database for user id=${user.id}, with ${savedFiles.length} media file(s)`,
      );

      const post = await this.prisma.post.create({
        data: {
          authorId: user.id,
          content: dto.content,
          isPublished: isPublished,
          ...(savedFiles.length > 0 && {
            postMedia: {
              create: savedFiles.map((file, index) => ({
                fileId: file.id,
                order: index,
              })),
            },
          }),
        },
        include: {
          postMedia: {
            include: { file: true },
          },
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
        },
      });

      this.logger.log(
        `Post created successfully: id=${post.id}, user id=${user.id}`,
      );

      // Получаем avatarUrl для автора поста
      let avatarUrl: string | null = null;
      if (post.author.avatar?.bucket && post.author.avatar?.key) {
        try {
          avatarUrl = await this.storageService.getPresignedUrl(
            post.author.avatar.bucket,
            post.author.avatar.key,
            60 * 60, // 1 час
          );
        } catch (error) {
          this.logger.error(`Failed to get avatar URL for user ${post.author.id}:`, error);
        }
      }

      // Форматируем результат с URL изображений
      const images = await Promise.all(
        post.postMedia.map(async (media) => {
          if (media.file?.bucket && media.file?.key) {
            return await this.storageService.getPresignedUrl(
              media.file.bucket,
              media.file.key,
              60 * 60, // 1 час
            );
          }
          return null;
        }),
      );

      return {
        id: post.id,
        content: post.content,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        author: {
          id: post.author.id,
          username: post.author.username,
          firstName: post.author.firstName,
          lastName: post.author.lastName,
          avatarUrl,
        },
        images: images.filter(Boolean),
        likesCount: 0,
        commentsCount: 0,
        isLiked: false,
      };
    } catch (error) {
      this.logger.error(
        `Failed to create post in database for user id=${user.id}: ${error.message}`,
      );

      // Если пост не создался, но файлы были загружены, удаляем их
      if (savedFiles.length > 0) {
        this.logger.warn(
          `Cleaning up ${savedFiles.length} uploaded file(s) due to post creation failure`,
        );
        try {
          await Promise.all(
            savedFiles.map(async (file) => {
              if (file?.bucket && file?.key) {
                await this.storageService.deleteFile(file.bucket, file.key);
              }
            }),
          );
        } catch (cleanupError) {
          this.logger.error(
            `Failed to cleanup uploaded files after post creation failure: ${cleanupError.message}`,
          );
        }
      }

      // Проверяем тип ошибки Prisma
      if (error.code === 'P2002') {
        throw new BadRequestException('Post with this data already exists');
      }

      throw new InternalServerErrorException(
        `Failed to create post: ${error.message}`,
      );
    }
  }

  async deletePost(req: Request, id: number) {
    await this.prisma.post.delete({
      where: {
        authorId: req.user.id,
        id: id,
      },
    });
  }

  async getPostById(req: Request, id: number) {
    const userId = req.user?.id; // Может быть undefined для гостей

    const post = await this.prisma.post.findFirst({
      where: {
        id,
        isPublished: true,
      },
      include: {
        postMedia: {
          include: { file: true },
          orderBy: { order: 'asc' },
        },
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
        favorites: userId ? {
          where: {
            userId: userId,
          },
          select: {
            id: true,
          },
        } : false,
        _count: {
          select: {
            likes: true,
            comments: true,
            views: true,
          },
        },
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // Регистрируем просмотр поста только для авторизованных пользователей
    if (userId) {
      await this.registerPostView(req, id);
    }


    // Форматируем результат с URL изображений
    const images = await Promise.all(
      post.postMedia.map(async (media) => {
        if (media.file?.bucket && media.file?.key) {
          return await this.storageService.getPresignedUrl(
            media.file.bucket,
            media.file.key,
            60 * 60, // 1 час
          );
        }
        return null;
      }),
    );

    // Получаем avatarUrl для автора поста
    let avatarUrl: string | null = null;
    if (post.author.avatar?.bucket && post.author.avatar?.key) {
      try {
        avatarUrl = await this.storageService.getPresignedUrl(
          post.author.avatar.bucket,
          post.author.avatar.key,
          60 * 60, // 1 час
        );
      } catch (error) {
        this.logger.error(`Failed to get avatar URL for user ${post.author.id}:`, error);
      }
    }

    // Проверяем, лайкнул ли текущий пользователь пост (только для авторизованных)
    const isLiked = userId ? post.likes.some((like) => like.userId === userId) : false;
    const isFavorite = userId && Array.isArray(post.favorites) ? post.favorites.length > 0 : false;
    const likesCount = post._count.likes;
    const commentsCount = post._count.comments;
    const viewsCount = post._count.views;

    return {
      id: String(post.id),
      content: post.content,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      author: {
        id: String(post.author.id),
        username: post.author.username,
        firstName: post.author.firstName,
        lastName: post.author.lastName,
        avatarUrl,
        email: '', // Не передаем email для безопасности
      },
      images: images.filter(Boolean),
      likesCount,
      commentsCount,
      viewsCount,
      isLiked,
      isFavorite,
    };
  }

  async updatePost(
    req: Request,
    postId: number,
    dto: UpdatePostDto,
    files?: Express.Multer.File[],
  ) {
    // Проверяем, что пост существует и принадлежит пользователю
    const existingPost = await this.prisma.post.findFirst({
      where: {
        id: postId,
        authorId: req.user.id,
      },
      include: {
        postMedia: {
          include: { file: true },
        },
      },
    });

    if (!existingPost) {
      throw new NotFoundException(
        'Post not found or you do not have permission to update it',
      );
    }

    const bucket = 'posts';

    // Обрабатываем удаление медиафайлов
    if (dto.deleteMediaIds && dto.deleteMediaIds.length > 0) {
      // Получаем информацию о файлах для удаления
      const mediaToDelete = await this.prisma.postMedia.findMany({
        where: {
          id: { in: dto.deleteMediaIds },
          postId: postId,
        },
        include: { file: true },
      });

      // Удаляем файлы из хранилища
      for (const media of mediaToDelete) {
        if (media.file?.bucket && media.file?.key) {
          await this.storageService.deleteFile(
            media.file.bucket,
            media.file.key,
          );
        }
      }

      // Удаляем записи из базы данных
      await this.prisma.postMedia.deleteMany({
        where: {
          id: { in: dto.deleteMediaIds },
          postId: postId,
        },
      });

      // Удаляем файлы из таблицы files
      const fileIds = mediaToDelete.map((media) => media.fileId);
      await this.prisma.file.deleteMany({
        where: {
          id: { in: fileIds },
        },
      });
    }

    let newMediaData: any[] = [];
    if (files && files.length > 0) {
      // Сохраняем новые файлы
      const savedFiles = await Promise.all(
        files.map((file) => {
          if (!file || !file.buffer || !file.originalname) {
            throw new Error('Invalid file data');
          }
          const key = `users/${req.user.id}/${file.originalname}`;
          return this.storageService.upload(req.user.id, bucket, file, key);
        }),
      );

      // Получаем текущий максимальный порядок медиафайлов
      const maxOrder = await this.prisma.postMedia.findFirst({
        where: { postId: postId },
        orderBy: { order: 'desc' },
        select: { order: true },
      });

      const startOrder = maxOrder ? maxOrder.order + 1 : 0;

      // Подготавливаем данные для новых медиафайлов
      newMediaData = savedFiles.map((file, index) => ({
        fileId: file.id,
        order: startOrder + index,
      }));
    }

    // Обновляем пост
    const updatedPost = await this.prisma.post.update({
      where: { id: postId },
      data: {
        ...(dto.content !== undefined && { content: dto.content }),
        ...(newMediaData.length > 0 && {
          postMedia: {
            create: newMediaData,
          },
        }),
      },
      include: {
        postMedia: {
          include: { file: true },
          orderBy: { order: 'asc' },
        },
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
            comments: true,
          },
        },
      },
    });

    // Форматируем результат с URL изображений
    const images = await Promise.all(
      updatedPost.postMedia.map(async (media) => {
        if (media.file?.bucket && media.file?.key) {
          return await this.storageService.getPresignedUrl(
            media.file.bucket,
            media.file.key,
            60 * 60, // 1 час
          );
        }
        return null;
      }),
    );

    // Получаем avatarUrl для автора поста
    let avatarUrl: string | null = null;
    if (updatedPost.author.avatar?.bucket && updatedPost.author.avatar?.key) {
      try {
        avatarUrl = await this.storageService.getPresignedUrl(
          updatedPost.author.avatar.bucket,
          updatedPost.author.avatar.key,
          60 * 60, // 1 час
        );
      } catch (error) {
        this.logger.error(`Failed to get avatar URL for user ${updatedPost.author.id}:`, error);
      }
    }

    // Проверяем, лайкнул ли текущий пользователь пост
    const isLiked = updatedPost.likes.some((like) => like.userId === req.user.id);
    const likesCount = updatedPost._count.likes;
    const commentsCount = updatedPost._count.comments;

    // Проверяем, в избранном ли пост
    const favorite = await this.prisma.favorite.findUnique({
      where: {
        userId_postId: {
          userId: req.user.id,
          postId: updatedPost.id,
        },
      },
    });
    const isFavorite = !!favorite;

    return {
      id: updatedPost.id,
      content: updatedPost.content,
      createdAt: updatedPost.createdAt,
      updatedAt: updatedPost.updatedAt,
      author: {
        id: updatedPost.author.id,
        username: updatedPost.author.username,
        firstName: updatedPost.author.firstName,
        lastName: updatedPost.author.lastName,
        avatarUrl,
      },
      images: images.filter(Boolean),
      likesCount,
      commentsCount,
      isLiked,
      isFavorite,
    };
  }

  async getPosts(req: Request, id?: number, limit: number = 10, cursor?: number) {
    const userId = req.user?.id; // Может быть undefined для гостей

    // Если id указан, возвращаем посты конкретного пользователя
    // Если id не указан, возвращаем посты всех пользователей для ленты новостей
    const whereClause = id
      ? {
          authorId: id,
          isPublished: true,
        }
      : {
          isPublished: true,
        };
    
    // Если это лента новостей (id не указан), получаем список друзей (только для авторизованных)
    let friendIds: number[] = [];
    if (!id && userId) {
      const friendships = await this.prisma.friendShip.findMany({
        where: {
          OR: [
            { user1Id: userId, status: 'accepted' },
            { user2Id: userId, status: 'accepted' },
          ],
        },
        select: {
          user1Id: true,
          user2Id: true,
        },
      });

      friendIds = friendships.map((f) =>
        f.user1Id === userId ? f.user2Id : f.user1Id,
      );
    }
    
    const posts = await this.prisma.post.findMany({
      where: whereClause,
      include: {
        postMedia: {
          include: { file: true },
        },
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
        favorites: userId ? {
          where: {
            userId: userId,
          },
          select: {
            id: true,
          },
        } : false,
        views: userId ? {
          where: {
            userId: userId,
          },
          select: {
            id: true,
          },
        } : false,
        _count: {
          select: {
            likes: true,
            comments: true,
            views: true,
          },
        },
      },
      orderBy: [
        { isPinned: 'desc' }, // Закрепленные посты первыми
        { createdAt: 'desc' },
      ],
      take: limit + 1, // Берем на 1 больше, чтобы узнать есть ли еще посты
      ...(cursor && {
        cursor: {
          id: cursor,
        },
        skip: 1, // Пропускаем курсор
      }),
    });

    // Проверяем есть ли еще посты
    const hasMore = posts.length > limit;
    let postsToReturn = hasMore ? posts.slice(0, -1) : posts;

    // Если это лента новостей, сортируем: сначала непросмотренные посты от друзей (только для авторизованных)
    if (!id && friendIds.length > 0 && userId) {
      postsToReturn = postsToReturn.sort((a, b) => {
        const aIsFromFriend = friendIds.includes(a.authorId);
        const bIsFromFriend = friendIds.includes(b.authorId);
        const aIsViewed = Array.isArray(a.views) && a.views.length > 0;
        const bIsViewed = Array.isArray(b.views) && b.views.length > 0;

        // Закрепленные посты всегда первыми
        if (a.isPinned !== b.isPinned) {
          return b.isPinned ? 1 : -1;
        }

        // Непросмотренные посты от друзей
        if (aIsFromFriend && !aIsViewed && (!bIsFromFriend || bIsViewed)) {
          return -1;
        }
        if (bIsFromFriend && !bIsViewed && (!aIsFromFriend || aIsViewed)) {
          return 1;
        }

        // Остальные по дате
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
    }

    // Форматируем посты: оставляем только нужные данные
    const postsWithUrls = await Promise.all(
      postsToReturn.map(async (post) => {
        const images = await Promise.all(
          post.postMedia.map(async (media) => {
            if (media.file?.bucket && media.file?.key) {
              return await this.storageService.getPresignedUrl(
                media.file.bucket,
                media.file.key,
                60 * 60, // 1 час
              );
            }
            return null;
          }),
        );

        // Получаем avatarUrl для автора поста
        let avatarUrl: string | null = null;
        if (post.author.avatar?.bucket && post.author.avatar?.key) {
          try {
            avatarUrl = await this.storageService.getPresignedUrl(
              post.author.avatar.bucket,
              post.author.avatar.key,
              60 * 60, // 1 час
            );
          } catch (error) {
            this.logger.error(`Failed to get avatar URL for user ${post.author.id}:`, error);
          }
        }

        // Проверяем, лайкнул ли текущий пользователь пост (только для авторизованных)
        const isLiked = userId ? post.likes.some((like) => like.userId === userId) : false;
        const isFavorite = userId && Array.isArray(post.favorites) ? post.favorites.length > 0 : false;
        const likesCount = post._count.likes;
        const commentsCount = post._count.comments;
        const viewsCount = post._count.views;

        return {
          id: post.id,
          content: post.content,
          createdAt: post.createdAt,
          updatedAt: post.updatedAt,
          isPinned: post.isPinned,
          author: {
            id: post.author.id,
            username: post.author.username,
            firstName: post.author.firstName,
            lastName: post.author.lastName,
            avatarUrl,
          },
          images: images.filter(Boolean),
          likesCount,
          commentsCount,
          viewsCount,
          isLiked,
          isFavorite,
        };
      }),
    );

    return {
      posts: postsWithUrls,
      hasMore,
      nextCursor: hasMore ? postsToReturn[postsToReturn.length - 1].id : null,
    };
  }

  async toggleLike(req: Request, postId: number) {
    const userId = req.user.id;

    // Проверяем, существует ли пост
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: {
        author: true,
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // Проверяем, есть ли уже лайк от этого пользователя
    const existingLike = await this.prisma.like.findUnique({
      where: {
        userId_postId: {
          userId,
          postId,
        },
      },
    });

    if (existingLike) {
      // Удаляем лайк
      await this.prisma.like.delete({
        where: {
          id: existingLike.id,
        },
      });

      // Удаляем уведомление о лайке, если оно существует
      if (post.authorId !== userId) {
        await this.prisma.notification.deleteMany({
          where: {
            userId: post.authorId,
            type: 'post_like',
            sourceId: String(postId),
            // Проверяем, что уведомление было создано недавно (в течение последних 24 часов)
            createdAt: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
            },
          },
        });
      }

      // Получаем обновленное количество лайков
      const likesCount = await this.prisma.like.count({
        where: { postId },
      });

      return {
        isLiked: false,
        likesCount,
      };
    } else {
      // Создаем лайк
      await this.prisma.like.create({
        data: {
          userId,
          postId,
        },
      });

      // Получаем обновленное количество лайков
      const likesCount = await this.prisma.like.count({
        where: { postId },
      });

      // Отправляем уведомление автору поста (если это не он сам)
      if (post.authorId !== userId) {
        const liker = await this.prisma.user.findUnique({
          where: { id: userId },
        });

        if (liker) {
          await this.notificationService.notifyPostLike(
            post.authorId,
            userId,
            `${liker.firstName} ${liker.lastName}`,
            postId,
          );
        }
      }

      return {
        isLiked: true,
        likesCount,
      };
    }
  }

  /**
   * Регистрирует просмотр поста
   * Логика: один пользователь = один просмотр (уникальная связка userId + postId)
   * Для анонимных пользователей учитываем по IP адресу
   */
  async registerPostView(req: Request, postId: number) {
    try {
      const userId = req.user?.id;
      const ipAddress = this.getClientIp(req);
      const userAgent = req.headers['user-agent'] || null;

      // Если пользователь авторизован
      if (userId) {
        // Проверяем, есть ли уже просмотр от этого пользователя
        const existingView = await this.prisma.postView.findUnique({
          where: {
            unique_user_post_view: {
              userId,
              postId,
            },
          },
        });

        // Если просмотра нет, создаем новый
        if (!existingView) {
          await this.prisma.postView.create({
            data: {
              postId,
              userId,
              ipAddress,
              userAgent,
            },
          });
          this.logger.debug(`Registered view for post ${postId} by user ${userId}`);
        } else {
          // Обновляем время последнего просмотра
          await this.prisma.postView.update({
            where: { id: existingView.id },
            data: { viewedAt: new Date() },
          });
          this.logger.debug(`Updated view timestamp for post ${postId} by user ${userId}`);
        }
      } else if (ipAddress) {
        // Для анонимных пользователей проверяем по IP
        const existingView = await this.prisma.postView.findFirst({
          where: {
            postId,
            userId: null,
            ipAddress,
          },
        });

        if (!existingView) {
          await this.prisma.postView.create({
            data: {
              postId,
              ipAddress,
              userAgent,
            },
          });
          this.logger.debug(`Registered anonymous view for post ${postId} from IP ${ipAddress}`);
        } else {
          // Обновляем время последнего просмотра
          await this.prisma.postView.update({
            where: { id: existingView.id },
            data: { viewedAt: new Date() },
          });
          this.logger.debug(`Updated anonymous view timestamp for post ${postId} from IP ${ipAddress}`);
        }
      }
    } catch (error) {
      // Не прерываем выполнение, если не удалось зарегистрировать просмотр
      this.logger.error(`Failed to register view for post ${postId}: ${error.message}`);
    }
  }

  /**
   * Получает IP адрес клиента с учетом прокси
   */
  private getClientIp(req: Request): string | null {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = (forwarded as string).split(',');
      return ips[0].trim();
    }
    return req.ip || req.socket.remoteAddress || null;
  }

  /**
   * Получает статистику просмотров поста
   */
  async getPostViewStats(postId: number) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // Общее количество просмотров
    const totalViews = await this.prisma.postView.count({
      where: { postId },
    });

    // Количество уникальных авторизованных пользователей
    const uniqueUserViews = await this.prisma.postView.findMany({
      where: {
        postId,
        userId: { not: null },
      },
      select: {
        userId: true,
      },
      distinct: ['userId'],
    });
    const uniqueUsers = uniqueUserViews.length;

    // Количество анонимных просмотров (уникальных IP адресов)
    const anonymousViewsList = await this.prisma.postView.findMany({
      where: {
        postId,
        userId: null,
      },
      select: {
        ipAddress: true,
      },
      distinct: ['ipAddress'],
    });
    const anonymousViews = anonymousViewsList.length;

    // Последние просмотры (топ 10)
    const recentViews = await this.prisma.postView.findMany({
      where: { postId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { viewedAt: 'desc' },
      take: 10,
    });

    return {
      postId,
      totalViews,
      uniqueUsers,
      anonymousViews,
      recentViews: recentViews.map((view) => ({
        id: view.id,
        viewedAt: view.viewedAt,
        user: view.user
          ? {
              id: view.user.id,
              username: view.user.username,
              name: `${view.user.firstName} ${view.user.lastName}`,
            }
          : null,
        isAnonymous: !view.user,
      })),
    };
  }

  async togglePin(req: Request, postId: number) {
    const userId = req.user.id;

    // Проверяем, существует ли пост
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // Проверяем, что пользователь является автором поста
    if (post.authorId !== userId) {
      throw new ForbiddenException('You can only pin your own posts');
    }

    // Если пост уже закреплен, открепляем его
    if (post.isPinned) {
      await this.prisma.post.update({
        where: { id: postId },
        data: { isPinned: false },
      });

      return {
        isPinned: false,
        message: 'Post unpinned successfully',
      };
    } else {
      // Открепляем все другие посты пользователя
      await this.prisma.post.updateMany({
        where: {
          authorId: userId,
          isPinned: true,
        },
        data: { isPinned: false },
      });

      // Закрепляем текущий пост
      await this.prisma.post.update({
        where: { id: postId },
        data: { isPinned: true },
      });

      return {
        isPinned: true,
        message: 'Post pinned successfully',
      };
    }
  }

  async toggleFavorite(req: Request, postId: number) {
    const userId = req.user.id;

    // Проверяем, существует ли пост
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // Проверяем, есть ли уже в избранном
    const existingFavorite = await this.prisma.favorite.findUnique({
      where: {
        userId_postId: {
          userId,
          postId,
        },
      },
    });

    if (existingFavorite) {
      // Удаляем из избранного
      await this.prisma.favorite.delete({
        where: {
          id: existingFavorite.id,
        },
      });

      return {
        isFavorite: false,
        message: 'Post removed from favorites',
      };
    } else {
      // Добавляем в избранное
      await this.prisma.favorite.create({
        data: {
          userId,
          postId,
        },
      });

      return {
        isFavorite: true,
        message: 'Post added to favorites',
      };
    }
  }

  async getFavorites(req: Request, limit: number = 10, cursor?: number) {
    const userId = req.user.id;

    const favorites = await this.prisma.favorite.findMany({
      where: {
        userId,
      },
      include: {
        post: {
          include: {
            postMedia: {
              include: { file: true },
            },
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
                comments: true,
                views: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit + 1,
      ...(cursor && {
        cursor: {
          id: cursor,
        },
        skip: 1,
      }),
    });

    const hasMore = favorites.length > limit;
    const favoritesToReturn = hasMore ? favorites.slice(0, -1) : favorites;

    const postsWithUrls = await Promise.all(
      favoritesToReturn.map(async (favorite) => {
        const post = favorite.post;
        const images = await Promise.all(
          post.postMedia.map(async (media) => {
            if (media.file?.bucket && media.file?.key) {
              return await this.storageService.getPresignedUrl(
                media.file.bucket,
                media.file.key,
                60 * 60,
              );
            }
            return null;
          }),
        );

        let avatarUrl: string | null = null;
        if (post.author.avatar?.bucket && post.author.avatar?.key) {
          try {
            avatarUrl = await this.storageService.getPresignedUrl(
              post.author.avatar.bucket,
              post.author.avatar.key,
              60 * 60,
            );
          } catch (error) {
            this.logger.error(`Failed to get avatar URL for user ${post.author.id}:`, error);
          }
        }

        const isLiked = post.likes.some((like) => like.userId === userId);
        const likesCount = post._count.likes;
        const commentsCount = post._count.comments;
        const viewsCount = post._count.views;

        return {
          id: post.id,
          content: post.content,
          createdAt: post.createdAt,
          updatedAt: post.updatedAt,
          isPinned: post.isPinned,
          isFavorite: true,
          author: {
            id: post.author.id,
            username: post.author.username,
            firstName: post.author.firstName,
            lastName: post.author.lastName,
            avatarUrl,
          },
          images: images.filter(Boolean),
          likesCount,
          commentsCount,
          viewsCount,
          isLiked,
        };
      }),
    );

    return {
      posts: postsWithUrls,
      hasMore,
      nextCursor: hasMore ? favoritesToReturn[favoritesToReturn.length - 1].id : null,
    };
  }

  async searchPosts(req: Request, query: string, limit: number = 10) {
    const userId = req.user.id;
    const searchTerm = query.trim().toLowerCase();

    const posts = await this.prisma.post.findMany({
      where: {
        isPublished: true,
        content: {
          contains: searchTerm,
          mode: 'insensitive',
        },
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
            comments: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    });

    const postsWithUrls = await Promise.all(
      posts.map(async (post) => {
        let avatarUrl: string | null = null;
        if (post.author.avatar?.bucket && post.author.avatar?.key) {
          try {
            avatarUrl = await this.storageService.getPresignedUrl(
              post.author.avatar.bucket,
              post.author.avatar.key,
              60 * 60,
            );
          } catch (error) {
            this.logger.error(`Failed to get avatar URL for user ${post.author.id}:`, error);
          }
        }

        return {
          id: post.id,
          content: post.content,
          author: {
            id: post.author.id,
            username: post.author.username,
            firstName: post.author.firstName,
            lastName: post.author.lastName,
            avatarUrl,
          },
          createdAt: post.createdAt.toISOString(),
          likesCount: post._count.likes,
          commentsCount: post._count.comments,
        };
      }),
    );

    return postsWithUrls;
  }
}
