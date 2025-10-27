import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import type { Request } from 'express';
import { LoginDto } from './dto/login.dto';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { GuestGuard } from 'src/common/guards/guest.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly appService: AuthService) {}

  @UseGuards(GuestGuard)
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const user = await this.appService.register(dto);
    req.session.userId = user.id;
    return { message: 'User registered successfully' };
  }

  @UseGuards(GuestGuard)
  @Post('login')
  @HttpCode(HttpStatus.CREATED)
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const user = await this.appService.login(dto);
    req.session.userId = user.id;
    return { message: 'User logged in successfully' };
  }

  @UseGuards(AuthGuard)
  @Post('logout')
  async logout(@Req() req: Request) {
    req.session.destroy((err) => {});
    return { message: 'Logged out successfully' };
  }
}
