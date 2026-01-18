import { IsOptional, IsString, IsInt, Matches, Length } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(3, 30, { message: 'Имя пользователя должно содержать от 3 до 30 символов' })
  @Matches(/^[a-zA-Z0-9_-]+$/, { 
    message: 'Имя пользователя может содержать только латинские буквы, цифры, дефис и подчеркивание' 
  })
  username?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
