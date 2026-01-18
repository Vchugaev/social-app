import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { Request } from 'express';

export interface TrendData {
  tag: string;
  count: number;
  growth: number;
  velocity: number;
}

@Injectable()
export class ExploreService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
  ) {}

  async getTrends(hours: number = 24): Promise<TrendData[]> {
    const now = new Date();
    const currentPeriodStart = new Date(now.getTime() - hours * 60 * 60 * 1000);
    const previousPeriodStart = new Date(
      now.getTime() - 2 * hours * 60 * 60 * 1000,
    );

    // Получаем ВСЕ опубликованные посты для анализа трендов
    // Разделяем их на текущий и предыдущий период для расчета роста
    const allPosts = await this.prisma.post.findMany({
      where: {
        isPublished: true,
      },
      select: { content: true, createdAt: true },
    });

    // Разделяем посты по периодам
    const currentPosts = allPosts.filter(post => post.createdAt >= currentPeriodStart);
    const previousPosts = allPosts.filter(post => 
      post.createdAt >= previousPeriodStart && post.createdAt < currentPeriodStart
    );

    // Извлекаем хештеги из контента (поддержка кириллицы, латиницы и цифр)
    const extractHashtags = (content: string): string[] => {
      // Используем Unicode property escapes для поддержки всех букв
      const regex = /#[\p{L}\p{N}_]+/gu;
      const matches = content.match(regex) || [];
      return matches.map((tag) => tag.toLowerCase());
    };

    // Подсчитываем хештеги в текущем периоде
    const currentTagCounts = new Map<string, number>();
    currentPosts.forEach((post) => {
      const tags = extractHashtags(post.content);
      tags.forEach((tag) => {
        currentTagCounts.set(tag, (currentTagCounts.get(tag) || 0) + 1);
      });
    });

    // Подсчитываем хештеги в предыдущем периоде
    const previousTagCounts = new Map<string, number>();
    previousPosts.forEach((post) => {
      const tags = extractHashtags(post.content);
      tags.forEach((tag) => {
        previousTagCounts.set(tag, (previousTagCounts.get(tag) || 0) + 1);
      });
    });

    // Вычисляем тренды
    const trends: TrendData[] = [];
    currentTagCounts.forEach((currentCount, tag) => {
      const previousCount = previousTagCounts.get(tag) || 0;
      
      // Рост в процентах
      let growth = 0;
      if (previousCount > 0) {
        growth = ((currentCount - previousCount) / previousCount) * 100;
      } else if (currentCount > 0) {
        growth = 100; // Новый тег
      }

      // Velocity - скорость роста (посты в час)
      const velocity = currentCount / hours;

      // Добавляем теги с минимум 1 упоминанием
      if (currentCount >= 1) {
        trends.push({
          tag,
          count: currentCount,
          growth: Math.round(growth),
          velocity: Math.round(velocity * 10) / 10,
        });
      }
    });

    // Сортируем по росту и количеству
    trends.sort((a, b) => {
      // Приоритет: рост > 50% или velocity > 1
      const aScore = (a.growth > 50 ? 1000 : 0) + a.count * 10 + a.growth;
      const bScore = (b.growth > 50 ? 1000 : 0) + b.count * 10 + b.growth;
      return bScore - aScore;
    });

    return trends.slice(0, 10);
  }

  async getPostsByTag(tag: string, page: number = 1, limit: number = 20, userId?: number) {
    const skip = (page - 1) * limit;
    // Нормализуем тег: убираем # если есть и приводим к нижнему регистру
    const normalizedTag = tag.toLowerCase().replace(/^#/, '');
    const searchPattern = `#${normalizedTag}`;

    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where: {
          isPublished: true,
          content: {
            contains: searchPattern,
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
          postMedia: {
            include: {
              file: true,
            },
            orderBy: {
              order: 'asc',
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
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      this.prisma.post.count({
        where: {
          isPublished: true,
          content: {
            contains: searchPattern,
            mode: 'insensitive',
          },
        },
      }),
    ]);

    // Форматируем посты
    const formattedPosts = await Promise.all(
      posts.map(async (post) => {
        // Получаем URL изображений
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

        // Получаем avatarUrl для автора
        let avatarUrl: string | null = null;
        if (post.author.avatar?.bucket && post.author.avatar?.key) {
          try {
            avatarUrl = await this.storageService.getPresignedUrl(
              post.author.avatar.bucket,
              post.author.avatar.key,
              60 * 60, // 1 час
            );
          } catch (error) {
            console.error(`Failed to get avatar URL for user ${post.author.id}:`, error);
          }
        }

        // Проверяем, лайкнул ли текущий пользователь пост
        const isLiked = userId ? post.likes.some((like) => like.userId === userId) : false;
        const isFavorite = userId && Array.isArray(post.favorites) ? post.favorites.length > 0 : false;

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
          likesCount: post._count.likes,
          commentsCount: post._count.comments,
          viewsCount: post._count.views,
          isLiked,
          isFavorite,
        };
      }),
    );

    return {
      posts: formattedPosts,
      total,
      page,
      limit,
      hasMore: skip + posts.length < total,
    };
  }

  async getExploreFeed(limit: number = 30, offset: number = 0) {
    // Получаем все опубликованные посты
    const posts = await this.prisma.post.findMany({
      where: {
        isPublished: true,
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
        postMedia: {
          include: {
            file: true,
          },
          orderBy: {
            order: 'asc',
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
      orderBy: [
        { createdAt: 'desc' },
      ],
      skip: offset,
      take: limit * 3, // Берем больше для разнообразия
    });

    // Получаем активных пользователей
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        bio: true,
        avatar: {
          select: {
            bucket: true,
            key: true,
          },
        },
        _count: {
          select: {
            posts: true,
            friends1: true,
            friends2: true,
          },
        },
      },
      take: 20,
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Формируем explore items
    const items: any[] = [];

    // Добавляем посты
    for (const [index, post] of posts.entries()) {
      const hasMedia = post.postMedia.length > 0;
      
      // Получаем URL изображений
      const images = await Promise.all(
        post.postMedia.map(async (media) => {
          if (media.file?.bucket && media.file?.key) {
            try {
              return await this.storageService.getPresignedUrl(
                media.file.bucket,
                media.file.key,
                60 * 60, // 1 час
              );
            } catch (error) {
              console.error(`Failed to get image URL:`, error);
              return null;
            }
          }
          return null;
        }),
      );

      const validImages = images.filter(Boolean) as string[];

      // Получаем avatarUrl для автора
      let avatarUrl: string | null = null;
      if (post.author.avatar?.bucket && post.author.avatar?.key) {
        try {
          avatarUrl = await this.storageService.getPresignedUrl(
            post.author.avatar.bucket,
            post.author.avatar.key,
            60 * 60, // 1 час
          );
        } catch (error) {
          console.error(`Failed to get avatar URL for user ${post.author.id}:`, error);
        }
      }

      if (hasMedia && validImages.length > 0) {
        // Медиа карточка
        items.push({
          id: `media-${post.id}`,
          type: 'media',
          size: validImages.length > 1 ? 'large' : 'medium',
          data: {
            id: post.id,
            images: validImages,
            author: {
              id: post.author.id,
              username: post.author.username,
              firstName: post.author.firstName,
              lastName: post.author.lastName,
              avatarUrl,
            },
            likesCount: post._count.likes,
            commentsCount: post._count.comments,
            viewsCount: post._count.views,
          },
        });
      }

      // Пост карточка
      if (index % 3 === 0 || !hasMedia) {
        items.push({
          id: `post-${post.id}`,
          type: 'post',
          size: post.content.length > 200 ? 'large' : 'small',
          data: {
            id: post.id,
            content: post.content,
            images: validImages,
            author: {
              id: post.author.id,
              username: post.author.username,
              firstName: post.author.firstName,
              lastName: post.author.lastName,
              avatarUrl,
            },
            likesCount: post._count.likes,
            commentsCount: post._count.comments,
            viewsCount: post._count.views,
            createdAt: post.createdAt.toISOString(),
          },
        });
      }
    }

    // Добавляем пользователей
    for (const [index, user] of users.entries()) {
      if (index % 5 === 0) {
        // Получаем avatarUrl для пользователя
        let avatarUrl: string | null = null;
        if (user.avatar?.bucket && user.avatar?.key) {
          try {
            avatarUrl = await this.storageService.getPresignedUrl(
              user.avatar.bucket,
              user.avatar.key,
              60 * 60, // 1 час
            );
          } catch (error) {
            console.error(`Failed to get avatar URL for user ${user.id}:`, error);
          }
        }

        items.push({
          id: `user-${user.id}`,
          type: 'user',
          size: 'small',
          data: {
            id: user.id,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            bio: user.bio,
            avatarUrl,
            postsCount: user._count.posts,
            friendsCount: user._count.friends1 + user._count.friends2,
          },
        });
      }
    }

    // Перемешиваем и возвращаем нужное количество
    const shuffled = items.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, limit);
  }
}
