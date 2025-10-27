import { IsEmail, IsString, Length, ValidationOptions } from 'class-validator';

export class RegisterDto {
  @IsString()
  @Length(3, 30)
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
