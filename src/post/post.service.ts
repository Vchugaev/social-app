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
import { CreateDto } from './dto/createDto';
import { Request } from 'express';
import { UpdatePostDto } from './dto/updateDto';

@Injectable()
export class PostService {
  private readonly logger = new Logger(PostService.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
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

  async getPostById(id: number) {
    const post = await this.prisma.post.findFirst({
      where: {
        id,
      },
    });
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
    };
  }

  async getPosts(req: Request, id?: number) {
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
        _count: {
          select: {
            likes: true,
            comments: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Форматируем посты: оставляем только нужные данные
    const postsWithUrls = await Promise.all(
      posts.map(async (post) => {
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

        // Проверяем, лайкнул ли текущий пользователь пост
        const isLiked = post.likes.some((like) => like.userId === req.user.id);
        const likesCount = post._count.likes;
        const commentsCount = post._count.comments;

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
          likesCount,
          commentsCount,
          isLiked,
        };
      }),
    );

    return postsWithUrls;
  }

  async toggleLike(req: Request, postId: number) {
    const userId = req.user.id;

    // Проверяем, существует ли пост
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
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

      return {
        isLiked: true,
        likesCount,
      };
    }
  }
}
