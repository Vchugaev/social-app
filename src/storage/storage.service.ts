import {
  Injectable,
  Logger,
  OnModuleInit,
  InternalServerErrorException,
} from '@nestjs/common';
import * as Minio from 'minio';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
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
    this.logger.log(
      `Uploading file: ${file?.originalname || 'unknown'} to bucket=${bucket}, key=${key}, userId=${userId}`,
    );

    try {
      // Проверяем, что файл имеет необходимые свойства
      if (!file || !file.buffer || !file.originalname || !file.mimetype) {
        const missingProps: string[] = [];
        if (!file) missingProps.push('file');
        if (!file?.buffer) missingProps.push('buffer');
        if (!file?.originalname) missingProps.push('originalname');
        if (!file?.mimetype) missingProps.push('mimetype');

        this.logger.error(
          `Invalid file object: missing required properties: ${missingProps.join(', ')}`,
        );
        throw new Error(
          `Invalid file object: missing required properties: ${missingProps.join(', ')}`,
        );
      }

      this.logger.debug(
        `File validation passed: name=${file.originalname}, size=${file.size}, mimetype=${file.mimetype}`,
      );

      // Проверяем и создаем bucket если нужно
      try {
        this.logger.debug(`Checking if bucket "${bucket}" exists`);
        const exists = await this.client.bucketExists(bucket);
        if (!exists) {
          this.logger.log(`Bucket "${bucket}" does not exist, creating...`);
          await this.client.makeBucket(bucket);
          this.logger.log(`Bucket "${bucket}" created successfully`);
        } else {
          this.logger.debug(`Bucket "${bucket}" already exists`);
        }
      } catch (err: any) {
        if (err.code !== 'BucketAlreadyOwnedByYou') {
          const errorCode = err.code || err.message || 'Unknown';
          
          // Специальная обработка ошибок подключения
          if (errorCode === 'ECONNREFUSED' || errorCode.includes('ECONNREFUSED')) {
            this.logger.error(
              `Cannot connect to MinIO server. Please ensure MinIO is running on localhost:9000`,
            );
            throw new Error(
              'File storage service is unavailable. Please contact administrator.',
            );
          }

          this.logger.error(
            `Failed to check/create bucket "${bucket}": ${err.message || err.code || err}`,
          );
          throw err;
        }
        this.logger.debug(`Bucket "${bucket}" already owned by you`);
      }

      // Загружаем файл в MinIO
      try {
        this.logger.debug(
          `Uploading file to MinIO: bucket=${bucket}, key=${key}, size=${file.size}`,
        );
        await this.client.putObject(bucket, key, file.buffer, file.size);
        this.logger.log(
          `File uploaded to MinIO successfully: ${file.originalname}`,
        );
      } catch (err: any) {
        const errorCode = err.code || err.message || 'Unknown';
        
        // Специальная обработка ошибок подключения
        if (errorCode === 'ECONNREFUSED' || errorCode.includes('ECONNREFUSED')) {
          this.logger.error(
            `Cannot connect to MinIO server while uploading file. Please ensure MinIO is running on localhost:9000`,
          );
          throw new Error(
            'File storage service is unavailable. Please contact administrator.',
          );
        }

        this.logger.error(
          `Failed to upload file to MinIO: ${err.message || err.code || err}`,
        );
        throw new Error(
          `MinIO upload failed: ${err.message || err.code || 'Unknown error'}`,
        );
      }

      // Сохраняем информацию о файле в БД
      try {
        this.logger.debug(
          `Saving file record to database: bucket=${bucket}, key=${key}, type=${file.mimetype}`,
        );
        const savedFile = await this.prisma.file.create({
          data: {
            ownerId: userId,
            bucket,
            key,
            type: file.mimetype,
          },
        });
        this.logger.log(
          `File record saved to database: id=${savedFile.id}, filename=${file.originalname}`,
        );
        return savedFile;
      } catch (err: any) {
        this.logger.error(
          `Failed to save file record to database: ${err.message || err.code || err}`,
        );

        // Пытаемся удалить файл из MinIO, если запись в БД не создалась
        try {
          this.logger.warn(
            `Attempting to cleanup uploaded file from MinIO due to database error`,
          );
          await this.client.removeObject(bucket, key);
          this.logger.log(`File cleaned up from MinIO successfully`);
        } catch (cleanupErr: any) {
          this.logger.error(
            `Failed to cleanup file from MinIO: ${cleanupErr.message || cleanupErr}`,
          );
        }

        throw new Error(
          `Database save failed: ${err.message || err.code || 'Unknown error'}`,
        );
      }
    } catch (err: any) {
      const errorCode = err.code || err.message || 'Unknown';
      const errorMessage =
        err.message ||
        err.code ||
        err.toString() ||
        'Unknown error occurred';
      const errorStack = err.stack || 'No stack trace available';

      this.logger.error(
        `Failed to upload file "${file?.originalname || 'unknown'}": ${errorMessage}`,
      );
      this.logger.debug(`Error stack: ${errorStack}`);

      // Если это уже HTTP исключение, пробрасываем его дальше
      if (err instanceof InternalServerErrorException) {
        throw err;
      }

      // Специальная обработка ошибок подключения для более понятного сообщения
      if (errorCode === 'ECONNREFUSED' || errorCode.includes('ECONNREFUSED')) {
        throw new InternalServerErrorException(
          'File storage service is unavailable. Please contact administrator or try again later.',
        );
      }

      throw new InternalServerErrorException(
        `Failed to upload file "${file?.originalname || 'unknown'}": ${errorMessage}`,
      );
    }
  }
}
