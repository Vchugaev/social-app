import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Req,
  UseGuards,
  Query,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { AuthGuard } from 'src/common/guards/auth.guard';

@Controller('notification')
@UseGuards(AuthGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  async getNotifications(@Req() req, @Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.notificationService.getNotifications(req.user.id, limitNum);
  }

  @Get('unread-count')
  async getUnreadCount(@Req() req) {
    return this.notificationService.getUnreadCount(req.user.id);
  }

  @Patch(':id/read')
  async markAsRead(@Req() req, @Param('id') id: string) {
    const notificationId = parseInt(id, 10);
    return this.notificationService.markAsRead(req.user.id, notificationId);
  }

  @Patch('read-all')
  async markAllAsRead(@Req() req) {
    return this.notificationService.markAllAsRead(req.user.id);
  }

  @Delete(':id')
  async deleteNotification(@Req() req, @Param('id') id: string) {
    const notificationId = parseInt(id, 10);
    return this.notificationService.deleteNotification(req.user.id, notificationId);
  }
}
