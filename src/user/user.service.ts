import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/storage/storage.service';
import { UpdateProfileDto } from './dto/update-profile-dto';
import { UpdatePrivacySettingsDto } from './dto/update-privacy-settings.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { NotificationService } from 'src/notification/notification.service';
import { ChatGateway } from 'src/chat/chat.gateway';
import * as bcrypt from 'bcrypt';

export interface Activity {
  type: 'photo' | 'update' | 'comment' | 'file';
  title: string;
  content?: string;
  files?: string[];
  postId?: number;
  createdAt: string;
}

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    private notificationService: NotificationService,
    @Inject(forwardRef(() => ChatGateway))
    private chatGateway: ChatGateway,
  ) {}

  async updateAvatar(userid: number, file: Express.Multer.File) {
    const key = `users/${userid}/${file.originalname}`;

    const bucket = 'avatars';

    await this.storageService.upload(userid, bucket, file, key);
    const fileRecord = await this.prisma.file.create({
      data: {
        owner: { connect: { id: userid } },
        bucket: 'avatars',
        key: key,
        type: 'image',
      },
    });
    await this.prisma.user.update({
      where: { id: userid },
      data: { avatar: { connect: { id: fileRecord.id } } },
    });

    return fileRecord;
  }

  async updateBanner(userid: number, file: Express.Multer.File) {
    const key = `users/${userid}/banner-${file.originalname}`;

    const bucket = 'banners';

    await this.storageService.upload(userid, bucket, file, key);
    const fileRecord = await this.prisma.file.create({
      data: {
        owner: { connect: { id: userid } },
        bucket: 'banners',
        key: key,
        type: 'image',
      },
    });
    await this.prisma.user.update({
      where: { id: userid },
      data: { banner: { connect: { id: fileRecord.id } } },
    });

    return fileRecord;
  }

  async updateProfile(userId: number, data: UpdateProfileDto) {
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Нет данных для обновления');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        email: true,
        username: true,
        bio: true,
        firstName: true,
        lastName: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    return user;
  }

  async getProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { avatar: true, banner: true },
    });

    if (!user) throw new NotFoundException('User not found');

    let avatarUrl: string | null = null;
    if (user.avatar) {
      avatarUrl = await this.storageService.getPresignedUrl(
        user.avatar.bucket,
        user.avatar.key,
        60 * 60,
      );
    }

    let bannerUrl: string | null = null;
    if (user.banner) {
      bannerUrl = await this.storageService.getPresignedUrl(
        user.banner.bucket,
        user.banner.key,
        60 * 60,
      );
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      bio: user.bio,
      phone: user.phone,
      avatarUrl,
      bannerUrl,
      createdAt: user.createdAt.toISOString(),
    };
  }

  async getProfileStats(userId: number) {
    const [
      postsCount,
      friendsCount,
      likesCount,
      commentsCount,
      filesCount,
    ] = await Promise.all([
      this.prisma.post.count({ where: { authorId: userId } }),
      this.prisma.friendShip.count({
        where: {
          OR: [
            { user1Id: userId, status: 'accepted' },
            { user2Id: userId, status: 'accepted' },
          ],
        },
      }),
      this.prisma.like.count({ where: { userId } }),
      this.prisma.comment.count({ where: { authorId: userId } }),
      this.prisma.file.count({ where: { ownerId: userId } }),
    ]);

    return {
      posts: postsCount,
      friends: friendsCount,
      likes: likesCount,
      comments: commentsCount,
      files: filesCount,
    };
  }

  async getProfileActivity(userId: number, limit: number = 10): Promise<Activity[]> {
    const [posts, comments, files] = await Promise.all([
      this.prisma.post.findMany({
        where: { authorId: userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          postMedia: {
            include: { file: true },
            take: 3,
          },
        },
      }),
      this.prisma.comment.findMany({
        where: { authorId: userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          post: {
            select: { id: true, content: true },
          },
        },
      }),
      this.prisma.file.findMany({
        where: { ownerId: userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);

    const activities: Activity[] = [];

    // Add posts
    for (const post of posts) {
      activities.push({
        type: post.postMedia.length > 0 ? 'photo' : 'update',
        title:
          post.postMedia.length > 0
            ? `${post.postMedia.length} новых фото добавлено`
            : 'Пост создан',
        content: post.content.substring(0, 100),
        files: post.postMedia.map((pm) => pm.file.key),
        createdAt: post.createdAt.toISOString(),
      });
    }

    // Add comments
    for (const comment of comments) {
      activities.push({
        type: 'comment',
        title: 'Комментарий добавлен',
        content: comment.content.substring(0, 100),
        postId: comment.postId,
        createdAt: comment.createdAt.toISOString(),
      });
    }

    // Add files
    for (const file of files) {
      activities.push({
        type: 'file',
        title: 'Файл загружен',
        files: [file.key],
        createdAt: file.createdAt.toISOString(),
      });
    }

    // Sort by date and limit
    activities.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return activities.slice(0, limit);
  }

  async getProfileConnections(userId: number, requesterId?: number, limit: number = 10) {
    // Если это не сам пользователь, проверяем настройки приватности
    if (requesterId && requesterId !== userId) {
      const settings = await this.prisma.userSettings.findUnique({
        where: { userId },
        select: { whoCanSeeFriends: true },
      });

      if (settings) {
        // Если настройка "только я" - возвращаем пустой список
        if (settings.whoCanSeeFriends === 'nobody') {
          return [];
        }

        // Если настройка "только друзья" - проверяем дружбу
        if (settings.whoCanSeeFriends === 'friends') {
          const friendship = await this.prisma.friendShip.findFirst({
            where: {
              OR: [
                { user1Id: requesterId, user2Id: userId, status: 'accepted' },
                { user1Id: userId, user2Id: requesterId, status: 'accepted' },
              ],
            },
          });

          if (!friendship) {
            return [];
          }
        }
      }
    }

    const friendships = await this.prisma.friendShip.findMany({
      where: {
        OR: [
          { user1Id: userId, status: 'accepted' },
          { user2Id: userId, status: 'accepted' },
        ],
      },
      include: {
        user1: {
          include: { avatar: true },
        },
        user2: {
          include: { avatar: true },
        },
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    const connections = await Promise.all(
      friendships.map(async (friendship) => {
        const friend =
          friendship.user1Id === userId ? friendship.user2 : friendship.user1;

        let avatarUrl: string | null = null;
        if (friend.avatar) {
          avatarUrl = await this.storageService.getPresignedUrl(
            friend.avatar.bucket,
            friend.avatar.key,
            60 * 60,
          );
        }

        // Count friend's connections
        const friendConnectionsCount = await this.prisma.friendShip.count({
          where: {
            OR: [
              { user1Id: friend.id, status: 'accepted' },
              { user2Id: friend.id, status: 'accepted' },
            ],
          },
        });

        return {
          id: friend.id,
          firstName: friend.firstName,
          lastName: friend.lastName,
          username: friend.username,
          avatarUrl,
          connectionsCount: friendConnectionsCount,
        };
      }),
    );

    return connections;
  }

  async searchUsers(userId: number, query: string, limit: number = 10) {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const searchTerm = query.trim();

    const users = await this.prisma.user.findMany({
      where: {
        id: { not: userId }, // Exclude current user
        OR: [
          { username: { contains: searchTerm, mode: 'insensitive' } },
          { firstName: { contains: searchTerm, mode: 'insensitive' } },
          { lastName: { contains: searchTerm, mode: 'insensitive' } },
        ],
      },
      include: {
        avatar: true,
      },
      take: limit,
      orderBy: [
        { username: 'asc' },
        { firstName: 'asc' },
      ],
    });

    const usersWithAvatars = await Promise.all(
      users.map(async (user) => {
        let avatarUrl: string | null = null;
        if (user.avatar) {
          avatarUrl = await this.storageService.getPresignedUrl(
            user.avatar.bucket,
            user.avatar.key,
            60 * 60,
          );
        }

        return {
          id: user.id,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          avatarUrl,
        };
      }),
    );

    return usersWithAvatars;
  }

  async getUserProfile(currentUserId: number | undefined, targetUserId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: { avatar: true, banner: true },
    });

    if (!user) throw new NotFoundException('User not found');

    let avatarUrl: string | null = null;
    if (user.avatar) {
      avatarUrl = await this.storageService.getPresignedUrl(
        user.avatar.bucket,
        user.avatar.key,
        60 * 60,
      );
    }

    let bannerUrl: string | null = null;
    if (user.banner) {
      bannerUrl = await this.storageService.getPresignedUrl(
        user.banner.bucket,
        user.banner.key,
        60 * 60,
      );
    }

    // Check if users are friends (только для авторизованных пользователей)
    let friendship: any = null;
    let isRequestSender = false;
    
    if (currentUserId) {
      friendship = await this.prisma.friendShip.findFirst({
        where: {
          OR: [
            { user1Id: currentUserId, user2Id: targetUserId },
            { user1Id: targetUserId, user2Id: currentUserId },
          ],
        },
      });

      // Determine if current user sent or received the request
      if (friendship) {
        isRequestSender = friendship.user1Id === currentUserId;
      }
    }

    // Check online status via WebSocket
    let isOnline = false;
    
    // Если это не сам пользователь, проверяем настройки приватности
    if (currentUserId && currentUserId !== targetUserId) {
      const settings = await this.prisma.userSettings.findUnique({
        where: { userId: targetUserId },
        select: { hideOnlineStatus: true },
      });

      // Показываем онлайн статус только если настройка не включена
      if (!settings || !settings.hideOnlineStatus) {
        isOnline = this.chatGateway.isUserOnline(targetUserId);
      }
    } else if (currentUserId === targetUserId) {
      // Для своего профиля всегда показываем реальный статус
      isOnline = this.chatGateway.isUserOnline(targetUserId);
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      bio: user.bio,
      phone: user.phone,
      avatarUrl,
      bannerUrl,
      createdAt: user.createdAt.toISOString(),
      friendshipStatus: friendship?.status || null,
      isFriend: friendship?.status === 'accepted',
      isRequestSender,
      isOnline,
    };
  }

  async getUserByUsername(username: string) {
    return this.prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true },
    });
  }

  async getUserProfileByUsername(currentUserId: number | undefined, username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { avatar: true },
    });

    if (!user) throw new NotFoundException('User not found');

    return this.getUserProfile(currentUserId, user.id);
  }

  async sendFriendRequest(userId: number, targetUserId: number) {
    if (userId === targetUserId) {
      throw new BadRequestException('Нельзя добавить себя в друзья');
    }

    // Check if target user exists
    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      throw new NotFoundException('Пользователь не найден');
    }

    // Get current user info for notification
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!currentUser) {
      throw new NotFoundException('Пользователь не найден');
    }

    // Check if friendship already exists
    const existingFriendship = await this.prisma.friendShip.findFirst({
      where: {
        OR: [
          { user1Id: userId, user2Id: targetUserId },
          { user1Id: targetUserId, user2Id: userId },
        ],
      },
    });

    if (existingFriendship) {
      if (existingFriendship.status === 'accepted') {
        throw new BadRequestException('Вы уже друзья');
      }
      if (existingFriendship.status === 'pending') {
        throw new BadRequestException('Запрос уже отправлен');
      }
    }

    // Create friend request
    const friendship = await this.prisma.friendShip.create({
      data: {
        user1Id: userId,
        user2Id: targetUserId,
        status: 'pending',
      },
    });

    // Create notification
    await this.notificationService.notifyFriendRequest(
      targetUserId,
      currentUser.username,
      `${currentUser.firstName} ${currentUser.lastName}`,
    );

    return {
      id: friendship.id,
      status: friendship.status,
      message: 'Запрос на добавление в друзья отправлен',
    };
  }

  async acceptFriendRequest(userId: number, requesterId: number) {
    const friendship = await this.prisma.friendShip.findFirst({
      where: {
        user1Id: requesterId,
        user2Id: userId,
        status: 'pending',
      },
    });

    if (!friendship) {
      throw new NotFoundException('Запрос на добавление в друзья не найден');
    }

    // Get current user info for notification
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!currentUser) {
      throw new NotFoundException('Пользователь не найден');
    }

    const updated = await this.prisma.friendShip.update({
      where: { id: friendship.id },
      data: {
        status: 'accepted',
        acceptedAt: new Date(),
      },
    });

    // Create notification for requester
    await this.notificationService.notifyFriendAccepted(
      requesterId,
      currentUser.username,
      `${currentUser.firstName} ${currentUser.lastName}`,
    );

    return {
      id: updated.id,
      status: updated.status,
      message: 'Запрос принят',
    };
  }

  async rejectFriendRequest(userId: number, requesterId: number) {
    const friendship = await this.prisma.friendShip.findFirst({
      where: {
        user1Id: requesterId,
        user2Id: userId,
        status: 'pending',
      },
    });

    if (!friendship) {
      throw new NotFoundException('Запрос на добавление в друзья не найден');
    }

    await this.prisma.friendShip.delete({
      where: { id: friendship.id },
    });

    return {
      message: 'Запрос отклонен',
    };
  }

  async cancelFriendRequest(userId: number, targetUserId: number) {
    const friendship = await this.prisma.friendShip.findFirst({
      where: {
        user1Id: userId,
        user2Id: targetUserId,
        status: 'pending',
      },
    });

    if (!friendship) {
      throw new NotFoundException('Запрос на добавление в друзья не найден');
    }

    await this.prisma.friendShip.delete({
      where: { id: friendship.id },
    });

    return {
      message: 'Запрос отменен',
    };
  }

  async removeFriend(userId: number, friendId: number) {
    const friendship = await this.prisma.friendShip.findFirst({
      where: {
        OR: [
          { user1Id: userId, user2Id: friendId },
          { user1Id: friendId, user2Id: userId },
        ],
        status: 'accepted',
      },
    });

    if (!friendship) {
      throw new NotFoundException('Дружба не найдена');
    }

    await this.prisma.friendShip.delete({
      where: { id: friendship.id },
    });

    return {
      message: 'Пользователь удален из друзей',
    };
  }

  async getFriendRequests(userId: number) {
    const requests = await this.prisma.friendShip.findMany({
      where: {
        user2Id: userId,
        status: 'pending',
      },
      include: {
        user1: {
          include: { avatar: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const requestsWithAvatars = await Promise.all(
      requests.map(async (request) => {
        let avatarUrl: string | null = null;
        if (request.user1.avatar) {
          avatarUrl = await this.storageService.getPresignedUrl(
            request.user1.avatar.bucket,
            request.user1.avatar.key,
            60 * 60,
          );
        }

        return {
          id: request.id,
          userId: request.user1.id,
          firstName: request.user1.firstName,
          lastName: request.user1.lastName,
          username: request.user1.username,
          avatarUrl,
          createdAt: request.createdAt.toISOString(),
        };
      }),
    );

    return requestsWithAvatars;
  }

  async getFriendsList(userId: number) {
    const friendships = await this.prisma.friendShip.findMany({
      where: {
        OR: [
          { user1Id: userId, status: 'accepted' },
          { user2Id: userId, status: 'accepted' },
        ],
      },
      include: {
        user1: {
          include: { avatar: true },
        },
        user2: {
          include: { avatar: true },
        },
      },
      orderBy: { acceptedAt: 'desc' },
    });

    const friends = await Promise.all(
      friendships.map(async (friendship) => {
        const friend =
          friendship.user1Id === userId ? friendship.user2 : friendship.user1;

        let avatarUrl: string | null = null;
        if (friend.avatar) {
          avatarUrl = await this.storageService.getPresignedUrl(
            friend.avatar.bucket,
            friend.avatar.key,
            60 * 60,
          );
        }

        return {
          id: friend.id,
          firstName: friend.firstName,
          lastName: friend.lastName,
          username: friend.username,
          avatarUrl,
          friendsSince: friendship.acceptedAt?.toISOString() || friendship.createdAt.toISOString(),
        };
      }),
    );

    return friends;
  }

  async getFollowers(userId: number) {
    // Users who sent friend request to me (only pending, not accepted friends)
    const followers = await this.prisma.friendShip.findMany({
      where: {
        user2Id: userId,
        status: 'pending', // Only pending requests
      },
      include: {
        user1: {
          include: { avatar: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      followers.map(async (follower) => {
        let avatarUrl: string | null = null;
        if (follower.user1.avatar) {
          avatarUrl = await this.storageService.getPresignedUrl(
            follower.user1.avatar.bucket,
            follower.user1.avatar.key,
            60 * 60,
          );
        }

        return {
          id: follower.user1.id,
          firstName: follower.user1.firstName,
          lastName: follower.user1.lastName,
          username: follower.user1.username,
          avatarUrl,
          status: follower.status,
          since: follower.createdAt.toISOString(),
        };
      }),
    );
  }

  async getFollowing(userId: number) {
    // Users I sent friend request to (only pending, not accepted friends)
    const following = await this.prisma.friendShip.findMany({
      where: {
        user1Id: userId,
        status: 'pending', // Only pending requests
      },
      include: {
        user2: {
          include: { avatar: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      following.map(async (follow) => {
        let avatarUrl: string | null = null;
        if (follow.user2.avatar) {
          avatarUrl = await this.storageService.getPresignedUrl(
            follow.user2.avatar.bucket,
            follow.user2.avatar.key,
            60 * 60,
          );
        }

        return {
          id: follow.user2.id,
          firstName: follow.user2.firstName,
          lastName: follow.user2.lastName,
          username: follow.user2.username,
          avatarUrl,
          status: follow.status,
          since: follow.createdAt.toISOString(),
        };
      }),
    );
  }

  async getRecommendedUsers(userId: number, limit: number = 10) {
    // Get user's friends
    const userFriends = await this.prisma.friendShip.findMany({
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

    const friendIds = userFriends.map((f) =>
      f.user1Id === userId ? f.user2Id : f.user1Id,
    );

    // Get all pending/rejected requests to exclude
    const existingConnections = await this.prisma.friendShip.findMany({
      where: {
        OR: [{ user1Id: userId }, { user2Id: userId }],
      },
      select: {
        user1Id: true,
        user2Id: true,
      },
    });

    const excludeIds = [
      userId,
      ...friendIds,
      ...existingConnections.map((c) =>
        c.user1Id === userId ? c.user2Id : c.user1Id,
      ),
    ];

    // Strategy 1: Friends of friends
    const friendsOfFriends = await this.prisma.friendShip.findMany({
      where: {
        OR: [
          { user1Id: { in: friendIds }, status: 'accepted' },
          { user2Id: { in: friendIds }, status: 'accepted' },
        ],
        NOT: {
          OR: [
            { user1Id: { in: excludeIds } },
            { user2Id: { in: excludeIds } },
          ],
        },
      },
      include: {
        user1: { include: { avatar: true } },
        user2: { include: { avatar: true } },
      },
      take: limit * 2,
    });

    const recommendedMap = new Map();

    for (const fof of friendsOfFriends) {
      const recommendedUser =
        friendIds.includes(fof.user1Id) ? fof.user2 : fof.user1;

      if (!excludeIds.includes(recommendedUser.id)) {
        if (!recommendedMap.has(recommendedUser.id)) {
          recommendedMap.set(recommendedUser.id, {
            user: recommendedUser,
            mutualFriends: 0,
          });
        }
        recommendedMap.get(recommendedUser.id).mutualFriends++;
      }
    }

    // Strategy 2: New users (if not enough recommendations)
    if (recommendedMap.size < limit) {
      const newUsers = await this.prisma.user.findMany({
        where: {
          id: { notIn: excludeIds },
        },
        include: { avatar: true },
        orderBy: { createdAt: 'desc' },
        take: limit - recommendedMap.size,
      });

      for (const user of newUsers) {
        if (!recommendedMap.has(user.id)) {
          recommendedMap.set(user.id, {
            user,
            mutualFriends: 0,
          });
        }
      }
    }

    // Convert to array and sort by mutual friends
    const recommendations = Array.from(recommendedMap.values())
      .sort((a, b) => b.mutualFriends - a.mutualFriends)
      .slice(0, limit);

    return Promise.all(
      recommendations.map(async ({ user, mutualFriends }) => {
        let avatarUrl: string | null = null;
        if (user.avatar) {
          avatarUrl = await this.storageService.getPresignedUrl(
            user.avatar.bucket,
            user.avatar.key,
            60 * 60,
          );
        }

        return {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          bio: user.bio,
          avatarUrl,
          mutualFriends,
          isNew: mutualFriends === 0,
        };
      }),
    );
  }

  // Privacy Settings
  async getPrivacySettings(userId: number) {
    let settings = await this.prisma.userSettings.findUnique({
      where: { userId },
      select: {
        whoCanMessage: true,
        whoCanSeeFriends: true,
        whoCanAddToGroups: true,
        hideOnlineStatus: true,
      },
    });

    // Create default settings if not exists
    if (!settings) {
      settings = await this.prisma.userSettings.create({
        data: {
          userId,
          darkMode: false,
          privateAccount: false,
          whoCanMessage: 'everyone',
          whoCanSeeFriends: 'everyone',
          whoCanAddToGroups: 'everyone',
          hideOnlineStatus: false,
        },
        select: {
          whoCanMessage: true,
          whoCanSeeFriends: true,
          whoCanAddToGroups: true,
          hideOnlineStatus: true,
        },
      });
    }

    return settings;
  }

  async updatePrivacySettings(userId: number, data: UpdatePrivacySettingsDto) {
    // Ensure settings exist
    const existingSettings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });

    if (!existingSettings) {
      // Create with defaults and apply updates
      return this.prisma.userSettings.create({
        data: {
          userId,
          darkMode: false,
          privateAccount: false,
          ...data,
        },
        select: {
          whoCanMessage: true,
          whoCanSeeFriends: true,
          whoCanAddToGroups: true,
          hideOnlineStatus: true,
        },
      });
    }

    return this.prisma.userSettings.update({
      where: { userId },
      data,
      select: {
        whoCanMessage: true,
        whoCanSeeFriends: true,
        whoCanAddToGroups: true,
        hideOnlineStatus: true,
      },
    });
  }

  // Password Management
  async changePassword(userId: number, data: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { password: true },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(
      data.currentPassword,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Неверный текущий пароль');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(data.newPassword, 10);

    // Update password
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return { message: 'Пароль успешно изменен' };
  }

  // Session Management
  async getUserSessions(userId: number) {
    const sessions = await this.prisma.userSession.findMany({
      where: {
        userId,
        expiresAt: { gt: new Date() }, // Only active sessions
      },
      orderBy: { lastActiveAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        lastActiveAt: true,
        createdAt: true,
      },
    });

    return sessions;
  }

  async logoutAllDevices(userId: number, currentSessionToken?: string) {
    // Delete all sessions except current one
    await this.prisma.userSession.deleteMany({
      where: {
        userId,
        ...(currentSessionToken && {
          sessionToken: { not: currentSessionToken },
        }),
      },
    });

    return { message: 'Выход выполнен на всех устройствах' };
  }

  async deleteSession(userId: number, sessionId: number) {
    const session = await this.prisma.userSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      throw new NotFoundException('Сессия не найдена');
    }

    await this.prisma.userSession.delete({
      where: { id: sessionId },
    });

    return { message: 'Сессия удалена' };
  }
}
