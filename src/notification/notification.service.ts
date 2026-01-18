import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ChatGateway } from 'src/chat/chat.gateway';

export enum NotificationType {
  FRIEND_REQUEST = 'friend_request',
  FRIEND_ACCEPTED = 'friend_accepted',
  POST_LIKE = 'post_like',
  POST_COMMENT = 'post_comment',
  COMMENT_LIKE = 'comment_like',
  MESSAGE = 'message',
}

@Injectable()
export class NotificationService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ChatGateway))
    private chatGateway: ChatGateway,
  ) {}

  async createNotification(
    userId: number,
    type: NotificationType,
    sourceId: string,
    content: string,
  ) {
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type,
        sourceId,
        content,
        isRead: false,
      },
    });

    // Отправляем уведомление через WebSocket
    this.chatGateway.sendNotificationToUser(userId, notification);

    return notification;
  }

  async getNotifications(userId: number, limit: number = 20) {
    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return notifications;
  }

  async getUnreadCount(userId: number) {
    const count = await this.prisma.notification.count({
      where: {
        userId,
        isRead: false,
      },
    });

    return { count };
  }

  async markAsRead(userId: number, notificationId: number) {
    const notification = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId,
      },
    });

    if (!notification) {
      throw new Error('Notification not found');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: number) {
    return this.prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: { isRead: true },
    });
  }

  async deleteNotification(userId: number, notificationId: number) {
    const notification = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId,
      },
    });

    if (!notification) {
      throw new Error('Notification not found');
    }

    return this.prisma.notification.delete({
      where: { id: notificationId },
    });
  }

  // Helper methods for creating specific notification types
  async notifyFriendRequest(userId: number, requesterUsername: string, requesterName: string) {
    return this.createNotification(
      userId,
      NotificationType.FRIEND_REQUEST,
      requesterUsername,
      `${requesterName} отправил вам запрос в друзья`,
    );
  }

  async notifyFriendAccepted(userId: number, accepterUsername: string, accepterName: string) {
    return this.createNotification(
      userId,
      NotificationType.FRIEND_ACCEPTED,
      accepterUsername,
      `${accepterName} принял ваш запрос в друзья`,
    );
  }

  async notifyPostLike(userId: number, likerId: number, likerName: string, postId: number) {
    // Проверяем, есть ли уже уведомление о лайке от этого пользователя для этого поста
    const existingNotification = await this.prisma.notification.findFirst({
      where: {
        userId: userId,
        type: NotificationType.POST_LIKE,
        sourceId: String(postId),
        // Проверяем уведомления за последние 24 часа
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    });

    // Создаем уведомление только если его еще нет
    if (!existingNotification) {
      return this.createNotification(
        userId,
        NotificationType.POST_LIKE,
        String(postId),
        `${likerName} оценил ваш пост`,
      );
    }

    return null;
  }

  async notifyPostComment(userId: number, commenterId: number, commenterName: string, postId: number) {
    // Проверяем, есть ли уже недавнее уведомление о комментарии
    const recentNotification = await this.prisma.notification.findFirst({
      where: {
        userId: userId,
        type: NotificationType.POST_COMMENT,
        sourceId: String(postId),
        // Проверяем уведомления за последние 5 минут
        createdAt: {
          gte: new Date(Date.now() - 5 * 60 * 1000),
        },
      },
    });

    // Создаем уведомление только если не было недавних
    if (!recentNotification) {
      return this.createNotification(
        userId,
        NotificationType.POST_COMMENT,
        String(postId),
        `${commenterName} прокомментировал ваш пост`,
      );
    }

    return null;
  }

  async notifyCommentLike(userId: number, likerId: number, likerName: string, commentId: number) {
    return this.createNotification(
      userId,
      NotificationType.COMMENT_LIKE,
      String(commentId),
      `${likerName} оценил ваш комментарий`,
    );
  }
}
