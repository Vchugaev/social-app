import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { ChatService } from './chat.service';
import type { Request } from 'express';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @UseGuards(AuthGuard)
  @Get('conversations')
  async getConversations(@Req() req: Request) {
    return this.chatService.getConversations(req.user.id);
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
  ) {
    return this.chatService.getMessages(chatId, req.user.id);
  }

  @UseGuards(AuthGuard)
  @Post(':chatId/messages')
  @HttpCode(HttpStatus.CREATED)
  async sendMessage(
    @Req() req: Request,
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body('content') content: string,
  ) {
    return this.chatService.sendMessage(chatId, req.user.id, content);
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
}

