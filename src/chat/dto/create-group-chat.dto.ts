import { IsString, IsArray, IsOptional, MinLength, MaxLength, ArrayMinSize } from 'class-validator';

export class CreateGroupChatDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  memberIds: number[];
}
