import { IsEmail, IsString, Length, IsOptional, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments, Validate } from 'class-validator';

@ValidatorConstraint({ name: 'usernameOrEmail', async: false })
class UsernameOrEmailValidator implements ValidatorConstraintInterface {
  validate(value: any, args: ValidationArguments) {
    const obj = args.object as any;
    return !!(obj.username || obj.email); // true если есть хотя бы один
  }

  defaultMessage(args: ValidationArguments) {
    return 'Either username or email must be provided';
  }
}

export class LoginDto {
  @IsOptional()
  @IsString()
  @Length(3, 30)
  username?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @Length(8, 50)
  @Validate(UsernameOrEmailValidator)
  password: string;
}
