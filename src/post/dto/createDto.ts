import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateDto {
  @IsOptional()
  @IsString()
  @Length(3, 4000)
  content: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value === 'true';
    }
    return value;
  })
  @IsBoolean()
  isPublished?: boolean;
}
