import {
  Body,
  Controller,
  Get,
  Logger,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { UserService } from './user.service';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import { UpdateProfileDto } from './dto/update-profile-dto';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @UseGuards(AuthGuard)
  @Post('avatar')
  @UseInterceptors(FileInterceptor('file'))
  async updateAvatar(@Req() req, @UploadedFile() file: Express.Multer.File) {
    return this.userService.updateAvatar(req.user.id, file);
  }

  @UseGuards(AuthGuard)
  @Get('me')
  async getProfile(@Req() req) {
    Logger.log('Профиль поулчен');
    return this.userService.getProfile(req.user.id);
  }

  @UseGuards(AuthGuard)
  @Patch('update')
  async updateProfile(@Req() req, @Body() data: UpdateProfileDto) {
    return this.userService.updateProfile(req.user.id, data);
  }

  @UseGuards(AuthGuard)
  @Get('stats')
  async getStats(@Req() req) {
    return this.userService.getProfileStats(req.user.id);
  }

  @UseGuards(AuthGuard)
  @Get('activity')
  async getActivity(@Req() req) {
    return this.userService.getProfileActivity(req.user.id);
  }

  @UseGuards(AuthGuard)
  @Get('connections')
  async getConnections(@Req() req) {
    return this.userService.getProfileConnections(req.user.id);
  }

  @UseGuards(AuthGuard)
  @Get('search')
  async searchUsers(@Req() req, @Query('q') query: string) {
    return this.userService.searchUsers(req.user.id, query || '', 10);
  }
}
