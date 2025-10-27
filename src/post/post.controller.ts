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
import type { Request } from 'express';
import { PostService } from './post.service';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { CreateDto } from './dto/createDto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { UpdatePostDto } from './dto/updateDto';
import { StorageService } from 'src/storage/storage.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Controller('post')
export class PostController {
  constructor(
    private readonly postService: PostService,
    private readonly storageService: StorageService,
    private readonly prismaService: PrismaService,
  ) {}

  @UseGuards(AuthGuard)
  @Get('posts')
  async getPosts(@Req() req: Request, @Query('id') userId?: number) {
    return this.postService.getPosts(req, userId);
  }

  @UseGuards(AuthGuard)
  @Delete('delete')
  async delete(@Req() req: Request, @Body('id') postid: number) {
    return this.postService.deletePost(req, postid);
  }

  @UseGuards(AuthGuard)
  @Patch('update/:id')
  @UseInterceptors(FilesInterceptor('files')) // если используешь Multer для нескольких файлов
  async update(
    @Req() req: Request,
    @Param('id') postId: string,
    @Body() dto: UpdatePostDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    // Просто вызываем сервис и возвращаем результат
    return this.postService.updatePost(req, Number(postId), dto, files);
  }

  @UseGuards(AuthGuard)
  @Post('create')
  @UseInterceptors(FilesInterceptor('files'))
  async create(
    @Req() req: Request,
    @Body() dto: CreateDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (req.body.isPublished !== undefined) {
      dto.isPublished = req.body.isPublished === 'true';
    }

    return this.postService.createPost(req.user, dto, files);
  }
}
