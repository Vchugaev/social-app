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
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { CommentService } from './comment.service';
import type { Request } from 'express';

@Controller('post')
export class CommentController {
  constructor(private readonly commentService: CommentService) {}

  @UseGuards(AuthGuard)
  @Get(':postId/comments')
  async getComments(
    @Req() req: Request,
    @Param('postId', ParseIntPipe) postId: number,
  ) {
    return this.commentService.getComments(req, postId);
  }

  @UseGuards(AuthGuard)
  @Post(':postId/comments')
  @HttpCode(HttpStatus.CREATED)
  async createComment(
    @Req() req: Request,
    @Param('postId', ParseIntPipe) postId: number,
    @Body('content') content: string,
  ) {
    return this.commentService.createComment(req, postId, content);
  }

  @UseGuards(AuthGuard)
  @Patch('comments/:commentId')
  async editComment(
    @Req() req: Request,
    @Param('commentId', ParseIntPipe) commentId: number,
    @Body('content') content: string,
  ) {
    return this.commentService.editComment(req, commentId, content);
  }

  @UseGuards(AuthGuard)
  @Delete('comments/:commentId')
  @HttpCode(HttpStatus.OK)
  async deleteComment(
    @Req() req: Request,
    @Param('commentId', ParseIntPipe) commentId: number,
  ) {
    return this.commentService.deleteComment(req, commentId);
  }

  @UseGuards(AuthGuard)
  @Post('comments/:commentId/like')
  @HttpCode(HttpStatus.OK)
  async likeComment(
    @Req() req: Request,
    @Param('commentId', ParseIntPipe) commentId: number,
  ) {
    return this.commentService.likeComment(req, commentId);
  }
}
