import { Injectable, UnauthorizedException } from '@nestjs/common';
import { User } from '@prisma/client';
import { RegisterDto } from './dto/register.dto';
import bcrypt from 'bcrypt';
import { PrismaService } from 'src/prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  async register(data: RegisterDto) {
    const password = data.password;
    const hashPassword = await bcrypt.hash(password, 10);

    const user = {
      password: hashPassword,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      username: data.username,
    };
    return this.prisma.user.create({ data: user });
  }

  async login(data: LoginDto) {
    const password = data.password;

    let user: User | null = null;
    if (data.email) {
      user = await this.prisma.user.findUnique({
        where: { email: data.email },
      });
    } else if (data.username) {
      user = await this.prisma.user.findUnique({
        where: { username: data.username },
      });
    }

    if (!user) throw new UnauthorizedException('Invalid credentials');

    const hashPassword: boolean = await bcrypt.compare(password, user.password);

    if (hashPassword) {
      return user;
    } else {
      throw new UnauthorizedException('Invalid credentials');
    }
  }
}
