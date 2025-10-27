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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { StorageService } from 'src/storage/storage.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { CommentService } from './comment.service';
import type { Request } from 'express';

@Controller('post')
export class PostController {
  constructor(
    private readonly commentService: CommentService,
    private readonly storageService: StorageService,
    private readonly prismaService: PrismaService,
  ) {}

  @UseGuards(AuthGuard)
  @Post('create')
  async createComment(
    @Req() req: Request,
    @Body('postId') postId: number,
    @Body('content') content: string,
  ) {
    return this.commentService.createComment(req, postId, content);
  }

  @UseGuards(AuthGuard)
  @Patch('edit')
  async editComment(
    @Req() req: Request,
    @Body('commentId') commentId: number,
    @Body('content') content: string,
  ) {
    return this.commentService.editComment(req, commentId, content);
  }

  @UseGuards(AuthGuard)
  @Delete('delete')
  async deleteComment(
    @Req() req: Request,
    @Body('commentId') commentId: number,
  ) {
    return this.commentService.deleteComment(req, commentId);
  }

  @UseGuards(AuthGuard)
  @Post('like')
  async likeComment(
    @Req() req: Request,
    @Body('postId') postId: number,
    @Body('commentId') commentId: number,
  ) {
    return this.commentService.likeComment(req, commentId, postId);
  }
}
