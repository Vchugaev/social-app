import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/storage/storage.service';

@Injectable()
export class ChatService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
  ) {}

  async getConversations(userId: number) {
    const chatMemberships = await this.prisma.chatMember.findMany({
      where: { userId },
      include: {
        chat: {
          include: {
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: {
                sender: {
                  include: { avatar: true },
                },
              },
            },
            chatMembers: {
              where: { userId: { not: userId } },
              include: {
                user: {
                  include: { avatar: true },
                },
              },
            },
          },
        },
      },
      orderBy: {
        chat: {
          updatedAt: 'desc',
        },
      },
    });

    const conversations = await Promise.all(
      chatMemberships.map(async (membership) => {
        const chat = membership.chat;
        const otherMember = chat.chatMembers[0]?.user;
        const lastMessage = chat.messages[0];

        let userAvatarUrl: string | null = null;
        if (otherMember?.avatar) {
          userAvatarUrl = await this.storageService.getPresignedUrl(
            otherMember.avatar.bucket,
            otherMember.avatar.key,
            60 * 60,
          );
        }

        // Count unread messages (messages not sent by current user and not read by current user)
        const unreadCount = await this.prisma.message.count({
          where: {
            chatId: chat.id,
            senderId: { not: userId },
            reads: {
              none: {
                userId: userId,
              },
            },
          },
        });

        return {
          id: String(chat.id),
          userId: String(otherMember?.id || ''),
          userName: otherMember
            ? `${otherMember.firstName} ${otherMember.lastName || ''}`.trim()
            : chat.name,
          userAvatar: userAvatarUrl,
          lastMessage: lastMessage?.content || '',
          lastMessageTime: lastMessage?.createdAt || chat.updatedAt,
          unreadCount,
          isOnline: false, // TODO: Implement online status
        };
      }),
    );

    return conversations;
  }

  async getOrCreateChat(userId: number, otherUserId: number) {
    // Check if chat already exists between these two users
    const existingChats = await this.prisma.chat.findMany({
      where: {
        type: 'direct',
        chatMembers: {
          some: {
            userId,
          },
        },
      },
      include: {
        chatMembers: true,
      },
    });

    // Find chat that has both users as members
    const existingChat = existingChats.find((chat) => {
      const memberIds = chat.chatMembers.map((m) => m.userId);
      return memberIds.includes(userId) && memberIds.includes(otherUserId);
    });

    if (existingChat) {
      return existingChat.id;
    }

    // Create new chat
    const otherUser = await this.prisma.user.findUnique({
      where: { id: otherUserId },
    });

    if (!otherUser) {
      throw new NotFoundException('User not found');
    }

    const chatName = `${otherUser.firstName} ${otherUser.lastName || ''}`.trim();

    const newChat = await this.prisma.chat.create({
      data: {
        type: 'direct',
        name: chatName,
        chatMembers: {
          create: [
            { userId, role: 'member' },
            { userId: otherUserId, role: 'member' },
          ],
        },
      },
    });

    return newChat.id;
  }

  async getMessages(chatId: number, userId: number) {
    // Verify user is a member of this chat
    const membership = await this.prisma.chatMember.findFirst({
      where: {
        chatId,
        userId,
      },
    });

    if (!membership) {
      throw new NotFoundException('Chat not found or access denied');
    }

    const messages = await this.prisma.message.findMany({
      where: { chatId },
      include: {
        sender: {
          include: { avatar: true },
        },
        reads: {
          where: { userId },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const formattedMessages = await Promise.all(
      messages.map(async (message) => {
        let senderAvatarUrl: string | null = null;
        if (message.sender.avatar) {
          senderAvatarUrl = await this.storageService.getPresignedUrl(
            message.sender.avatar.bucket,
            message.sender.avatar.key,
            60 * 60,
          );
        }

        // Check if message is read by current user
        const isRead = message.senderId === userId || message.reads.some((read) => read.userId === userId);

        return {
          id: String(message.id),
          chatId: String(message.chatId),
          text: message.content,
          senderId: String(message.senderId),
          senderName: `${message.sender.firstName} ${message.sender.lastName || ''}`.trim(),
          senderAvatar: senderAvatarUrl,
          timestamp: message.createdAt,
          isRead,
        };
      }),
    );

    return formattedMessages;
  }

  async sendMessage(chatId: number, userId: number, content: string) {
    // Verify user is a member of this chat
    const membership = await this.prisma.chatMember.findFirst({
      where: {
        chatId,
        userId,
      },
    });

    if (!membership) {
      throw new NotFoundException('Chat not found or access denied');
    }

    const message = await this.prisma.message.create({
      data: {
        chatId,
        senderId: userId,
        content,
      },
      include: {
        sender: {
          include: { avatar: true },
        },
      },
    });

    // Update chat updatedAt
    await this.prisma.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date() },
    });

    let senderAvatarUrl: string | null = null;
    if (message.sender.avatar) {
      senderAvatarUrl = await this.storageService.getPresignedUrl(
        message.sender.avatar.bucket,
        message.sender.avatar.key,
        60 * 60,
      );
    }

    // For newly sent messages, they are not read yet by the recipient
    // The status will be updated via WebSocket when recipient reads them
    return {
      id: String(message.id),
      chatId: String(message.chatId),
      text: message.content,
      senderId: String(message.senderId),
      senderName: `${message.sender.firstName} ${message.sender.lastName || ''}`.trim(),
      senderAvatar: senderAvatarUrl,
      timestamp: message.createdAt,
      isRead: false, // New message is not read yet by recipient
    };
  }

  async markMessagesAsRead(chatId: number, userId: number) {
    // Verify user is a member of this chat
    const membership = await this.prisma.chatMember.findFirst({
      where: {
        chatId,
        userId,
      },
    });

    if (!membership) {
      throw new NotFoundException('Chat not found or access denied');
    }

    // Find all unread messages in this chat (not sent by current user)
    const unreadMessages = await this.prisma.message.findMany({
      where: {
        chatId,
        senderId: { not: userId },
        reads: {
          none: {
            userId: userId,
          },
        },
      },
      select: { id: true, senderId: true },
    });

    if (unreadMessages.length === 0) {
      return { count: 0, messageIds: [] };
    }

    // Mark all unread messages as read
    await this.prisma.messageRead.createMany({
      data: unreadMessages.map((msg) => ({
        messageId: msg.id,
        userId,
      })),
      skipDuplicates: true,
    });

    // Return message IDs that were marked as read (for WebSocket notification)
    const messageIds = unreadMessages.map((msg) => msg.id);

    return { count: unreadMessages.length, messageIds };
  }
}

