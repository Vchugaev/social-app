import {
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from 'src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    this.logger.log(
      `AuthGuard: Checking authentication for ${request.method} ${request.url}`,
    );

    if (!request) {
      this.logger.error('AuthGuard: Invalid request object');
      throw new UnauthorizedException('Invalid request');
    }

    // Сначала проверяем JWT токен из cookie
    this.logger.debug(
      `AuthGuard: All cookies keys: ${Object.keys(request.cookies || {}).join(', ')}`,
    );
    const token = request.cookies?.token;

    if (!token) {
      // Если нет токена, проверяем сессию (для обратной совместимости)
      if (!request.session?.userId) {
        this.logger.warn(
          `AuthGuard: No token in cookies and no userId in session. Cookies: ${JSON.stringify(request.cookies)}, Session: ${JSON.stringify(request.session)}`,
        );
        throw new UnauthorizedException('Not authenticated');
      }

      this.logger.log(
        `AuthGuard: Found userId in session: ${request.session.userId}`,
      );

      const user = await this.prisma.user.findUnique({
        where: { id: request.session.userId },
      });

      if (!user) {
        this.logger.warn(
          `AuthGuard: User not found with id: ${request.session.userId}`,
        );
        throw new UnauthorizedException('User not found');
      }

      this.logger.log(
        `AuthGuard: User authenticated successfully via session: ${user.username} (id: ${user.id})`,
      );
      request.user = user;
      return true;
    }

    // Верифицируем JWT токен
    try {
      this.logger.debug('AuthGuard: Verifying JWT token from cookie');
      const payload = this.jwtService.verify(token);
      const userId = payload.userId;

      if (!userId) {
        this.logger.warn('AuthGuard: No userId in JWT payload');
        throw new UnauthorizedException('Invalid token');
      }

      this.logger.log(`AuthGuard: Token verified, userId=${userId}`);

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        this.logger.warn(`AuthGuard: User not found with id: ${userId}`);
        throw new UnauthorizedException('User not found');
      }

      this.logger.log(
        `AuthGuard: User authenticated successfully via JWT: ${user.username} (id: ${user.id})`,
      );
      request.user = user;
      return true;
    } catch (error) {
      this.logger.warn(
        `AuthGuard: Token verification failed: ${error.message}`,
      );
      throw new UnauthorizedException('Invalid token');
    }
  }
}
