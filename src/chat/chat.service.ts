import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/storage/storage.service';
import { CreateGroupChatDto } from './dto/create-group-chat.dto';
import { UpdateGroupChatDto } from './dto/update-group-chat.dto';
import { ChatRole } from './dto/manage-members.dto';

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
              include: {
                user: {
                  include: { avatar: true },
                },
              },
            },
            avatar: true,
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
        const lastMessage = chat.messages[0];
        const isGroupChat = chat.type === 'group';

        let chatAvatar: string | null = null;
        let chatName = chat.name;
        let otherUserId: string | null = null;
        let otherUsername: string | null = null;

        if (isGroupChat) {
          // Для группового чата используем аватарку чата
          if (chat.avatar) {
            chatAvatar = await this.storageService.getPresignedUrl(
              chat.avatar.bucket,
              chat.avatar.key,
              60 * 60,
            );
          }
        } else {
          // Для личного чата находим другого участника
          const otherMember = chat.chatMembers.find(m => m.userId !== userId)?.user;
          if (otherMember) {
            otherUserId = String(otherMember.id);
            otherUsername = otherMember.username;
            chatName = `${otherMember.firstName} ${otherMember.lastName || ''}`.trim();
            
            if (otherMember.avatar) {
              chatAvatar = await this.storageService.getPresignedUrl(
                otherMember.avatar.bucket,
                otherMember.avatar.key,
                60 * 60,
              );
            }
          }
        }

        // Count unread messages
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
          type: chat.type,
          name: chatName,
          description: chat.description,
          avatar: chatAvatar,
          userId: otherUserId,
          username: otherUsername,
          lastMessage: lastMessage?.content || '',
          lastMessageTime: lastMessage?.createdAt || chat.updatedAt,
          unreadCount,
          isOnline: false,
          memberCount: chat.chatMembers.length,
          userRole: membership.role,
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

    // Check privacy settings before creating new chat
    const otherUserSettings = await this.prisma.userSettings.findUnique({
      where: { userId: otherUserId },
      select: { whoCanMessage: true },
    });

    if (otherUserSettings) {
      // Check if user can message based on privacy settings
      if (otherUserSettings.whoCanMessage === 'nobody') {
        throw new ForbiddenException('Этот пользователь не принимает личные сообщения');
      }

      if (otherUserSettings.whoCanMessage === 'friends') {
        // Check if users are friends
        const friendship = await this.prisma.friendShip.findFirst({
          where: {
            OR: [
              { user1Id: userId, user2Id: otherUserId, status: 'accepted' },
              { user1Id: otherUserId, user2Id: userId, status: 'accepted' },
            ],
          },
        });

        if (!friendship) {
          throw new ForbiddenException('Этот пользователь принимает сообщения только от друзей');
        }
      }
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

  async getMessages(chatId: number, userId: number, limit = 50, before?: number) {
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

    const whereClause: any = { chatId };
    
    // Если указан before, загружаем сообщения старше этого ID
    if (before) {
      whereClause.id = { lt: before };
    }

    const messages = await this.prisma.message.findMany({
      where: whereClause,
      include: {
        sender: {
          include: { avatar: true },
        },
        reads: {
          where: { userId },
        },
        file: true,
        replyTo: {
          include: {
            sender: true,
            file: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
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

        let fileUrl: string | null = null;
        let fileName: string | null = null;
        let fileType: string | null = null;
        
        if (message.file) {
          fileUrl = await this.storageService.getPresignedUrl(
            message.file.bucket,
            message.file.key,
            60 * 60,
          );
          fileName = message.file.key.split('/').pop() || message.file.key;
          fileType = message.file.type;
        }

        // Check if message is read by current user
        const isRead = message.senderId === userId || message.reads.some((read) => read.userId === userId);

        // Форматируем replyTo если есть
        let replyTo: {
          id: string;
          text: string;
          senderId: string;
          senderName: string;
          file?: {
            id: string;
            url: string | null;
            name: string | null;
            type: string | null;
          };
        } | null = null;
        if (message.replyTo) {
          let replyToFileUrl: string | null = null;
          let replyToFileName: string | null = null;
          let replyToFileType: string | null = null;
          
          if (message.replyTo.file) {
            replyToFileUrl = await this.storageService.getPresignedUrl(
              message.replyTo.file.bucket,
              message.replyTo.file.key,
              60 * 60,
            );
            replyToFileName = message.replyTo.file.key.split('/').pop() || message.replyTo.file.key;
            replyToFileType = message.replyTo.file.type;
          }

          replyTo = {
            id: String(message.replyTo.id),
            text: message.replyTo.content,
            senderId: String(message.replyTo.senderId),
            senderName: `${message.replyTo.sender.firstName} ${message.replyTo.sender.lastName || ''}`.trim(),
            file: message.replyTo.file ? {
              id: String(message.replyTo.file.id),
              url: replyToFileUrl,
              name: replyToFileName,
              type: replyToFileType,
            } : undefined,
          };
        }

        return {
          id: String(message.id),
          chatId: String(message.chatId),
          text: message.content,
          senderId: String(message.senderId),
          senderName: `${message.sender.firstName} ${message.sender.lastName || ''}`.trim(),
          senderAvatar: senderAvatarUrl,
          timestamp: message.createdAt,
          isRead,
          replyTo,
          file: message.file ? {
            id: String(message.file.id),
            url: fileUrl,
            name: fileName,
            type: fileType,
          } : undefined,
        };
      }),
    );

    // Возвращаем в обратном порядке (от старых к новым)
    return formattedMessages.reverse();
  }

  async sendMessage(chatId: number, userId: number, content: string, file?: Express.Multer.File, replyToId?: number) {
    // Проверяем максимальную длину сообщения
    if (content && content.length > 10000) {
      throw new BadRequestException('Message exceeds maximum length of 10,000 characters');
    }
    
    // Проверяем что есть хотя бы текст или файл
    if (!content?.trim() && !file) {
      throw new BadRequestException('Message must contain text or file');
    }

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

    // Check privacy settings for direct chats
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        chatMembers: true,
      },
    });

    if (chat && chat.type === 'direct') {
      // Find the other user in the chat
      const otherMember = chat.chatMembers.find(m => m.userId !== userId);
      
      if (otherMember) {
        const otherUserSettings = await this.prisma.userSettings.findUnique({
          where: { userId: otherMember.userId },
          select: { whoCanMessage: true },
        });

        if (otherUserSettings) {
          if (otherUserSettings.whoCanMessage === 'nobody') {
            throw new ForbiddenException('Этот пользователь не принимает личные сообщения');
          }

          if (otherUserSettings.whoCanMessage === 'friends') {
            // Check if users are friends
            const friendship = await this.prisma.friendShip.findFirst({
              where: {
                OR: [
                  { user1Id: userId, user2Id: otherMember.userId, status: 'accepted' },
                  { user1Id: otherMember.userId, user2Id: userId, status: 'accepted' },
                ],
              },
            });

            if (!friendship) {
              throw new ForbiddenException('Этот пользователь принимает сообщения только от друзей');
            }
          }
        }
      }
    }

    // Если указан replyToId, проверяем что сообщение существует и принадлежит этому чату
    if (replyToId) {
      const replyToMessage = await this.prisma.message.findFirst({
        where: {
          id: replyToId,
          chatId,
        },
      });

      if (!replyToMessage) {
        throw new BadRequestException('Reply message not found or does not belong to this chat');
      }
    }

    let uploadedFile: { id: number } | null = null;
    
    // Загружаем файл если он есть
    if (file) {
      uploadedFile = await this.storageService.uploadFile(
        file.buffer,
        file.originalname,
        file.mimetype,
        userId,
      );
    }

    const message = await this.prisma.message.create({
      data: {
        chatId,
        senderId: userId,
        content: content || '',
        fileId: uploadedFile?.id,
        replyToId: replyToId || null,
      },
      include: {
        sender: {
          include: { avatar: true },
        },
        file: true,
        replyTo: {
          include: {
            sender: true,
            file: true,
          },
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

    let fileUrl: string | null = null;
    let fileName: string | null = null;
    let fileType: string | null = null;
    
    if (message.file) {
      fileUrl = await this.storageService.getPresignedUrl(
        message.file.bucket,
        message.file.key,
        60 * 60,
      );
      fileName = message.file.key.split('/').pop() || message.file.key;
      fileType = message.file.type;
    }

    // Форматируем replyTo если есть
    let replyTo: {
      id: string;
      text: string;
      senderId: string;
      senderName: string;
      file?: {
        id: string;
        url: string | null;
        name: string | null;
        type: string | null;
      };
    } | null = null;
    if (message.replyTo) {
      let replyToFileUrl: string | null = null;
      let replyToFileName: string | null = null;
      let replyToFileType: string | null = null;
      
      if (message.replyTo.file) {
        replyToFileUrl = await this.storageService.getPresignedUrl(
          message.replyTo.file.bucket,
          message.replyTo.file.key,
          60 * 60,
        );
        replyToFileName = message.replyTo.file.key.split('/').pop() || message.replyTo.file.key;
        replyToFileType = message.replyTo.file.type;
      }

      replyTo = {
        id: String(message.replyTo.id),
        text: message.replyTo.content,
        senderId: String(message.replyTo.senderId),
        senderName: `${message.replyTo.sender.firstName} ${message.replyTo.sender.lastName || ''}`.trim(),
        file: message.replyTo.file ? {
          id: String(message.replyTo.file.id),
          url: replyToFileUrl,
          name: replyToFileName,
          type: replyToFileType,
        } : undefined,
      };
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
      replyTo,
      file: message.file ? {
        id: String(message.file.id),
        url: fileUrl,
        name: fileName,
        type: fileType,
      } : undefined,
    };
  }

  async deleteMessage(messageId: number, userId: number) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        chat: {
          include: {
            chatMembers: {
              where: { userId },
            },
          },
        },
      },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    const membership = message.chat.chatMembers[0];
    if (!membership) {
      throw new NotFoundException('Chat not found or access denied');
    }

    // Проверяем права на удаление:
    // 1. Автор сообщения может удалить свое сообщение
    // 2. В групповых чатах модераторы и выше могут удалять любые сообщения
    const isAuthor = message.senderId === userId;
    const isGroupChat = message.chat.type === 'group';
    const canModerate = isGroupChat && (
      membership.role === ChatRole.OWNER ||
      membership.role === ChatRole.ADMIN ||
      membership.role === ChatRole.MODERATOR
    );

    if (!isAuthor && !canModerate) {
      throw new ForbiddenException('You do not have permission to delete this message');
    }

    // Сначала удаляем связанные записи MessageRead
    await this.prisma.messageRead.deleteMany({
      where: { messageId },
    });

    // Затем удаляем само сообщение
    await this.prisma.message.delete({
      where: { id: messageId },
    });

    return { success: true, messageId: String(messageId), chatId: String(message.chatId) };
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

  async createGroupChat(userId: number, dto: CreateGroupChatDto) {
    // Проверяем что все пользователи существуют
    const users = await this.prisma.user.findMany({
      where: { id: { in: dto.memberIds } },
    });

    if (users.length !== dto.memberIds.length) {
      throw new BadRequestException('Some users not found');
    }

    // Создаем групповой чат
    const chat = await this.prisma.chat.create({
      data: {
        type: 'group',
        name: dto.name,
        description: dto.description,
        createdById: userId,
        chatMembers: {
          create: [
            { userId, role: ChatRole.OWNER }, // Создатель получает роль OWNER
            ...dto.memberIds
              .filter(id => id !== userId)
              .map(id => ({ userId: id, role: ChatRole.MEMBER })),
          ],
        },
      },
      include: {
        chatMembers: {
          include: {
            user: {
              include: { avatar: true },
            },
          },
        },
        avatar: true,
      },
    });

    return this.formatChatDetails(chat, userId);
  }

  async getChatDetails(chatId: number, userId: number) {
    const membership = await this.prisma.chatMember.findFirst({
      where: { chatId, userId },
    });

    if (!membership) {
      throw new NotFoundException('Chat not found or access denied');
    }

    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        chatMembers: {
          include: {
            user: {
              include: { avatar: true },
            },
          },
        },
        avatar: true,
        creator: true,
      },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    return this.formatChatDetails(chat, userId);
  }

  async updateGroupChat(chatId: number, userId: number, dto: UpdateGroupChatDto) {
    await this.checkAdminOrOwnerPermission(chatId, userId);

    const chat = await this.prisma.chat.update({
      where: { id: chatId },
      data: {
        name: dto.name,
        description: dto.description,
      },
      include: {
        chatMembers: {
          include: {
            user: {
              include: { avatar: true },
            },
          },
        },
        avatar: true,
      },
    });

    return this.formatChatDetails(chat, userId);
  }

  async updateGroupChatAvatar(chatId: number, userId: number, file: Express.Multer.File) {
    await this.checkAdminOrOwnerPermission(chatId, userId);

    const uploadedFile = await this.storageService.uploadFile(
      file.buffer,
      file.originalname,
      file.mimetype,
      userId,
    );

    const chat = await this.prisma.chat.update({
      where: { id: chatId },
      data: { avatarId: uploadedFile.id },
      include: {
        chatMembers: {
          include: {
            user: {
              include: { avatar: true },
            },
          },
        },
        avatar: true,
      },
    });

    return this.formatChatDetails(chat, userId);
  }

  async addMembers(chatId: number, userId: number, userIds: number[]) {
    await this.checkAdminOrModeratorPermission(chatId, userId);

    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
    });

    if (!chat || chat.type !== 'group') {
      throw new BadRequestException('Only group chats can add members');
    }

    // Проверяем что пользователи существуют
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
    });

    if (users.length !== userIds.length) {
      throw new BadRequestException('Some users not found');
    }

    // Проверяем настройки приватности для каждого пользователя
    const usersWithSettings = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      include: {
        settings: true,
        friends1: {
          where: {
            user2Id: userId,
            status: 'accepted',
          },
        },
        friends2: {
          where: {
            user1Id: userId,
            status: 'accepted',
          },
        },
      },
    });

    const restrictedUsers: string[] = [];
    const allowedUserIds: number[] = [];

    for (const targetUser of usersWithSettings) {
      const whoCanAddToGroups = targetUser.settings?.whoCanAddToGroups || 'everyone';
      
      if (whoCanAddToGroups === 'nobody') {
        restrictedUsers.push(targetUser.username);
        continue;
      }

      if (whoCanAddToGroups === 'friends') {
        const isFriend = targetUser.friends1.length > 0 || targetUser.friends2.length > 0;
        if (!isFriend) {
          restrictedUsers.push(targetUser.username);
          continue;
        }
      }

      allowedUserIds.push(targetUser.id);
    }

    if (allowedUserIds.length === 0) {
      throw new BadRequestException(
        restrictedUsers.length > 0
          ? `Пользователи ограничили возможность добавления в группы: ${restrictedUsers.join(', ')}`
          : 'Невозможно добавить пользователей'
      );
    }

    // Проверяем что пользователи еще не в чате
    const existingMembers = await this.prisma.chatMember.findMany({
      where: {
        chatId,
        userId: { in: allowedUserIds },
      },
    });

    const newUserIds = allowedUserIds.filter(
      id => !existingMembers.some(m => m.userId === id),
    );

    if (newUserIds.length === 0) {
      throw new BadRequestException('All users are already members');
    }

    await this.prisma.chatMember.createMany({
      data: newUserIds.map(id => ({
        chatId,
        userId: id,
        role: ChatRole.MEMBER,
      })),
    });

    return { 
      success: true, 
      addedCount: newUserIds.length, 
      addedUserIds: newUserIds,
      restrictedUsers: restrictedUsers.length > 0 ? restrictedUsers : undefined,
    };
  }

  async removeMember(chatId: number, userId: number, targetUserId: number) {
    const userMembership = await this.prisma.chatMember.findFirst({
      where: { chatId, userId },
    });

    if (!userMembership) {
      throw new NotFoundException('Chat not found or access denied');
    }

    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
    });

    if (!chat || chat.type !== 'group') {
      throw new BadRequestException('Only group chats can remove members');
    }

    // Проверяем права: владелец/админ/модератор может удалять, или пользователь удаляет себя
    if (userId !== targetUserId) {
      await this.checkAdminOrModeratorPermission(chatId, userId);
    }

    const targetMembership = await this.prisma.chatMember.findFirst({
      where: { chatId, userId: targetUserId },
    });

    if (!targetMembership) {
      throw new NotFoundException('User is not a member of this chat');
    }

    // Нельзя удалить владельца
    if (targetMembership.role === ChatRole.OWNER) {
      throw new BadRequestException('Cannot remove the owner');
    }

    // Только владелец может удалять админов
    if (targetMembership.role === ChatRole.ADMIN && userId !== targetUserId) {
      await this.checkOwnerPermission(chatId, userId);
    }

    // Нельзя удалить последнего админа/владельца
    if (targetMembership.role === ChatRole.ADMIN || targetMembership.role === ChatRole.OWNER) {
      const adminCount = await this.prisma.chatMember.count({
        where: { 
          chatId, 
          role: { in: [ChatRole.ADMIN, ChatRole.OWNER] }
        },
      });

      if (adminCount <= 1) {
        throw new BadRequestException('Cannot remove the last admin');
      }
    }

    await this.prisma.chatMember.delete({
      where: { id: targetMembership.id },
    });

    return { success: true };
  }

  async updateMemberRole(chatId: number, userId: number, targetUserId: number, role: ChatRole) {
    await this.checkOwnerPermission(chatId, userId); // Только владелец может менять роли

    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
    });

    if (!chat || chat.type !== 'group') {
      throw new BadRequestException('Only group chats have roles');
    }

    const targetMembership = await this.prisma.chatMember.findFirst({
      where: { chatId, userId: targetUserId },
    });

    if (!targetMembership) {
      throw new NotFoundException('User is not a member of this chat');
    }

    // Нельзя изменить роль владельца
    if (targetMembership.role === ChatRole.OWNER) {
      throw new BadRequestException('Cannot change owner role');
    }

    // Нельзя назначить кого-то владельцем
    if (role === ChatRole.OWNER) {
      throw new BadRequestException('Cannot assign owner role');
    }

    // Нельзя понизить последнего админа (кроме владельца)
    if (targetMembership.role === ChatRole.ADMIN && role !== ChatRole.ADMIN) {
      const adminCount = await this.prisma.chatMember.count({
        where: { 
          chatId, 
          role: { in: [ChatRole.ADMIN, ChatRole.OWNER] }
        },
      });

      if (adminCount <= 1) {
        throw new BadRequestException('Cannot demote the last admin');
      }
    }

    await this.prisma.chatMember.update({
      where: { id: targetMembership.id },
      data: { role },
    });

    return { success: true };
  }

  async leaveGroupChat(chatId: number, userId: number) {
    return this.removeMember(chatId, userId, userId);
  }

  private async checkAdminPermission(chatId: number, userId: number) {
    const membership = await this.prisma.chatMember.findFirst({
      where: { chatId, userId },
    });

    if (!membership) {
      throw new NotFoundException('Chat not found or access denied');
    }

    if (membership.role !== ChatRole.ADMIN && membership.role !== ChatRole.OWNER) {
      throw new ForbiddenException('Only admins and owner can perform this action');
    }
  }

  private async checkOwnerPermission(chatId: number, userId: number) {
    const membership = await this.prisma.chatMember.findFirst({
      where: { chatId, userId },
    });

    if (!membership) {
      throw new NotFoundException('Chat not found or access denied');
    }

    if (membership.role !== ChatRole.OWNER) {
      throw new ForbiddenException('Only the owner can perform this action');
    }
  }

  private async checkAdminOrOwnerPermission(chatId: number, userId: number) {
    const membership = await this.prisma.chatMember.findFirst({
      where: { chatId, userId },
    });

    if (!membership) {
      throw new NotFoundException('Chat not found or access denied');
    }

    if (membership.role !== ChatRole.ADMIN && membership.role !== ChatRole.OWNER) {
      throw new ForbiddenException('Only admins and owner can perform this action');
    }
  }

  private async checkAdminOrModeratorPermission(chatId: number, userId: number) {
    const membership = await this.prisma.chatMember.findFirst({
      where: { chatId, userId },
    });

    if (!membership) {
      throw new NotFoundException('Chat not found or access denied');
    }

    if (membership.role !== ChatRole.ADMIN && membership.role !== ChatRole.MODERATOR && membership.role !== ChatRole.OWNER) {
      throw new ForbiddenException('Only admins, moderators and owner can perform this action');
    }
  }

  private async formatChatDetails(chat: any, userId: number) {
    let avatarUrl: string | null = null;
    if (chat.avatar) {
      avatarUrl = await this.storageService.getPresignedUrl(
        chat.avatar.bucket,
        chat.avatar.key,
        60 * 60,
      );
    }

    const members = await Promise.all(
      chat.chatMembers.map(async (member: any) => {
        let memberAvatarUrl: string | null = null;
        if (member.user.avatar) {
          memberAvatarUrl = await this.storageService.getPresignedUrl(
            member.user.avatar.bucket,
            member.user.avatar.key,
            60 * 60,
          );
        }

        return {
          id: String(member.user.id),
          username: member.user.username,
          firstName: member.user.firstName,
          lastName: member.user.lastName,
          avatar: memberAvatarUrl,
          role: member.role,
          joinedAt: member.joinedAt,
        };
      }),
    );

    const userMembership = chat.chatMembers.find((m: any) => m.userId === userId);

    return {
      id: String(chat.id),
      type: chat.type,
      name: chat.name,
      description: chat.description,
      avatar: avatarUrl,
      createdById: chat.createdById ? String(chat.createdById) : null,
      createdAt: chat.createdAt,
      members,
      userRole: userMembership?.role || ChatRole.MEMBER,
    };
  }

  async checkCanSendMessage(chatId: number, userId: number): Promise<{ canSend: boolean; reason?: string }> {
    // Verify user is a member of this chat
    const membership = await this.prisma.chatMember.findFirst({
      where: { chatId, userId },
    });

    if (!membership) {
      return { canSend: false, reason: 'Вы не являетесь участником этого чата' };
    }

    // Check if it's a direct chat
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        chatMembers: true,
      },
    });

    if (!chat) {
      return { canSend: false, reason: 'Чат не найден' };
    }

    // For group chats, always allow
    if (chat.type === 'group') {
      return { canSend: true };
    }

    // For direct chats, check privacy settings
    const otherMember = chat.chatMembers.find(m => m.userId !== userId);
    
    if (!otherMember) {
      return { canSend: false, reason: 'Собеседник не найден' };
    }

    const otherUserSettings = await this.prisma.userSettings.findUnique({
      where: { userId: otherMember.userId },
      select: { whoCanMessage: true },
    });

    if (!otherUserSettings) {
      // No settings means default (everyone can message)
      return { canSend: true };
    }

    if (otherUserSettings.whoCanMessage === 'nobody') {
      return { 
        canSend: false, 
        reason: 'Этот пользователь ограничил круг лиц, которые могут ему писать' 
      };
    }

    if (otherUserSettings.whoCanMessage === 'friends') {
      // Check if users are friends
      const friendship = await this.prisma.friendShip.findFirst({
        where: {
          OR: [
            { user1Id: userId, user2Id: otherMember.userId, status: 'accepted' },
            { user1Id: otherMember.userId, user2Id: userId, status: 'accepted' },
          ],
        },
      });

      if (!friendship) {
        return { 
          canSend: false, 
          reason: 'Этот пользователь принимает сообщения только от друзей' 
        };
      }
    }

    return { canSend: true };
  }
}

