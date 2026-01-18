import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
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
import { OptionalAuthGuard } from 'src/common/guards/optional-auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import { UpdateProfileDto } from './dto/update-profile-dto';
import { FriendRequestDto } from './dto/friend-request.dto';
import { UpdatePrivacySettingsDto } from './dto/update-privacy-settings.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

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
  @Post('banner')
  @UseInterceptors(FileInterceptor('file'))
  async updateBanner(@Req() req, @UploadedFile() file: Express.Multer.File) {
    return this.userService.updateBanner(req.user.id, file);
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
    // Когда пользователь запрашивает свои собственные связи, передаем его же ID как requesterId
    return this.userService.getProfileConnections(req.user.id, req.user.id);
  }

  @UseGuards(AuthGuard)
  @Get('search')
  async searchUsers(@Req() req, @Query('q') query: string) {
    return this.userService.searchUsers(req.user.id, query || '', 10);
  }

  @UseGuards(AuthGuard)
  @Get('friend-requests')
  async getFriendRequests(@Req() req) {
    return this.userService.getFriendRequests(req.user.id);
  }

  @UseGuards(AuthGuard)
  @Get('friends')
  async getFriendsList(@Req() req) {
    return this.userService.getFriendsList(req.user.id);
  }

  @UseGuards(AuthGuard)
  @Get('followers')
  async getFollowers(@Req() req) {
    return this.userService.getFollowers(req.user.id);
  }

  @UseGuards(AuthGuard)
  @Get('following')
  async getFollowing(@Req() req) {
    return this.userService.getFollowing(req.user.id);
  }

  @UseGuards(AuthGuard)
  @Get('recommendations')
  async getRecommendations(@Req() req, @Query('limit') limit?: string) {
    return this.userService.getRecommendedUsers(
      req.user.id,
      limit ? parseInt(limit) : 10,
    );
  }

  @UseGuards(AuthGuard)
  @Post('friend-request')
  async sendFriendRequest(@Req() req, @Body() dto: FriendRequestDto) {
    return this.userService.sendFriendRequest(req.user.id, dto.userId);
  }

  @UseGuards(AuthGuard)
  @Post('friend-request/accept')
  async acceptFriendRequest(@Req() req, @Body() dto: FriendRequestDto) {
    return this.userService.acceptFriendRequest(req.user.id, dto.userId);
  }

  @UseGuards(AuthGuard)
  @Post('friend-request/reject')
  async rejectFriendRequest(@Req() req, @Body() dto: FriendRequestDto) {
    return this.userService.rejectFriendRequest(req.user.id, dto.userId);
  }

  @UseGuards(AuthGuard)
  @Delete('friend-request/cancel')
  async cancelFriendRequest(@Req() req, @Body() dto: FriendRequestDto) {
    return this.userService.cancelFriendRequest(req.user.id, dto.userId);
  }

  @UseGuards(AuthGuard)
  @Delete('friend')
  async removeFriend(@Req() req, @Body() dto: FriendRequestDto) {
    return this.userService.removeFriend(req.user.id, dto.userId);
  }

  // Privacy Settings - MUST be before :username routes
  @UseGuards(AuthGuard)
  @Get('privacy-settings')
  async getPrivacySettings(@Req() req) {
    return this.userService.getPrivacySettings(req.user.id);
  }

  @UseGuards(AuthGuard)
  @Patch('privacy-settings')
  async updatePrivacySettings(@Req() req, @Body() data: UpdatePrivacySettingsDto) {
    return this.userService.updatePrivacySettings(req.user.id, data);
  }

  // Password Management - MUST be before :username routes
  @UseGuards(AuthGuard)
  @Post('change-password')
  async changePassword(@Req() req, @Body() data: ChangePasswordDto) {
    return this.userService.changePassword(req.user.id, data);
  }

  // Session Management - MUST be before :username routes
  @UseGuards(AuthGuard)
  @Get('sessions')
  async getUserSessions(@Req() req) {
    return this.userService.getUserSessions(req.user.id);
  }

  @UseGuards(AuthGuard)
  @Post('logout-all')
  async logoutAllDevices(@Req() req) {
    const sessionToken = req.session?.id; // Get current session token if available
    return this.userService.logoutAllDevices(req.user.id, sessionToken);
  }

  @UseGuards(AuthGuard)
  @Delete('sessions/:sessionId')
  async deleteSession(@Req() req, @Param('sessionId') sessionId: string) {
    return this.userService.deleteSession(req.user.id, parseInt(sessionId));
  }

  // Dynamic username routes - MUST be last to avoid conflicts
  @UseGuards(OptionalAuthGuard)
  @Get(':username')
  async getUserProfile(@Req() req, @Param('username') username: string) {
    return this.userService.getUserProfileByUsername(req.user?.id, username);
  }

  @UseGuards(OptionalAuthGuard)
  @Get(':username/stats')
  async getUserStats(@Req() req, @Param('username') username: string) {
    const user = await this.userService.getUserByUsername(username);
    if (!user) {
      throw new Error('User not found');
    }
    return this.userService.getProfileStats(user.id);
  }

  @UseGuards(OptionalAuthGuard)
  @Get(':username/connections')
  async getUserConnections(@Req() req, @Param('username') username: string) {
    const user = await this.userService.getUserByUsername(username);
    if (!user) {
      throw new Error('User not found');
    }
    return this.userService.getProfileConnections(user.id, req.user?.id);
  }
}
