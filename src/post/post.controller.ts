import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Logger,
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
  private readonly logger = new Logger(PostController.name);

  constructor(
    private readonly postService: PostService,
    private readonly storageService: StorageService,
    private readonly prismaService: PrismaService,
  ) {}

  @UseGuards(AuthGuard)
  @Get('posts')
  async getPosts(@Req() req: Request, @Query('id') userId?: string) {
    // Convert string query param to number
    let userIdNum: number | undefined;
    if (userId) {
      const parsed = parseInt(userId, 10);
      if (isNaN(parsed)) {
        throw new Error(`Invalid userId: ${userId}`);
      }
      userIdNum = parsed;
    }
    return this.postService.getPosts(req, userIdNum);
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
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    const userId = (req as any).user?.id;
    this.logger.log(
      `Create post request from user id=${userId}, files count=${files?.length || 0}`,
    );

    try {
      // Валидация входных данных
      if (!dto.content || dto.content.trim().length === 0) {
        throw new BadRequestException('Post content cannot be empty');
      }

      if (dto.content.length > 5000) {
        throw new BadRequestException(
          'Post content is too long. Maximum length is 5000 characters',
        );
      }

      if (req.body.isPublished !== undefined) {
        dto.isPublished = req.body.isPublished === 'true';
      }

      // Валидация файлов
      if (files && files.length > 0) {
        // Проверяем количество файлов
        const maxFiles = 10;
        if (files.length > maxFiles) {
          throw new BadRequestException(
            `Too many files. Maximum ${maxFiles} files allowed`,
          );
        }

        // Проверяем типы файлов
        const allowedMimeTypes = [
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/gif',
          'image/webp',
          'video/mp4',
          'video/webm',
        ];

        for (const file of files) {
          if (!allowedMimeTypes.includes(file.mimetype)) {
            throw new BadRequestException(
              `File type "${file.mimetype}" is not allowed. Allowed types: ${allowedMimeTypes.join(', ')}`,
            );
          }
        }
      }

      const post = await this.postService.createPost(req.user, dto, files);

      this.logger.log(
        `Post created successfully: id=${post.id}, user id=${userId}`,
      );

      return post;
    } catch (error) {
      this.logger.error(
        `Failed to create post for user id=${userId}: ${error.message}`,
      );

      // Если это уже HTTP исключение, пробрасываем его дальше
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      // Иначе оборачиваем в InternalServerErrorException
      throw new InternalServerErrorException(
        `Failed to create post: ${error.message}`,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Post(':id/like')
  @HttpCode(HttpStatus.OK)
  async toggleLike(
    @Req() req: Request,
    @Param('id', ParseIntPipe) postId: number,
  ) {
    return this.postService.toggleLike(req, postId);
  }
}
