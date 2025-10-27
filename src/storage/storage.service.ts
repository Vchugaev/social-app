import {
  Injectable,
  OnModuleInit,
  InternalServerErrorException,
} from '@nestjs/common';
import * as Minio from 'minio';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class StorageService implements OnModuleInit {
  private client: Minio.Client;

  constructor(private prisma: PrismaService) {}

  onModuleInit(): void {
    this.client = new Minio.Client({
      endPoint: 'localhost',
      port: 9000,
      useSSL: false,
      accessKey: 'admin',
      secretKey: 'password123',
    });
  }
  async getPresignedUrl(bucket: string, key: string, expires: number) {
    return this.client.presignedGetObject(bucket, key, expires);
  }

  async deleteFile(bucket: string, key: string) {
    try {
      console.log(`StorageService: Ищем файл bucket=${bucket}, key=${key}`);

      // Сначала находим файл
      const file = await this.prisma.file.findFirst({
        where: { bucket, key },
      });

      if (!file) {
        console.log('StorageService: Файл не найден');
        return { success: true }; // Файл уже не существует
      }

      console.log(`StorageService: Найден файл с id=${file.id}`);

      // Удаляем связанные записи
      const deletedPostMedia = await this.prisma.postMedia.deleteMany({
        where: { fileId: file.id },
      });
      console.log(
        `StorageService: Удалено PostMedia записей: ${deletedPostMedia.count}`,
      );

      await this.prisma.message.updateMany({
        where: { fileId: file.id },
        data: { fileId: null },
      });

      await this.prisma.user.updateMany({
        where: { avatarId: file.id },
        data: { avatarId: null },
      });

      // Удаляем файл из облачного хранилища
      await this.client.removeObject(bucket, key);
      console.log('StorageService: Файл удален из облачного хранилища');

      // Удаляем запись файла из базы данных
      await this.prisma.file.delete({
        where: { id: file.id },
      });
      console.log('StorageService: Файл удален из базы данных');

      return { success: true };
    } catch (err) {
      console.error('StorageService: Ошибка при удалении файла:', err);
      throw new InternalServerErrorException(
        `Failed to delete file: ${err.message}`,
      );
    }
  }

  async upload(
    userId: number,
    bucket: string,
    file: Express.Multer.File,
    key: string,
  ) {
    try {
      // Проверяем, что файл имеет необходимые свойства
      if (!file || !file.buffer || !file.originalname || !file.mimetype) {
        throw new Error('Invalid file object: missing required properties');
      }

      try {
        const exists = await this.client.bucketExists(bucket);
        if (!exists) {
          await this.client.makeBucket(bucket);
        }
      } catch (err: any) {
        if (err.code !== 'BucketAlreadyOwnedByYou') throw err;
      }

      await this.client.putObject(bucket, key, file.buffer, file.size);

      const savedFile = await this.prisma.file.create({
        data: {
          ownerId: userId,
          bucket,
          key,
          type: file.mimetype,
        },
      });

      return savedFile;
    } catch (err) {
      throw new InternalServerErrorException(
        `Failed to upload file: ${err.message}`,
      );
    }
  }
}
