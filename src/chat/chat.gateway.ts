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
import { Logger, UnauthorizedException, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import { ChatService } from './chat.service';
import { StorageService } from 'src/storage/storage.service';

interface AuthenticatedSocket extends Socket {
  userId?: number;
  pingTimeout?: NodeJS.Timeout;
}

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private connectedUsers = new Map<number, Set<string>>(); // userId -> Set of socketIds
  private userLastSeen = new Map<number, number>(); // userId -> timestamp
  private heartbeatIntervals = new Map<string, NodeJS.Timeout>(); // socketId -> interval

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

      this.logger.debug(`WebSocket connection attempt. Socket ID: ${client.id}`);

      if (cookies) {
        // Ищем токен в формате "token=value;" или "token=value" (в конце строки)
        const tokenMatches = cookies.match(/(?:^|;\s*)token=([^;]+)/);
        if (tokenMatches && tokenMatches[1]) {
          token = decodeURIComponent(tokenMatches[1]);
        }
        
        // Если первый способ не сработал, попробуем другой формат
        if (!token) {
          const tokenMatches2 = cookies.match(/token=([^;\s]+)/);
          if (tokenMatches2 && tokenMatches2[1]) {
            token = decodeURIComponent(tokenMatches2[1]);
          }
        }
        
        // Если все еще нет токена, попробуем найти его в другом формате
        if (!token) {
          const tokenMatches3 = cookies.match(/token=([^\s]+)/);
          if (tokenMatches3 && tokenMatches3[1]) {
            token = decodeURIComponent(tokenMatches3[1]);
          }
        }
      }

      if (!token) {
        this.logger.warn(
          `WebSocket connection rejected: No token found for socket ${client.id}`,
        );
        client.disconnect();
        return;
      }

      // Проверяем, что токен не пустой и имеет правильный формат
      if (!token || token.trim().length === 0) {
        this.logger.warn(
          `WebSocket connection rejected: Empty token for socket ${client.id}`,
        );
        client.disconnect();
        return;
      }

      // Проверяем базовую структуру JWT токена
      const tokenParts = token.split('.');
      if (tokenParts.length !== 3) {
        this.logger.warn(
          `WebSocket connection rejected: Malformed JWT token for socket ${client.id}`,
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
        
        const userSockets = this.connectedUsers.get(userId)!;
        userSockets.add(client.id);

        // Обновляем время последнего активности
        this.userLastSeen.set(userId, Date.now());

        // Присоединяем к комнате пользователя
        await client.join(`user:${userId}`);

        this.logger.log(
          `WebSocket connected: User ${userId} (socket ${client.id}), total sockets: ${userSockets.size}`,
        );

        // Настройка heartbeat для проверки соединения
        this.setupHeartbeat(client);
      } catch (error) {
        this.logger.warn(
          `WebSocket connection rejected: Token verification failed for socket ${client.id}: ${error.message}`,
        );
        client.disconnect();
      }
    } catch (error) {
      this.logger.error(
        `WebSocket connection error for socket ${client.id}: ${error.message}`,
        error.stack,
      );
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    if (client.userId) {
      const userId = client.userId;
      const userSockets = this.connectedUsers.get(userId);
      
      if (userSockets) {
        userSockets.delete(client.id);
        
        if (userSockets.size === 0) {
          this.connectedUsers.delete(userId);
          this.userLastSeen.set(userId, Date.now());
          this.logger.log(`User ${userId} is now offline`);
        } else {
          this.logger.log(
            `WebSocket disconnected: User ${userId} (socket ${client.id}), remaining sockets: ${userSockets.size}`,
          );
        }
      }

      // Очищаем heartbeat таймер
      if (client.pingTimeout) {
        clearTimeout(client.pingTimeout);
      }

      // Очищаем heartbeat интервал
      const interval = this.heartbeatIntervals.get(client.id);
      if (interval) {
        clearInterval(interval);
        this.heartbeatIntervals.delete(client.id);
      }
    }
  }

  // Heartbeat mechanism to detect disconnections
  private setupHeartbeat(client: AuthenticatedSocket) {
    const heartbeatInterval = 30000; // 30 seconds
    const heartbeatTimeout = 15000; // 15 seconds timeout
    
    const ping = () => {
      if (client.disconnected) {
        this.cleanupHeartbeat(client);
        return;
      }
      
      client.pingTimeout = setTimeout(() => {
        this.logger.warn(`WebSocket heartbeat timeout for socket ${client.id}, user ${client.userId}`);
        this.cleanupHeartbeat(client);
        client.disconnect();
      }, heartbeatTimeout);
      
      client.emit('ping');
    };

    // Первый ping сразу после подключения
    ping();
    
    const interval = setInterval(ping, heartbeatInterval);
    this.heartbeatIntervals.set(client.id, interval);
    
    client.on('pong', () => {
      if (client.pingTimeout) {
        clearTimeout(client.pingTimeout);
        client.pingTimeout = undefined;
      }
    });

    client.on('disconnect', () => {
      this.cleanupHeartbeat(client);
    });
  }

  private cleanupHeartbeat(client: AuthenticatedSocket) {
    const interval = this.heartbeatIntervals.get(client.id);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(client.id);
    }
    if (client.pingTimeout) {
      clearTimeout(client.pingTimeout);
      client.pingTimeout = undefined;
    }
  }

  @SubscribeMessage('pong')
  handlePong(@ConnectedSocket() client: AuthenticatedSocket) {
    // Просто получаем pong от клиента, heartbeat таймер очищается автоматически
  }

  @SubscribeMessage('message:send')
  async handleMessage(
    @MessageBody() data: { chatId: number; content: string; replyToId?: number; fileData?: { buffer: string; filename: string; mimetype: string } },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.userId) {
      throw new UnauthorizedException('Not authenticated');
    }

    try {
      this.logger.log(`User ${client.userId} sending message to chat ${data.chatId}`);
      
      // Если есть файл, конвертируем base64 обратно в Buffer
      let fileBuffer: Buffer | undefined;
      let file: Express.Multer.File | undefined;
      
      if (data.fileData) {
        fileBuffer = Buffer.from(data.fileData.buffer, 'base64');
        file = {
          buffer: fileBuffer,
          originalname: data.fileData.filename,
          mimetype: data.fileData.mimetype,
        } as Express.Multer.File;
      }
      
      // Отправляем сообщение через сервис
      const message = await this.chatService.sendMessage(
        data.chatId,
        client.userId,
        data.content,
        file,
        data.replyToId,
      );

      this.logger.log(`Message created: ${JSON.stringify(message)}`);

      // Получаем участников чата для отправки сообщения
      const chatMembers = await this.prisma.chatMember.findMany({
        where: { chatId: data.chatId },
        select: { userId: true },
      });

      this.logger.log(`Chat members: ${JSON.stringify(chatMembers.map(m => m.userId))}`);

      // Добавляем chatId в сообщение для фильтрации на фронтенде
      const messageWithChatId = {
        ...message,
        chatId: String(data.chatId),
      };

      this.logger.log(`Emitting message:new to chat:${data.chatId} room`);
      
      // Отправляем сообщение всем участникам чата (включая отправителя)
      const chatRoom = `chat:${data.chatId}`;
      this.server.to(chatRoom).emit('message:new', messageWithChatId);

      // Также отправляем сообщение напрямую каждому участнику через их персональную комнату
      // Это нужно для показа toast-уведомлений, даже если чат не открыт
      for (const member of chatMembers) {
        this.logger.log(`Emitting message:new to user:${member.userId}`);
        this.server.to(`user:${member.userId}`).emit('message:new', messageWithChatId);
        
        this.logger.log(`Emitting conversation:updated to user:${member.userId}`);
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

  @SubscribeMessage('group:update')
  async handleGroupUpdate(
    @MessageBody() data: { chatId: number; type: string; data: any },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.userId) {
      throw new UnauthorizedException('Not authenticated');
    }

    try {
      // Получаем участников чата
      const chatMembers = await this.prisma.chatMember.findMany({
        where: { chatId: data.chatId },
        select: { userId: true },
      });

      // Отправляем событие обновления группы всем участникам
      for (const member of chatMembers) {
        this.server.to(`user:${member.userId}`).emit('group:updated', {
          chatId: data.chatId,
          type: data.type,
          data: data.data,
          updatedBy: client.userId,
        });
      }

      return { success: true };
    } catch (error) {
      this.logger.error(
        `Error handling group update: ${error.message}`,
        error.stack,
      );
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

  @SubscribeMessage('typing:start')
  async handleTypingStart(
    @MessageBody() data: { chatId: number },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.userId) {
      throw new UnauthorizedException('Not authenticated');
    }

    try {
      // Получаем информацию о пользователе
      const user = await this.prisma.user.findUnique({
        where: { id: client.userId },
        select: { firstName: true, lastName: true },
      });

      if (!user) {
        this.logger.warn(`User ${client.userId} not found for typing event`);
        return { success: false };
      }

      const userName = `${user.firstName} ${user.lastName || ''}`.trim();
      
      this.logger.log(`User ${client.userId} (${userName}) started typing in chat ${data.chatId}`);

      // Получаем участников чата
      const chatMembers = await this.prisma.chatMember.findMany({
        where: { chatId: data.chatId },
        select: { userId: true },
      });

      // Отправляем событие typing другим участникам чата через их персональные комнаты
      for (const member of chatMembers) {
        if (member.userId !== client.userId) {
          this.server.to(`user:${member.userId}`).emit('typing:start', {
            chatId: data.chatId,
            userId: client.userId,
            userName: userName,
          });
          this.logger.log(`Sent typing:start to user ${member.userId}: ${JSON.stringify({ chatId: data.chatId, userId: client.userId, userName })}`);
        }
      }

      return { success: true };
    } catch (error) {
      this.logger.error(
        `Error handling typing start: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  @SubscribeMessage('typing:stop')
  async handleTypingStop(
    @MessageBody() data: { chatId: number },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.userId) {
      throw new UnauthorizedException('Not authenticated');
    }

    try {
      // Получаем участников чата
      const chatMembers = await this.prisma.chatMember.findMany({
        where: { chatId: data.chatId },
        select: { userId: true },
      });

      // Отправляем событие typing другим участникам чата через их персональные комнаты
      for (const member of chatMembers) {
        if (member.userId !== client.userId) {
          this.server.to(`user:${member.userId}`).emit('typing:stop', {
            chatId: data.chatId,
            userId: client.userId,
          });
        }
      }

      return { success: true };
    } catch (error) {
      this.logger.error(
        `Error handling typing stop: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  // Метод для проверки онлайн статуса пользователя
  isUserOnline(userId: number): boolean {
    return this.connectedUsers.has(userId) && this.connectedUsers.get(userId)!.size > 0;
  }

  // Метод для получения времени последней активности пользователя
  getUserLastSeen(userId: number): number | null {
    return this.userLastSeen.get(userId) || null;
  }

  // Метод для отправки уведомлений пользователю
  sendNotificationToUser(userId: number, notification: any) {
    this.server.to(`user:${userId}`).emit('notification', notification);
    this.logger.log(`Notification sent to user ${userId}: ${notification.type}`);
  }

  // Очистка всех таймаутов при завершении работы
  onModuleDestroy() {
    // Очищаем все heartbeat интервалы
    this.heartbeatIntervals.forEach((interval) => {
      clearInterval(interval);
    });
    this.heartbeatIntervals.clear();

    this.logger.log('ChatGateway cleanup completed');
  }
}