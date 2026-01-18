import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateGroupChatDto } from './dto/create-group-chat.dto';
import { UpdateGroupChatDto } from './dto/update-group-chat.dto';
import { AddMembersDto, RemoveMemberDto, UpdateMemberRoleDto } from './dto/manage-members.dto';
import type { Request } from 'express';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway,
    private readonly prisma: PrismaService,
  ) {}

  @UseGuards(AuthGuard)
  @Get('conversations')
  async getConversations(@Req() req: Request) {
    const conversations = await this.chatService.getConversations(req.user.id);
    
    // Добавляем реальный онлайн статус для каждого диалога
    return conversations.map((conv) => ({
      ...conv,
      isOnline: this.chatGateway.isUserOnline(Number(conv.userId)),
    }));
  }

  @UseGuards(AuthGuard)
  @Get('users/online')
  async checkUsersOnline(@Query('userIds') userIds: string) {
    const ids = userIds.split(',').map(Number);
    const onlineStatus: Record<number, boolean> = {};
    
    ids.forEach((id) => {
      onlineStatus[id] = this.chatGateway.isUserOnline(id);
    });
    
    return onlineStatus;
  }

  @UseGuards(AuthGuard)
  @Post('conversations/:userId')
  @HttpCode(HttpStatus.OK)
  async getOrCreateChat(
    @Req() req: Request,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    const chatId = await this.chatService.getOrCreateChat(req.user.id, userId);
    return { chatId };
  }

  @UseGuards(AuthGuard)
  @Get(':chatId/messages')
  async getMessages(
    @Req() req: Request,
    @Param('chatId', ParseIntPipe) chatId: number,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const beforeNum = before ? parseInt(before, 10) : undefined;
    return this.chatService.getMessages(chatId, req.user.id, limitNum, beforeNum);
  }

  @UseGuards(AuthGuard)
  @Post(':chatId/messages')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async sendMessage(
    @Req() req: Request,
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() body: { content?: string; replyToId?: string },
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const replyToId = body.replyToId ? parseInt(body.replyToId, 10) : undefined;
    return this.chatService.sendMessage(chatId, req.user.id, body.content || '', file, replyToId);
  }

  @UseGuards(AuthGuard)
  @Post(':chatId/read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(
    @Req() req: Request,
    @Param('chatId', ParseIntPipe) chatId: number,
  ) {
    return this.chatService.markMessagesAsRead(chatId, req.user.id);
  }

  // Group chat endpoints
  @UseGuards(AuthGuard)
  @Post('groups')
  @HttpCode(HttpStatus.CREATED)
  async createGroupChat(@Req() req: Request, @Body() dto: CreateGroupChatDto) {
    return this.chatService.createGroupChat(req.user.id, dto);
  }

  @UseGuards(AuthGuard)
  @Get(':chatId/details')
  async getChatDetails(
    @Req() req: Request,
    @Param('chatId', ParseIntPipe) chatId: number,
  ) {
    return this.chatService.getChatDetails(chatId, req.user.id);
  }

  @UseGuards(AuthGuard)
  @Patch(':chatId')
  async updateGroupChat(
    @Req() req: Request,
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() dto: UpdateGroupChatDto,
  ) {
    return this.chatService.updateGroupChat(chatId, req.user.id, dto);
  }

  @UseGuards(AuthGuard)
  @Post(':chatId/avatar')
  @UseInterceptors(FileInterceptor('avatar'))
  async updateGroupChatAvatar(
    @Req() req: Request,
    @Param('chatId', ParseIntPipe) chatId: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Avatar file is required');
    }
    return this.chatService.updateGroupChatAvatar(chatId, req.user.id, file);
  }

  @UseGuards(AuthGuard)
  @Post(':chatId/members')
  async addMembers(
    @Req() req: Request,
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() dto: AddMembersDto,
  ) {
    const result = await this.chatService.addMembers(chatId, req.user.id, dto.userIds);
    
    // Отправляем WebSocket события новым участникам
    if (result.addedUserIds && result.addedUserIds.length > 0) {
      for (const userId of result.addedUserIds) {
        this.chatGateway.sendNotificationToUser(userId, {
          type: 'chat:added',
          chatId: chatId,
          message: 'Вы были добавлены в групповой чат',
        });
      }
      
      // Уведомляем всех участников о добавлении новых членов
      const chatMembers = await this.prisma.chatMember.findMany({
        where: { chatId },
        select: { userId: true },
      });
      
      for (const member of chatMembers) {
        this.chatGateway.sendNotificationToUser(member.userId, {
          type: 'chat:members-added',
          chatId: chatId,
          addedUserIds: result.addedUserIds,
        });
      }
    }
    
    return result;
  }

  @UseGuards(AuthGuard)
  @Delete(':chatId/members/:userId')
  async removeMember(
    @Req() req: Request,
    @Param('chatId', ParseIntPipe) chatId: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    const result = await this.chatService.removeMember(chatId, req.user.id, userId);
    
    // Уведомляем удаленного пользователя
    this.chatGateway.sendNotificationToUser(userId, {
      type: 'chat:removed',
      chatId: chatId,
    });
    
    // Уведомляем всех оставшихся участников об обновлении
    const chatMembers = await this.prisma.chatMember.findMany({
      where: { chatId },
      select: { userId: true },
    });
    
    for (const member of chatMembers) {
      this.chatGateway.sendNotificationToUser(member.userId, {
        type: 'chat:member-removed',
        chatId: chatId,
        removedUserId: userId,
      });
    }
    
    return result;
  }

  @UseGuards(AuthGuard)
  @Patch(':chatId/members/:userId/role')
  async updateMemberRole(
    @Req() req: Request,
    @Param('chatId', ParseIntPipe) chatId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.chatService.updateMemberRole(chatId, req.user.id, userId, dto.role);
  }

  @UseGuards(AuthGuard)
  @Post(':chatId/leave')
  @HttpCode(HttpStatus.OK)
  async leaveGroupChat(
    @Req() req: Request,
    @Param('chatId', ParseIntPipe) chatId: number,
  ) {
    const result = await this.chatService.leaveGroupChat(chatId, req.user.id);
    
    // Уведомляем всех оставшихся участников об обновлении
    const chatMembers = await this.prisma.chatMember.findMany({
      where: { chatId },
      select: { userId: true },
    });
    
    for (const member of chatMembers) {
      this.chatGateway.sendNotificationToUser(member.userId, {
        type: 'chat:member-removed',
        chatId: chatId,
        removedUserId: req.user.id,
      });
    }
    
    return result;
  }

  @UseGuards(AuthGuard)
  @Delete('messages/:messageId')
  async deleteMessage(
    @Req() req: Request,
    @Param('messageId', ParseIntPipe) messageId: number,
  ) {
    const result = await this.chatService.deleteMessage(messageId, req.user.id);
    
    // Отправляем WebSocket событие об удалении сообщения
    const chatMembers = await this.prisma.chatMember.findMany({
      where: { chatId: Number(result.chatId) },
      select: { userId: true },
    });
    
    for (const member of chatMembers) {
      this.chatGateway.sendNotificationToUser(member.userId, {
        type: 'message:deleted',
        messageId: result.messageId,
        chatId: result.chatId,
      });
    }
    
    return result;
  }

  @UseGuards(AuthGuard)
  @Get(':chatId/can-send')
  async checkCanSendMessage(
    @Req() req: Request,
    @Param('chatId', ParseIntPipe) chatId: number,
  ) {
    return this.chatService.checkCanSendMessage(chatId, req.user.id);
  }
}
