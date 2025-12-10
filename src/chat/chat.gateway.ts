import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import { ChatService } from './chat.service';
import { StorageService } from 'src/storage/storage.service';

interface AuthenticatedSocket extends Socket {
  userId?: number;
}

@WebSocketGateway({
  cors: {
    origin: 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private connectedUsers = new Map<number, Set<string>>(); // userId -> Set of socketIds

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private chatService: ChatService,
    private storageService: StorageService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      // Получаем токен из cookies
      const cookies = client.handshake.headers.cookie;
      let token: string | undefined;

      if (cookies) {
        const tokenMatch = cookies.match(/token=([^;]+)/);
        token = tokenMatch ? tokenMatch[1] : undefined;
      }

      if (!token) {
        this.logger.warn(
          `WebSocket connection rejected: No token found for socket ${client.id}`,
        );
        client.disconnect();
        return;
      }

      // Верифицируем JWT токен
      try {
        const payload = this.jwtService.verify(token);
        const userId = payload.userId;

        if (!userId) {
          throw new UnauthorizedException('Invalid token payload');
        }

        // Проверяем существование пользователя
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
        });

        if (!user) {
          throw new UnauthorizedException('User not found');
        }

        // Сохраняем userId в socket
        client.userId = userId;

        // Добавляем пользователя в список подключенных
        if (!this.connectedUsers.has(userId)) {
          this.connectedUsers.set(userId, new Set());
        }
        this.connectedUsers.get(userId)!.add(client.id);

        // Присоединяем к комнате пользователя
        await client.join(`user:${userId}`);

        this.logger.log(
          `WebSocket connected: User ${userId} (socket ${client.id})`,
        );

        // Отправляем новому клиенту список всех онлайн пользователей
        const onlineUserIds = Array.from(this.connectedUsers.keys());
        client.emit('users:online', { userIds: onlineUserIds });

        // Уведомляем других пользователей о том, что пользователь онлайн
        this.server.emit('user:online', { userId });
      } catch (error) {
        this.logger.warn(
          `WebSocket connection rejected: Token verification failed for socket ${client.id}: ${error.message}`,
        );
        client.disconnect();
      }
    } catch (error) {
      this.logger.error(
        `WebSocket connection error for socket ${client.id}: ${error.message}`,
      );
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    if (client.userId) {
      const userSockets = this.connectedUsers.get(client.userId);
      if (userSockets) {
        userSockets.delete(client.id);
        if (userSockets.size === 0) {
          this.connectedUsers.delete(client.userId);
          // Уведомляем других пользователей о том, что пользователь офлайн
          this.server.emit('user:offline', { userId: client.userId });
        }
      }

      this.logger.log(
        `WebSocket disconnected: User ${client.userId} (socket ${client.id})`,
      );
    }
  }

  @SubscribeMessage('message:send')
  async handleMessage(
    @MessageBody() data: { chatId: number; content: string },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.userId) {
      throw new UnauthorizedException('Not authenticated');
    }

    try {
      // Отправляем сообщение через сервис
      const message = await this.chatService.sendMessage(
        data.chatId,
        client.userId,
        data.content,
      );

      // Получаем участников чата для отправки сообщения
      const chatMembers = await this.prisma.chatMember.findMany({
        where: { chatId: data.chatId },
        select: { userId: true },
      });

      // Добавляем chatId в сообщение для фильтрации на фронтенде
      const messageWithChatId = {
        ...message,
        chatId: String(data.chatId),
      };

      // Отправляем сообщение всем участникам чата (включая отправителя)
      const chatRoom = `chat:${data.chatId}`;
      this.server.to(chatRoom).emit('message:new', messageWithChatId);

      // Также отправляем обновление списка диалогов каждому участнику
      for (const member of chatMembers) {
        this.server.to(`user:${member.userId}`).emit('conversation:updated', {
          chatId: data.chatId,
        });
      }

      return { success: true, message };
    } catch (error) {
      this.logger.error(
        `Error sending message: ${error.message}`,
        error.stack,
      );
      client.emit('message:error', { error: error.message });
      throw error;
    }
  }

  @SubscribeMessage('chat:join')
  async handleJoinChat(
    @MessageBody() data: { chatId: number },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.userId) {
      throw new UnauthorizedException('Not authenticated');
    }

    try {
      // Проверяем, является ли пользователь участником чата
      const membership = await this.prisma.chatMember.findFirst({
        where: {
          chatId: data.chatId,
          userId: client.userId,
        },
      });

      if (!membership) {
        throw new UnauthorizedException('Not a member of this chat');
      }

      // Присоединяем к комнате чата
      await client.join(`chat:${data.chatId}`);
      this.logger.log(
        `User ${client.userId} joined chat ${data.chatId} (socket ${client.id})`,
      );

      return { success: true, chatId: data.chatId };
    } catch (error) {
      this.logger.error(
        `Error joining chat: ${error.message}`,
        error.stack,
      );
      client.emit('chat:error', { error: error.message });
      throw error;
    }
  }

  @SubscribeMessage('chat:leave')
  async handleLeaveChat(
    @MessageBody() data: { chatId: number },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.userId) {
      throw new UnauthorizedException('Not authenticated');
    }

    await client.leave(`chat:${data.chatId}`);
    this.logger.log(
      `User ${client.userId} left chat ${data.chatId} (socket ${client.id})`,
    );

    return { success: true, chatId: data.chatId };
  }

  @SubscribeMessage('messages:read')
  async handleMarkAsRead(
    @MessageBody() data: { chatId: number },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.userId) {
      throw new UnauthorizedException('Not authenticated');
    }

    try {
      const result = await this.chatService.markMessagesAsRead(
        data.chatId,
        client.userId,
      );

      // Получаем участников чата
      const chatMembers = await this.prisma.chatMember.findMany({
        where: { chatId: data.chatId },
        select: { userId: true },
      });

      // Отправляем событие о прочитанных сообщениях отправителям
      for (const member of chatMembers) {
        if (member.userId !== client.userId) {
          this.server.to(`user:${member.userId}`).emit('messages:read', {
            chatId: data.chatId,
            messageIds: result.messageIds,
            readBy: client.userId,
          });
        }
      }

      // Также отправляем обновление списка диалогов
      for (const member of chatMembers) {
        this.server.to(`user:${member.userId}`).emit('conversation:updated', {
          chatId: data.chatId,
        });
      }

      return { success: true, count: result.count };
    } catch (error) {
      this.logger.error(
        `Error marking messages as read: ${error.message}`,
        error.stack,
      );
      client.emit('messages:read:error', { error: error.message });
      throw error;
    }
  }

  // Метод для проверки онлайн статуса пользователя
  isUserOnline(userId: number): boolean {
    return this.connectedUsers.has(userId) && this.connectedUsers.get(userId)!.size > 0;
  }
}

