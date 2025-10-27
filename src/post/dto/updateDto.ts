import { IsOptional, IsString, IsBoolean, IsArray } from 'class-validator';

export class UpdatePostDto {
  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsArray()
  deleteMediaIds?: number[];
}
