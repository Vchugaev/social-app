import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';

/**
 * OptionalAuthGuard - позволяет доступ как аутентифицированным, так и гостевым пользователям
 * Если пользователь аутентифицирован, добавляет req.user
 * Если нет - просто пропускает запрос дальше
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest() as Request;

    // Если есть userId в сессии, добавляем user в request
    if (request.session?.userId) {
      (request as any).user = { id: request.session.userId };
    }

    // Всегда пропускаем запрос (даже если пользователь не аутентифицирован)
    return true;
  }
}
