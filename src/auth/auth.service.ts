import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { RegisterDto } from './dto/register.dto';
import bcrypt from 'bcrypt';
import { PrismaService } from 'src/prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService, // <--- добавили
  ) {}

  async register(data: RegisterDto) {
    this.logger.log(
      `Register attempt: email=${data.email}, username=${data.username}`,
    );

    // Проверяем существование пользователя перед созданием
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: data.email }, { username: data.username }],
      },
    });

    if (existingUser) {
      if (existingUser.email === data.email) {
        this.logger.warn(
          `Register failed: User with email ${data.email} already exists`,
        );
        throw new BadRequestException(
          'Пользователь с таким email уже существует',
        );
      }
      if (existingUser.username === data.username) {
        this.logger.warn(
          `Register failed: User with username ${data.username} already exists`,
        );
        throw new BadRequestException(
          'Пользователь с таким username уже существует',
        );
      }
    }

    this.logger.log('Register: No existing user found, creating new user');

    const hashPassword = await bcrypt.hash(data.password, 10);
    this.logger.debug('Register: Password hashed successfully');

    const user = await this.prisma.user.create({
      data: {
        password: hashPassword,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        username: data.username,
      },
    });

    this.logger.log(
      `Register successful: User created with id=${user.id}, username=${user.username}, email=${user.email}`,
    );

    return user;
  }

  generateToken(userId: number) {
    return this.jwt.sign({ userId });
  }

  async login(data: LoginDto) {
    const loginIdentifier = data.email || data.username;
    this.logger.log(
      `Login attempt: ${data.email ? 'email' : 'username'}=${loginIdentifier}`,
    );

    const password = data.password;

    let user: User | null = null;

    if (data.email) {
      this.logger.debug(`Login: Searching user by email=${data.email}`);
      user = await this.prisma.user.findUnique({
        where: { email: data.email },
      });
    } else if (data.username) {
      this.logger.debug(`Login: Searching user by username=${data.username}`);
      user = await this.prisma.user.findUnique({
        where: { username: data.username },
      });
    }

    if (!user) {
      this.logger.warn(
        `Login failed: User not found with ${data.email ? 'email' : 'username'}=${loginIdentifier}`,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    this.logger.debug(
      `Login: User found with id=${user.id}, checking password`,
    );

    const isPasswordCorrect = await bcrypt.compare(password, user.password);

    if (!isPasswordCorrect) {
      this.logger.warn(
        `Login failed: Incorrect password for user id=${user.id}, ${data.email ? 'email' : 'username'}=${loginIdentifier}`,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    this.logger.log(
      `Login successful: User id=${user.id}, username=${user.username}, email=${user.email}`,
    );

    return user;
  }
}
