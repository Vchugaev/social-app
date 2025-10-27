import {
  ForbiddenException,
  Injectable,
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
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
  ) {}

  async createPost(user: User, dto: CreateDto, files: Express.Multer.File[]) {
    const bucket = 'posts';

    // Проверяем, что файлы существуют и имеют необходимые свойства
    if (!files || files.length === 0) {
      throw new Error('No files provided');
    }

    // Сохраняем все файлы через StorageService.upload
    const savedFiles = await Promise.all(
      files.map((file) => {
        if (!file || !file.buffer || !file.originalname) {
          throw new Error('Invalid file data');
        }
        const key = `users/${user.id}/${file.originalname}`;
        // ✅ передаём file.buffer и file.size внутри StorageService.upload
        return this.storageService.upload(user.id, bucket, file, key);
      }),
    );
    const isPublished = dto.isPublished ?? false;

    const post = await this.prisma.post.create({
      data: {
        authorId: user.id,
        content: dto.content,
        isPublished: isPublished,
        postMedia: {
          create: savedFiles.map((file, index) => ({
            fileId: file.id, // file должен быть объектом с id
            order: index,
          })),
        },
      },
      include: { postMedia: true },
    });

    return post;
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
          select: { id: true, username: true, firstName: true, lastName: true },
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

    return {
      id: updatedPost.id,
      content: updatedPost.content,
      createdAt: updatedPost.createdAt,
      updatedAt: updatedPost.updatedAt,
      author: updatedPost.author,
      images: images.filter(Boolean),
    };
  }

  async getPosts(req: Request, id?: number) {
    const posts = await this.prisma.post.findMany({
      where: {
        authorId: id ?? req.user.id,
        isPublished: true,
      },
      include: {
        postMedia: {
          include: { file: true },
        },
        author: {
          select: { id: true, username: true, firstName: true, lastName: true },
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

        return {
          id: post.id,
          content: post.content,
          createdAt: post.createdAt,
          author: post.author,
          images: images.filter(Boolean),
        };
      }),
    );

    return postsWithUrls;
  }
}
