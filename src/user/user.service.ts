import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/storage/storage.service';
import { UpdateProfileDto } from './dto/update-profile-dto';

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
      include: { avatar: true },
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

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      bio: user.bio,
      avatarUrl,
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

  async getProfileConnections(userId: number, limit: number = 10) {
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
}
