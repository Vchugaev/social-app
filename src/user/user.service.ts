import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/storage/storage.service';
import { UpdateProfileDto } from './dto/update-profile-dto';

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
  ) {}

  async updateAvatar(userid: number, file: Express.Multer.File) {
    const key = `users/${userid}/${file.originalname}`;

    const bucket = 'avatars';

    await this.storageService.upload(userid, bucket, file, key);
    const fileRecord = await this.prisma.file.create({
      data: {
        owner: { connect: { id: userid } },
        bucket: 'avatars',
        key: key,
        type: 'image',
      },
    });
    await this.prisma.user.update({
      where: { id: userid },
      data: { avatar: { connect: { id: fileRecord.id } } },
    });

    return fileRecord;
  }

  async updateProfile(userId: number, data: UpdateProfileDto) {
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Нет данных для обновления');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        email: true,
        username: true,
        bio: true,
        firstName: true,
        lastName: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    return user;
  }

  async getProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { avatar: true },
    });

    if (!user) throw new NotFoundException('User not found');

    let avatarUrl: string | null = null;
    if (user.avatar) {
      avatarUrl = await this.storageService.getPresignedUrl(
        user.avatar.bucket,
        user.avatar.key,
        60 * 60,
      );
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      bio: user.bio,
      avatarUrl,
    };
  }
}
