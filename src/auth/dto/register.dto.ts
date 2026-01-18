import { IsEmail, IsString, Length, Matches } from 'class-validator';

export class RegisterDto {
  @IsString()
  @Length(3, 30, { message: 'Имя пользователя должно содержать от 3 до 30 символов' })
  @Matches(/^[a-zA-Z0-9_-]+$/, { 
    message: 'Имя пользователя может содержать только латинские буквы, цифры, дефис и подчеркивание' 
  })
  username: string;

  @IsEmail()
  @IsString()
  email: string;

  @IsString()
  @Length(8, 50)
  password: string;

  @IsString()
  @Length(2, 20)
  firstName: string;

  @IsString()
  @Length(2, 20)
  lastName: string;
}
