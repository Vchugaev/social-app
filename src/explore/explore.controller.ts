import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { ExploreService } from './explore.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { OptionalAuthGuard } from '../common/guards/optional-auth.guard';
import type { Request } from 'express';

@Controller('explore')
export class ExploreController {
  constructor(private readonly exploreService: ExploreService) {}

  @Get('feed')
  @UseGuards(OptionalAuthGuard)
  async getExploreFeed(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 30;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return this.exploreService.getExploreFeed(limitNum, offsetNum);
  }

  @Get('trends')
  async getTrends(@Query('hours') hours?: string) {
    const hoursNum = hours ? parseInt(hours, 10) : 24;
    return this.exploreService.getTrends(hoursNum);
  }

  @Get('tag')
  @UseGuards(OptionalAuthGuard)
  async getPostsByTag(
    @Req() req: Request,
    @Query('tag') tag: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (!tag) {
      return { error: 'Tag parameter is required' };
    }

    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    const userId = req.user?.id;

    return this.exploreService.getPostsByTag(tag, pageNum, limitNum, userId);
  }
}

