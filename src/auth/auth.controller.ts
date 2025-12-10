import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import type { Request, Response } from 'express';
import { LoginDto } from './dto/login.dto';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { GuestGuard } from 'src/common/guards/guest.guard';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  // --- REGISTER ---
  @UseGuards(GuestGuard)
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log(
      `Register request received for email=${dto.email}, username=${dto.username}`,
    );

    const user = await this.authService.register(dto);
    const token = this.authService.generateToken(user.id);

    this.logger.debug(`Register: Token generated for user id=${user.id}`);

    // Сохраняем userId в сессию как fallback
    if (req.session) {
      req.session.userId = user.id;
      this.logger.debug(`Register: userId saved to session: ${user.id}`);
    }

    res.cookie('token', token, {
      httpOnly: true,
      secure: false, // включить true на проде (HTTPS)
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 дней
    });

    this.logger.log(
      `Register: Cookie set successfully for user id=${user.id}, token length=${token.length}`,
    );
    this.logger.debug(
      `Register: Cookie headers: ${JSON.stringify(res.getHeaders()['set-cookie'])}`,
    );

    // Возвращаем данные пользователя (без пароля)
    const { password: _, ...userWithoutPassword } = user;
    return {
      message: 'User registered successfully',
      user: userWithoutPassword,
    };
  }

  // --- LOGIN ---
  @UseGuards(GuestGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const loginIdentifier = dto.email || dto.username;
    this.logger.log(
      `Login request received for ${dto.email ? 'email' : 'username'}=${loginIdentifier}`,
    );

    const user = await this.authService.login(dto);
    const token = this.authService.generateToken(user.id);

    this.logger.debug(`Login: Token generated for user id=${user.id}`);

    // Сохраняем userId в сессию как fallback
    if (req.session) {
      req.session.userId = user.id;
      this.logger.debug(`Login: userId saved to session: ${user.id}`);
    }

    res.cookie('token', token, {
      httpOnly: true,
      secure: false, // включить true на проде (HTTPS)
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    this.logger.log(
      `Login: Cookie set successfully for user id=${user.id}, token length=${token.length}`,
    );
    this.logger.debug(
      `Login: Cookie headers: ${JSON.stringify(res.getHeaders()['set-cookie'])}`,
    );

    // Возвращаем данные пользователя (без пароля)
    const { password: _, ...userWithoutPassword } = user;
    return {
      message: 'User logged in successfully',
      user: userWithoutPassword,
    };
  }

  // --- LOGOUT ---
  @UseGuards(AuthGuard)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const userId = (req as any).user?.id;
    this.logger.log(`Logout request received for user id=${userId}`);

    // Очищаем cookie с теми же параметрами, что и при установке
    res.clearCookie('token', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });

    // Удаляем userId из сессии и уничтожаем её
    if (req.session) {
      delete req.session.userId;
      req.session.destroy((err) => {
        if (err) {
          this.logger.error(
            `Logout: Failed to destroy session: ${err.message}`,
          );
        } else {
          this.logger.log(
            `Logout: Cookie and session cleared successfully for user id=${userId}`,
          );
        }
      });
    } else {
      this.logger.log(
        `Logout: Cookie cleared successfully for user id=${userId} (no session to destroy)`,
      );
    }

    return { message: 'Logged out successfully' };
  }
}
